-- Step 7 compliance hardening: re-key raw device-ID-shaped Intuizi subject keys
-- onto the standard 32-hex EID form, and keep sensitive POI suppression fresh.

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
  r RECORD;
  v_target text;
  v_exists uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.require_admin();
  END IF;

  -- Raw MAID/UUID-shaped keys only. Nothing raw is returned or logged.
  CREATE TEMP TABLE _bad_keys ON COMMIT DROP AS
  SELECT id, primary_identifier AS old_key, last_seen_at,
         upper(replace(primary_identifier, '-', '')) AS new_key
  FROM public.intuizi_identifiers
  WHERE primary_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  SELECT count(*) INTO v_matched FROM _bad_keys;

  -- Stale subjects are retention's job, not re-keying's.
  DELETE FROM public.sonic_cohort_members m
   USING _bad_keys b
   WHERE m.subject_key = b.old_key
     AND (b.last_seen_at IS NULL OR b.last_seen_at < v_cutoff);
  GET DIAGNOSTICS v_cohort = ROW_COUNT;

  DELETE FROM public.intuizi_score_queue q
   USING _bad_keys b
   WHERE q.identifier = b.old_key
     AND (b.last_seen_at IS NULL OR b.last_seen_at < v_cutoff);
  GET DIAGNOSTICS v_queue = ROW_COUNT;

  DELETE FROM public.audio_profile_embeddings e
   USING _bad_keys b
   WHERE e.cache_key = b.old_key
     AND (b.last_seen_at IS NULL OR b.last_seen_at < v_cutoff);
  GET DIAGNOSTICS v_embeddings = ROW_COUNT;

  WITH stale AS (
    DELETE FROM public.intuizi_identifiers i
     USING _bad_keys b
     WHERE i.id = b.id
       AND (b.last_seen_at IS NULL OR b.last_seen_at < v_cutoff)
    RETURNING i.audio_source_id
  ), src AS (
    DELETE FROM public.audio_sources s
     WHERE s.id IN (SELECT audio_source_id FROM stale WHERE audio_source_id IS NOT NULL)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM stale), (SELECT count(*) FROM src) INTO v_purged, v_sources;

  DELETE FROM _bad_keys WHERE last_seen_at IS NULL OR last_seen_at < v_cutoff;

  -- Re-key the survivors; merge when the derived EID already exists.
  FOR r IN SELECT id, old_key, new_key FROM _bad_keys LOOP
    v_target := r.new_key;

    SELECT id INTO v_exists
      FROM public.intuizi_identifiers
     WHERE primary_identifier = v_target AND id <> r.id
     LIMIT 1;

    IF v_exists IS NOT NULL THEN
      -- Keep the existing subject; fold observation counts into it and drop
      -- the duplicate rather than keeping two rows for one person.
      UPDATE public.intuizi_identifiers t
         SET observation_count = t.observation_count + d.observation_count,
             last_seen_at = GREATEST(COALESCE(t.last_seen_at, d.last_seen_at), COALESCE(d.last_seen_at, t.last_seen_at)),
             tag_codes = ARRAY(SELECT DISTINCT unnest(t.tag_codes || d.tag_codes)),
             audio_source_id = COALESCE(t.audio_source_id, d.audio_source_id),
             updated_at = now()
        FROM public.intuizi_identifiers d
       WHERE t.id = v_exists AND d.id = r.id;

      DELETE FROM public.intuizi_identifiers WHERE id = r.id;
      v_merged := v_merged + 1;
    ELSE
      UPDATE public.intuizi_identifiers
         SET primary_identifier = v_target, updated_at = now()
       WHERE id = r.id;
      v_rekeyed := v_rekeyed + 1;
    END IF;

    -- Carry the derived key across every surface keyed by subject key.
    UPDATE public.sonic_cohort_members m
       SET subject_key = v_target
     WHERE m.subject_key = r.old_key
       AND NOT EXISTS (
         SELECT 1 FROM public.sonic_cohort_members x
          WHERE x.cohort_id = m.cohort_id AND x.subject_key = v_target
       );
    DELETE FROM public.sonic_cohort_members WHERE subject_key = r.old_key;

    UPDATE public.intuizi_score_queue SET identifier = v_target, updated_at = now()
     WHERE identifier = r.old_key;

    UPDATE public.audio_profile_embeddings e
       SET cache_key = v_target
     WHERE e.cache_key = r.old_key
       AND NOT EXISTS (
         SELECT 1 FROM public.audio_profile_embeddings x
          WHERE x.cache_key = v_target AND x.model = e.model
       );
    DELETE FROM public.audio_profile_embeddings WHERE cache_key = r.old_key;

    UPDATE public.audio_sources
       SET ctv_metadata = jsonb_set(COALESCE(ctv_metadata, '{}'::jsonb), '{identifier}', to_jsonb(v_target))
     WHERE ctv_metadata->>'identifier' = r.old_key;
  END LOOP;

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
    'run_id', v_run_id,
    'matched', v_matched,
    'rekeyed', v_rekeyed,
    'merged', v_merged,
    'purged_stale', v_purged
  );
