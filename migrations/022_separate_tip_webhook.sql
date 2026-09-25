-- Keep existing review automations isolated from successful-tip automations.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS tip_webhook_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tip_webhook_url text;
