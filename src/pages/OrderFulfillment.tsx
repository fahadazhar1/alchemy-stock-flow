import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportToCSV } from "@/lib/export";
import { PackageCheck, Download, AlertTriangle, Clock, Package, Filter } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCurrency } from "@/hooks/useCurrency";
import { cn } from "@/lib/utils";

type Order = {
  id: string;
  order_number: string;
  customer_email: string | null;
  fulfillment_status: string | null;
  financial_status: string | null;
  total_price: number;
  shopify_created_at: string;
  store_id: string;
  age_hours: number;
  is_stale: boolean;
};

const STATUS_FILTERS = ["all", "unfulfilled", "partial"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

export default function OrderFulfillment() {
  const { storeId } = useStoreFilter();
  const { formatCurrency } = useCurrency();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["unfulfilled-orders", storeId],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select("id, order_number, customer_email, fulfillment_status, financial_status, total_price, shopify_created_at, store_id")
        .is("cancelled_at", null)
        .or("fulfillment_status.eq.unfulfilled,fulfillment_status.eq.partial,fulfillment_status.is.null")
        .order("shopify_created_at", { ascending: true })
        .limit(300);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      const now = Date.now();
      return (data ?? []).map(o => ({
        ...o,
        age_hours: Math.floor((now - new Date(o.shopify_created_at).getTime()) / 3_600_000),
        is_stale: now - new Date(o.shopify_created_at).getTime() > 48 * 3_600_000,
      })) as Order[];
    },
    refetchInterval: 5 * 60_000,
  });

  const filtered = data?.filter(o =>
    statusFilter === "all" ? true :
    statusFilter === "unfulfilled" ? (o.fulfillment_status === "unfulfilled" || o.fulfillment_status === null) :
    o.fulfillment_status === "partial"
  ) ?? [];

  const staleCount   = data?.filter(o => o.is_stale).length ?? 0;
  const partialCount = data?.filter(o => o.fulfillment_status === "partial").length ?? 0;
  const totalCount   = data?.length ?? 0;

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
            <PackageCheck className="h-6 w-6" /> Order Fulfillment
          </h1>
          <p className="text-sm text-muted-foreground">
            Unfulfilled and partially fulfilled orders — sorted oldest first
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => filtered.length && exportToCSV(
          filtered.map(o => ({
            "Order #": o.order_number,
            Customer: o.customer_email ?? "",
            Status: o.fulfillment_status ?? "unfulfilled",
            "Age (hrs)": o.age_hours,
            Stale: o.is_stale ? "Yes" : "No",
            "Total Value": o.total_price,
            "Created At": o.shopify_created_at,
          })),
          "unfulfilled-orders"
        )}>
          <Download className="h-4 w-4 mr-1" /> Export
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 shrink-0">
              <Package className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{totalCount}</div>
              <div className="text-xs text-muted-foreground">Total pending</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 shrink-0">
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{partialCount}</div>
              <div className="text-xs text-muted-foreground">Partially fulfilled</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 shrink-0">
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{staleCount}</div>
              <div className="text-xs text-muted-foreground">Stale (&gt;48h)</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {STATUS_FILTERS.map(f => (
          <Button
            key={f}
            variant={statusFilter === f ? "default" : "outline"}
            size="sm"
            className="capitalize"
            onClick={() => setStatusFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {!filtered.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <PackageCheck className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">All orders fulfilled</p>
          <p className="text-xs mt-1">No pending fulfillment actions</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Alert</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(o => (
                <TableRow key={o.id} className={o.is_stale ? "bg-red-50/40 dark:bg-red-950/10" : undefined}>
                  <TableCell className="font-mono font-medium">#{o.order_number}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {o.customer_email ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[11px] capitalize",
                        o.fulfillment_status === "partial"
                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400"
                          : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400"
                      )}
                    >
                      {o.fulfillment_status ?? "unfulfilled"}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn("font-mono text-sm", o.age_hours >= 48 ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground")}>
                    {o.age_hours < 24
                      ? `${o.age_hours}h ago`
                      : `${Math.floor(o.age_hours / 24)}d ${o.age_hours % 24}h ago`}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(o.total_price)}
                  </TableCell>
                  <TableCell>
                    {o.is_stale && (
                      <Badge variant="destructive" className="text-[10px]">
                        <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Stale
                      </Badge>
                    )}
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
