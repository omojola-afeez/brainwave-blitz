import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing to migrate.");
  process.exit(1);
}
const dir = path.resolve(import.meta.dirname, "../migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? undefined : { rejectUnauthorized: true },
});
await client.connect();
try {
  await client.query("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");
  for (const f of files) {
    const done = await client.query("select 1 from schema_migrations where id = $1", [f]);
    if (done.rowCount) {
      console.log(`skip ${f}`);
      continue;
    }
    await client.query("begin");
    await client.query(readFileSync(path.join(dir, f), "utf8"));
    await client.query("insert into schema_migrations (id) values ($1) on conflict do nothing", [f]);
    await client.query("commit");
    console.log(`applied ${f}`);
  }
} catch (err) {
  await client.query("rollback").catch(() => undefined);
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
