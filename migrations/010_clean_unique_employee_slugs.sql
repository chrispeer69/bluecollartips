-- Normalize existing employee URLs when the name-derived slug is unique inside
-- the company. Duplicate names retain their existing unique suffixes.
WITH normalized AS (
  SELECT
    d.id,
    d.company_id,
    LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(d.display_name), '[^a-z0-9]+', '-', 'g')), 60) AS base_slug
  FROM drivers AS d
), eligible AS (
  SELECT candidate.id, candidate.base_slug
  FROM normalized AS candidate
  WHERE candidate.base_slug <> ''
    AND (
      SELECT COUNT(*)
      FROM normalized AS sibling
      WHERE sibling.company_id = candidate.company_id
        AND sibling.base_slug = candidate.base_slug
    ) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM drivers AS other
      WHERE other.company_id = candidate.company_id
        AND other.slug = candidate.base_slug
        AND other.id <> candidate.id
    )
)
UPDATE drivers AS d
SET slug = eligible.base_slug
FROM eligible
WHERE d.id = eligible.id
  AND d.slug <> eligible.base_slug;
