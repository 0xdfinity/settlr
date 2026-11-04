import "./env.js";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { createDb, tx, audit } from "./db.js";
import { PayPalClient, PayPalError } from "./paypal.js";
import { verifyProof } from "./verifier.js";
import { settleDeal, type SettleAction } from "./settlement.js";
import { adjudicateProof, AI_ENABLED, draftDeal, explainDecision, type CatalogOffer } from "./ai.js";
import { searchCatalog } from "./channel3.js";
import { authorizeAndStore, startWorker } from "./jobs.js";
import { createSession, destroySession, generateToken, hashPassword, hashToken, sessionUser, verifyPassword, type Identity } from "./auth.js";

const config = loadConfig();
const db = createDb(config);
const paypal = new PayPalClient(config);

const app = Fastify({ logger: { level: process.env.NODE_ENV === "production" ? "info" : "debug" }, trustProxy: true });

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: config.WEB_ORIGINS.split(",").map((s) => s.trim()), credentials: true });
await app.register(cookie);
await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });

// ---------- helpers ----------

const usd = (cents: number) => Number((cents / 100).toFixed(2));
const badRequest = (reply: import("fastify").FastifyReply, code: string, message: string, details?: unknown) =>
  reply.code(400).send({ code, message, ...(details ? { details } : {}) });

async function requireIdentity(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply): Promise<Identity | null> {
  const id = await sessionUser(db, req);
  if (!id) {
    reply.code(401).send({ code: "unauthenticated", message: "Sign in, or present a Settlr API key as Authorization: Bearer" });
    return null;
  }
  return id;
}

async function idempotent<T>(userId: string, key: string | undefined, fn: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T }> {
  if (!key) throw Object.assign(new Error("Idempotency-Key header required"), { statusCode: 400 });
  const { rows } = await db.query("SELECT response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key]);
  if (rows[0]) return { status: rows[0].response_status, body: rows[0].response_body as T };
  const result = await fn();
  await db.query("INSERT INTO idempotency_keys (user_id, key, response_status, response_body) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING", [userId, key, result.status, JSON.stringify(result.body)]);
  return result;
}

function dealView(row: Record<string, unknown>) {
  return {
    id: row.id,
    amountUsd: usd(Number(row.amount_cents)),
    currency: row.currency,
    status: row.status,
    description: row.description,
    merchant: row.merchant,
    merchantUrl: row.merchant_url,
    category: row.category,
    proofSpec: row.proof_spec,
    proofStatus: row.status === "captured" || row.status === "voided" ? "done" : "none",
    deliveryContract: row.delivery_contract,
    offer: row.offer,
    aiVerdict: row.ai_verdict,
    aiConfidence: row.ai_confidence === null || row.ai_confidence === undefined ? null : Number(row.ai_confidence),
    aiReasoning: row.ai_reasoning,
    reviewState: row.review_state,
    paypalOrderId: row.paypal_order_id,
    authorizationId: row.paypal_authorization_id,
    captureId: row.paypal_capture_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

const dealSelect = "SELECT * FROM deals";

// ---------- auth ----------

const passwordSchema = z.string().min(10).max(200);

app.post("/v1/auth/signup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  const parsed = z.object({ email: z.string().email(), password: passwordSchema, name: z.string().min(1).max(120) }).safeParse(req.body);
  if (!parsed.success) return badRequest(reply, "invalid_body", "email, password (min 10 chars), name required", parsed.error.flatten());
  const { email, password, name } = { ...parsed.data, email: parsed.data.email.toLowerCase() };
  try {
    const { rows } = await db.query(
      "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at",
      [email, hashPassword(password), name],
    );
    await createSession(db, rows[0].id, reply);
    return reply.code(201).send({ id: rows[0].id, email: rows[0].email, name: rows[0].name, createdAt: rows[0].created_at });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
      return reply.code(409).send({ code: "email_taken", message: "That email is already registered" });
    }
    throw err;
  }
});

app.post("/v1/auth/signin", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return badRequest(reply, "invalid_body", "email and password required");
  const { rows } = await db.query("SELECT id, email, name, password_hash, created_at FROM users WHERE email = $1", [parsed.data.email.toLowerCase()]);
  const user = rows[0];
  if (!user || !verifyPassword(user.password_hash, parsed.data.password)) {
    return reply.code(401).send({ code: "invalid_credentials", message: "Email or password is incorrect" });
  }
  await createSession(db, user.id, reply);
  return { id: user.id, email: user.email, name: user.name, createdAt: user.created_at };
});

