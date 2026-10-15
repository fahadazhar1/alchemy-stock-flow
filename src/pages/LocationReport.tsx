import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCurrency } from "@/hooks/useCurrency";
import { exportToCSV } from "@/lib/export";
import { cn } from "@/lib/utils";
import { MapPin, Download, ShoppingCart, Package, Boxes } from "lucide-react";

type Period = "7d" | "30d" | "90d" | "mtd" | "ytd";
const PERIOD_LABELS: Record<Period, string> = {
  "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", mtd: "Month to date", ytd: "Year to date",
};

function periodBounds(p: Period): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  if (p === "7d") from.setDate(now.getDate() - 7);
  else if (p === "30d") from.setDate(now.getDate() - 30);
  else if (p === "90d") from.setDate(now.getDate() - 90);
  else if (p === "mtd") { from.setDate(1); from.setHours(0, 0, 0, 0); }
  else { from.setMonth(0, 1); from.setHours(0, 0, 0, 0); }
  return { from: from.toISOString(), to: now.toISOString() };
}

type SalesRow = { location_id: string | null; location_name: string; orders: number; revenue: number; units: number };
type StockRow = { location_id: string; location_name: string; skus_in_stock: number; units: number; stock_value: number };
type TopRow = { product_id: string; product_name: string; units: number; revenue: number };

const NOT_FULFILLED = "__none__";

