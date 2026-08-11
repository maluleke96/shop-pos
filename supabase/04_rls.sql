-- Shop POS → Supabase: Row Level Security
-- SAFE: ENABLE RLS + idempotent DROP POLICY IF EXISTS / CREATE POLICY
-- Roles: owner, manager, assistant_manager, supervisor, marketing_agent, cashier

-- ---------------------------------------------------------------------------
-- Enable RLS on core tables (skip missing tables)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'shop_settings',
    'users',
    'profiles',
    'categories',
    'products',
    'sales',
    'sale_items',
    'sale_payments',
    'customers',
    'suppliers',
    'stock_movements',
    'employees',
    'notifications',
    'audit_log',
    'held_orders',
    'returns',
    'expenses',
    'purchase_orders',
    'shifts'
  ]
  LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;

-- Convenience role groups (inline in policies via has_role)
-- management: owner, manager, assistant_manager, supervisor
-- pos_staff:  above + cashier

-- ===========================================================================
-- profiles
-- ===========================================================================
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_select_management ON public.profiles;
CREATE POLICY profiles_select_management ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS profiles_insert_owner ON public.profiles;
CREATE POLICY profiles_insert_owner ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role('owner'));

DROP POLICY IF EXISTS profiles_update_owner ON public.profiles;
CREATE POLICY profiles_update_owner ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role('owner'))
  WITH CHECK (public.has_role('owner'));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ===========================================================================
-- shop_settings — management only
-- ===========================================================================
DROP POLICY IF EXISTS shop_settings_management_all ON public.shop_settings;
CREATE POLICY shop_settings_management_all ON public.shop_settings
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

-- ===========================================================================
-- legacy users — owner/manager read; owner write
-- ===========================================================================
DROP POLICY IF EXISTS users_select_management ON public.users;
CREATE POLICY users_select_management ON public.users
  FOR SELECT TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS users_write_owner ON public.users;
CREATE POLICY users_write_owner ON public.users
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager'))
  WITH CHECK (public.has_role('owner', 'manager'));

-- ===========================================================================
-- categories & products — all staff read; management write
-- ===========================================================================
DROP POLICY IF EXISTS categories_select_staff ON public.categories;
CREATE POLICY categories_select_staff ON public.categories
  FOR SELECT TO authenticated
  USING (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'marketing_agent', 'cashier'
    )
  );

DROP POLICY IF EXISTS categories_write_management ON public.categories;
CREATE POLICY categories_write_management ON public.categories
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS products_select_staff ON public.products;
CREATE POLICY products_select_staff ON public.products
  FOR SELECT TO authenticated
  USING (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'marketing_agent', 'cashier'
    )
  );

DROP POLICY IF EXISTS products_write_management ON public.products;
CREATE POLICY products_write_management ON public.products
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

-- ===========================================================================
-- sales pipeline — cashiers insert; management full access
-- ===========================================================================
DROP POLICY IF EXISTS sales_select_staff ON public.sales;
CREATE POLICY sales_select_staff ON public.sales
  FOR SELECT TO authenticated
  USING (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS sales_insert_pos ON public.sales;
CREATE POLICY sales_insert_pos ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS sales_update_management ON public.sales;
CREATE POLICY sales_update_management ON public.sales
  FOR UPDATE TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS sales_delete_management ON public.sales;
CREATE POLICY sales_delete_management ON public.sales
  FOR DELETE TO authenticated
  USING (public.has_role('owner', 'manager'));

DROP POLICY IF EXISTS sale_items_select_staff ON public.sale_items;
CREATE POLICY sale_items_select_staff ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS sale_items_insert_pos ON public.sale_items;
CREATE POLICY sale_items_insert_pos ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS sale_items_write_management ON public.sale_items;
CREATE POLICY sale_items_write_management ON public.sale_items
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS sale_payments_select_staff ON public.sale_payments;
CREATE POLICY sale_payments_select_staff ON public.sale_payments
  FOR SELECT TO authenticated
  USING (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS sale_payments_insert_pos ON public.sale_payments;
CREATE POLICY sale_payments_insert_pos ON public.sale_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS sale_payments_write_management ON public.sale_payments;
CREATE POLICY sale_payments_write_management ON public.sale_payments
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

-- ===========================================================================
-- customers & suppliers — management full; cashiers read customers
-- ===========================================================================
DROP POLICY IF EXISTS customers_select_staff ON public.customers;
CREATE POLICY customers_select_staff ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS customers_write_management ON public.customers;
CREATE POLICY customers_write_management ON public.customers
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS suppliers_management_all ON public.suppliers;
CREATE POLICY suppliers_management_all ON public.suppliers
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

-- ===========================================================================
-- inventory, HR, ops
-- ===========================================================================
DROP POLICY IF EXISTS stock_movements_management_all ON public.stock_movements;
CREATE POLICY stock_movements_management_all ON public.stock_movements
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS employees_management_all ON public.employees;
CREATE POLICY employees_management_all ON public.employees
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS notifications_select_staff ON public.notifications;
CREATE POLICY notifications_select_staff ON public.notifications
  FOR SELECT TO authenticated
  USING (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier', 'marketing_agent'
    )
  );

DROP POLICY IF EXISTS notifications_write_management ON public.notifications;
CREATE POLICY notifications_write_management ON public.notifications
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS audit_log_select_management ON public.audit_log;
CREATE POLICY audit_log_select_management ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS audit_log_insert_staff ON public.audit_log;
CREATE POLICY audit_log_insert_staff ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS held_orders_pos ON public.held_orders;
CREATE POLICY held_orders_pos ON public.held_orders
  FOR ALL TO authenticated
  USING (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  )
  WITH CHECK (
    public.has_role(
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    )
  );

DROP POLICY IF EXISTS returns_management_all ON public.returns;
CREATE POLICY returns_management_all ON public.returns
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'));

DROP POLICY IF EXISTS expenses_management_all ON public.expenses;
CREATE POLICY expenses_management_all ON public.expenses
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS purchase_orders_management_all ON public.purchase_orders;
CREATE POLICY purchase_orders_management_all ON public.purchase_orders
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor'));

DROP POLICY IF EXISTS shifts_management_all ON public.shifts;
CREATE POLICY shifts_management_all ON public.shifts
  FOR ALL TO authenticated
  USING (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'))
  WITH CHECK (public.has_role('owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'));
