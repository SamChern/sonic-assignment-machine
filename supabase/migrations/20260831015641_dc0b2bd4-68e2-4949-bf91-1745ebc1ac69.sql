DROP POLICY IF EXISTS "Admins can read all catalog items" ON public.catalog_items;
CREATE POLICY "Admins can read all catalog items"
  ON public.catalog_items
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));