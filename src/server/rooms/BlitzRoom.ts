import { randomBytes, randomUUID } from "node:crypto";
import { CloseCode, matchMaker, Room, ServerError, type Client } from "@colyseus/core";
import type { ZodType } from "zod";
import { ERROR_CODES, type ErrorKey } from "../../shared/constants";
import { generateRoomCode } from "../../shared/roomCode";
import {
  answerSchema,
  emptySchema,
  joinOptionsSchema,
  MSG,
  readySchema,
  settingsSchema,
  teamSchema,
  syncSchema,
} from "../../shared/schemas";
import { MatchEngine, type RejectReason, type Result } from "../game/engine";
import { log } from "../log";
import { activeRoomCount, counters, registerRoomProbe } from "../metrics";
import { createLimiter, joinLimiter, runtime } from "../runtime";
import { createInitialState, type BlitzState } from "../../shared/state";

interface AuthData {
  clientId: string;
  name: string;
  avatar: number;
  existingPid: string | null;
}

function reject(key: ErrorKey, code: number): never {
  counters.joinsRejected += 1;
  throw new ServerError(code, key);
}

export class BlitzRoom extends Room<{ state: BlitzState }> {
  // Colyseus locks a room at maxClients. We enforce our own cap in onAuth so a full room
  // returns a clear error instead of a generic "locked", so the engine limit is the real one.
  override maxClients = 64;

  private engine!: MatchEngine;
  private code = "";
  private readonly byClientId = new Map<string, string>();
  private readonly bySession = new Map<string, string>();
  private readonly sessionOfPid = new Map<string, Client>();
  private unregister: (() => void) | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivity = Date.now();
  private matchTimers = new Set<NodeJS.Timeout>();

  override async onCreate(): Promise<void> {
    if (activeRoomCount() >= runtime.maxRooms) throw new ServerError(503, "SERVER_BUSY");

    this.code = await this.allocateCode();
    this.roomId = this.code;
    this.maxMessagesPerSecond = runtime.maxMessagesPerSecond;
    this.setState(createInitialState(this.code));

    this.engine = new MatchEngine({
      state: this.state,
      now: () => Date.now(),
      schedule: (fn, ms) => {
        const t = setTimeout(() => {
          this.matchTimers.delete(t);
          try {
            fn();
          } catch (err) {
            counters.unexpectedErrors += 1;
            log("error", "timer_failed", { room: this.code, message: errMessage(err) });
          }
        }, ms);
        this.matchTimers.add(t);
        return () => {
          clearTimeout(t);
          this.matchTimers.delete(t);
        };
      },
      timing: runtime.timing,
      newId: () => randomUUID().slice(0, 8),
      onEvent: (event, data) => {
        if (event === "match_started") counters.matchesStarted += 1;
        if (event === "match_completed") counters.matchesCompleted += 1;
        if (event === "phase") log("debug", "phase", { room: this.code, ...data });
        else log("info", event, { room: this.code, ...data });
      },
      onMatchComplete: (summary) => {
        const hook = runtime.onMatchComplete;
        if (!hook) return;
        Promise.resolve(hook(summary)).catch((err) => {
          counters.persistenceFailures += 1;
          log("warn", "persistence_failed", { room: this.code, message: errMessage(err) });
        });
      },
    });

    this.registerHandlers();

    this.unregister = registerRoomProbe(() => ({
      code: this.code,
      playerCount: this.engine.connectedPlayers().length,
      phase: this.state.phase,
    }));
    this.idleTimer = setInterval(() => this.checkIdle(), runtime.idleCheckMs);
    this.idleTimer.unref();

    counters.roomsCreated += 1;
    log("info", "room_created", { room: this.code });
  }

