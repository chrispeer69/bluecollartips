ALTER TABLE public.tips
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS refund_amount_cents integer,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text;

CREATE INDEX IF NOT EXISTS tips_disputed_idx ON public.tips (company_id, disputed) WHERE disputed = true;
CREATE INDEX IF NOT EXISTS tips_refunded_idx ON public.tips (company_id, refunded_at);