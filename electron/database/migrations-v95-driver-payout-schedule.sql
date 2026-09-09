-- Per-driver scheduled payout day (0=Sun … 6=Sat). NULL = use global delivery_settings default.
ALTER TABLE delivery_drivers ADD COLUMN payout_day_of_week INTEGER;
