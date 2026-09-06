-- Applicants who are signed in may read and file their own applications.
CREATE POLICY "Applicants can view their own applications"
ON public.access_applications
FOR SELECT
TO authenticated
USING (submitted_by = auth.uid());

CREATE POLICY "Applicants can file their own applications"
ON public.access_applications
FOR INSERT
TO authenticated
WITH CHECK (submitted_by = auth.uid() AND terms_accepted = true);
