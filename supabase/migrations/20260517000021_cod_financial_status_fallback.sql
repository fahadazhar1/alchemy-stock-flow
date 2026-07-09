-- Root cause: SONIC API returns cod_amount = 0 for many COD orders because
-- order_information.amount is not reliably set for unsettled shipments.
-- This causes real COD orders to be misclassified as non-COD, making
-- gross receivables appear far too low.
--
-- Fix: use Shopify financial_status as source of truth for COD vs prepaid.
--   financial_status = 'paid'  → prepaid (SONIC collected nothing → cod = 0)
--   financial_status != 'paid' → COD order → use SONIC cod_amount if > 0,
--                                             else fall back to o.total_price
--
-- Per-order net_receivable:
--   effective_cod  = 0                                            (prepaid)
--                  | COALESCE(NULLIF(cod_amount,0), total_price)  (COD)
--   net_receivable = effective_cod - shipping_charges - fuel_surcharge - gst
--
-- Both COD (positive) and prepaid (negative, charges only) orders are included.

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
          THEN
            CASE WHEN o.financial_status = 'paid'
              THEN 0
              ELSE COALESCE(NULLIF(sc.cod_amount, 0), o.total_price)
            END
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
          THEN
            CASE WHEN o.financial_status = 'paid'
              THEN 0
              ELSE COALESCE(NULLIF(sc.cod_amount, 0), o.total_price)
            END
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
    o.shopify_created_at                                        AS order_date,
    o.customer_email,
    o.source_name,
    s.store_name,
    o.tracking_number,
    sc.courier,
    sc.courier_status,
    sc.courier_payment_status,
    o.total_price                                               AS order_total,
    CASE WHEN o.financial_status = 'paid'
      THEN 0
      ELSE COALESCE(NULLIF(sc.cod_amount, 0), o.total_price)
    END                                                         AS cod_amount,
    sc.shipping_charges,
    sc.fuel_surcharge,
    sc.gst,
    CASE WHEN o.financial_status = 'paid'
      THEN 0
      ELSE COALESCE(NULLIF(sc.cod_amount, 0), o.total_price)
    END
    - COALESCE(sc.shipping_charges, 0)
    - COALESCE(sc.fuel_surcharge, 0)
    - COALESCE(sc.gst, 0)                                      AS net_receivable,
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
