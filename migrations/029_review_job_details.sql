-- Job details on reviews (Sep 29 2026): pickup city and service from the dispatch
-- system (TowBook export or the GHL webhook), and how the rating was tied to a job.
-- dispatch_match: 'job' | 'phone' | 'email' | 'name' — only job/phone/email count
-- as a verified job on the public review feed.

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS job_city text;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS job_service text;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS dispatch_job_id text;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS dispatch_match text;
ALTER TABLE review_contexts ADD COLUMN IF NOT EXISTS job_city text;
ALTER TABLE review_contexts ADD COLUMN IF NOT EXISTS job_service text;
