-- Company earnings use their own payout ledger. Keeping this separate from
-- employee payout requests prevents either wallet from reserving the other's
-- balance and keeps the audit trail explicit.
CREATE TABLE IF NOT EXISTS company_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'processing', 'paid', 'rejected', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  payment_method text,
  payment_reference text,
  admin_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_payout_requests_company_idx
  ON company_payout_requests(company_id, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS company_payout_requests_one_open_per_company_idx
  ON company_payout_requests(company_id)
  WHERE status IN ('pending', 'approved', 'processing');
