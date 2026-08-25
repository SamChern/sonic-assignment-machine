CREATE POLICY "Users can delete their own analyses"
ON public.source_analyses
FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));