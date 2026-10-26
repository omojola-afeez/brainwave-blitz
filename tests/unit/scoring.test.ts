import { describe, expect, it } from "vitest";
import { scoreAnswer, speedBonus, streakBonus } from "../../src/server/game/scoring";
import { rankPlayers } from "../../src/server/game/ranking";

describe("speedBonus", () => {
  it("is 500 at zero elapsed time", () => expect(speedBonus(0, 20000)).toBe(500));
  it("is 0 at the deadline", () => expect(speedBonus(20000, 20000)).toBe(0));
  it("is 250 at the halfway point", () => expect(speedBonus(10000, 20000)).toBe(250));
  it("clamps negative elapsed time", () => expect(speedBonus(-50, 20000)).toBe(500));
  it("clamps elapsed time past the deadline", () => expect(speedBonus(25000, 20000)).toBe(0));
  it("returns 0 for a zero or negative duration", () => {
    expect(speedBonus(10, 0)).toBe(0);
    expect(speedBonus(10, -5)).toBe(0);
  });
  it("rounds to a whole number", () => expect(Number.isInteger(speedBonus(3333, 20000))).toBe(true));
});

describe("streakBonus", () => {
  it("is 0 for the first two answers in a row", () => {
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(0);
  });
  it("adds 100 per answer from the third", () => {
    expect(streakBonus(3)).toBe(100);
    expect(streakBonus(4)).toBe(200);
  });
  it("caps at 300", () => {
    expect(streakBonus(5)).toBe(300);
    expect(streakBonus(50)).toBe(300);
  });
});

describe("scoreAnswer", () => {
  it("awards nothing and resets the streak for a wrong answer", () => {
    const r = scoreAnswer({ correct: false, elapsedMs: 100, durationMs: 20000, streakBefore: 4 });
    expect(r).toEqual({ base: 0, speedBonus: 0, streakBonus: 0, total: 0, streakAfter: 0 });
  });
  it("awards base plus speed for a first correct answer", () => {
    const r = scoreAnswer({ correct: true, elapsedMs: 0, durationMs: 20000, streakBefore: 0 });
    expect(r.total).toBe(1000);
    expect(r.streakAfter).toBe(1);
  });
  it("reaches the 1300 maximum with a full streak and an instant answer", () => {
    const r = scoreAnswer({ correct: true, elapsedMs: 0, durationMs: 20000, streakBefore: 9 });
    expect(r.total).toBe(1300);
  });
  it("gives base only for a correct answer at the deadline with no streak", () => {
    const r = scoreAnswer({ correct: true, elapsedMs: 20000, durationMs: 20000, streakBefore: 0 });
    expect(r.total).toBe(500);
  });
  it("applies the streak bonus on the third correct answer", () => {
    const r = scoreAnswer({ correct: true, elapsedMs: 20000, durationMs: 20000, streakBefore: 2 });
    expect(r.streakBonus).toBe(100);
    expect(r.total).toBe(600);
  });
  it("is deterministic", () => {
    const input = { correct: true, elapsedMs: 4321, durationMs: 15000, streakBefore: 3 };
    expect(scoreAnswer(input)).toEqual(scoreAnswer(input));
  });
});

describe("rankPlayers", () => {
  const p = (id: string, score: number, correctCount: number, correctTimeMs: number) => ({
    id,
    score,
    correctCount,
    correctTimeMs,
  });
  const rankOf = (list: ReturnType<typeof rankPlayers>, id: string) => list.find((r) => r.id === id)?.rank;

  it("orders by score first", () => {
    const r = rankPlayers([p("a", 100, 1, 1000), p("b", 300, 1, 9000), p("c", 200, 5, 100)]);
    expect([rankOf(r, "b"), rankOf(r, "c"), rankOf(r, "a")]).toEqual([1, 2, 3]);
  });
  it("breaks score ties by correct answers", () => {
    const r = rankPlayers([p("a", 500, 2, 1000), p("b", 500, 3, 9000)]);
    expect(rankOf(r, "b")).toBe(1);
    expect(rankOf(r, "a")).toBe(2);
  });
  it("breaks remaining ties by faster average correct time", () => {
    const r = rankPlayers([p("a", 500, 2, 8000), p("b", 500, 2, 4000)]);
    expect(rankOf(r, "b")).toBe(1);
    expect(rankOf(r, "a")).toBe(2);
  });
  it("shares a rank when everything is equal, then skips", () => {
    const r = rankPlayers([p("a", 500, 2, 4000), p("b", 500, 2, 4000), p("c", 100, 1, 1000)]);
    expect(rankOf(r, "a")).toBe(1);
    expect(rankOf(r, "b")).toBe(1);
    expect(rankOf(r, "c")).toBe(3);
  });
  it("ranks players with no correct answers last among equal scores", () => {
    const r = rankPlayers([p("a", 0, 0, 0), p("b", 0, 0, 0)]);
    expect(rankOf(r, "a")).toBe(1);
    expect(rankOf(r, "b")).toBe(1);
  });
  it("returns an empty list for no players", () => expect(rankPlayers([])).toEqual([]));
});
