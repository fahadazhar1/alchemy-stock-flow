-- Add cod_amount to sonic_cache: the actual COD the courier was supposed to collect.
-- Computed from charges API: net_payable + total_charges + gst
-- Prepaid/0-COD orders will have cod_amount = 0.
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS cod_amount numeric;

-- Rewrite COD summary to use sc.cod_amount instead of o.total_price.
-- Excludes orders where cod_amount is 0 or unknown (prepaid / not yet synced).
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
           AND sc.cod_amount > 0
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND (sc.courier_payment_status IS NULL
                OR sc.courier_payment_status NOT IN ('Paid','Processed'))
           AND sc.cod_amount > 0
          THEN sc.cod_amount
          ELSE 0
        END
      )::numeric, 0)
    ),
    'released', json_build_object(
      'count', COALESCE(SUM(
        CASE
          WHEN sc.courier_payment_status IN ('Paid','Processed')
           AND sc.cod_amount > 0
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_payment_status IN ('Paid','Processed')
           AND sc.cod_amount > 0
          THEN sc.cod_amount
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
