-- Migration 017 re-introduced COALESCE(NULLIF(cod_amount,0), total_price) to handle
-- orders where SONIC API returned 0 for real COD orders. This caused prepaid orders
-- (where SONIC correctly returns 0) to incorrectly show total_price as COD amount.
--
-- Root cause confirmed: SONIC order_information.amount IS reliable for prepaid vs COD
-- distinction. 0 means prepaid. Non-zero means actual COD amount booked.
--
-- Fix: drop the fallback entirely. Filter cod_amount > 0 to include only real COD orders.
-- Stale zeros (SONIC returned 0 before finalising real COD) are handled by the backfill
-- function which now re-fetches delivered orders with cod_amount=0 and no payment status.

CREATE OR REPLACE FUNCTION get_cod_payment_summary(p_store_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'held', json_build_object(
      'count', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND sc.cod_amount > 0
           AND (sc.courier_payment_status IS NULL
                OR sc.courier_payment_status NOT IN ('Paid', 'Processed'))
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND sc.cod_amount > 0
           AND (sc.courier_payment_status IS NULL
                OR sc.courier_payment_status NOT IN ('Paid', 'Processed'))
          THEN sc.cod_amount
               - COALESCE(sc.shipping_charges, 0)
               - COALESCE(sc.fuel_surcharge, 0)
               - COALESCE(sc.gst, 0)
          ELSE 0
        END
      )::numeric, 0)
    ),
    'released', json_build_object(
      'count', COALESCE(SUM(
        CASE
          WHEN sc.courier_payment_status IN ('Paid', 'Processed')
           AND sc.cod_amount > 0
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_payment_status IN ('Paid', 'Processed')
           AND sc.cod_amount > 0
          THEN sc.cod_amount
               - COALESCE(sc.shipping_charges, 0)
               - COALESCE(sc.fuel_surcharge, 0)
               - COALESCE(sc.gst, 0)
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

CREATE OR REPLACE FUNCTION get_cod_delivered_orders(
  p_store_id uuid    DEFAULT NULL,
  p_released boolean DEFAULT false
)
RETURNS TABLE (
  order_number           text,
  order_date             timestamptz,
  customer_email         text,
  source_name            text,
  store_name             text,
  tracking_number        text,
  courier                text,
  courier_status         text,
  courier_payment_status text,
  order_total            numeric,
  cod_amount             numeric,
  shipping_charges       numeric,
  fuel_surcharge         numeric,
  gst                    numeric,
  net_receivable         numeric,
  remittance_date        text
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    o.order_number,
    o.shopify_created_at                              AS order_date,
    o.customer_email,
    o.source_name,
    s.store_name,
    o.tracking_number,
    sc.courier,
    sc.courier_status,
    sc.courier_payment_status,
    o.total_price                                     AS order_total,
    sc.cod_amount,
    sc.shipping_charges,
    sc.fuel_surcharge,
    sc.gst,
    sc.cod_amount
      - COALESCE(sc.shipping_charges, 0)
      - COALESCE(sc.fuel_surcharge, 0)
      - COALESCE(sc.gst, 0)                          AS net_receivable,
    sc.remittance_date
  FROM  orders o
  JOIN  sonic_cache sc ON sc.tracking_number = o.tracking_number
  LEFT  JOIN stores s  ON s.id = o.store_id
  WHERE sc.courier = 'sonic'
    AND sc.cod_amount > 0
    AND sc.courier_status ILIKE '%delivered%'
    AND o.cancelled_at IS NULL
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND (
      CASE WHEN p_released
        THEN sc.courier_payment_status IN ('Paid', 'Processed')
        ELSE (sc.courier_payment_status IS NULL
              OR sc.courier_payment_status NOT IN ('Paid', 'Processed'))
      END
    )
  ORDER BY o.shopify_created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_cod_payment_summary(uuid)           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_cod_delivered_orders(uuid, boolean) TO authenticated, anon;
