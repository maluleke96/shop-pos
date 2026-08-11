-- Shop POS → Supabase: Realtime publication
-- SAFE: skip tables that do not exist (online ordering tables excluded)

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'notifications',
    'kitchen_orders',
    'kitchen_order_items',
    'held_orders'
  ]
  LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      BEGIN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          tbl
        );
      EXCEPTION
        WHEN duplicate_object THEN
          NULL; -- already in publication
        WHEN undefined_object THEN
          NULL; -- publication missing (local dev)
      END;
    END IF;
  END LOOP;
END $$;
