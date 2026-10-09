-- Text customers a fresh tip & review link through the company's own
-- GoHighLevel sub-account (Private Integration token, stored encrypted).
CREATE TABLE IF NOT EXISTS company_ghl_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  location_id text NOT NULL CHECK (char_length(location_id) BETWEEN 1 AND 100),
  api_key_encrypted text NOT NULL,
  api_key_last4 text NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- When staff last texted the customer a new link from the VIP report.
ALTER TABLE vip_followups
  ADD COLUMN IF NOT EXISTS link_resent_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_resent_count integer NOT NULL DEFAULT 0 CHECK (link_resent_count >= 0);
