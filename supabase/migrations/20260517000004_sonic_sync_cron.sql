-- Returns up to `batch_limit` tracking numbers for active shipped orders that need a courier sync.
-- "Active" = not in a terminal state (delivered / returned / cancelled).
-- Orders never synced are returned first (NULLS FIRST), then oldest-synced next.
CREATE OR REPLACE FUNCTION get_active_tracking_to_sync(batch_limit int DEFAULT 50)
RETURNS TABLE(tracking_number text)
LANGUAGE sql STABLE
AS $$
  SELECT sub.tracking_number
  FROM (
    SELECT DISTINCT ON (o.tracking_number) o.tracking_number, sc.last_synced_at
    FROM   orders o
    LEFT   JOIN sonic_cache sc ON sc.tracking_number = o.tracking_number
    WHERE  o.tracking_number IS NOT NULL
      AND  o.cancelled_at    IS NULL
      AND  (
             sc.tracking_number IS NULL
             OR (
               sc.last_synced_at < now() - interval '5 minutes'
               AND (
                 sc.courier_status IS NULL
                 OR (
                   sc.courier_status NOT ILIKE '%delivered%'
                   AND sc.courier_status NOT ILIKE '%return%'
                   AND sc.courier_status NOT ILIKE '%cancelled%'
                 )
               )
             )
           )
    ORDER BY o.tracking_number, sc.last_synced_at ASC NULLS FIRST
  ) sub
  ORDER BY sub.last_synced_at ASC NULLS FIRST
  LIMIT  batch_limit;
$$;

-- Schedule sonic-sync-cron every 5 minutes via pg_cron + pg_net.
-- Picks up the next batch of 50 active orders per run; processes 5 in parallel per wave.
SELECT cron.schedule(
  'sonic-courier-sync',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://gbvbvopeieqghvettmkj.supabase.co/functions/v1/sonic-sync-cron',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdidmJ2b3BlaWVxZ2h2ZXR0bWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDMzNDksImV4cCI6MjA5MzI3OTM0OX0.bezMzljmBaqGo0kuThNO5tIuLDeWXaVnbAn8O2ZD5dM"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
