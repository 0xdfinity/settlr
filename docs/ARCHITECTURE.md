# Architecture: Settlr

## One page

```
              Operator's network (localhost / private VPS / company cloud)

      ┌─────────────────────────┐        ┌─────────────────────────────┐
      │ apps/web                │        │ apps/api                    │
      │ Next.js console         │        │ Fastify + TypeScript        │
      │ landing + app           │        │ Deal state + PayPal calls   │
      │ PayPal JS SDK v6        │        │ Verification + settle retry │
      └───────────┬─────────────┘        └─────────────┬───────────────┘
                  │                                     │
                  │ REST cookie/API key                 │ REST (sandbox/live)
                  └──────────────────────▶──────────────┘
                  │                                     │
        apps/mcp  ├──▶ stdio / HTTP                    ├ PayPal REST
        (agent tools)                                   Orders v2 AUTHORIZE/
                                                        CAPTURE / VOID
                                                        ├ optional webhooks
                                                        ├ verifier
                                                        └ Postgres/PGlite
                                                          └ Channel3 proxy

                  distribution
      docker compose (Postgres + API + web)  OR  local Node + embedded PGlite
```

Components and ownership
- **web** (`apps/web`): public landing, sign-in/up, app (console + deal detail), agent-setup docs. Talks only to the operator's API. Owns no secrets.
- **api** (`apps/api`): source of truth for deals, PayPal state machine, verification, optional webhook listener, metrics. Owns all secrets.
- **mcp** (`apps/mcp`): MCP server, thin client over API with the operator's Settlr API key. No PayPal secrets; agents drive it.
- **db**: Postgres (Docker Compose ships postgres:16-alpine). Local development uses embedded PGlite when `DATABASE_URL=pglite://...`; production operators bring their own Postgres. Migrations in `db/migrations` (forward-only).

Rationale for split FE/BE: the browser talks to exactly one API and trusts no third party with keys. Bounded contexts: Deals, Settlement (capture/void), Proof, Console/ReadModels. The MCP server is a client of the API. No shared DB between processes; all mutation goes through the API's validation, idempotency, and audit paths.

Distribution guarantee: this repo ships no hosted Settlr service and holds no production user data. Each operator owns their PayPal relationship, database, logs, retention, and incident response.

## Data flow: happy path (capture)

1. User (or agent via MCP) requests deal: `POST /v1/deals {amountUsd, description, merchant, proofSpec}`.
2. API: creates `deals` row (status=pending), creates PayPal order `intent=AUTHORIZE` + returns `approve` link. (No PAN or PII touches us.)
3. Buyer approves in PayPal popup (JS SDK v6 on web; sandbox accounts).
4. PayPal approval: the return flow calls `approve-callback` → API authorizes (`/v2/.../authorize`) → stores `authorization_id`, deal=authorized. If `PAYPAL_WEBHOOK_ID` is configured, `CHECKOUT.ORDER.APPROVED` reconciles the same transition idempotently.
5. Merchant delivers. Agent submits proof (`POST /v1/deals/{id}/proof`): e.g., JSON `{url, expectStatus:200, expectBodyContains:"ok"}`.
6. Verifier fetches the proof URL (8s timeout, redirects followed), compares the status code, and checks for the expected string in the body. The model then reads the captured body against the contract and returns a verdict with a confidence score. Both are stored in `proof_attempts`.
7. Verifier pass → `POST /v2/payments/authorizations/{authorization_id}/capture` → deal=captured and receipt/audit rows update. If webhooks are configured, `PAYMENT.CAPTURE.COMPLETED` confirms the same state idempotently.
8. Any failure → `POST .../void` → deal=voided; the hold is released immediately and the console shows the outcome with the failed checks attached.

Timeout: deals auto-expire after `expires_minutes` (default 60) → authorization voided by sweeper (cron every 5 min).

## NFRs that bind

- **Correctness over latency**: settle actions are idempotent + keyed; double-capture impossible by unique constraint on `settlements.provider_ref`.
- **Auditability**: append-only `audit_log`; every state change records actor (user/agent/webhook/sweeper). The whole lifecycle can be replayed from it.
- **Security**: secrets server-side only; sessions = bcrypt + httpOnly SameSite=Lax cookie (auth in API); MCP keys = sha256-hashed at rest, scoped `deal:create, proof:submit, deal:read`; rate-limited (10 req/min per key default); webhook signature verified; CORS allowlist (web origin); helmet; zod validation at every boundary.
- **Availability**: a single instance is enough for a self-hosted deployment; the API is stateless and the sweeper/reconciler can re-derive PayPal state when needed. Production operators own their HA, backups, and cold-start posture.
- **Observability**: structured JSON logs with correlation `dealId`; tiny `/healthz`; metrics table (capture/void latency) feeding Console.

## Sync vs async

- Sync: REST for CRUD + synchronous verifier (bounded < 5s).
- Async: webhooks (PayPal), sweeper (expire), retry queue for capture/void on transient PayPal 5xx (exponential backoff, max 5 attempts, dead-letter recorded).
- No message broker: Postgres `jobs` table + `FOR UPDATE SKIP LOCKED` worker loop: simple, durable, zero infra.

## Failure modes

- PayPal timeout during prove→capture: retry then surface; deal stays `capture_pending` in console with retry button.
- Webhook lost: reconciliation endpoint re-queries order state by ID.
- Verifier disagrees with buyer: capture is terminal; console shows `forced_release` flag when admin override used.
- Double approval / double submit: idempotency keys on mutation endpoints; unique active authorization per deal.

## Decisions (ADR-lite)

1. **USD + `intent=AUTHORIZE`** as the escrow primitive: PYUSD is not a selectable order currency in sandbox; AUTHORIZE→CAPTURE/VOID is PayPal's real "hold, then decide" path. PYUSD is a roadmap adapter behind the Settlement interface.
2. **MCP over raw REST-only agents**: MCP is the surface agents already speak, and it keeps the PayPal credential on the operator's server.
3. **Fastify + zod + Postgres (SQL migrations)** over framework ceremony; no Clean/hex scaffolding. ~Small app, but the contract + data gates are mandatory.
4. **AG Grid Community** console (sort/filter/pin/pagination). AG Studio was not adopted: it needs a newer major and a commercial licence.
5. **Deterministic verifier first, model as supporting signal**: an unaccountable "the AI said it is fine" is not evidence, and it is not allowed to move money on its own.
