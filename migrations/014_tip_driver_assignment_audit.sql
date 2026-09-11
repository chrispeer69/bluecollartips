-- Company-level tips may be assigned to an employee after payment when the
-- company identifies who handled the service.
ALTER TABLE tips
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
