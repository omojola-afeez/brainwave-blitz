import { describe, expect, it } from "vitest";
import { ROOM_CODE } from "../../src/shared/constants";
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, parseRoomCode } from "../../src/shared/roomCode";
import { joinOptionsSchema, answerSchema, settingsSchema } from "../../src/shared/schemas";

describe("room codes", () => {
  it("normalizes case, spaces and dashes", () => expect(normalizeRoomCode(" ab-c d2 ")).toBe("ABCD2"));
  it("accepts a valid code", () => expect(parseRoomCode("k7m2p")).toBe("K7M2P"));
  it("rejects wrong length", () => {
    expect(parseRoomCode("ABCD")).toBeNull();
    expect(parseRoomCode("ABCDEF")).toBeNull();
  });
  it("rejects ambiguous characters", () => {
    for (const bad of ["0ABCD", "OABCD", "1ABCD", "IABCD", "LABCD"]) expect(isValidRoomCode(bad)).toBe(false);
  });
  it("rejects non-strings and oversize input", () => {
    expect(parseRoomCode(undefined)).toBeNull();
    expect(parseRoomCode(12345)).toBeNull();
    expect(parseRoomCode("A".repeat(500))).toBeNull();
  });
  it("rejects punctuation and markup", () => {
    expect(parseRoomCode("<b>AB")).toBeNull();
    expect(parseRoomCode("AB;DROP")).toBeNull();
  });
  it("generates valid codes with the right alphabet", () => {
    const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode(bytes);
      expect(code).toHaveLength(ROOM_CODE.length);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });
  it("skips bytes that would bias the output", () => {
    const biased = (n: number) => new Uint8Array(n).fill(255);
    let calls = 0;
    const source = (n: number) => {
      calls++;
      return calls < 3 ? biased(n) : new Uint8Array(n).fill(0);
    };
    expect(generateRoomCode(source)).toBe(ROOM_CODE.alphabet[0]!.repeat(ROOM_CODE.length));
  });
});

const CID = "abcdef0123456789abcdef";

describe("message schemas", () => {
  it("requires a client id", () => {
    expect(joinOptionsSchema.safeParse({ name: "Ada", avatar: 0 }).success).toBe(false);
  });
  it("accepts a clean name and trims it", () => {
    const r = joinOptionsSchema.parse({ name: "  Ada   Obi ", avatar: 3, clientId: CID });
    expect(r.name).toBe("Ada Obi");
  });
  it("rejects empty, long and markup names", () => {
    for (const name of ["", "   ", "x".repeat(17), "<script>", "a\u0000b", "a\u202eb"]) {
      expect(joinOptionsSchema.safeParse({ name, avatar: 0, clientId: CID }).success).toBe(false);
    }
  });
  it("collapses line breaks and tabs into single spaces instead of keeping them", () => {
    expect(joinOptionsSchema.parse({ name: "a\n\tb", avatar: 0, clientId: CID }).name).toBe("a b");
  });
  it("accepts accented and non-Latin letters", () => {
    expect(joinOptionsSchema.safeParse({ name: "Chidi Okafor", avatar: 0, clientId: CID }).success).toBe(true);
    expect(joinOptionsSchema.safeParse({ name: "Zoë", avatar: 0, clientId: CID }).success).toBe(true);
    expect(joinOptionsSchema.safeParse({ name: "李雷", avatar: 0, clientId: CID }).success).toBe(true);
  });
  it("rejects unknown fields and bad avatars", () => {
    expect(joinOptionsSchema.safeParse({ name: "A", avatar: 0, clientId: CID, admin: true }).success).toBe(false);
    expect(joinOptionsSchema.safeParse({ name: "A", avatar: 99, clientId: CID }).success).toBe(false);
  });
  it("validates answers strictly", () => {
    expect(answerSchema.safeParse({ q: 0, choice: 3 }).success).toBe(true);
    expect(answerSchema.safeParse({ q: 0, choice: 4 }).success).toBe(false);
    expect(answerSchema.safeParse({ q: -1, choice: 0 }).success).toBe(false);
    expect(answerSchema.safeParse({ q: 0, choice: 1.5 }).success).toBe(false);
    expect(answerSchema.safeParse({ q: 0, choice: 1, correct: true }).success).toBe(false);
  });
  it("validates settings and rejects empty or unknown values", () => {
    expect(settingsSchema.safeParse({ rounds: 10 }).success).toBe(true);
    expect(settingsSchema.safeParse({ rounds: 7 }).success).toBe(false);
    expect(settingsSchema.safeParse({ category: "cooking" }).success).toBe(false);
    expect(settingsSchema.safeParse({}).success).toBe(false);
    expect(settingsSchema.safeParse({ maxPlayers: 13 }).success).toBe(false);
  });
});
