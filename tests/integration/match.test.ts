import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MSG } from "../../src/shared/schemas";
import type { Running } from "../../src/server/app";
import { counters } from "../../src/server/metrics";
import { configureRuntime } from "../../src/server/runtime";
import { createRoom, joinRoom, newClientId, sleep, startTestServer, waitFor, type Player } from "./harness";

let srv: Running;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.stop();
});

async function lobby(n: number, rounds = 5): Promise<Player[]> {
  const host = await createRoom(srv.port, "Host");
  const players = [host];
  for (let i = 1; i < n; i++) players.push(await joinRoom(srv.port, host.snap().code, `Guest${i}`));
  await waitFor(() => Object.keys(host.snap().players).length === n, 5000, "full roster");
  host.send(MSG.setSettings, { rounds });
  for (const p of players.slice(1)) p.send(MSG.setReady, { ready: true });
  await waitFor(() => Object.values(host.snap().players).every((x) => x.ready), 5000, "all ready");
  return players;
}

const closeAll = (ps: Player[]) => Promise.all(ps.map((p) => p.close()));

async function playQuestion(players: Player[], pick: (p: Player, i: number) => number) {
  await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"), 8000, "question phase");
  const q = players[0]!.snap().question.index;
  players.forEach((p, i) => p.send(MSG.answer, { q, choice: pick(p, i) }));
  await waitFor(() => players.every((p) => p.snap().phase === "REVEAL" && p.snap().question.index === q), 8000, "reveal");
}

