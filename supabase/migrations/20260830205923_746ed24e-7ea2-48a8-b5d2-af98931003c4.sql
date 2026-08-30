CREATE POLICY "Signed-in users can read signature audio"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'signatures');