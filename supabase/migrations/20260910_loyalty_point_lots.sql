CREATE TABLE IF NOT EXISTS public.loyalty_point_lots (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id),
  transaction_id bigint REFERENCES public.loyalty_transactions(id),
  points_remaining numeric NOT NULL,
  points_original numeric NOT NULL,
  earned_at text NOT NULL,
  expires_at text NOT NULL,
  last_reminder_at text,
  created_at text DEFAULT now()::text
);

CREATE INDEX IF NOT EXISTS idx_loyalty_lots_customer ON public.loyalty_point_lots(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_lots_expiry ON public.loyalty_point_lots(expires_at);
