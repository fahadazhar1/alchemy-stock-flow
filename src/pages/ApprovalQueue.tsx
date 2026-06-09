import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatUAEDateTime } from "@/lib/timezone";
import { CheckSquare, RefreshCw, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useStore } from "@/contexts/StoreContext";
import { useCurrency } from "@/hooks/useCurrency";

interface CampaignItem {
  id: string;
  product_name: string | null;
  sku: string | null;
  old_price: number | null;
  new_price: number | null;
  action_status: string | null;
}

function CampaignProducts({ campaignId }: { campaignId: string }) {
  const { formatCurrency } = useCurrency();
  const { data, isLoading } = useQuery({
    queryKey: ["campaign-items", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pricing_campaign_items")
        .select(`
          id,
          old_price,
          new_price,
          action_status,
          variants ( variant_sku, products ( name ) )
        `)
        .eq("campaign_id", campaignId)
        .order("id");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        product_name: r.variants?.products?.name ?? null,
        sku: r.variants?.variant_sku ?? null,
        old_price: r.old_price,
        new_price: r.new_price,
        action_status: r.action_status,
      })) as CampaignItem[];
    },
  });

  if (isLoading) return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" /> Loading products…
    </div>
  );

  if (!data?.length) return (
    <div className="px-4 py-3 text-xs text-muted-foreground">No products found for this campaign.</div>
  );

  return (
    <div className="border-t bg-muted/30">
      <div className="px-4 py-2 text-xs font-semibold text-muted-foreground">{data.length} products</div>
      <div className="max-h-72 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="py-2">Product</TableHead>
              <TableHead className="py-2">SKU</TableHead>
              <TableHead className="py-2 text-right">Current Price</TableHead>
              <TableHead className="py-2 text-right">New Price</TableHead>
              <TableHead className="py-2 text-right">Change</TableHead>
              <TableHead className="py-2">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(item => {
              const change = item.old_price && item.new_price
                ? (((item.new_price - item.old_price) / item.old_price) * 100).toFixed(1)
                : null;
              return (
                <TableRow key={item.id} className="text-xs">
                  <TableCell className="py-1.5 font-medium max-w-[200px] truncate">{item.product_name ?? '—'}</TableCell>
                  <TableCell className="py-1.5 font-mono">{item.sku ?? '—'}</TableCell>
                  <TableCell className="py-1.5 text-right">{item.old_price != null ? formatCurrency(item.old_price) : '—'}</TableCell>
                  <TableCell className="py-1.5 text-right font-medium text-emerald-600">{item.new_price != null ? formatCurrency(item.new_price) : '—'}</TableCell>
                  <TableCell className="py-1.5 text-right">
                    {change != null && (
                      <span className={Number(change) < 0 ? "text-emerald-600" : "text-red-500"}>
                        {Number(change) > 0 ? "+" : ""}{change}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Badge variant="outline" className="text-[10px] py-0">{item.action_status ?? 'pending'}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CampaignRow({
  c, isPending, canEdit, symbol, formatCurrency,
  onApprove, onReject, onRetry,
}: {
  c: any; isPending: boolean; canEdit: boolean; symbol: string; formatCurrency: (n: number) => string;
  onApprove: (id: string) => void; onReject: (id: string) => void; onRetry: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const normalizeStatus = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();

  return (
    <>
      <TableRow>
        <TableCell>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 font-medium hover:underline text-left"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            {c.name}
          </button>
        </TableCell>
        {!isPending && (
          <TableCell>
            <Badge variant={
              normalizeStatus(c.workflow_status) === 'executed' ? 'default'
              : normalizeStatus(c.workflow_status) === 'rejected' ? 'destructive'
              : normalizeStatus(c.workflow_status) === 'pending approval' ? 'secondary'
              : 'outline'
            }>{c.workflow_status}</Badge>
          </TableCell>
        )}
        <TableCell>{c.action_type}</TableCell>
        <TableCell>{c.discount_percent ? `${c.discount_percent}%` : c.fixed_price ? `${symbol}${c.fixed_price}` : '-'}</TableCell>
        <TableCell className="text-xs">{formatUAEDateTime(c.created_at)}</TableCell>
        <TableCell className="text-right space-x-2">
          {isPending && canEdit && (
            <>
              <Button size="sm" onClick={() => onApprove(c.id)}>Approve & Execute</Button>
              <Button size="sm" variant="destructive" onClick={() => onReject(c.id)}>Reject</Button>
            </>
          )}
          {normalizeStatus(c.workflow_status) === 'executed' && (
            <Button size="sm" variant="outline" onClick={() => onRetry(c.id)}>
              <RefreshCw className="h-3 w-3 mr-1" /> Retry Push
            </Button>
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={isPending ? 5 : 6} className="p-0">
            <CampaignProducts campaignId={c.id} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ApprovalQueue() {
  const { canEdit } = useRole();
  const { symbol, formatCurrency } = useCurrency();
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
      toast.error("Shopify push failed: " + (data?.error ?? data?.failed?.[0] ?? pushErr?.message ?? "Unknown error"));
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
      toast.error("Shopify push failed: " + (data?.error ?? data?.failed?.[0] ?? pushErr?.message ?? "Unknown error"));
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

  const normalizeStatus = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
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
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map(c => (
                  <CampaignRow key={c.id} c={c} isPending canEdit={canEdit} symbol={symbol} formatCurrency={formatCurrency}
                    onApprove={handleApprove} onReject={handleReject} onRetry={handleRetryPush} />
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
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(others.length ? others : data ?? []).map(c => (
                <CampaignRow key={c.id} c={c} isPending={false} canEdit={canEdit} symbol={symbol} formatCurrency={formatCurrency}
                  onApprove={handleApprove} onReject={handleReject} onRetry={handleRetryPush} />
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
      {!data?.length && isAllStores && (
        <div className="text-center py-12 text-muted-foreground">
          <CheckSquare className="h-10 w-10 mx-auto mb-2 opacity-40" /><p>No campaigns in queue</p>
        </div>
      )}
    </div>
  );
}
