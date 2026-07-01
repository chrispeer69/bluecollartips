-- Remove the driver self-update RLS policy; all driver updates go through server functions using the admin client with column whitelisting.
DROP POLICY IF EXISTS "Drivers update own safe fields" ON public.drivers;

-- Defense-in-depth: trigger blocks any non-service_role session from modifying sensitive columns on drivers.
CREATE OR REPLACE FUNCTION public.prevent_driver_sensitive_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id
     OR NEW.status          IS DISTINCT FROM OLD.status
     OR NEW.user_id         IS DISTINCT FROM OLD.user_id
     OR NEW.company_id      IS DISTINCT FROM OLD.company_id
     OR NEW.location_id     IS DISTINCT FROM OLD.location_id
     OR NEW.slug            IS DISTINCT FROM OLD.slug
     OR NEW.email           IS DISTINCT FROM OLD.email
     OR NEW.phone           IS DISTINCT FROM OLD.phone THEN
    RAISE EXCEPTION 'Modification of protected driver fields is not permitted through this path';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_driver_sensitive_updates_trg ON public.drivers;
CREATE TRIGGER prevent_driver_sensitive_updates_trg
BEFORE UPDATE ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.prevent_driver_sensitive_updates();