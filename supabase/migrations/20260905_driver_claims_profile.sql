-- Driver profile photos, vehicle registration, payout claims
ALTER TABLE public.delivery_drivers ADD COLUMN IF NOT EXISTS profile_photo_path TEXT;
ALTER TABLE public.delivery_drivers ADD COLUMN IF NOT EXISTS vehicle_registration TEXT;

CREATE TABLE IF NOT EXISTS public.delivery_driver_payout_claims (
  id BIGSERIAL PRIMARY KEY,
  driver_id BIGINT NOT NULL REFERENCES public.delivery_drivers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  delivery_count INTEGER DEFAULT 0,
  period_from TEXT,
  period_to TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  claimed_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by BIGINT,
  reviewed_by_name TEXT,
  admin_notes TEXT,
  payout_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_payout_claims_driver ON public.delivery_driver_payout_claims(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_driver_payout_claims_status ON public.delivery_driver_payout_claims(status, claimed_at DESC);
