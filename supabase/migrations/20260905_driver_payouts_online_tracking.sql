-- Driver payouts (v89), delivery confirmation codes (v88), online order tracking columns

ALTER TABLE public.delivery_drivers ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.delivery_drivers ADD COLUMN IF NOT EXISTS bank_account TEXT;
ALTER TABLE public.delivery_drivers ADD COLUMN IF NOT EXISTS bank_branch_code TEXT;

ALTER TABLE public.delivery_settings ADD COLUMN IF NOT EXISTS payout_cycle_days INTEGER DEFAULT 7;
ALTER TABLE public.delivery_settings ADD COLUMN IF NOT EXISTS payout_day_of_week INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.delivery_driver_payouts (
  id BIGSERIAL PRIMARY KEY,
  driver_id BIGINT NOT NULL REFERENCES public.delivery_drivers(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  period_from TEXT,
  period_to TEXT,
  paid_at TIMESTAMPTZ,
  paid_by BIGINT,
  paid_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_payouts_driver ON public.delivery_driver_payouts(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_paid ON public.delivery_driver_payouts(paid_at);

ALTER TABLE public.delivery_assignments ADD COLUMN IF NOT EXISTS confirmation_code TEXT;
ALTER TABLE public.delivery_assignments ADD COLUMN IF NOT EXISTS source_label TEXT;
ALTER TABLE public.delivery_assignments ADD COLUMN IF NOT EXISTS pickup_at_store INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_confirm ON public.delivery_assignments(confirmation_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_assignments_confirm_uq
  ON public.delivery_assignments(confirmation_code) WHERE confirmation_code IS NOT NULL;

ALTER TABLE public.online_orders_local ADD COLUMN IF NOT EXISTS gift_card_code TEXT;
ALTER TABLE public.online_orders_local ADD COLUMN IF NOT EXISTS gift_card_amount DOUBLE PRECISION DEFAULT 0;
ALTER TABLE public.online_orders_local ADD COLUMN IF NOT EXISTS confirmation_code TEXT;
ALTER TABLE public.online_orders_local ADD COLUMN IF NOT EXISTS tracking_token TEXT;
