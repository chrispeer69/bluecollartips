-- Who follows up with VIP customers. Each company keeps its own list of
-- follow-up people (office staff, not necessarily app users). A whole day of
-- review responders is assigned to one person; a single customer can be
-- reassigned, which overrides the day.

CREATE TABLE IF NOT EXISTS vip_followup_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vip_followup_staff_name_idx ON vip_followup_staff(company_id, lower(btrim(name)));

-- `day` is the review date in the company's local time (Eastern for now).
CREATE TABLE IF NOT EXISTS vip_day_assignments (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day date NOT NULL,
  staff_id uuid NOT NULL REFERENCES vip_followup_staff(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, day)
);

ALTER TABLE vip_followups
  ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES vip_followup_staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- Roadside Towing's follow-up team.
INSERT INTO vip_followup_staff (company_id, name, sort_order)
SELECT c.id, v.name, v.ord
FROM companies c
CROSS JOIN (VALUES ('Hannah', 1), ('Nichole', 2), ('Lisa', 3), ('Chris', 4), ('Andrew', 5), ('Conner', 6)) AS v(name, ord)
WHERE c.slug = 'roadside-towing'
ON CONFLICT DO NOTHING;
