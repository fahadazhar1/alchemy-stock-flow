-- Fix get_active_tracking_to_sync: stop syncing only when SONIC has actually
-- released payment, not on any status containing "processed".
--
-- Bug: ILIKE '%processed%' matched "Charges - Arrival Processed" (charges
-- calculated, NOT yet paid) causing 94 delivered orders to be silently dropped
-- from the sync queue. Same bug was fixed for the Released/Held views in
-- migration 20260522000001 but was missed here.

CREATE OR REPLACE FUNCTION public.get_active_tracking_to_sync(batch_limit integer DEFAULT 50)
RETURNS TABLE(tracking_number text)
LANGUAGE sql
STABLE
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
        -- Never synced: highest priority
        sc.tracking_number IS NULL

        -- Active (pre-terminal) shipments: re-sync every 5 minutes
        OR (
          sc.last_synced_at < now() - interval '5 minutes'
          AND sc.courier_status IS NOT NULL
          AND sc.courier_status NOT ILIKE '%delivered%'
          AND sc.courier_status NOT ILIKE '%return%'
          AND sc.courier_status NOT ILIKE '%cancelled%'
        )

        -- Delivered but payment NOT yet confirmed: re-sync every 30 minutes.
        -- Only stop when SONIC has actually released payment.
        -- "Charges - Arrival Processed" must NOT stop the sync (charges
        -- calculated != payment released).
        OR (
          sc.last_synced_at < now() - interval '30 minutes'
          AND sc.courier_status ILIKE '%delivered%'
          AND NOT (
            sc.courier_payment_status ILIKE 'Payment - Paid'
            OR sc.courier_payment_status ILIKE 'Payment - Processed'
            OR sc.courier_payment_status = 'Paid'
          )
        )
      )

    ORDER BY o.tracking_number, sc.last_synced_at ASC NULLS FIRST
  ) sub
  ORDER BY sub.last_synced_at ASC NULLS FIRST
  LIMIT  batch_limit;
$$;
