-- Company fallback pages can collect card tips even when no employee was matched.
ALTER TABLE tips ALTER COLUMN driver_id DROP NOT NULL;

-- Preserve the normal configured split for employee tips. A company-level tip
-- has no employee beneficiary, so the employee and company shares both belong
-- to the company while the platform keeps its configured share.
CREATE OR REPLACE FUNCTION apply_tip_split() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d_pct integer; c_pct integer; p_pct integer;
BEGIN
  SELECT driver_pct, company_pct, platform_pct
    INTO d_pct, c_pct, p_pct
    FROM companies
    WHERE id = NEW.company_id;

  IF NEW.driver_id IS NULL THEN
    NEW.driver_amount_cents := 0;
    NEW.company_amount_cents := (NEW.amount_cents * (COALESCE(d_pct, 80) + COALESCE(c_pct, 10))) / 100;
  ELSE
    NEW.driver_amount_cents := (NEW.amount_cents * COALESCE(d_pct, 80)) / 100;
    NEW.company_amount_cents := (NEW.amount_cents * COALESCE(c_pct, 10)) / 100;
  END IF;

  NEW.platform_amount_cents := NEW.amount_cents - NEW.driver_amount_cents - NEW.company_amount_cents;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tip_split ON tips;
CREATE TRIGGER trg_tip_split
  BEFORE INSERT OR UPDATE OF amount_cents, company_id, driver_id ON tips
  FOR EACH ROW EXECUTE FUNCTION apply_tip_split();
