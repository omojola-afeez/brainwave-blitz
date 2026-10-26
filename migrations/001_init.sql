-- Brainwave Blitz durable records. Live game state stays in memory on the game server.
-- No player names, ip addresses or tokens are stored.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id         text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id               uuid PRIMARY KEY,
  room_code        text NOT NULL,
  category         text NOT NULL,
  rounds           smallint NOT NULL CHECK (rounds > 0),
  question_seconds smallint NOT NULL CHECK (question_seconds > 0),
  player_count     smallint NOT NULL CHECK (player_count >= 0),
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_ended_at_idx ON matches (ended_at DESC);

CREATE TABLE IF NOT EXISTS match_players (
  match_id        uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  position        smallint NOT NULL,
  avatar          smallint NOT NULL,
  final_rank      smallint NOT NULL,
  score           integer NOT NULL CHECK (score >= 0),
  correct_count   smallint NOT NULL CHECK (correct_count >= 0),
  best_streak     smallint NOT NULL CHECK (best_streak >= 0),
  avg_correct_ms  integer NOT NULL CHECK (avg_correct_ms >= 0),
  left_early      boolean NOT NULL,
  PRIMARY KEY (match_id, position)
);

CREATE TABLE IF NOT EXISTS question_stats (
  question_id     text PRIMARY KEY,
  times_asked     integer NOT NULL DEFAULT 0,
  answered_total  integer NOT NULL DEFAULT 0,
  correct_total   integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
