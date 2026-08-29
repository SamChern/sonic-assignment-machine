-- Set-based rewrite: the row-by-row version re-scanned audio_sources once per
-- subject and timed out. Same semantics, one pass per table.
CREATE OR REPLACE FUNCTION public.normalize_intuizi_subject_keys(p_retention_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(COALESCE(p_retention_days, 90), 1));
  v_run_id uuid;
  v_matched integer := 0;
  v_purged integer := 0;
  v_rekeyed integer := 0;
  v_merged integer := 0;
  v_cohort integer := 0;
  v_queue integer := 0;
  v_sources integer := 0;
  v_embeddings integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.require_admin();
  END IF;

  CREATE TEMP TABLE _bad_keys ON COMMIT DROP AS
  SELECT id, primary_identifier AS old_key, last_seen_at,
         upper(replace(primary_identifier, '-', '')) AS new_key
  FROM public.intuizi_identifiers
  WHERE primary_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  CREATE INDEX ON _bad_keys (old_key);
  SELECT count(*) INTO v_matched FROM _bad_keys;

  -- Stale subjects belong to retention, not to re-keying.
  CREATE TEMP TABLE _stale ON COMMIT DROP AS
  SELECT id, old_key FROM _bad_keys
   WHERE last_seen_at IS NULL OR last_seen_at < v_cutoff;

  DELETE FROM public.sonic_cohort_members m USING _stale s WHERE m.subject_key = s.old_key;
  GET DIAGNOSTICS v_cohort = ROW_COUNT;
  DELETE FROM public.intuizi_score_queue q USING _stale s WHERE q.identifier = s.old_key;
  GET DIAGNOSTICS v_queue = ROW_COUNT;
  DELETE FROM public.audio_profile_embeddings e USING _stale s WHERE e.cache_key = s.old_key;
  GET DIAGNOSTICS v_embeddings = ROW_COUNT;

  CREATE TEMP TABLE _stale_src ON COMMIT DROP AS
  SELECT i.audio_source_id FROM public.intuizi_identifiers i
   JOIN _stale s ON s.id = i.id WHERE i.audio_source_id IS NOT NULL;

  DELETE FROM public.intuizi_identifiers i USING _stale s WHERE i.id = s.id;
  GET DIAGNOSTICS v_purged = ROW_COUNT;
  DELETE FROM public.audio_sources a USING _stale_src s WHERE a.id = s.audio_source_id;
  GET DIAGNOSTICS v_sources = ROW_COUNT;

  DELETE FROM _bad_keys b USING _stale s WHERE b.id = s.id;

  -- Move every surface keyed by subject key onto the derived EID first, so the
  -- unique-key flip below cannot orphan anything.
  UPDATE public.sonic_cohort_members m
     SET subject_key = b.new_key
    FROM _bad_keys b
   WHERE m.subject_key = b.old_key
     AND NOT EXISTS (
       SELECT 1 FROM public.sonic_cohort_members x
        WHERE x.cohort_id = m.cohort_id AND x.subject_key = b.new_key
     );
  DELETE FROM public.sonic_cohort_members m USING _bad_keys b WHERE m.subject_key = b.old_key;

  UPDATE public.intuizi_score_queue q
     SET identifier = b.new_key, updated_at = now()
    FROM _bad_keys b WHERE q.identifier = b.old_key;

  UPDATE public.audio_profile_embeddings e
     SET cache_key = b.new_key
    FROM _bad_keys b
   WHERE e.cache_key = b.old_key
     AND NOT EXISTS (
       SELECT 1 FROM public.audio_profile_embeddings x
        WHERE x.cache_key = b.new_key AND x.model = e.model
     );
  DELETE FROM public.audio_profile_embeddings e USING _bad_keys b WHERE e.cache_key = b.old_key;

  UPDATE public.audio_sources a
     SET ctv_metadata = jsonb_set(COALESCE(a.ctv_metadata, '{}'::jsonb), '{identifier}', to_jsonb(b.new_key))
    FROM _bad_keys b
   WHERE a.ctv_metadata->>'identifier' = b.old_key;

  -- Collisions: fold the duplicate into the subject that already owns the EID.
  CREATE TEMP TABLE _dupes ON COMMIT DROP AS
  SELECT b.id AS dup_id, t.id AS keep_id
    FROM _bad_keys b
    JOIN public.intuizi_identifiers t
      ON t.primary_identifier = b.new_key AND t.id <> b.id;

  UPDATE public.intuizi_identifiers t
     SET observation_count = t.observation_count + d.observation_count,
         last_seen_at = GREATEST(t.last_seen_at, d.last_seen_at),
         tag_codes = ARRAY(SELECT DISTINCT unnest(t.tag_codes || d.tag_codes)),
         audio_source_id = COALESCE(t.audio_source_id, d.audio_source_id),
         updated_at = now()
    FROM _dupes p
    JOIN public.intuizi_identifiers d ON d.id = p.dup_id
   WHERE t.id = p.keep_id;

  DELETE FROM public.intuizi_identifiers i USING _dupes p WHERE i.id = p.dup_id;
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  UPDATE public.intuizi_identifiers i
     SET primary_identifier = b.new_key, updated_at = now()
    FROM _bad_keys b
   WHERE i.id = b.id
     AND NOT EXISTS (SELECT 1 FROM _dupes p WHERE p.dup_id = b.id);
  GET DIAGNOSTICS v_rekeyed = ROW_COUNT;

  INSERT INTO public.retention_runs (
    kind, cutoff, retention_days, status,
    subjects_matched, identifiers_deleted, sources_deleted,
    embeddings_deleted, cohort_members_deleted, queue_rows_deleted,
    details, finished_at
  ) VALUES (
    'eid_rekey', v_cutoff, GREATEST(COALESCE(p_retention_days, 90), 1), 'succeeded',
    v_matched, v_purged, v_sources, v_embeddings, v_cohort, v_queue,
    jsonb_build_object('rekeyed', v_rekeyed, 'merged', v_merged, 'purged_stale', v_purged),
    now()
  ) RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'matched', v_matched, 'rekeyed', v_rekeyed,
    'merged', v_merged, 'purged_stale', v_purged
  );
END;
$function$;