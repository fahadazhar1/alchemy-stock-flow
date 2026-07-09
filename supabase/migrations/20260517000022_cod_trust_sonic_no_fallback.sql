-- Revert migration 021. The financial_status fallback was unreliable:
-- a merchant can ship non-COD without marking the Shopify order as 'paid',
-- causing genuine non-COD orders to be treated as COD with total_price as amount.
--
-- Correct approach: trust SONIC's cod_amount as the sole source of truth.
-- When the merchant books a shipment in SONIC, they either enter a COD amount
-- or they don't. SONIC's API reflects that booking decision.
--
--   cod_amount > 0  → COD shipment, courier collected cash
--   cod_amount = 0  → non-COD shipment, courier collected nothing
--   cod_amount NULL → not yet synced from SONIC API (treated as 0)
--
-- All delivered SONIC orders are included. Non-COD orders produce a negative
-- net_receivable (courier charges owed), which correctly reduces total receivables.
--
-- Edge case: if SONIC API returns 0 for an actual COD order (API lag),
-- it will appear as negative until the backfill function re-syncs the correct amount.
-- This is preferable to overstating receivables with a Shopify total_price fallback.

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
                OR sc.courier_payment_status NOT IN ('Paid', 'Processed'))
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND (sc.courier_payment_status IS NULL
                OR sc.courier_payment_status NOT IN ('Paid', 'Processed'))
          THEN COALESCE(sc.cod_amount, 0)
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
           AND sc.courier_payment_status IN ('Paid', 'Processed')
          THEN 1 ELSE 0
        END
      )::int, 0),
      'amount', COALESCE(SUM(
        CASE
          WHEN sc.courier_status ILIKE '%delivered%'
           AND sc.courier_payment_status IN ('Paid', 'Processed')
          THEN COALESCE(sc.cod_amount, 0)
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
    COALESCE(sc.cod_amount, 0)                        AS cod_amount,
    sc.shipping_charges,
    sc.fuel_surcharge,
    sc.gst,
    COALESCE(sc.cod_amount, 0)
      - COALESCE(sc.shipping_charges, 0)
      - COALESCE(sc.fuel_surcharge, 0)
      - COALESCE(sc.gst, 0)                          AS net_receivable,
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
        THEN sc.courier_payment_status IN ('Paid', 'Processed')
        ELSE (sc.courier_payment_status IS NULL
              OR sc.courier_payment_status NOT IN ('Paid', 'Processed'))
      END
    )
  ORDER BY o.shopify_created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_cod_payment_summary(uuid)           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_cod_delivered_orders(uuid, boolean) TO authenticated, anon;
