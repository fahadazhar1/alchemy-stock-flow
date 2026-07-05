import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUAEDateTime } from "@/lib/timezone";
import { exportToCSV } from "@/lib/export";
import { Download, History, Search, ArrowUp, ArrowDown } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";

const PAGE_SIZE = 20;

interface AdjustmentRow {
  id: string;
  created_at: string;
  product_name: string | null;
  variant_sku: string;
  adjustment: number;
  quantity_before: number;
  quantity_after: number;
  location_name: string | null;
  adjusted_by: string | null;
}

export default function InventoryAdjustments() {
  const { storeId } = useStoreFilter();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["stock-adjustment-history", page, search, storeId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("stock_adjustment_history")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (storeId) q = q.eq("store_id", storeId);
      if (search.trim()) {
        q = q.or(`variant_sku.ilike.%${search.trim()}%,product_name.ilike.%${search.trim()}%`);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { data: (data ?? []) as AdjustmentRow[], count: count ?? 0 };
    },
  });

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><History className="h-6 w-6" /> Inventory Adjustments</h1>
          <p className="text-sm text-muted-foreground">History of every manual stock adjustment made from Product Master</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => data && exportToCSV(data.data.map(r => ({
            Timestamp: formatUAEDateTime(r.created_at),
            Product: r.product_name ?? "",
            SKU: r.variant_sku,
            Adjustment: r.adjustment,
            Before: r.quantity_before,
            After: r.quantity_after,
            Location: r.location_name ?? "",
            "Adjusted By": r.adjusted_by ?? "",
          })), "inventory-adjustments")}
        >
          <Download className="h-4 w-4 mr-1" />Export
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by product or SKU..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="pl-8"
        />
      </div>

      {!data?.data.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <History className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>No stock adjustments yet</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Adjustment</TableHead>
                  <TableHead className="text-right">Before → After</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Adjusted By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{formatUAEDateTime(r.created_at)}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{r.product_name || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.variant_sku}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={r.adjustment > 0 ? "default" : "destructive"} className="font-mono gap-1">
                        {r.adjustment > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                        {r.adjustment > 0 ? "+" : ""}{r.adjustment}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.quantity_before} → {r.quantity_after}</TableCell>
                    <TableCell className="text-sm">{r.location_name || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.adjusted_by || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{data.count} total adjustments</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <span className="text-sm flex items-center px-2">{page + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
