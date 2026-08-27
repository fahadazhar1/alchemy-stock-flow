import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { exportToCSV } from "@/lib/export";
import { formatUAEDate } from "@/lib/timezone";
import { Clock, Download } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";

const PAGE_SIZE = 20;

export default function ExpiryMonitoring() {
  const { storeId } = useStoreFilter();
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["expiry", filter, page, storeId],
    queryFn: async () => {
      let q = supabase.from("v_product_inventory_summary").select("*", { count: "exact" });
      if (storeId) q = q.eq("store_id", storeId);
      if (filter === "expired") q = q.eq("near_expiry_status", "Expired");
      else if (filter === "expiring") q = q.eq("near_expiry_status", "Expiring Soon");
      else if (filter === "healthy") q = q.eq("near_expiry_status", "Healthy Shelf Life");
      else q = q.neq("near_expiry_status", "No Expiry");
      q = q.order("created_at", { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { data: data ?? [], count: count ?? 0 };
    },
  });

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Clock className="h-6 w-6" /> Expiry Monitoring</h1>
          <p className="text-sm text-muted-foreground">Track products approaching or past expiry dates</p>
        </div>
        <div className="flex gap-2">
          <Select value={filter} onValueChange={v => { setFilter(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Expiry</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="expiring">Expiring Soon</SelectItem>
              <SelectItem value="healthy">Healthy</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => data && exportToCSV(data.data.map(p => ({ Name: p.product_name, SKU: p.sku, Expiry: p.nearest_expiry_date, Status: p.near_expiry_status, Stock: p.total_inventory })), "expiry-monitoring")}><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>
      </div>

      {!data?.data.length ? (
        <div className="text-center py-12 text-muted-foreground"><Clock className="h-10 w-10 mx-auto mb-2 opacity-40" /><p>No expiry-tracked products found</p></div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Expiry Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Stock</TableHead><TableHead>Pricing</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.data.map(p => (
                  <TableRow key={p.product_id}>
                    <TableCell className="font-medium">{p.product_name}</TableCell>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="text-xs">{p.nearest_expiry_date ? formatUAEDate(p.nearest_expiry_date) : '-'}</TableCell>
                    <TableCell><Badge variant={p.near_expiry_status === 'Expired' ? 'destructive' : p.near_expiry_status === 'Expiring Soon' ? 'outline' : 'secondary'}>{p.near_expiry_status}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{p.total_inventory}</TableCell>
                    <TableCell><Badge variant={p.discount_status === 'discounted' ? 'default' : 'secondary'}>{p.discount_status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{data.count} products</span>
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
