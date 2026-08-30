CREATE POLICY "Admins read grounding audio"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'grounding' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins upload grounding audio"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'grounding' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update grounding audio"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'grounding' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'grounding' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete grounding audio"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'grounding' AND public.has_role(auth.uid(), 'admin'));