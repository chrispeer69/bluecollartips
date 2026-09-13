-- Keep whatever driver identifier dispatch (TowBook/GHL) sent with a job, even
-- when it did not match an employee, so admins can see who the review was
-- meant for and attribute it with one click.
ALTER TABLE review_contexts
  ADD COLUMN IF NOT EXISTS dispatch_driver_name text;
