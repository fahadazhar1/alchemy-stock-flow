-- Skip fake tracking numbers from courier sync queue.
-- Real tracking numbers are numeric (Sonic: 14-digit, M&P: 15-digit) or
-- alphanumeric with hyphens (no spaces, no special chars, min length 5).
-- This prevents wasted API calls for values like "LCS", "DHL", "Karachi Show Room" etc.
CREATE OR REPLACE FUNCTION get_active_tracking_to_sync(batch_limit int DEFAULT 50)
RETURNS TABLE(tracking_number text)
LANGUAGE sql STABLE
AS $$
  SELECT sub.tracking_number
  FROM (
    SELECT DISTINCT ON (o.tracking_number) o.tracking_number, sc.last_synced_at
    FROM   orders o
    JOIN   stores s ON s.id = o.store_id
    LEFT   JOIN sonic_cache sc ON sc.tracking_number = o.tracking_number
    WHERE  o.tracking_number IS NOT NULL
      AND  o.cancelled_at    IS NULL
      AND  s.currency        = 'PKR'
      AND  o.tracking_number ~ '^[A-Za-z0-9][A-Za-z0-9\-]{4,}$'
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
