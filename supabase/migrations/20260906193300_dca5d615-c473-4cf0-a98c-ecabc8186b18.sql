CREATE TABLE IF NOT EXISTS public.listener_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  plan text NOT NULL DEFAULT 'listener',
  terms_accepted boolean NOT NULL DEFAULT false,
  data_sharing_accepted boolean NOT NULL DEFAULT false,
  user_agent text,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.listener_signups TO service_role;
GRANT SELECT ON public.listener_signups TO authenticated;

ALTER TABLE public.listener_signups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view listener signups" ON public.listener_signups;
CREATE POLICY "Admins can view listener signups"
ON public.listener_signups
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS listener_signups_created_idx ON public.listener_signups (created_at DESC);
CREATE INDEX IF NOT EXISTS listener_signups_email_idx ON public.listener_signups (lower(email));