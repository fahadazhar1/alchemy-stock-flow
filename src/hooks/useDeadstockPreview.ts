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

export function useDeadstockPreview(limit = 8, filter = "all") {
  const { storeId } = useStoreFilter();
  return useQuery<{ products: DeadstockProduct[]; total: number }>({
    queryKey: ["deadstock-preview", storeId, limit, filter],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_dead_stock")
        .select(COLS, { count: "exact" })
        .order("inventory_value", { ascending: false })
        .limit(limit);
      if (storeId) q = q.eq("store_id", storeId);
      if (filter === "Overstocked") {
        q = q.eq("dead_stock_status", "Never Sold").gte("total_units", 50);
      } else if (filter !== "all") {
        q = q.eq("dead_stock_status", filter);
      }
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
      let q = (supabase as any)
        .from("v_dead_stock")
        .select("dead_stock_status,total_units,inventory_value")
        .limit(10000);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      let deadUnits = 0, deadValue = 0, overUnits = 0, overValue = 0;
      for (const p of (data ?? []) as Pick<DeadstockProduct, "dead_stock_status" | "total_units" | "inventory_value">[]) {
        if (p.dead_stock_status === "Never Sold" && p.total_units >= 50) {
          overUnits += p.total_units;
          overValue += p.inventory_value;
        } else {
          deadUnits += p.total_units;
          deadValue += p.inventory_value;
        }
      }
      return { deadUnits, deadValue, overUnits, overValue, totalProducts: (data ?? []).length };
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
