import { describe, expect, it } from "vitest";
import { makeBank, makeHarness, lobbyOf, toNextQuestion, TEST_TIMING } from "./helpers";

describe("lobby rules", () => {
  it("makes the first player host and ready", () => {
    const h = makeHarness();
    h.engine.addPlayer("a", "Ada", 1);
    h.engine.addPlayer("b", "Bola", 2);
    expect(h.state.hostId).toBe("a");
    expect(h.engine.getPlayer("a")?.ready).toBe(true);
    expect(h.engine.getPlayer("b")?.ready).toBe(false);
  });
  it("gives duplicate names a suffix", () => {
    const h = makeHarness();
    h.engine.addPlayer("a", "Ada", 1);
    h.engine.addPlayer("b", "ada", 2);
    expect(h.engine.getPlayer("b")?.name).toBe("ada 2");
  });
  it("rejects joining past the player limit", () => {
    const h = makeHarness();
    h.engine.addPlayer("a", "A", 0);
    h.engine.addPlayer("b", "B", 0);
    h.engine.updateSettings("a", { maxPlayers: 2 });
    expect(h.engine.addPlayer("c", "C", 0)).toEqual({ ok: false, reason: "ROOM_FULL" });
  });
  it("refuses to lower the limit below the current player count", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    expect(h.engine.updateSettings("p1", { maxPlayers: 2 })).toEqual({ ok: false, reason: "TOO_MANY_PLAYERS" });
  });
  it("only the host can change settings or start", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    expect(h.engine.updateSettings("p2", { rounds: 5 })).toEqual({ ok: false, reason: "NOT_HOST" });
    expect(h.engine.start("p2")).toEqual({ ok: false, reason: "NOT_HOST" });
    expect(h.state.rounds).toBe(10);
  });
  it("needs two connected players", () => {
    const h = makeHarness();
    h.engine.addPlayer("a", "A", 0);
    expect(h.engine.start("a")).toEqual({ ok: false, reason: "NOT_ENOUGH_PLAYERS" });
  });
  it("needs every non-host player ready", () => {
    const h = makeHarness();
    h.engine.addPlayer("a", "A", 0);
    h.engine.addPlayer("b", "B", 0);
    expect(h.engine.start("a")).toEqual({ ok: false, reason: "NOT_READY" });
    h.engine.setReady("b", true);
    expect(h.engine.start("a")).toEqual({ ok: true });
  });
  it("keeps the host ready no matter what is requested", () => {
    const h = makeHarness();
    h.engine.addPlayer("a", "A", 0);
    h.engine.setReady("a", false);
    expect(h.engine.getPlayer("a")?.ready).toBe(true);
  });
  it("ignores setting changes once the match has started", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.start("p1");
    expect(h.engine.updateSettings("p1", { rounds: 5 })).toEqual({ ok: false, reason: "WRONG_PHASE" });
  });
});

describe("phases and timers", () => {
  it("walks LOBBY, COUNTDOWN, QUESTION, REVEAL, SCOREBOARD, QUESTION and ends in RESULTS", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.updateSettings("p1", { rounds: 5 });
    h.engine.start("p1");
    const seen: string[] = [h.state.phase];
    const dur = h.state.questionSeconds * 1000;
    let guard = 0;
    while (h.state.phase !== "RESULTS" && guard++ < 100) {
      const before = h.state.phase;
      h.clock.advance(before === "QUESTION" ? dur + TEST_TIMING.answerGraceMs : 5000);
      if (h.state.phase !== seen[seen.length - 1]) seen.push(h.state.phase);
    }
    expect(seen[0]).toBe("COUNTDOWN");
    expect(seen).toContain("QUESTION");
    expect(seen).toContain("REVEAL");
    expect(seen).toContain("SCOREBOARD");
    expect(seen[seen.length - 1]).toBe("RESULTS");
    expect(h.state.summaries.length).toBe(5);
  });
  it("hides the answer key until the reveal", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    expect(h.state.phase).toBe("QUESTION");
    expect(h.state.question.correctIndex).toBe(-1);
    expect(h.state.question.pickCounts.length).toBe(0);
    h.engine.submitAnswer("p1", 0, 0);
    expect(h.state.question.correctIndex).toBe(-1);
    h.clock.advance(h.state.questionSeconds * 1000 + TEST_TIMING.answerGraceMs);
    expect(h.state.phase).toBe("REVEAL");
    expect(h.state.question.correctIndex).toBeGreaterThanOrEqual(0);
  });
  it("sets a server deadline that matches the question length", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.updateSettings("p1", { questionSeconds: 10 });
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    expect(h.state.question.endsAt - h.state.question.startedAt).toBe(10_000);
    expect(h.state.phaseEndsAt).toBe(h.state.question.endsAt);
  });
  it("increases seq on every transition", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.start("p1");
    const a = h.state.seq;
    h.clock.advance(TEST_TIMING.countdownMs);
    expect(h.state.seq).toBeGreaterThan(a);
  });
  it("leaves no timers behind after dispose", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.start("p1");
    h.engine.dispose();
    expect(h.clock.pending()).toBe(0);
    h.clock.advance(60_000);
    expect(h.state.phase).toBe("COUNTDOWN");
  });
  it("never has more than one pending timer", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    h.engine.start("p1");
    for (let i = 0; i < 12; i++) {
      expect(h.clock.pending()).toBeLessThanOrEqual(1);
      h.clock.advance(1500);
    }
  });
});

