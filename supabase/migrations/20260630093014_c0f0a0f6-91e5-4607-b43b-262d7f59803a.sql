
CREATE OR REPLACE FUNCTION public.apply_tip_split()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  total integer := NEW.amount_cents;
BEGIN
  NEW.driver_amount_cents   := (total * 80) / 100;
  NEW.company_amount_cents  := (total * 10) / 100;
  NEW.platform_amount_cents := total - NEW.driver_amount_cents - NEW.company_amount_cents;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_tip_split() FROM anon, authenticated, public;
