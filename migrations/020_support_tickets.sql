-- Tenant support: tickets opened by company admins or employees, answered by
-- the platform (Blue Collar Tips). Company admins see every ticket for their
-- company; employees see only their own; super admins see all.
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_role text NOT NULL CHECK (created_by_role IN ('company_admin', 'employee', 'super_admin')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('getting_started', 'employees', 'qr_links', 'integrations', 'tips_payments', 'payouts', 'ratings', 'account', 'billing', 'bug', 'feature', 'other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'waiting_on_platform', 'waiting_on_tenant', 'resolved', 'closed')),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_tickets_company_idx ON support_tickets(company_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_creator_idx ON support_tickets(created_by, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- 'platform' = a Blue Collar Tips reply; 'tenant' = company admin or employee;
  -- 'system' = automated status notes.
  author_kind text NOT NULL CHECK (author_kind IN ('tenant', 'platform', 'system')),
  -- Internal notes are visible to super admins only.
  internal boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON support_messages(ticket_id, created_at ASC);
