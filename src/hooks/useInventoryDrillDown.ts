import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DrillDownMetric = "oos" | "low_stock" | "critical" | "dead_stock" | "overstocked";

export interface DrillDownProduct {
  product_id: string;
  product_name: string;
  sku: string | null;
  collection_name?: string | null;
  product_type?: string | null;
  total_inventory?: number;
  available_units?: number;
  velocity?: number | null;
  days_of_stock?: number | null;
  replenishment_status?: string | null;
  total_units?: number;
  unit_price?: number;
  inventory_value?: number;
  dead_stock_status?: string | null;
  last_sale_at?: string | null;
}

const db = supabase as any;

function qOOS(sid: string, f: number, t: number) {
  return db.from("v_product_inventory_summary")
    .select("product_id,product_name,sku,collection_name,product_type,total_inventory", { count: "exact" })
    .eq("store_id", sid).eq("product_status", "active").eq("total_inventory", 0)
    .order("product_name").range(f, t);
}
function qLowStock(sid: string, f: number, t: number) {
  return db.from("v_replenishment_candidates")
    .select("product_id,product_name,sku,available_units,velocity,days_of_stock,replenishment_status", { count: "exact" })
    .eq("store_id", sid)
    .order("days_of_stock", { ascending: true, nullsFirst: false }).range(f, t);
}
function qCritical(sid: string, f: number, t: number) {
  return db.from("v_replenishment_candidates")
    .select("product_id,product_name,sku,available_units,velocity,days_of_stock,replenishment_status", { count: "exact" })
    .eq("store_id", sid).eq("replenishment_status", "Critical")
    .order("days_of_stock", { ascending: true, nullsFirst: false }).range(f, t);
}
function qDeadStock(sid: string, f: number, t: number) {
  return db.from("v_dead_stock")
    .select("product_id,product_name,sku,product_type,total_units,unit_price,inventory_value,dead_stock_status,last_sale_at", { count: "exact" })
    .eq("store_id", sid).order("inventory_value", { ascending: false }).range(f, t);
}
function qOverstocked(sid: string, f: number, t: number) {
  return db.from("v_dead_stock")
    .select("product_id,product_name,sku,product_type,total_units,unit_price,inventory_value,dead_stock_status,last_sale_at", { count: "exact" })
    .eq("store_id", sid).eq("dead_stock_status", "Never Sold").gte("total_units", 50)
    .order("total_units", { ascending: false }).range(f, t);
}

function runQuery(metric: DrillDownMetric, sid: string, f: number, t: number) {
  if (metric === "oos")         return qOOS(sid, f, t);
  if (metric === "low_stock")   return qLowStock(sid, f, t);
  if (metric === "critical")    return qCritical(sid, f, t);
  if (metric === "dead_stock")  return qDeadStock(sid, f, t);
  return qOverstocked(sid, f, t);
}

export function useInventoryDrillDown(
  storeId: string | null,
  metric: DrillDownMetric | null,
  page: number,
  pageSize = 50,
) {
  return useQuery<{ products: DrillDownProduct[]; total: number }>({
    queryKey: ["inventory-drilldown", storeId, metric, page, pageSize],
    enabled: !!storeId && !!metric,
    staleTime: 60_000,
    queryFn: async () => {
      if (!storeId || !metric) return { products: [], total: 0 };
      const from = page * pageSize;
      const to   = from + pageSize - 1;
      const res  = await runQuery(metric, storeId, from, to);
      if (res.error) throw res.error;
      return { products: (res.data ?? []) as DrillDownProduct[], total: res.count ?? 0 };
    },
  });
}

export async function fetchAllDrillDown(
  storeId: string,
  metric: DrillDownMetric,
): Promise<DrillDownProduct[]> {
  const res = await runQuery(metric, storeId, 0, 9_999);
  return res.data ?? [];
}
