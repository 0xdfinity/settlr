import type { Config } from "./config.js";
import { PayPalClient, PayPalError } from "./paypal.js";
import type { Db } from "./db.js";
import { audit, tx } from "./db.js";

export type SettleAction = "capture" | "void";
export interface SettleOutcome { ok: boolean; dealStatus?: string; error?: string; dead?: boolean }

/** Idempotently settle a deal exactly once. Retries are delegated to the jobs table. */
export async function settleDeal(db: Db, paypal: PayPalClient, dealId: string, action: SettleAction, actor: string, maxAttempts = 5): Promise<SettleOutcome> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM deals WHERE id = $1 FOR UPDATE", [dealId]);
    const deal = rows[0];
    if (!deal) { await client.query("ROLLBACK"); return { ok: false, error: "deal_not_found" }; }
    if (["captured", "voided"].includes(deal.status)) {
      const s = await client.query("SELECT action FROM settlements WHERE deal_id = $1", [dealId]);
      await client.query("COMMIT");
      return { ok: true, dealStatus: deal.status, error: `already_${s.rows[0]?.action ?? "settled"}` };
    }
    if (deal.status !== "authorized" && deal.status !== "capture_pending") {
      await client.query("ROLLBACK");
      return { ok: false, error: `deal_not_settleable_in_state_${deal.status}` };
    }
    const requestId = `${deal.id}:${action}:1`;
    try {
      const result = action === "capture"
        ? await paypal.captureAuthorization(deal.paypal_authorization_id, requestId)
        : await paypal.voidAuthorization(deal.paypal_authorization_id, requestId);
      const providerId = extractProviderId(result, action, deal.id);
      if (!providerId) { await client.query("ROLLBACK"); return { ok: false, error: "paypal_no_provider_ref" }; }
      await client.query(
        "INSERT INTO settlements (deal_id, action, provider_ref, status, latency_ms) VALUES ($1, $2, $3, 'ok', $4)",
        [dealId, action, providerId, 0],
      );
      const newStatus = action === "capture" ? "captured" : "voided";
      await client.query(
        "UPDATE deals SET status = $1, paypal_capture_id = COALESCE($2, paypal_capture_id), updated_at = now() WHERE id = $3",
        [newStatus, action === "capture" ? providerId : null, dealId],
      );
      await audit(client, dealId, actor, `deal.${action}`, { provider_ref: providerId });
      await bumpMetrics(client, action);
      await client.query("COMMIT");
      return { ok: true, dealStatus: newStatus };
    } catch (err) {
      await client.query("ROLLBACK");
      const errMessage = String(err);
      if (errMessage.includes("AUTHORIZATION_VOIDED")) {
        // PayPal removed the hold out-of-band (typically from a successful void).
        // Persist the terminal state rather than leave the deal stranded.
        await db.query("UPDATE deals SET status = 'voided', updated_at = now() WHERE id = $1", [dealId]);
        await db.query("INSERT INTO audit_log (deal_id, actor, action, detail) VALUES ($1, $2, 'deal.voided_by_paypal', $3::jsonb)", [dealId, actor, JSON.stringify({ action, err: errMessage.slice(0, 500) })]);
        return { ok: true, dealStatus: "voided", error: "authorization_already_voided" };
      }
      const status = err instanceof PayPalError ? err.status : undefined;
      const isClientError = status !== undefined && status >= 400 && status < 500;
      if (isClientError) {
        // Terminal: mark dead in settlements so console shows it, but keep deal in capture_pending for manual handling
        await db.query(
          "INSERT INTO audit_log (deal_id, actor, action, detail) VALUES ($1, $2, 'deal.settle_failed', $3::jsonb)",
          [dealId, actor, JSON.stringify({ action, error: String(err), status })],
        );
        return { ok: false, error: String(err), dead: true };
      }
      await db.query(
        "INSERT INTO jobs (kind, payload) VALUES ($1, $2::jsonb)",
        [action === "capture" ? "capture_retry" : "void_retry", JSON.stringify({ dealId, actor })],
      );
      await db.query("UPDATE deals SET status = 'capture_pending', updated_at = now() WHERE id = $1", [dealId]);
      return { ok: false, error: String(err) };
    }
  } finally {
    client.release();
  }
}

function extractProviderId(result: Record<string, unknown>, action: SettleAction, dealId?: string): string | null {
  if (action === "capture") {
    const purchase = (result.purchase_units as Array<Record<string, unknown>> | undefined)?.[0];
    const captures = (purchase?.payments as Record<string, unknown> | undefined)?.captures as Array<Record<string, unknown>> | undefined;
    return (captures?.[0]?.id as string | undefined) ?? (result.id as string | undefined) ?? null;
  }
  return (result.id as string | undefined) ?? (dealId ? `paypal-void-${dealId}` : null);
}

async function bumpMetrics(q: { query: (text: string, params?: unknown[]) => Promise<unknown> }, action: SettleAction): Promise<void> {
  const col = action === "capture" ? "captured" : "voided";
  await q.query(
    `INSERT INTO metrics_daily (day, ${col}) VALUES (CURRENT_DATE, 1)
     ON CONFLICT (day) DO UPDATE SET ${col} = metrics_daily.${col} + 1`,
  );
}

export async function enqueueReconcile(db: Db, dealId: string): Promise<void> {
  await db.query("INSERT INTO jobs (kind, payload) VALUES ('reconcile_order', $1::jsonb)", [JSON.stringify({ dealId })]);
}
