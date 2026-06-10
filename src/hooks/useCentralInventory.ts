import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";

export interface CentralInventoryItem {
  master_variant_id: string;
  sku: string;
  base_price: number | null;
  master_product_id: string;
  master_product_name: string;
  available_quantity: number;
  reserved_quantity: number;
  net_available: number;
  linked_stores_count: number;
}

async function fetchAllCentralInventory(): Promise<CentralInventoryItem[]> {
  const PAGE = 1000;
  const rows: CentralInventoryItem[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("v_central_inventory")
      .select("*")
      .order("master_product_name")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as CentralInventoryItem[]));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export function useCentralInventory() {
  return useQuery({
    queryKey: ["central-inventory"],
    queryFn: () => fetchAllCentralInventory(),
  });
}

export function useCentralInventoryKPIs() {
  return useQuery({
    queryKey: ["central-inventory-kpis"],
    queryFn: async () => {
      const items = await fetchAllCentralInventory();
      const totalAvailable = items.reduce((s, i) => s + (i.available_quantity || 0), 0);
      const totalReserved = items.reduce((s, i) => s + (i.reserved_quantity || 0), 0);
      const totalNetAvailable = items.reduce((s, i) => s + (i.net_available || 0), 0);
      const totalValue = items.reduce((s, i) => s + (i.available_quantity || 0) * Number(i.base_price || 0), 0);
      const uniqueProducts = new Set(items.map(i => i.master_product_id)).size;
      const totalSKUs = items.length;
      return { totalAvailable, totalReserved, totalNetAvailable, totalValue, uniqueProducts, totalSKUs, items };
    },
  });
}

export function useVariantStoreMapping(variantSku?: string) {
  return useQuery({
    queryKey: ["variant-store-mapping", variantSku],
    enabled: !!variantSku,
    queryFn: async () => {
      const { data: mv } = await supabase
        .from("master_variants")
        .select("id")
        .eq("sku", variantSku!)
        .single();
      if (!mv) return { mappings: [], centralStock: 0 };
      
      const { data: il } = await supabase
        .from("inventory_levels")
        .select("available_quantity, reserved_quantity")
        .eq("master_variant_id", mv.id)
        .single();

      const { data: mappings } = await supabase
        .from("store_variant_mappings")
        .select("*, stores(store_name)")
        .eq("master_variant_id", mv.id);

      return {
        centralStock: il?.available_quantity ?? 0,
        reserved: il?.reserved_quantity ?? 0,
        mappings: mappings ?? [],
      };
    },
  });
}
