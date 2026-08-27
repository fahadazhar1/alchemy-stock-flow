-- Daily GA4 sync at 03:00 UTC (well after midnight in all 4 store timezones,
-- giving GA4's own processing pipeline time to settle the previous day).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ga4-sync-daily';

SELECT cron.schedule(
  'ga4-sync-daily',
  '0 3 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gbvbvopeieqghvettmkj.supabase.co/functions/v1/ga4-sync',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdidmJ2b3BlaWVxZ2h2ZXR0bWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDMzNDksImV4cCI6MjA5MzI3OTM0OX0.bezMzljmBaqGo0kuThNO5tIuLDeWXaVnbAn8O2ZD5dM"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
