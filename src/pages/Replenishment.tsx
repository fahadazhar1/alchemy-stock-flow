import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { exportToCSV } from "@/lib/export";
import { Truck, Download, AlertTriangle, Clock, TrendingUp, Package } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { cn } from "@/lib/utils";

type ReplenRow = {
  product_id: string;
  product_name: string;
  sku: string;
  available_units: number;
  velocity: number;
  days_of_stock: number;
  replenishment_status: string;
};

const STATUS_CONFIG: Record<string, {
  badgeClass: string;
  barClass: string;
  dayClass: string;
  bgClass: string;
}> = {
  "Critical": {
    badgeClass: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
    barClass: "bg-red-500",
    dayClass: "text-red-600 dark:text-red-400",
    bgClass: "border-red-200 dark:border-red-900",
  },
  "Replenish Now": {
    badgeClass: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800",
    barClass: "bg-orange-500",
    dayClass: "text-orange-600 dark:text-orange-400",
    bgClass: "border-orange-200 dark:border-orange-900",
  },
  "Low Stock": {
    badgeClass: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
    barClass: "bg-amber-500",
    dayClass: "text-amber-600 dark:text-amber-400",
    bgClass: "border-amber-200 dark:border-amber-900",
  },
  "Watch Closely": {
    badgeClass: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
    barClass: "bg-blue-400",
    dayClass: "text-blue-600 dark:text-blue-400",
    bgClass: "border-blue-200 dark:border-blue-900",
  },
};

const fallbackConfig = STATUS_CONFIG["Watch Closely"];

export default function Replenishment() {
  const { storeId } = useStoreFilter();

  const { data, isLoading } = useQuery({
    queryKey: ["replenishment-page", storeId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_replenishment_candidates")
        .select("*")
        .order("days_of_stock", { ascending: true })
        .limit(100);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ReplenRow[];
    },
  });

  const criticalCount = data?.filter(r => r.days_of_stock < 3).length ?? 0;
  const avgDays = data?.length
    ? Math.round(data.reduce((s, r) => s + (r.days_of_stock ?? 0), 0) / data.length)
    : 0;
  const totalAtRisk = data?.length ?? 0;

  if (isLoading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6" /> Replenishment
          </h1>
          <p className="text-sm text-muted-foreground">
            High-velocity products running low — order before stockout
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => data && exportToCSV(
            data.map(r => ({
              Name: r.product_name,
              SKU: r.sku,
              "Available Units": r.available_units,
              "Days of Stock": r.days_of_stock,
              "Sells/wk": r.velocity,
              "Suggested Order": Math.max(0, Math.round(r.velocity * 2 - r.available_units)),
              Status: r.replenishment_status,
            })),
            "replenishment"
          )}
        >
          <Download className="h-4 w-4 mr-1" /> Export
        </Button>
      </div>

      {/* Summary Stats */}
      {totalAtRisk > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 shrink-0">
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{criticalCount}</div>
                <div className="text-xs text-muted-foreground">Critical (&lt;3 days)</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 shrink-0">
                <Clock className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{avgDays}d</div>
                <div className="text-xs text-muted-foreground">Avg days of stock</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 shrink-0">
                <TrendingUp className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{totalAtRisk}</div>
                <div className="text-xs text-muted-foreground">Products at risk</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cards Grid */}
      {!data?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <Truck className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No replenishment alerts</p>
          <p className="text-xs mt-1">All products have sufficient stock</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map(r => {
            const cfg = STATUS_CONFIG[r.replenishment_status] ?? fallbackConfig;
            const dos = Number(r.days_of_stock ?? 0);
            const barPct = Math.min((dos / 14) * 100, 100);
            const suggested = Math.max(0, Math.round(r.velocity * 2 - r.available_units));

            return (
              <Card key={r.product_id} className={cn("border", cfg.bgClass)}>
                <CardContent className="p-4 space-y-3">

                  {/* Status + days left */}
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={cn("text-[11px] font-medium border", cfg.badgeClass)}>
                      {r.replenishment_status}
                    </Badge>
                    <span className={cn("text-sm font-bold tabular-nums", cfg.dayClass)}>
                      {dos}d left
                    </span>
                  </div>

                  {/* Product info */}
                  <div className="flex items-start gap-2">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <Package size={14} className="text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm leading-snug line-clamp-2">
                        {r.product_name}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
                        {r.sku}
                      </div>
                    </div>
                  </div>

                  {/* Stock runway bar */}
                  <div>
                    <div className="flex justify-between text-[11px] text-muted-foreground mb-1.5">
                      <span>Stock Runway (Current Inventory)</span>
                      <span>{r.available_units} units</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", cfg.barClass)}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>0</span>
                      <span>14 days</span>
                    </div>
                  </div>

                  {/* Velocity + suggested order */}
                  <div className="flex items-center justify-between pt-1 border-t">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <TrendingUp className="h-3.5 w-3.5" />
                      <span>Sales  {r.velocity} units / week</span>
                    </div>
                    {suggested > 0 && (
                      <div className={cn(
                        "text-xs font-bold px-2.5 py-1 rounded-full border",
                        cfg.badgeClass
                      )}>
                        Order +{suggested}
                      </div>
                    )}
                  </div>

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
