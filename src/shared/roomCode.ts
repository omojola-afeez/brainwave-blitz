import { ROOM_CODE } from "./constants";

/** Uppercases and drops spaces and dashes. Does not check validity. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE.length) return false;
  for (const ch of code) {
    if (!ROOM_CODE.alphabet.includes(ch)) return false;
  }
  return true;
}

/** Returns a clean code or null when the input cannot be one. */
export function parseRoomCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const clean = normalizeRoomCode(input);
  return isValidRoomCode(clean) ? clean : null;
}

/** Generates a code using the supplied byte source so tests can be deterministic. */
export function generateRoomCode(randomBytes: (n: number) => Uint8Array): string {
  const alphabet = ROOM_CODE.alphabet;
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < ROOM_CODE.length) {
    const bytes = randomBytes(ROOM_CODE.length * 2);
    for (const b of bytes) {
      if (b >= limit) continue;
      out += alphabet[b % alphabet.length];
      if (out.length === ROOM_CODE.length) break;
    }
  }
  return out;
}
