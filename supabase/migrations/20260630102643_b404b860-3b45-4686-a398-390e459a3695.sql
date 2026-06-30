
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.cash_tip_verifications
  ADD COLUMN IF NOT EXISTS tip_id uuid REFERENCES public.tips(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_amount_cents integer;

ALTER TABLE public.discrepancy_flags
  ADD COLUMN IF NOT EXISTS tip_id uuid REFERENCES public.tips(id) ON DELETE SET NULL;
