CREATE TABLE IF NOT EXISTS public.control_registry (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('number','boolean','enum','json')),
  bounds jsonb,
  description text,
  category text NOT NULL DEFAULT 'general',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.control_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS control_audit_key_idx ON public.control_audit (key, changed_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.control_registry TO authenticated;
GRANT ALL ON public.control_registry TO service_role;
GRANT SELECT ON public.control_audit TO authenticated;
GRANT ALL ON public.control_audit TO service_role;

ALTER TABLE public.control_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read control registry" ON public.control_registry
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update control registry" ON public.control_registry
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert control registry" ON public.control_registry
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read control audit" ON public.control_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.control_registry_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_num numeric;
  v_min numeric;
  v_max numeric;
BEGIN
  IF NEW.value_type = 'number' THEN
    IF jsonb_typeof(NEW.value) <> 'number' THEN
      RAISE EXCEPTION 'control_registry.% expects a number', NEW.key;
    END IF;
    v_num := (NEW.value)::text::numeric;
    v_min := NULLIF(NEW.bounds->>'min','')::numeric;
    v_max := NULLIF(NEW.bounds->>'max','')::numeric;
    IF v_min IS NOT NULL AND v_num < v_min THEN
      RAISE EXCEPTION 'control_registry.% below min %', NEW.key, v_min;
    END IF;
    IF v_max IS NOT NULL AND v_num > v_max THEN
      RAISE EXCEPTION 'control_registry.% above max %', NEW.key, v_max;
    END IF;
  ELSIF NEW.value_type = 'boolean' THEN
    IF jsonb_typeof(NEW.value) <> 'boolean' THEN
      RAISE EXCEPTION 'control_registry.% expects a boolean', NEW.key;
    END IF;
  ELSIF NEW.value_type = 'enum' THEN
    IF NEW.bounds ? 'options' AND NOT (NEW.bounds->'options' @> jsonb_build_array(NEW.value)) THEN
      RAISE EXCEPTION 'control_registry.% not an allowed option', NEW.key;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS control_registry_validate_trg ON public.control_registry;
CREATE TRIGGER control_registry_validate_trg
  BEFORE INSERT OR UPDATE ON public.control_registry
  FOR EACH ROW EXECUTE FUNCTION public.control_registry_validate();

CREATE OR REPLACE FUNCTION public.control_registry_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.value IS NOT DISTINCT FROM NEW.value THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.control_audit (key, old_value, new_value, changed_by)
  VALUES (NEW.key, CASE WHEN TG_OP = 'UPDATE' THEN OLD.value ELSE NULL END, NEW.value, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS control_registry_audit_trg ON public.control_registry;
CREATE TRIGGER control_registry_audit_trg
  AFTER INSERT OR UPDATE ON public.control_registry
  FOR EACH ROW EXECUTE FUNCTION public.control_registry_audit();

INSERT INTO public.control_registry (key, value, value_type, bounds, description, category) VALUES
  ('knn.k', '8'::jsonb, 'number', '{"min":1,"max":32,"step":1}'::jsonb, 'Number of nearest taxonomy/profile neighbors retrieved for context-aware scoring', 'scoring'),
  ('prior.blend_weight', '0.35'::jsonb, 'number', '{"min":0,"max":1,"step":0.05}'::jsonb, 'Weight of calibrated category priors blended into raw model scores', 'scoring'),
  ('bridge.active_id', '""'::jsonb, 'json', NULL, 'Active embedding bridge id (empty string = auto-select active bridge)', 'scoring'),
  ('ingest.queue_high_water', '5000'::jsonb, 'number', '{"min":100,"max":100000,"step":100}'::jsonb, 'Score queue depth above which ingest throttles new dispatches', 'ingest'),
  ('ingest.score_batch_size', '12'::jsonb, 'number', '{"min":1,"max":64,"step":1}'::jsonb, 'Rows claimed per score-worker batch', 'ingest'),
  ('cohort.k', '6'::jsonb, 'number', '{"min":2,"max":24,"step":1}'::jsonb, 'Number of clusters used by the cohort builder', 'cohorts'),
  ('retention.days', '90'::jsonb, 'number', '{"min":7,"max":365,"step":1}'::jsonb, 'Days of inactivity before Intuizi-derived subjects are purged', 'compliance'),
  ('scope.window_seconds', '5'::jsonb, 'number', '{"min":1,"max":30,"step":1}'::jsonb, 'Seconds between semantic scoring windows in the Scope visualization', 'scope')
ON CONFLICT (key) DO NOTHING;