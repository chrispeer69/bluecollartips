-- Companies can keep the quick feedback badges or use only the written review field.
-- Existing companies retain the current badge experience.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS review_badges_enabled boolean NOT NULL DEFAULT true;
