import { randomBytes } from "node:crypto";
import { Client, type Room } from "@colyseus/sdk";
import { MSG } from "../../src/shared/schemas";
import { ROOM_TYPE } from "../../src/shared/constants";
import { startServer, type Running } from "../../src/server/app";
import { configureRuntime, defaultConfig, FAST_TIMING } from "../../src/server/runtime";
import { BlitzState } from "../../src/shared/state";

export type Snapshot = ReturnType<BlitzState["toJSON"]>;

export async function startTestServer(overrides: Parameters<typeof configureRuntime>[0] = {}): Promise<Running> {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  configureRuntime({
    ...defaultConfig(),
    timing: FAST_TIMING,
    createsPerMinute: 10_000,
    joinsPerMinute: 10_000,
    matchmakePerMinute: 100_000,
    reconnectSeconds: 5,
    ...overrides,
  });
  return startServer({ port: 0, host: "127.0.0.1" });
}

export interface Player {
  room: Room<any, BlitzState>;
  clientId: string;
  rejected: Array<{ type: string; reason: string }>;
  acks: number[];
  snap: () => Snapshot;
  me: () => Snapshot["players"][string];
  send: (type: string, payload?: unknown) => void;
  close: () => Promise<void>;
}

export function newClientId(): string {
  return randomBytes(12).toString("hex");
}

function wrap(room: Room<any, BlitzState>, clientId: string): Player {
  const rejected: Player["rejected"] = [];
  const acks: number[] = [];
  room.onMessage(MSG.rejected, (m: { type: string; reason: string }) => rejected.push(m));
  room.onMessage(MSG.answerAck, (m: { q: number }) => acks.push(m.q));
  return {
    room,
    clientId,
    rejected,
    acks,
    snap: () => room.state.toJSON() as Snapshot,
    me: () => {
      const players = (room.state.toJSON() as Snapshot).players;
      const mine = Object.values(players).find((p) => p.sid === room.sessionId);
      if (!mine) throw new Error("own player not in roster");
      return mine;
    },
    send: (type, payload) => room.send(type, payload),
    close: async () => {
      try {
        await Promise.race([room.leave(true), sleep(1000)]);
      } catch {
        /* already closed */
      }
    },
  };
}

export async function createRoom(port: number, name: string, clientId = newClientId(), avatar = 0): Promise<Player> {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.create(ROOM_TYPE, { name, avatar, clientId }, BlitzState);
  const p = wrap(room as Room<any, BlitzState>, clientId);
  await waitFor(() => Object.keys(p.snap().players).length === 1);
  return p;
}

export async function joinRoom(port: number, code: string, name: string, clientId = newClientId(), avatar = 1): Promise<Player> {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinById(code, { name, avatar, clientId }, BlitzState);
  const p = wrap(room as Room<any, BlitzState>, clientId);
  await waitFor(() => Object.values(p.snap().players).some((x) => x.sid === room.sessionId));
  return p;
}

export async function waitFor(cond: () => boolean, timeoutMs = 8000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for ${label}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
