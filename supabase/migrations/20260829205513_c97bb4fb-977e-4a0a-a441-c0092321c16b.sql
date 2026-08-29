INSERT INTO public.control_registry (key, value, value_type, bounds, description, category)
VALUES (
  'ingest.worker_batch_rows', '250'::jsonb, 'number',
  '{"min": 25, "max": 2000, "step": 25}'::jsonb,
  'Rows the EC2 ingest worker sends per scoring-queue callback batch. Smaller keeps each database write inside the statement timeout.',
  'ingest'
)
ON CONFLICT (key) DO NOTHING;