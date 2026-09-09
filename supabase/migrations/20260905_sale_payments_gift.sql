-- sale_payments gift card + reference (Manager app reads these columns)
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS gift_card_code TEXT;
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS reference TEXT;
