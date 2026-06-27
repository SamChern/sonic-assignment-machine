
-- 1. pgvector
create extension if not exists vector;

-- 2. audio_sources extensions
alter table public.audio_sources
  add column if not exists ctv_metadata jsonb,
  add column if not exists profile_embedding vector(1536);

-- 3. ctv_ingest_batches
create table if not exists public.ctv_ingest_batches (
  id uuid primary key default gen_random_uuid(),
  feed_name text not null,
  file_uri text,
  total_rows integer not null default 0,
  success_rows integer not null default 0,
  failed_rows integer not null default 0,
  status text not null default 'pending',
  error_message text,
  ingested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ctv_ingest_batches to authenticated;
grant all on public.ctv_ingest_batches to service_role;
alter table public.ctv_ingest_batches enable row level security;
create policy "Admins manage ctv batches" on public.ctv_ingest_batches
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 4. taxonomy_nodes
create table if not exists public.taxonomy_nodes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  parent_code text,
  taxonomy_version text not null default 'auto',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.taxonomy_nodes to authenticated;
grant all on public.taxonomy_nodes to service_role;
alter table public.taxonomy_nodes enable row level security;
create policy "Anyone signed in can read taxonomy" on public.taxonomy_nodes
  for select to authenticated using (true);
create policy "Admins manage taxonomy" on public.taxonomy_nodes
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 5. audio_source_tags
create table if not exists public.audio_source_tags (
  id uuid primary key default gen_random_uuid(),
  audio_source_id uuid not null references public.audio_sources(id) on delete cascade,
  node_id uuid not null references public.taxonomy_nodes(id) on delete cascade,
  weight numeric(5,3) not null default 1.0,
  created_at timestamptz not null default now(),
  unique (audio_source_id, node_id)
);
grant select on public.audio_source_tags to authenticated;
grant all on public.audio_source_tags to service_role;
alter table public.audio_source_tags enable row level security;
create policy "Anyone signed in can read tags" on public.audio_source_tags
  for select to authenticated using (true);
create policy "Admins manage source tags" on public.audio_source_tags
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 6. category_feedback
create table if not exists public.category_feedback (
  id uuid primary key default gen_random_uuid(),
  source_analysis_id uuid not null references public.source_analyses(id) on delete cascade,
  category text not null check (category in ('emotional','cognitive','social','communication','contextual','artistic')),
  corrected_score numeric(5,2),
  delta numeric(5,2),
  rater_user_id uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);
grant select, insert on public.category_feedback to authenticated;
grant all on public.category_feedback to service_role;
alter table public.category_feedback enable row level security;
create policy "Admins read feedback" on public.category_feedback
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins write feedback" on public.category_feedback
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin') and rater_user_id = auth.uid());

-- 7. category_calibration
create table if not exists public.category_calibration (
  id uuid primary key default gen_random_uuid(),
  taxonomy_node_id uuid not null references public.taxonomy_nodes(id) on delete cascade,
  category text not null check (category in ('emotional','cognitive','social','communication','contextual','artistic')),
  n integer not null default 0,
  mean_score numeric(8,4) not null default 0,
  m2 numeric(12,4) not null default 0,
  bias numeric(6,3) not null default 0,
  updated_at timestamptz not null default now(),
  unique (taxonomy_node_id, category)
);
grant select on public.category_calibration to authenticated;
grant all on public.category_calibration to service_role;
alter table public.category_calibration enable row level security;
create policy "Anyone signed in reads calibration" on public.category_calibration
  for select to authenticated using (true);

-- 8. update_updated_at triggers
create trigger trg_ctv_batches_updated before update on public.ctv_ingest_batches
  for each row execute function public.update_updated_at_column();
create trigger trg_taxonomy_updated before update on public.taxonomy_nodes
  for each row execute function public.update_updated_at_column();

-- 9. indexes
create index if not exists idx_audio_sources_profile_embedding
  on public.audio_sources using hnsw (profile_embedding vector_cosine_ops);
create index if not exists idx_taxonomy_embedding
  on public.taxonomy_nodes using hnsw (embedding vector_cosine_ops);
create index if not exists idx_audio_source_tags_source on public.audio_source_tags(audio_source_id);
create index if not exists idx_audio_source_tags_node on public.audio_source_tags(node_id);
create index if not exists idx_category_feedback_analysis on public.category_feedback(source_analysis_id);
