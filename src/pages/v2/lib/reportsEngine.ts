import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export type DateRange = "7d" | "30d" | "90d" | "365d" | "all";

function dateFrom(range: DateRange): string | null {
  if (range === "all") return null;
  const days = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[range];
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ─── Sales by channel ────────────────────────────────────────────────────────

export async function fetchSalesByChannel(range: DateRange = "30d") {
  let q = supabase
    .from("orders")
    .select("source_name, total_price, financial_status");
  const from = dateFrom(range);
  if (from) q = q.gte("created_at", from);

  const { data, error } = await q;
  if (error) throw error;

  const map: Record<string, { revenue: number; orders: number }> = {};
  for (const row of data ?? []) {
    const ch = row.source_name ?? "Unknown";
    if (!map[ch]) map[ch] = { revenue: 0, orders: 0 };
    map[ch].revenue += Number(row.total_price ?? 0);
    map[ch].orders += 1;
  }

  return Object.entries(map)
    .map(([channel, v]) => ({ channel, ...v, aov: v.orders ? v.revenue / v.orders : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ─── Sales trend (daily/weekly) ───────────────────────────────────────────────

export async function fetchSalesTrend(range: DateRange = "30d") {
  let q = supabase
    .from("orders")
    .select("created_at, total_price")
    .order("created_at", { ascending: true });
  const from = dateFrom(range);
  if (from) q = q.gte("created_at", from);

  const { data, error } = await q;
  if (error) throw error;

  const map: Record<string, { revenue: number; orders: number }> = {};
  for (const row of data ?? []) {
    const day = row.created_at.slice(0, 10);
    if (!map[day]) map[day] = { revenue: 0, orders: 0 };
    map[day].revenue += Number(row.total_price ?? 0);
    map[day].orders += 1;
  }

  return Object.entries(map).map(([date, v]) => ({
    date,
    label: new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    ...v,
  }));
}

// ─── Top products by revenue ──────────────────────────────────────────────────

export async function fetchTopProducts(range: DateRange = "30d", limit = 20) {
  let q = supabase
    .from("order_items")
    .select("product_id, quantity, unit_price, created_at, products(name, product_type, vendor_id)");
  const from = dateFrom(range);
  if (from) q = q.gte("created_at", from);

  const { data, error } = await q;
  if (error) throw error;

  const map: Record<string, { name: string; type: string; revenue: number; units: number; orders: number }> = {};
  for (const row of (data ?? []) as any[]) {
    const id = row.product_id;
    if (!map[id]) {
      map[id] = {
        name: row.products?.name ?? "Unknown",
        type: row.products?.product_type ?? "—",
        revenue: 0,
        units: 0,
        orders: 0,
      };
    }
    map[id].revenue += Number(row.unit_price ?? 0) * Number(row.quantity ?? 0);
    map[id].units += Number(row.quantity ?? 0);
    map[id].orders += 1;
  }

  return Object.values(map)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

// ─── Inventory health ─────────────────────────────────────────────────────────

export async function fetchInventoryHealth() {
  const { data, error } = await supabase
    .from("variants")
    .select("product_id, variant_sku, price, inventory_quantity, committed_quantity, expiry_date, products(name, status)");
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
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

export async function fetchInventoryKPIs() {
  const rows = await fetchInventoryHealth();
  const totalSKUs = rows.length;
  const outOfStock = rows.filter(r => r.isOutOfStock).length;
  const lowStock = rows.filter(r => r.isLowStock && !r.isOutOfStock).length;
  const expiringSoon = rows.filter(r => r.isExpiringSoon).length;
  const totalValue = rows.reduce((s, r) => s + r.stockValue, 0);
  const totalUnits = rows.reduce((s, r) => s + r.inventory, 0);
  return { totalSKUs, outOfStock, lowStock, expiringSoon, totalValue, totalUnits };
}

// ─── Order fulfillment summary ────────────────────────────────────────────────

export async function fetchFulfillmentSummary(range: DateRange = "30d") {
  let q = supabase
    .from("orders")
    .select("fulfillment_status, financial_status, total_price, created_at");
  const from = dateFrom(range);
  if (from) q = q.gte("created_at", from);

  const { data, error } = await q;
  if (error) throw error;

  const rows = data ?? [];
  const total = rows.length;
  const fulfilled = rows.filter(r => r.fulfillment_status === "fulfilled").length;
  const unfulfilled = rows.filter(r => r.fulfillment_status === "unfulfilled" || !r.fulfillment_status).length;
  const partial = rows.filter(r => r.fulfillment_status === "partial").length;
  const paid = rows.filter(r => r.financial_status === "paid").length;
  const pending = rows.filter(r => r.financial_status === "pending").length;
  const refunded = rows.filter(r => r.financial_status === "refunded").length;
  const totalRevenue = rows.reduce((s, r) => s + Number(r.total_price ?? 0), 0);

  return { total, fulfilled, unfulfilled, partial, paid, pending, refunded, totalRevenue };
}

// ─── Fulfillment by status over time ─────────────────────────────────────────

export async function fetchFulfillmentTrend(range: DateRange = "30d") {
  let q = supabase
    .from("orders")
    .select("created_at, fulfillment_status")
    .order("created_at", { ascending: true });
  const from = dateFrom(range);
  if (from) q = q.gte("created_at", from);

  const { data, error } = await q;
  if (error) throw error;

  const map: Record<string, { fulfilled: number; unfulfilled: number; partial: number }> = {};
  for (const row of data ?? []) {
    const day = row.created_at.slice(0, 10);
    if (!map[day]) map[day] = { fulfilled: 0, unfulfilled: 0, partial: 0 };
    const fs = row.fulfillment_status ?? "unfulfilled";
    if (fs === "fulfilled") map[day].fulfilled++;
    else if (fs === "partial") map[day].partial++;
    else map[day].unfulfilled++;
  }

  return Object.entries(map).map(([date, v]) => ({
    date,
    label: new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    ...v,
  }));
}

// ─── Collections performance ──────────────────────────────────────────────────

export async function fetchCollectionPerformance(range: DateRange = "30d") {
  let q = supabase
    .from("order_items")
    .select("quantity, unit_price, created_at, products(collection_id, collections(name))");
  const from = dateFrom(range);
  if (from) q = q.gte("created_at", from);

  const { data, error } = await q;
  if (error) throw error;

  const map: Record<string, { collection: string; revenue: number; units: number }> = {};
  for (const row of (data ?? []) as any[]) {
    const colId = row.products?.collection_id ?? "unknown";
    const colName = row.products?.collections?.name ?? "Uncategorised";
    if (!map[colId]) map[colId] = { collection: colName, revenue: 0, units: 0 };
    map[colId].revenue += Number(row.unit_price ?? 0) * Number(row.quantity ?? 0);
    map[colId].units += Number(row.quantity ?? 0);
  }

  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

// ─── Revenue KPIs ─────────────────────────────────────────────────────────────

export async function fetchRevenueKPIs(range: DateRange = "30d") {
  let q = supabase
    .from("orders")
    .select("total_price, created_at, financial_status");
  const from = dateFrom(range);
  if (from) q = q.gte("created_at", from);

  // also fetch prior period for comparison
  const days = range === "all" ? 30 : parseInt(range);
  const priorFrom = new Date();
  priorFrom.setDate(priorFrom.getDate() - days * 2);
  const priorTo = new Date();
  priorTo.setDate(priorTo.getDate() - days);

  const [curr, prior] = await Promise.all([
    q,
    supabase
      .from("orders")
      .select("total_price")
      .gte("created_at", priorFrom.toISOString())
      .lt("created_at", priorTo.toISOString()),
  ]);

  if (curr.error) throw curr.error;

  const rows = curr.data ?? [];
  const priorRows = prior.data ?? [];

  const revenue = rows.reduce((s, r) => s + Number(r.total_price ?? 0), 0);
  const orders = rows.length;
  const aov = orders ? revenue / orders : 0;
  const priorRevenue = priorRows.reduce((s, r) => s + Number(r.total_price ?? 0), 0);
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

export async function runCustomReport(config: CustomReportConfig) {
  const { metrics, dimensions, dateRange } = config;

  // Determine primary dimension to group by
  const dim = dimensions[0] ?? "Channel";
  const from = dateFrom(dateRange);

  if (dim === "Channel" || dim === "Store") {
    const rows = await fetchSalesByChannel(dateRange);
    return rows.map(r => ({
      label: r.channel,
      ...buildMetricValues(metrics, r),
    }));
  }

  if (dim === "Collection") {
    const rows = await fetchCollectionPerformance(dateRange);
    return rows.map(r => ({
      label: r.collection,
      ...buildMetricValues(metrics, { revenue: r.revenue, orders: 0, aov: 0, units: r.units }),
    }));
  }

  if (dim === "Day" || dim === "Week" || dim === "Month") {
    const rows = await fetchSalesTrend(dateRange);
    return rows.map(r => ({
      label: r.label,
      ...buildMetricValues(metrics, { revenue: r.revenue, orders: r.orders, aov: r.orders ? r.revenue / r.orders : 0, units: 0 }),
    }));
  }

  if (dim === "SKU" || dim === "Vendor") {
    const rows = await fetchTopProducts(dateRange);
    return rows.map(r => ({
      label: r.name,
      ...buildMetricValues(metrics, { revenue: r.revenue, orders: r.orders, aov: r.orders ? r.revenue / r.orders : 0, units: r.units }),
    }));
  }

  // Default fallback — sales by channel
  const rows = await fetchSalesByChannel(dateRange);
  return rows.map(r => ({
    label: r.channel,
    ...buildMetricValues(metrics, r),
  }));
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
