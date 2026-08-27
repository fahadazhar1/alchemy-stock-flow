-- Bundle Builder: local audit/source-of-truth for bundle products created via the dashboard.
create table public.bundles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  shopify_product_id text not null,
  shopify_variant_id text not null,
  handle text,
  title text not null,
  price numeric(12,2) not null,
  badge_text text,
  subtitle text,
  title_override text,
  book_product_ids uuid[] not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bundles enable row level security;

create policy "authenticated full access"
  on public.bundles for all
  to authenticated
  using (true)
  with check (true);

create index idx_bundles_store_id on public.bundles(store_id);
create index idx_bundles_status on public.bundles(status);