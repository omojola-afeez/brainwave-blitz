import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import { ROOM_TYPE } from "../../src/shared/constants";
import { MSG } from "../../src/shared/schemas";
import type { Running } from "../../src/server/app";
import { activeRoomCount } from "../../src/server/metrics";
import { BlitzState } from "../../src/shared/state";
import { createRoom, joinRoom, newClientId, sleep, startTestServer, waitFor } from "./harness";

let srv: Running;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.stop();
});

async function expectJoinError(code: string, options: Record<string, unknown>, match: RegExp) {
  const client = new Client(`ws://127.0.0.1:${srv.port}`);
  await expect(client.joinById(code, options, BlitzState)).rejects.toThrow(match);
}

describe("room creation and joining", () => {
  it("creates rooms with distinct, well-formed codes", async () => {
    const players = await Promise.all(Array.from({ length: 8 }, (_, i) => createRoom(srv.port, `Host${i}`)));
    const codes = players.map((p) => p.snap().code);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    await Promise.all(players.map((p) => p.close()));
  });

  it("shows every joiner to everyone without a refresh, with the creator as host", async () => {
    const a = await createRoom(srv.port, "Ada");
    const code = a.snap().code;
    const b = await joinRoom(srv.port, code, "Bola");
    const c = await joinRoom(srv.port, code, "Chidi");
    for (const p of [a, b, c]) {
      await waitFor(() => Object.keys(p.snap().players).length === 3, 5000, "3 players");
    }
    const names = (p: typeof a) => Object.values(p.snap().players).map((x) => x.name).sort();
    expect(names(a)).toEqual(["Ada", "Bola", "Chidi"]);
    expect(names(b)).toEqual(names(a));
    expect(a.me().isHost).toBe(true);
    expect(b.me().isHost).toBe(false);
    expect(a.snap().hostId).toBe(a.me().id);
    await Promise.all([a, b, c].map((p) => p.close()));
  });

  it("keeps two rooms completely separate", async () => {
    const a1 = await createRoom(srv.port, "A1");
    const a2 = await joinRoom(srv.port, a1.snap().code, "A2");
    const b1 = await createRoom(srv.port, "B1");
    a2.send(MSG.setReady, { ready: true });
    await waitFor(() => Object.values(a1.snap().players).find((p) => p.name === "A2")?.ready === true);
    expect(Object.keys(b1.snap().players)).toHaveLength(1);
    expect(b1.snap().code).not.toBe(a1.snap().code);
    expect(Object.values(b1.snap().players).map((p) => p.name)).toEqual(["B1"]);
    await Promise.all([a1, a2, b1].map((p) => p.close()));
  });

  it("rejects an unknown room code", async () => {
    await expectJoinError("ZZZZZ", { name: "Lost", avatar: 0, clientId: newClientId() }, /not found|ZZZZZ/i);
  });

  it("rejects bad names and unknown fields before the room sees them", async () => {
    const a = await createRoom(srv.port, "Host");
    const code = a.snap().code;
    await expectJoinError(code, { name: "<script>", avatar: 0, clientId: newClientId() }, /BAD_NAME/);
    await expectJoinError(code, { name: "", avatar: 0, clientId: newClientId() }, /BAD_NAME/);
    await expectJoinError(code, { name: "Ok", avatar: 0, clientId: newClientId(), isHost: true }, /BAD_NAME/);
    await expectJoinError(code, { name: "Ok", avatar: 0 }, /BAD_NAME/);
    expect(Object.keys(a.snap().players)).toHaveLength(1);
    await a.close();
  });

  it("returns a clear error when the room is full", async () => {
    const a = await createRoom(srv.port, "Host");
    const code = a.snap().code;
    a.send(MSG.setSettings, { maxPlayers: 2 });
    await waitFor(() => a.snap().maxPlayers === 2);
    const b = await joinRoom(srv.port, code, "Second");
    await expectJoinError(code, { name: "Third", avatar: 0, clientId: newClientId() }, /ROOM_FULL/);
    await waitFor(() => Object.keys(a.snap().players).length === 2);
    expect(Object.keys(a.snap().players)).toHaveLength(2);
    await a.close();
    await b.close();
  });

  it("fills a 12 player room and refuses the 13th", async () => {
    const a = await createRoom(srv.port, "Host");
    const code = a.snap().code;
    const others = [];
    for (let i = 0; i < 11; i++) others.push(await joinRoom(srv.port, code, `P${i + 2}`));
    await waitFor(() => Object.keys(a.snap().players).length === 12);
    await expectJoinError(code, { name: "Late", avatar: 0, clientId: newClientId() }, /ROOM_FULL/);
    await Promise.all([a, ...others].map((p) => p.close()));
  });

  it("gives duplicate names a suffix instead of two identical entries", async () => {
    const a = await createRoom(srv.port, "Sam");
    const b = await joinRoom(srv.port, a.snap().code, "Sam");
    await waitFor(() => Object.keys(a.snap().players).length === 2);
    expect(Object.values(a.snap().players).map((p) => p.name).sort()).toEqual(["Sam", "Sam 2"]);
    await a.close();
    await b.close();
  });

  it("replaces the old connection when the same browser joins twice", async () => {
    const a = await createRoom(srv.port, "Host");
    const code = a.snap().code;
    const cid = newClientId();
    const first = await joinRoom(srv.port, code, "Twin", cid);
    const second = await joinRoom(srv.port, code, "Twin", cid);
    await sleep(200);
    expect(Object.keys(a.snap().players)).toHaveLength(2);
    expect(Object.values(a.snap().players).every((p) => p.connected)).toBe(true);
    expect(second.me().connected).toBe(true);
    await Promise.all([a, first, second].map((p) => p.close()));
  });

  it("refuses new players once a match has started", async () => {
    const a = await createRoom(srv.port, "Host");
    const code = a.snap().code;
    const b = await joinRoom(srv.port, code, "Bola");
    b.send(MSG.setReady, { ready: true });
    await waitFor(() => Object.values(a.snap().players).every((p) => p.ready));
    a.send(MSG.startMatch);
    await waitFor(() => a.snap().phase === "COUNTDOWN");
    await expectJoinError(code, { name: "Late", avatar: 0, clientId: newClientId() }, /MATCH_IN_PROGRESS/);
    await a.close();
    await b.close();
  });
});

