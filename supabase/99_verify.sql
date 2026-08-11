-- Shop POS → Supabase: read-only verification (SQL Editor)
-- Run after schema + auth + data import. Does not modify data.

-- ---------------------------------------------------------------------------
-- 1) Table inventory in public schema
-- ---------------------------------------------------------------------------
SELECT
  c.relname AS table_name,
  c.reltuples::bigint AS approx_rows,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- ---------------------------------------------------------------------------
-- 2) Core table counts
-- ---------------------------------------------------------------------------
SELECT 'profiles' AS entity, COUNT(*) AS row_count FROM public.profiles
UNION ALL SELECT 'users (legacy)', COUNT(*) FROM public.users
UNION ALL SELECT 'products', COUNT(*) FROM public.products
UNION ALL SELECT 'categories', COUNT(*) FROM public.categories
UNION ALL SELECT 'sales', COUNT(*) FROM public.sales
UNION ALL SELECT 'customers', COUNT(*) FROM public.customers
UNION ALL SELECT 'employees', COUNT(*) FROM public.employees
ORDER BY entity;

-- ---------------------------------------------------------------------------
-- 3) Profiles linked to legacy users
-- ---------------------------------------------------------------------------
SELECT
  p.id,
  p.username,
  p.full_name,
  p.role,
  p.is_active,
  p.legacy_user_id,
  u.username AS legacy_username
FROM public.profiles p
LEFT JOIN public.users u ON u.id = p.legacy_user_id
ORDER BY p.created_at DESC
LIMIT 50;

-- ---------------------------------------------------------------------------
-- 4) RLS enabled on core tables
-- ---------------------------------------------------------------------------
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'shop_settings', 'users', 'profiles', 'categories', 'products',
    'sales', 'sale_items', 'sale_payments', 'customers', 'suppliers',
    'stock_movements', 'employees', 'notifications', 'audit_log',
    'held_orders', 'returns', 'expenses', 'purchase_orders', 'shifts'
  )
ORDER BY tablename;

-- ---------------------------------------------------------------------------
-- 5) Sample FK integrity (sales → sale_items)
-- ---------------------------------------------------------------------------
SELECT
  s.id AS sale_id,
  s.receipt_number,
  COUNT(si.id) AS item_count,
  COALESCE(SUM(si.line_total), 0) AS items_total
FROM public.sales s
LEFT JOIN public.sale_items si ON si.sale_id = s.id
GROUP BY s.id, s.receipt_number
ORDER BY s.id DESC
LIMIT 10;

-- ---------------------------------------------------------------------------
-- 6) Counter tables
-- ---------------------------------------------------------------------------
SELECT 'receipt_counter' AS counter, last_number FROM public.receipt_counter WHERE id = 1
UNION ALL
SELECT 'order_counter', last_number FROM public.order_counter WHERE id = 1;

-- ---------------------------------------------------------------------------
-- 7) Archived online-order tables (should exist but unused)
-- ---------------------------------------------------------------------------
SELECT 'legacy_online_orders_local' AS archived_table, COUNT(*) AS rows
FROM public.legacy_online_orders_local
UNION ALL
SELECT 'legacy_sync_outbox', COUNT(*) FROM public.legacy_sync_outbox;

-- ---------------------------------------------------------------------------
-- 8) Storage buckets
-- ---------------------------------------------------------------------------
SELECT id, name, public, file_size_limit
FROM storage.buckets
WHERE id IN (
  'logos', 'products', 'hr-documents', 'documents',
  'cash-drops', 'recipe', 'marketing', 'selfies'
)
ORDER BY id;

-- ---------------------------------------------------------------------------
-- 9) Realtime publication membership
-- ---------------------------------------------------------------------------
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
ORDER BY tablename;

-- ---------------------------------------------------------------------------
-- 10) Helper functions exist
-- ---------------------------------------------------------------------------
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'current_profile', 'has_role', 'is_staff_employee',
    'next_receipt_number', 'next_order_number', 'set_updated_at'
  )
ORDER BY p.proname;