export default function LocationReport() {
  const { storeId } = useStoreFilter();
  const { fmtCurrency } = useCurrency();
  const [period, setPeriod] = useState<Period>("30d");
  const [topLocation, setTopLocation] = useState<string | null>(null);
  const bounds = useMemo(() => periodBounds(period), [period]);

  const { data: sales, isLoading: salesLoading } = useQuery({
    queryKey: ["location-sales", storeId, period],
    enabled: !!storeId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_location_sales", { p_store_id: storeId, p_from: bounds.from, p_to: bounds.to });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r): SalesRow => ({
        location_id: r.location_id, location_name: r.location_name,
        orders: Number(r.orders), revenue: Number(r.revenue ?? 0), units: Number(r.units ?? 0),
      }));
    },
  });

  const { data: stock, isLoading: stockLoading } = useQuery({
    queryKey: ["location-stock", storeId],
    enabled: !!storeId,
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_location_stock_summary", { p_store_id: storeId });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r): StockRow => ({
        location_id: r.location_id, location_name: r.location_name,
        skus_in_stock: Number(r.skus_in_stock), units: Number(r.units), stock_value: Number(r.stock_value ?? 0),
      }));
    },
  });

  // One card per location: every location that holds stock, plus any that only appear in sales.
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; name: string; sales?: SalesRow; stock?: StockRow }>();
    for (const s of stock ?? []) map.set(s.location_id, { key: s.location_id, name: s.location_name, stock: s });
    for (const s of sales ?? []) {
      const key = s.location_id ?? NOT_FULFILLED;
      const cur = map.get(key) ?? { key, name: s.location_name };
      map.set(key, { ...cur, sales: s });
    }
    return [...map.values()].sort((a, b) => (b.sales?.revenue ?? 0) - (a.sales?.revenue ?? 0));
  }, [sales, stock]);

  const totalRevenue = (sales ?? []).reduce((s, r) => s + r.revenue, 0);
  const totalOrders = (sales ?? []).reduce((s, r) => s + r.orders, 0);
  const selectedKey = topLocation ?? rows.find(r => r.key !== NOT_FULFILLED && r.sales)?.key ?? rows[0]?.key ?? null;

  const { data: top, isLoading: topLoading } = useQuery({
    queryKey: ["location-top", storeId, period, selectedKey],
    enabled: !!storeId && !!selectedKey,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_location_top_products", {
        p_store_id: storeId, p_from: bounds.from, p_to: bounds.to,
        p_location_id: selectedKey === NOT_FULFILLED ? null : selectedKey, p_limit: 15,
      });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r): TopRow => ({
        product_id: r.product_id, product_name: r.product_name ?? "—", units: Number(r.units), revenue: Number(r.revenue ?? 0),
      }));
    },
  });

  if (!storeId) return (
    <div className="text-center py-16 text-muted-foreground">
      <MapPin className="h-10 w-10 mx-auto mb-2 opacity-40" />
      <p className="font-medium">Select a store</p>
      <p className="text-xs mt-1">Location figures are shown per store so currencies don't mix</p>
    </div>
  );

  const loading = salesLoading || stockLoading;
  const selectedName = rows.find(r => r.key === selectedKey)?.name ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MapPin className="h-6 w-6" /> Location Report
          </h1>
          <p className="text-sm text-muted-foreground">
            Sales by the location each order was fulfilled from, and the stock each location holds now
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={v => setPeriod(v as Period)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as Period[]).map(p => <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => exportToCSV(
            rows.map(r => ({
              Location: r.name,
              Orders: r.sales?.orders ?? 0,
              Revenue: r.sales?.revenue ?? 0,
              "Units Sold": r.sales?.units ?? 0,
              "Revenue Share %": totalRevenue ? Math.round(((r.sales?.revenue ?? 0) / totalRevenue) * 1000) / 10 : 0,
              "SKUs In Stock": r.stock?.skus_in_stock ?? 0,
              "Units In Stock": r.stock?.units ?? 0,
              "Stock Value": r.stock?.stock_value ?? 0,
            })),
            `location-report-${period}`
          )}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map(r => {
            const share = totalRevenue ? ((r.sales?.revenue ?? 0) / totalRevenue) * 100 : 0;
            const isNone = r.key === NOT_FULFILLED;
            return (
              <Card
                key={r.key}
                role="button"
                tabIndex={0}
                onClick={() => setTopLocation(r.key)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setTopLocation(r.key); }}
                className={cn("cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selectedKey === r.key && "border-primary ring-1 ring-primary/30", isNone && "border-dashed")}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold leading-snug">{r.name}</div>
                    {!isNone && <span className="text-xs text-muted-foreground tabular-nums">{share.toFixed(1)}% of sales</span>}
                  </div>
                  {!isNone && (
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(share, 100)}%` }} />
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold tabular-nums">{fmtCurrency(r.sales?.revenue ?? 0)}</div>
                      <div className="text-[11px] text-muted-foreground">Revenue</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold tabular-nums flex items-center justify-center gap-1"><ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />{(r.sales?.orders ?? 0).toLocaleString()}</div>
                      <div className="text-[11px] text-muted-foreground">Orders</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold tabular-nums flex items-center justify-center gap-1"><Package className="h-3.5 w-3.5 text-muted-foreground" />{(r.sales?.units ?? 0).toLocaleString()}</div>
                      <div className="text-[11px] text-muted-foreground">Units sold</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                    {isNone ? (
                      <span>Orders placed but not fulfilled yet — location assigned on fulfilment</span>
                    ) : (
                      <>
                        <span className="flex items-center gap-1"><Boxes className="h-3.5 w-3.5" />In stock now</span>
                        <span className="tabular-nums">
                          {(r.stock?.units ?? 0).toLocaleString()} units · {(r.stock?.skus_in_stock ?? 0).toLocaleString()} SKUs · {fmtCurrency(r.stock?.stock_value ?? 0)}
                        </span>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && (
        <p className="text-xs text-muted-foreground">
          {PERIOD_LABELS[period]}: {totalOrders.toLocaleString()} orders · {fmtCurrency(totalRevenue)} (excludes cancelled; revenue after edits and refunds). Stock value is at current selling price.
        </p>
      )}

      {selectedKey && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top products — {selectedName}</CardTitle>
          </CardHeader>
          <CardContent>
            {topLoading ? <Skeleton className="h-40" /> : !top?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No sales from this location in {PERIOD_LABELS[period].toLowerCase()}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top.map((t, i) => (
                    <TableRow key={t.product_id ?? i}>
                      <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">{t.product_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.units.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCurrency(t.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
