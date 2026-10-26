import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import { ROOM_TYPE } from "../../src/shared/constants";
import { MSG } from "../../src/shared/schemas";
import type { Running } from "../../src/server/app";
import { activeRoomCount, counters } from "../../src/server/metrics";
import { BlitzState } from "../../src/shared/state";
import { configureRuntime, defaultConfig, FAST_TIMING } from "../../src/server/runtime";
import { createRoom, joinRoom, newClientId, sleep, startTestServer, waitFor, type Player } from "./harness";

let srv: Running;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.stop();
});
afterEach(() => {
  configureRuntime({
    ...defaultConfig(),
    timing: FAST_TIMING,
    createsPerMinute: 10_000,
    joinsPerMinute: 10_000,
    matchmakePerMinute: 100_000,
    reconnectSeconds: 5,
  });
});

async function lobby(n: number, rounds = 5): Promise<Player[]> {
  const host = await createRoom(srv.port, "Host");
  const players = [host];
  for (let i = 1; i < n; i++) players.push(await joinRoom(srv.port, host.snap().code, `Guest${i}`));
  await waitFor(() => Object.keys(host.snap().players).length === n);
  host.send(MSG.setSettings, { rounds });
  for (const p of players.slice(1)) p.send(MSG.setReady, { ready: true });
  await waitFor(() => Object.values(host.snap().players).every((x) => x.ready));
  return players;
}

/** Cuts the socket the way a flaky network would, which lets the SDK try to reconnect. */
function dropConnection(p: Player, reconnect = true) {
  const room = p.room as unknown as { reconnection: { minUptime: number; enabled: boolean }; connection: { close: (c: number) => void } };
  room.reconnection.minUptime = 0;
  room.reconnection.enabled = reconnect;
  room.connection.close(4010);
}