app.post("/v1/auth/signout", async (req, reply) => {
  await destroySession(db, req, reply);
  return reply.code(204).send();
});

app.get("/v1/auth/me", async (req, reply) => {
  const id = await requireIdentity(req, reply);
  if (!id) return;
  const { rows } = await db.query("SELECT id, email, name, created_at FROM users WHERE id = $1", [id.userId]);
  if (!rows[0]) return reply.code(401).send({ code: "unauthenticated", message: "Session user not found" });
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name, createdAt: rows[0].created_at };
});

// ---------- API keys (MCP) ----------

app.post("/v1/api-keys", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const parsed = z.object({ name: z.string().min(3).max(80), scopes: z.array(z.enum(["deal:create", "proof:submit", "deal:read"])).optional() }).safeParse(req.body);
  if (!parsed.success) return badRequest(reply, "invalid_body", "name (>=3 chars) required", parsed.error.flatten());
  const raw = generateToken("settlr_live_");
  const { rows } = await db.query(
    "INSERT INTO api_keys (user_id, name, prefix, key_hash, scopes) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [id.userId, parsed.data.name, raw.slice(0, 16), hashToken(raw), parsed.data.scopes ?? ["deal:create", "proof:submit", "deal:read"]],
  );
  return reply.code(201).send({ id: rows[0].id, name: parsed.data.name, key: raw });
});

app.get("/v1/api-keys", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { rows } = await db.query(
    "SELECT id, name, prefix, scopes, last_used_at, created_at FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
    [id.userId],
  );
  return rows;
});

app.delete("/v1/api-keys/:keyId", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { keyId } = req.params as { keyId: string };
  await db.query("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2", [keyId, id.userId]);
  return reply.code(204).send();
});

// ---------- deals ----------

const proofSpecSchema = z.object({
  url: z.string().url().nullish(),
  expectStatus: z.number().int().min(100).max(599).nullish(),
  expectBodyContains: z.string().max(200).nullish(),
  llmPrompt: z.string().max(500).nullish(),
});

const dealCreateSchema = z.object({
  amountUsd: z.number().positive().max(10000),
  currency: z.literal("USD").default("USD"),
  description: z.string().min(3).max(500),
  merchant: z.string().max(200).nullish(),
  merchantUrl: z.string().url().nullish(),
  category: z.string().max(80).nullish(),
  deliveryContract: z.string().max(600).nullish(),
  offer: z.object({
    title: z.string().max(200),
    merchant: z.string().max(200),
    priceUsd: z.number().nonnegative(),
    url: z.string().max(2_000),
    imageUrl: z.string().max(2_000).nullable().optional(),
    source: z.string().max(40),
  }).nullish(),
  proofSpec: proofSpecSchema.default({}),
  expiresMinutes: z.number().int().min(5).max(1440).default(60),
});

