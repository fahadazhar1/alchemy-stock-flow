-- Idempotency ledger for the bundle-inventory-sync fix (see project_bundle_inventory_sync.md).
-- Bundle Offers System products (e.g. Complete Azkar Bundle) sell as ONE SKU with zero
-- native link to their component books' real inventory. shopify-sync's orders/create and
-- orders/updated webhooks both route through processOrderWebhook, and orders/updated fires
-- on every edit (tags, address, fulfillment...) — without this claim table we'd decrement
-- component book stock every time an already-processed order is merely updated.
create table if not exists bundle_order_sync (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  shopify_order_id text not null,
  created_at timestamptz not null default now(),
  unique (store_id, shopify_order_id)
);

alter table bundle_order_sync enable row level security;
