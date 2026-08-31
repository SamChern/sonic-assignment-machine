CREATE OR REPLACE FUNCTION public.creator_queued_symbols()
RETURNS TABLE(
  id uuid,
  symbol text,
  symbol_type text,
  status text,
  sightings integer,
  attempts integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.symbol, q.symbol_type, q.status, q.sightings, q.attempts,
         q.first_seen_at, q.last_seen_at
  FROM public.resolution_queue q
  WHERE auth.uid() IS NOT NULL
    AND (
      q.context->>'user_id' = auth.uid()::text
      OR q.context->>'creator_user_id' = auth.uid()::text
      OR q.context->>'work_id' IN (
        SELECT w.id::text FROM public.creator_works w WHERE w.user_id = auth.uid()
      )
    )
  ORDER BY q.last_seen_at DESC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.creator_queued_symbols() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_queued_symbols() TO authenticated;