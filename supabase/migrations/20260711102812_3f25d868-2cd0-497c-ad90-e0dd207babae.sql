-- Configurable tip split per company
ALTER TABLE public.companies
  ADD COLUMN driver_pct   smallint NOT NULL DEFAULT 90,
  ADD COLUMN company_pct  smallint NOT NULL DEFAULT 5,
  ADD COLUMN platform_pct smallint NOT NULL DEFAULT 5,
  ADD CONSTRAINT companies_split_sums_100 CHECK (driver_pct + company_pct + platform_pct = 100),
  ADD CONSTRAINT companies_platform_min_5 CHECK (platform_pct >= 5 OR slug = 'roadside-towing'),
  ADD CONSTRAINT companies_split_nonneg CHECK (driver_pct >= 0 AND company_pct >= 0 AND platform_pct >= 0);

-- Roadside Towing: 90 / 0 / 10 (owner waives their share; platform takes 10)
UPDATE public.companies
   SET driver_pct = 90, company_pct = 0, platform_pct = 10
 WHERE slug = 'roadside-towing';

-- Trigger now reads splits from the company row instead of hardcoding 80/10/10
CREATE OR REPLACE FUNCTION public.apply_tip_split()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  total  integer := NEW.amount_cents;
  d_pct  smallint;
  c_pct  smallint;
  p_pct  smallint;
BEGIN
  SELECT driver_pct, company_pct, platform_pct
    INTO d_pct, c_pct, p_pct
    FROM public.companies
   WHERE id = NEW.company_id;

  IF d_pct IS NULL THEN
    d_pct := 90; c_pct := 5; p_pct := 5;
  END IF;

  NEW.driver_amount_cents   := (total * d_pct) / 100;
  NEW.company_amount_cents  := (total * c_pct) / 100;
  NEW.platform_amount_cents := total - NEW.driver_amount_cents - NEW.company_amount_cents;
  RETURN NEW;
END;
$function$;