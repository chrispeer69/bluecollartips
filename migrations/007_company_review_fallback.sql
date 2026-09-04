-- Company-level review fallback and configurable positive-rating destination.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS positive_rating_threshold smallint NOT NULL DEFAULT 4
    CHECK (positive_rating_threshold BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS positive_submit_action text NOT NULL DEFAULT 'success_page'
    CHECK (positive_submit_action IN ('success_page', 'redirect')),
  ADD COLUMN IF NOT EXISTS positive_redirect_url text;

-- Company fallback reviews have no employee to attribute. Existing employee
-- reviews remain unchanged and continue to require their driver where present.
ALTER TABLE ratings ALTER COLUMN driver_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ratings_company_created_idx
  ON ratings(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_rating_rate_limits (
  ip_hash text NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY(ip_hash, company_id, window_start)
);
