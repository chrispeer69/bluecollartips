
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS thank_you_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS thank_you_sms_template text NOT NULL DEFAULT 'Hi {{customer_name}}, thanks for the {{stars}}-star rating and {{tip_amount}} tip for {{driver_name}} at {{company_name}}! — {{company_name}}',
  ADD COLUMN IF NOT EXISTS thank_you_email_subject text NOT NULL DEFAULT 'Thanks from {{company_name}}',
  ADD COLUMN IF NOT EXISTS thank_you_email_template text NOT NULL DEFAULT 'Hi {{customer_name}},

Thank you for rating {{driver_name}} {{stars}} stars{{tip_line}}. We appreciate your business.

— The {{company_name}} team';

ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS customer_email text;

CREATE TABLE IF NOT EXISTS public.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  rating_id uuid REFERENCES public.ratings(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  provider_id text,
  status text NOT NULL DEFAULT 'queued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_deliveries TO authenticated;
GRANT ALL ON public.email_deliveries TO service_role;

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members view email deliveries"
  ON public.email_deliveries FOR SELECT TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id));

CREATE POLICY "Service role manages email deliveries"
  ON public.email_deliveries FOR ALL TO service_role
  USING (true) WITH CHECK (true);
