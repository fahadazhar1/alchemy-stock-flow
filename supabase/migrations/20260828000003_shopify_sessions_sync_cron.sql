-- Daily Shopify sessions sync at 03:15 UTC (just after ga4-sync at 03:00,
-- same reasoning — after midnight in all 4 store timezones).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shopify-sessions-sync-daily';

SELECT cron.schedule(
  'shopify-sessions-sync-daily',
  '15 3 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gbvbvopeieqghvettmkj.supabase.co/functions/v1/shopify-sessions-sync',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdidmJ2b3BlaWVxZ2h2ZXR0bWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDMzNDksImV4cCI6MjA5MzI3OTM0OX0.bezMzljmBaqGo0kuThNO5tIuLDeWXaVnbAn8O2ZD5dM"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
