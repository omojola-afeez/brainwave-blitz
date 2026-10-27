import { describe, expect, it } from "vitest";
import { CATEGORIES, REGION_CATEGORIES, TOPIC_CATEGORIES } from "../../src/shared/constants";
import {
  BANK,
  poolSize,
  selectQuestions,
  shuffle,
  toAsked,
  validateBank,
  type Rng,
} from "../../src/server/game/questions";

/** Small deterministic generator so failures can be reproduced. */
function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return (max) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

describe("question bank", () => {
  it("passes validation", () => expect(validateBank(BANK)).toEqual([]));
  it("has at least 20 questions in every category", () => {
    for (const c of CATEGORIES) expect(poolSize(c)).toBeGreaterThanOrEqual(20);
  });
  it("has unique ids", () => expect(new Set(BANK.map((q) => q.id)).size).toBe(BANK.length));
  it("covers all three difficulties in every category", () => {
    for (const c of CATEGORIES) {
      const levels = new Set(BANK.filter((q) => q.category === c).map((q) => q.difficulty));
      expect(levels.size).toBe(3);
    }
  });
  it("catches a duplicate and a repeated option", () => {
    const bad = [
      { id: "x-1", category: "general" as const, difficulty: 1 as const, text: "Same?", correct: "A", wrong: ["A", "B", "C"] as [string, string, string] },
      { id: "x-2", category: "general" as const, difficulty: 1 as const, text: "same?", correct: "A", wrong: ["B", "C", "D"] as [string, string, string] },
    ];
    const problems = validateBank(bad);
    expect(problems.some((p) => p.includes("duplicate"))).toBe(true);
    expect(problems.some((p) => p.includes("distinct"))).toBe(true);
  });
});

describe("region sets", () => {
  it("has five region sets of 24 questions, each with every difficulty", () => {
    expect(REGION_CATEGORIES).toHaveLength(5);
    for (const c of REGION_CATEGORIES) {
      expect(poolSize(c)).toBe(24);
      const levels = BANK.filter((q) => q.category === c).map((q) => q.difficulty);
      expect(new Set(levels).size).toBe(3);
    }
  });
  it("keeps regions out of Mixed", () => {
    const topicTotal = BANK.filter((q) => (TOPIC_CATEGORIES as readonly string[]).includes(q.category)).length;
    expect(poolSize("mixed")).toBe(topicTotal);
    for (let seed = 1; seed <= 20; seed++) {
      const qs = selectQuestions("mixed", 20, new Set(), seeded(seed));
      expect(qs.every((q) => (TOPIC_CATEGORIES as readonly string[]).includes(q.category))).toBe(true);
    }
  });
  it("a region match asks only that region, 20 distinct questions", () => {
    for (const c of REGION_CATEGORIES) {
      const qs = selectQuestions(c, 20, new Set(), seeded(7));
      expect(qs).toHaveLength(20);
      expect(new Set(qs.map((q) => q.id)).size).toBe(20);
      expect(qs.every((q) => q.category === c)).toBe(true);
    }
  });
});

describe("toAsked", () => {
  it("keeps the correct answer at the reported index across many shuffles", () => {
    const q = BANK[0]!;
    for (let i = 1; i <= 200; i++) {
      const asked = toAsked(q, seeded(i));
      expect(asked.options[asked.correctIndex]).toBe(q.correct);
      expect(new Set(asked.options).size).toBe(4);
    }
  });
  it("does not always place the answer in the same position", () => {
    const positions = new Set<number>();
    for (let i = 1; i <= 100; i++) positions.add(toAsked(BANK[0]!, seeded(i)).correctIndex);
    expect(positions.size).toBe(4);
  });
});

describe("shuffle", () => {
  it("keeps every element", () => {
    const out = shuffle([1, 2, 3, 4, 5], seeded(7));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("selectQuestions", () => {
  it("returns the requested number with no repeats", () => {
    const qs = selectQuestions("science", 10, new Set(), seeded(1));
    expect(qs).toHaveLength(10);
    expect(new Set(qs.map((q) => q.id)).size).toBe(10);
    expect(qs.every((q) => q.category === "science")).toBe(true);
  });
  it("ramps from easy to hard", () => {
    const qs = selectQuestions("mixed", 15, new Set(), seeded(2));
    for (let i = 1; i < qs.length; i++) {
      expect(qs[i]!.difficulty).toBeGreaterThanOrEqual(qs[i - 1]!.difficulty);
    }
  });
  it("mixes categories and limits any one category", () => {
    const qs = selectQuestions("mixed", 10, new Set(), seeded(3));
    const counts = new Map<string, number>();
    for (const q of qs) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });
  it("avoids questions already used", () => {
    const first = selectQuestions("sports", 10, new Set(), seeded(4));
    const used = new Set(first.map((q) => q.id));
    const second = selectQuestions("sports", 10, used, seeded(5));
    expect(second.some((q) => used.has(q.id))).toBe(false);
  });
  it("falls back to reused questions when the pool runs dry", () => {
    const all = BANK.filter((q) => q.category === "history").map((q) => q.id);
    const qs = selectQuestions("history", 10, new Set(all), seeded(6));
    expect(qs).toHaveLength(10);
  });
  it("never asks for more than exist", () => {
    const qs = selectQuestions("general", 500, new Set(), seeded(8));
    expect(qs).toHaveLength(poolSize("general"));
  });
});
