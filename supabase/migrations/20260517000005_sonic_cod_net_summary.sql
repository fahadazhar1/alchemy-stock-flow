-- Rewrite COD summary to Sonic-only, delivered-but-unpaid, net of courier charges.
-- "held"     = Sonic delivered the order but hasn't remitted COD yet (payment_status != Paid/Processed)
-- "released" = Sonic has already paid / processed the remittance
-- amount     = order total_price minus shipping_charges, fuel_surcharge, and GST
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
            COALESCE(o.total_price, 0)
            - COALESCE(sc.shipping_charges, 0)
            - COALESCE(sc.fuel_surcharge, 0)
            - COALESCE(sc.gst, 0),
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
            COALESCE(o.total_price, 0)
            - COALESCE(sc.shipping_charges, 0)
            - COALESCE(sc.fuel_surcharge, 0)
            - COALESCE(sc.gst, 0),
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
