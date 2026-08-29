create or replace function public.lease_ingest_file(
  p_worker_id text,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  file_id uuid,
  object_key text,
  report_type text,
  row_group_cursor int,
  rows_offset bigint,
  total_rows int,
  trace_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select f.id into v_id
  from public.intuizi_ingest_files f
  where f.report_type <> 'audio'
    and (
      f.status in ('discovered', 'partial', 'enqueued')
      or (f.status = 'processing'
          and (f.heartbeat_at is null or f.heartbeat_at < now() - p_stale_after))
    )
  order by f.discovered_at nulls first
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.intuizi_ingest_files f
  set status = 'processing',
      worker_id = p_worker_id,
      heartbeat_at = now(),
      started_at = coalesce(f.started_at, now()),
      finished_at = null,
      error_message = null,
      trace_id = coalesce(f.trace_id, 'pull-' || left(replace(gen_random_uuid()::text, '-', ''), 12))
  where f.id = v_id;

  return query
  select f.id,
         f.object_key,
         f.report_type,
         coalesce(f.row_group_cursor, 0),
         coalesce(f.rows_offset, 0),
         coalesce(f.total_rows, 0),
         f.trace_id
  from public.intuizi_ingest_files f
  where f.id = v_id;
end;
$$;

revoke all on function public.lease_ingest_file(text, interval) from public;
revoke all on function public.lease_ingest_file(text, interval) from anon, authenticated;
grant execute on function public.lease_ingest_file(text, interval) to service_role;