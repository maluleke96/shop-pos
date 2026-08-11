-- Shop POS → Supabase: Storage buckets and object policies
-- SAFE: INSERT buckets on conflict skip; idempotent policies

-- ---------------------------------------------------------------------------
-- Buckets
-- logos, products → public read; all others private
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('logos', 'logos', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('products', 'products', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp']),
  ('hr-documents', 'hr-documents', false, 20971520, NULL),
  ('documents', 'documents', false, 20971520, NULL),
  ('cash-drops', 'cash-drops', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('recipe', 'recipe', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('marketing', 'marketing', false, 52428800, NULL),
  ('selfies', 'selfies', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Helper: management roles for storage writes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_has_management_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role('owner', 'manager', 'assistant_manager', 'supervisor');
$$;

-- ---------------------------------------------------------------------------
-- Public buckets: anyone can read logos + products
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS storage_logos_public_read ON storage.objects;
CREATE POLICY storage_logos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'logos');

DROP POLICY IF EXISTS storage_products_public_read ON storage.objects;
CREATE POLICY storage_products_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'products');

DROP POLICY IF EXISTS storage_logos_management_write ON storage.objects;
CREATE POLICY storage_logos_management_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'logos' AND public.storage_has_management_role())
  WITH CHECK (bucket_id = 'logos' AND public.storage_has_management_role());

DROP POLICY IF EXISTS storage_products_management_write ON storage.objects;
CREATE POLICY storage_products_management_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'products' AND public.storage_has_management_role())
  WITH CHECK (bucket_id = 'products' AND public.storage_has_management_role());

-- ---------------------------------------------------------------------------
-- Private buckets: authenticated role-based access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS storage_hr_documents_management ON storage.objects;
CREATE POLICY storage_hr_documents_management ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'hr-documents' AND public.storage_has_management_role())
  WITH CHECK (bucket_id = 'hr-documents' AND public.storage_has_management_role());

DROP POLICY IF EXISTS storage_documents_management ON storage.objects;
CREATE POLICY storage_documents_management ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'documents' AND public.storage_has_management_role())
  WITH CHECK (bucket_id = 'documents' AND public.storage_has_management_role());

DROP POLICY IF EXISTS storage_cash_drops_staff ON storage.objects;
CREATE POLICY storage_cash_drops_staff ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'cash-drops'
    AND public.has_role('owner', 'manager', 'assistant_manager', 'supervisor', 'cashier')
  )
  WITH CHECK (
    bucket_id = 'cash-drops'
    AND public.has_role('owner', 'manager', 'assistant_manager', 'supervisor', 'cashier')
  );

DROP POLICY IF EXISTS storage_recipe_management ON storage.objects;
CREATE POLICY storage_recipe_management ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'recipe' AND public.storage_has_management_role())
  WITH CHECK (bucket_id = 'recipe' AND public.storage_has_management_role());

DROP POLICY IF EXISTS storage_marketing ON storage.objects;
CREATE POLICY storage_marketing ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'marketing'
    AND public.has_role('owner', 'manager', 'assistant_manager', 'supervisor', 'marketing_agent')
  )
  WITH CHECK (
    bucket_id = 'marketing'
    AND public.has_role('owner', 'manager', 'assistant_manager', 'supervisor', 'marketing_agent')
  );

DROP POLICY IF EXISTS storage_selfies_hr ON storage.objects;
CREATE POLICY storage_selfies_hr ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'selfies'
    AND (
      public.storage_has_management_role()
      OR public.is_staff_employee()
    )
  )
  WITH CHECK (
    bucket_id = 'selfies'
    AND (
      public.storage_has_management_role()
      OR public.is_staff_employee()
    )
  );

-- Authenticated read on private buckets (management / relevant roles)
DROP POLICY IF EXISTS storage_private_authenticated_read ON storage.objects;
CREATE POLICY storage_private_authenticated_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('hr-documents', 'documents', 'cash-drops', 'recipe', 'marketing', 'selfies')
    AND (
      public.storage_has_management_role()
      OR (bucket_id = 'marketing' AND public.has_role('marketing_agent'))
      OR (bucket_id = 'cash-drops' AND public.has_role('cashier'))
      OR (bucket_id = 'selfies' AND public.is_staff_employee())
    )
  );
