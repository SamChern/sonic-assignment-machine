CREATE TABLE public.demo_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requested_by UUID NOT NULL DEFAULT auth.uid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  team_size TEXT,
  use_case TEXT NOT NULL,
  preferred_timing TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  scheduled_at TIMESTAMP WITH TIME ZONE,
  admin_notes TEXT,
  status_changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_requests TO authenticated;
GRANT ALL ON public.demo_requests TO service_role;

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can create their own demo requests"
ON public.demo_requests FOR INSERT TO authenticated
WITH CHECK (requested_by = auth.uid());

CREATE POLICY "Members can view their own demo requests"
ON public.demo_requests FOR SELECT TO authenticated
USING (requested_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Members can edit their own new demo requests"
ON public.demo_requests FOR UPDATE TO authenticated
USING (requested_by = auth.uid() AND status = 'new')
WITH CHECK (requested_by = auth.uid());

CREATE POLICY "Admins can update all demo requests"
ON public.demo_requests FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete demo requests"
ON public.demo_requests FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_demo_requests_status_created ON public.demo_requests (status, created_at DESC);
CREATE INDEX idx_demo_requests_requested_by ON public.demo_requests (requested_by, created_at DESC);

CREATE OR REPLACE FUNCTION public.demo_requests_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER demo_requests_touch_trigger
BEFORE UPDATE ON public.demo_requests
FOR EACH ROW EXECUTE FUNCTION public.demo_requests_touch();