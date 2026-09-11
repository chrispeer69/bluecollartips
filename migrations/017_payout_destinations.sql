-- Manual payout destinations are encrypted by the application. A snapshot is
-- copied onto each request so later profile edits cannot change payout instructions
-- for an already-submitted request.
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS payout_method text,
  ADD COLUMN IF NOT EXISTS payout_account_name text,
  ADD COLUMN IF NOT EXISTS payout_details_encrypted text;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS payout_method text,
  ADD COLUMN IF NOT EXISTS payout_account_name text,
  ADD COLUMN IF NOT EXISTS payout_details_encrypted text;

ALTER TABLE payout_requests
  ADD COLUMN IF NOT EXISTS requested_payout_method text,
  ADD COLUMN IF NOT EXISTS requested_payout_account_name text,
  ADD COLUMN IF NOT EXISTS requested_payout_details_encrypted text;

ALTER TABLE company_payout_requests
  ADD COLUMN IF NOT EXISTS requested_payout_method text,
  ADD COLUMN IF NOT EXISTS requested_payout_account_name text,
  ADD COLUMN IF NOT EXISTS requested_payout_details_encrypted text;

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_payout_method_valid;
ALTER TABLE drivers ADD CONSTRAINT drivers_payout_method_valid CHECK (
  payout_method IS NULL OR payout_method IN ('bank_transfer', 'cash_app', 'venmo', 'zelle', 'paypal', 'check', 'other')
);

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_payout_method_valid;
ALTER TABLE companies ADD CONSTRAINT companies_payout_method_valid CHECK (
  payout_method IS NULL OR payout_method IN ('bank_transfer', 'cash_app', 'venmo', 'zelle', 'paypal', 'check', 'other')
);
