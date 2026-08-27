-- Add remittance_date to sonic_cache (text — courier APIs return varied date formats)
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS remittance_date text;

-- RPC: aggregate COD payment status across all orders that have cached courier data
-- "held"     = courier_payment_status IN ('Unpaid','Pending')  — courier is holding your COD money
-- "released" = courier_payment_status IN ('Paid','Processed')  — courier has remitted to you
CREATE OR REPLACE FUNCTION get_cod_payment_summary(p_store_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'held', json_build_object(
      'count',  COALESCE(SUM(CASE WHEN sc.courier_payment_status IN ('Unpaid','Pending')   THEN 1 ELSE 0 END)::int, 0),
      'amount', COALESCE(SUM(CASE WHEN sc.courier_payment_status IN ('Unpaid','Pending')   THEN o.total_price ELSE 0 END)::numeric, 0)
    ),
    'released', json_build_object(
      'count',  COALESCE(SUM(CASE WHEN sc.courier_payment_status IN ('Paid','Processed') THEN 1 ELSE 0 END)::int, 0),
      'amount', COALESCE(SUM(CASE WHEN sc.courier_payment_status IN ('Paid','Processed') THEN o.total_price ELSE 0 END)::numeric, 0)
    )
  )
  FROM sonic_cache sc
  JOIN orders o ON o.tracking_number = sc.tracking_number
  WHERE (p_store_id IS NULL OR o.store_id = p_store_id);
$$;
