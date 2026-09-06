CREATE TABLE public.listener_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text,
  plan text NOT NULL DEFAULT 'listener',
  status text NOT NULL DEFAULT 'awaiting_payment',
  price_cents integer NOT NULL DEFAULT 299,
  terms_accepted boolean NOT NULL DEFAULT false,
  data_sharing_accepted boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.listener_subscriptions TO authenticated;
GRANT ALL ON public.listener_subscriptions TO service_role;

ALTER TABLE public.listener_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own membership"
ON public.listener_subscriptions FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Members create their own pending membership"
ON public.listener_subscriptions FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'awaiting_payment'
  AND plan = 'listener'
  AND activated_at IS NULL
);

CREATE POLICY "Admins read all memberships"
ON public.listener_subscriptions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.listener_subscriptions_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('awaiting_payment', 'active', 'cancelled') THEN
    RAISE EXCEPTION 'Unsupported membership status: %', NEW.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER listener_subscriptions_validate
BEFORE INSERT OR UPDATE ON public.listener_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.listener_subscriptions_validate();

CREATE INDEX idx_listener_subscriptions_status ON public.listener_subscriptions (status, created_at DESC);