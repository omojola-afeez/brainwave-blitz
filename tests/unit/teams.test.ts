import { describe, expect, it } from "vitest";
import { lobbyOf, makeHarness, toNextQuestion, TEST_TIMING, type Harness } from "./helpers";

const teamOf = (h: Harness, id: string) => h.engine.getPlayer(id)?.team;
const teamRow = (h: Harness, id: 1 | 2) => {
  const row = h.state.teams[id - 1];
  if (!row) throw new Error("missing team row");
  return row;
};

function teamsLobby(n: number): Harness {
  const h = makeHarness();
  lobbyOf(h, n);
  h.engine.updateSettings("p1", { mode: "teams" });
  return h;
}

describe("team lobby", () => {
  it("starts in solo mode with no teams", () => {
    const h = makeHarness();
    lobbyOf(h, 3);
    expect(h.state.mode).toBe("solo");
    expect(["p1", "p2", "p3"].map((id) => teamOf(h, id))).toEqual([0, 0, 0]);
    expect(teamRow(h, 1).members).toBe(0);
  });
  it("splits players evenly in join order when teams turn on", () => {
    const h = teamsLobby(5);
    expect(["p1", "p2", "p3", "p4", "p5"].map((id) => teamOf(h, id))).toEqual([1, 2, 1, 2, 1]);
    expect(teamRow(h, 1).members).toBe(3);
    expect(teamRow(h, 2).members).toBe(2);
  });
  it("puts a new player on the smaller team", () => {
    const h = teamsLobby(3);
    h.engine.addPlayer("p4", "Player 4", 0);
    expect(teamOf(h, "p4")).toBe(2);
    h.engine.addPlayer("p5", "Player 5", 0);
    expect(teamOf(h, "p5")).toBe(1);
  });
  it("lets a player switch team in the lobby", () => {
    const h = teamsLobby(4);
    expect(h.engine.setTeam("p1", 2)).toEqual({ ok: true });
    expect(teamOf(h, "p1")).toBe(2);
    expect(teamRow(h, 2).members).toBe(3);
  });
  it("refuses team changes in solo mode, for unknown players and after the match starts", () => {
    const solo = makeHarness();
    lobbyOf(solo, 2);
    expect(solo.engine.setTeam("p1", 2)).toEqual({ ok: false, reason: "NOT_TEAM_MODE" });

    const h = teamsLobby(2);
    expect(h.engine.setTeam("ghost", 1)).toEqual({ ok: false, reason: "UNKNOWN_PLAYER" });
    h.engine.start("p1");
    expect(h.engine.setTeam("p2", 1)).toEqual({ ok: false, reason: "WRONG_PHASE" });
  });
  it("clears teams when the host goes back to solo", () => {
    const h = teamsLobby(4);
    h.engine.updateSettings("p1", { mode: "solo" });
    expect(["p1", "p2", "p3", "p4"].map((id) => teamOf(h, id))).toEqual([0, 0, 0, 0]);
    expect(teamRow(h, 1).members + teamRow(h, 2).members).toBe(0);
  });
  it("only the host can change the mode", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    expect(h.engine.updateSettings("p2", { mode: "teams" })).toEqual({ ok: false, reason: "NOT_HOST" });
    expect(h.state.mode).toBe("solo");
  });
});

describe("starting a team match", () => {
  it("needs a connected player on each team", () => {
    const h = teamsLobby(3);
    h.engine.setTeam("p2", 1);
    expect(h.engine.start("p1")).toEqual({ ok: false, reason: "NEED_BOTH_TEAMS" });
    h.engine.setTeam("p2", 2);
    expect(h.engine.start("p1")).toEqual({ ok: true });
  });
  it("does not count a disconnected player as present", () => {
    const h = teamsLobby(3); // p1 A, p2 B, p3 A
    h.engine.setConnected("p2", false);
    expect(h.engine.start("p1")).toEqual({ ok: false, reason: "NEED_BOTH_TEAMS" });
  });
  it("aborts the countdown when a whole team disconnects", () => {
    const h = teamsLobby(3);
    expect(h.engine.start("p1")).toEqual({ ok: true });
    expect(h.state.phase).toBe("COUNTDOWN");
    h.engine.setConnected("p2", false);
    expect(h.state.phase).toBe("LOBBY");
  });
  it("solo matches are not affected by team rules", () => {
    const h = makeHarness();
    lobbyOf(h, 2);
    expect(h.engine.start("p1")).toEqual({ ok: true });
  });
});

