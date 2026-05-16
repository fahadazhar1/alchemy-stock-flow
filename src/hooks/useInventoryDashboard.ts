import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "@/hooks/useStoreFilter";

// ─── Return types ─────────────────────────────────────────────────────────────

export interface InventoryKPIs {
  onHand: number;
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInventoryDashboard() {
  const { storeId } = useStoreFilter();

  return useQuery({
    queryKey: ["inventory-dashboard", storeId],
    queryFn: async (): Promise<InventoryDashboardData> => {
      let summaryQ = (supabase as any)
        .from("v_product_inventory_summary")
        .select(
          "product_id, product_name, sku, vendor_name, collection_name, " +
          "days_old, total_inventory, min_current_price, max_compare_at_price, " +
          "nearest_expiry_date"
        );
      if (storeId) summaryQ = summaryQ.eq("store_id", storeId);

      let replenQ = (supabase as any)
        .from("v_replenishment_candidates")
        .select("product_name, sku, replenishment_status, velocity, available_units")
        .order("available_units", { ascending: true })
        .limit(5);
      if (storeId) replenQ = replenQ.eq("store_id", storeId);

      const [kpiRes, summaryRes, replenRes] = await Promise.all([
        supabase.rpc("get_dashboard_kpis", { p_store_id: storeId ?? null }),
        summaryQ,
        replenQ,
      ]);

      if (kpiRes.error) throw kpiRes.error;

      const kpiRow = (Array.isArray(kpiRes.data) ? kpiRes.data[0] : kpiRes.data) as any;
      const summaryRows = ((summaryRes.data ?? []) as any[])
        .filter((r: any) => Number(r.total_inventory ?? 0) > 0);
      const replenRows = ((replenRes.data ?? []) as any[]);

      // ── KPIs ──────────────────────────────────────────────────────────────
      const kpis: InventoryKPIs = {
        onHand:     Number(kpiRow?.on_hand_inventory ?? 0),
        outOfStock: Number(kpiRow?.out_of_stock_products ?? 0),
        winners:    Number(kpiRow?.winners_count ?? kpiRow?.low_stock_winners_count ?? 0),
        losers:     Number(kpiRow?.losers_count ?? 0),
      };

      // ── Stock value ───────────────────────────────────────────────────────
      const stockValue = summaryRows.reduce(
        (s: number, r: any) => s + Number(r.total_inventory ?? 0) * Number(r.min_current_price ?? 0),
        0
      );

      // ── WMS pool (placeholder — central inventory not store-scoped by design) ─
      const wmsPool: WmsPool = {
        totalSKUs:         0,
        totalAvailable:    0,
        totalReserved:     0,
        totalNetAvailable: 0,
        totalValue:        0,
      };

      // ── Aging buckets ─────────────────────────────────────────────────────
      const agingBuckets: AgingBucket[] = AGING_BUCKETS.map(b => ({
        label: b.label,
        color: b.color,
        units: summaryRows.reduce((s: number, r: any) => {
          const d = Number(r.days_old ?? 0);
          return s + (d >= b.min && d <= b.max ? Number(r.total_inventory ?? 0) : 0);
        }, 0),
      }));

      // ── Categories ────────────────────────────────────────────────────────
      const catMap = new Map<string, number>();
      summaryRows.forEach((r: any) => {
        const name = (r.collection_name as string | null) ?? "Uncategorised";
        catMap.set(name, (catMap.get(name) ?? 0) + Number(r.total_inventory ?? 0));
      });
      const categories: InventoryCategory[] = Array.from(catMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7)
        .map(([name, units], i) => ({ name, units, color: CAT_COLORS[i % CAT_COLORS.length] }));

      // ── Losers: age > 20 days AND stock > 10 units (matches v_loser_products definition) ──
      const loserProducts: LoserProduct[] = summaryRows
        .filter((r: any) => Number(r.days_old ?? 0) > 20 && Number(r.total_inventory ?? 0) > 10)
        .sort((a: any, b: any) => Number(b.days_old ?? 0) - Number(a.days_old ?? 0))
        .slice(0, 8)
        .map((r: any) => ({
          product_id: r.product_id ?? "",
          name:       r.product_name ?? "—",
          sku:        r.sku ?? "—",
          vendor:     r.vendor_name ?? "—",
          collection: r.collection_name ?? "—",
          stock:      Number(r.total_inventory ?? 0),
          days:       Number(r.days_old ?? 0),
          price:      r.min_current_price != null ? Number(r.min_current_price) : null,
          compare:    r.max_compare_at_price != null ? Number(r.max_compare_at_price) : null,
        }));

      // ── Replenishment queue ───────────────────────────────────────────────
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

      // ── Expiry ────────────────────────────────────────────────────────────
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + 30);

      const expiringSoon: ExpiryItem[] = summaryRows
        .filter((r: any) => {
          if (!r.nearest_expiry_date) return false;
          const d = new Date(r.nearest_expiry_date as string);
          return d <= cutoff;
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
    },
  });
}
