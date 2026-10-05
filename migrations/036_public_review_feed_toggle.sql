-- Public review feeds are disabled per tenant unless the company explicitly
-- enables sharing. Preserve the existing Roadside integration.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS public_review_feed_enabled boolean NOT NULL DEFAULT false;

UPDATE companies
SET public_review_feed_enabled = true
WHERE slug = 'roadside-towing';
