-- Every follow-up call made to a VIP customer, and when to call them next.

CREATE TABLE IF NOT EXISTS vip_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_job_id text NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now(),
  note text CHECK (char_length(note) <= 2000),
  -- The follow-up date chosen on this call (null = no further call planned).
  next_followup_on date,
  logged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vip_call_log_job_idx ON vip_call_log(company_id, external_job_id, called_at DESC);

ALTER TABLE vip_followups ADD COLUMN IF NOT EXISTS next_followup_on date;
CREATE INDEX IF NOT EXISTS vip_followups_next_idx ON vip_followups(company_id, next_followup_on) WHERE next_followup_on IS NOT NULL;