describe("answers and scoring", () => {
  function inQuestion() {
    const h = makeHarness();
    lobbyOf(h, 3);
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    return h;
  }

  it("scores a fast correct answer and a wrong answer", () => {
    const h = inQuestion();
    h.clock.advance(1000);
    expect(h.engine.submitAnswer("p1", 0, h.correct()).ok).toBe(true);
    expect(h.engine.submitAnswer("p2", 0, h.wrong()).ok).toBe(true);
    h.clock.advance(h.state.questionSeconds * 1000);
    expect(h.state.phase).toBe("REVEAL");
    const dur = h.state.questionSeconds * 1000;
    const speed = Math.round(500 * (1 - 1000 / dur));
    expect(h.engine.getPlayer("p1")?.score).toBe(500 + speed);
    expect(h.engine.getPlayer("p2")?.score).toBe(0);
    expect(h.engine.getPlayer("p3")?.score).toBe(0);
    expect(h.engine.getPlayer("p1")?.lastCorrect).toBe(true);
    expect(h.engine.getPlayer("p1")?.rank).toBe(1);
  });
  it("advances early once every connected player has answered", () => {
    const h = inQuestion();
    for (const id of ["p1", "p2", "p3"]) h.engine.submitAnswer(id, 0, 0);
    expect(h.state.phase).toBe("REVEAL");
    expect(h.state.summaries.length).toBe(1);
  });
  it("does not advance early while a connected player has not answered", () => {
    const h = inQuestion();
    h.engine.submitAnswer("p1", 0, 0);
    h.engine.submitAnswer("p2", 0, 0);
    expect(h.state.phase).toBe("QUESTION");
  });
  it("does not wait for a disconnected player", () => {
    const h = inQuestion();
    h.engine.setConnected("p3", false);
    h.engine.submitAnswer("p1", 0, 0);
    h.engine.submitAnswer("p2", 0, 0);
    expect(h.state.phase).toBe("REVEAL");
  });
  it("advances when the last unanswered player disconnects", () => {
    const h = inQuestion();
    h.engine.submitAnswer("p1", 0, 0);
    h.engine.submitAnswer("p2", 0, 0);
    h.engine.setConnected("p3", false);
    expect(h.state.phase).toBe("REVEAL");
  });
  it("accepts only the first answer from a player", () => {
    const h = inQuestion();
    expect(h.engine.submitAnswer("p1", 0, h.wrong()).ok).toBe(true);
    expect(h.engine.submitAnswer("p1", 0, h.correct())).toEqual({ ok: false, reason: "ALREADY_ANSWERED" });
    h.clock.advance(30_000);
    expect(h.engine.getPlayer("p1")?.lastCorrect).toBe(false);
  });
  it("rejects answers for a stale or future question", () => {
    const h = inQuestion();
    expect(h.engine.submitAnswer("p1", 1, 0)).toEqual({ ok: false, reason: "STALE_QUESTION" });
    expect(h.engine.submitAnswer("p1", -1, 0)).toEqual({ ok: false, reason: "STALE_QUESTION" });
  });
  it("rejects answers from unknown players", () => {
    const h = inQuestion();
    expect(h.engine.submitAnswer("nobody", 0, 0)).toEqual({ ok: false, reason: "UNKNOWN_PLAYER" });
  });
  it("rejects answers outside the question phase", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    expect(h.engine.submitAnswer("p1", 0, 0)).toEqual({ ok: false, reason: "WRONG_PHASE" });
    h.engine.start("p1");
    expect(h.engine.submitAnswer("p1", 0, 0)).toEqual({ ok: false, reason: "WRONG_PHASE" });
  });
  it("accepts an answer inside the grace window and rejects it after", () => {
    const h = inQuestion();
    const dur = h.state.questionSeconds * 1000;
    h.clock.advance(dur + 200);
    expect(h.state.phase).toBe("QUESTION");
    expect(h.engine.submitAnswer("p1", 0, h.correct()).ok).toBe(true);
    h.clock.advance(200);
    expect(h.engine.submitAnswer("p2", 0, h.correct())).toEqual({ ok: false, reason: "WRONG_PHASE" });
    // a correct answer in the grace window earns the base points and no speed bonus
    expect(h.engine.getPlayer("p1")?.score).toBe(500);
  });
  it("gives zero points and resets the streak when nobody answers", () => {
    const h = inQuestion();
    h.engine.submitAnswer("p1", 0, h.correct());
    h.engine.submitAnswer("p2", 0, h.correct());
    h.engine.submitAnswer("p3", 0, h.correct());
    h.clock.advance(TEST_TIMING.revealMs + TEST_TIMING.scoreboardMs);
    expect(h.state.question.index).toBe(1);
    h.clock.advance(30_000);
    expect(h.engine.getPlayer("p1")?.streak).toBe(0);
    expect(h.engine.getPlayer("p1")?.gains[1]).toBe(0);
    expect(h.engine.getPlayer("p1")?.choices[1]).toBe(-1);
  });
  it("builds a streak across questions", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    for (let q = 0; q < 4; q++) {
      h.engine.submitAnswer("p1", q, h.correct());
      h.engine.submitAnswer("p2", q, h.wrong());
      toNextQuestion(h);
    }
    const p1 = h.engine.getPlayer("p1")!;
    expect(p1.streak).toBe(4);
    expect(p1.bestStreak).toBe(4);
    expect(p1.gains.length).toBe(4);
    expect(p1.gains[2]! - 500 - Math.round(500 * 1)).toBe(100);
    expect(p1.gains[3]! - 1000).toBe(200);
  });
  it("counts pick distribution at the reveal", () => {
    const h = inQuestion();
    h.engine.submitAnswer("p1", 0, 2);
    h.engine.submitAnswer("p2", 0, 2);
    h.engine.submitAnswer("p3", 0, 1);
    expect([...h.state.question.pickCounts]).toEqual([0, 1, 2, 0]);
  });
});

