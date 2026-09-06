-- Keep the existing Roadside Towing employee URL readable.
-- This is intentionally scoped to the exact company and employee name.
UPDATE drivers AS d
SET slug = 'isaac-halleck'
FROM companies AS c
WHERE d.company_id = c.id
  AND c.slug = 'roadside-towing'
  AND d.display_name = 'Isaac Halleck'
  AND NOT EXISTS (
    SELECT 1
    FROM drivers AS other
    WHERE other.company_id = d.company_id
      AND other.slug = 'isaac-halleck'
      AND other.id <> d.id
  );

UPDATE drivers AS d
SET slug = 'tim-moore'
FROM companies AS c
WHERE d.company_id = c.id
  AND c.slug = 'roadside-towing'
  AND d.display_name = 'Tim Moore'
  AND NOT EXISTS (
    SELECT 1 FROM drivers AS other
    WHERE other.company_id = d.company_id
      AND other.slug = 'tim-moore'
      AND other.id <> d.id
  );
