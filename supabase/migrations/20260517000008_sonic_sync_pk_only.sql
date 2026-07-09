-- Restrict sonic courier sync to PKR stores only.
-- Sonic operates in Pakistan only — UK/other store tracking numbers (DHL/JJD etc.)
-- should never be sent to Sonic's API.
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
