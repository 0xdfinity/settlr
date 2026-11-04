import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import type { Config } from "./config.js";

export type Db = pg.Pool;

export function createDb(config: Config): Db {
  if (config.DATABASE_URL.startsWith("pglite://")) {
    // Dev mode: embedded Postgres (WASM) in-process. Single-writer; fine for local development.
    const dir = config.DATABASE_URL.replace("pglite://", "");
    const pglite = new PGlite(dir);
    const shim = {
      query: (text: string, params?: unknown[]) => pglite.query(text, params as never[]),
      connect: async () => ({ query: (text: string, params?: unknown[]) => pglite.query(text, params as never[]), release: () => undefined }),
      on: () => undefined,
      end: async () => pglite.close(),
    };
    return shim as unknown as Db;
  }
  // PGlite (dev embedded Postgres) is single-writer; keep the dev pool tiny.
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: config.NODE_ENV === "production" ? 10 : 2, idleTimeoutMillis: 10_000 });
  pool.on("error", (err) => console.error("postgres pool error", err));
  return pool;
}

export async function tx<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function audit(
  q: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  dealId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await q.query(
    "INSERT INTO audit_log (deal_id, actor, action, detail) VALUES ($1, $2, $3, $4::jsonb)",
    [dealId, actor, action, JSON.stringify(detail)],
  );
}
