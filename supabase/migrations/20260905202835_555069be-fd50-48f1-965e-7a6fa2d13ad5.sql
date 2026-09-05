CREATE TABLE IF NOT EXISTS public.guest_run_limits (
  guest_key text NOT NULL,
  run_day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  runs integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guest_key, run_day)
);

GRANT ALL ON public.guest_run_limits TO service_role;

ALTER TABLE public.guest_run_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guest_run_limits admin read"
  ON public.guest_run_limits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.consume_guest_run(p_key text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_runs integer;
  v_limit integer := greatest(coalesce(p_limit, 1), 0);
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_limit, 'limit', v_limit);
  END IF;

  INSERT INTO public.guest_run_limits (guest_key, run_day, runs)
  VALUES (trim(p_key), v_day, 1)
  ON CONFLICT (guest_key, run_day) DO UPDATE
    SET runs = public.guest_run_limits.runs + 1,
        updated_at = now()
  RETURNING runs INTO v_runs;

  RETURN jsonb_build_object('allowed', v_runs <= v_limit, 'used', v_runs, 'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_guest_run(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_guest_run(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.prune_guest_run_limits(p_keep_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.guest_run_limits
  WHERE run_day < ((now() AT TIME ZONE 'utc')::date - greatest(coalesce(p_keep_days, 30), 1));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_guest_run_limits(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_guest_run_limits(integer) TO service_role;