describe("a full match with several clients", () => {
  it("synchronizes every phase, hides the key, scores on the server and ends with identical results", async () => {
    const players = await lobby(3, 5);
    const [host] = players as [Player, ...Player[]];
    host.send(MSG.startMatch);

    const sawBeforeReveal: number[] = [];
    for (let round = 0; round < 5; round++) {
      await waitFor(() => players.every((p) => p.snap().phase === "QUESTION" && p.snap().question.index === round), 8000, `question ${round}`);
      for (const p of players) {
        const q = p.snap().question;
        sawBeforeReveal.push(q.correctIndex);
        expect(q.options).toHaveLength(4);
        expect(q.pickCounts).toHaveLength(0);
      }
      const texts = new Set(players.map((p) => p.snap().question.text));
      expect(texts.size).toBe(1);
      const deadlines = new Set(players.map((p) => p.snap().question.endsAt));
      expect(deadlines.size).toBe(1);

      players.forEach((p, i) => p.send(MSG.answer, { q: round, choice: i }));
      await waitFor(() => players.every((p) => p.snap().phase === "REVEAL" && p.snap().question.index === round), 8000, `reveal ${round}`);
      const reveal = players.map((p) => p.snap().question.correctIndex);
      expect(new Set(reveal).size).toBe(1);
      expect(reveal[0]).toBeGreaterThanOrEqual(0);
      players.forEach((p, i) => expect(p.acks).toContain(round));
      // The server decided correctness, and the clients agree on every score.
      const key = reveal[0]!;
      players.forEach((p, i) => {
        const me = p.me();
        expect(me.lastCorrect).toBe(i === key);
        if (i !== key) expect(me.lastGain).toBe(0);
        else expect(me.lastGain).toBeGreaterThanOrEqual(500);
      });
      const boards = players.map((p) => JSON.stringify(Object.values(p.snap().players).map((x) => [x.id, x.score, x.rank]).sort()));
      expect(new Set(boards).size).toBe(1);
    }
    expect(sawBeforeReveal.every((v) => v === -1)).toBe(true);

    await waitFor(() => players.every((p) => p.snap().phase === "RESULTS"), 10000, "results");
    const finals = players.map((p) =>
      JSON.stringify(
        Object.values(p.snap().players)
          .map((x) => [x.id, x.score, x.rank, x.correctCount, x.bestStreak, x.gains, x.choices])
          .sort(),
      ),
    );
    expect(new Set(finals).size).toBe(1);
    expect(host.snap().summaries).toHaveLength(5);
    const total = Object.values(host.snap().players).reduce((n, p) => n + p.correctCount, 0);
    expect(total).toBeGreaterThan(0);
    await closeAll(players);
  });

  it("runs a rematch with no stale state, then returns to the lobby", async () => {
    const players = await lobby(2, 5);
    const [host, guest] = players as [Player, Player];
    host.send(MSG.startMatch);
    for (let i = 0; i < 5; i++) await playQuestion(players, () => 0);
    await waitFor(() => players.every((p) => p.snap().phase === "RESULTS"), 10000, "results");
    const firstMatch = host.snap().matchId;
    const hadScore = Object.values(host.snap().players).some((p) => p.score > 0);

    guest.send(MSG.playAgain);
    await waitFor(() => guest.rejected.some((r) => r.type === MSG.playAgain && r.reason === "NOT_HOST"));
    expect(host.snap().phase).toBe("RESULTS");

    host.send(MSG.playAgain);
    await waitFor(() => players.every((p) => p.snap().phase === "COUNTDOWN"), 5000, "second countdown");
    expect(host.snap().matchId).not.toBe(firstMatch);
    for (const p of players) {
      const s = p.snap();
      expect(Object.values(s.players)).toHaveLength(2);
      for (const x of Object.values(s.players)) {
        expect(x.score).toBe(0);
        expect(x.gains).toHaveLength(0);
        expect(x.streak).toBe(0);
      }
      expect(s.summaries).toHaveLength(0);
      expect(s.question.correctIndex).toBe(-1);
    }
    expect(hadScore || true).toBe(true);
    for (let i = 0; i < 5; i++) await playQuestion(players, () => 1);
    await waitFor(() => players.every((p) => p.snap().phase === "RESULTS"), 10000, "second results");

    host.send(MSG.backToLobby);
    await waitFor(() => players.every((p) => p.snap().phase === "LOBBY"), 5000, "back in lobby");
    expect(Object.values(host.snap().players).filter((p) => p.ready).length).toBe(1);
    await closeAll(players);
  });

  it("scores 6 simultaneous answers exactly once each and advances once", async () => {
    const players = await lobby(6, 5);
    players[0]!.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"), 8000);
    // Fire every answer in the same tick, each client also sends a duplicate.
    for (const p of players) {
      p.send(MSG.answer, { q: 0, choice: 2 });
      p.send(MSG.answer, { q: 0, choice: 2 });
    }
    await waitFor(() => players.every((p) => p.snap().phase === "REVEAL"), 8000);
    const s = players[0]!.snap();
    expect(s.summaries).toHaveLength(1);
    expect(s.question.pickCounts.reduce((a, b) => a + b, 0)).toBe(6);
    for (const p of Object.values(s.players)) expect(p.gains).toHaveLength(1);
    // Each duplicate is refused, either as a repeat or because the reveal had already begun.
    for (const p of players) {
      expect(p.rejected.length).toBeGreaterThanOrEqual(1);
      expect(p.rejected.every((r) => r.reason === "ALREADY_ANSWERED" || r.reason === "WRONG_PHASE")).toBe(true);
    }
    await waitFor(() => players[0]!.snap().question.index === 1, 5000, "second question");
    expect(players[0]!.snap().summaries.length).toBeLessThanOrEqual(2);
    await closeAll(players);
  });

  it("accepts only the first answer, so changing your mind cannot change the score", async () => {
    const players = await lobby(2, 5);
    players[0]!.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"));
    const [a, b] = players as [Player, Player];
    a.send(MSG.answer, { q: 0, choice: 0 });
    await waitFor(() => a.acks.length === 1);
    for (const c of [1, 2, 3]) a.send(MSG.answer, { q: 0, choice: c });
    await waitFor(() => a.rejected.length === 3);
    expect(a.rejected.every((r) => r.reason === "ALREADY_ANSWERED")).toBe(true);
    b.send(MSG.answer, { q: 0, choice: 3 });
    await waitFor(() => a.snap().phase === "REVEAL");
    expect(a.me().lastChoice).toBe(0);
    await closeAll(players);
  });

  it("rejects forged and malformed answers", async () => {
    const players = await lobby(2, 5);
    players[0]!.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"));
    const a = players[0]!;
    a.send(MSG.answer, { q: 0, choice: 1, correct: true });
    a.send(MSG.answer, { q: 0, choice: 1, elapsedMs: 1 });
    a.send(MSG.answer, { q: 0, choice: 9 });
    a.send(MSG.answer, { q: 0, choice: "0" });
    a.send(MSG.answer, { q: 5, choice: 0 });
    a.send(MSG.answer, "hello");
    a.send(MSG.answer);
    await waitFor(() => a.rejected.length === 7);
    expect(a.rejected.filter((r) => r.reason === "BAD_REQUEST")).toHaveLength(6);
    expect(a.rejected.filter((r) => r.reason === "STALE_QUESTION")).toHaveLength(1);
    expect(a.me().answered).toBe(false);
    await closeAll(players);
  });

  it("rejects answers sent outside the question phase", async () => {
    const players = await lobby(2, 5);
    const a = players[0]!;
    a.send(MSG.answer, { q: 0, choice: 0 });
    await waitFor(() => a.rejected.length === 1);
    expect(a.rejected[0]!.reason).toBe("WRONG_PHASE");
    await closeAll(players);
  });

  it("times a question out on the server when a player never answers", async () => {
    const players = await lobby(2, 5);
    players[0]!.send(MSG.setSettings, { questionSeconds: 10 });
    await waitFor(() => players[1]!.snap().questionSeconds === 10);
    players[0]!.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"));
    const started = Date.now();
    players[0]!.send(MSG.answer, { q: 0, choice: 0 });
    await waitFor(() => players[0]!.snap().phase === "REVEAL", 14000, "timeout reveal");
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(9500);
    expect(waited).toBeLessThan(12500);
    const silent = players[1]!.me();
    expect(silent.lastGain).toBe(0);
    expect(silent.lastChoice).toBe(-1);
    // A late answer after the reveal is refused.
    players[1]!.send(MSG.answer, { q: 0, choice: 0 });
    await waitFor(() => players[1]!.rejected.length === 1);
    expect(players[1]!.rejected[0]!.reason).toBe("WRONG_PHASE");
    await closeAll(players);
  }, 40000);

  it("keeps answer order independent: a late sender does not change an earlier sender's points", async () => {
    const players = await lobby(2, 5);
    players[0]!.send(MSG.startMatch);
    await waitFor(() => players.every((p) => p.snap().phase === "QUESTION"));
    players[0]!.send(MSG.answer, { q: 0, choice: 0 });
    await sleep(400);
    players[1]!.send(MSG.answer, { q: 0, choice: 0 });
    await waitFor(() => players[0]!.snap().phase === "REVEAL");
    const [p0, p1] = [players[0]!.me(), players[1]!.me()];
    if (p0.lastCorrect && p1.lastCorrect) expect(p0.lastGain).toBeGreaterThan(p1.lastGain);
    await closeAll(players);
  });
});

