import { useSyncExternalStore } from "react";
import { Client, type Room } from "@colyseus/sdk";
import { BlitzState } from "../../shared/state";
import { MSG, type SettingsUpdate } from "../../shared/schemas";
import { ROOM_TYPE } from "../../shared/constants";
import { normalizeRoomCode } from "../../shared/roomCode";
import { clearResume, getClientId, loadResume, saveResume, saveProfile } from "./session";
import { friendlyError, REJECT_MESSAGES } from "./errors";

export type Snapshot = ReturnType<BlitzState["toJSON"]>;
export type PlayerSnap = Snapshot["players"][string];
export type Status = "idle" | "connecting" | "connected" | "reconnecting" | "lost";

export interface Toast {
  id: number;
  text: string;
}

export interface View {
  status: Status;
  snap: Snapshot | null;
  myId: string | null;
  /** Option picked locally on the current question, so the UI answers instantly. */
  pick: { q: number; choice: number } | null;
  /** True once the server confirmed the pick. */
  acked: boolean;
  error: string | null;
  toasts: Toast[];
  /** Why the player is back on the home screen, if they were removed. */
  notice: string | null;
  /** Milliseconds to add to Date.now() to get server time. */
  offset: number;
}

const initial: View = {
  status: "idle",
  snap: null,
  myId: null,
  pick: null,
  acked: false,
  error: null,
  toasts: [],
  notice: null,
  offset: 0,
};

function serverUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_SERVER_URL) return env.VITE_SERVER_URL;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const dev = location.port === "5173";
  return dev ? `${proto}://${location.hostname}:2567` : `${proto}://${location.host}`;
}

class GameStore {
  private view: View = initial;
  private listeners = new Set<() => void>();
  private room: Room<any, BlitzState> | null = null;
  private client: Client | null = null;
  private toastId = 0;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private samples: Array<{ rtt: number; offset: number }> = [];
  private leaving = false;
  private lastMatchId = "";

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getView = (): View => this.view;

  private set(patch: Partial<View>): void {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((l) => l());
  }

  private getClient(): Client {
    this.client ??= new Client(serverUrl());
    return this.client;
  }

  /** Server time as the client best estimates it. */
  now = (): number => Date.now() + this.view.offset;

  toast(text: string): void {
    const id = ++this.toastId;
    this.set({ toasts: [...this.view.toasts, { id, text }] });
    setTimeout(() => this.set({ toasts: this.view.toasts.filter((t) => t.id !== id) }), 3500);
  }

  dismissNotice(): void {
    this.set({ notice: null, error: null });
  }

  async create(name: string, avatar: number): Promise<boolean> {
    saveProfile(name, avatar);
    return this.connect(async () =>
      this.getClient().create(ROOM_TYPE, { name, avatar, clientId: getClientId() }, BlitzState),
    );
  }

  async join(codeInput: string, name: string, avatar: number): Promise<boolean> {
    saveProfile(name, avatar);
    const code = normalizeRoomCode(codeInput);
    return this.connect(async () =>
      this.getClient().joinById(code, { name, avatar, clientId: getClientId() }, BlitzState),
    );
  }

  /** Called on page load. Tries the stored reconnection token first. */
  async resume(): Promise<boolean> {
    const info = loadResume();
    if (!info) return false;
    const profileName = (await import("./session")).loadProfile();
    return this.connect(async () => {
      try {
        return await this.getClient().reconnect<BlitzState>(info.token, BlitzState);
      } catch {
        if (!profileName.name) throw new Error("no profile");
        return this.getClient().joinById(
          info.code,
          { name: profileName.name, avatar: profileName.avatar, clientId: getClientId() },
          BlitzState,
        );
      }
    }, true);
  }

  private async connect(open: () => Promise<Room<any, BlitzState>>, silent = false): Promise<boolean> {
    this.leaving = false;
    this.set({ status: "connecting", error: null, notice: null });
    try {
      const room = await open();
      this.attach(room);
      return true;
    } catch (err) {
      clearResume();
      this.set({ status: "idle", error: silent ? null : friendlyError(err) });
      return false;
    }
  }

