import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "@/hooks/useStoreFilter";

// Collections that exist for internal/storefront purposes only and should never
// appear as a product's collection label in the dashboard.
const INTERNAL_COLLECTIONS = new Set(["trending now", "all"]);
const isInternalCollection = (name: string | null | undefined) =>
  !name || INTERNAL_COLLECTIONS.has(name.toLowerCase());

// ─── Return types ─────────────────────────────────────────────────────────────

export interface InventoryKPIs {
  available: number;
  outOfStock: number;
  winners: number;
  losers: number;
}

export interface WmsPool {
  totalSKUs: number;
  totalAvailable: number;
  totalReserved: number;
  totalNetAvailable: number;
  totalValue: number;
}

export interface AgingBucket {
  label: string;
  units: number;
  color: string;
}

export interface InventoryCategory {
  name: string;
  units: number;
  color: string;
}

export interface LoserProduct {
  product_id: string;
  name: string;
  sku: string;
  vendor: string;
  collection: string;
  stock: number;
  days: number;
  price: number | null;
  compare: number | null;
}

export interface ReplenItem {
  name: string;
  sku: string;
  urgency: "High" | "Medium" | "Low";
  available: number;
  suggested: number;
}

export interface ExpiryItem {
  name: string;
  sku: string;
  units: number;
  days: number;
}

