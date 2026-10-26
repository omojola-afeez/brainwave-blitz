/** Browser-side identity and resume data. Everything here is optional and wrapped in try/catch. */

const CLIENT_ID_KEY = "bb.clientId";
const TOKEN_KEY = "bb.resume";
const NAME_KEY = "bb.name";
const AVATAR_KEY = "bb.avatar";

function randomId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-tab id. A second tab gets its own id so it counts as a different player. */
export function getClientId(): string {
  try {
    const existing = sessionStorage.getItem(CLIENT_ID_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const fresh = randomId();
    sessionStorage.setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    return memoryId;
  }
}
const memoryId = randomId();

export interface ResumeInfo {
  code: string;
  token: string;
}

export function saveResume(info: ResumeInfo): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(info));
  } catch {
    /* ignore */
  }
}

export function loadResume(): ResumeInfo | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResumeInfo>;
    if (typeof parsed.code === "string" && typeof parsed.token === "string") {
      return { code: parsed.code, token: parsed.token };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearResume(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function loadProfile(): { name: string; avatar: number } {
  try {
    const name = localStorage.getItem(NAME_KEY) ?? "";
    const avatar = Number(localStorage.getItem(AVATAR_KEY) ?? "0");
    return { name, avatar: Number.isInteger(avatar) && avatar >= 0 && avatar < 12 ? avatar : 0 };
  } catch {
    return { name: "", avatar: 0 };
  }
}

export function saveProfile(name: string, avatar: number): void {
  try {
    localStorage.setItem(NAME_KEY, name);
    localStorage.setItem(AVATAR_KEY, String(avatar));
  } catch {
    /* ignore */
  }
}
