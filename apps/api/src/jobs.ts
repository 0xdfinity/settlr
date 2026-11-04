import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { PayPalClient } from "./paypal.js";
import { audit } from "./db.js";
import { settleDeal } from "./settlement.js";

export function startWorker(db: Db, paypal: PayPalClient, config: Config): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await expireDeals(db, paypal);
      await processJobs(db, paypal, config);
    } catch (err) {
      console.error("worker tick failed", err);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(tick, 30_000);
  tick();
  return () => clearInterval(interval);
}

async function expireDeals(db: Db, paypal: PayPalClient): Promise<void> {
  // Holds that were never released are voided so the buyer's funds return.
  const { rows: held } = await db.query(
    "SELECT id FROM deals WHERE status = 'authorized' AND expires_at < now() LIMIT 20",
  );
  for (const row of held) {
    await settleDeal(db, paypal, row.id, "void", "sweeper");
  }

  // Orders the buyer never approved: re-derive from PayPal once in case the
  // callback was lost, otherwise close the deal so it stops showing as open.
  const { rows: unapproved } = await db.query(
    "SELECT id FROM deals WHERE status = 'pending' AND expires_at < now() LIMIT 20",
  );
  for (const row of unapproved) {
    try {
      await reconcileOrder(db, paypal, row.id);
    } catch (err) {
      console.error(`expiry reconcile failed for ${row.id}`, err);
      continue;
    }
    const closed = await db.query(
      "UPDATE deals SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING id",
      [row.id],
    );
    if (closed.rows.length) await audit(db, row.id, "sweeper", "deal.expired", {});
  }
}

async function processJobs(db: Db, paypal: PayPalClient, _config: Config): Promise<void> {
  const client = await db.connect();
  let job: { id: string; kind: string; payload: { dealId?: string; actor?: string } } | null = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, kind, payload FROM jobs
       WHERE completed_at IS NULL AND dead = false AND run_at <= now() AND locked_at IS NULL
       ORDER BY run_at LIMIT 5 FOR UPDATE SKIP LOCKED`,
    );
    const claimed = rows[0] as { id: string; kind: string; payload: { dealId?: string; actor?: string } } | undefined;
    if (claimed) {
      job = claimed;
      await client.query("UPDATE jobs SET locked_at = now() WHERE id = $1", [claimed.id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("job claim failed", err);
    return;
  } finally {
    client.release();
  }
  if (!job) return;
  try {
    if (job.kind === "capture_retry" || job.kind === "void_retry") {
      const action = job.kind === "capture_retry" ? "capture" : "void";
      await settleDeal(db, paypal, job.payload.dealId!, action, job.payload.actor ?? "retry", 5);
      await db.query("UPDATE jobs SET completed_at = now(), locked_at = NULL WHERE id = $1", [job.id]);
    } else if (job.kind === "reconcile_order") {
      await reconcileOrder(db, paypal, job.payload.dealId!);
      await db.query("UPDATE jobs SET completed_at = now(), locked_at = NULL WHERE id = $1", [job.id]);
    }
  } catch (err) {
    console.error(`job ${job.kind} ${job.id} failed`, err);
    await db.query(
      `UPDATE jobs SET attempts = attempts + 1, locked_at = NULL,
        dead = (attempts + 1 >= max_attempts),
        run_at = now() + make_interval(mins => power(2, attempts + 1)::int)
       WHERE id = $1`,
      [job.id],
    );
  }
}

/** Re-derive deal state from PayPal (handles lost webhooks). */
export async function reconcileOrder(db: Db, paypal: PayPalClient, dealId: string): Promise<void> {
  const { rows } = await db.query("SELECT * FROM deals WHERE id = $1", [dealId]);
  const deal = rows[0];
  if (!deal?.paypal_order_id) return;
  const order = (await paypal.showOrder(deal.paypal_order_id)) as Record<string, unknown>;
  const status = String(order.status ?? "");
  if (status === "APPROVED" || status === "COMPLETED") {
    await authorizeAndStore(db, paypal, dealId, status === "APPROVED", "sweeper");
  }
}

/** Authorize an order post-approval and persist the authorization id. Idempotent. */
export async function authorizeAndStore(db: Db, paypal: PayPalClient, dealId: string, orderApproved: boolean, actor: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM deals WHERE id = $1 FOR UPDATE", [dealId]);
    const deal = rows[0];
    if (!deal) { await client.query("ROLLBACK"); return; }
    if (deal.status === "authorized" && deal.paypal_authorization_id) { await client.query("COMMIT"); return; }
    if (!orderApproved && deal.status === "authorized") { await client.query("COMMIT"); return; }
    const result = (await paypal.authorizeOrder(deal.paypal_order_id, `${deal.id}:authorize:1`)) as Record<string, unknown>;
    const units = (result.purchase_units as Array<Record<string, unknown>> | undefined) ?? [];
    const authorizations = ((units[0]?.payments as Record<string, unknown> | undefined)?.authorizations as Array<Record<string, unknown>> | undefined) ?? [];
    const authorizationId = (authorizations[0]?.id as string | undefined) ?? null;
    if (!authorizationId) { await client.query("ROLLBACK"); throw new Error("paypal_authorize_returned_no_authorization_id"); }
    await client.query(
      "UPDATE deals SET status = 'authorized', paypal_authorization_id = $1, updated_at = now() WHERE id = $2",
      [authorizationId, dealId],
    );
    await client.query(
      `INSERT INTO metrics_daily (day, authorized) VALUES (CURRENT_DATE, 1)
       ON CONFLICT (day) DO UPDATE SET authorized = metrics_daily.authorized + 1`,
    );
    await audit(client, dealId, actor, "deal.authorized", { authorization_id: authorizationId });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
