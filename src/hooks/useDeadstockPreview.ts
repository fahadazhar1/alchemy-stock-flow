import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "@/hooks/useStoreFilter";

export interface DeadstockProduct {
  product_id: string;
  product_name: string;
  sku: string | null;
  product_type: string | null;
  total_units: number;
  unit_price: number;
  inventory_value: number;
  dead_stock_status: string | null;
  last_sale_at: string | null;
}

export function isOverstocked(p: DeadstockProduct) {
  return p.dead_stock_status === "Never Sold" && p.total_units >= 50;
}

export function getDeadstockLabel(p: DeadstockProduct): string {
  if (isOverstocked(p)) return "Overstocked";
  return p.dead_stock_status ?? "Unknown";
}

const COLS =
  "product_id,product_name,sku,product_type,total_units,unit_price,inventory_value,dead_stock_status,last_sale_at";

export interface PriceRange {
  min?: number;
  max?: number;
}

export function useDeadstockPreview(limit = 8, filters: string[] = [], priceRange?: PriceRange) {
  const { storeId } = useStoreFilter();
  const min = priceRange?.min;
  const max = priceRange?.max;
  const sortedFilters = [...filters].sort();
  return useQuery<{ products: DeadstockProduct[]; total: number }>({
    queryKey: ["deadstock-preview", storeId, limit, sortedFilters, min, max],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_dead_stock")
        .select(COLS, { count: "exact" })
        .order("inventory_value", { ascending: false })
        .limit(limit);
      if (storeId) q = q.eq("store_id", storeId);
      if (filters.length > 0) {
        const orParts = filters.map(f =>
          f === "Overstocked"
            ? "and(dead_stock_status.eq.Never Sold,total_units.gte.50)"
            : `dead_stock_status.eq.${f}`
        );
        q = q.or(orParts.join(","));
      }
      if (min != null) q = q.gte("unit_price", min);
      if (max != null) q = q.lte("unit_price", max);
      const { data, error, count } = await q;
      if (error) throw error;
      return { products: data ?? [], total: count ?? 0 };
    },
  });
}

export interface DeadstockSummary {
  deadUnits: number;
  deadValue: number;
  overUnits: number;
  overValue: number;
  totalProducts: number;
}

export function useDeadstockSummary() {
  const { storeId } = useStoreFilter();
  return useQuery<DeadstockSummary>({
    queryKey: ["deadstock-summary", storeId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // Server-side aggregation — see migration 20260615000006_deadstock_summary_rpc.sql.
      const { data, error } = await (supabase as any).rpc("get_deadstock_summary", {
        p_store_id: storeId ?? null,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as any;
      return {
        deadUnits:     Number(row?.dead_units     ?? 0),
        deadValue:     Number(row?.dead_value     ?? 0),
        overUnits:     Number(row?.over_units     ?? 0),
        overValue:     Number(row?.over_value     ?? 0),
        totalProducts: Number(row?.total_products ?? 0),
      };
    },
  });
}

export function useDeadstockAll(enabled: boolean) {
  const { storeId } = useStoreFilter();
  return useQuery<DeadstockProduct[]>({
    queryKey: ["deadstock-all", storeId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_dead_stock")
        .select(COLS)
        .order("inventory_value", { ascending: false })
        .limit(10000);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