app.post("/v1/deals", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const parsed = dealCreateSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(reply, "invalid_body", "Fix the request body", parsed.error.flatten());
  const body = parsed.data;
  const key = req.headers["idempotency-key"] as string | undefined;
  try {
    const result = await idempotent(id.userId, key, async () => {
      const deal = await tx(db, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO deals (user_id, amount_cents, currency, description, merchant, merchant_url, category, proof_spec, delivery_contract, offer, expires_at)
           VALUES ($1, $2, 'USD', $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, now() + ($10 || ' minutes')::interval)
           RETURNING *`,
          [id.userId, Math.round(body.amountUsd * 100), body.description, body.merchant ?? null, body.merchantUrl ?? null, body.category ?? null, JSON.stringify(body.proofSpec ?? {}), body.deliveryContract ?? null, body.offer ? JSON.stringify(body.offer) : null, String(body.expiresMinutes)],
        );
        return rows[0];
      });
      let order: { id: string; status: string; links: { rel: string; href: string; method: string }[] };
      try {
        order = await paypal.createAuthorizeOrder({
          amountUsd: (Math.round(body.amountUsd * 100) / 100).toFixed(2),
          referenceId: deal.id,
          description: body.description,
          requestId: `${deal.id}:create`,
        });
      } catch (err) {
        await db.query("UPDATE deals SET status = 'failed', updated_at = now() WHERE id = $1", [deal.id]);
        await audit(db, deal.id, id.actor, "deal.paypal_create_failed", { error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
        throw err;
      }
      const approveUrl = (order.links ?? []).find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
      await db.query("UPDATE deals SET paypal_order_id = $1, updated_at = now() WHERE id = $2", [order.id, deal.id]);
      await db.query(`INSERT INTO audit_log (deal_id, actor, action, detail) VALUES ($1, $2, 'deal.created', $3::jsonb)`, [deal.id, id.actor, JSON.stringify({ paypal_order_id: order.id })]);
      return { status: 201 as const, body: { ...dealView({ ...deal, paypal_order_id: order.id }), approveUrl } };
    });
    return reply.code(result.status).send(result.body);
  } catch (err) {
    if (err instanceof Error && "statusCode" in err && (err as { statusCode?: number }).statusCode === 400) {
      return badRequest(reply, "idempotency_key_required", "Idempotency-Key header required on POST /v1/deals");
    }
    throw err;
  }
});

app.get("/v1/deals", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const q = req.query as { status?: string; limit?: string; offset?: string; order?: string };
  const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
  const statusFilter = ["pending", "authorized", "capture_pending", "review_required", "captured", "voided", "expired", "failed"].includes(q.status ?? "") ? q.status : null;
  const orderBy = q.order === "amount_desc" ? "amount_cents DESC" : q.order === "created_at_asc" ? "created_at ASC" : "created_at DESC";
  const where = statusFilter ? "WHERE user_id = $1 AND status = $2" : "WHERE user_id = $1";
  const params: unknown[] = statusFilter ? [id.userId, statusFilter, limit, offset] : [id.userId, limit, offset];
  const { rows } = await db.query(`${dealSelect} ${where} ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const countParams: unknown[] = statusFilter ? [id.userId, statusFilter] : [id.userId];
  const { rows: countRows } = await db.query(`SELECT count(*)::int AS total FROM deals ${where}`, countParams);
  return { items: rows.map(dealView), total: countRows[0]?.total ?? 0 };
});

app.get("/v1/deals/by-order/:orderId", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { orderId } = req.params as { orderId: string };
  const { rows } = await db.query(`${dealSelect} WHERE paypal_order_id = $1 AND user_id = $2`, [orderId, id.userId]);
  if (!rows[0]) return reply.code(404).send({ code: "not_found", message: "No deal for that PayPal order" });
  return dealView(rows[0]);
});

app.get("/v1/deals/:dealId", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { dealId } = req.params as { dealId: string };
  const { rows } = await db.query(`${dealSelect} WHERE id = $1 AND user_id = $2`, [dealId, id.userId]);
  const deal = rows[0];
  if (!deal) return reply.code(404).send({ code: "not_found", message: "Deal not found" });
  const { rows: auditRows } = await db.query("SELECT id, actor, action, detail, created_at FROM audit_log WHERE deal_id = $1 ORDER BY id DESC LIMIT 50", [dealId]);
  const { rows: proofRows } = await db.query("SELECT kind, url, checks, passed, reason, latency_ms, created_at, ai_verdict, ai_confidence, ai_reasoning FROM proof_attempts WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 20", [dealId]);
  return { ...dealView(deal), audit: auditRows, proofAttempts: proofRows };
});

app.post("/v1/deals/:dealId/approve-callback", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { dealId } = req.params as { dealId: string };
  const { rows } = await db.query(`${dealSelect} WHERE id = $1 AND user_id = $2`, [dealId, id.userId]);
  if (!rows[0]) return reply.code(404).send({ code: "not_found", message: "Deal not found" });
  const order = await paypal.showOrder(rows[0].paypal_order_id).catch(() => null);
  const status = String((order as Record<string, unknown> | null)?.status ?? "");
  if (status === "APPROVED" || status === "COMPLETED") {
    await authorizeAndStore(db, paypal, dealId, true, id.actor);
  }
  const { rows: after } = await db.query(`${dealSelect} WHERE id = $1`, [dealId]);
  return dealView(after[0]);
});

