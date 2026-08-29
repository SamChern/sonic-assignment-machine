INSERT INTO public.control_registry (key, value, value_type, description, category)
VALUES (
  'ingest.system_owner_user_id', '""'::jsonb, 'json',
  'Account that owns audio sources created from provider feeds (Intuizi). Leave blank to use the first admin account.',
  'ingest'
)
ON CONFLICT (key) DO NOTHING;