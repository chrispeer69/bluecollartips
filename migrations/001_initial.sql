CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE app_role AS ENUM ('super_admin', 'company_admin', 'driver'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE driver_status AS ENUM ('pending', 'active', 'deactivated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tip_source AS ENUM ('stripe', 'cash', 'venmo', 'cashapp', 'zelle', 'paypal', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE flag_status AS ENUM ('open', 'resolved', 'violation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  password_hash text, full_name text NOT NULL, phone text, photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL, provider_account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
  logo_url text, primary_color text DEFAULT '#0F2A44', secondary_color text DEFAULT '#F97316',
  support_email text, support_phone text, sms_template text DEFAULT 'Thanks for choosing us! Please rate your experience: {link}',
  google_review_url text, yelp_review_url text, facebook_review_url text,
  driver_pct integer NOT NULL DEFAULT 80, company_pct integer NOT NULL DEFAULT 10, platform_pct integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'active', thank_you_enabled boolean NOT NULL DEFAULT true,
  thank_you_sms_template text NOT NULL DEFAULT 'Thanks for your feedback, {{customer_name}}! We appreciate you choosing {{company_name}}.',
  thank_you_email_subject text NOT NULL DEFAULT 'Thanks from {{company_name}}',
  thank_you_email_template text NOT NULL DEFAULT 'Hi {{customer_name}}, thank you for your feedback!',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, full_name text, phone text, photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE, role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, company_id, role)
);
CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL, address text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id, name)
);
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL, location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  display_name text NOT NULL, slug text NOT NULL, employee_id text, email text, phone text, photo_url text,
  status driver_status NOT NULL DEFAULT 'pending', venmo_handle text, cashapp_handle text, zelle_handle text, paypal_handle text,
  stripe_account_id text, stripe_onboarded boolean NOT NULL DEFAULT false,
  stripe_charges_enabled boolean NOT NULL DEFAULT false, stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  notify_sms boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id, slug)
);
CREATE TABLE IF NOT EXISTS ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE, stars smallint NOT NULL CHECK(stars BETWEEN 1 AND 5),
  feedback text, customer_name text, customer_contact text, customer_phone text, customer_email text, flagged boolean NOT NULL DEFAULT false,
  admin_notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE, rating_id uuid REFERENCES ratings(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 100 AND 50000), source tip_source NOT NULL,
  customer_name text, customer_contact text, driver_amount_cents integer NOT NULL,
  company_amount_cents integer NOT NULL, platform_amount_cents integer NOT NULL,
  logged_by uuid REFERENCES users(id) ON DELETE SET NULL, note text, stripe_payment_intent_id text UNIQUE, stripe_status text,
  verified boolean NOT NULL DEFAULT false, verified_at timestamptz, verification_due_at timestamptz,
  disputed boolean NOT NULL DEFAULT false, disputed_at timestamptz, dispute_reason text, refunded_at timestamptz, refund_amount_cents integer,
  refund_reason text, stripe_refund_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discrepancy_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE, tip_id uuid REFERENCES tips(id) ON DELETE SET NULL,
  reason text NOT NULL, status flag_status NOT NULL DEFAULT 'open', notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS cash_tip_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL, tip_id uuid REFERENCES tips(id) ON DELETE SET NULL,
  customer_contact text, called_at timestamptz NOT NULL DEFAULT now(), called_by uuid REFERENCES users(id) ON DELETE SET NULL,
  outcome text NOT NULL, notes text, reported_amount_cents integer, confirmed_amount_cents integer,
  confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL, reported_method text
);
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email text, phone text, role app_role NOT NULL DEFAULT 'driver', code text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, used_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rating_rate_limits (
  ip_hash text NOT NULL, driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL, count integer NOT NULL DEFAULT 0,
  PRIMARY KEY(ip_hash, driver_id, window_start)
);
CREATE TABLE IF NOT EXISTS sms_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL, rating_id uuid REFERENCES ratings(id) ON DELETE SET NULL,
  to_phone text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'queued', provider_sid text, error text,
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL, rating_id uuid REFERENCES ratings(id) ON DELETE SET NULL,
  to_email text NOT NULL, subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'queued',
  provider_id text, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS suppressed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, reason text NOT NULL DEFAULT 'unsubscribe',
  source text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, token text NOT NULL UNIQUE,
  used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id text, template_name text NOT NULL,
  recipient_email text NOT NULL, status text NOT NULL, error_message text, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drivers_company_idx ON drivers(company_id);
CREATE INDEX IF NOT EXISTS ratings_driver_idx ON ratings(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tips_driver_idx ON tips(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS roles_user_idx ON user_roles(user_id);

CREATE OR REPLACE FUNCTION apply_tip_split() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d_pct integer; c_pct integer; p_pct integer;
BEGIN
  SELECT driver_pct, company_pct, platform_pct INTO d_pct, c_pct, p_pct FROM companies WHERE id = NEW.company_id;
  NEW.driver_amount_cents := (NEW.amount_cents * COALESCE(d_pct, 80)) / 100;
  NEW.company_amount_cents := (NEW.amount_cents * COALESCE(c_pct, 10)) / 100;
  NEW.platform_amount_cents := NEW.amount_cents - NEW.driver_amount_cents - NEW.company_amount_cents;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tip_split ON tips;
CREATE TRIGGER trg_tip_split BEFORE INSERT OR UPDATE OF amount_cents, company_id ON tips FOR EACH ROW EXECUTE FUNCTION apply_tip_split();