app.post("/v1/deals/:dealId/proof", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { dealId } = req.params as { dealId: string };
  const { rows } = await db.query(`${dealSelect} WHERE id = $1 AND user_id = $2`, [dealId, id.userId]);
  const deal = rows[0];
  if (!deal) return reply.code(404).send({ code: "not_found", message: "Deal not found" });
  if (deal.status !== "authorized" && deal.status !== "capture_pending") {
    return reply.code(409).send({ code: "deal_not_awaiting_proof", message: `Deal is ${deal.status}; only authorized deals accept proof` });
  }
  const parsed = z.object({
    kind: z.enum(["http_check", "url_screenshot", "log"]),
    url: z.string().url().nullish(),
    expectStatus: z.number().int().min(100).max(599).nullish(),
    expectBodyContains: z.string().max(200).nullish(),
    note: z.string().max(1000).nullish(),
  }).safeParse(req.body);
  if (!parsed.success) return badRequest(reply, "invalid_body", "kind required (http_check|url_screenshot|log)", parsed.error.flatten());
  const submission = parsed.data;
  const spec = { ...(deal.proof_spec as Record<string, unknown>), ...Object.fromEntries(Object.entries(submission).filter(([, v]) => v != null)) } as Parameters<typeof verifyProof>[1];
  const result = await verifyProof(config, spec);

  let aiVerdict: string | null = null;
  let aiConfidence: number | null = null;
  let aiReasoning: string | null = null;
  let outcome: "captured" | "voided" | "review_required" = result.passed ? "captured" : "voided";

  if (result.passed && AI_ENABLED(config)) {
    const adjudication = await adjudicateProof(config, {
      description: deal.description,
      deliveryContract: (deal.delivery_contract as string | null) ?? deal.description,
      checks: result.checks,
      evidence: [
        submission.note ? `Agent note: ${submission.note}` : "",
        `Endpoint: ${spec.url ?? "none"}`,
        `Response: ${result.excerpt || "(empty)"}`,
      ].filter(Boolean).join("\n"),
    });
    if (adjudication) {
      aiVerdict = adjudication.verdict;
      aiConfidence = adjudication.confidence;
      aiReasoning = [
        adjudication.reasoning,
        ...adjudication.missing.map((m) => `Missing: ${m}`),
        ...adjudication.contradictions.map((c) => `Contradiction: ${c}`),
      ].join(" ").slice(0, 1_000);
      if (adjudication.verdict === "underdelivered" && adjudication.confidence >= 0.7) {
        outcome = "voided";
      } else if (adjudication.verdict === "ambiguous" || adjudication.confidence < 0.55) {
        outcome = "review_required";
      }
    }
  }

  await db.query(
    "INSERT INTO proof_attempts (deal_id, kind, url, request, checks, passed, reason, latency_ms, ai_verdict, ai_confidence, ai_reasoning) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11)",
    [dealId, submission.kind, submission.url ?? (deal.proof_spec as Record<string, unknown>).url ?? null, JSON.stringify(submission), JSON.stringify(result.checks), result.passed, aiReasoning ?? result.reason, result.latencyMs, aiVerdict, aiConfidence, aiReasoning],
  );

  if (outcome === "review_required") {
    await db.query(
      "UPDATE deals SET status = 'review_required', review_state = 'pending', ai_verdict = $1, ai_confidence = $2, ai_reasoning = $3, updated_at = now() WHERE id = $4",
      [aiVerdict, aiConfidence, aiReasoning, dealId],
    );
    await audit(db, dealId, id.actor, "proof.review_required", { reason: aiReasoning ?? result.reason });
  } else {
    await audit(db, dealId, id.actor, result.passed ? "proof.passed" : "proof.failed", { reason: result.reason });
    const settle = await settleDeal(db, paypal, dealId, outcome === "captured" ? "capture" : "void", id.actor);
    await db.query(
      "UPDATE deals SET ai_verdict = COALESCE($1, ai_verdict), ai_confidence = COALESCE($2, ai_confidence), ai_reasoning = COALESCE($3, ai_reasoning) WHERE id = $4",
      [aiVerdict, aiConfidence, aiReasoning, dealId],
    );
    if (!settle.ok) {
      const { rows: failed } = await db.query(`${dealSelect} WHERE id = $1`, [dealId]);
      return reply.code(502).send({ code: "settlement_failed", message: settle.error ?? "Settlement failed", passed: result.passed, outcome, checks: result.checks, ai: aiVerdict ? { verdict: aiVerdict, confidence: aiConfidence, reasoning: aiReasoning } : null, deal: dealView(failed[0]) });
    }
  }

  const { rows: after } = await db.query(`${dealSelect} WHERE id = $1`, [dealId]);
  return reply.code(outcome === "review_required" ? 202 : outcome === "captured" ? 200 : 422).send({
    passed: result.passed,
    outcome,
    checks: result.checks,
    reason: aiReasoning ?? result.reason,
    ai: aiVerdict ? { verdict: aiVerdict, confidence: aiConfidence, reasoning: aiReasoning } : null,
    deal: dealView(after[0]),
  });
});