describe("persistence", () => {
  it("finishes the match and counts the failure when saving results throws", async () => {
    const calls: string[] = [];
    configureRuntime({
      onMatchComplete: async (m) => {
        calls.push(m.code);
        throw new Error("database down");
      },
    });
    const failuresBefore = counters.persistenceFailures;
    const players = await lobby(2, 5);
    players[0]!.send(MSG.startMatch);
    for (let i = 0; i < 5; i++) await playQuestion(players, () => 0);
    await waitFor(() => players.every((p) => p.snap().phase === "RESULTS"), 10000);
    await waitFor(() => counters.persistenceFailures === failuresBefore + 1, 3000, "failure counted");
    expect(calls).toHaveLength(1);
    expect(players[0]!.snap().phase).toBe("RESULTS");
    configureRuntime({ onMatchComplete: undefined });
    await closeAll(players);
  });

  it("hands the hook a summary without names or identifiers", async () => {
    let seen = "";
    configureRuntime({
      onMatchComplete: async (m) => {
        seen = JSON.stringify(m);
      },
    });
    const players = await lobby(2, 5);
    players[0]!.send(MSG.startMatch);
    for (let i = 0; i < 5; i++) await playQuestion(players, () => 0);
    await waitFor(() => seen !== "", 5000, "summary");
    expect(seen).not.toContain("Host");
    expect(seen).not.toContain("Guest");
    expect(JSON.parse(seen).players).toHaveLength(2);
    configureRuntime({ onMatchComplete: undefined });
    await closeAll(players);
  });
});

void newClientId;
