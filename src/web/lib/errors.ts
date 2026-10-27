import { ERROR_MESSAGES, ERROR_CODES } from "../../shared/constants";

/** Turn anything thrown by the join flow into a sentence a player can act on. */
export function friendlyError(err: unknown): string {
  const e = err as { code?: number; message?: string } | null;
  const message = String(e?.message ?? "");
  const code = e?.code;

  for (const key of Object.keys(ERROR_MESSAGES) as Array<keyof typeof ERROR_MESSAGES>) {
    if (message.includes(key)) return ERROR_MESSAGES[key];
  }
  if (code === ERROR_CODES.roomFull) return ERROR_MESSAGES.ROOM_FULL;
  if (code === ERROR_CODES.matchInProgress) return ERROR_MESSAGES.MATCH_IN_PROGRESS;
  if (code === ERROR_CODES.badName) return ERROR_MESSAGES.BAD_NAME;
  if (code === ERROR_CODES.rateLimited || code === 429) return ERROR_MESSAGES.RATE_LIMITED;
  if (code === 503) return ERROR_MESSAGES.SERVER_BUSY;
  if (/not found|invalid.*room|no rooms|locked|ERR_MATCHMAKE_INVALID/i.test(message) || code === 4212 || code === 4211) {
    return "No room with that code. Check the letters and try again.";
  }
  if (/fetch|network|Failed|ECONN|timeout|WebSocket/i.test(message) || code === undefined) {
    return "Can't reach the game server. Check your connection and try again.";
  }
  return "Could not join the room. Try again.";
}

export const REJECT_MESSAGES: Record<string, string> = {
  NOT_HOST: "Only the host can do that.",
  NOT_ENOUGH_PLAYERS: "You need at least 2 players to start.",
  NOT_READY: "Everyone needs to be ready first.",
  NOT_TEAM_MODE: "Teams are not turned on for this room.",
  NEED_BOTH_TEAMS: "Each team needs at least one connected player.",
  STALE_QUESTION: "That question has already ended.",
  UNKNOWN_PLAYER: "You are no longer in this room.",
  TOO_MANY_PLAYERS: "That would be more players than the room allows.",
  ROOM_FULL: "This room is full.",
  NO_QUESTIONS: "No questions match those settings.",
  WRONG_PHASE: "That is not available right now.",
  ALREADY_ANSWERED: "You already locked in an answer.",
  TOO_LATE: "Time ran out before that answer arrived.",
  RATE_LIMITED: "Slow down a little.",
  BAD_REQUEST: "That request was not valid.",
  SERVER_ERROR: "Something went wrong on the server.",
};
