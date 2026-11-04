# Settlr

**Agent settlement infrastructure.** Settlr wraps every purchase an AI agent makes in a PayPal authorization. The money is held, not sent, and released only after delivery is proven by code.

Self-hosted, MIT licensed, built on PayPal Orders v2. No custody, no onchain escrow.

**Live instance:** <https://settlr-gamma.vercel.app> (console) · <https://settlr-api-dfuw.onrender.com/healthz> (API). It runs against PayPal sandbox, so approvals move sandbox funds only, and the API is on a free instance: the first request after an idle period can take up to a minute. Everything below is how to run your own.

```
Agent ── MCP ──▶ Settlr ──▶ PayPal AUTHORIZE   funds held
                    │
Buyer approves  ────┘        deal = authorized
                    │
Agent delivers ──▶ verifier ─┬─ proof passes ──▶ CAPTURE  merchant paid
                             ├─ proof fails  ──▶ VOID     buyer released
                             └─ verdict unsure ─▶ human review gate
```

## Why

Agents can decide to buy things; they cannot be trusted with a payment method. A card or a balance hands an agent an irreversible spend with no delivery check. Settlr gives the agent a reversible primitive instead: ask for a hold, tell the buyer to approve it in PayPal, submit evidence, let the verifier settle. The agent never holds a credential that can move money.

## How it works

| Step | Who | What happens |
| --- | --- | --- |
| `escrow_create` | Agent | States amount, merchant, delivery contract, and the proof URL. Settlr creates a PayPal order with `intent=AUTHORIZE`. |
| Approval | Buyer | Approves in PayPal. Funds are held on the buyer's account; the merchant is not paid. |
| `escrow_submit_proof` | Agent | Settlr calls the proof URL, checks status and body, then the model reads the evidence against the contract. |
| Settlement | Settlr | Deterministic pass + verified delivery → `CAPTURE`. Failure → `VOID`. Ambiguous or low-confidence → `review_required`, and a person decides with an audited reason. |

Every transition is written to an append-only audit log with the PayPal authorization, capture, or void reference.

## Stack

| Piece | Built with | Where it lives |
| --- | --- | --- |
| Agent surface | MCP over stdio, `@modelcontextprotocol/sdk` 1.x | `apps/mcp` |
| API | Fastify 5, zod 4, TypeScript | `apps/api/src` |
| Console | Next.js 15 App Router, React 19 | `apps/web/src` |
| Deals table | AG Grid Community 34 (`ag-grid-react`) | `apps/web/src/app/deals` |
| Approvals | PayPal JS SDK v6 (`@paypal/react-paypal-js`) | `apps/web/src/components/PayPalApproval.tsx` |
| Payments | PayPal Orders v2 `AUTHORIZE` → `CAPTURE` / `VOID` | `apps/api/src/paypal.ts` |
| Verification | Deterministic HTTP checks, then model adjudication | `apps/api/src/verifier.ts`, `apps/api/src/ai.ts` |
| Model | OpenAI-compatible endpoint, Groq `openai/gpt-oss-120b` by default | `apps/api/src/ai.ts` |
| Catalog | Channel3 product search | `apps/api/src/channel3.ts` |
| Data | Postgres 16 in production, embedded PGlite for local dev | `db/migrations`, `apps/api/src/db.ts` |
| Contract | OpenAPI 3.1: 20 paths, 21 schemas | `docs/API.openapi.yaml` |
| Distribution | Docker Compose, Render blueprint | `docker-compose.yml`, `render.yaml` |

### Where the integrations sit

**PayPal** is the escrow primitive, not a checkout button. A deal starts as an order with `intent=AUTHORIZE`; the buyer approves it on PayPal's domain; the authorization is captured only after the verifier passes, or voided when it fails or expires. `apps/api/src/settlement.ts` holds the state machine, and every path is idempotent so a repeated approval or a retried capture settles once.

**Channel3** answers the question agents cannot: what is this thing and where does it cost least. `catalog_search` queries the Channel3 product graph and returns normalized offers: title, merchant domain, price, buy URL. When an agent states intent without naming a merchant, `/v1/ai/draft` passes the real offers to the model and builds the contract from catalog data instead of inventing a merchant or a price.

**The model** is used in three places and never as an authority: drafting a contract from plain language, adjudicating evidence the deterministic checks cannot settle, and explaining a decision after the fact. It runs against any OpenAI-compatible endpoint (`GROQ_API_KEY`, `AI_MODEL`, `AI_BASE_URL`). Every function returns `null` on failure, so settlement degrades to the deterministic path rather than stopping.

**AG Grid** is the operator console. The deals grid sorts, filters, resizes, pins the deal id left and the row action right, and renders status and AI verdict through custom cell renderers. The analytics page reuses the same grid and theme; receipts is a plain React table over the same API.

**Postgres** is the only stateful dependency. Local development uses embedded PGlite, so `npm run dev:api` needs no database server; production operators point `DATABASE_URL` at Postgres and run the forward-only migrations in `db/migrations`.

## Run it

### Docker Compose

Requires Docker with Compose v2 and a PayPal REST app (sandbox works).

