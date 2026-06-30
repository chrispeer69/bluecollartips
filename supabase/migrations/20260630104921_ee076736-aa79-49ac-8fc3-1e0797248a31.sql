
-- Drivers: remove anon SELECT; restrict to authenticated users (self or company admins)
DROP POLICY IF EXISTS "Active drivers publicly readable" ON public.drivers;
REVOKE SELECT ON public.drivers FROM anon;
CREATE POLICY "Drivers readable by self or company admins"
  ON public.drivers FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_company_admin(auth.uid(), company_id));

-- Invites: remove blanket public SELECT; only company admins can read
DROP POLICY IF EXISTS "Anyone reads invite by code" ON public.invites;
REVOKE SELECT ON public.invites FROM anon;

-- Companies: remove anon SELECT to protect support_email/support_phone; authenticated users can still read
DROP POLICY IF EXISTS "Companies are publicly readable" ON public.companies;
REVOKE SELECT ON public.companies FROM anon;
CREATE POLICY "Companies readable by authenticated users"
  ON public.companies FOR SELECT
  TO authenticated
  USING (true);
