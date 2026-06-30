
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('super_admin', 'company_admin', 'driver');
CREATE TYPE public.driver_status AS ENUM ('pending', 'active', 'deactivated');
CREATE TYPE public.tip_source AS ENUM ('stripe', 'cash', 'venmo', 'cashapp', 'zelle', 'paypal', 'other');
CREATE TYPE public.flag_status AS ENUM ('open', 'resolved', 'violation');

-- =========================================================
-- COMPANIES (tenants)
-- =========================================================
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  primary_color text DEFAULT '#0F2A44',
  secondary_color text DEFAULT '#F97316',
  support_email text,
  support_phone text,
  sms_template text DEFAULT 'Thanks for choosing us! Please rate your experience: {link}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.companies TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- USER_ROLES
-- =========================================================
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- security-definer role helpers
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(_user_id uuid, _company_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND company_id = _company_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('super_admin', 'company_admin')
      AND (role = 'super_admin' OR company_id = _company_id)
  )
$$;

-- =========================================================
-- DRIVERS
-- =========================================================
CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  slug text NOT NULL,
  employee_id text,
  email text,
  phone text,
  photo_url text,
  status public.driver_status NOT NULL DEFAULT 'pending',
  venmo_handle text,
  cashapp_handle text,
  zelle_handle text,
  paypal_handle text,
  stripe_onboarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, slug)
);
GRANT SELECT ON public.drivers TO anon;
GRANT SELECT, INSERT, UPDATE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- RATINGS
-- =========================================================
CREATE TABLE public.ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  stars smallint NOT NULL,
  feedback text,
  customer_name text,
  customer_contact text,
  flagged boolean NOT NULL DEFAULT false,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ratings ADD CONSTRAINT ratings_stars_range CHECK (stars BETWEEN 1 AND 5);
GRANT SELECT, INSERT, UPDATE ON public.ratings TO authenticated;
GRANT ALL ON public.ratings TO service_role;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- TIPS
-- =========================================================
CREATE TABLE public.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  rating_id uuid REFERENCES public.ratings(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL,
  source public.tip_source NOT NULL,
  customer_name text,
  driver_amount_cents integer NOT NULL,
  company_amount_cents integer NOT NULL,
  platform_amount_cents integer NOT NULL,
  logged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tips ADD CONSTRAINT tips_amount_positive CHECK (amount_cents BETWEEN 100 AND 50000);
GRANT SELECT, INSERT, UPDATE ON public.tips TO authenticated;
GRANT ALL ON public.tips TO service_role;
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- DISCREPANCY FLAGS
-- =========================================================
CREATE TABLE public.discrepancy_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status public.flag_status NOT NULL DEFAULT 'open',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.discrepancy_flags TO authenticated;
GRANT ALL ON public.discrepancy_flags TO service_role;
ALTER TABLE public.discrepancy_flags ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- CASH TIP VERIFICATIONS
-- =========================================================
CREATE TABLE public.cash_tip_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  customer_contact text,
  called_at timestamptz NOT NULL DEFAULT now(),
  called_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome text NOT NULL,
  reported_amount_cents integer,
  reported_method text,
  notes text
);
GRANT SELECT, INSERT, UPDATE ON public.cash_tip_verifications TO authenticated;
GRANT ALL ON public.cash_tip_verifications TO service_role;
ALTER TABLE public.cash_tip_verifications ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- INVITES
-- =========================================================
CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  role public.app_role NOT NULL DEFAULT 'driver',
  email text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invites TO anon;
GRANT SELECT, INSERT, UPDATE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- POLICIES
-- =========================================================

-- companies: public read of branding (needed for public tip page); admins manage
CREATE POLICY "Companies are publicly readable"
  ON public.companies FOR SELECT
  TO anon, authenticated
  USING (true);
CREATE POLICY "Super admins manage companies"
  ON public.companies FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Company admins update own company"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (public.has_company_role(auth.uid(), id, 'company_admin'))
  WITH CHECK (public.has_company_role(auth.uid(), id, 'company_admin'));

-- profiles
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Users upsert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- user_roles: a user can read their own roles; super admin reads all
CREATE POLICY "Users read own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));

-- drivers: public read of active drivers (for public page); driver reads self; admins manage company drivers
CREATE POLICY "Active drivers publicly readable"
  ON public.drivers FOR SELECT
  TO anon, authenticated
  USING (status = 'active' OR user_id = auth.uid() OR public.is_company_admin(auth.uid(), company_id));
CREATE POLICY "Drivers update self"
  ON public.drivers FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins manage company drivers"
  ON public.drivers FOR ALL
  TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id));

-- ratings: driver reads own; admins read company
CREATE POLICY "Driver reads own ratings"
  ON public.ratings FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = ratings.driver_id AND d.user_id = auth.uid())
    OR public.is_company_admin(auth.uid(), company_id)
  );
CREATE POLICY "Admins update ratings"
  ON public.ratings FOR UPDATE
  TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id));

-- tips: driver reads own; admins read all in company; driver inserts manual cash/P2P for self
CREATE POLICY "Driver reads own tips"
  ON public.tips FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = tips.driver_id AND d.user_id = auth.uid())
    OR public.is_company_admin(auth.uid(), company_id)
  );
CREATE POLICY "Driver logs own manual tip"
  ON public.tips FOR INSERT
  TO authenticated
  WITH CHECK (
    source <> 'stripe'
    AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = tips.driver_id AND d.user_id = auth.uid())
  );
CREATE POLICY "Admins manage company tips"
  ON public.tips FOR ALL
  TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id));

-- flags: driver reads own; admins manage
CREATE POLICY "Driver reads own flags"
  ON public.discrepancy_flags FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = discrepancy_flags.driver_id AND d.user_id = auth.uid())
    OR public.is_company_admin(auth.uid(), company_id)
  );
CREATE POLICY "Admins manage flags"
  ON public.discrepancy_flags FOR ALL
  TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id));

-- verifications: admins manage; driver reads own
CREATE POLICY "Admins manage verifications"
  ON public.cash_tip_verifications FOR ALL
  TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id));
CREATE POLICY "Driver reads own verifications"
  ON public.cash_tip_verifications FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = cash_tip_verifications.driver_id AND d.user_id = auth.uid()));

-- invites: admins manage company invites; anon can SELECT by code (for signup lookup)
CREATE POLICY "Anyone reads invite by code"
  ON public.invites FOR SELECT
  TO anon, authenticated
  USING (true);
CREATE POLICY "Admins manage company invites"
  ON public.invites FOR ALL
  TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id));

-- =========================================================
-- TRIGGER: auto-create profile on signup
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- TRIGGER: enforce 80/10/10 split on tip insert/update
-- =========================================================
CREATE OR REPLACE FUNCTION public.apply_tip_split()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  total integer := NEW.amount_cents;
BEGIN
  NEW.driver_amount_cents   := (total * 80) / 100;
  NEW.company_amount_cents  := (total * 10) / 100;
  NEW.platform_amount_cents := total - NEW.driver_amount_cents - NEW.company_amount_cents;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tip_split
  BEFORE INSERT OR UPDATE OF amount_cents ON public.tips
  FOR EACH ROW EXECUTE FUNCTION public.apply_tip_split();

-- =========================================================
-- SEED: Tenant #1 Roadside Towing
-- =========================================================
INSERT INTO public.companies (name, slug, primary_color, secondary_color, support_email)
VALUES ('Roadside Towing', 'roadside-towing', '#0F2A44', '#F97316', 'support@roadsidetowing.example');
