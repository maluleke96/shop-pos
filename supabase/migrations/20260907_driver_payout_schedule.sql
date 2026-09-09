-- Per-driver scheduled payout day for claim window (0=Sun … 6=Sat).
ALTER TABLE public.delivery_drivers ADD COLUMN IF NOT EXISTS payout_day_of_week INTEGER;
