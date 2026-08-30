-- Step 14a — Grounding packs as versioned artifacts
ALTER TABLE public.embedding_bridges
  ADD COLUMN IF NOT EXISTS version text NOT NULL DEFAULT 'v0',
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pack',
  ADD COLUMN IF NOT EXISTS manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS license_ledger jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

ALTER TABLE public.embedding_bridges
  DROP CONSTRAINT IF EXISTS embedding_bridges_kind_check;
ALTER TABLE public.embedding_bridges
  ADD CONSTRAINT embedding_bridges_kind_check CHECK (kind IN ('identity_stub','pack'));

INSERT INTO public.embedding_bridges (name, from_dim, to_dim, version, kind, is_active, activated_at, manifest, license_ledger)
SELECT 'SONICSIM Grounding Pack — identity stub', 512, 1536, 'v0-stub', 'identity_stub', true, now(), '{}'::jsonb, '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.embedding_bridges);

-- Step 14b — honest scores
ALTER TABLE public.source_analyses
  ADD COLUMN IF NOT EXISTS grounding_level text NOT NULL DEFAULT 'text-only';
ALTER TABLE public.source_analyses
  DROP CONSTRAINT IF EXISTS source_analyses_grounding_level_check;
ALTER TABLE public.source_analyses
  ADD CONSTRAINT source_analyses_grounding_level_check
  CHECK (grounding_level IN ('text-only','bridged','grounded'));

-- Step 14c — the Sound Library tables
CREATE TABLE IF NOT EXISTS public.grounding_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_code text NOT NULL,
  taxonomy_node_id uuid REFERENCES public.taxonomy_nodes(id) ON DELETE SET NULL,
  source_url text,
  storage_path text,
  title text,
  license text NOT NULL,
  attribution text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  duration_seconds numeric,
  embedded_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grounding_assets TO authenticated;
GRANT ALL ON public.grounding_assets TO service_role;
ALTER TABLE public.grounding_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage grounding assets"
ON public.grounding_assets FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.grounding_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_code text NOT NULL,
  source_url text,
  storage_path text,
  title text,
  license text NOT NULL,
  attribution text NOT NULL,
  origin text NOT NULL DEFAULT 'manual',
  proposed_by uuid,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  asset_id uuid REFERENCES public.grounding_assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grounding_queue TO authenticated;
GRANT ALL ON public.grounding_queue TO service_role;
ALTER TABLE public.grounding_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage grounding queue"
ON public.grounding_queue FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS grounding_queue_status_idx ON public.grounding_queue (status, created_at DESC);
CREATE INDEX IF NOT EXISTS grounding_assets_code_idx ON public.grounding_assets (taxonomy_code);

CREATE TRIGGER grounding_assets_updated_at
BEFORE UPDATE ON public.grounding_assets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER grounding_queue_updated_at
BEFORE UPDATE ON public.grounding_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Coverage: signal-weighted grounded share per taxonomy branch.
CREATE OR REPLACE FUNCTION public.grounding_coverage()
RETURNS TABLE(
  branch text,
  observed_tags integer,
  observed_weight numeric,
  grounded_tags integer,
  grounded_weight numeric,
  coverage_pct numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manifest jsonb;
BEGIN
  PERFORM public.require_admin();

  SELECT COALESCE(manifest, '{}'::jsonb) INTO v_manifest
  FROM public.embedding_bridges
  WHERE is_active = true
  ORDER BY activated_at DESC NULLS LAST
  LIMIT 1;
  v_manifest := COALESCE(v_manifest, '{}'::jsonb);

  RETURN QUERY
  WITH observed AS (
    SELECT n.id,
           n.code,
           split_part(n.code, '.', 1) AS branch,
           SUM(a.weight) AS weight,
           n.grounding_count
    FROM public.audio_source_tags a
    JOIN public.taxonomy_nodes n ON n.id = a.node_id
    GROUP BY n.id, n.code, n.grounding_count
  ), flagged AS (
    SELECT o.*,
           (o.grounding_count > 0
            OR v_manifest ? o.code
            OR EXISTS (
              SELECT 1 FROM public.grounding_assets g
              WHERE g.taxonomy_code = o.code AND g.status = 'active'
            )) AS grounded
    FROM observed o
  )
  SELECT f.branch,
         COUNT(*)::integer,
         ROUND(SUM(f.weight)::numeric, 3),
         COUNT(*) FILTER (WHERE f.grounded)::integer,
         ROUND(COALESCE(SUM(f.weight) FILTER (WHERE f.grounded), 0)::numeric, 3),
         ROUND(
           100 * COALESCE(SUM(f.weight) FILTER (WHERE f.grounded), 0)::numeric
             / NULLIF(SUM(f.weight)::numeric, 0), 1)
  FROM flagged f
  GROUP BY f.branch
  ORDER BY SUM(f.weight) DESC;
END;
$$;

-- Gap list: the ungrounded tags your real data needs most.
CREATE OR REPLACE FUNCTION public.grounding_gaps(p_limit integer DEFAULT 40, p_branch text DEFAULT NULL)
RETURNS TABLE(
  node_id uuid,
  code text,
  label text,
  branch text,
  observed_sources integer,
  observed_weight numeric,
  queued boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manifest jsonb;
BEGIN
  PERFORM public.require_admin();

  SELECT COALESCE(manifest, '{}'::jsonb) INTO v_manifest
  FROM public.embedding_bridges
  WHERE is_active = true
  ORDER BY activated_at DESC NULLS LAST
  LIMIT 1;
  v_manifest := COALESCE(v_manifest, '{}'::jsonb);

  RETURN QUERY
  SELECT n.id,
         n.code,
         n.label,
         split_part(n.code, '.', 1),
         COUNT(DISTINCT a.audio_source_id)::integer,
         ROUND(SUM(a.weight)::numeric, 3),
         EXISTS (
           SELECT 1 FROM public.grounding_queue q
           WHERE q.taxonomy_code = n.code AND q.status IN ('pending','proposed')
         )
  FROM public.audio_source_tags a
  JOIN public.taxonomy_nodes n ON n.id = a.node_id
  WHERE n.suppressed = false
    AND n.grounding_count = 0
    AND NOT (v_manifest ? n.code)
    AND NOT EXISTS (
      SELECT 1 FROM public.grounding_assets g
      WHERE g.taxonomy_code = n.code AND g.status = 'active'
    )
    AND (p_branch IS NULL OR split_part(n.code, '.', 1) = p_branch)
  GROUP BY n.id, n.code, n.label
  ORDER BY SUM(a.weight) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
END;
$$;