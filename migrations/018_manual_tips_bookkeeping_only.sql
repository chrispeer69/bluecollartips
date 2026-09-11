-- Manual tips are recorded for bookkeeping only. The platform did not collect
-- these funds, so no company or platform share is due and they never fund the
-- Stripe-backed withdrawal wallet.
CREATE OR REPLACE FUNCTION apply_tip_split() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c_pct integer;
BEGIN
  IF NEW.source <> 'stripe' THEN
    IF NEW.driver_id IS NULL THEN
      NEW.driver_amount_cents := 0;
      NEW.company_amount_cents := NEW.amount_cents;
    ELSE
      NEW.driver_amount_cents := NEW.amount_cents;
      NEW.company_amount_cents := 0;
    END IF;
    NEW.platform_amount_cents := 0;
    RETURN NEW;
  END IF;

  SELECT company_pct INTO c_pct FROM companies WHERE id = NEW.company_id;
  c_pct := LEAST(10, GREATEST(0, COALESCE(c_pct, 10)));

  IF NEW.driver_id IS NULL THEN
    NEW.driver_amount_cents := 0;
    NEW.company_amount_cents := (NEW.amount_cents * 90) / 100;
  ELSE
    NEW.driver_amount_cents := (NEW.amount_cents * (90 - c_pct)) / 100;
    NEW.company_amount_cents := (NEW.amount_cents * c_pct) / 100;
  END IF;

  NEW.platform_amount_cents := NEW.amount_cents - NEW.driver_amount_cents - NEW.company_amount_cents;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tip_split ON tips;
CREATE TRIGGER trg_tip_split
  BEFORE INSERT OR UPDATE OF amount_cents, company_id, driver_id, source ON tips
  FOR EACH ROW EXECUTE FUNCTION apply_tip_split();

-- Correct historical manual records to the same bookkeeping-only treatment.
UPDATE tips
SET driver_amount_cents = CASE WHEN driver_id IS NULL THEN 0 ELSE amount_cents END,
    company_amount_cents = CASE WHEN driver_id IS NULL THEN amount_cents ELSE 0 END,
    platform_amount_cents = 0
WHERE source <> 'stripe';
