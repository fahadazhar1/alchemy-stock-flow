-- Sales Pulse needs to optionally exclude shipping from net sales. Shopify's
-- order payload (REST bulk sync + webhooks) already includes
-- total_shipping_price_set on every order — no extra API call needed, just
-- capture it. Existing rows will backfill via a one-time script; new/updated
-- orders populate it going forward through shopify-sync's processSingleOrder.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS total_shipping_price numeric(12,2);
