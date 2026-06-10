-- Cross-reference abandoned_checkouts with orders to mark recovered ones.
-- Shopify's /checkouts.json only returns un-recovered checkouts, so completed_at
-- is never populated by the sync itself. Match by email within a 48-hour window.
CREATE OR REPLACE FUNCTION public.mark_recovered_checkouts(p_store_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.abandoned_checkouts ac
  SET completed_at = (
    SELECT MIN(o.shopify_created_at)
    FROM public.orders o
    WHERE o.store_id = p_store_id
      AND o.customer_email = ac.email
      AND o.cancelled_at IS NULL
      AND o.shopify_created_at > ac.created_at
      AND o.shopify_created_at < ac.created_at + interval '48 hours'
  )
  WHERE ac.store_id = p_store_id
    AND ac.email IS NOT NULL
    AND ac.completed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.store_id = p_store_id
        AND o.customer_email = ac.email
        AND o.cancelled_at IS NULL
        AND o.shopify_created_at > ac.created_at
        AND o.shopify_created_at < ac.created_at + interval '48 hours'
    );
$$;
