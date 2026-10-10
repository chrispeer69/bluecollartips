-- Review city coverage, by month (READ-ONLY: SELECT only, changes nothing).
-- Shows how many ratings carry a job city, which is what the company website
-- shows on each review card ("Tim · Columbus") via the private review feed.
--
-- Where the city comes from (the feed uses COALESCE(r.job_city, rc.job_city)):
--   ratings.job_city         -> "Tag reviews with city & service" (Dashboard, TowBook
--                               export import; matches each rating to a job by job
--                               number, phone, email or name and copies the
--                               job's "Tow Source City").
--   review_contexts.job_city -> the GHL review-link webhook
--                               (POST /api/public/webhooks/ghl, JSON field "city"),
--                               stored on the review link when it is created.
--
-- Change the slug below for another company. Run in a read-only session, e.g.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on" -f docs/review-city-coverage.sql
SELECT
  to_char(date_trunc('month', r.created_at AT TIME ZONE 'America/New_York'), 'YYYY-MM') AS month,
  count(*) AS ratings,
  count(*) FILTER (WHERE NULLIF(btrim(COALESCE(r.job_city, rc.job_city)), '') IS NOT NULL) AS with_city,
  round(100.0 * count(*) FILTER (WHERE NULLIF(btrim(COALESCE(r.job_city, rc.job_city)), '') IS NOT NULL) / count(*), 1) AS pct_with_city,
  count(*) FILTER (WHERE NULLIF(btrim(r.job_city), '') IS NOT NULL) AS city_from_towbook_tag,
  count(*) FILTER (WHERE NULLIF(btrim(r.job_city), '') IS NULL AND NULLIF(btrim(rc.job_city), '') IS NOT NULL) AS city_from_ghl_link_only,
  count(*) FILTER (WHERE r.review_context_id IS NOT NULL) AS came_through_review_link,
  count(*) FILTER (WHERE r.review_context_id IS NOT NULL AND NULLIF(btrim(rc.job_city), '') IS NULL) AS review_link_without_city,
  count(*) FILTER (WHERE d.status = 'active') AS with_active_driver
FROM ratings r
JOIN companies c ON c.id = r.company_id
LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
LEFT JOIN drivers d ON d.id = r.driver_id
WHERE c.slug = 'roadside-towing'
GROUP BY 1
ORDER BY 1;