// Human review gate: an ambiguous AI verdict never moves money on its own.
app.post("/v1/deals/:dealId/review", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { dealId } = req.params as { dealId: string };
  const parsed = z.object({ action: z.enum(["capture", "void"]), reason: z.string().min(10).max(500) }).safeParse(req.body);
  if (!parsed.success) return badRequest(reply, "invalid_body", "action (capture|void) and reason (>=10 chars) required");
  const { rows } = await db.query("SELECT id, status FROM deals WHERE id = $1 AND user_id = $2", [dealId, id.userId]);
  if (!rows[0]) return reply.code(404).send({ code: "not_found", message: "Deal not found" });
  if (rows[0].status !== "review_required") return reply.code(409).send({ code: "not_in_review", message: `Deal is ${rows[0].status}; only review_required deals can be resolved` });
  await audit(db, dealId, `reviewer:${id.userId}`, "deal.reviewed", { action: parsed.data.action, reason: parsed.data.reason });
  await db.query("UPDATE deals SET review_state = 'resolved', status = 'authorized', updated_at = now() WHERE id = $1", [dealId]);
  const settle = await settleDeal(db, paypal, dealId, parsed.data.action, `reviewer:${id.userId}`);
  if (!settle.ok) return reply.code(502).send({ code: "settlement_failed", message: settle.error });
  const { rows: after } = await db.query(`${dealSelect} WHERE id = $1`, [dealId]);
  return dealView(after[0]);
});

app.post("/v1/deals/:dealId/force-settle", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { dealId } = req.params as { dealId: string };
  const parsed = z.object({ action: z.enum(["capture", "void"]), reason: z.string().min(10).max(500) }).safeParse(req.body);
  if (!parsed.success) return badRequest(reply, "invalid_body", "action (capture|void) and reason (>=10 chars) required");
  const { rows } = await db.query("SELECT id FROM deals WHERE id = $1 AND user_id = $2", [dealId, id.userId]);
  if (!rows[0]) return reply.code(404).send({ code: "not_found", message: "Deal not found" });
  await audit(db, dealId, `admin:${id.userId}`, "deal.force_settle", { action: parsed.data.action, reason: parsed.data.reason });
  const settle = await settleDeal(db, paypal, dealId, parsed.data.action as SettleAction, `admin:${id.userId}`);
  if (!settle.ok && settle.dead) return reply.code(502).send({ code: "paypal_terminal", message: settle.error });
  const { rows: after } = await db.query(`${dealSelect} WHERE id = $1`, [dealId]);
  return dealView(after[0]);
});

// ---------- catalog + planning (Channel3, AI) ----------

