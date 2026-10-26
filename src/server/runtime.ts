import { TIMING } from "../shared/constants";
import type { MatchSummary, TimingConfig } from "./game/engine";
import { RateLimiter } from "./rateLimit";

export interface RuntimeConfig {
  timing: TimingConfig;
  reconnectSeconds: number;
  idleRoomMs: number;
  idleCheckMs: number;
  maxMessagesPerSecond: number;
  maxRooms: number;
  createsPerMinute: number;
  joinsPerMinute: number;
  matchmakePerMinute: number;
  onMatchComplete?: (summary: MatchSummary) => void | Promise<void>;
}

export const PRODUCTION_TIMING: TimingConfig = {
  countdownMs: TIMING.countdownMs,
  revealMs: TIMING.revealMs,
  scoreboardMs: TIMING.scoreboardMs,
  answerGraceMs: TIMING.answerGraceMs,
};

/** Shorter waits so automated tests finish quickly. Never selected unless BLITZ_TIMING=fast is set. */
export const FAST_TIMING: TimingConfig = { countdownMs: 700, revealMs: 500, scoreboardMs: 400, answerGraceMs: 300 };

export function defaultConfig(): RuntimeConfig {
  const fast = process.env.BLITZ_TIMING === "fast";
  return {
    timing: fast ? FAST_TIMING : PRODUCTION_TIMING,
    reconnectSeconds: TIMING.reconnectWindowSeconds,
    idleRoomMs: TIMING.idleRoomMs,
    idleCheckMs: 30_000,
    maxMessagesPerSecond: 25,
    maxRooms: Number(process.env.MAX_ROOMS ?? 150),
    createsPerMinute: 8,
    joinsPerMinute: 40,
    matchmakePerMinute: 90,
  };
}

/** Process-wide settings. Tests replace parts of this before starting a server. */
export const runtime: RuntimeConfig = defaultConfig();

export const createLimiter = new RateLimiter(runtime.createsPerMinute, 60_000);
export const joinLimiter = new RateLimiter(runtime.joinsPerMinute, 60_000);
export const matchmakeLimiter = new RateLimiter(runtime.matchmakePerMinute, 60_000);

export function configureRuntime(partial: Partial<RuntimeConfig>): void {
  Object.assign(runtime, partial);
  createLimiter.reconfigure(runtime.createsPerMinute, 60_000);
  joinLimiter.reconfigure(runtime.joinsPerMinute, 60_000);
  matchmakeLimiter.reconfigure(runtime.matchmakePerMinute, 60_000);
}
