import { LIMITS, type CategoryChoice, type Phase } from "../../shared/constants";
import type { SettingsUpdate } from "../../shared/schemas";
import { PlayerState, type BlitzState, RoundSummary } from "../../shared/state";
import { rankPlayers } from "./ranking";
import { scoreAnswer } from "./scoring";
import {
  BANK,
  cryptoRng,
  poolSize,
  selectQuestions,
  type AskedQuestion,
  type BankQuestion,
  type Rng,
} from "./questions";

export interface TimingConfig {
  countdownMs: number;
  revealMs: number;
  scoreboardMs: number;
  answerGraceMs: number;
}

export type Result = { ok: true } | { ok: false; reason: RejectReason };

export type RejectReason =
  | "NOT_HOST"
  | "WRONG_PHASE"
  | "NOT_ENOUGH_PLAYERS"
  | "NOT_READY"
  | "UNKNOWN_PLAYER"
  | "STALE_QUESTION"
  | "ALREADY_ANSWERED"
  | "TOO_LATE"
  | "TOO_MANY_PLAYERS"
  | "ROOM_FULL"
  | "NO_QUESTIONS";

export interface MatchSummary {
  matchId: string;
  code: string;
  category: string;
  rounds: number;
  questionSeconds: number;
  startedAt: number;
  endedAt: number;
  players: Array<{
    avatar: number;
    rank: number;
    score: number;
    correctCount: number;
    bestStreak: number;
    avgCorrectMs: number;
    left: boolean;
  }>;
  questions: Array<{ id: string; correctPlayers: number; answeredPlayers: number }>;
}

export interface EngineDeps {
  state: BlitzState;
  now: () => number;
  /** Runs `fn` after `ms` and returns a function that cancels it. */
  schedule: (fn: () => void, ms: number) => () => void;
  timing: TimingConfig;
  rng?: Rng;
  bank?: readonly BankQuestion[];
  newId?: () => string;
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
  onMatchComplete?: (summary: MatchSummary) => void;
}

interface CurrentQuestion {
  asked: AskedQuestion;
  startedAt: number;
  deadline: number;
  durationMs: number;
  answers: Map<string, { choice: number; elapsedMs: number }>;
  resolved: boolean;
}

interface PlayerPrivate {
  correctTimeMs: number;
}

const ok: Result = { ok: true };
const fail = (reason: RejectReason): Result => ({ ok: false, reason });

/**
 * Owns the match: phases, timers, answers, scoring and resets.
 * Every public method is idempotent or rejects, and every timer callback checks a token
 * so a stale timer can never move the game twice.
 */
export class MatchEngine {
  private readonly s: BlitzState;
  private readonly now: () => number;
  private readonly schedule: EngineDeps["schedule"];
  private readonly timing: TimingConfig;
  private readonly rng: Rng;
  private readonly bank: readonly BankQuestion[];
  private readonly newId: () => string;
  private readonly emit: (event: string, data?: Record<string, unknown>) => void;
  private readonly onMatchComplete?: (summary: MatchSummary) => void;

  private token = 0;
  private cancelTimer: (() => void) | null = null;
  private questions: AskedQuestion[] = [];
  private current: CurrentQuestion | null = null;
  private readonly used = new Set<string>();
  private readonly priv = new Map<string, PlayerPrivate>();
  private orderCounter = 0;
  private matchStartedAt = 0;
  private completedReported = false;
  private disposed = false;

  constructor(deps: EngineDeps) {
    this.s = deps.state;
    this.now = deps.now;
    this.schedule = deps.schedule;
    this.timing = deps.timing;
    this.rng = deps.rng ?? cryptoRng;
    this.bank = deps.bank ?? BANK;
    this.newId = deps.newId ?? (() => Math.random().toString(36).slice(2, 10));
    this.emit = deps.onEvent ?? (() => undefined);
    this.onMatchComplete = deps.onMatchComplete;
  }

  get phase(): Phase {
    return this.s.phase as Phase;
  }

  // ---------------------------------------------------------------- roster