describe("match completion", () => {
  function playFull(h: ReturnType<typeof makeHarness>, rounds: number, answer: (q: number) => Array<[string, number]>) {
    h.engine.updateSettings("p1", { rounds });
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    for (let q = 0; q < rounds; q++) {
      for (const [id, choice] of answer(q)) h.engine.submitAnswer(id, q, choice);
      toNextQuestion(h);
    }
  }

  it("reaches RESULTS and reports the match exactly once", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    playFull(h, 5, () => [
      ["p1", h.correct()],
      ["p2", h.wrong()],
    ]);
    h.clock.advance(120_000);
    expect(h.state.phase).toBe("RESULTS");
    expect(h.completed).toHaveLength(1);
    expect(h.completed[0]!.rounds).toBe(5);
    expect(h.completed[0]!.questions).toHaveLength(5);
    expect(h.engine.getPlayer("p1")?.rank).toBe(1);
    expect(h.engine.getPlayer("p2")?.rank).toBe(2);
    expect(h.engine.getPlayer("p1")?.correctCount).toBe(5);
  });
  it("keeps no player names in the persisted summary", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    playFull(h, 5, () => [["p1", 0]]);
    expect(JSON.stringify(h.completed[0])).not.toContain("Player 1");
  });
  it("shares rank 1 when two players tie on everything", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.updateSettings("p1", { rounds: 5 });
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    for (let q = 0; q < 5; q++) {
      h.engine.submitAnswer("p1", q, h.wrong());
      h.engine.submitAnswer("p2", q, h.wrong());
      toNextQuestion(h);
    }
    expect(h.engine.getPlayer("p1")?.rank).toBe(1);
    expect(h.engine.getPlayer("p2")?.rank).toBe(1);
  });
  it("rematch resets scores, history, timers and the match id", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    playFull(h, 5, () => [
      ["p1", h.correct()],
      ["p2", h.correct()],
    ]);
    const firstId = h.state.matchId;
    expect(h.state.phase).toBe("RESULTS");
    expect(h.engine.getPlayer("p1")!.score).toBeGreaterThan(0);

    expect(h.engine.playAgain("p2")).toEqual({ ok: false, reason: "NOT_HOST" });
    expect(h.engine.playAgain("p1")).toEqual({ ok: true });
    expect(h.state.phase).toBe("COUNTDOWN");
    expect(h.state.matchId).not.toBe(firstId);
    for (const id of ["p1", "p2"]) {
      const p = h.engine.getPlayer(id)!;
      expect(p.score).toBe(0);
      expect(p.streak).toBe(0);
      expect(p.bestStreak).toBe(0);
      expect(p.gains.length).toBe(0);
      expect(p.choices.length).toBe(0);
      expect(p.correctCount).toBe(0);
    }
    expect(h.state.summaries.length).toBe(0);
    expect(h.state.question.index).toBe(-1);
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(TEST_TIMING.countdownMs);
    expect(h.state.phase).toBe("QUESTION");
    expect(h.state.question.index).toBe(0);
  });
  it("second match uses fresh questions", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    playFull(h, 5, () => []);
    const first = [...h.state.summaries].map((s) => s.text);
    h.engine.playAgain("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    expect(first).not.toContain(h.state.question.text);
  });
  it("back to lobby clears the match and lets the host change settings", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    playFull(h, 5, () => []);
    expect(h.engine.backToLobby("p1")).toEqual({ ok: true });
    expect(h.state.phase).toBe("LOBBY");
    expect(h.engine.getPlayer("p2")?.ready).toBe(false);
    expect(h.engine.updateSettings("p1", { rounds: 10 }).ok).toBe(true);
  });
  it("only allows play again and back to lobby from RESULTS", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    expect(h.engine.playAgain("p1")).toEqual({ ok: false, reason: "WRONG_PHASE" });
    expect(h.engine.backToLobby("p1")).toEqual({ ok: false, reason: "WRONG_PHASE" });
  });
  it("fails cleanly when the bank is empty", () => {
    const h = makeHarness({ bank: [] });
    lobbyOf(h, 2);
    expect(h.engine.start("p1")).toEqual({ ok: false, reason: "NO_QUESTIONS" });
    expect(h.state.phase).toBe("LOBBY");
  });
  it("uses a smaller pool without crashing", () => {
    const h = makeHarness({ bank: makeBank(6) });
    lobbyOf(h, 2);
    h.engine.updateSettings("p1", { rounds: 10 });
    h.engine.start("p1");
    expect(h.state.question.total).toBe(6);
  });
});

