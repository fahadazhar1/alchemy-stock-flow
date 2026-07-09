-- Shrink shipment_tracking_events (596 MB, 88% of DB)
--
-- Why this approach:
--   ALTER TABLE DROP COLUMN  → catalog-only, instant (no row scan)
--   Batched DELETE via cron  → 2000 rows/run avoids statement timeout
--   VACUUM FULL via cron     → reclaims freed pages automatically every Sunday

-- 1. Drop the JSONB payload column (main space hog; pages freed by VACUUM FULL below)
ALTER TABLE shipment_tracking_events DROP COLUMN IF EXISTS raw_payload;

-- 2. Remove raw_payload from the insert function
CREATE OR REPLACE FUNCTION record_tracking_event(
  p_tracking_number text,
  p_courier         text,
  p_status          text,
  p_event_at        timestamptz DEFAULT NULL,
  p_location        text        DEFAULT NULL,
  p_remarks         text        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO shipment_tracking_events
    (tracking_number, courier, status, event_at, location, remarks)
  VALUES
    (p_tracking_number, p_courier, p_status, p_event_at, p_location, p_remarks)
  ON CONFLICT (tracking_number, status, event_at) DO NOTHING;
END;
$$;

-- 3. Drop unused date index — immediate 87 MB space release (DROP INDEX frees pages now)
DROP INDEX IF EXISTS idx_ste_recorded_at;

-- 4. Batched cleanup: deletes 2000 old rows every 10 minutes (safe under statement timeout)
--    Old rows have low IDs → PK index scan hits them first, efficient even without date index.
--    Becomes a fast no-op automatically once all pre-90-day rows are gone.
DO $$ BEGIN
  PERFORM cron.unschedule('weekly-tracking-events-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('tracking-events-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'tracking-events-cleanup',
  '*/10 * * * *',
  $$DELETE FROM shipment_tracking_events
    WHERE id IN (
      SELECT id FROM shipment_tracking_events
      WHERE recorded_at < NOW() - INTERVAL '90 days'
      ORDER BY id
      LIMIT 2000
    )$$
);

-- 5. Weekly VACUUM FULL — reclaims disk pages freed by the batched deletes + DROP COLUMN
DO $$ BEGIN
  PERFORM cron.unschedule('vacuum-tracking-events');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'vacuum-tracking-events',
  '0 3 * * 0',
  'VACUUM FULL shipment_tracking_events'
);
