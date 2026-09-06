-- One login may represent an employee at many companies, but never more than
-- one employee profile within the same company.
CREATE UNIQUE INDEX IF NOT EXISTS drivers_user_company_unique
  ON drivers (user_id, company_id)
  WHERE user_id IS NOT NULL;

