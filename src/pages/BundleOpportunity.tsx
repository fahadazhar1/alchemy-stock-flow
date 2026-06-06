import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportToCSV } from "@/lib/export";
import { PackageOpen, Download, Link2, TrendingUp, ShoppingBag } from "lucide-react";
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

export default function BundleOpportunity() {
  const { storeId } = useStoreFilter();
  const { formatCurrency } = useCurrency();
  const [minCount, setMinCount] = useState(3);

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
          </h1>
          <p className="text-sm text-muted-foreground">
            Products frequently bought together in the last 90 days
          </p>
        </div>
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

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs h-7"
                    onClick={() => toast.success(`Bundle suggestion saved: ${pair.product_a_name} + ${pair.product_b_name}`)}
                  >
                    Save Bundle Suggestion
                  </Button>

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
