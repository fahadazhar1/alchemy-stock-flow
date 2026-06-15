# Reports v2 — server-side RPCs

Aggregation RPCs that replace the `.limit(10000)` raw fetches in `reportsEngine.ts`.
Defined in `supabase/migrations/20260615000005_reports_rpcs.sql`. All read-only.

## Behaviour vs the old reportsEngine.ts (intentional)
- **Date basis:** `shopify_created_at` (actual order date), not `created_at` (sync time) → Reports now agree with the rest of the dashboard.
- **Cancelled orders excluded** (`cancelled_at IS NULL`) from every order-based aggregate.
- Day buckets use UTC date.

## Calling convention
- `p_from`: `timestamptz` ISO string, or `null` for all-time (range `"all"`).
- `p_store_id`: `uuid` or `null` (all stores).
- Compute `p_from` in JS (keep your `dateFrom(range)` helper).
- Numeric columns may arrive as strings via PostgREST — wrap with `Number()`.

```ts
function rpcFrom(range: DateRange): string | null {
  if (range === "all") return null;
  const days = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[range];
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString();
}
```

## Function map

| Old function | RPC | Args | Returns (columns) |
|---|---|---|---|
| `fetchSalesByChannel` | `get_report_sales_by_channel` | `p_from, p_store_id` | `channel, revenue, orders, aov` (sorted by revenue desc) |
| `fetchSalesTrend` | `get_report_sales_trend` | `p_from, p_store_id` | `date, revenue, orders` (sorted by date) |
| `fetchTopProducts` | `get_report_top_products` | `p_from, p_limit, p_store_id` | `product_id, name, type, revenue, units, orders` |
| `fetchInventoryKPIs` | `get_report_inventory_kpis` | `p_store_id` | `total_skus, out_of_stock, low_stock, expiring_soon, total_value, total_units` |
| `fetchFulfillmentSummary` | `get_report_fulfillment_summary` | `p_from, p_store_id` | `total, fulfilled, unfulfilled, partial, paid, pending, refunded, total_revenue` |
| `fetchFulfillmentTrend` | `get_report_fulfillment_trend` | `p_from, p_store_id` | `date, fulfilled, unfulfilled, partial` |
| `fetchCollectionPerformance` | `get_report_collection_performance` | `p_from, p_store_id` | `collection, revenue, units` |
| `fetchRevenueKPIs` | `get_report_revenue_kpis` | `p_from, p_prior_from, p_prior_to, p_store_id` | `revenue, orders, aov, prior_revenue` |

`fetchInventoryHealth` (per-SKU table) has no RPC — it's row-level detail. Keep `.range()` pagination; don't pull all SKUs at once.

## Example wiring

```ts
export async function fetchSalesByChannel(range: DateRange = "30d", storeId?: string | null) {
  const { data, error } = await (supabase as any).rpc("get_report_sales_by_channel", {
    p_from: rpcFrom(range),
    p_store_id: storeId ?? null,
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    channel: r.channel,
    revenue: Number(r.revenue),
    orders:  Number(r.orders),
    aov:     Number(r.aov),
  }));
}

// Revenue KPIs — prior window computed by the caller
export async function fetchRevenueKPIs(range: DateRange = "30d", storeId?: string | null) {
  const days = range === "all" ? 30 : parseInt(range);
  const priorFrom = new Date(); priorFrom.setDate(priorFrom.getDate() - days * 2);
  const priorTo   = new Date(); priorTo.setDate(priorTo.getDate() - days);
  const { data, error } = await (supabase as any).rpc("get_report_revenue_kpis", {
    p_from: rpcFrom(range),
    p_prior_from: priorFrom.toISOString(),
    p_prior_to:   priorTo.toISOString(),
    p_store_id: storeId ?? null,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  const revenue = Number(row.revenue ?? 0);
  const priorRevenue = Number(row.prior_revenue ?? 0);
  return {
    revenue,
    orders: Number(row.orders ?? 0),
    aov: Number(row.aov ?? 0),
    revenueChange: priorRevenue ? ((revenue - priorRevenue) / priorRevenue) * 100 : null,
  };
}
```
