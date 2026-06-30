
-- Stripe Connect fields on drivers
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean NOT NULL DEFAULT false;

-- Stripe + reconciliation fields on tips
ALTER TABLE public.tips
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_status text,
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz;

-- Card tips are inherently verified
UPDATE public.tips SET verified = true WHERE source = 'stripe' AND verified = false;

CREATE UNIQUE INDEX IF NOT EXISTS tips_stripe_pi_uniq
  ON public.tips (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- SMS delivery log
CREATE TABLE IF NOT EXISTS public.sms_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  to_phone text NOT NULL,
  body text NOT NULL,
  provider text NOT NULL DEFAULT 'twilio',
  provider_sid text,
  status text NOT NULL DEFAULT 'queued',
  error text,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.sms_deliveries TO authenticated;
GRANT ALL ON public.sms_deliveries TO service_role;

ALTER TABLE public.sms_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members read sms"
  ON public.sms_deliveries FOR SELECT
  TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id)
         OR EXISTS (SELECT 1 FROM public.drivers d
                    WHERE d.id = sms_deliveries.driver_id AND d.user_id = auth.uid()));

CREATE POLICY "Company members log sms"
  ON public.sms_deliveries FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_admin(auth.uid(), company_id)
              OR EXISTS (SELECT 1 FROM public.drivers d
                         WHERE d.id = sms_deliveries.driver_id AND d.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS sms_deliveries_company_idx ON public.sms_deliveries (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_deliveries_driver_idx ON public.sms_deliveries (driver_id, created_at DESC);
