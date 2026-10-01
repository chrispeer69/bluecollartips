-- Card tips: the employee keeps 90%, Blue Collar Tips keeps 10%, and the
-- company keeps nothing. This applies to every company and can no longer be
-- changed per company. (Tips not yet assigned to an employee are still held
-- under the company until someone assigns them; see apply_tip_split.)

UPDATE companies SET company_pct = 0, driver_pct = 90, platform_pct = 10
WHERE company_pct <> 0 OR driver_pct <> 90 OR platform_pct <> 10;

ALTER TABLE companies ALTER COLUMN company_pct SET DEFAULT 0;
ALTER TABLE companies ALTER COLUMN driver_pct SET DEFAULT 90;
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_company_pct_range;
DO $$ BEGIN
  ALTER TABLE companies ADD CONSTRAINT companies_company_pct_zero CHECK (company_pct = 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Recalculate past card tips with the new split. Touching amount_cents fires
-- trg_tip_split, which recomputes every share. Companies that ever requested a
-- payout of their company share are left alone so their wallet can't go
-- negative; those need a manual review.
DO $$
DECLARE skipped text;
BEGIN
  SELECT string_agg(DISTINCT c.slug, ', ') INTO skipped
  FROM company_payout_requests p JOIN companies c ON c.id = p.company_id
  WHERE p.status NOT IN ('rejected', 'cancelled');
  IF skipped IS NOT NULL THEN
    RAISE NOTICE 'Past card tips NOT re-split for companies with company payouts: %', skipped;
  END IF;

  UPDATE tips t SET amount_cents = t.amount_cents
  WHERE t.source = 'stripe'
    AND t.driver_id IS NOT NULL
    AND t.company_amount_cents <> 0
    AND NOT EXISTS (
      SELECT 1 FROM company_payout_requests p
      WHERE p.company_id = t.company_id AND p.status NOT IN ('rejected', 'cancelled')
    );
END $$;
