import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MSG } from "../../src/shared/schemas";
import type { Running } from "../../src/server/app";
import { createRoom, joinRoom, startTestServer, waitFor, type Player } from "./harness";

let srv: Running;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.stop();
});

const closeAll = (ps: Player[]) => Promise.all(ps.map((p) => p.close()));

async function roster(n: number): Promise<Player[]> {
  const host = await createRoom(srv.port, "Host");
  const players = [host];
  for (let i = 1; i < n; i++) players.push(await joinRoom(srv.port, host.snap().code, `Guest${i}`));
  await waitFor(() => Object.keys(host.snap().players).length === n, 5000, "full roster");
  return players;
}

describe("team mode over real connections", () => {
  it("splits teams, enforces both teams present, plays a match and ends with identical team results", async () => {
    const players = await roster(4);
    const [host, g1, g2, g3] = players as [Player, Player, Player, Player];
    host.send(MSG.setSettings, { mode: "teams", rounds: 5 });
    await waitFor(() => players.every((p) => p.snap().mode === "teams"), 5000, "mode synced");

    const teamsOf = (p: Player) =>
      Object.values(p.snap().players)
        .sort((a, b) => a.order - b.order)
        .map((x) => x.team);
    await waitFor(() => players.every((p) => teamsOf(p).join() === "1,2,1,2"), 5000, "split synced");

    // Everyone on one team: the host cannot start.
    for (const p of [g1, g3]) p.send(MSG.setTeam, { team: 1 });
    await waitFor(() => teamsOf(host).join() === "1,1,1,1", 5000, "all on team A");
    for (const p of [g1, g2, g3]) p.send(MSG.setReady, { ready: true });
    await waitFor(() => Object.values(host.snap().players).every((x) => x.ready), 5000, "ready");
    host.send(MSG.startMatch);
    await waitFor(() => host.rejected.some((r) => r.reason === "NEED_BOTH_TEAMS"), 5000, "rejection");
    expect(host.snap().phase).toBe("LOBBY");

    g1.send(MSG.setTeam, { team: 2 });
    g3.send(MSG.setTeam, { team: 2 });
    await waitFor(() => teamsOf(host).join() === "1,2,1,2", 5000, "balanced again");

    host.send(MSG.startMatch);
    for (let round = 0; round < 5; round++) {
      await waitFor(() => players.every((p) => p.snap().phase === "QUESTION" && p.snap().question.index === round), 8000, `question ${round}`);
      // Team A (host, g2) always guess option 0; team B guesses wrong on purpose using the reveal later. Just answer.
      players.forEach((p, i) => p.send(MSG.answer, { q: round, choice: i % 4 }));
      await waitFor(() => players.every((p) => p.snap().phase === "REVEAL" && p.snap().question.index === round), 8000, `reveal ${round}`);
    }
    await waitFor(() => players.every((p) => p.snap().phase === "RESULTS"), 20000, "results");

    const finals = players.map((p) => JSON.stringify(p.snap().teams));
    expect(new Set(finals).size).toBe(1);
    const teams = host.snap().teams;
    expect(teams).toHaveLength(2);
    expect(teams[0]!.members).toBe(2);
    expect(teams[1]!.members).toBe(2);
    const sumA = Object.values(host.snap().players).filter((x) => x.team === 1).reduce((a, x) => a + x.score, 0);
    expect(teams[0]!.total).toBe(sumA);
    expect(teams[0]!.score).toBe(Math.round(sumA / 2));
    expect([1, 2]).toContain(teams[0]!.rank);
    await closeAll(players);
  });

  it("rejects a team change in solo mode and a bad team value", async () => {
    const players = await roster(2);
    const [host, guest] = players as [Player, Player];
    guest.send(MSG.setTeam, { team: 2 });
    await waitFor(() => guest.rejected.some((r) => r.reason === "NOT_TEAM_MODE"), 5000, "solo rejection");
    host.send(MSG.setTeam, { team: 3 });
    await waitFor(() => host.rejected.some((r) => r.reason === "BAD_REQUEST"), 5000, "bad value");
    host.send(MSG.setSettings, { mode: "chaos" });
    await waitFor(() => host.rejected.filter((r) => r.reason === "BAD_REQUEST").length >= 2, 5000, "bad mode");
    expect(host.snap().mode).toBe("solo");
    await closeAll(players);
  });
});

describe("region sets over real connections", () => {
  it("a Nigeria match asks only Nigeria questions and the answers stay hidden", async () => {
    const players = await roster(2);
    const [host, guest] = players as [Player, Player];
    host.send(MSG.setSettings, { category: "nigeria", rounds: 5 });
    guest.send(MSG.setReady, { ready: true });
    await waitFor(() => guest.snap().category === "nigeria" && Object.values(host.snap().players).every((x) => x.ready), 5000, "ready");
    host.send(MSG.startMatch);
    for (let round = 0; round < 5; round++) {
      await waitFor(() => players.every((p) => p.snap().phase === "QUESTION" && p.snap().question.index === round), 8000, `q${round}`);
      expect(guest.snap().question.category).toBe("nigeria");
      expect(guest.snap().question.correctIndex).toBe(-1);
      players.forEach((p) => p.send(MSG.answer, { q: round, choice: 0 }));
      await waitFor(() => players.every((p) => p.snap().phase === "REVEAL" && p.snap().question.index === round), 8000, `r${round}`);
    }
    await closeAll(players);
  });
});