app.get("/v1/catalog/search", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const q = req.query as { q?: string; maxPrice?: string; limit?: string };
  if (!q.q || q.q.trim().length < 3) return badRequest(reply, "invalid_query", "q (>=3 chars) required");
  if (!config.CHANNEL3_API_KEY) return reply.code(503).send({ code: "channel3_not_configured", message: "CHANNEL3_API_KEY not set on the API" });
  const result = await searchCatalog(config, {
    query: q.q,
    maxPrice: q.maxPrice ? Number(q.maxPrice) : undefined,
    limit: Number(q.limit ?? 6),
    userId: id.userId,
  });
  if (result.error && result.offers.length === 0) return reply.code(502).send({ code: "channel3_error", message: "Catalog search failed", details: result.error });
  return result.offers;
});

app.post("/v1/ai/draft", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const parsed = z.object({
    intent: z.string().min(8).max(1_000),
    budgetUsd: z.number().positive().max(10_000),
    category: z.string().max(80).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return badRequest(reply, "invalid_body", "intent (>=8 chars) and budgetUsd required", parsed.error.flatten());
  if (!AI_ENABLED(config)) return reply.code(503).send({ code: "ai_not_configured", message: "AI planner is not configured" });
  const { intent, budgetUsd, category } = parsed.data;
  const catalog = await searchCatalog(config, {
    query: `${intent} ${category ?? ""}`.trim(),
    maxPrice: budgetUsd,
    limit: 6,
    userId: id.userId,
  });
  const draft = await draftDeal(config, { intent, budgetUsd, offers: catalog.offers as CatalogOffer[] });
  if (!draft) return reply.code(503).send({ code: "ai_unavailable", message: "The planner could not produce a contract; use the contract form." });
  return { draft, offers: catalog.offers, catalogError: catalog.error ?? null };
});

app.post("/v1/ai/explain/:dealId", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { dealId } = req.params as { dealId: string };
  const { rows } = await db.query(`${dealSelect} WHERE id = $1 AND user_id = $2`, [dealId, id.userId]);
  const deal = rows[0];
  if (!deal) return reply.code(404).send({ code: "not_found", message: "Deal not found" });
  const { rows: proofs } = await db.query("SELECT checks, passed, reason, ai_verdict, ai_reasoning FROM proof_attempts WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 1", [dealId]);
  const proof = proofs[0];
  const amountUsd = usd(Number(deal.amount_cents));
  const fallback = {
    headline: deal.ai_verdict === "underdelivered" ? "Delivery fell short of the contract" : deal.status === "captured" ? "Funds released after delivery passed" : deal.status === "voided" ? "Hold released without payment" : deal.status === "review_required" ? "Waiting for a human decision" : "Authorization is still open",
    detail: proof?.ai_reasoning ?? proof?.reason ?? "No proof has been submitted for this deal yet.",
    next: deal.status === "review_required" ? "Review the evidence, then capture or void the hold." : deal.status === "authorized" ? "Submit delivery proof to release or return the funds." : "No action required.",
  };
  const explanation = await explainDecision(config, {
    status: deal.status,
    description: deal.description,
    amountUsd,
    checks: (proof?.checks as { name: string; passed: boolean; detail: string }[] | undefined) ?? [],
    reason: (proof?.reason as string | undefined) ?? "",
    aiVerdict: (deal.ai_verdict as string | null) ?? null,
    aiReasoning: (deal.ai_reasoning as string | null) ?? null,
  }).catch(() => null);
  return explanation ?? fallback;
});

// ---------- analytics (operations dashboard) ----------

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