export interface InventoryDashboardData {
  kpis: InventoryKPIs;
  stockValue: number;
  wmsPool: WmsPool;
  agingBuckets: AgingBucket[];
  categories: InventoryCategory[];
  loserProducts: LoserProduct[];
  replenishment: ReplenItem[];
  expiringSoon: ExpiryItem[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGING_BUCKETS = [
  { label: "0–7d",   min: 0,  max: 7,        color: "#10B981" },
  { label: "8–30d",  min: 8,  max: 30,       color: "#3B82F6" },
  { label: "31–60d", min: 31, max: 60,       color: "#F59E0B" },
  { label: "61–90d", min: 61, max: 90,       color: "#F97316" },
  { label: "90d+",   min: 91, max: Infinity, color: "#EF4444" },
];

const CAT_COLORS = [
  "#5E5CE6", "#10B981", "#EC4899", "#F59E0B",
  "#3B82F6", "#8B5CF6", "#06B6D4", "#6B7280",
];

const URGENCY_MAP: Record<string, "High" | "Medium" | "Low"> = {
  critical: "High", high: "High", medium: "Medium", low: "Low",
};

// ─── Raw query shape (all statuses, fetched once per store) ──────────────────

interface RawDashboardData {
  allRows:      any[];
  replenRows:   any[];
  pcRows:       Array<{ product_id: string; collection_id: string }>;
  collIdToName: Record<string, string>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type ProductStatusFilter = "all" | "active" | "draft";

export function useInventoryDashboard(statusFilter: ProductStatusFilter = "all") {
  const { storeId } = useStoreFilter();

  // Raw fetch — always all statuses, cached once per store (5 min stale)
  const rawQuery = useQuery<RawDashboardData>({
    queryKey: ["inventory-dashboard-raw", storeId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      let summaryQ = (supabase as any)
        .from("v_product_inventory_summary")
        .select(
          "product_id, product_name, sku, vendor_name, collection_name, product_type, " +
          "days_old, total_inventory, min_current_price, max_compare_at_price, " +
          "nearest_expiry_date, product_status"
        );
      if (storeId) summaryQ = summaryQ.eq("store_id", storeId);

      let replenQ = (supabase as any)
        .from("v_replenishment_candidates")
        .select("product_name, sku, replenishment_status, velocity, available_units")
        .order("available_units", { ascending: true })
        .limit(5);
      if (storeId) replenQ = replenQ.eq("store_id", storeId);

      const [summaryRes, replenRes] = await Promise.all([summaryQ, replenQ]);

      const allRows = ((summaryRes.data ?? []) as any[]);
      const allInStockIds = allRows
        .filter((r: any) => Number(r.total_inventory ?? 0) > 0)
        .map((r: any) => r.product_id as string);

      // Fetch product_collections + collection names for all in-stock products
      let pcRows: Array<{ product_id: string; collection_id: string }> = [];
      let collIdToName: Record<string, string> = {};

      if (allInStockIds.length > 0) {
        const { data: pcData } = await (supabase as any)
          .from("product_collections")
          .select("product_id, collection_id")
          .in("product_id", allInStockIds);
        pcRows = (pcData ?? []) as typeof pcRows;

        if (pcRows.length > 0) {
          const collIds = [...new Set(pcRows.map(r => r.collection_id))];
          const { data: collData } = await (supabase as any)
            .from("collections").select("id, name").in("id", collIds);
          for (const c of (collData ?? []) as any[]) {
            if (!isInternalCollection(c.name)) collIdToName[c.id] = c.name;
          }
        }
      }

      return { allRows, replenRows: (replenRes.data ?? []) as any[], pcRows, collIdToName };
    },
  });

  // Derived data — recomputed synchronously when statusFilter changes, no network request
  const data = useMemo((): InventoryDashboardData | undefined => {
    if (!rawQuery.data) return undefined;
    const { allRows, replenRows, pcRows, collIdToName } = rawQuery.data;

    // Apply status filter client-side
    const filteredRows = statusFilter === "all"
      ? allRows
      : allRows.filter((r: any) => r.product_status === statusFilter);
    const inStockRows = filteredRows.filter((r: any) => Number(r.total_inventory ?? 0) > 0);

    // ── KPIs ─────────────────────────────────────────────────────────────────
    const kpis: InventoryKPIs = {
      available:  filteredRows.reduce((s: number, r: any) => s + Number(r.total_inventory ?? 0), 0),
      outOfStock: filteredRows.filter((r: any) => Number(r.total_inventory ?? 0) === 0).length,
      losers:     filteredRows.filter((r: any) => Number(r.days_old ?? 0) > 20 && Number(r.total_inventory ?? 0) > 10).length,
      winners:    filteredRows.filter((r: any) => !(Number(r.days_old ?? 0) > 20 && Number(r.total_inventory ?? 0) > 10)).length,
    };

    // ── Stock value ───────────────────────────────────────────────────────────
    const stockValue = inStockRows.reduce(
      (s: number, r: any) => s + Number(r.total_inventory ?? 0) * Number(r.min_current_price ?? 0),
      0
    );

    // ── WMS pool ──────────────────────────────────────────────────────────────
    const wmsPool: WmsPool = {
      totalSKUs: 0, totalAvailable: 0, totalReserved: 0, totalNetAvailable: 0, totalValue: 0,
    };

    // ── Aging buckets ─────────────────────────────────────────────────────────
    const agingBuckets: AgingBucket[] = AGING_BUCKETS.map(b => ({
      label: b.label,
      color: b.color,
      units: inStockRows.reduce((s: number, r: any) => {
        const d = Number(r.days_old ?? 0);
        return s + (d >= b.min && d <= b.max ? Number(r.total_inventory ?? 0) : 0);
      }, 0),
    }));

    // ── Collections (Top 5) — uses pre-fetched pcRows filtered to current status ──
    const collInventoryMap = new Map<string, number>();
    const prodInv = new Map(inStockRows.map((r: any) => [r.product_id as string, Number(r.total_inventory ?? 0)]));

    if (pcRows.length > 0) {
      const mappedProductIds = new Set<string>();
      for (const r of pcRows) {
        const inv = prodInv.get(r.product_id);
        if (inv === undefined) continue; // not in this status filter
        const name = collIdToName[r.collection_id];
        if (!name) continue;
        collInventoryMap.set(name, (collInventoryMap.get(name) ?? 0) + inv);
        mappedProductIds.add(r.product_id);
      }
      // Fallback for products absent from product_collections
      for (const r of inStockRows) {
        if (mappedProductIds.has(r.product_id)) continue;
        const raw = r.collection_name as string | null;
        const name = (isInternalCollection(raw) ? null : raw) || (r.product_type as string | null);
        if (name) collInventoryMap.set(name, (collInventoryMap.get(name) ?? 0) + Number(r.total_inventory ?? 0));
      }
    } else {
      for (const r of inStockRows) {
        const raw = r.collection_name as string | null;
        const name = (isInternalCollection(raw) ? null : raw) || (r.product_type as string | null);
        if (name) collInventoryMap.set(name, (collInventoryMap.get(name) ?? 0) + Number(r.total_inventory ?? 0));
      }
    }

    const categories: InventoryCategory[] = Array.from(collInventoryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, units], i) => ({ name, units, color: CAT_COLORS[i % CAT_COLORS.length] }));

    // ── Losers ────────────────────────────────────────────────────────────────
    // Build product → collection name from the junction table (already filtered, no "Trending Now")
    const productCollMap = new Map<string, string>();
    for (const r of pcRows) {
      if (productCollMap.has(r.product_id)) continue;
      const name = collIdToName[r.collection_id];
      if (name) productCollMap.set(r.product_id, name);
    }

    const loserProducts: LoserProduct[] = inStockRows
      .filter((r: any) => Number(r.days_old ?? 0) > 20 && Number(r.total_inventory ?? 0) > 10)
      .sort((a: any, b: any) => Number(b.days_old ?? 0) - Number(a.days_old ?? 0))
      .slice(0, 8)
      .map((r: any) => {
        const rawColl = isInternalCollection(r.collection_name) ? null : r.collection_name;
        const collection = productCollMap.get(r.product_id) ?? rawColl ?? r.product_type ?? "Uncategorised";
        return {
          product_id: r.product_id ?? "",
          name:       r.product_name ?? "—",
          sku:        r.sku ?? "—",
          vendor:     r.vendor_name ?? "—",
          collection,
          stock:      Number(r.total_inventory ?? 0),
          days:       Number(r.days_old ?? 0),
          price:      r.min_current_price  != null ? Number(r.min_current_price)  : null,
          compare:    r.max_compare_at_price != null ? Number(r.max_compare_at_price) : null,
        };
      });

    // ── Replenishment ─────────────────────────────────────────────────────────
    const replenishment: ReplenItem[] = replenRows.map((r: any) => {
      const vel = Number(r.velocity ?? 0);
      const avail = Number(r.available_units ?? 0);
      return {
        name:      r.product_name ?? "—",
        sku:       r.sku ?? "—",
        urgency:   URGENCY_MAP[(r.replenishment_status ?? "").toLowerCase()] ?? "Medium",
        available: avail,
        suggested: Math.max(0, Math.round(vel * 14 - avail)),
      };
    });

    // ── Expiry ────────────────────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 30);

    const expiringSoon: ExpiryItem[] = inStockRows
      .filter((r: any) => {
        if (!r.nearest_expiry_date) return false;
        return new Date(r.nearest_expiry_date as string) <= cutoff;
      })
      .sort((a: any, b: any) =>
        new Date(a.nearest_expiry_date).getTime() - new Date(b.nearest_expiry_date).getTime()
      )
      .slice(0, 5)
      .map((r: any) => ({
        name:  r.product_name ?? "—",
        sku:   r.sku ?? "—",
        units: Number(r.total_inventory ?? 0),
        days:  Math.max(0, Math.ceil(
          (new Date(r.nearest_expiry_date as string).getTime() - today.getTime()) / 86_400_000
        )),
      }));

    return { kpis, stockValue, wmsPool, agingBuckets, categories, loserProducts, replenishment, expiringSoon };
  }, [rawQuery.data, statusFilter]);

  return { ...rawQuery, data };
}
