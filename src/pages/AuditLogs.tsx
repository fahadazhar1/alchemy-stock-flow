import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUAEDateTime } from "@/lib/timezone";
import { exportToCSV } from "@/lib/export";
import { useState } from "react";
import { Download, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";

const PAGE_SIZE = 20;

export default function AuditLogs() {
  const { storeId } = useStoreFilter();
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page, storeId],
    queryFn: async () => {
      let q = supabase
        .from("inventory_sync_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error, count } = await q;
      if (error) throw error;
      return { data: data ?? [], count: count ?? 0 };
    },
  });

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;
  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" /> Audit Logs</h1>
          <p className="text-sm text-muted-foreground">Complete history of all pricing and inventory actions</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => data && exportToCSV(data.data.map(l => ({
          Timestamp: l.created_at ? formatUAEDateTime(l.created_at) : '', Action: l.action_type, Campaign: l.campaign_name, Items: l.items_affected, Status: l.status
        })), "audit-logs")}><Download className="h-4 w-4 mr-1" />Export</Button>
      </div>

      {!data?.data.length ? (
        <div className="text-center py-12 text-muted-foreground"><FileText className="h-10 w-10 mx-auto mb-2 opacity-40" /><p>No audit logs yet</p></div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Timestamp (UAE)</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map(l => (
                  <>
                    <TableRow key={l.id} className="cursor-pointer" onClick={() => toggleExpand(l.id)}>
                      <TableCell>{expanded.has(l.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                      <TableCell className="text-xs">{l.created_at ? formatUAEDateTime(l.created_at) : '-'}</TableCell>
                      <TableCell><Badge variant="outline">{l.action_type}</Badge></TableCell>
                      <TableCell>{l.campaign_name || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{l.items_affected}</TableCell>
                      <TableCell><Badge variant={l.status === 'Success' ? 'default' : 'destructive'}>{l.status}</Badge></TableCell>
                    </TableRow>
                    {expanded.has(l.id) && (
                      <TableRow key={`${l.id}-meta`}>
                        <TableCell colSpan={6} className="bg-muted/50">
                          <pre className="text-xs overflow-auto max-h-32 p-2">{JSON.stringify(l.metadata, null, 2)}</pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{data.count} total entries</span>
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
