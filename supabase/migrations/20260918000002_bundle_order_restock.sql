-- Idempotency ledger for bundle-inventory restocks on cancellation/refund (see
-- project_bundle_inventory_sync.md). restock_key is "cancel:<order_id>" for a full order
-- cancellation, or "refund:<refund_id>:<line_item_id>" for a specific refunded line item —
-- lets multiple partial refunds on the same order each restock exactly once.
create table if not exists bundle_order_restock (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  restock_key text not null,
  created_at timestamptz not null default now(),
  unique (store_id, restock_key)
);

alter table bundle_order_restock enable row level security;
