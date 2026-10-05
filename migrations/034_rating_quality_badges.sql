-- Keep the customer's quick service selections as first-party Blue Collar
-- Tips feedback. They are not used to compose or prefill a public review.

ALTER TABLE ratings
  ADD COLUMN IF NOT EXISTS quality_badges text[] NOT NULL DEFAULT ARRAY[]::text[];
