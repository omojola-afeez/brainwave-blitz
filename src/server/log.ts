type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return ORDER[raw as Level | "silent"] ?? ORDER.info;
}

/**
 * One JSON object per line. Callers pass room codes and counts, never player names,
 * reconnect tokens or client ids.
 */
export function log(level: Level, event: string, data: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}
