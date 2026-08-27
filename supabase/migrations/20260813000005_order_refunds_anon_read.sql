-- get_store_sales_bridge / get_returns_by_channel are GRANTed to anon (matching
-- the orders table, which has always had a fully-open "Allow all for demo"
-- policy). order_refunds was created with an authenticated-only SELECT
-- policy (copied from the stricter ga4_daily_metrics pattern), which meant
-- an anon-role caller of those RPCs would silently get returns_amount = 0
-- with no error, while every other figure in the same row was correct —
-- confirmed live via a direct anon-key RPC call. Matching orders' actual
-- permissiveness so both tables behave consistently under the same RPC.
CREATE POLICY "Anon can read order_refunds"
  ON public.order_refunds FOR SELECT
  TO anon
  USING (true);