```bash
cp .env.example .env
# Fill in PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, AUTH_SECRET, VERIFIER_HMAC_SECRET
docker compose up --build
# Web console: http://localhost:3000
# API health:  http://localhost:8787/healthz
```

Compose runs Postgres, the API, and the web console on your machine. The browser only ever talks to your instance.

### From source

Requires Node 22+. The dev database is embedded Postgres (PGlite, WASM); set `DATABASE_URL=postgres://…` to point at a real server instead.

```bash
cp apps/api/.env.example apps/api/.env          # PayPal client id + secret, auth secrets
cp apps/web/.env.example apps/web/.env.local    # NEXT_PUBLIC_PAYPAL_CLIENT_ID, API URL

npm install
npm run -w apps/api migrate
npm run dev:api     # http://localhost:8787
npm run dev:web     # http://localhost:3000
```

Generate the secrets with `openssl rand -hex 32`. Create the PayPal app and a sandbox buyer at <https://developer.paypal.com/dashboard/>.

`localhost` and `127.0.0.1` are different origins. Use one of them everywhere (web, API URL, `WEB_ORIGINS`), or session cookies will not be sent.

**Ports already in use?** Set `PORT=8791` for the API and `NEXT_PUBLIC_API_URL=http://localhost:8791` plus the matching origin in `WEB_ORIGINS`.

## Connect an agent

1. Sign in, open **Agent access**, mint a key (`settlr_live_…`, shown once).
2. Build the server: `npm run -w apps/mcp build`.
3. Add it to `claude_desktop_config.json` (Claude Desktop) or `.cursor/mcp.json` (Cursor):

```json
{
  "mcpServers": {
    "settlr": {
      "command": "node",
      "args": ["/absolute/path/to/settlr/apps/mcp/dist/index.js"],
      "env": {
        "SETTLR_API_URL": "http://localhost:8787",
        "SETTLR_API_KEY": "settlr_live_…"
      }
    }
  }
}
```

4. Ask the agent to buy something with a condition: *"Buy the Pro API plan from MerchantX, but only pay after the health endpoint returns 200."*

Tools exposed over stdio: `escrow_create`, `escrow_submit_proof`, `escrow_status`, `catalog_search`.

## Verification model

The verifier is deterministic first. It fetches the proof URL, compares status codes, and checks for an expected string in the body. Those checks can settle a deal on their own when they fail.

The model is an adjudicator, never the payer:

- It reads the contract and the captured evidence and returns `verified`, `underdelivered`, or `ambiguous` with a confidence score.
- `underdelivered` at ≥ 0.70 confidence voids the hold.
- `ambiguous`, or any confidence below 0.55, moves the deal to `review_required` and stops. A person captures or releases it with a written reason that lands in the audit log.
- If the AI provider is unreachable, every function returns `null` and the deterministic result governs. Settlement never depends on a model being up.

## API

Fastify + TypeScript. Contract in [`docs/API.openapi.yaml`](docs/API.openapi.yaml), schema in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), decisions in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/deals` | Create a deal and a PayPal authorize order |
| `POST /v1/deals/:id/approve-callback` | Reconcile a buyer approval |
| `POST /v1/deals/:id/proof` | Verify evidence and settle |
| `POST /v1/deals/:id/review` | Human decision on a `review_required` deal |
| `POST /v1/deals/:id/force-settle` | Audited operator override |
| `GET /v1/catalog/search` | Channel3 product search for agent intent |
| `POST /v1/ai/draft` | Draft a contract from plain language |
| `POST /v1/ai/explain/:id` | Explain a settlement decision |
| `GET /v1/analytics` | Volume, outcomes, latency, merchants |

## Verify a deployment

Once the stack is up, run the end-to-end check against it. It signs up a throwaway operator, mints an API key, creates a sandbox deal through the authenticated API, reads it back as both a session and an agent key, and pulls metrics:

```bash
node apps/api/scripts/smoke.mjs http://localhost:8787
```

Every step prints its status. Anything other than `201` on signup and deal creation, or `200` on the reads, is a configuration problem: usually a missing PayPal client id or an unreachable Postgres.

## Production notes

- The API is stateless; state lives in Postgres. Run migrations before rollout.
- Webhooks at `/v1/webhooks/paypal` are signature-verified when `PAYPAL_WEBHOOK_ID` is set. The normal flow does not need them: `/approve-callback` reconciles approvals.
- Operators own TLS, backups, secret storage, and network rules. Compose is a single-machine starting point, not a managed deployment.
- Set `PAYPAL_ENV=production` and use production credentials to settle real money. USD holds settle through authorize/capture/void; PYUSD settlement is on the roadmap.

## Security

Secrets stay server-side. Passwords are bcrypt-hashed, sessions are HttpOnly `SameSite=Lax` cookies, MCP keys are stored as SHA-256 hashes with scoped permissions and rate limits. Every mutation accepts an idempotency key, amounts are capped at $10,000 per deal, PayPal webhooks are verified, and any override needs a written reason in the audit trail.

## License

MIT. See [LICENSE](LICENSE).
