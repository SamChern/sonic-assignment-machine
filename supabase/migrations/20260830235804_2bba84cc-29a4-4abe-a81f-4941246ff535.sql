INSERT INTO public.control_registry (key, value, value_type, bounds, description, category) VALUES
  ('resolver.nudge_max_pending', '25'::jsonb, 'number', '{"min":1,"max":100000}'::jsonb, 'Unresolved symbol backlog above this fires a resolver nudge.', 'resolver'),
  ('resolver.nudge_min_coverage_pct', '60'::jsonb, 'number', '{"min":0,"max":100}'::jsonb, 'Grounding coverage floor per branch; below this fires a resolver nudge.', 'resolver'),
  ('resolver.nudge_max_unreviewed', '25'::jsonb, 'number', '{"min":1,"max":5000}'::jsonb, 'Unreviewed agent proposals above this raises a review nudge.', 'resolver'),
  ('resolver.nudge_stale_hours', '36'::jsonb, 'number', '{"min":1,"max":720}'::jsonb, 'Hours since the last resolver run before the nudge calls it stale.', 'resolver'),
  ('resolver.nudge_batch', '10'::jsonb, 'number', '{"min":1,"max":200}'::jsonb, 'Symbols drained by a nudge-triggered agent refresh.', 'resolver')
ON CONFLICT (key) DO NOTHING;