-- Support chat widget: read receipts, screenshots, and where the tenant was.

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS tenant_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS platform_last_read_at timestamptz;

-- The page (and browser) a message was sent from, so support can see what the
-- tenant was looking at without asking.
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS page_url text CHECK (char_length(page_url) <= 500),
  ADD COLUMN IF NOT EXISTS client_info text CHECK (char_length(client_info) <= 300);

-- A screenshot-only message has an empty body.
ALTER TABLE support_messages DROP CONSTRAINT IF EXISTS support_messages_body_check;
DO $$ BEGIN
  ALTER TABLE support_messages ADD CONSTRAINT support_messages_body_length CHECK (char_length(body) <= 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS support_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 3145728),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_attachments_message_idx ON support_attachments(message_id);
CREATE INDEX IF NOT EXISTS support_attachments_uploader_idx ON support_attachments(uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_author_idx ON support_messages(author_id, created_at DESC);
