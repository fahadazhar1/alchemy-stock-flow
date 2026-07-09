import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportToCSV } from "@/lib/export";
import { Archive, Download, DollarSign, Package, Ban } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCurrency } from "@/hooks/useCurrency";
import { formatUAEDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";

type DeadRow = {
  product_id: string;
  product_name: string;
  sku: string;
  product_type: string | null;
  store_id: string;
  total_units: number;
  unit_price: number;
  inventory_value: number;
  last_sale_at: string | null;
  units_sold_30d: number;
  units_sold_60d: number;
  units_sold_90d: number;
  dead_stock_status: string;
};

type Window = "30d" | "60d" | "90d";

const WINDOW_LABELS: Record<Window, string> = {
  "30d": "Dead 30+ days",
  "60d": "Dead 60+ days",
  "90d": "Dead 90+ days",
};

const STATUS_CONFIG: Record<string, string> = {
  "Never Sold":  "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/40 dark:text-slate-300",
  "Dead 90d":    "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400",
  "Dead 60d":    "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400",
  "Dead 30d":    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400",
};

export default function DeadStock() {
  const { storeId } = useStoreFilter();
  const { formatCurrency } = useCurrency();
  const [window, setWindow] = useState<Window>("30d");

  const { data, isLoading } = useQuery({
    queryKey: ["dead-stock", storeId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_dead_stock")
        .select("*")
        .order("inventory_value", { ascending: false })
        .limit(500);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DeadRow[];
    },
  });

  const filtered = data?.filter(r => {
    if (window === "30d") return true;
    if (window === "60d") return r.units_sold_60d === 0;
    return r.units_sold_90d === 0;
  }) ?? [];

  const totalValue   = filtered.reduce((s, r) => s + Number(r.inventory_value), 0);
  const neverSold    = filtered.filter(r => r.dead_stock_status === "Never Sold").length;
  const totalUnits   = filtered.reduce((s, r) => s + Number(r.total_units), 0);

  if (isLoading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Archive className="h-6 w-6" /> Dead Stock Report
          </h1>
          <p className="text-sm text-muted-foreground">
            Active products with inventory but no recent sales — sorted by value locked
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => filtered.length && exportToCSV(
          filtered.map(r => ({
            "Product": r.product_name,
            "SKU": r.sku,
            "Type": r.product_type ?? "",
            "Status": r.dead_stock_status,
            "Units": r.total_units,
            "Unit Price": r.unit_price,
            "Inventory Value": r.inventory_value,
            "Last Sale": r.last_sale_at ? formatUAEDate(r.last_sale_at) : "Never",
            "Sold 30d": r.units_sold_30d,
            "Sold 60d": r.units_sold_60d,
            "Sold 90d": r.units_sold_90d,
          })),
          `dead-stock-${window}`
        )}>
          <Download className="h-4 w-4 mr-1" /> Export
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 shrink-0">
              <DollarSign className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
              <div className="text-xs text-muted-foreground">Inventory value locked</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 shrink-0">
              <Package className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{filtered.length}</div>
              <div className="text-xs text-muted-foreground">Dead stock products</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/30 shrink-0">
              <Ban className="h-4 w-4 text-slate-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{neverSold}</div>
              <div className="text-xs text-muted-foreground">Never sold</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        {(["30d", "60d", "90d"] as Window[]).map(w => (
          <Button
            key={w}
            variant={window === w ? "default" : "outline"}
            size="sm"
            onClick={() => setWindow(w)}
          >
            {WINDOW_LABELS[w]}
          </Button>
        ))}
      </div>

      {!filtered.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <Archive className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No dead stock in this window</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Value Locked</TableHead>
                <TableHead className="text-right">Last Sale</TableHead>
                <TableHead className="text-right">Sold 30d</TableHead>
                <TableHead className="text-right">Sold 60d</TableHead>
                <TableHead className="text-right">Sold 90d</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium max-w-[200px] truncate">{r.product_name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[11px]", STATUS_CONFIG[r.dead_stock_status] ?? STATUS_CONFIG["Dead 30d"])}>
                      {r.dead_stock_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.total_units.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono font-medium text-red-600 dark:text-red-400">
                    {formatCurrency(Number(r.inventory_value))}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {r.last_sale_at ? formatUAEDate(r.last_sale_at) : "Never"}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono", r.units_sold_30d === 0 ? "text-muted-foreground" : "")}>
                    {r.units_sold_30d}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono", r.units_sold_60d === 0 ? "text-muted-foreground" : "")}>
                    {r.units_sold_60d}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono", r.units_sold_90d === 0 ? "text-muted-foreground" : "")}>
                    {r.units_sold_90d}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
