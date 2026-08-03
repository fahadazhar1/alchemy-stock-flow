-- Sales Pulse (get_store_period_channel_sales) sums total_price, which is
-- frozen "before returns" at order creation — it never reflects order edits
-- (line items removed/added after checkout) unless a formal refund also
-- happened. current_total_price is Shopify's live "after returns" value and
-- already nets out refunds, partial refunds, AND edits in one field. Same fix
-- already applied to the standalone sales-pulse-report.mjs script weeks ago
-- (see memory: project_sales_pulse_shopify_script.md) — this brings the
-- dashboard's RPC to parity. Shopify's order payload includes
-- current_total_price directly, no extra API call needed.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS current_total_price numeric(12,2);
