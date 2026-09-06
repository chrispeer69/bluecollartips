ALTER TABLE companies ADD COLUMN IF NOT EXISTS join_code text;

DO $$
DECLARE company_row record;
DECLARE candidate text;
BEGIN
  FOR company_row IN SELECT id FROM companies WHERE join_code IS NULL LOOP
    LOOP
      candidate := lpad(floor(random() * 100000)::int::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE join_code = candidate);
    END LOOP;
    UPDATE companies SET join_code = candidate WHERE id = company_row.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS companies_join_code_unique ON companies(join_code);
ALTER TABLE companies ALTER COLUMN join_code SET NOT NULL;

CREATE OR REPLACE FUNCTION assign_company_join_code()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate text;
BEGIN
  IF NEW.join_code IS NOT NULL THEN RETURN NEW; END IF;
  LOOP
    candidate := lpad(floor(random() * 100000)::int::text, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE join_code = candidate);
  END LOOP;
  NEW.join_code := candidate;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS companies_assign_join_code ON companies;
CREATE TRIGGER companies_assign_join_code
BEFORE INSERT ON companies
FOR EACH ROW EXECUTE FUNCTION assign_company_join_code();

ALTER TABLE join_requests ALTER COLUMN invite_id DROP NOT NULL;

DELETE FROM join_requests older
USING join_requests newer
WHERE older.company_id = newer.company_id
  AND older.user_id = newer.user_id
  AND older.created_at < newer.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS join_requests_company_user_unique
  ON join_requests(company_id, user_id);
