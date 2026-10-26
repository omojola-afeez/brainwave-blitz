import { schema, t, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema(
  {
    /** Public player id. Not a secret and not the connection session id. */
    id: t.string(),
    /** Connection session id, so a client can find its own entry. Not a credential. */
    sid: t.string(),
    name: t.string(),
    avatar: t.uint8(),
    order: t.uint16(),
    ready: t.boolean(),
    connected: t.boolean(),
    left: t.boolean(),
    isHost: t.boolean(),
    score: t.uint32(),
    correctCount: t.uint8(),
    streak: t.uint8(),
    bestStreak: t.uint8(),
    answered: t.boolean(),
    /** Option picked on the current question. -1 until the reveal. */
    lastChoice: t.int8(),
    lastGain: t.uint16(),
    lastCorrect: t.boolean(),
    rank: t.uint8(),
    avgCorrectMs: t.uint32(),
    /** Points earned on each question so far, in order. */
    gains: t.array("uint16"),
    /** Option picked on each question so far, -1 for no answer. */
    choices: t.array("int8"),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const QuestionState = schema(
  {
    index: t.int16(),
    total: t.uint8(),
    text: t.string(),
    category: t.string(),
    difficulty: t.uint8(),
    options: t.array("string"),
    startedAt: t.float64(),
    endsAt: t.float64(),
    /** -1 until the reveal. The server never writes it earlier. */
    correctIndex: t.int8(),
    /** How many players picked each option. Empty until the reveal. */
    pickCounts: t.array("uint8"),
  },
  "QuestionState",
);
export type QuestionState = SchemaType<typeof QuestionState>;

export const RoundSummary = schema(
  {
    index: t.uint8(),
    text: t.string(),
    correctText: t.string(),
    category: t.string(),
    correctPlayers: t.uint8(),
    answeredPlayers: t.uint8(),
  },
  "RoundSummary",
);
export type RoundSummary = SchemaType<typeof RoundSummary>;

export const BlitzState = schema(
  {
    code: t.string(),
    phase: t.string(),
    /** Increases on every authoritative transition. Lets clients ignore stale data. */
    seq: t.uint32(),
    /** New for every match so clients can drop per-match local state. */
    matchId: t.string(),
    hostId: t.string(),
    category: t.string(),
    rounds: t.uint8(),
    questionSeconds: t.uint8(),
    maxPlayers: t.uint8(),
    /** Server clock at the last transition, for display only. Clients sync their own offset. */
    serverNow: t.float64(),
    phaseEndsAt: t.float64(),
    players: t.map(PlayerState),
    question: QuestionState,
    summaries: t.array(RoundSummary),
  },
  "BlitzState",
);
export type BlitzState = SchemaType<typeof BlitzState>;

export function createInitialState(code: string): BlitzState {
  const state = new BlitzState();
  state.code = code;
  state.phase = "LOBBY";
  state.seq = 0;
  state.matchId = "";
  state.hostId = "";
  state.category = "mixed";
  state.rounds = 10;
  state.questionSeconds = 20;
  state.maxPlayers = 12;
  state.serverNow = Date.now();
  state.phaseEndsAt = 0;
  const q = new QuestionState();
  q.index = -1;
  q.total = 0;
  q.text = "";
  q.category = "";
  q.difficulty = 0;
  q.startedAt = 0;
  q.endsAt = 0;
  q.correctIndex = -1;
  state.question = q;
  return state;
}
