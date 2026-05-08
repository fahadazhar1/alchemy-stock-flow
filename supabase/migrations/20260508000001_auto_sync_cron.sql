create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove existing job if present to allow re-running this migration safely
do $$
begin
  if exists (select 1 from cron.job where jobname = 'shopify-auto-sync-tick') then
    perform cron.unschedule('shopify-auto-sync-tick');
  end if;
end $$;

-- Fire auto_sync_tick every 15 minutes — the edge function checks each
-- connection's sync_frequency and last_sync_at before actually running
select cron.schedule(
  'shopify-auto-sync-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url    := 'https://gbvbvopeieqghvettmkj.supabase.co/functions/v1/shopify-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdidmJ2b3BlaWVxZ2h2ZXR0bWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDMzNDksImV4cCI6MjA5MzI3OTM0OX0.bezMzljmBaqGo0kuThNO5tIuLDeWXaVnbAn8O2ZD5dM"}'::jsonb,
    body   := '{"action":"auto_sync_tick"}'::jsonb
  ) as request_id;
  $$
);
