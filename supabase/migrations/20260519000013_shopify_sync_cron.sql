-- Rescue stalled Shopify syncs every 15 minutes.
-- Without this, a broken self-invoke chain leaves a sync frozen in "in_progress" forever,
-- requiring manual intervention. With this, the worst-case stall is 15 minutes.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shopify-auto-sync-tick';

SELECT cron.schedule(
  'shopify-auto-sync-tick',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gbvbvopeieqghvettmkj.supabase.co/functions/v1/shopify-sync',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdidmJ2b3BlaWVxZ2h2ZXR0bWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDMzNDksImV4cCI6MjA5MzI3OTM0OX0.bezMzljmBaqGo0kuThNO5tIuLDeWXaVnbAn8O2ZD5dM"}'::jsonb,
      body    := '{"action":"auto_sync_tick"}'::jsonb
    );
  $$
);
