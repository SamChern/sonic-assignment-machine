ALTER TABLE public.listener_subscriptions
  ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listener_subscriptions_billing_period_check'
  ) THEN
    ALTER TABLE public.listener_subscriptions
      ADD CONSTRAINT listener_subscriptions_billing_period_check
      CHECK (billing_period IN ('monthly', 'annual'));
  END IF;
END $$;