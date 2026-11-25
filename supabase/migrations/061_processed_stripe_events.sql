BEGIN;

-- M-18: Stripe retries a webhook when a delivery times out or a handler 5xxes.
-- Without a record of handled events, a retried plan event re-applies the same
-- tenant update. Each event id is inserted before its side effect runs; a
-- second delivery of the same id finds the row and is acknowledged unchanged.
CREATE TABLE public.processed_stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.processed_stripe_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.processed_stripe_events TO service_role;

COMMENT ON TABLE public.processed_stripe_events IS
  'Stripe event ids already applied by the billing webhook; deduplicates retried deliveries.';

COMMIT;
