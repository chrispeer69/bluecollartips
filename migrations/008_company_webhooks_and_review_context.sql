-- Per-company review webhooks and single-use job attribution links.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS review_webhook_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_webhook_url text,
  ADD COLUMN IF NOT EXISTS review_webhook_secret_encrypted text;

CREATE TABLE IF NOT EXISTS review_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  external_job_id text NOT NULL,
  external_contact_id text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  rating_id uuid REFERENCES ratings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, external_job_id)
);

ALTER TABLE ratings
  ADD COLUMN IF NOT EXISTS review_context_id uuid REFERENCES review_contexts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS review_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rating_id uuid NOT NULL REFERENCES ratings(id) ON DELETE CASCADE,
  destination_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  response_status integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS review_contexts_company_job_idx
  ON review_contexts(company_id, external_job_id);
