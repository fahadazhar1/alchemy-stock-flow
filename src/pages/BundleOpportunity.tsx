import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportToCSV } from "@/lib/export";
import { PackageOpen, Download, Link2, TrendingUp, ShoppingBag, HelpCircle, Bookmark, CheckCircle2, BookmarkCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";

type BundlePair = {
  product_a_id: string;
  product_a_name: string;
  product_a_sku: string;
  product_b_id: string;
  product_b_name: string;
  product_b_sku: string;
  co_occurrence_count: number;
  estimated_bundle_revenue: number;
};

type BundleSuggestion = BundlePair & {
  id: string;
  store_id: string;
  saved_at: string;
  executed_at: string | null;
};

export default function BundleOpportunity() {
  const { storeId } = useStoreFilter();
  const { formatCurrency } = useCurrency();
  const [minCount, setMinCount] = useState(3);
  const [savedOpen, setSavedOpen] = useState(false);
  const [showExecuted, setShowExecuted] = useState(false);
  const queryClient = useQueryClient();

  const { data: savedBundles } = useQuery({
    queryKey: ["bundle-suggestions", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bundle_suggestions" as any)
        .select("*")
        .order("saved_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BundleSuggestion[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (pair: BundlePair) => {
      const { error } = await supabase.from("bundle_suggestions" as any).insert({
        store_id: storeId,
        product_a_id: pair.product_a_id,
        product_a_name: pair.product_a_name,
        product_a_sku: pair.product_a_sku,
        product_b_id: pair.product_b_id,
        product_b_name: pair.product_b_name,
        product_b_sku: pair.product_b_sku,
        co_occurrence_count: pair.co_occurrence_count,
        estimated_bundle_revenue: pair.estimated_bundle_revenue,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bundle-suggestions", storeId] });
      toast.success("Bundle suggestion saved!");
    },
    onError: () => toast.error("Failed to save bundle suggestion"),
  });

  const executeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bundle_suggestions" as any)
        .update({ executed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bundle-suggestions", storeId] });
      toast.success("Bundle marked as executed!");
    },
    onError: () => toast.error("Failed to update bundle"),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bundle_suggestions" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bundle-suggestions", storeId] });
      toast.success("Bundle removed.");
    },
    onError: () => toast.error("Failed to remove bundle"),
  });

  const activeSaved = savedBundles?.filter(s => !s.executed_at) ?? [];
  const filteredSaved = showExecuted ? savedBundles ?? [] : activeSaved;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["bundle-opportunities", storeId, minCount],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_bundle_opportunities", {
        p_store_id: storeId ?? null,
        p_min_count: minCount,
      });
      if (error) throw error;
      return (data ?? []) as BundlePair[];
    },
  });

  const maxCount = data?.[0]?.co_occurrence_count ?? 1;

  if (isLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageOpen className="h-6 w-6" /> Bundle Opportunity Finder
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground">
                  <HelpCircle className="h-4 w-4 mr-1" /> How it works?
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-sm" align="start">
                <p className="font-semibold mb-2">How Bundle Finder works</p>
                <ul className="space-y-1.5 text-muted-foreground list-disc list-inside">
                  <li>Looks at all orders from the <span className="text-foreground font-medium">last 90 days</span></li>
                  <li>Finds products bought <span className="text-foreground font-medium">together in the same order</span></li>
                  <li><span className="text-foreground font-medium">Min. co-purchases</span> hides weak pairs — raise it for stronger signals only</li>
                  <li><span className="text-foreground font-medium">Bundle strength</span> ranks each pair against the top pair (top pair = 100%)</li>
                  <li><span className="text-foreground font-medium">Avg revenue</span> is the combined spend when both products are bought together</li>
                  <li>Use these insights to create <span className="text-foreground font-medium">bundles or promotions</span> on your store</li>
                </ul>
              </PopoverContent>
            </Popover>
          </h1>
          <p className="text-sm text-muted-foreground">
            Products frequently bought together in the last 90 days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSavedOpen(true)}>
            <BookmarkCheck className="h-4 w-4 mr-1" />
            View Saved Bundles
            {activeSaved.length > 0 && (
              <Badge variant="default" className="ml-1.5 h-4 px-1.5 text-[10px]">{activeSaved.length}</Badge>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => data?.length && exportToCSV(
            data.map(p => ({
              "Product A": p.product_a_name,
              "SKU A": p.product_a_sku,
              "Product B": p.product_b_name,
              "SKU B": p.product_b_sku,
              "Times Bought Together": p.co_occurrence_count,
              "Avg Bundle Revenue": p.estimated_bundle_revenue,
            })),
            "bundle-opportunities"
          )}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Min. co-purchases</Label>
          <Input
            type="number"
            min="1"
            className="h-8 w-20"
            value={minCount}
            onChange={e => setMinCount(Math.max(1, Number(e.target.value)))}
          />
          <Button size="sm" variant="outline" onClick={() => refetch()}>Apply</Button>
        </div>
        {data && (
          <Badge variant="secondary" className="text-xs">
            {data.length} bundle pair{data.length !== 1 ? "s" : ""} found
          </Badge>
        )}
      </div>

      {!data?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <PackageOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No bundle opportunities found</p>
          <p className="text-xs mt-1">Try lowering the minimum co-purchase count</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.map((pair, idx) => {
            const strength = Math.round((pair.co_occurrence_count / maxCount) * 100);
            return (
              <Card key={`${pair.product_a_id}-${pair.product_b_id}`} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">

                  <div className="flex items-center justify-between">
                    <Badge variant="secondary" className="text-[11px] font-medium">
                      #{idx + 1}
                    </Badge>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ShoppingBag className="h-3 w-3" />
                      <span className="font-semibold text-foreground">{pair.co_occurrence_count}×</span> together
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/50">
                      <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold text-primary">A</div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug line-clamp-2">{pair.product_a_name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{pair.product_a_sku}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 px-2">
                      <div className="h-px flex-1 bg-border" />
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="h-px flex-1 bg-border" />
                    </div>

                    <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/50">
                      <div className="h-6 w-6 rounded bg-secondary/50 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold">B</div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug line-clamp-2">{pair.product_b_name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{pair.product_b_sku}</p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-1 border-t flex items-center justify-between">
                    <div className="space-y-1 flex-1 mr-4">
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>Bundle strength</span>
                        <span>{strength}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${strength}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                        <TrendingUp className="h-3 w-3" /> Avg revenue
                      </div>
                      <div className="font-bold text-sm">{formatCurrency(Number(pair.estimated_bundle_revenue))}</div>
                    </div>
                  </div>

                  {(() => {
                    const already = savedBundles?.find(
                      s => s.product_a_id === pair.product_a_id && s.product_b_id === pair.product_b_id && !s.executed_at
                    );
                    return already ? (
                      <Button size="sm" variant="secondary" className="w-full text-xs h-7" disabled>
                        <Bookmark className="h-3 w-3 mr-1 fill-current" /> Saved
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs h-7"
                        disabled={saveMutation.isPending}
                        onClick={() => saveMutation.mutate(pair)}
                      >
                        <Bookmark className="h-3 w-3 mr-1" /> Save Bundle Suggestion
                      </Button>
                    );
                  })()}

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={savedOpen} onOpenChange={setSavedOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookmarkCheck className="h-5 w-5" /> Saved Bundle Suggestions
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-muted-foreground">
              {activeSaved.length} active · {(savedBundles?.filter(s => s.executed_at)?.length ?? 0)} executed
            </span>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Show executed</span>
              <Switch checked={showExecuted} onCheckedChange={setShowExecuted} />
            </div>
          </div>

          <div className="overflow-y-auto flex-1 space-y-3 py-2 pr-1">
            {filteredSaved.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Bookmark className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No saved bundles yet</p>
              </div>
            ) : filteredSaved.map(s => (
              <div key={s.id} className={`rounded-lg border p-3 space-y-2 ${s.executed_at ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.product_a_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{s.product_a_sku}</p>
                    <p className="text-[11px] text-muted-foreground">+</p>
                    <p className="text-sm font-medium truncate">{s.product_b_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{s.product_b_sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{s.co_occurrence_count}× together</p>
                    <p className="text-sm font-bold">{formatCurrency(Number(s.estimated_bundle_revenue))}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t">
                  {s.executed_at ? (
                    <Badge variant="secondary" className="text-[11px]">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Executed
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={executeMutation.isPending}
                      onClick={() => executeMutation.mutate(s.id)}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Mark as Executed
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(s.id)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {filteredSaved.length > 0 && (
            <div className="pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => exportToCSV(
                  filteredSaved.map(s => ({
                    "Product A": s.product_a_name,
                    "SKU A": s.product_a_sku,
                    "Product B": s.product_b_name,
                    "SKU B": s.product_b_sku,
                    "Times Bought Together": s.co_occurrence_count,
                    "Avg Bundle Revenue": s.estimated_bundle_revenue,
                    "Status": s.executed_at ? "Executed" : "Active",
                  })),
                  "saved-bundle-suggestions"
                )}
              >
                <Download className="h-4 w-4 mr-1" /> Export Saved
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