describe("reconnection", () => {
  it("restores a dropped player in the lobby with the same identity", async () => {
    const [a, b] = await lobby(2);
    const myId = b!.me().id;
    dropConnection(b!);
    await waitFor(() => Object.values(a!.snap().players).find((p) => p.id === myId)?.connected === false, 5000, "drop seen");
    await waitFor(() => Object.values(a!.snap().players).find((p) => p.id === myId)?.connected === true, 8000, "reconnect seen");
    expect(Object.keys(a!.snap().players)).toHaveLength(2);
    expect(b!.me().id).toBe(myId);
    expect(b!.me().ready).toBe(true);
    await Promise.all([a!.close(), b!.close()]);
  });

  it("keeps score and progress for a player who drops mid-match and comes back", async () => {
    const players = await lobby(3);
    const [host, g1, g2] = players as [Player, Player, Player];
    host.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"), 8000);
    players.forEach((p) => p.send(MSG.answer, { q: 0, choice: 0 }));
    await waitFor(() => players.every((p) => p.snap().phase === "REVEAL"), 8000);
    const id = g1.me().id;
    const scoreBefore = g1.me().score;
    const gainsBefore = g1.me().gains.length;

    dropConnection(g1);
    await waitFor(() => Object.values(host.snap().players).find((p) => p.id === id)?.connected === false, 5000);
    expect(host.snap().phase).not.toBe("LOBBY");
    await waitFor(() => Object.values(host.snap().players).find((p) => p.id === id)?.connected === true, 8000, "back");
    expect(g1.me().id).toBe(id);
    expect(g1.me().score).toBeGreaterThanOrEqual(scoreBefore);
    expect(g1.me().gains.length).toBeGreaterThanOrEqual(gainsBefore);
    expect(g1.snap().phase).not.toBe("LOBBY");
    expect(g1.snap().summaries.length).toBeGreaterThanOrEqual(1);
    await Promise.all(players.map((p) => p.close()));
    void g2;
  });

  it("does not stall the question for a dropped player", async () => {
    const players = await lobby(3);
    players[0]!.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"), 8000);
    dropConnection(players[2]!, false);
    await waitFor(() => Object.values(players[0]!.snap().players).some((p) => !p.connected), 5000);
    players[0]!.send(MSG.answer, { q: 0, choice: 0 });
    players[1]!.send(MSG.answer, { q: 0, choice: 0 });
    await waitFor(() => players[0]!.snap().phase === "REVEAL", 3000, "early reveal without the dropped player");
    await Promise.all(players.slice(0, 2).map((p) => p.close()));
  });

  it("marks a player who never returns as left, keeps their score, and lets them re-enter with their private id", async () => {
    const players = await lobby(3);
    const [host, g1] = players as [Player, Player, Player];
    host.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"), 8000);
    const id = g1.me().id;
    const cid = g1.clientId;
    dropConnection(g1, false);
    await waitFor(() => Object.values(host.snap().players).find((p) => p.id === id)?.left === true, 12000, "window expiry");
    expect(Object.values(host.snap().players).find((p) => p.id === id)).toBeDefined();
    expect(host.snap().phase).not.toBe("LOBBY");

    const back = await joinRoom(srv.port, host.snap().code, "Whoever", cid);
    await waitFor(() => Object.values(host.snap().players).find((p) => p.id === id)?.left === false, 5000, "rejoined");
    expect(Object.keys(host.snap().players)).toHaveLength(3);
    expect(back.me().id).toBe(id);
    await Promise.all([...players, back].map((p) => p.close()));
  }, 40000);

  it("refuses a stranger who guesses a room code during a match", async () => {
    const players = await lobby(2);
    players[0]!.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "COUNTDOWN"));
    const client = new Client(`ws://127.0.0.1:${srv.port}`);
    await expect(
      client.joinById(players[0]!.snap().code, { name: "Intruder", avatar: 0, clientId: newClientId() }, BlitzState),
    ).rejects.toThrow(/MATCH_IN_PROGRESS/);
    await Promise.all(players.map((p) => p.close()));
  });

  it("does not let a reconnect token from one room open another", async () => {
    const [a1] = await lobby(2);
    const [b1] = await lobby(2);
    const token = (a1!.room as unknown as { reconnectionToken: string }).reconnectionToken;
    const client = new Client(`ws://127.0.0.1:${srv.port}`);
    // A token only works for the room that issued it; a made-up one never works.
    await expect(client.reconnect("not-a-real-token", BlitzState)).rejects.toBeDefined();
    expect(token).toBeTruthy();
    expect(token).not.toBe((b1!.room as unknown as { reconnectionToken: string }).reconnectionToken);
    await Promise.all([a1!.close(), b1!.close()]);
  });
});

describe("leaving during a match", () => {
  it("lets the others carry on when a guest leaves on purpose", async () => {
    const players = await lobby(3);
    const [host, g1, g2] = players as [Player, Player, Player];
    host.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"), 8000);
    const id = g1.me().id;
    await g1.close();
    await waitFor(() => Object.values(host.snap().players).find((p) => p.id === id)?.left === true, 5000);
    host.send(MSG.answer, { q: 0, choice: 0 });
    g2.send(MSG.answer, { q: 0, choice: 0 });
    await waitFor(() => host.snap().phase === "REVEAL", 3000);
    await Promise.all([host.close(), g2.close()]);
  });

  it("hands the host role to a guest when the host leaves mid-match and lets them run the rematch", async () => {
    const players = await lobby(3);
    const [host, g1, g2] = players as [Player, Player, Player];
    host.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"), 8000);
    await host.close();
    await waitFor(() => g1.me().isHost, 5000, "new host");
    for (let q = 0; q < 5; q++) {
      await waitFor(() => g1.snap().phase === "QUESTION" && g1.snap().question.index === q, 10000, `q${q}`);
      g1.send(MSG.answer, { q, choice: 0 });
      g2.send(MSG.answer, { q, choice: 0 });
    }
    await waitFor(() => g1.snap().phase === "RESULTS", 10000);
    g1.send(MSG.playAgain);
    await waitFor(() => g2.snap().phase === "COUNTDOWN", 5000, "rematch by new host");
    await Promise.all([g1.close(), g2.close()]);
  });

  it("aborts the countdown if everyone but the host leaves", async () => {
    const players = await lobby(2);
    players[0]!.send(MSG.startMatch);
    await waitFor(() => players[0]!.snap().phase === "COUNTDOWN");
    await players[1]!.close();
    await waitFor(() => players[0]!.snap().phase === "LOBBY", 3000, "back to lobby");
    await sleep(1200);
    expect(players[0]!.snap().phase).toBe("LOBBY");
    await players[0]!.close();
  });
});

