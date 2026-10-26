import type { BankQuestion } from "../../src/server/game/questions";
import { MatchEngine, type MatchSummary, type TimingConfig } from "../../src/server/game/engine";
import { createInitialState, type BlitzState } from "../../src/shared/state";
import type { Rng } from "../../src/server/game/questions";

export class FakeClock {
  t = 1_000_000;
  private nextId = 1;
  private timers: Array<{ id: number; at: number; fn: () => void }> = [];
  now = () => this.t;
  schedule = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, fn });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  };
  pending(): number {
    return this.timers.length;
  }
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x.id !== due.id);
      this.t = due.at;
      due.fn();
    }
    this.t = target;
  }
}

export function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return (max) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

export const TEST_TIMING: TimingConfig = { countdownMs: 3000, revealMs: 4000, scoreboardMs: 3000, answerGraceMs: 300 };

/** Twelve questions with predictable answers so tests can pick right or wrong on purpose. */
export function makeBank(n = 12): BankQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `general-${i + 1}`,
    category: "general" as const,
    difficulty: ((i % 3) + 1) as 1 | 2 | 3,
    text: `Question ${i + 1}?`,
    correct: `right-${i + 1}`,
    wrong: [`w1-${i + 1}`, `w2-${i + 1}`, `w3-${i + 1}`] as [string, string, string],
  }));
}

export interface Harness {
  clock: FakeClock;
  state: BlitzState;
  engine: MatchEngine;
  completed: MatchSummary[];
  events: string[];
  /** Index of the correct option for the question on screen. */
  correct(): number;
  wrong(): number;
}

export function makeHarness(opts: { bank?: BankQuestion[]; seed?: number } = {}): Harness {
  const clock = new FakeClock();
  const state = createInitialState("TESTX");
  const completed: MatchSummary[] = [];
  const events: string[] = [];
  const bank = opts.bank ?? makeBank();
  let idCounter = 0;
  const engine = new MatchEngine({
    state,
    now: clock.now,
    schedule: clock.schedule,
    timing: TEST_TIMING,
    rng: seeded(opts.seed ?? 42),
    bank,
    newId: () => `match-${++idCounter}`,
    onEvent: (e) => events.push(e),
    onMatchComplete: (m) => completed.push(m),
  });
  const correct = () => {
    const text = state.question.text;
    const q = bank.find((b) => b.text === text);
    if (!q) throw new Error("no question on screen");
    return state.question.options.indexOf(q.correct);
  };
  return { clock, state, engine, completed, events, correct, wrong: () => (correct() + 1) % 4 };
}

export function lobbyOf(h: Harness, n: number): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `p${i}`;
    h.engine.addPlayer(id, `Player ${i}`, i % 12);
    ids.push(id);
  }
  for (const id of ids.slice(1)) h.engine.setReady(id, true);
  return ids;
}

/** Advances the fake clock until the next question is on screen, or the match has ended. */
export function toNextQuestion(h: Harness): void {
  const idx = h.state.question.index;
  let guard = 0;
  while (h.state.question.index === idx && h.state.phase !== "RESULTS" && guard++ < 2000) h.clock.advance(250);
}