app.get("/v1/analytics", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { rows } = await db.query(
    "SELECT id, status, amount_cents, merchant, created_at FROM deals WHERE user_id = $1 AND created_at > now() - interval '90 days' ORDER BY created_at ASC",
    [id.userId],
  );
  const { rows: proofRows } = await db.query(
    "SELECT p.latency_ms FROM proof_attempts p JOIN deals d ON d.id = p.deal_id WHERE d.user_id = $1 ORDER BY p.created_at DESC LIMIT 500",
    [id.userId],
  );
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const dailyMap = new Map<string, { day: string; created: number; captured: number; voided: number; capturedUsd: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = dayKey(d);
    dailyMap.set(key, { day: key, created: 0, captured: 0, voided: 0, capturedUsd: 0 });
  }
  const merchants = new Map<string, { merchant: string; deals: number; capturedUsd: number; voided: number; captured: number }>();
  const outcomes = new Map<string, { status: string; count: number; amountUsd: number }>();
  let lockedCents = 0;
  let capturedCents = 0;
  for (const row of rows) {
    const cents = Number(row.amount_cents);
    const day = dailyMap.get(dayKey(new Date(row.created_at as string)));
    if (day) day.created += 1;
    if (row.status === "authorized") lockedCents += cents;
    if (row.status === "captured") capturedCents += cents;
    if (day && row.status === "captured") { day.captured += 1; day.capturedUsd += cents / 100; }
    if (day && row.status === "voided") day.voided += 1;
    const merchant = (row.merchant as string | null) ?? "Unlisted";
    const m = merchants.get(merchant) ?? { merchant, deals: 0, capturedUsd: 0, voided: 0, captured: 0 };
    m.deals += 1;
    if (row.status === "captured") { m.captured += 1; m.capturedUsd += cents / 100; }
    if (row.status === "voided") m.voided += 1;
    merchants.set(merchant, m);
    const o = outcomes.get(row.status) ?? { status: row.status, count: 0, amountUsd: 0 };
    o.count += 1;
    o.amountUsd += cents / 100;
    outcomes.set(row.status, o);
  }
  const latencies = proofRows.map((r) => Number(r.latency_ms)).filter((n) => Number.isFinite(n));
  return {
    totals: {
      deals: rows.length,
      captured: outcomes.get("captured")?.count ?? 0,
      voided: outcomes.get("voided")?.count ?? 0,
      review: outcomes.get("review_required")?.count ?? 0,
      lockedUsd: lockedCents / 100,
      capturedUsd: capturedCents / 100,
    },
    daily: [...dailyMap.values()].map((d) => ({ ...d, capturedUsd: Number(d.capturedUsd.toFixed(2)) })),
    merchants: [...merchants.values()]
      .map((m) => ({ ...m, capturedUsd: Number(m.capturedUsd.toFixed(2)), captureRate: m.deals ? Number((m.captured / m.deals).toFixed(3)) : 0 }))
      .sort((a, b) => b.deals - a.deals)
      .slice(0, 20),
    outcomes: [...outcomes.values()],
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), samples: latencies.length },
  };
});

// ---------- webhooks ----------

