import { supabase } from "@/integrations/supabase/client";

export type DateRange = "7d" | "30d" | "90d" | "365d" | "all";

// Range → p_from (timestamptz ISO string, or null for all-time). The RPCs filter
// on shopify_created_at (actual order date) and exclude cancelled orders, so v2
// Reports now agree with the rest of the dashboard. See lib/REPORTS_RPCS.md.
function dateFrom(range: DateRange): string | null {
  if (range === "all") return null;
  const days = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[range];
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const dayLabel = (date: string) =>
  new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ─── Sales by channel ────────────────────────────────────────────────────────

export async function fetchSalesByChannel(range: DateRange = "30d", storeId?: string | null) {
  const { data, error } = await (supabase as any).rpc("get_report_sales_by_channel", {
    p_from: dateFrom(range),
    p_store_id: storeId ?? null,
  });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    channel: r.channel,
    revenue: Number(r.revenue),
    orders: Number(r.orders),
    aov: Number(r.aov),
  }));
}

// ─── Sales trend (daily/weekly) ───────────────────────────────────────────────

export async function fetchSalesTrend(range: DateRange = "30d", storeId?: string | null) {
  const { data, error } = await (supabase as any).rpc("get_report_sales_trend", {
    p_from: dateFrom(range),
    p_store_id: storeId ?? null,
  });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    date: r.date,
    label: dayLabel(r.date),
    revenue: Number(r.revenue),
    orders: Number(r.orders),
  }));
}

// ─── Top products by revenue ──────────────────────────────────────────────────

export async function fetchTopProducts(range: DateRange = "30d", limit = 20, storeId?: string | null) {
  const { data, error } = await (supabase as any).rpc("get_report_top_products", {
    p_from: dateFrom(range),
    p_limit: limit,
    p_store_id: storeId ?? null,
  });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    name: r.name,
    type: r.type,
    revenue: Number(r.revenue),
    units: Number(r.units),
    orders: Number(r.orders),
  }));
}

// ─── Inventory health ─────────────────────────────────────────────────────────

export async function fetchInventoryHealth(storeId?: string | null) {
  const PAGE = 1000;
  const allData: any[] = [];
  let from = 0;
  while (true) {
    let q = (supabase as any)
      .from("variants")
      .select("product_id, variant_sku, price, inventory_quantity, committed_quantity, expiry_date, products!inner(name, status, store_id)")
      .range(from, from + PAGE - 1);
    if (storeId) q = q.eq("products.store_id", storeId);
    const { data, error } = await q;
    if (error) throw error;
    allData.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  return allData.map((row: any) => ({
    sku: row.variant_sku ?? "—",
    product: row.products?.name ?? "Unknown",
    status: row.products?.status ?? "—",
    price: Number(row.price ?? 0),
    inventory: Number(row.inventory_quantity ?? 0),
    committed: Number(row.committed_quantity ?? 0),
    available: Math.max(0, Number(row.inventory_quantity ?? 0) - Number(row.committed_quantity ?? 0)),
    expiry: row.expiry_date ?? null,
    isExpiringSoon: row.expiry_date
      ? new Date(row.expiry_date) < new Date(Date.now() + 30 * 86400000)
      : false,
    isLowStock: Number(row.inventory_quantity ?? 0) <= 5,
    isOutOfStock: Number(row.inventory_quantity ?? 0) === 0,
    stockValue: Number(row.price ?? 0) * Number(row.inventory_quantity ?? 0),
  }));
}

// ─── Inventory summary KPIs ───────────────────────────────────────────────────

export async function fetchInventoryKPIs(storeId?: string | null) {
  const { data, error } = await (supabase as any).rpc("get_report_inventory_kpis", {
    p_store_id: storeId ?? null,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    totalSKUs: Number(row.total_skus ?? 0),
    outOfStock: Number(row.out_of_stock ?? 0),
    lowStock: Number(row.low_stock ?? 0),
    expiringSoon: Number(row.expiring_soon ?? 0),
    totalValue: Number(row.total_value ?? 0),
    totalUnits: Number(row.total_units ?? 0),
  };
}

// ─── Order fulfillment summary ────────────────────────────────────────────────

export async function fetchFulfillmentSummary(range: DateRange = "30d", storeId?: string | null) {
  const { data, error } = await (supabase as any).rpc("get_report_fulfillment_summary", {
    p_from: dateFrom(range),
    p_store_id: storeId ?? null,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    total: Number(row.total ?? 0),
    fulfilled: Number(row.fulfilled ?? 0),
    unfulfilled: Number(row.unfulfilled ?? 0),
    partial: Number(row.partial ?? 0),
    paid: Number(row.paid ?? 0),
    pending: Number(row.pending ?? 0),
    refunded: Number(row.refunded ?? 0),
    totalRevenue: Number(row.total_revenue ?? 0),
  };
}

// ─── Fulfillment by status over time ─────────────────────────────────────────

export async function fetchFulfillmentTrend(range: DateRange = "30d", storeId?: string | null) {
  const { data, error } = await (supabase as any).rpc("get_report_fulfillment_trend", {
    p_from: dateFrom(range),
    p_store_id: storeId ?? null,
  });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    date: r.date,
    label: dayLabel(r.date),
    fulfilled: Number(r.fulfilled),
    unfulfilled: Number(r.unfulfilled),
    partial: Number(r.partial),
  }));
}

