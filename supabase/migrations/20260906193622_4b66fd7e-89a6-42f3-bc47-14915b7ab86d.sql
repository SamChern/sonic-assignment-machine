CREATE TABLE public.access_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('creator','enterprise')),
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  org_name text,
  website text,
  catalogue_size text,
  team_size text,
  use_case text,
  message text,
  preferred_timing text,
  terms_accepted boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'new',
  admin_notes text,
  submitted_by uuid,
  user_agent text,
  notified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.access_applications TO authenticated;
GRANT ALL ON public.access_applications TO service_role;

ALTER TABLE public.access_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view access applications"
ON public.access_applications FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update access applications"
ON public.access_applications FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX access_applications_kind_created_idx ON public.access_applications (kind, created_at DESC);
CREATE INDEX access_applications_status_idx ON public.access_applications (status);

CREATE TRIGGER update_access_applications_updated_at
BEFORE UPDATE ON public.access_applications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();