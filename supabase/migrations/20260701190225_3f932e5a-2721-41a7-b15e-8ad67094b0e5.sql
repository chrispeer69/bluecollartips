DROP POLICY IF EXISTS "Companies readable by authenticated users" ON public.companies;

CREATE POLICY "Company members read own company"
ON public.companies
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin')
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.company_id = public.companies.id
  )
);