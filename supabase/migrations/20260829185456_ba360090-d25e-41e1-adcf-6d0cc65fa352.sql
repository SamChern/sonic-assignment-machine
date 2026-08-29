INSERT INTO public.control_registry (key, value, value_type, bounds, description, category)
VALUES (
  'regression.tolerance',
  '8'::jsonb,
  'number',
  '{"min": 1, "max": 40, "step": 1}'::jsonb,
  'Max allowed per-axis drift (points) when re-scoring existing sources in the scoring regression harness.',
  'scoring'
)
ON CONFLICT (key) DO NOTHING;