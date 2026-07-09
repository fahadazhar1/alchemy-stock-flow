-- Rescues stalled syncs and triggers due auto-syncs every 15 minutes.
-- pg_net and pg_cron are enabled by default on all Supabase projects.
select cron.schedule(
  'shopify-auto-sync-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://gbvbvopeieqghvettmkj.supabase.co/functions/v1/shopify-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdidmJ2b3BlaWVxZ2h2ZXR0bWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDMzNDksImV4cCI6MjA5MzI3OTM0OX0.bezMzljmBaqGo0kuThNO5tIuLDeWXaVnbAn8O2ZD5dM"}'::jsonb,
    body    := '{"action":"auto_sync_tick"}'::jsonb
  );
  $$
);
