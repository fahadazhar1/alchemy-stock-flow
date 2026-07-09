-- Fix critical payment status matching bug.
--
-- SONIC returns several distinct courier_payment_status values:
--   "Payment - Paid"            → COD has been remitted to shipper ✓ RELEASED
--   "Payment - Processed"       → COD remittance processed         ✓ RELEASED
--   "Charges - Arrival Processed" → arrival charges calculated only ✗ STILL HELD
--   "Charges - Arrival Deducted"  → charges deducted only           ✗ STILL HELD
--   NULL                          → no payment info yet             ✗ STILL HELD
--
-- Previous ILIKE '%processed%' matched BOTH "Payment - Processed" AND
-- "Charges - Arrival Processed", causing 94 held orders to appear as released.
--
-- Fix: only match statuses that start with "Payment -" (SONIC) or equal "Paid" (M&P).

-- ── get_cod_payment_summary ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_cod_payment_summary(p_store_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'held', json_build_object(
      'count', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND COALESCE(sc.cod_amount, 0) > 0
           AND NOT (
             sc.courier_payment_status ILIKE 'Payment - Paid'
             OR sc.courier_payment_status ILIKE 'Payment - Processed'
             OR sc.courier_payment_status = 'Paid'
           )
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND COALESCE(sc.cod_amount, 0) > 0
           AND NOT (
             sc.courier_payment_status ILIKE 'Payment - Paid'
             OR sc.courier_payment_status ILIKE 'Payment - Processed'
             OR sc.courier_payment_status = 'Paid'
           )
          THEN COALESCE(sc.cod_amount, 0)
               - COALESCE(sc.wht, 0)
               - COALESCE(sc.cod_sst, 0)
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
          WHEN sc.courier_status ILIKE '%delivered%'
           AND COALESCE(sc.cod_amount, 0) > 0
           AND (
             sc.courier_payment_status ILIKE 'Payment - Paid'
             OR sc.courier_payment_status ILIKE 'Payment - Processed'
             OR sc.courier_payment_status = 'Paid'
           )
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND COALESCE(sc.cod_amount, 0) > 0
           AND (
             sc.courier_payment_status ILIKE 'Payment - Paid'
             OR sc.courier_payment_status ILIKE 'Payment - Processed'
             OR sc.courier_payment_status = 'Paid'
           )
          THEN COALESCE(sc.cod_amount, 0)
               - COALESCE(sc.wht, 0)
               - COALESCE(sc.cod_sst, 0)
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

-- ── get_cod_delivered_orders ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_cod_delivered_orders(uuid, boolean);

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
  wht                    numeric,
  cod_sst                numeric,
  net_receivable         numeric,
  remittance_date        text
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    o.order_number,
    o.shopify_created_at                                       AS order_date,
    o.customer_email,
    o.source_name,
    s.store_name,
    o.tracking_number,
    sc.courier,
    sc.courier_status,
    sc.courier_payment_status,
    o.total_price                                              AS order_total,
    COALESCE(sc.cod_amount, 0)                                 AS cod_amount,
    sc.shipping_charges,
    sc.fuel_surcharge,
    sc.gst,
    sc.wht,
    sc.cod_sst,
    COALESCE(sc.cod_amount, 0)
      - COALESCE(sc.wht, 0)
      - COALESCE(sc.cod_sst, 0)
      - COALESCE(sc.shipping_charges, 0)
      - COALESCE(sc.fuel_surcharge, 0)
      - COALESCE(sc.gst, 0)                                    AS net_receivable,
    sc.remittance_date
  FROM  orders o
  JOIN  sonic_cache sc ON sc.tracking_number = o.tracking_number
  LEFT  JOIN stores s  ON s.id = o.store_id
  WHERE sc.courier = 'sonic'
    AND sc.courier_status ILIKE '%delivered%'
    AND COALESCE(sc.cod_amount, 0) > 0
    AND o.cancelled_at IS NULL
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND (
      CASE WHEN p_released
        THEN (
          sc.courier_payment_status ILIKE 'Payment - Paid'
          OR sc.courier_payment_status ILIKE 'Payment - Processed'
          OR sc.courier_payment_status = 'Paid'
        )
        ELSE NOT (
          sc.courier_payment_status ILIKE 'Payment - Paid'
          OR sc.courier_payment_status ILIKE 'Payment - Processed'
          OR sc.courier_payment_status = 'Paid'
        ) OR sc.courier_payment_status IS NULL
      END
    )
  ORDER BY o.shopify_created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_cod_payment_summary(uuid)           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_cod_delivered_orders(uuid, boolean) TO authenticated, anon;
