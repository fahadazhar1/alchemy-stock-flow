import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { exportToCSV } from "@/lib/export";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Activity, Download, Search, TrendingUp, TrendingDown,
  Minus, ChevronDown, ChevronRight, Zap, BarChart2, Package,
  ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type VelocityRow = {
  product_id: string;
  product_name: string;
  sku: string;
  units_sold_7d: number;
  units_sold_14d: number;
  units_sold_30d: number;
  last_sale_at: string | null;
  store_id: string;
  total_inventory: number;
  available_units: number;
};

type OrderDetail = {
  quantity: number;
  order_number: string;
  shopify_created_at: string;
};

type SortCol = "units_sold_7d" | "units_sold_14d" | "units_sold_30d" | "product_name" | "total_inventory";
type Trend   = "Spiking" | "Steady" | "Slowing" | "New";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTrend(row: VelocityRow): Trend {
  if (row.units_sold_30d === 0 && row.units_sold_7d === 0) return "New";
  if (row.units_sold_30d === 0) return "Spiking";
  const normalized = row.units_sold_7d * (30 / 7);
  const ratio = normalized / row.units_sold_30d;
  if (ratio > 1.3) return "Spiking";
  if (ratio < 0.7) return "Slowing";
  return "Steady";
}

const TREND_CONFIG: Record<Trend, { label: string; cls: string; icon: React.ReactNode }> = {
  Spiking: {
    label: "Spiking",
    cls: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
    icon: <TrendingUp className="h-3 w-3" />,
  },
  Steady: {
    label: "Steady",
    cls: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800",
    icon: <Minus className="h-3 w-3" />,
  },
  Slowing: {
    label: "Slowing",
    cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
    icon: <TrendingDown className="h-3 w-3" />,
  },
  New: {
    label: "No Sales",
    cls: "bg-muted text-muted-foreground border-border",
    icon: <Minus className="h-3 w-3" />,
  },
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Expanded order history row ───────────────────────────────────────────────

function OrderHistory({ productId }: { productId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["product-orders", productId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("order_items")
        .select("quantity, orders!inner(order_number, shopify_created_at, cancelled_at)")
        .eq("product_id", productId)
        .is("orders.cancelled_at", null)
        .limit(20);
      if (error) throw error;
      const rows: OrderDetail[] = ((data ?? []) as any[]).map((r: any) => ({
        quantity: Number(r.quantity),
        order_number: r.orders?.order_number ?? "—",
        shopify_created_at: r.orders?.shopify_created_at ?? "",
      }));
      return rows.sort((a, b) =>
        new Date(b.shopify_created_at).getTime() - new Date(a.shopify_created_at).getTime()
      );
    },
    staleTime: 60_000,
  });

  if (isLoading) return (
    <div className="px-6 py-3 space-y-2 bg-muted/30">
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-6 w-full" />)}
    </div>
  );

  if (!data?.length) return (
    <div className="px-6 py-4 bg-muted/30 text-sm text-muted-foreground">
      No orders found for this product.
    </div>
  );

  return (
    <div className="bg-muted/20 border-t px-6 py-3">
      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
        Order History (last 20)
      </p>
      <div className="space-y-1">
        {data.map((o, i) => (
          <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
            <div className="flex items-center gap-3">
              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-mono text-xs font-medium">{o.order_number}</span>
            </div>
            <span className="text-muted-foreground text-xs">{fmtDate(o.shopify_created_at)}</span>
            <span className="font-semibold text-sm tabular-nums">{o.quantity} units</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mini bar ─────────────────────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="tabular-nums w-6 text-right text-sm font-semibold">{value}</span>
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Sort header ──────────────────────────────────────────────────────────────

function SortHeader({
  col, label, sortCol, sortDir, onSort,
}: {
  col: SortCol; label: string; sortCol: SortCol; sortDir: "asc" | "desc";
  onSort: (c: SortCol) => void;
}) {
  const active = sortCol === col;
  return (
    <button
      onClick={() => onSort(col)}
      className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      {active
        ? sortDir === "desc"
          ? <ArrowDown className="h-3 w-3" />
          : <ArrowUp className="h-3 w-3" />
        : <ArrowUpDown className="h-3 w-3 opacity-40" />}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProductVelocity() {
  const { storeId } = useStoreFilter();
  const [search, setSearch]         = useState("");
  const [sortCol, setSortCol]       = useState<SortCol>("units_sold_7d");
  const [sortDir, setSortDir]       = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [trendFilter, setTrendFilter] = useState<Trend | "All">("All");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["product-velocity", storeId],
    queryFn: async () => {
      // store_id on product_velocity_metrics is NULL for all rows — filter via products join instead
      let q = (supabase as any)
        .from("product_velocity_metrics")
        .select("product_id, units_sold_7d, units_sold_14d, units_sold_30d, last_sale_at, products!inner(id, name, sku, store_id, variants(inventory_quantity, committed_quantity))")
        .order("units_sold_7d", { ascending: false })
        .limit(500);
      if (storeId) q = q.eq("products.store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map((r: any): VelocityRow => {
        const variants = (r.products?.variants ?? []) as any[];
        const total    = variants.reduce((s: number, v: any) => s + Number(v.inventory_quantity ?? 0), 0);
        const avail    = variants.reduce((s: number, v: any) => s + Number(v.inventory_quantity ?? 0) - Number(v.committed_quantity ?? 0), 0);
        return {
          product_id:      r.product_id,
          product_name:    r.products?.name     ?? "—",
          sku:             r.products?.sku      ?? "—",
          units_sold_7d:   Number(r.units_sold_7d  ?? 0),
          units_sold_14d:  Number(r.units_sold_14d ?? 0),
          units_sold_30d:  Number(r.units_sold_30d ?? 0),
          last_sale_at:    r.last_sale_at,
          store_id:        r.products?.store_id ?? null,
          total_inventory: total,
          available_units: Math.max(0, avail),
        };
      });
    },
    staleTime: 60_000,
  });

  // ── Derived ──
  const max7d  = Math.max(...rows.map(r => r.units_sold_7d),  1);
  const max14d = Math.max(...rows.map(r => r.units_sold_14d), 1);
  const max30d = Math.max(...rows.map(r => r.units_sold_30d), 1);

  const spikingCount = rows.filter(r => getTrend(r) === "Spiking").length;
  const slowingCount = rows.filter(r => getTrend(r) === "Slowing").length;
  const topMover     = rows[0];

  const filtered = rows
    .filter(r => {
      const q = search.toLowerCase();
      return !q || r.product_name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q);
    })
    .filter(r => trendFilter === "All" || getTrend(r) === trendFilter)
    .sort((a, b) => {
      const val = (r: VelocityRow) =>
        sortCol === "product_name" ? r.product_name : r[sortCol as keyof VelocityRow];
      const av = val(a), bv = val(b);
      if (typeof av === "string" && typeof bv === "string")
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc"
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  function toggleExpand(id: string) {
    setExpanded(prev => prev === id ? null : id);
  }

  if (isLoading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> Product Velocity
          </h1>
          <p className="text-sm text-muted-foreground">
            How fast every product is selling — based on real order data
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportToCSV(
            filtered.map(r => ({
              Product: r.product_name,
              SKU: r.sku,
              "Available Units": r.available_units,
              "Total Inventory": r.total_inventory,
              "7d Sales": r.units_sold_7d,
              "14d Sales": r.units_sold_14d,
              "30d Sales": r.units_sold_30d,
              Trend: getTrend(r),
            })),
            "product-velocity"
          )}
        >
          <Download className="h-4 w-4 mr-1" /> Export
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-50 dark:bg-violet-950/30 shrink-0">
              <BarChart2 className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{rows.length}</div>
              <div className="text-xs text-muted-foreground">Products tracked</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 shrink-0">
              <Zap className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{spikingCount}</div>
              <div className="text-xs text-muted-foreground">Spiking this week</div>
            </div>
          </CardContent>
        </Card>
        <Tooltip>
          <TooltipTrigger asChild>
            <Card className="cursor-help">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/30 shrink-0">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <div className="text-sm font-bold leading-tight line-clamp-1">
                    {topMover ? topMover.product_name : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Fastest mover · {topMover?.units_sold_7d ?? 0} units/wk
                  </div>
                </div>
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent className="max-w-[220px] text-xs space-y-1">
            <p className="font-semibold">Fastest mover</p>
            <p>The product with the highest units sold in the last 7 days — regardless of trend direction.</p>
            <p className="text-muted-foreground">A product can be the fastest mover but still "Slowing" if it sold even more in prior weeks.</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search product or SKU..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {(["All", "Spiking", "Steady", "Slowing"] as const).map(t => (
            <Button
              key={t}
              variant={trendFilter === t ? "default" : "outline"}
              size="sm"
              className="text-xs h-8"
              onClick={() => setTrendFilter(t)}
            >
              {t}
              {t === "Spiking" && spikingCount > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] rounded-full px-1.5">
                  {spikingCount}
                </span>
              )}
              {t === "Slowing" && slowingCount > 0 && (
                <span className="ml-1.5 bg-blue-500 text-white text-[10px] rounded-full px-1.5">
                  {slowingCount}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 bg-muted/50 border-b text-xs">
          <SortHeader col="product_name"    label="Product"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
          <SortHeader col="total_inventory" label="Inventory"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
          <SortHeader col="units_sold_7d"   label="Last 7 days"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
          <SortHeader col="units_sold_14d"  label="Last 14 days" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
          <SortHeader col="units_sold_30d"  label="Last 30 days" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
          <span className="text-xs font-semibold text-muted-foreground">Trend</span>
          <span className="w-5" />
        </div>

        {/* Rows */}
        {!filtered.length ? (
          <div className="py-16 text-center text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No products found</p>
          </div>
        ) : (
          filtered.map(r => {
            const trend   = getTrend(r);
            const tCfg    = TREND_CONFIG[trend];
            const isOpen  = expanded === r.product_id;

            return (
              <div key={r.product_id} className="border-t first:border-t-0">
                {/* Main row */}
                <div
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => toggleExpand(r.product_id)}
                >
                  {/* Product */}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.product_name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.sku}</div>
                  </div>

                  {/* Inventory */}
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      r.available_units === 0   ? "bg-red-500"
                      : r.available_units < 10  ? "bg-amber-500"
                      : r.available_units < 30  ? "bg-yellow-400"
                      : "bg-green-500"
                    )} />
                    <span className="tabular-nums text-sm font-semibold">{r.available_units}</span>
                    {r.total_inventory !== r.available_units && (
                      <span className="text-[10px] text-muted-foreground">/ {r.total_inventory}</span>
                    )}
                  </div>

                  {/* 7d */}
                  <MiniBar value={r.units_sold_7d}  max={max7d}  color="bg-violet-500" />
                  {/* 14d */}
                  <MiniBar value={r.units_sold_14d} max={max14d} color="bg-blue-500" />
                  {/* 30d */}
                  <MiniBar value={r.units_sold_30d} max={max30d} color="bg-green-500" />

                  {/* Trend */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className={cn("text-[11px] border flex items-center gap-1 w-fit cursor-help", tCfg.cls)}>
                        {tCfg.icon} {tCfg.label}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[220px] text-xs space-y-1">
                      <p className="font-semibold">How trend is calculated</p>
                      <p>
                        This week: <span className="font-bold">{r.units_sold_7d}/wk</span>
                        {" "}vs 30-day avg: <span className="font-bold">{Math.round(r.units_sold_30d / 4.3)}/wk</span>
                      </p>
                      <p className="text-muted-foreground">
                        {trend === "Spiking"  && "Selling 30%+ faster than its own 30-day average."}
                        {trend === "Slowing"  && "Selling 30%+ slower than its own 30-day average."}
                        {trend === "Steady"   && "Selling at roughly the same rate as the past 30 days."}
                        {trend === "New"      && "No sales data available to calculate trend."}
                      </p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Expand */}
                  <div className="text-muted-foreground">
                    {isOpen
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                  </div>
                </div>

                {/* Expanded order history */}
                {isOpen && <OrderHistory productId={r.product_id} />}
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Showing {filtered.length} of {rows.length} products · Sorted by {sortCol.replace("units_sold_", "last ")}
      </p>
    </div>
  );
}
