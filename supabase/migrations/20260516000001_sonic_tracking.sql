-- Add tracking number storage to orders (populated by shopify-sync from fulfillments)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text;

-- Cache table for courier API responses (SONIC + M&P) — avoids hammering courier APIs on every page load
CREATE TABLE IF NOT EXISTS sonic_cache (
  tracking_number        text PRIMARY KEY,
  courier                text NOT NULL DEFAULT 'sonic',
  courier_status         text,
  courier_payment_status text,
  shipping_charges       numeric,
  last_synced_at         timestamptz DEFAULT now()
);
