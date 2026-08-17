-- One row per Shopify refund (not per order — an order can have multiple
-- partial refunds at different times). refunded_at is the refund's own
-- processed date, NOT the original order date, so returns get counted in the
-- P&L period they actually happened in (standard finance practice, confirmed
-- with the business) rather than the period of the original sale.
-- source_name is denormalized from the parent order at sync time so the
-- channel breakdown (Online Store/Draft/eBay/Amazon/TikTok) needs no join.
-- Writes only happen via the shopify-sync edge function's service-role
-- client; no INSERT/UPDATE policy is granted to authenticated/anon.
CREATE TABLE public.order_refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  shopify_order_id   text NOT NULL,
  shopify_refund_id  text NOT NULL,
  amount             numeric NOT NULL DEFAULT 0,
  refunded_at        timestamptz NOT NULL,
  source_name        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, shopify_refund_id)
);

ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read order_refunds"
  ON public.order_refunds FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE INDEX idx_order_refunds_store_refunded_at ON public.order_refunds(store_id, refunded_at);