  private async allocateCode(): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const code = generateRoomCode((n) => randomBytes(n));
      if (!(await matchMaker.getRoomById(code))) return code;
    }
    throw new ServerError(503, "SERVER_BUSY");
  }

  // ------------------------------------------------------------- admission

  override onAuth(_client: Client, options: unknown, context: { ip?: string }): AuthData {
    const ip = context.ip ?? "unknown";
    const parsed = joinOptionsSchema.safeParse(options);
    if (!parsed.success) reject("BAD_NAME", ERROR_CODES.badName);
    const { name, avatar, clientId } = parsed.data;

    const existingPid = this.byClientId.get(clientId) ?? null;
    const isFirst = this.state.hostId === "" && this.byClientId.size === 0;

    if (isFirst) {
      if (!createLimiter.allow(ip)) {
        counters.rateLimited += 1;
        reject("RATE_LIMITED", ERROR_CODES.rateLimited);
      }
    } else if (!joinLimiter.allow(ip)) {
      counters.rateLimited += 1;
      reject("RATE_LIMITED", ERROR_CODES.rateLimited);
    }

    if (!existingPid) {
      if (this.state.phase !== "LOBBY") reject("MATCH_IN_PROGRESS", ERROR_CODES.matchInProgress);
      if (this.engine.activePlayers().length >= this.state.maxPlayers) reject("ROOM_FULL", ERROR_CODES.roomFull);
    }
    return { clientId, name, avatar, existingPid };
  }

  override onJoin(client: Client, _options: unknown, auth: AuthData): void {
    this.touch();
    let pid = auth.existingPid;

    if (pid && this.engine.getPlayer(pid)) {
      // Same browser tab joining again: this connection takes over the seat.
      const previous = this.sessionOfPid.get(pid);
      if (previous && previous.sessionId !== client.sessionId) {
        this.bySession.delete(previous.sessionId);
        previous.leave(CloseCode.CONSENTED);
      }
      const p = this.engine.getPlayer(pid);
      if (p?.left) this.engine.rejoin(pid);
      else this.engine.setConnected(pid, true);
      counters.playersReconnected += 1;
      log("info", "player_rejoined", { room: this.code });
    } else {
      pid = randomUUID().slice(0, 8);
      const result = this.engine.addPlayer(pid, auth.name, auth.avatar);
      if (!result.ok) {
        counters.joinsRejected += 1;
        throw new ServerError(
          result.reason === "ROOM_FULL" ? ERROR_CODES.roomFull : ERROR_CODES.matchInProgress,
          result.reason === "ROOM_FULL" ? "ROOM_FULL" : "MATCH_IN_PROGRESS",
        );
      }
      this.byClientId.set(auth.clientId, pid);
      counters.playersJoined += 1;
      log("info", "player_joined", { room: this.code, players: this.engine.activePlayers().length });
    }
    this.bySession.set(client.sessionId, pid);
    this.sessionOfPid.set(pid, client);
    this.engine.setSession(pid, client.sessionId);
  }

  // ------------------------------------------------------------ connection

  override onDrop(client: Client): void {
    const pid = this.bySession.get(client.sessionId);
    if (!pid) return;
    this.touch();
    this.engine.setConnected(pid, false);
    log("info", "player_dropped", { room: this.code });
    // Hold the seat. If the window passes, the framework calls onLeave.
    this.allowReconnection(client, runtime.reconnectSeconds).catch(() => {
      // Rejected when the window passes or the room is closing. onLeave handles the aftermath.
    });
  }

  override onReconnect(client: Client): void {
    const pid = this.bySession.get(client.sessionId);
    if (!pid) {
      client.leave(CloseCode.CONSENTED);
      return;
    }
    this.touch();
    this.sessionOfPid.set(pid, client);
    this.engine.setConnected(pid, true);
    counters.playersReconnected += 1;
    log("info", "player_reconnected", { room: this.code });
  }

  override onLeave(client: Client, code?: number): void {
    const pid = this.bySession.get(client.sessionId);
    if (!pid) return; // superseded by a newer connection from the same tab
    this.touch();
    this.bySession.delete(client.sessionId);
    if (this.sessionOfPid.get(pid)?.sessionId === client.sessionId) this.sessionOfPid.delete(pid);

    this.engine.removeOrMarkLeft(pid);
    const stillThere = this.engine.getPlayer(pid);
    // A player who left on purpose cannot slip back into a running match with the old id.
    if (!stillThere || code === CloseCode.CONSENTED) {
      for (const [cid, p] of this.byClientId) if (p === pid) this.byClientId.delete(cid);
    }
    log("info", "player_left", { room: this.code, consented: code === CloseCode.CONSENTED });
  }

  override onDispose(): void {
    this.engine?.dispose();
    this.unregister?.();
    if (this.idleTimer) clearInterval(this.idleTimer);
    for (const t of this.matchTimers) clearTimeout(t);
    this.matchTimers.clear();
    counters.roomsDisposed += 1;
    log("info", "room_disposed", { room: this.code });
  }

  // -------------------------------------------------------------- messages

  private registerHandlers(): void {
    this.onMessage(MSG.sync, (client, raw) => {
      const parsed = syncSchema.safeParse(raw);
      if (!parsed.success) return this.refuse(client, MSG.sync, "BAD_REQUEST");
      client.send(MSG.syncReply, { t0: parsed.data.t0, serverNow: Date.now() });
    });

    this.guarded(MSG.setReady, readySchema, (pid, d) => this.engine.setReady(pid, d.ready));
    this.guarded(MSG.setSettings, settingsSchema, (pid, d) => this.engine.updateSettings(pid, d));
    this.guarded(MSG.setTeam, teamSchema, (pid, d) => this.engine.setTeam(pid, d.team));
    this.guarded(MSG.startMatch, emptySchema, (pid) => this.engine.start(pid));
    this.guarded(MSG.playAgain, emptySchema, (pid) => this.engine.playAgain(pid));
    this.guarded(MSG.backToLobby, emptySchema, (pid) => this.engine.backToLobby(pid));
    this.guarded(MSG.answer, answerSchema, (pid, d, client) => {
      const r = this.engine.submitAnswer(pid, d.q, d.choice);
      if (r.ok) client.send(MSG.answerAck, { q: d.q });
      return r;
    });
  }

  private guarded<T>(type: string, schema: ZodType<T>, run: (pid: string, data: T, client: Client) => Result): void {
    this.onMessage(type, (client, raw) => {
      try {
        const pid = this.bySession.get(client.sessionId);
        if (!pid) return this.refuse(client, type, "UNKNOWN_PLAYER");
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return this.refuse(client, type, "BAD_REQUEST");
        this.touch();
        const result = run(pid, parsed.data, client);
        if (!result.ok) this.refuse(client, type, result.reason);
      } catch (err) {
        counters.unexpectedErrors += 1;
        log("error", "handler_failed", { room: this.code, type, message: errMessage(err) });
        client.send(MSG.rejected, { type, reason: "SERVER_ERROR" });
      }
    });
  }

  private refuse(client: Client, type: string, reason: RejectReason | "BAD_REQUEST"): void {
    counters.messagesRejected += 1;
    log("debug", "message_rejected", { room: this.code, type, reason });
    client.send(MSG.rejected, { type, reason });
  }

  // ------------------------------------------------------------------ idle

  private touch(): void {
    this.lastActivity = Date.now();
  }

  private checkIdle(): void {
    const phase = this.state.phase;
    if (phase !== "LOBBY" && phase !== "RESULTS") return;
    if (Date.now() - this.lastActivity < runtime.idleRoomMs) return;
    log("info", "room_idle_closed", { room: this.code });
    void this.disconnect();
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "unknown";
}
