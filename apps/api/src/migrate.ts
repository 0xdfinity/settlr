import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../db/migrations");

async function createPgClient(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return { query: (text: string, params?: unknown[]) => client.query(text, params), end: () => client.end() };
}

async function createPgliteClient(dir: string) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = new PGlite(dir);
  await pglite.waitReady;
  return { query: (text: string, params?: unknown[]) => pglite.query(text, params as never[]), end: () => pglite.close() };
}

export async function migrate(databaseUrl: string): Promise<void> {
  const isPglite = databaseUrl.startsWith("pglite://");
  const client = isPglite
    ? await createPgliteClient(databaseUrl.replace("pglite://", ""))
    : await createPgClient(databaseUrl);
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const { rows } = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (rows.length) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`apply ${file} ...`);
      await client.query("BEGIN");
      if (isPglite) {
        // PGlite prepared statements can't run multi-command strings; split on ";" at line ends.
        const statements = sql
          .split(/;\s*(?:\r?\n|$)/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)+$/.test(s));
        for (const stmt of statements) await client.query(stmt);
      } else {
        await client.query(sql);
      }
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    }
    console.log("migrations complete");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && path.basename(entryPoint) === path.basename(fileURLToPath(import.meta.url))) {
  const config = loadConfig();
  migrate(config.DATABASE_URL).catch((err) => {
    console.error("migration failed", err);
    process.exit(1);
  });
}
