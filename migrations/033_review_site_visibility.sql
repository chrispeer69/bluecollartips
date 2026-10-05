-- Let each company decide which configured public destinations appear on the
-- thank-you page. Existing companies keep every destination enabled so this
-- migration does not silently remove buttons they already use.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS enabled_review_sites text[] NOT NULL DEFAULT ARRAY[
    'google',
    'facebook',
    'yelp',
    'apple_maps',
    'bing',
    'usta'
  ]::text[];
