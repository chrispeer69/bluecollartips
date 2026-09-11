-- Blue Collar Tips always retains 10%. Each company may retain 0-10%, and the
-- employee receives the remainder. Existing tip rows keep their recorded split.
ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_company_pct_range,
  DROP CONSTRAINT IF EXISTS companies_platform_pct_fixed,
  DROP CONSTRAINT IF EXISTS companies_tip_pct_total;

ALTER TABLE companies
  ADD CONSTRAINT companies_company_pct_range CHECK (company_pct BETWEEN 0 AND 10),
  ADD CONSTRAINT companies_platform_pct_fixed CHECK (platform_pct = 10),
  ADD CONSTRAINT companies_tip_pct_total CHECK (driver_pct + company_pct + platform_pct = 100);

CREATE OR REPLACE FUNCTION apply_tip_split() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c_pct integer;
BEGIN
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
  BEFORE INSERT OR UPDATE OF amount_cents, company_id, driver_id ON tips
  FOR EACH ROW EXECUTE FUNCTION apply_tip_split();
