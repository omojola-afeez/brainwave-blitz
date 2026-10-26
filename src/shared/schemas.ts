import { z } from "zod";
import { CATEGORY_CHOICES, LIMITS } from "./constants";

/** Letters, numbers, spaces and a few friendly symbols. No control characters or markup. */
const NAME_PATTERN = /^[\p{L}\p{N} ._'-]+$/u;

export function cleanName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export const nameSchema = z
  .string()
  .max(64)
  .transform(cleanName)
  .refine((v) => v.length >= LIMITS.nameMin && v.length <= LIMITS.nameMax, "name length")
  .refine((v) => NAME_PATTERN.test(v), "name characters");

export const avatarSchema = z.number().int().min(0).max(LIMITS.avatarCount - 1);

export const joinOptionsSchema = z
  .object({
    name: nameSchema,
    avatar: avatarSchema.default(0),
    /** Random id kept in the browser tab. Private: never shown to other players. */
    clientId: z
      .string()
      .min(16)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type JoinOptions = z.infer<typeof joinOptionsSchema>;

export const settingsSchema = z
  .object({
    category: z.enum(CATEGORY_CHOICES as [string, ...string[]]),
    rounds: z.number().int().refine((n) => (LIMITS.roundOptions as readonly number[]).includes(n)),
    questionSeconds: z
      .number()
      .int()
      .refine((n) => (LIMITS.questionSecondsOptions as readonly number[]).includes(n)),
    maxPlayers: z.number().int().min(LIMITS.minPlayers).max(LIMITS.maxPlayersCeiling),
  })
  .strict()
  .partial()
  .refine((o) => Object.keys(o).length > 0, "empty settings");
export type SettingsUpdate = z.infer<typeof settingsSchema>;

export const readySchema = z.object({ ready: z.boolean() }).strict();

export const answerSchema = z
  .object({
    q: z.number().int().min(0).max(99),
    choice: z.number().int().min(0).max(LIMITS.optionCount - 1),
  })
  .strict();

export const syncSchema = z.object({ t0: z.number().finite() }).strict();

export const emptySchema = z.object({}).strict().optional();

/** Message names shared by client and server. */
export const MSG = {
  setReady: "ready",
  setSettings: "settings",
  startMatch: "start",
  answer: "answer",
  playAgain: "play_again",
  backToLobby: "back_to_lobby",
  leave: "leave_room",
  sync: "sync",
  // server to client
  syncReply: "sync_reply",
  answerAck: "answer_ack",
  rejected: "rejected",
} as const;
