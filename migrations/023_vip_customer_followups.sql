-- VIP customer follow-up: one row per dispatch job (Towbook call #) tracking
-- the warm-lead path after a customer answers a GHL review request —
-- Google review, and the Convini app link sent → clicked → registered.
-- Automated events (GHL workflow, tracked link, Convini) and staff edits both
-- land here.
CREATE TABLE IF NOT EXISTS vip_followups (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_job_id text NOT NULL,
  google_clicked_at timestamptz,
  google_posted_at timestamptz,
  google_stars smallint CHECK (google_stars BETWEEN 1 AND 5),
  convini_link_sent_at timestamptz,
  convini_link_last_sent_at timestamptz,
  convini_link_sent_count integer NOT NULL DEFAULT 0 CHECK (convini_link_sent_count >= 0),
  convini_clicked_at timestamptz,
  convini_last_clicked_at timestamptz,
  convini_click_count integer NOT NULL DEFAULT 0 CHECK (convini_click_count >= 0),
  convini_registered_at timestamptz,
  convini_registered_source text CHECK (convini_registered_source IN ('staff', 'ghl', 'convini')),
  contacted_at timestamptz,
  notes text CHECK (char_length(notes) <= 2000),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, external_job_id)
);

CREATE INDEX IF NOT EXISTS review_contexts_company_contact_idx
  ON review_contexts(company_id, external_contact_id) WHERE external_contact_id IS NOT NULL;