END;
$function$;

-- Re-evaluate every POI/visitation node against the sensitive patterns, so a
-- class created by a taxonomy import (not the tagging path) cannot stay
-- unsuppressed. Content genres (ctv./aset./iab./web.) are never touched.
CREATE OR REPLACE FUNCTION public.refresh_taxonomy_suppression()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_poi integer := 0;
  v_flagged integer := 0;
  v_newly integer := 0;
  v_run_id uuid;
  v_patterns text[] := ARRAY[
    '(health|healthcare|hospital|clinic|medical|medicine|physician|doctor|dentist|urgent[ _-]?care|oncology|dialysis|therapy|therapist|psychiatr|mental[ _-]?health|pharmac|drugstore|blood[ _-]?donation|hospice|nursing[ _-]?home|disabilit|hiv|std|cancer)',
    '(planned[ _-]?parenthood|abortion|fertility|prenatal|obgyn|rehab|addiction|methadone|substance[ _-]?abuse|alcoholics[ _-]?anonymous|narcotics[ _-]?anonymous)',
    '(worship|church|chapel|cathedral|mosque|masjid|synagog|temple|shrine|gurdwara|monaster|religio|faith|parish|ministry)',
    '(shelter|homeless|food[ _-]?bank|soup[ _-]?kitchen|refugee|asylum|domestic[ _-]?violence|crisis[ _-]?cent|halfway[ _-]?house|welfare)',
    '(prison|jail|correctional|probation|immigration[ _-]?cent|political[ _-]?part|campaign[ _-]?office|labor[ _-]?union|lgbt|gay[ _-]?bar|adult[ _-]?entertainment|strip[ _-]?club)'
  ];
  v_poi_prefixes text[] := ARRAY['visit.', 'poi.', 'place.', 'geo.', 'brand.visit.'];
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.require_admin();
  END IF;

  SELECT count(*) INTO v_poi
    FROM public.taxonomy_nodes n
   WHERE EXISTS (SELECT 1 FROM unnest(v_poi_prefixes) p WHERE lower(n.code) LIKE p || '%');

  WITH candidates AS (
    SELECT n.id
      FROM public.taxonomy_nodes n
     WHERE EXISTS (SELECT 1 FROM unnest(v_poi_prefixes) p WHERE lower(n.code) LIKE p || '%')
       AND EXISTS (
         SELECT 1 FROM unnest(v_patterns) pat
          WHERE replace(replace(n.code || ' ' || COALESCE(n.label, ''), '.', ' '), '_', ' ') ~* pat
       )
  ), flipped AS (
    UPDATE public.taxonomy_nodes t
       SET suppressed = true, updated_at = now()
     WHERE t.id IN (SELECT id FROM candidates) AND t.suppressed = false
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM flipped)
    INTO v_flagged, v_newly;

  INSERT INTO public.retention_runs (
    kind, cutoff, retention_days, status, details, finished_at
  ) VALUES (
    'suppression_refresh', now(), 90, 'succeeded',
    jsonb_build_object('poi_nodes', v_poi, 'suppressed_nodes', v_flagged, 'newly_suppressed', v_newly),
    now()
  ) RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'poi_nodes', v_poi,
    'suppressed_nodes', v_flagged,
    'newly_suppressed', v_newly
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.normalize_intuizi_subject_keys(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_taxonomy_suppression() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_intuizi_subject_keys(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_taxonomy_suppression() TO authenticated, service_role;