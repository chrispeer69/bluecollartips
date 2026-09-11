-- Successful platform-collected Stripe tips are available immediately.
-- Employees can request a payout; company admins have the configured service
-- window to record the actual off-platform/Stripe payout.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS payout_minimum_cents integer NOT NULL DEFAULT 2500
    CHECK (payout_minimum_cents BETWEEN 100 AND 100000),
  ADD COLUMN IF NOT EXISTS payout_processing_days smallint NOT NULL DEFAULT 5
    CHECK (payout_processing_days BETWEEN 0 AND 5);

CREATE TABLE IF NOT EXISTS payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS payout_requests_driver_idx
  ON payout_requests(driver_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS payout_requests_company_idx
  ON payout_requests(company_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_one_open_per_driver_idx
  ON payout_requests(driver_id)
  WHERE status IN ('pending', 'approved', 'processing');
