import { existsSync } from "node:fs";
import path from "node:path";
import type { Server as HttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import express, { type Request } from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_TYPE } from "../shared/constants";
import { log } from "./log";
import { counters, snapshot } from "./metrics";
import { matchmakeLimiter } from "./runtime";
import { BlitzRoom } from "./rooms/BlitzRoom";

export interface StartOptions {
  port: number;
  staticDir?: string;
  /** Extra allowed origins for WebSocket and matchmaking requests, besides the host itself. */
  allowedOrigins?: string[];
  host?: string;
}

export interface Running {
  server: Server;
  port: number;
  stop: () => Promise<void>;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = typeof fwd === "string" ? fwd.split(",").at(-1)?.trim() : undefined;
  return first || req.socket.remoteAddress || "unknown";
}

/** Browsers always send Origin on cross-site requests. Same-host and listed origins pass. */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // non-browser clients (tests, health probes) send none
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function startServer(opts: StartOptions): Promise<Running> {
  const allowed = opts.allowedOrigins ?? [];

  const transport = new WebSocketTransport({
    pingInterval: 5000,
    pingMaxRetries: 3,
    maxPayload: 4 * 1024,
    beforeUpgrade: (request) => {
      const origin = request.headers.get("origin") ?? undefined;
      const host = request.headers.get("host") ?? undefined;
      if (!originAllowed(origin, host, allowed)) {
        log("warn", "origin_rejected");
        return new Response("Forbidden", { status: 403 });
      }
    },
  });

  const server = new Server({
    transport,
    greet: false,
    express: (app) => {
      app.disable("x-powered-by");

      app.get("/healthz", (_req, res) => {
        res.json({ ok: true });
      });
      app.get("/readyz", (_req, res) => {
        res.json({ ok: true, ready: !shuttingDown });
      });
      app.get("/api/metrics", (_req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json(snapshot());
      });

      const dir = opts.staticDir;
      if (dir && existsSync(path.join(dir, "index.html"))) {
        app.use(
          express.static(dir, {
            index: "index.html",
            setHeaders: (res, file) => {
              if (file.includes(`${path.sep}assets${path.sep}`)) {
                res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
              } else {
                res.setHeader("Cache-Control", "no-cache");
              }
            },
          }),
        );
        // Single page app: invitation links such as /join/ABCDE load the same page.
        app.get(/^\/(?!matchmake|api|healthz|readyz).*/, (_req, res) => {
          res.setHeader("Cache-Control", "no-cache");
          res.sendFile(path.join(dir, "index.html"));
        });
      }
    },
  });

  server.define(ROOM_TYPE, BlitzRoom);

  let shuttingDown = false;
  await server.listen(opts.port, opts.host);

  // Colyseus answers matchmaking routes before Express runs, so the checks sit in front of both.
  const http = (transport as unknown as { server: HttpServer }).server;
  const downstream = http.listeners("request") as Array<(req: IncomingMessage, res: ServerResponse) => void>;
  http.removeAllListeners("request");
  http.on("request", (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.url?.startsWith("/matchmake")) {
      if (!originAllowed(req.headers.origin, req.headers.host, allowed)) {
        res.writeHead(403, { "content-type": "application/json" }).end('{"error":"forbidden"}');
        return;
      }
      if (!matchmakeLimiter.allow(clientIp(req))) {
        counters.rateLimited += 1;
        res.writeHead(429, { "content-type": "application/json", "retry-after": "30" }).end('{"error":"rate_limited"}');
        return;
      }
    }
    for (const listener of downstream) listener.call(http, req, res);
  });
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  log("info", "server_listening", { port });

  return {
    server,
    port,
    stop: async () => {
      shuttingDown = true;
      await server.gracefullyShutdown(false);
    },
  };
}