describe("host authority", () => {
  it("ignores settings and start from non-hosts and reports why", async () => {
    const a = await createRoom(srv.port, "Host");
    const b = await joinRoom(srv.port, a.snap().code, "Guest");
    b.send(MSG.setReady, { ready: true });
    b.send(MSG.setSettings, { rounds: 5, category: "science" });
    b.send(MSG.startMatch);
    await waitFor(() => b.rejected.length >= 2);
    expect(b.rejected.map((r) => r.reason)).toEqual(["NOT_HOST", "NOT_HOST"]);
    expect(a.snap().rounds).toBe(10);
    expect(a.snap().category).toBe("mixed");
    expect(a.snap().phase).toBe("LOBBY");
    await a.close();
    await b.close();
  });

  it("applies valid host settings to every client", async () => {
    const a = await createRoom(srv.port, "Host");
    const b = await joinRoom(srv.port, a.snap().code, "Guest");
    a.send(MSG.setSettings, { rounds: 5, category: "science", questionSeconds: 10 });
    await waitFor(() => b.snap().rounds === 5 && b.snap().category === "science" && b.snap().questionSeconds === 10);
    await a.close();
    await b.close();
  });

  it("rejects malformed settings and keeps the old values", async () => {
    const a = await createRoom(srv.port, "Host");
    a.send(MSG.setSettings, { rounds: 7 });
    a.send(MSG.setSettings, { category: "cooking" });
    a.send(MSG.setSettings, { rounds: "10" });
    a.send(MSG.setSettings, {});
    await waitFor(() => a.rejected.length >= 4);
    expect(a.rejected.every((r) => r.reason === "BAD_REQUEST")).toBe(true);
    expect(a.snap().rounds).toBe(10);
    await a.close();
  });

  it("will not start with one player or with someone not ready", async () => {
    const a = await createRoom(srv.port, "Host");
    a.send(MSG.startMatch);
    await waitFor(() => a.rejected.length === 1);
    expect(a.rejected[0]!.reason).toBe("NOT_ENOUGH_PLAYERS");
    const b = await joinRoom(srv.port, a.snap().code, "Guest");
    a.send(MSG.startMatch);
    await waitFor(() => a.rejected.length === 2);
    expect(a.rejected[1]!.reason).toBe("NOT_READY");
    expect(a.snap().phase).toBe("LOBBY");
    await a.close();
    await b.close();
  });

  it("passes the host role on when the host leaves", async () => {
    const a = await createRoom(srv.port, "Host");
    const b = await joinRoom(srv.port, a.snap().code, "Second");
    const c = await joinRoom(srv.port, a.snap().code, "Third");
    await waitFor(() => Object.keys(c.snap().players).length === 3);
    await a.close();
    await waitFor(() => b.me().isHost);
    expect(c.me().isHost).toBe(false);
    expect(Object.keys(b.snap().players)).toHaveLength(2);
    expect(b.snap().hostId).toBe(b.me().id);
    b.send(MSG.setSettings, { rounds: 5 });
    await waitFor(() => c.snap().rounds === 5);
    await b.close();
    await c.close();
  });

  it("does not trust ids in the payload: a guest cannot act as the host", async () => {
    const a = await createRoom(srv.port, "Host");
    const b = await joinRoom(srv.port, a.snap().code, "Guest");
    b.send(MSG.setSettings, { rounds: 5, hostId: a.me().id } as never);
    await waitFor(() => b.rejected.length === 1);
    expect(a.snap().rounds).toBe(10);
    await a.close();
    await b.close();
  });
});

describe("lifecycle and cleanup", () => {
  it("disposes a room when everyone leaves", async () => {
    const before = activeRoomCount();
    const a = await createRoom(srv.port, "Solo");
    expect(activeRoomCount()).toBe(before + 1);
    await a.close();
    await waitFor(() => activeRoomCount() === before, 8000, "room disposal");
  });

  it("exposes health and metrics", async () => {
    const h = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
    expect(h.status).toBe(200);
    expect(await h.json()).toEqual({ ok: true });
    const m = await (await fetch(`http://127.0.0.1:${srv.port}/api/metrics`)).json();
    expect(m).toHaveProperty("activeRooms");
    expect(m).toHaveProperty("counters.matchesCompleted");
    expect(JSON.stringify(m)).not.toMatch(/clientId|token/i);
  });

  it("rejects cross-site matchmaking requests", async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/matchmake/joinById/ABCDE`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});
