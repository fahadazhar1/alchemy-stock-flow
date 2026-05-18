import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUAEDate } from "@/lib/timezone";
import { exportToCSV } from "@/lib/export";
import { BarChart3, Download, Power, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCurrency } from "@/hooks/useCurrency";

export default function CampaignPerformance() {
  const { symbol } = useCurrency();
  const queryClient = useQueryClient();
  const { storeId } = useStoreFilter();

  const { data, isLoading } = useQuery({
    queryKey: ["campaign-performance-all", storeId],
    queryFn: async () => {
      try {
        let q = supabase
          .from("pricing_campaigns")
          .select("*, pricing_campaign_items(count)")
          .order("created_at", { ascending: false });
        if (storeId) q = q.eq("store_id", storeId);
        const { data, error } = await q;
        if (error) throw error;
        return data ?? [];
      } catch (e) {
        console.error("Campaign load error:", e);
        return [];
      }
    },
  });

  const handleDeactivate = async (campaignId: string, currentStatus: string) => {
    try {
      if (currentStatus === "Executed") {
        const { error: rpcError } = await supabase.rpc("revert_variant_pricing", { p_campaign_id: campaignId });
        if (rpcError) throw rpcError;
        const { data, error: pushErr } = await supabase.functions.invoke("shopify-sync", {
          body: { action: "revert_prices", campaign_id: campaignId },
        });
        if (pushErr || (data && !data.ok)) {
          const msg = data?.error ?? data?.errors?.[0] ?? pushErr?.message ?? "Unknown error";
          toast.warning("Campaign ended but Shopify revert failed: " + msg);
        }
      }
      const { error } = await supabase.from("pricing_campaigns")
        .update({ workflow_status: "Ended", ended_at: new Date().toISOString() })
        .eq("id", campaignId);
      if (error) throw error;
      toast.success(currentStatus === "Executed" ? "Campaign ended and prices reverted on Shopify" : "Campaign deactivated");
      queryClient.invalidateQueries({ queryKey: ["campaign-performance-all"] });
    } catch { toast.error("Failed to deactivate campaign"); }
  };

  const handleRemoveDiscounts = async (campaignId: string, campaignName: string) => {
    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc("revert_variant_pricing", { p_campaign_id: campaignId });
      if (rpcError) throw rpcError;
      const revertedCount = Number((rpcResult as Record<string, unknown>)?.affected_count || 0);
      toast.success(`Reverted ${revertedCount} variants — pushing original prices to Shopify…`);
      const { data, error: pushErr } = await supabase.functions.invoke("shopify-sync", {
        body: { action: "revert_prices", campaign_id: campaignId },
      });
      if (pushErr || (data && !data.ok)) {
        const msg = data?.error ?? data?.errors?.[0] ?? pushErr?.message ?? "Unknown error";
        toast.error("Shopify revert failed: " + msg);
      } else {
        toast.success(`Original prices restored on Shopify — ${data?.pushed ?? 0} variants updated`);
      }
    } catch { toast.error("Failed to remove discounts"); }
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Campaign Performance</h1>
          <p className="text-sm text-muted-foreground">All campaigns — manual, automated, AI-triggered, and approval-based</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => data && exportToCSV(data.map(c => ({
          Name: c.name, Status: c.workflow_status, Type: c.action_type,
          Discount: c.discount_percent, FixedPrice: c.fixed_price,
          PreInventory: c.pre_campaign_inventory, PostInventory: c.post_campaign_inventory,
          Reduction: c.inventory_reduction, Created: c.created_at,
        })), "all-campaigns")}><Download className="h-4 w-4 mr-1" />Export</Button>
      </div>

      {!data?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-40" /><p>No campaigns yet</p>
        </CardContent></Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
                <TableHead>Created</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead>
                <TableHead className="text-right">Discount</TableHead><TableHead className="text-right">Pre-Inv</TableHead>
                <TableHead className="text-right">Post-Inv</TableHead><TableHead className="text-right">Reduction</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(c => {
                const canEnd = c.workflow_status === "Executed" || c.workflow_status === "Pending Approval" || c.workflow_status === "Approved";
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.action_type}</Badge></TableCell>
                    <TableCell><Badge variant={c.workflow_status === 'Executed' ? 'default' : c.workflow_status === 'Rejected' ? 'destructive' : c.workflow_status === 'Ended' ? 'secondary' : 'outline'}>{c.workflow_status}</Badge></TableCell>
                    <TableCell className="text-xs">{c.created_at ? formatUAEDate(c.created_at) : '-'}</TableCell>
                    <TableCell className="text-xs">{c.started_at ? formatUAEDate(c.started_at) : '-'}</TableCell>
                    <TableCell className="text-xs">{c.ended_at ? formatUAEDate(c.ended_at) : '-'}</TableCell>
                    <TableCell className="text-right font-mono">{c.discount_percent ? `${c.discount_percent}%` : c.fixed_price ? `${symbol}${c.fixed_price}` : '-'}</TableCell>
                    <TableCell className="text-right font-mono">{c.pre_campaign_inventory?.toLocaleString() || '-'}</TableCell>
                    <TableCell className="text-right font-mono">{c.post_campaign_inventory?.toLocaleString() || '-'}</TableCell>
                    <TableCell className="text-right font-mono">{c.inventory_reduction?.toLocaleString() || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {canEnd && <Button variant="ghost" size="sm" onClick={() => handleDeactivate(c.id, c.workflow_status)} title="End campaign"><Power className="h-3 w-3" /></Button>}
                        {(c.workflow_status === "Executed" || c.workflow_status === "Ended") && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleRemoveDiscounts(c.id, c.name)} title="Revert all discounts"><XCircle className="h-3 w-3" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