app.post("/v1/webhooks/paypal", async (req, reply) => {
  const transmissionId = req.headers["paypal-transmission-id"] as string | undefined;
  const transmissionSig = req.headers["paypal-transmission-sig"] as string | undefined;
  const authAlgo = req.headers["paypal-auth-algo"] as string | undefined;
  const certUrl = req.headers["paypal-cert-url"] as string | undefined;
  if (!transmissionId || !transmissionSig || !authAlgo || !certUrl || !config.PAYPAL_WEBHOOK_ID) {
    return reply.code(400).send({ code: "webhook_unverifiable", message: "Missing PayPal signature headers or PAYPAL_WEBHOOK_ID" });
  }
  const event = req.body as Record<string, unknown>;
  const ok = await paypal.verifyWebhookSignature({
    authAlgo, certUrl, transmissionId, transmissionSig, webhookId: config.PAYPAL_WEBHOOK_ID, webhookEvent: event,
  });
  if (!ok) return reply.code(400).send({ code: "webhook_bad_signature", message: "Signature verification failed" });

  const eventType = String(event.event_type ?? "");
  const resource = (event.resource ?? {}) as Record<string, unknown>;
  const relatedIds = (resource.supplementary_data as Record<string, unknown> | undefined)?.related_ids as Record<string, unknown> | undefined;
  const orderId = (relatedIds?.order_id as string | undefined) ?? (resource.id as string | undefined);

  try {
    if (eventType === "CHECKOUT.ORDER.APPROVED" && orderId) {
      const { rows } = await db.query("SELECT id FROM deals WHERE paypal_order_id = $1", [orderId]);
      if (rows[0]) await authorizeAndStore(db, paypal, rows[0].id, true, "webhook");
    } else if (eventType === "PAYMENT.AUTHORIZATION.CREATED") {
      const authorizationId = String(resource.id ?? "");
      if (authorizationId) {
        const { rows } = await db.query("SELECT id FROM deals WHERE paypal_authorization_id = $1 OR paypal_order_id = $2", [authorizationId, String(relatedIds?.order_id ?? "")]);
        if (rows[0]) await db.query("UPDATE deals SET paypal_authorization_id = COALESCE(paypal_authorization_id, $1), status = 'authorized', updated_at = now() WHERE id = $2", [authorizationId, rows[0].id]);
      }
    } else if (eventType === "PAYMENT.AUTHORIZATION.VOIDED") {
      const authorizationId = String(resource.id ?? "");
      if (authorizationId) {
        const { rows } = await db.query("UPDATE deals SET status = 'voided', updated_at = now() WHERE paypal_authorization_id = $1 RETURNING id", [authorizationId]);
        if (rows[0]) await audit(db, rows[0].id, "webhook", "deal.voided_by_paypal", {});
      }
    } else if (eventType === "PAYMENT.CAPTURE.COMPLETED" || eventType === "PAYMENT.CAPTURE.PENDING" || eventType === "PAYMENT.CAPTURE.DECLINED") {
      const captureId = String(resource.id ?? "");
      const authorizationId = String(relatedIds?.authorization_id ?? "");
      const newStatus = eventType === "PAYMENT.CAPTURE.COMPLETED" ? "captured" : eventType === "PAYMENT.CAPTURE.PENDING" ? "capture_pending" : "failed";
      const { rows } = await db.query("UPDATE deals SET status = $1, paypal_capture_id = COALESCE($2, paypal_capture_id), updated_at = now() WHERE paypal_authorization_id = $3 RETURNING id", [newStatus, captureId || null, authorizationId || null]);
      if (rows[0]) await audit(db, rows[0].id, "webhook", `deal.${newStatus}`, { capture_id: captureId });
    }
  } catch (err) {
    console.error("webhook processing error", err);
    return reply.code(500).send({ code: "webhook_processing_error", message: "Listener accepted the event but failed to reconcile" });
  }
  return { received: true };
});

// ---------- metrics ----------

app.get("/v1/metrics", async (req, reply) => {
  const id = await requireIdentity(req, reply); if (!id) return;
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE status = 'authorized'), 0)::bigint AS locked_cents,
       COALESCE(COUNT(*) FILTER (WHERE status = 'authorized'), 0)::int AS locked_count,
       COALESCE(COUNT(*) FILTER (WHERE status = 'captured' AND created_at::date = CURRENT_DATE), 0)::int AS captured_today,
       COALESCE(COUNT(*) FILTER (WHERE status = 'voided' AND created_at::date = CURRENT_DATE), 0)::int AS voided_today,
       COALESCE(COUNT(*) FILTER (WHERE status IN ('captured','voided')), 0)::int AS settled_total
     FROM deals WHERE user_id = $1`,
    [id.userId],
  );
  const r = rows[0];
  return {
    lockedUsd: usd(Number(r.locked_cents)),
    lockedCount: r.locked_count,
    capturedToday: r.captured_today,
    voidedToday: r.voided_today,
    settledTotal: r.settled_total,
  };
});

// ---------- meta ----------

app.get("/healthz", async () => ({ ok: true, service: "settlr-api", now: new Date().toISOString() }));

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof PayPalError) {
    app.log.error(err);
    return reply.code(502).send({ code: "paypal_error", message: "PayPal request failed", details: err.message.slice(0, 300) });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  app.log.error(err);
  return reply.code(status).send({ code: "internal_error", message: status === 500 ? "Something went wrong" : (err as Error).message });
});

const worker = startWorker(db, paypal, config);
process.on("SIGTERM", () => worker());

await app.listen({ port: config.PORT, host: "0.0.0.0" });
console.log(`Settlr API listening on :${config.PORT} (${config.PAYPAL_ENV})`);