describe("leaving and host transfer", () => {
  it("moves host to the earliest connected player when the host drops", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    h.engine.setConnected("p1", false);
    expect(h.state.hostId).toBe("p2");
    expect(h.engine.getPlayer("p2")?.isHost).toBe(true);
    expect(h.engine.getPlayer("p1")?.isHost).toBe(false);
  });
  it("does not give the role back when the old host returns", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    h.engine.setConnected("p1", false);
    h.engine.setConnected("p1", true);
    expect(h.state.hostId).toBe("p2");
  });
  it("lets the new host start the match", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    h.engine.setConnected("p1", false);
    h.engine.setReady("p3", true);
    expect(h.engine.start("p1")).toEqual({ ok: false, reason: "NOT_HOST" });
    expect(h.engine.start("p2")).toEqual({ ok: true });
  });
  it("removes a player who leaves the lobby", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    h.engine.removeOrMarkLeft("p3");
    expect(h.engine.getPlayer("p3")).toBeUndefined();
  });
  it("keeps a player who leaves mid-match on the board and marks them left", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    h.engine.removeOrMarkLeft("p3");
    const p3 = h.engine.getPlayer("p3")!;
    expect(p3.left).toBe(true);
    expect(h.engine.submitAnswer("p3", 0, 0)).toEqual({ ok: false, reason: "UNKNOWN_PLAYER" });
    h.clock.advance(60_000);
    expect(h.engine.getPlayer("p3")?.gains.length).toBeGreaterThan(0);
  });
  it("drops players who left when the host returns to the lobby", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    h.engine.updateSettings("p1", { rounds: 5 });
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    h.engine.removeOrMarkLeft("p3");
    h.clock.advance(10 * 60_000);
    expect(h.state.phase).toBe("RESULTS");
    h.engine.backToLobby("p1");
    expect(h.engine.getPlayer("p3")).toBeUndefined();
  });
  it("aborts the countdown when too few players remain", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.start("p1");
    expect(h.state.phase).toBe("COUNTDOWN");
    h.engine.setConnected("p2", false);
    expect(h.state.phase).toBe("LOBBY");
    expect(h.clock.pending()).toBe(0);
    h.clock.advance(60_000);
    expect(h.state.phase).toBe("LOBBY");
  });
  it("keeps the match running when everyone is disconnected and records zero for missed questions", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    h.engine.updateSettings("p1", { rounds: 5 });
    h.engine.start("p1");
    h.clock.advance(TEST_TIMING.countdownMs);
    h.engine.setConnected("p1", false);
    h.engine.setConnected("p2", false);
    expect(h.state.phase).toBe("QUESTION");
    h.clock.advance(10 * 60_000);
    expect(h.state.phase).toBe("RESULTS");
    expect(h.engine.getPlayer("p1")?.score).toBe(0);
  });
});
