import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatUAEDateTime } from "@/lib/timezone";
import { CheckSquare, RefreshCw } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useStore } from "@/contexts/StoreContext";
import { useCurrency } from "@/hooks/useCurrency";

export default function ApprovalQueue() {
  const { canEdit } = useRole();
  const { symbol } = useCurrency();
  const queryClient = useQueryClient();
  const { storeId } = useStoreFilter();
  const { isAllStores } = useStore();
  const { data, isLoading } = useQuery({
    queryKey: ["approval-queue", storeId],
    queryFn: async () => {
      let q = supabase.from("pricing_campaigns").select("*").order("created_at", { ascending: false });
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleApprove = async (id: string) => {
    const { error } = await supabase.rpc("approve_and_execute_campaign", { p_campaign_id: id });
    if (error) { toast.error("Approval failed: " + error.message); return; }
    toast.success("Campaign approved — pushing prices to Shopify…");
    queryClient.invalidateQueries();

    const { data, error: pushErr } = await supabase.functions.invoke("shopify-sync", {
      body: { action: "push_prices", campaign_id: id },
    });
    if (pushErr || (data && !data.ok)) {
      const msg = data?.error ?? data?.failed?.[0] ?? pushErr?.message ?? "Unknown error";
      toast.error("Shopify push failed: " + msg);
      return;
    }
    toast.success(`Prices live on Shopify — ${data?.pushed ?? 0} variants updated`);
  };

  const handleRetryPush = async (id: string) => {
    toast.info("Retrying Shopify push…");
    const { data, error: pushErr } = await supabase.functions.invoke("shopify-sync", {
      body: { action: "push_prices", campaign_id: id },
    });
    if (pushErr || (data && !data.ok)) {
      const msg = data?.error ?? data?.failed?.[0] ?? pushErr?.message ?? "Unknown error";
      toast.error("Shopify push failed: " + msg);
      return;
    }
    toast.success(`Prices live on Shopify — ${data?.pushed ?? 0} variants updated`);
  };

  const handleReject = async (id: string) => {
    const { error } = await supabase.from("pricing_campaigns").update({ workflow_status: "Rejected", rejected_at: new Date().toISOString(), rejection_reason: "Rejected by manager" }).eq("id", id);
    if (error) { toast.error("Rejection failed"); return; }
    toast.success("Campaign rejected");
    queryClient.invalidateQueries();
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-96" /></div>;

  const normalizeStatus = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();
  const statusColor = (s: string | null | undefined) => {
    const status = normalizeStatus(s);
    return status === 'executed' ? 'default' : status === 'rejected' ? 'destructive' : status === 'pending approval' ? 'secondary' : 'outline';
  };
  const pending = data?.filter(c => normalizeStatus(c.workflow_status) === 'pending approval') ?? [];
  const others = data?.filter(c => normalizeStatus(c.workflow_status) !== 'pending approval') ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><CheckSquare className="h-6 w-6" /> Approval Queue</h1>
        <p className="text-sm text-muted-foreground">Review and approve pricing campaigns before live execution</p>
      </div>

      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-amber-600 mb-2">⏳ Pending Approval ({pending.length})</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Type</TableHead><TableHead>Discount</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {pending.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.action_type}</TableCell>
                    <TableCell>{c.discount_percent ? `${c.discount_percent}%` : c.fixed_price ? `${symbol}${c.fixed_price}` : '-'}</TableCell>
                    <TableCell className="text-xs">{formatUAEDateTime(c.created_at)}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" onClick={() => handleApprove(c.id)} disabled={!canEdit}>Approve & Execute</Button>
                      <Button size="sm" variant="destructive" onClick={() => handleReject(c.id)} disabled={!canEdit}>Reject</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">All Campaigns</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead>Type</TableHead><TableHead>Discount</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {(others.length ? others : data ?? []).map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell><Badge variant={statusColor(c.workflow_status ?? '')}>{c.workflow_status}</Badge></TableCell>
                  <TableCell>{c.action_type}</TableCell>
                  <TableCell>{c.discount_percent ? `${c.discount_percent}%` : '-'}</TableCell>
                  <TableCell className="text-xs">{formatUAEDateTime(c.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {normalizeStatus(c.workflow_status) === 'executed' && (
                      <Button size="sm" variant="outline" onClick={() => handleRetryPush(c.id)}>
                        <RefreshCw className="h-3 w-3 mr-1" /> Retry Push
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {(!data?.length && !isAllStores) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          No campaigns found for the selected store. Switch to "All Stores" to view approvals across every store.
        </div>
      )}

      {!data?.length && isAllStores && <div className="text-center py-12 text-muted-foreground"><CheckSquare className="h-10 w-10 mx-auto mb-2 opacity-40" /><p>No campaigns in queue</p></div>}
    </div>
  );
}
