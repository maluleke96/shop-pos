-- Shop POS → Supabase: shared functions and updated_at triggers
-- SAFE: CREATE OR REPLACE / conditional DO blocks only

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger function (works with timestamptz or text columns)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic receipt number (locks receipt_counter row)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_receipt_number()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  IF to_regclass('public.receipt_counter') IS NULL THEN
    RAISE EXCEPTION 'receipt_counter table does not exist';
  END IF;

  UPDATE public.receipt_counter
  SET last_number = COALESCE(last_number, 0) + 1
  WHERE id = 1
  RETURNING last_number INTO v_num;

  IF v_num IS NULL THEN
    INSERT INTO public.receipt_counter (id, last_number)
    VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE
      SET last_number = public.receipt_counter.last_number + 1
    RETURNING last_number INTO v_num;
  END IF;

  RETURN v_num;
END;
$$;

COMMENT ON FUNCTION public.next_receipt_number() IS
  'Increments receipt_counter.last_number and returns the new value (id=1 row).';

-- ---------------------------------------------------------------------------
-- Atomic order number (same pattern as receipts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  IF to_regclass('public.order_counter') IS NULL THEN
    RAISE EXCEPTION 'order_counter table does not exist';
  END IF;

  UPDATE public.order_counter
  SET last_number = COALESCE(last_number, 0) + 1
  WHERE id = 1
  RETURNING last_number INTO v_num;

  IF v_num IS NULL THEN
    INSERT INTO public.order_counter (id, last_number)
    VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE
      SET last_number = public.order_counter.last_number + 1
    RETURNING last_number INTO v_num;
  END IF;

  RETURN v_num;
END;
$$;

COMMENT ON FUNCTION public.next_order_number() IS
  'Increments order_counter.last_number and returns the new value (id=1 row).';

-- ---------------------------------------------------------------------------
-- Attach set_updated_at only where table + updated_at column exist
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'shop_settings',
    'products',
    'users',
    'customers',
    'suppliers'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_set_updated_at ON public.%I', tbl, tbl);
      EXECUTE format(
        'CREATE TRIGGER trg_%I_set_updated_at
           BEFORE UPDATE ON public.%I
           FOR EACH ROW
           EXECUTE FUNCTION public.set_updated_at()',
        tbl, tbl
      );
    END IF;
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_column THEN NULL;
END $$;

-- profiles.updated_at (timestamptz)
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_profiles_set_updated_at ON public.profiles;
    CREATE TRIGGER trg_profiles_set_updated_at
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
