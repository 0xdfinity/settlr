# Data model: Settlr (Postgres, forward-only migrations)

## Tables

- **users**: `id uuid pk`, `email citext unique not null`, `password_hash text not null`, `name text not null`, `created_at timestamptz default now()`, `updated_at timestamptz`. (Auth: bcrypt, httpOnly session.)
- **sessions**: `id uuid pk`, `user_id uuid fk→users on delete cascade`, `token_hash text unique not null` (sha256), `created_at`, `expires_at not null`, `revoked_at null`. Session cookie holds raw token; DB stores hash only.
- **api_keys**: `id uuid pk`, `user_id fk→users cascade`, `name text`, `prefix text`, `key_hash text unique`, `scopes text[] not null`, `last_used_at timestamptz null`, `created_at`, `revoked_at null`.
- **deals**: `id uuid pk`, `user_id fk→users cascade`, `amount_cents bigint not null check (amount_cents > 0)`, `currency char(3) not null default 'USD'`, `description text not null`, `merchant text null`, `merchant_url text null`, `category text null`, `proof_spec jsonb not null default '{}'`, `status text not null default 'pending' check (status in ('pending','authorized','capture_pending','captured','voided','expired','failed'))`, `paypal_order_id text unique null`, `paypal_authorization_id text unique null`, `paypal_capture_id text unique null`, `expires_at timestamptz not null`, `created_at`, `updated_at`. Indexes: (user_id, status), (status, expires_at) for sweeper.
- **proof_attempts**: `id uuid pk`, `deal_id fk→deals cascade`, `kind text check (kind in ('http_check','url_screenshot','log'))`, `url text null`, `request jsonb not null default '{}'`, `response jsonb null`, `checks jsonb not null default '[]'`, `passed boolean not null`, `reason text not null default ''`, `latency_ms int not null`, `created_at`. Index (deal_id, created_at desc).
- **settlements**: `id uuid pk`, `deal_id fk→deals unique` (one settlement record per deal: enforces no double settle), `action text check (action in ('capture','void'))`, `provider_ref text unique not null` (PayPal capture/void id: idempotency at constraint level), `attempts int not null default 1`, `status text not null check (status in ('ok','retryable','dead'))`, `latency_ms int null`, `created_at`.
- **audit_log**: `id bigserial pk`, `deal_id fk→deals cascade`, `actor text not null` (`user:<uuid>` | `mcp:<keyid>` | `webhook` | `sweeper` | `admin`), `action text not null`, `detail jsonb not null default '{}'`, `created_at timestamptz default now()`. Append-only (no update/delete grants for app role).
- **jobs**: `id uuid pk`, `kind text not null` (`capture_retry` | `void_retry` | `expire_deal` | `reconcile_order`), `payload jsonb not null`, `run_at timestamptz not null default now()`, `attempts int not null default 0`, `max_attempts int not null default 5`, `locked_at timestamptz null`, `completed_at timestamptz null`, `dead boolean not null default false`. Index (run_at) where completed_at is null and dead = false. Claim: `FOR UPDATE SKIP LOCKED`.
- **metrics_daily**: `day date pk`, `authorized int`, `captured int`, `voided int`, `capture_p95_ms int`, `void_p95_ms int`: powers console "trusted volume" widget.

## Invariants

1. A deal authorizes funds once; `paypal_authorization_id` unique.
2. A deal settles at most once; `settlements.deal_id` unique, `provider_ref` unique.
3. Verifier pass is required for self-capture via user/agent; admin override writes `audit_log` with actor=admin and a ≥10-char reason.
4. Every mutation to `deals.status` writes an `audit_log` row in the same transaction.
5. Hashes, not raw tokens, for sessions and MCP keys.

## Migration order

`0001_init.sql`: all tables + indexes + constraints above, then `CREATE ROLE settlr_app LOGIN; GRANT SELECT/INSERT/UPDATE ON ... ; REVOKE DELETE` (audit_log stays append-only). Rollback is manual (drop schema); documented, forward-only.
