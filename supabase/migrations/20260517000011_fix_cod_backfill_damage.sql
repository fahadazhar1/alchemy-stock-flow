-- Undo the bad backfill: reset all forced-zero cod_amounts back to NULL
-- so they are not excluded from the COD summary.
UPDATE sonic_cache SET cod_amount = NULL WHERE cod_amount = 0;

-- Rewrite summary: use cod_amount when we have a real value (> 0),
-- fall back to total_price minus charges for rows not yet synced (NULL).
-- This restores the previous behaviour while keeping the fix for genuinely
-- prepaid orders once they get a real cod_amount = 0 from the tracking API.
CREATE OR REPLACE FUNCTION get_cod_payment_summary(p_store_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'held', json_build_object(
      'count', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND (sc.courier_payment_status IS NULL
                OR sc.courier_payment_status NOT IN ('Paid','Processed'))
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND (sc.courier_payment_status IS NULL
                OR sc.courier_payment_status NOT IN ('Paid','Processed'))
          THEN GREATEST(
            COALESCE(
              NULLIF(sc.cod_amount, 0),
              o.total_price - COALESCE(sc.shipping_charges, 0)
                            - COALESCE(sc.fuel_surcharge, 0)
                            - COALESCE(sc.gst, 0)
            ),
            0
          )
          ELSE 0
        END
      )::numeric, 0)
    ),
    'released', json_build_object(
      'count', COALESCE(SUM(
        CASE
          WHEN sc.courier_payment_status IN ('Paid','Processed')
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_payment_status IN ('Paid','Processed')
          THEN GREATEST(
            COALESCE(
              NULLIF(sc.cod_amount, 0),
              o.total_price - COALESCE(sc.shipping_charges, 0)
                            - COALESCE(sc.fuel_surcharge, 0)
                            - COALESCE(sc.gst, 0)
            ),
            0
          )
          ELSE 0
        END
      )::numeric, 0)
    )
  )
  FROM  sonic_cache sc
  JOIN  orders o ON o.tracking_number = sc.tracking_number
  WHERE sc.courier = 'sonic'
    AND o.cancelled_at IS NULL
    AND (p_store_id IS NULL OR o.store_id = p_store_id);
$$;