  private attach(room: Room<any, BlitzState>): void {
    this.room = room;
    this.samples = [];
    this.lastMatchId = "";
    saveResume({ code: room.roomId, token: room.reconnectionToken });

    const refresh = (): void => {
      if (!room.state.code) return; // first full state has not arrived yet
      const snap = room.state.toJSON() as Snapshot;
      const me = Object.values(snap.players).find((p) => p.sid === room.sessionId);
      const patch: Partial<View> = { snap, myId: me?.id ?? this.view.myId };
      if (snap.matchId !== this.lastMatchId) {
        this.lastMatchId = snap.matchId;
        patch.pick = null;
        patch.acked = false;
      }
      if (this.view.pick && snap.question.index !== this.view.pick.q && snap.phase !== "REVEAL") {
        patch.pick = null;
        patch.acked = false;
      }
      this.set({ ...patch, status: this.view.status === "reconnecting" ? "reconnecting" : "connected" });
    };
    room.onStateChange(refresh);
    refresh();

    room.onMessage(MSG.answerAck, () => this.set({ acked: true }));
    room.onMessage(MSG.rejected, (m: { type: string; reason: string }) => {
      if (m.type === MSG.answer) this.set({ pick: null, acked: false });
      this.toast(REJECT_MESSAGES[m.reason] ?? "That did not work. Try again.");
    });
    room.onMessage(MSG.syncReply, (m: { t0: number; serverNow: number }) => {
      const t1 = Date.now();
      const rtt = t1 - m.t0;
      const offset = m.serverNow + rtt / 2 - t1;
      this.samples.push({ rtt, offset });
      if (this.samples.length > 7) this.samples.shift();
      const best = [...this.samples].sort((a, b) => a.rtt - b.rtt)[0];
      if (best) this.set({ offset: best.offset });
    });
    this.startSync(room);

    room.onDrop(() => {
      if (!this.leaving) this.set({ status: "reconnecting" });
    });
    room.onReconnect(() => {
      saveResume({ code: room.roomId, token: room.reconnectionToken });
      this.set({ status: "connected" });
      this.sync();
    });
    room.onLeave((code) => {
      this.stopSync();
      if (this.room !== room) return;
      this.room = null;
      if (this.leaving) return;
      clearResume();
      this.set({
        status: "lost",
        notice:
          code === 4000 || code === 1000
            ? "You left the room."
            : "You lost the connection and the room could not be rejoined. Start again or rejoin with the code.",
      });
    });
    room.onError((_code, message) => {
      this.toast(message ? "Connection problem. Trying to recover." : "Connection problem.");
    });
  }

  private startSync(room: Room<any, BlitzState>): void {
    this.stopSync();
    this.sync();
    let burst = 0;
    const fast = setInterval(() => {
      this.sync();
      if (++burst >= 4) clearInterval(fast);
    }, 400);
    this.syncTimer = setInterval(() => {
      if (this.room === room) this.sync();
    }, 20_000);
  }

  private stopSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  private sync(): void {
    try {
      this.room?.send(MSG.sync, { t0: Date.now() });
    } catch {
      /* socket may be closed mid-reconnect */
    }
  }

  private send(type: string, payload?: unknown): void {
    try {
      this.room?.send(type, payload);
    } catch {
      this.toast("Not connected right now.");
    }
  }

  setReady(ready: boolean): void {
    this.send(MSG.setReady, { ready });
  }
  setSettings(update: Partial<SettingsUpdate>): void {
    this.send(MSG.setSettings, update);
  }
  start(): void {
    this.send(MSG.startMatch);
  }
  playAgain(): void {
    this.send(MSG.playAgain);
  }
  backToLobby(): void {
    this.send(MSG.backToLobby);
  }

  answer(choice: number): void {
    const snap = this.view.snap;
    if (!snap || snap.phase !== "QUESTION" || this.view.pick) return;
    const q = snap.question.index;
    this.set({ pick: { q, choice }, acked: false });
    this.send(MSG.answer, { q, choice });
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.leaving = true;
    this.stopSync();
    clearResume();
    this.room = null;
    this.set({ ...initial, notice: null });
    if (room) {
      try {
        room.send(MSG.leave);
        await Promise.race([room.leave(true), new Promise((r) => setTimeout(r, 800))]);
      } catch {
        /* already closed */
      }
    }
  }
}

export const game = new GameStore();

export function useGame(): View {
  return useSyncExternalStore(game.subscribe, game.getView, game.getView);
}
