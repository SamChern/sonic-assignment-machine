select cron.schedule(
  'prune-analysis-telemetry-daily',
  '17 4 * * *',
  $$select public.prune_analysis_telemetry(30, 7, 14);$$
);