describe("team scoring", () => {
  function startMatch(h: Harness, rounds = 5): void {
    h.engine.updateSettings("p1", { rounds });
    expect(h.engine.start("p1")).toEqual({ ok: true });
    h.clock.advance(TEST_TIMING.countdownMs);
  }

  it("ranks the team whose players scored more on average first", () => {
    const h = teamsLobby(5); // A: p1 p3 p5, B: p2 p4
    startMatch(h);
    h.clock.advance(1000);
    for (const id of ["p1", "p3", "p5"]) h.engine.submitAnswer(id, 0, h.correct());
    for (const id of ["p2", "p4"]) h.engine.submitAnswer(id, 0, h.wrong());
    expect(h.state.phase).toBe("REVEAL");
    const each = h.engine.getPlayer("p1")!.score;
    expect(each).toBeGreaterThan(500);
    expect(teamRow(h, 1).total).toBe(each * 3);
    expect(teamRow(h, 1).score).toBe(each);
    expect(teamRow(h, 1).correctCount).toBe(3);
    expect(teamRow(h, 2).score).toBe(0);
    expect(teamRow(h, 1).rank).toBe(1);
    expect(teamRow(h, 2).rank).toBe(2);
  });
  it("uses the average, so a smaller team can win with better players", () => {
    const h = teamsLobby(5); // A has 3, B has 2
    startMatch(h);
    h.clock.advance(1000);
    h.engine.submitAnswer("p1", 0, h.correct());
    for (const id of ["p3", "p5"]) h.engine.submitAnswer(id, 0, h.wrong());
    for (const id of ["p2", "p4"]) h.engine.submitAnswer(id, 0, h.correct());
    const each = h.engine.getPlayer("p1")!.score;
    expect(teamRow(h, 1).total).toBe(each);
    expect(teamRow(h, 2).total).toBe(each * 2);
    expect(teamRow(h, 2).score).toBe(each);
    expect(teamRow(h, 1).score).toBe(Math.round(each / 3));
    expect(teamRow(h, 2).rank).toBe(1);
    expect(teamRow(h, 1).rank).toBe(2);
  });
  it("ties uneven teams whose players all did the same", () => {
    const h = teamsLobby(5);
    startMatch(h);
    h.clock.advance(1000);
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) h.engine.submitAnswer(id, 0, h.correct());
    expect(teamRow(h, 1).score).toBe(teamRow(h, 2).score);
    expect(teamRow(h, 1).rank).toBe(1);
    expect(teamRow(h, 2).rank).toBe(1);
  });
  it("keeps a player who left mid-match in their team's average", () => {
    const h = teamsLobby(4); // A: p1 p3, B: p2 p4
    startMatch(h);
    h.clock.advance(1000);
    for (const id of ["p1", "p3"]) h.engine.submitAnswer(id, 0, h.correct());
    for (const id of ["p2", "p4"]) h.engine.submitAnswer(id, 0, h.wrong());
    const before = teamRow(h, 1).score;
    h.engine.removeOrMarkLeft("p3");
    expect(teamRow(h, 1).members).toBe(2);
    expect(teamRow(h, 1).score).toBe(before);
  });
  it("still ranks individuals inside a team match", () => {
    const h = teamsLobby(4);
    startMatch(h);
    h.clock.advance(1000);
    h.engine.submitAnswer("p1", 0, h.correct());
    for (const id of ["p2", "p3", "p4"]) h.engine.submitAnswer(id, 0, h.wrong());
    expect(h.engine.getPlayer("p1")?.rank).toBe(1);
  });
  it("final team ranks match the last scoreboard, and a rematch keeps teams but zeroes scores", () => {
    const h = teamsLobby(4);
    startMatch(h, 5);
    for (let q = 0; q < 5; q++) {
      for (const id of ["p1", "p3"]) h.engine.submitAnswer(id, q, h.correct());
      for (const id of ["p2", "p4"]) h.engine.submitAnswer(id, q, h.wrong());
      toNextQuestion(h);
    }
    h.clock.advance(60_000);
    expect(h.state.phase).toBe("RESULTS");
    expect(teamRow(h, 1).rank).toBe(1);
    expect(teamRow(h, 2).rank).toBe(2);
    expect(teamRow(h, 1).score).toBeGreaterThan(teamRow(h, 2).score);

    expect(h.engine.backToLobby("p1")).toEqual({ ok: true });
    expect(h.state.phase).toBe("LOBBY");
    expect(h.state.mode).toBe("teams");
    expect(["p1", "p2", "p3", "p4"].map((id) => teamOf(h, id))).toEqual([1, 2, 1, 2]);
    expect(teamRow(h, 1).score).toBe(0);
    expect(teamRow(h, 1).total).toBe(0);
  });
});
