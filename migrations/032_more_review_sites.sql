-- More public review destinations (Apple Maps, Bing, US Tow Alliance) and a
-- log of which review site each customer opened after rating.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS apple_maps_review_url text,
  ADD COLUMN IF NOT EXISTS bing_review_url text,
  ADD COLUMN IF NOT EXISTS usta_review_url text;

CREATE TABLE IF NOT EXISTS review_site_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rating_id uuid NOT NULL REFERENCES ratings(id) ON DELETE CASCADE,
  site text NOT NULL CHECK (site IN ('google', 'facebook', 'yelp', 'apple_maps', 'bing', 'usta')),
  clicked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rating_id, site)
);
CREATE INDEX IF NOT EXISTS review_site_clicks_company_idx ON review_site_clicks(company_id, clicked_at);