  /** Players who have not left, including ones whose connection is currently down. */
  activePlayers(): PlayerState[] {
    const out: PlayerState[] = [];
    this.s.players.forEach((p) => {
      if (!p.left) out.push(p);
    });
    return out;
  }

  connectedPlayers(): PlayerState[] {
    return this.activePlayers().filter((p) => p.connected);
  }

  getPlayer(id: string): PlayerState | undefined {
    return this.s.players.get(id);
  }

  addPlayer(id: string, name: string, avatar: number): Result {
    if (this.s.phase !== "LOBBY") return fail("WRONG_PHASE");
    if (this.activePlayers().length >= this.s.maxPlayers) return fail("ROOM_FULL");
    const p = new PlayerState();
    p.id = id;
    p.sid = "";
    p.name = this.uniqueName(name);
    p.avatar = avatar;
    p.order = ++this.orderCounter;
    p.ready = false;
    p.connected = true;
    p.left = false;
    p.isHost = false;
    p.score = 0;
    p.correctCount = 0;
    p.streak = 0;
    p.bestStreak = 0;
    p.answered = false;
    p.lastChoice = -1;
    p.lastGain = 0;
    p.lastCorrect = false;
    p.rank = 0;
    p.avgCorrectMs = 0;
    this.s.players.set(id, p);
    this.priv.set(id, { correctTimeMs: 0 });
    this.ensureHost();
    this.bump();
    return ok;
  }

