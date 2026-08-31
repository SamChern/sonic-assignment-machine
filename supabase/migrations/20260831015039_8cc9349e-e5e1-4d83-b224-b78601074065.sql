ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS for_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_cents integer,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS listing_note text,
  ADD COLUMN IF NOT EXISTS listed_at timestamptz;

ALTER TABLE public.catalog_items
  ADD CONSTRAINT catalog_items_price_nonneg CHECK (price_cents IS NULL OR (price_cents >= 0 AND price_cents <= 100000000)) NOT VALID;

CREATE INDEX IF NOT EXISTS catalog_items_for_sale_idx ON public.catalog_items (for_sale, listed_at DESC) WHERE for_sale;

-- Public marketplace: anyone signed in can browse tracks their owner has listed
-- for sale. Unlisted catalog rows stay private to their owner.
DROP POLICY IF EXISTS "Listed catalog items are readable" ON public.catalog_items;
CREATE POLICY "Listed catalog items are readable"
  ON public.catalog_items
  FOR SELECT
  TO authenticated
  USING (for_sale = true);