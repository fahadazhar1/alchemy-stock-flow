-- Shrink shipment_tracking_events (currently 596 MB / 88% of DB)
-- Strategy:
--   1. Delete rows older than 90 days (delivered shipments need no history)
--   2. NULL out raw_payload on all remaining rows (JSONB payloads = bulk of the size)
--   3. Drop idx_ste_recorded_at (87 MB index not used by any app query)
--   4. Schedule weekly auto-cleanup via pg_cron

-- Step 1: delete stale events
DELETE FROM shipment_tracking_events
WHERE recorded_at < NOW() - INTERVAL '90 days';

-- Step 2: zero out raw API payloads (app never reads them; sonic_cache holds current state)
UPDATE shipment_tracking_events
SET raw_payload = NULL
WHERE raw_payload IS NOT NULL;

-- Step 3: drop the unused date index (saves 87 MB; tracking_number index is sufficient)
DROP INDEX IF EXISTS idx_ste_recorded_at;

-- Step 4: weekly auto-cleanup — keep only last 90 days of events
CREATE OR REPLACE FUNCTION cleanup_tracking_events()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM shipment_tracking_events
  WHERE recorded_at < NOW() - INTERVAL '90 days';
END;
$$;

-- Schedule every Sunday at 02:00 UTC (requires pg_cron extension, enabled by default on Supabase)
SELECT cron.schedule(
  'weekly-tracking-events-cleanup',
  '0 2 * * 0',
  'SELECT cleanup_tracking_events()'
);
