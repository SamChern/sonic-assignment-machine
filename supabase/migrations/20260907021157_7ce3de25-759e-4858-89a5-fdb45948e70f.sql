DROP POLICY IF EXISTS "Signed-in users can view fingerprints" ON public.user_fingerprints;

CREATE POLICY "Users can view their own fingerprint"
ON public.user_fingerprints
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all fingerprints"
ON public.user_fingerprints
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.fingerprint_neighbors(
  _emotional numeric,
  _cognitive numeric,
  _social numeric,
  _communication numeric,
  _contextual numeric,
  _artistic numeric,
  _limit integer DEFAULT 5
)
RETURNS TABLE(
  user_id uuid,
  username text,
  avatar_url text,
  total_sources_analyzed integer,
  similarity numeric,
  top_shared_category text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT ARRAY[
      COALESCE(_emotional, 0), COALESCE(_cognitive, 0), COALESCE(_social, 0),
      COALESCE(_communication, 0), COALESCE(_contextual, 0), COALESCE(_artistic, 0)
    ]::numeric[] AS v
  ), others AS (
    SELECT f.user_id, f.total_sources_analyzed,
           ARRAY[
             COALESCE(f.emotional_avg, 0), COALESCE(f.cognitive_avg, 0), COALESCE(f.social_avg, 0),
             COALESCE(f.communication_avg, 0), COALESCE(f.contextual_avg, 0), COALESCE(f.artistic_avg, 0)
           ]::numeric[] AS v
    FROM public.user_fingerprints f
    WHERE f.total_sources_analyzed > 0
      AND (auth.uid() IS NULL OR f.user_id <> auth.uid())
  ), scored AS (
    SELECT o.user_id, o.total_sources_analyzed,
           (SELECT SUM(m.v[i] * o.v[i]) FROM generate_subscripts(o.v, 1) i, me m) AS dot,
           (SELECT SQRT(SUM(POWER(m.v[i], 2))) FROM generate_subscripts(o.v, 1) i, me m) AS m1,
           SQRT((SELECT SUM(POWER(o.v[i], 2)) FROM generate_subscripts(o.v, 1) i)) AS m2,
           SQRT((SELECT SUM(POWER(m.v[i] - o.v[i], 2)) FROM generate_subscripts(o.v, 1) i, me m)) AS euclid,
           (SELECT c.name FROM (
              SELECT unnest(ARRAY['Emotional','Cognitive','Social','Communication','Contextual','Artistic']) AS name,
                     generate_series(1, 6) AS idx
            ) c, me m
            ORDER BY (m.v[c.idx] + o.v[c.idx]) DESC
            LIMIT 1) AS top_shared_category
    FROM others o
  ), hybrid AS (
    SELECT s.user_id, s.total_sources_analyzed, s.top_shared_category,
           GREATEST(0, LEAST(1,
             POWER(
               0.3 * CASE WHEN s.m1 = 0 OR s.m2 = 0 THEN 0 ELSE s.dot / (s.m1 * s.m2) END
               + 0.7 * (1 - s.euclid / SQRT(6 * 100 * 100)),
             1.5)
           )) AS similarity
    FROM scored s
  )
  SELECT h.user_id, p.username, p.avatar_url, h.total_sources_analyzed,
         ROUND(h.similarity::numeric, 4) AS similarity, h.top_shared_category
  FROM hybrid h
  LEFT JOIN public.profiles p ON p.user_id = h.user_id
  ORDER BY h.similarity DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 25);
$$;

REVOKE ALL ON FUNCTION public.fingerprint_neighbors(numeric, numeric, numeric, numeric, numeric, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fingerprint_neighbors(numeric, numeric, numeric, numeric, numeric, numeric, integer) TO anon, authenticated, service_role;