
-- Locations
CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_company_idx ON public.locations(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company admins manage locations" ON public.locations
  FOR ALL TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id));

-- Drivers: add location + notification opt-in
ALTER TABLE public.drivers
  ADD COLUMN location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  ADD COLUMN notify_sms boolean NOT NULL DEFAULT true;
CREATE INDEX drivers_location_idx ON public.drivers(location_id);

-- Companies: review syndication URLs
ALTER TABLE public.companies
  ADD COLUMN google_review_url text,
  ADD COLUMN yelp_review_url text,
  ADD COLUMN facebook_review_url text;

-- Rate limiting for public tip page
CREATE TABLE public.rating_rate_limits (
  ip_hash text NOT NULL,
  driver_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, driver_id, window_start)
);
CREATE INDEX rating_rate_limits_window_idx ON public.rating_rate_limits(window_start);
GRANT ALL ON public.rating_rate_limits TO service_role;
ALTER TABLE public.rating_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: service role only (accessed via SECURITY DEFINER server fn).
