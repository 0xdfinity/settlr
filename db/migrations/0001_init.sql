/* Note: no extensions required (portable to PGlite/dev WASM postgres and vanilla postgres>=13). */
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text UNIQUE NOT NULL,
  scopes text[] NOT NULL DEFAULT '{deal:create,proof:submit,deal:read}',
  last_used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  description text NOT NULL CHECK (char_length(description) >= 3),
  merchant text NULL,
  merchant_url text NULL,
  category text NULL,
  proof_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','authorized','capture_pending','captured','voided','expired','failed')),
  paypal_order_id text UNIQUE NULL,
  paypal_authorization_id text UNIQUE NULL,
  paypal_capture_id text UNIQUE NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deals_user_status_idx ON deals(user_id, status);
CREATE INDEX IF NOT EXISTS deals_status_expires_idx ON deals(status, expires_at);

CREATE TABLE IF NOT EXISTS proof_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('http_check','url_screenshot','log')),
  url text NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  passed boolean NOT NULL,
  reason text NOT NULL DEFAULT '',
  latency_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proof_attempts_deal_idx ON proof_attempts(deal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid UNIQUE NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('capture','void')),
  provider_ref text UNIQUE NOT NULL,
  attempts int NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('ok','retryable','dead')),
  latency_ms int NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  actor text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_deal_idx ON audit_log(deal_id, id);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('capture_retry','void_retry','expire_deal','reconcile_order')),
  payload jsonb NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  locked_at timestamptz NULL,
  completed_at timestamptz NULL,
  dead boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs(run_at) WHERE completed_at IS NULL AND dead = false;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  response_status int NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  day date PRIMARY KEY,
  authorized int NOT NULL DEFAULT 0,
  captured int NOT NULL DEFAULT 0,
  voided int NOT NULL DEFAULT 0,
  capture_p95_ms int NULL,
  void_p95_ms int NULL
);
