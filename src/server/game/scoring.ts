import { SCORING } from "../../shared/constants";

export interface ScoreInput {
  correct: boolean;
  /** Milliseconds from question start to the moment the server received the answer. */
  elapsedMs: number;
  /** Full answer window in milliseconds. */
  durationMs: number;
  /** Consecutive correct answers before this question. */
  streakBefore: number;
}

export interface ScoreResult {
  base: number;
  speedBonus: number;
  streakBonus: number;
  total: number;
  streakAfter: number;
}

/** Linear speed bonus: full at 0 ms, zero at the deadline. */
export function speedBonus(elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  const clamped = Math.min(Math.max(elapsedMs, 0), durationMs);
  return Math.round(SCORING.maxSpeedBonus * (1 - clamped / durationMs));
}

/** The streak count includes the current answer. Answers 1 and 2 earn nothing, then 100 each, capped at 300. */
export function streakBonus(streakIncludingCurrent: number): number {
  const over = streakIncludingCurrent - SCORING.streakFreeAnswers;
  if (over <= 0) return 0;
  return Math.min(SCORING.streakCap, over * SCORING.streakStep);
}

export function scoreAnswer(input: ScoreInput): ScoreResult {
  if (!input.correct) {
    return { base: 0, speedBonus: 0, streakBonus: 0, total: 0, streakAfter: 0 };
  }
  const streakAfter = input.streakBefore + 1;
  const base = SCORING.basePoints;
  const speed = speedBonus(input.elapsedMs, input.durationMs);
  const streak = streakBonus(streakAfter);
  return { base, speedBonus: speed, streakBonus: streak, total: base + speed + streak, streakAfter };
}
