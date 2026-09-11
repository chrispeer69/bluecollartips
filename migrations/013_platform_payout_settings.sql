-- Payouts are operated by the Blue Collar Tips platform, not by each tenant.
-- The processing window is an operational target after a payout request; it
-- does not delay when successful Stripe earnings become available.
CREATE TABLE IF NOT EXISTS platform_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  payout_minimum_cents integer NOT NULL DEFAULT 2500
    CHECK (payout_minimum_cents BETWEEN 100 AND 100000),
  payout_processing_days smallint NOT NULL DEFAULT 5
    CHECK (payout_processing_days BETWEEN 0 AND 5),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO platform_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;
