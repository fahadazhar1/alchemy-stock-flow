-- Fix SONIC charge data: correct columns, correct net receivable formula, correct payment status matching.
--
-- Root causes fixed:
--   1. shipping_charges was storing total_charges (weight+fuel=405), not weight_charges (300).
--      Net formula used total_charges - fuel_surcharge - gst to derive freight (235), which is wrong.
--      Now shipping_charges stores weight_charges directly from the SONIC /charges endpoint.
--
--   2. gst was storing the /charges estimate (64.80), not the actual billed GST from /payments (75.60).
--      Now fetched from the charge entry in the /payments array.
--
--   3. cod_amount was reading payments[0].amount = 0 (the charge entry), not the remittance entry.
--      Now finds the payments entry where amount > 0 (the COD remittance).
--
--   4. wht (Withholding Tax, 2%) and cod_sst (COD Sales Service Tax, 2%) were never captured.
--      Added as new columns; sourced from the remittance entry in /payments.
--
--   5. Payment status ILIKE match: stored values are "Payment - Processed", "Payment - Paid", etc.
--      Previous IN ('Paid','Processed') never matched. Fixed to ILIKE '%processed%' / '%paid%'.
--
-- Correct net receivable per order:
--   net = cod_amount - wht - cod_sst - shipping_charges - fuel_surcharge - gst
--   e.g. 2150 - 43 - 43 - 300 - 105 - 75.60 = 1583.40

-- ── New columns ───────────────────────────────────────────────────────────────
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS wht     numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS cod_sst numeric;

-- Invalidate all cached SONIC rows so the edge function re-fetches with the corrected logic.
UPDATE sonic_cache SET last_synced_at = '2000-01-01'::timestamptz WHERE courier = 'sonic';

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
           AND NOT (sc.courier_payment_status ILIKE '%processed%'
                 OR sc.courier_payment_status ILIKE '%paid%')
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND NOT (sc.courier_payment_status ILIKE '%processed%'
                 OR sc.courier_payment_status ILIKE '%paid%')
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
           AND (sc.courier_payment_status ILIKE '%processed%'
             OR sc.courier_payment_status ILIKE '%paid%')
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND (sc.courier_payment_status ILIKE '%processed%'
             OR sc.courier_payment_status ILIKE '%paid%')
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
-- Must DROP first because the RETURNS TABLE signature changed (added wht, cod_sst columns)
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
    AND o.cancelled_at IS NULL
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND (
      CASE WHEN p_released
        THEN (sc.courier_payment_status ILIKE '%processed%' OR sc.courier_payment_status ILIKE '%paid%')
        ELSE NOT (sc.courier_payment_status ILIKE '%processed%' OR sc.courier_payment_status ILIKE '%paid%')
              OR sc.courier_payment_status IS NULL
      END
    )
  ORDER BY o.shopify_created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_cod_payment_summary(uuid)           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_cod_delivered_orders(uuid, boolean) TO authenticated, anon;