// ─── Collections performance ──────────────────────────────────────────────────

export async function fetchCollectionPerformance(range: DateRange = "30d", storeId?: string | null) {
  const { data, error } = await (supabase as any).rpc("get_report_collection_performance", {
    p_from: dateFrom(range),
    p_store_id: storeId ?? null,
  });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    collection: r.collection,
    revenue: Number(r.revenue),
    units: Number(r.units),
  }));
}

// ─── Revenue KPIs ─────────────────────────────────────────────────────────────

export async function fetchRevenueKPIs(range: DateRange = "30d", storeId?: string | null) {
  const days = range === "all" ? 30 : parseInt(range);
  const priorFrom = new Date();
  priorFrom.setDate(priorFrom.getDate() - days * 2);
  const priorTo = new Date();
  priorTo.setDate(priorTo.getDate() - days);

  const { data, error } = await (supabase as any).rpc("get_report_revenue_kpis", {
    p_from: dateFrom(range),
    p_prior_from: priorFrom.toISOString(),
    p_prior_to: priorTo.toISOString(),
    p_store_id: storeId ?? null,
  });
  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  const revenue = Number(row.revenue ?? 0);
  const orders = Number(row.orders ?? 0);
  const aov = Number(row.aov ?? 0);
  const priorRevenue = Number(row.prior_revenue ?? 0);
  const revenueChange = priorRevenue ? ((revenue - priorRevenue) / priorRevenue) * 100 : null;

  return { revenue, orders, aov, revenueChange };
}

// ─── Custom report builder ────────────────────────────────────────────────────

export type CustomReportConfig = {
  metrics: string[];
  dimensions: string[];
  filters: string[];
  dateRange: DateRange;
};

export async function runCustomReport(config: CustomReportConfig, storeId?: string | null) {
  const { metrics, dimensions, dateRange } = config;

  const dim = dimensions[0] ?? "Channel";

  if (dim === "Channel" || dim === "Store") {
    const rows = await fetchSalesByChannel(dateRange, storeId);
    return rows.map(r => ({ label: r.channel, ...buildMetricValues(metrics, r) }));
  }

  if (dim === "Collection") {
    const rows = await fetchCollectionPerformance(dateRange, storeId);
    return rows.map(r => ({
      label: r.collection,
      ...buildMetricValues(metrics, { revenue: r.revenue, orders: 0, aov: 0, units: r.units }),
    }));
  }

  if (dim === "Day" || dim === "Week" || dim === "Month") {
    const rows = await fetchSalesTrend(dateRange, storeId);
    return rows.map(r => ({
      label: r.label,
      ...buildMetricValues(metrics, { revenue: r.revenue, orders: r.orders, aov: r.orders ? r.revenue / r.orders : 0, units: 0 }),
    }));
  }

  if (dim === "SKU" || dim === "Vendor") {
    const rows = await fetchTopProducts(dateRange, 20, storeId);
    return rows.map(r => ({
      label: r.name,
      ...buildMetricValues(metrics, { revenue: r.revenue, orders: r.orders, aov: r.orders ? r.revenue / r.orders : 0, units: r.units }),
    }));
  }

  const rows = await fetchSalesByChannel(dateRange, storeId);
  return rows.map(r => ({ label: r.channel, ...buildMetricValues(metrics, r) }));
}

function buildMetricValues(
  metrics: string[],
  data: { revenue: number; orders: number; aov: number; units?: number }
) {
  const out: Record<string, number> = {};
  for (const m of metrics) {
    if (m === "Revenue") out[m] = data.revenue;
    else if (m === "Orders") out[m] = data.orders;
    else if (m === "AOV") out[m] = data.aov;
    else if (m === "Units sold") out[m] = data.units ?? 0;
    else out[m] = 0;
  }
  return out;
}
