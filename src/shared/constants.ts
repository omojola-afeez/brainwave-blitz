export const GAME_NAME = "Brainwave Blitz";
export const ROOM_TYPE = "blitz";

/** Topic sets. Mixed mode draws only from these. */
export const TOPIC_CATEGORIES = [
  "general",
  "science",
  "technology",
  "history",
  "sports",
  "entertainment",
  "geography",
] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

/** Region sets. A host picks one on purpose, so Mixed never includes them. */
export const REGION_CATEGORIES = ["nigeria", "africa", "europe", "asia", "americas"] as const;
export type RegionCategory = (typeof REGION_CATEGORIES)[number];

export const CATEGORIES = [...TOPIC_CATEGORIES, ...REGION_CATEGORIES] as const;
export type Category = (typeof CATEGORIES)[number];
export type CategoryChoice = Category | "mixed";
export const CATEGORY_CHOICES: readonly CategoryChoice[] = ["mixed", ...CATEGORIES];

export function isTopicCategory(c: string): c is TopicCategory {
  return (TOPIC_CATEGORIES as readonly string[]).includes(c);
}

export const CATEGORY_LABELS: Record<CategoryChoice, string> = {
  mixed: "Mixed",
  general: "General knowledge",
  science: "Science",
  technology: "Technology",
  history: "History",
  sports: "Sports",
  entertainment: "Entertainment",
  geography: "Geography",
  nigeria: "Nigeria",
  africa: "Africa",
  europe: "Europe",
  asia: "Asia",
  americas: "The Americas",
};

export const PHASES = [
  "LOBBY",
  "COUNTDOWN",
  "QUESTION",
  "REVEAL",
  "SCOREBOARD",
  "RESULTS",
] as const;
export type Phase = (typeof PHASES)[number];

export const LIMITS = {
  minPlayers: 2,
  maxPlayersCeiling: 12,
  defaultMaxPlayers: 12,
  nameMin: 1,
  nameMax: 16,
  roundOptions: [5, 10, 15, 20] as const,
  defaultRounds: 10,
  questionSecondsOptions: [10, 15, 20, 30] as const,
  defaultQuestionSeconds: 20,
  avatarCount: 12,
  optionCount: 4,
} as const;

export const GAME_MODES = ["solo", "teams"] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const MODE_LABELS: Record<GameMode, string> = { solo: "Solo", teams: "Team A vs Team B" };

/** Team ids. 0 means no team (solo mode). */
export const TEAM_IDS = [1, 2] as const;
export type TeamId = (typeof TEAM_IDS)[number];
export const TEAM_NAMES: Record<TeamId, string> = { 1: "Team A", 2: "Team B" };

export const TIMING = {
  countdownMs: 4000,
  revealMs: 4500,
  scoreboardMs: 4000,
  /** Network tolerance after the deadline. Elapsed time for scoring is still capped at the question length. */
  answerGraceMs: 300,
  reconnectWindowSeconds: 60,
  /** A lobby or results screen that nobody touches for this long is closed. */
  idleRoomMs: 30 * 60 * 1000,
} as const;

export const SCORING = {
  basePoints: 500,
  maxSpeedBonus: 500,
  streakStep: 100,
  streakFreeAnswers: 2,
  streakCap: 300,
} as const;

export const ROOM_CODE = {
  length: 5,
  /** No 0, O, 1, I or L, so codes survive being read aloud or typed on a phone. */
  alphabet: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
} as const;

export const ERROR_CODES = {
  roomFull: 4101,
  matchInProgress: 4102,
  badName: 4103,
  rateLimited: 4104,
  badRequest: 4105,
  roomClosed: 4106,
  serverBusy: 4107,
} as const;

export const ERROR_MESSAGES = {
  ROOM_FULL: "This room is full.",
  MATCH_IN_PROGRESS: "A match is already in progress in this room.",
  BAD_NAME: "Pick a name with 1 to 16 letters, numbers or spaces.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
  BAD_REQUEST: "That request was not valid.",
  ROOM_CLOSED: "This room has closed.",
  SERVER_BUSY: "The server is busy. Try again in a minute.",
} as const;
export type ErrorKey = keyof typeof ERROR_MESSAGES;
