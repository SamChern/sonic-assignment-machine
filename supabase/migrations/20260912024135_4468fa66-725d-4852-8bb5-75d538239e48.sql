DROP POLICY "Members can edit their own new demo requests" ON public.demo_requests;

CREATE POLICY "Members can edit their own new demo requests"
ON public.demo_requests
FOR UPDATE
TO authenticated
USING (requested_by = auth.uid() AND status = 'new')
WITH CHECK (
  requested_by = auth.uid()
  AND status = 'new'
  AND scheduled_at IS NULL
  AND admin_notes IS NULL
);

REVOKE EXECUTE ON FUNCTION public.get_method_examples(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_method_examples(integer) TO anon, authenticated, service_role;