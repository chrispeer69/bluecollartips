ALTER TABLE ratings ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE tips ADD COLUMN IF NOT EXISTS stripe_status text;
ALTER TABLE tips ADD COLUMN IF NOT EXISTS disputed boolean NOT NULL DEFAULT false;
ALTER TABLE tips ADD COLUMN IF NOT EXISTS refund_reason text;
ALTER TABLE tips ADD COLUMN IF NOT EXISTS stripe_refund_id text;

ALTER TABLE rating_rate_limits ADD COLUMN IF NOT EXISTS window_start timestamptz;
ALTER TABLE rating_rate_limits ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 0;
UPDATE rating_rate_limits SET window_start = date_trunc('hour', now()) WHERE window_start IS NULL;
ALTER TABLE rating_rate_limits ALTER COLUMN window_start SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rating_rate_limits_bucket_idx ON rating_rate_limits(ip_hash, driver_id, window_start);
CREATE INDEX IF NOT EXISTS rating_rate_limits_window_idx ON rating_rate_limits(window_start);

CREATE OR REPLACE FUNCTION apply_tip_split() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d_pct integer; c_pct integer; p_pct integer;
BEGIN
  SELECT driver_pct, company_pct, platform_pct INTO d_pct, c_pct, p_pct FROM companies WHERE id = NEW.company_id;
  NEW.driver_amount_cents := (NEW.amount_cents * COALESCE(d_pct, 80)) / 100;
  NEW.company_amount_cents := (NEW.amount_cents * COALESCE(c_pct, 10)) / 100;
  NEW.platform_amount_cents := NEW.amount_cents - NEW.driver_amount_cents - NEW.company_amount_cents;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tip_split ON tips;
CREATE TRIGGER trg_tip_split BEFORE INSERT OR UPDATE OF amount_cents, company_id ON tips FOR EACH ROW EXECUTE FUNCTION apply_tip_split();