  private uniqueName(name: string): string {
    const taken = new Set<string>();
    this.s.players.forEach((p) => taken.add(p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 100; n++) {
      const suffix = ` ${n}`;
      const candidate = name.slice(0, LIMITS.nameMax - suffix.length) + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  setSession(id: string, sid: string): void {
    const p = this.s.players.get(id);
    if (p && p.sid !== sid) {
      p.sid = sid;
      this.bump();
    }
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.s.players.get(id);
    if (!p || p.left || p.connected === connected) return;
    p.connected = connected;
    this.ensureHost();
    this.bump();
    if (!connected) this.afterRosterShrank();
  }

  /** A player who had been marked left comes back with their private id. Scores and history are kept. */
  rejoin(id: string): void {
    const p = this.s.players.get(id);
    if (!p) return;
    p.left = false;
    p.connected = true;
    this.ensureHost();
    this.bump();
  }

  /** The player is gone for good (consented leave or reconnection window expired). */
  removeOrMarkLeft(id: string): void {
    const p = this.s.players.get(id);
    if (!p) return;
    if (this.s.phase === "LOBBY") {
      this.s.players.delete(id);
      this.priv.delete(id);
    } else {
      p.left = true;
      p.connected = false;
      p.ready = false;
    }
    this.ensureHost();
    this.bump();
    this.afterRosterShrank();
  }

  private afterRosterShrank(): void {
    if (this.disposed) return;
    if (this.s.phase === "COUNTDOWN" && this.connectedPlayers().length < LIMITS.minPlayers) {
      this.emit("countdown_aborted");
      this.resetMatchState();
      this.enter("LOBBY", 0, 0);
      return;
    }
    if (this.s.phase === "QUESTION") this.resolveIfEveryoneAnswered();
  }

  /**
   * Host policy: the host is the earliest-joined player who is connected. A host whose
   * connection drops loses the role immediately and does not get it back on return.
   */
  ensureHost(): void {
    const current = this.s.players.get(this.s.hostId);
    if (current && !current.left && current.connected) return;

    const candidates = this.activePlayers().sort((a, b) => a.order - b.order);
    const next = candidates.find((p) => p.connected) ?? (current && !current.left ? current : candidates[0]);
    const nextId = next?.id ?? "";
    if (nextId === this.s.hostId && next?.isHost) return;

    this.s.players.forEach((p) => {
      p.isHost = p.id === nextId;
    });
    this.s.hostId = nextId;
    if (next) next.ready = true;
    if (nextId) this.emit("host_changed");
  }

  // -------------------------------------------------------------- lobby

  setReady(id: string, ready: boolean): Result {
    const p = this.s.players.get(id);
    if (!p || p.left) return fail("UNKNOWN_PLAYER");
    if (this.s.phase !== "LOBBY") return fail("WRONG_PHASE");
    const next = p.isHost ? true : ready;
    if (p.ready !== next) {
      p.ready = next;
      this.bump();
    }
    return ok;
  }

  updateSettings(id: string, update: SettingsUpdate): Result {
    if (this.s.hostId !== id) return fail("NOT_HOST");
    if (this.s.phase !== "LOBBY") return fail("WRONG_PHASE");
    if (update.maxPlayers !== undefined && update.maxPlayers < this.activePlayers().length) {
      return fail("TOO_MANY_PLAYERS");
    }
    if (update.category !== undefined) this.s.category = update.category;
    if (update.rounds !== undefined) this.s.rounds = update.rounds;
    if (update.questionSeconds !== undefined) this.s.questionSeconds = update.questionSeconds;
    if (update.maxPlayers !== undefined) this.s.maxPlayers = update.maxPlayers;
    this.bump();
    return ok;
  }

  start(id: string): Result {
    if (this.s.hostId !== id) return fail("NOT_HOST");
    if (this.s.phase !== "LOBBY") return fail("WRONG_PHASE");
    const connected = this.connectedPlayers();
    if (connected.length < LIMITS.minPlayers) return fail("NOT_ENOUGH_PLAYERS");
    if (connected.some((p) => !p.isHost && !p.ready)) return fail("NOT_READY");
    return this.beginMatch();
  }

  playAgain(id: string): Result {
    if (this.s.hostId !== id) return fail("NOT_HOST");
    if (this.s.phase !== "RESULTS") return fail("WRONG_PHASE");
    this.resetMatchState();
    if (this.connectedPlayers().length < LIMITS.minPlayers) {
      this.enter("LOBBY", 0, 0);
      return ok;
    }
    return this.beginMatch();
  }

  backToLobby(id: string): Result {
    if (this.s.hostId !== id) return fail("NOT_HOST");
    if (this.s.phase !== "RESULTS") return fail("WRONG_PHASE");
    this.resetMatchState();
    this.enter("LOBBY", 0, 0);
    return ok;
  }

  // -------------------------------------------------------------- match flow

  private beginMatch(): Result {
    const count = Math.min(this.s.rounds, poolSize(this.s.category as CategoryChoice, this.bank));
    const picked = selectQuestions(this.s.category as CategoryChoice, count, this.used, this.rng, this.bank);
    if (picked.length === 0) return fail("NO_QUESTIONS");
    this.questions = picked;
    picked.forEach((q) => this.used.add(q.id));
    this.completedReported = false;
    this.matchStartedAt = this.now();
    this.s.matchId = this.newId();
    this.s.question.total = picked.length;
    this.emit("match_started", { rounds: picked.length, category: this.s.category, players: this.connectedPlayers().length });
    this.enter("COUNTDOWN", this.timing.countdownMs, this.timing.countdownMs, () => this.nextQuestion());
    return ok;
  }

  private nextQuestion(): void {
    const index = this.s.question.index + 1;
    if (index >= this.questions.length) {
      this.finish();
      return;
    }
    const asked = this.questions[index] as AskedQuestion;
    const durationMs = this.s.questionSeconds * 1000;
    const startedAt = this.now();
    const deadline = startedAt + durationMs;

    this.current = { asked, startedAt, deadline, durationMs, answers: new Map(), resolved: false };

    const q = this.s.question;
    q.index = index;
    q.total = this.questions.length;
    q.text = asked.text;
    q.category = asked.category;
    q.difficulty = asked.difficulty;
    q.options.clear();
    asked.options.forEach((o) => q.options.push(o));
    q.pickCounts.clear();
    q.correctIndex = -1;
    q.startedAt = startedAt;
    q.endsAt = deadline;

    this.s.players.forEach((p) => {
      p.answered = false;
      p.lastChoice = -1;
      p.lastGain = 0;
      p.lastCorrect = false;
    });

    this.enter("QUESTION", durationMs, durationMs + this.timing.answerGraceMs, () => this.resolveCurrent());
  }

  submitAnswer(id: string, questionIndex: number, choice: number): Result {
    const p = this.s.players.get(id);
    if (!p || p.left) return fail("UNKNOWN_PLAYER");
    const c = this.current;
    if (this.s.phase !== "QUESTION" || !c || c.resolved) return fail("WRONG_PHASE");
    if (questionIndex !== this.s.question.index) return fail("STALE_QUESTION");
    if (c.answers.has(id)) return fail("ALREADY_ANSWERED");
    const now = this.now();
    if (now > c.deadline + this.timing.answerGraceMs) return fail("TOO_LATE");

    const elapsedMs = Math.min(Math.max(now - c.startedAt, 0), c.durationMs);
    c.answers.set(id, { choice, elapsedMs });
    p.answered = true;
    this.bump();
    this.resolveIfEveryoneAnswered();
    return ok;
  }

  private resolveIfEveryoneAnswered(): void {
    const c = this.current;
    if (!c || c.resolved || this.s.phase !== "QUESTION") return;
    const connected = this.connectedPlayers();
    if (connected.length === 0) return;
    if (connected.every((p) => c.answers.has(p.id))) this.resolveCurrent();
  }

  /** Scores the question and moves to REVEAL. Safe to call more than once. */
  private resolveCurrent(): void {
    const c = this.current;
    if (!c || c.resolved || this.s.phase !== "QUESTION") return;
    c.resolved = true;

    const q = this.s.question;
    const counts = [0, 0, 0, 0];
    let correctPlayers = 0;
    let answeredPlayers = 0;

    this.s.players.forEach((p) => {
      const a = c.answers.get(p.id);
      const correct = a !== undefined && a.choice === c.asked.correctIndex;
      const r = scoreAnswer({
        correct,
        elapsedMs: a ? a.elapsedMs : c.durationMs,
        durationMs: c.durationMs,
        streakBefore: p.streak,
      });
      p.score += r.total;
      p.streak = r.streakAfter;
      if (r.streakAfter > p.bestStreak) p.bestStreak = r.streakAfter;
      if (correct) {
        p.correctCount += 1;
        correctPlayers += 1;
        const pr = this.priv.get(p.id);
        if (pr && a) pr.correctTimeMs += a.elapsedMs;
      }
      if (a) {
        answeredPlayers += 1;
        counts[a.choice] = (counts[a.choice] ?? 0) + 1;
      }
      p.lastGain = r.total;
      p.lastCorrect = correct;
      p.lastChoice = a ? a.choice : -1;
      p.gains.push(r.total);
      p.choices.push(p.lastChoice);
    });

    this.applyRanks();
    q.correctIndex = c.asked.correctIndex;
    counts.forEach((n) => q.pickCounts.push(n));

    const summary = new RoundSummary();
    summary.index = q.index;
    summary.text = c.asked.text;
    summary.correctText = c.asked.options[c.asked.correctIndex] as string;
    summary.category = c.asked.category;
    summary.correctPlayers = correctPlayers;
    summary.answeredPlayers = answeredPlayers;
    this.s.summaries.push(summary);

    const last = q.index >= this.questions.length - 1;
    this.enter("REVEAL", this.timing.revealMs, this.timing.revealMs, () => {
      if (last) this.finish();
      else this.enter("SCOREBOARD", this.timing.scoreboardMs, this.timing.scoreboardMs, () => this.nextQuestion());
    });
  }

  private applyRanks(): void {
    const inputs: Array<{ id: string; score: number; correctCount: number; correctTimeMs: number }> = [];
    this.s.players.forEach((p) => {
      inputs.push({
        id: p.id,
        score: p.score,
        correctCount: p.correctCount,
        correctTimeMs: this.priv.get(p.id)?.correctTimeMs ?? 0,
      });
    });
    for (const r of rankPlayers(inputs)) {
      const p = this.s.players.get(r.id);
      if (!p) continue;
      p.rank = r.rank;
      const t = this.priv.get(p.id)?.correctTimeMs ?? 0;
      p.avgCorrectMs = p.correctCount > 0 ? Math.round(t / p.correctCount) : 0;
    }
  }

  private finish(): void {
    if (this.s.phase === "RESULTS") return;
    this.applyRanks();
    this.enter("RESULTS", 0, 0);
    if (this.completedReported) return;
    this.completedReported = true;
    this.emit("match_completed", { rounds: this.questions.length, players: this.activePlayers().length });
    if (this.onMatchComplete) {
      try {
        this.onMatchComplete(this.buildSummary());
      } catch (err) {
        this.emit("summary_hook_failed", { message: err instanceof Error ? err.message : "unknown" });
      }
    }
  }

  private buildSummary(): MatchSummary {
    const players: MatchSummary["players"] = [];
    this.s.players.forEach((p) =>
      players.push({
        avatar: p.avatar,
        rank: p.rank,
        score: p.score,
        correctCount: p.correctCount,
        bestStreak: p.bestStreak,
        avgCorrectMs: p.avgCorrectMs,
        left: p.left,
      }),
    );
    const questions = this.questions.map((q, i) => {
      const r = this.s.summaries[i];
      return { id: q.id, correctPlayers: r?.correctPlayers ?? 0, answeredPlayers: r?.answeredPlayers ?? 0 };
    });
    return {
      matchId: this.s.matchId,
      code: this.s.code,
      category: this.s.category,
      rounds: this.questions.length,
      questionSeconds: this.s.questionSeconds,
      startedAt: this.matchStartedAt,
      endedAt: this.now(),
      players,
      questions,
    };
  }

  /** Clears everything that belongs to one match. Players stay; scores, timers and questions do not. */
  private resetMatchState(): void {
    this.cancelPending();
    this.token++;
    this.current = null;
    this.questions = [];

    const gone: string[] = [];
    this.s.players.forEach((p) => {
      if (p.left) gone.push(p.id);
    });
    gone.forEach((id) => {
      this.s.players.delete(id);
      this.priv.delete(id);
    });

    this.s.players.forEach((p) => {
      p.score = 0;
      p.correctCount = 0;
      p.streak = 0;
      p.bestStreak = 0;
      p.answered = false;
      p.lastChoice = -1;
      p.lastGain = 0;
      p.lastCorrect = false;
      p.rank = 0;
      p.avgCorrectMs = 0;
      p.gains.clear();
      p.choices.clear();
      p.ready = p.isHost;
      const pr = this.priv.get(p.id);
      if (pr) pr.correctTimeMs = 0;
    });

    const q = this.s.question;
    q.index = -1;
    q.total = 0;
    q.text = "";
    q.category = "";
    q.difficulty = 0;
    q.options.clear();
    q.pickCounts.clear();
    q.correctIndex = -1;
    q.startedAt = 0;
    q.endsAt = 0;
    this.s.summaries.clear();
    this.s.matchId = "";
    this.ensureHost();
  }

  // -------------------------------------------------------------- plumbing

  /**
   * Switches phase. `displayMs` is what clients count down to; `timerMs` is when the server
   * actually acts (it differs for questions, which allow a short network grace).
   */
  private enter(phase: Phase, displayMs: number, timerMs: number, next?: () => void): void {
    this.cancelPending();
    const token = ++this.token;
    const s = this.s;
    s.phase = phase;
    s.serverNow = this.now();
    s.phaseEndsAt = displayMs > 0 ? s.serverNow + displayMs : 0;
    s.seq += 1;
    if (next && !this.disposed) {
      this.cancelTimer = this.schedule(() => {
        if (token !== this.token || this.disposed) return;
        this.cancelTimer = null;
        next();
      }, timerMs);
    }
    this.emit("phase", { phase });
  }

  private cancelPending(): void {
    if (this.cancelTimer) {
      this.cancelTimer();
      this.cancelTimer = null;
    }
  }

  private bump(): void {
    this.s.seq += 1;
    this.s.serverNow = this.now();
  }

  dispose(): void {
    this.disposed = true;
    this.token++;
    this.cancelPending();
  }
}
