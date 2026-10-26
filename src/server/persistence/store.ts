import { randomUUID } from "node:crypto";
import pg from "pg";
import type { MatchSummary } from "../game/engine";

export interface MatchStore {
  saveMatch(summary: MatchSummary): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Returns a Postgres-backed store, or null when no DATABASE_URL is configured. */
export function createPgStore(url: string | undefined): MatchStore | null {
  if (!url) return null;
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 5_000,
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? undefined : { rejectUnauthorized: true },
  });
  pool.on("error", () => {
    // Idle clients can be dropped by the provider. The next query opens a new connection.
  });

  return {
    async ping() {
      await pool.query("select 1");
    },
    async close() {
      await pool.end();
    },
    async saveMatch(m) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const id = randomUUID();
        await client.query(
          `insert into matches (id, room_code, category, rounds, question_seconds, player_count, started_at, ended_at)
           values ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))`,
          [id, m.code, m.category, m.rounds, m.questionSeconds, m.players.length, m.startedAt, m.endedAt],
        );
        for (const [i, p] of m.players.entries()) {
          await client.query(
            `insert into match_players (match_id, position, avatar, final_rank, score, correct_count, best_streak, avg_correct_ms, left_early)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, i, p.avatar, p.rank, p.score, p.correctCount, p.bestStreak, p.avgCorrectMs, p.left],
          );
        }
        for (const q of m.questions) {
          await client.query(
            `insert into question_stats (question_id, times_asked, answered_total, correct_total)
             values ($1, 1, $2, $3)
             on conflict (question_id) do update set
               times_asked = question_stats.times_asked + 1,
               answered_total = question_stats.answered_total + excluded.answered_total,
               correct_total = question_stats.correct_total + excluded.correct_total,
               updated_at = now()`,
            [q.id, q.answeredPlayers, q.correctPlayers],
          );
        }
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
