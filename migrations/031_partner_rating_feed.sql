-- Partner rating feed (US Tow Jobs / drivingjobs.online): customer ratings
-- become part of a driver's employment record. Partners pull changes since a
-- time, and receive a signed webhook for every new, changed or removed rating.

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE ratings SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE ratings ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE ratings ALTER COLUMN updated_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS ratings_company_updated_idx ON ratings(company_id, updated_at, id);

-- Ratings that were deleted, so partners can take them off a driver's record.
CREATE TABLE IF NOT EXISTS partner_rating_tombstones (
  rating_id uuid PRIMARY KEY,
  -- No foreign key: deleting a company cascades into ratings, and these rows
  -- are written during that delete.
  company_id uuid NOT NULL,
  driver_id uuid,
  snapshot jsonb,
  removed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_rating_tombstones_company_idx ON partner_rating_tombstones(company_id, removed_at);

-- Outbox of webhook deliveries; a background sender works through it.
CREATE TABLE IF NOT EXISTS partner_rating_events (
  id bigserial PRIMARY KEY,
  -- No foreign key: deleting a company cascades into ratings, and these rows
  -- are written during that delete.
  company_id uuid NOT NULL,
  rating_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('rating.created', 'rating.updated', 'rating.removed')),
  -- The rating as it was when removed (it no longer exists to look up).
  snapshot jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS partner_rating_events_due_idx ON partner_rating_events(next_attempt_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION ratings_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION ratings_partner_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO partner_rating_events (company_id, rating_id, event) VALUES (NEW.company_id, NEW.id, 'rating.created');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO partner_rating_events (company_id, rating_id, event) VALUES (NEW.company_id, NEW.id, 'rating.updated');
  ELSE
    INSERT INTO partner_rating_tombstones (rating_id, company_id, driver_id, snapshot) VALUES (OLD.id, OLD.company_id, OLD.driver_id, to_jsonb(OLD))
      ON CONFLICT (rating_id) DO UPDATE SET removed_at = now(), snapshot = EXCLUDED.snapshot;
    INSERT INTO partner_rating_events (company_id, rating_id, event, snapshot)
      VALUES (OLD.company_id, OLD.id, 'rating.removed', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

-- Only changes a partner cares about bump updated_at and fire an update.
DROP TRIGGER IF EXISTS trg_ratings_touch ON ratings;
CREATE TRIGGER trg_ratings_touch
  BEFORE UPDATE ON ratings
  FOR EACH ROW
  WHEN (OLD.driver_id IS DISTINCT FROM NEW.driver_id OR OLD.stars IS DISTINCT FROM NEW.stars
        OR OLD.feedback IS DISTINCT FROM NEW.feedback OR OLD.customer_name IS DISTINCT FROM NEW.customer_name
        OR OLD.job_city IS DISTINCT FROM NEW.job_city OR OLD.job_service IS DISTINCT FROM NEW.job_service
        OR OLD.review_context_id IS DISTINCT FROM NEW.review_context_id)
  EXECUTE FUNCTION ratings_touch_updated_at();

DROP TRIGGER IF EXISTS trg_ratings_partner_insert ON ratings;
CREATE TRIGGER trg_ratings_partner_insert AFTER INSERT ON ratings
  FOR EACH ROW EXECUTE FUNCTION ratings_partner_events();

DROP TRIGGER IF EXISTS trg_ratings_partner_update ON ratings;
CREATE TRIGGER trg_ratings_partner_update AFTER UPDATE ON ratings
  FOR EACH ROW
  WHEN (OLD.driver_id IS DISTINCT FROM NEW.driver_id OR OLD.stars IS DISTINCT FROM NEW.stars
        OR OLD.feedback IS DISTINCT FROM NEW.feedback OR OLD.customer_name IS DISTINCT FROM NEW.customer_name
        OR OLD.job_city IS DISTINCT FROM NEW.job_city OR OLD.job_service IS DISTINCT FROM NEW.job_service
        OR OLD.review_context_id IS DISTINCT FROM NEW.review_context_id)
  EXECUTE FUNCTION ratings_partner_events();

DROP TRIGGER IF EXISTS trg_ratings_partner_delete ON ratings;
CREATE TRIGGER trg_ratings_partner_delete AFTER DELETE ON ratings
  FOR EACH ROW EXECUTE FUNCTION ratings_partner_events();
