import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { exportToCSV } from "@/lib/export";
import { Truck, Download } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";

export default function Replenishment() {
  const { storeId } = useStoreFilter();
  const { data, isLoading } = useQuery({
    queryKey: ["replenishment", storeId],
    queryFn: async () => {
      let q = supabase.from("v_replenishment_candidates").select("*").order("available_units", { ascending: true }).limit(100);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-96" /></div>;

  const statusColor = (s: string) => s === 'Replenish Now' ? 'destructive' : s === 'Out of Stock' ? 'destructive' : s === 'Low Stock Winner' ? 'default' : 'secondary';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6" /> Replenishment</h1>
          <p className="text-sm text-muted-foreground">Winners at risk of stockout — protect high-performing products</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => data && exportToCSV(data.map(r => ({ Name: r.product_name, SKU: r.sku, Available: r.available_units, Velocity: r.velocity, Status: r.replenishment_status })), "replenishment")}><Download className="h-4 w-4 mr-1" />Export</Button>
      </div>
      {!data?.length ? (
        <div className="text-center py-12 text-muted-foreground"><Truck className="h-10 w-10 mx-auto mb-2 opacity-40" /><p>No replenishment alerts</p></div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="text-right">Velocity (7d)</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map(r => (
                <TableRow key={r.product_id}><TableCell className="font-medium">{r.product_name}</TableCell><TableCell className="font-mono text-xs">{r.sku}</TableCell><TableCell className="text-right font-mono">{r.available_units}</TableCell><TableCell className="text-right font-mono">{r.velocity}</TableCell><TableCell><Badge variant={statusColor(r.replenishment_status ?? '')}>{r.replenishment_status}</Badge></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
