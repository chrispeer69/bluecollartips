-- Public reviews (Sep 28 2026). A rating may appear on the company's own website
-- only if the customer submitted it after the rating form started telling them so.
-- Older ratings stay false: they still count toward public averages, but their
-- comment and name are never published.

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS public_ok boolean NOT NULL DEFAULT false;
