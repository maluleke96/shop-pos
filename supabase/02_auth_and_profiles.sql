-- Shop POS → Supabase: Auth bridge (profiles) + helper functions
-- SAFE: no DROP of legacy public.users — keep for SQLite data import
--
-- MIGRATION NOTE (passwords):
-- Legacy public.users.password_hash is bcrypt from the Electron app.
-- Supabase Auth (GoTrue) cannot import bcrypt hashes directly.
-- After data import: create auth.users via Admin API / Dashboard, then link
-- public.profiles.id = auth.users.id and set legacy_user_id from users.id.
-- Users must reset passwords (or receive invite links) on first cloud login.
-- Store POS PIN separately in profiles.pin_hash (also bcrypt) for quick-switch.

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  legacy_user_id bigint UNIQUE,
  username text UNIQUE,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'cashier'
    CHECK (role IN (
      'owner',
      'manager',
      'assistant_manager',
      'supervisor',
      'marketing_agent',
      'cashier'
    )),
  is_active boolean NOT NULL DEFAULT true,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  pin_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_legacy_user_id_idx ON public.profiles (legacy_user_id);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);

COMMENT ON TABLE public.profiles IS
  'Supabase Auth bridge. One row per auth.users. legacy_user_id maps to imported public.users.id.';

-- ---------------------------------------------------------------------------
-- Helper: current signed-in profile row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_profile() IS
  'Returns the profile row for auth.uid(), or NULL if unauthenticated / no profile.';

-- ---------------------------------------------------------------------------
-- Helper: role check for RLS policies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(VARIADIC roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.role = ANY (roles)
  );
$$;

COMMENT ON FUNCTION public.has_role(text[]) IS
  'True when the current auth user has an active profile with one of the given roles.';

-- ---------------------------------------------------------------------------
-- Stub: staff portal employee session (JWT custom claims)
-- Expects request.jwt.claims JSON with employee_id and/or employee_code.
-- Wire up via Edge Function or custom access token hook when staff portal ships.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff_employee()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'employee_id',
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'employee_code',
    ''
  ) <> '';
$$;

COMMENT ON FUNCTION public.is_staff_employee() IS
  'Stub: true when JWT claims include employee_id or employee_code (staff portal).';

-- Optional: auto-create profile shell when auth user is created (manual linking still needed)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email, 'User'),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'cashier')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();