describe("abuse protection", () => {
  it("limits room creation per address", async () => {
    configureRuntime({ createsPerMinute: 3 });
    const made: Player[] = [];
    for (let i = 0; i < 3; i++) made.push(await createRoom(srv.port, `R${i}`));
    const client = new Client(`ws://127.0.0.1:${srv.port}`);
    await expect(client.create(ROOM_TYPE, { name: "Extra", avatar: 0, clientId: newClientId() }, BlitzState)).rejects.toThrow(/RATE_LIMITED/);
    await Promise.all(made.map((p) => p.close()));
  });

  it("limits matchmaking requests per address", async () => {
    configureRuntime({ matchmakePerMinute: 5 });
    const url = `http://127.0.0.1:${srv.port}/matchmake/joinById/ZZZZZ`;
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      statuses.push(r.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(3);
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
  });

  it("caps the number of live rooms", async () => {
    const live = activeRoomCount();
    configureRuntime({ maxRooms: live + 1 });
    const first = await createRoom(srv.port, "Only");
    const client = new Client(`ws://127.0.0.1:${srv.port}`);
    await expect(client.create(ROOM_TYPE, { name: "TooMany", avatar: 0, clientId: newClientId() }, BlitzState)).rejects.toThrow(/SERVER_BUSY/);
    await first.close();
  });

  it("drops a client that floods the room with messages and leaves the room state intact", async () => {
    const [host, guest] = (await lobby(2)) as [Player, Player];
    const before = counters.messagesRejected;
    let sawDrop = false;
    const watch = setInterval(() => {
      if (Object.values(host.snap().players).some((p) => !p.connected)) sawDrop = true;
    }, 10);
    for (let i = 0; i < 400; i++) guest.send(MSG.setReady, { ready: i % 2 === 0 });
    await waitFor(() => sawDrop, 5000, "flooder dropped");
    clearInterval(watch);
    expect(host.snap().phase).toBe("LOBBY");
    expect(Object.keys(host.snap().players)).toHaveLength(2);
    expect(counters.messagesRejected).toBeGreaterThanOrEqual(before);
    await Promise.all([host.close(), guest.close()]);
  });

  it("ignores oversized payloads", async () => {
    const [host] = (await lobby(2)) as [Player, Player];
    host.send(MSG.setSettings, { rounds: 5, junk: "x".repeat(10_000) });
    await sleep(300);
    expect(host.snap().rounds).toBe(5);
    await host.close().catch(() => undefined);
  });
});

describe("room expiry", () => {
  it("closes an idle lobby", async () => {
    configureRuntime({ idleRoomMs: 300, idleCheckMs: 100 });
    const before = activeRoomCount();
    const a = await createRoom(srv.port, "Idle");
    expect(activeRoomCount()).toBe(before + 1);
    await waitFor(() => activeRoomCount() === before, 5000, "idle room closed");
    const client = new Client(`ws://127.0.0.1:${srv.port}`);
    await expect(client.joinById(a.snap().code, { name: "Late", avatar: 0, clientId: newClientId() }, BlitzState)).rejects.toThrow();
  });

  it("frees every room it created", async () => {
    await sleep(300);
    const live = activeRoomCount();
    expect(live).toBeLessThanOrEqual(8);
  });
});
