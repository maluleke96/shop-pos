-- Purchase VAT columns + POS tax display (Railway / Supabase)
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS tax_amount numeric DEFAULT 0;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 0;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS tax_amount numeric DEFAULT 0;
ALTER TABLE public.shop_settings ADD COLUMN IF NOT EXISTS tax_show_on_pos integer DEFAULT 1;
