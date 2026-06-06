import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportToCSV } from "@/lib/export";
import { Tag, Download, TrendingUp, TrendingDown, Percent, RefreshCw } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCurrency } from "@/hooks/useCurrency";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { formatUAEDate } from "@/lib/timezone";

type DayRow = {
  sale_date: string;
  store_id: string;
  total_orders: number;
  discounted_orders: number;
  full_price_orders: number;
  total_discount_amount: number;
  avg_discounted_aov: number;
  avg_full_price_aov: number;
  discounted_revenue: number;
  full_price_revenue: number;
};

type CodeRow = {
  discount_code: string;
  discount_type: string | null;
  store_id: string;
  usage_count: number;
  total_revenue: number;
  total_discount_given: number;
  avg_order_value: number;
  first_used_at: string;
  last_used_at: string;
};

type Tab = "daily" | "per-code";

export default function DiscountPerformance() {
  const { storeId } = useStoreFilter();
  const { formatCurrency, symbol } = useCurrency();
  const [tab, setTab] = useState<Tab>("per-code");
  const [syncing, setSyncing] = useState(false);

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ["discount-performance-daily", storeId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_discount_performance")
        .select("*")
        .order("sale_date", { ascending: false })
        .limit(90);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DayRow[];
    },
  });

  const { data: codeData, isLoading: codeLoading, refetch: refetchCodes } = useQuery({
    queryKey: ["discount-code-performance", storeId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_discount_code_performance")
        .select("*")
        .order("usage_count", { ascending: false })
        .limit(100);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CodeRow[];
    },
  });

  const handleBackfillSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("shopify-sync", {
        body: { action: "start_sync", store_id: storeId ?? undefined },
      });
      if (error) throw error;
      toast.success("Sync started — discount codes will populate within a few minutes");
      setTimeout(() => refetchCodes(), 10_000);
    } catch (e: any) {
      toast.error("Sync failed: " + (e?.message ?? "Unknown error"));
    } finally {
      setSyncing(false);
    }
  };

  const totals = dailyData?.reduce(
    (acc, r) => ({
      discountedOrders: acc.discountedOrders + Number(r.discounted_orders),
      totalDiscount: acc.totalDiscount + Number(r.total_discount_amount),
      discountedRevenue: acc.discountedRevenue + Number(r.discounted_revenue),
      totalOrders: acc.totalOrders + Number(r.total_orders),
    }),
    { discountedOrders: 0, totalDiscount: 0, discountedRevenue: 0, totalOrders: 0 }
  );

  const avgDiscountedAOV = dailyData?.length
    ? dailyData.reduce((s, r) => s + Number(r.avg_discounted_aov), 0) / (dailyData.filter(r => r.discounted_orders > 0).length || 1)
    : 0;
  const avgFullAOV = dailyData?.length
    ? dailyData.reduce((s, r) => s + Number(r.avg_full_price_aov), 0) / (dailyData.filter(r => r.full_price_orders > 0).length || 1)
    : 0;
  const aovLift = avgFullAOV > 0 ? ((avgDiscountedAOV - avgFullAOV) / avgFullAOV) * 100 : 0;
  const discountRate = totals && totals.totalOrders > 0
    ? ((totals.discountedOrders / totals.totalOrders) * 100).toFixed(1) : "0";

  const chartData = [...(dailyData ?? [])].reverse().slice(-30).map(r => ({
    date: new Date(r.sale_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    "Discount Given": Number(r.total_discount_amount),
  }));

  const isLoading = tab === "daily" ? dailyLoading : codeLoading;

  if (isLoading && !dailyData && !codeData) return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Tag className="h-6 w-6" /> Discount Performance
          </h1>
          <p className="text-sm text-muted-foreground">
            Per-code breakdown and daily order-level discount analysis
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleBackfillSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync Discount Codes"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            const rows = tab === "per-code" ? codeData : dailyData;
            if (!rows?.length) return;
            if (tab === "per-code") {
              exportToCSV((rows as CodeRow[]).map(r => ({
                "Discount Code": r.discount_code,
                "Type": r.discount_type ?? "",
                "Times Used": r.usage_count,
                "Total Revenue": r.total_revenue,
                "Total Discount Given": r.total_discount_given,
                "Avg Order Value": r.avg_order_value,
                "First Used": r.first_used_at ? formatUAEDate(r.first_used_at) : "",
                "Last Used": r.last_used_at ? formatUAEDate(r.last_used_at) : "",
              })), "discount-codes");
            } else {
              exportToCSV((rows as DayRow[]).map(r => ({
                Date: r.sale_date,
                "Total Orders": r.total_orders,
                "Discounted Orders": r.discounted_orders,
                "Total Discount Given": r.total_discount_amount,
                "Avg Discounted AOV": Number(r.avg_discounted_aov).toFixed(2),
                "Avg Full Price AOV": Number(r.avg_full_price_aov).toFixed(2),
              })), "discount-daily");
            }
          }}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-50 dark:bg-violet-950/30 shrink-0">
              <Percent className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{discountRate}%</div>
              <div className="text-xs text-muted-foreground">Orders with discount</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 shrink-0">
              <TrendingDown className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{formatCurrency(totals?.totalDiscount ?? 0)}</div>
              <div className="text-xs text-muted-foreground">Total discount given</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 shrink-0">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{formatCurrency(avgDiscountedAOV)}</div>
              <div className="text-xs text-muted-foreground">Avg discounted AOV</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 shrink-0">
              <TrendingUp className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <div className={`text-2xl font-bold ${aovLift >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {aovLift >= 0 ? "+" : ""}{aovLift.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground">AOV lift vs full-price</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-2">
        <Button variant={tab === "per-code" ? "default" : "outline"} size="sm" onClick={() => setTab("per-code")}>
          Per-Code Breakdown {codeData?.length ? `(${codeData.length})` : ""}
        </Button>
        <Button variant={tab === "daily" ? "default" : "outline"} size="sm" onClick={() => setTab("daily")}>
          Daily View
        </Button>
      </div>

      {/* Per-code table */}
      {tab === "per-code" && (
        <>
          {!codeData?.length ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Tag className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="font-medium">No discount code data yet</p>
                <p className="text-xs mt-1 mb-4">Click "Sync Discount Codes" above to pull code data from Shopify</p>
                <Button size="sm" onClick={handleBackfillSync} disabled={syncing}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing…" : "Sync Now"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Discount Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Times Used</TableHead>
                    <TableHead className="text-right">Revenue Generated</TableHead>
                    <TableHead className="text-right">Discount Given</TableHead>
                    <TableHead className="text-right">Avg Order Value</TableHead>
                    <TableHead>First Used</TableHead>
                    <TableHead>Last Used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codeData.map(r => (
                    <TableRow key={r.discount_code}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400">
                          {r.discount_code}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground capitalize">{r.discount_type ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{r.usage_count}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(Number(r.total_revenue))}</TableCell>
                      <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                        -{formatCurrency(Number(r.total_discount_given))}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(Number(r.avg_order_value))}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.first_used_at ? formatUAEDate(r.first_used_at) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.last_used_at ? formatUAEDate(r.last_used_at) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* Daily view */}
      {tab === "daily" && (
        <>
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Discount Amount — Last 30 Days</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                      tickFormatter={v => `${symbol}${Number(v).toLocaleString()}`} />
                    <Tooltip formatter={(v: number) => [formatCurrency(v), "Discount Given"]} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Discount Given" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {!dailyData?.length ? (
            <div className="text-center py-16 text-muted-foreground">
              <Tag className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="font-medium">No discount data found</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total Orders</TableHead>
                    <TableHead className="text-right">Discounted</TableHead>
                    <TableHead className="text-right">Full Price</TableHead>
                    <TableHead className="text-right">Discount Given</TableHead>
                    <TableHead className="text-right">Disc. AOV</TableHead>
                    <TableHead className="text-right">Full AOV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyData.map(r => (
                    <TableRow key={r.sale_date}>
                      <TableCell className="font-mono text-sm">
                        {new Date(r.sale_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.total_orders}</TableCell>
                      <TableCell className="text-right">
                        {r.discounted_orders > 0 ? (
                          <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 font-mono">
                            {r.discounted_orders}
                          </Badge>
                        ) : <span className="text-muted-foreground font-mono">0</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{r.full_price_orders}</TableCell>
                      <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                        {r.total_discount_amount > 0 ? `-${formatCurrency(Number(r.total_discount_amount))}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(Number(r.avg_discounted_aov))}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(Number(r.avg_full_price_aov))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
