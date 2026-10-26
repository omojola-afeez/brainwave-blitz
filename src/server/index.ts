import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./app";
import { log } from "./log";
import { counters } from "./metrics";
import { createPgStore } from "./persistence/store";
import { configureRuntime } from "./runtime";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 2567);
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, "../web");
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const store = createPgStore(process.env.DATABASE_URL);
if (store) {
  configureRuntime({
    onMatchComplete: async (summary) => {
      await store.saveMatch(summary);
      counters.persistenceSaved += 1;
    },
  });
  void store.ping().then(
    () => log("info", "database_ready"),
    (err: unknown) => log("warn", "database_unreachable", { message: err instanceof Error ? err.message : "unknown" }),
  );
} else {
  log("info", "database_disabled", { reason: "DATABASE_URL not set" });
}

const running = await startServer({ port, staticDir, allowedOrigins });

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log("info", "shutdown_started", { signal });
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await running.stop();
    await store?.close();
  } catch (err) {
    log("error", "shutdown_failed", { message: err instanceof Error ? err.message : "unknown" });
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  counters.unexpectedErrors += 1;
  log("error", "unhandled_rejection", { message: reason instanceof Error ? reason.message : String(reason) });
});
process.on("uncaughtException", (err) => {
  counters.unexpectedErrors += 1;
  log("error", "uncaught_exception", { message: err.message });
});
