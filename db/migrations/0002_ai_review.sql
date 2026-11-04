/* AI adjudication, offer snapshots, and the human review gate. */
ALTER TABLE deals ADD COLUMN IF NOT EXISTS offer jsonb NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS delivery_contract text NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ai_verdict text NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ai_confidence numeric(4,3) NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ai_reasoning text NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'none';
ALTER TABLE proof_attempts ADD COLUMN IF NOT EXISTS ai_verdict text NULL;
ALTER TABLE proof_attempts ADD COLUMN IF NOT EXISTS ai_confidence numeric(4,3) NULL;
ALTER TABLE proof_attempts ADD COLUMN IF NOT EXISTS ai_reasoning text NULL;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_status_check CHECK (status IN ('pending','authorized','capture_pending','review_required','captured','voided','expired','failed'));
