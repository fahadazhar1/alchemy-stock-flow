import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { FlaskConical, ShieldCheck, AlertTriangle, Zap, TrendingUp, TrendingDown, Target, Warehouse } from "lucide-react";
import { Json } from "@/integrations/supabase/types";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCentralInventoryKPIs } from "@/hooks/useCentralInventory";

interface Scenario {
  discount_percent: number;
  projected_revenue: number;
  revenue_impact: number;
  projected_sell_through_improvement: number;
  projected_inventory_reduction: number;
  margin_pressure: number;
}

function getConfidence(discount: number, baseInventory: number): { label: string; color: string } {
  if (discount <= 10 && baseInventory > 100) return { label: "High Confidence", color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30" };
  if (discount <= 20) return { label: "Medium Confidence", color: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30" };
  return { label: "Risky", color: "text-destructive bg-destructive/10 border-destructive/30" };
}

function getRiskWarnings(s: Scenario, baseInventory: number): string[] {
  const warnings: string[] = [];
  if (s.margin_pressure > 20) warnings.push("Aggressive discount may significantly reduce margins");
  if (s.projected_inventory_reduction > baseInventory * 0.4) warnings.push("Large projected stock movement — verify demand");
  if (s.discount_percent >= 25) warnings.push("Deep discount tier — consider staged approach");
  if (baseInventory < 50) warnings.push("Low stock — discount may not be needed");
  return warnings;
}

export default function Simulation() {
  const { formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const { storeId, isAllStores } = useStoreFilter();
  const { data: centralKPIs } = useCentralInventoryKPIs();
  const [productCount, setProductCount] = useState("50");
  const [results, setResults] = useState<Json | null>(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);

  const { data: products } = useQuery({
    queryKey: ["sim-products", storeId],
    queryFn: async () => {
      let q = supabase.from("v_loser_products").select("product_id").limit(200);
      if (storeId) q = q.eq("store_id", storeId);
      const { data } = await q;
      return (data ?? []).map(p => p.product_id).filter(Boolean) as string[];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("*").eq("setting_key", "pricing_config").maybeSingle();
      return (data?.setting_value ?? null) as Record<string, unknown> | null;
    },
  });

  const requireApproval = (settings?.require_approval as boolean) ?? true;

  const runSimulation = async () => {
    if (!products?.length) { toast.error("No products available"); return; }
    setRunning(true);
    try {
      const ids = products.slice(0, Number(productCount));
      const { data, error } = await supabase.rpc("preview_what_if_simulation", {
        p_product_ids: ids,
        p_discount_tiers: [10, 15, 20, 25],
        p_rounding_mode: "whole",
      });
      if (error) throw error;
      setResults(data);

      await supabase.from("simulation_logs").insert({
        simulation_name: `What-If ${new Date().toLocaleDateString('en-AE')}`,
        input_payload: { products: ids.length, tiers: [10, 15, 20, 25] } as unknown as Json,
        result_payload: data as Json,
      });
    } catch {
      toast.error("Simulation failed");
    } finally {
      setRunning(false);
    }
  };

  const handleApplyScenario = async (discountPercent: number) => {
    if (!products?.length) return;
    setApplying(discountPercent);
    try {
      const ids = products.slice(0, Number(productCount));
      if (requireApproval) {
        const { error } = await supabase.rpc("create_campaign_draft", {
          p_product_ids: ids,
          p_discount_percent: discountPercent,
          p_campaign_name: `Simulation ${discountPercent}% — ${new Date().toLocaleDateString('en-AE')}`,
          p_overwrite_existing: false,
          p_rounding_mode: "whole",
          p_source: "simulation",
          p_store_id: storeId,
        });
        if (error) throw error;
        toast.success(`Campaign draft created for ${discountPercent}% — pending approval`);
        if (isAllStores) {
          toast.info("Draft created without a specific store selected. It will appear in the All Stores approval queue.");
        }
      } else {
        const { error } = await supabase.rpc("apply_bulk_discount", {
          p_product_ids: ids,
          p_discount_percent: discountPercent,
          p_campaign_name: `Simulation ${discountPercent}% — ${new Date().toLocaleDateString('en-AE')}`,
          p_overwrite_existing: false,
          p_rounding_mode: "whole",
        });
        if (error) throw error;
        toast.success(`${discountPercent}% discount applied to ${ids.length} products`);
      }
      queryClient.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message || "Failed to apply scenario");
    } finally {
      setApplying(null);
    }
  };

  const r = results as Record<string, unknown> | null;
  const scenarios = (r?.scenarios as unknown as Scenario[]) ?? undefined;
  const baseInventory = Number(r?.base_inventory ?? 0);
  const baseRevenue = Number(r?.base_revenue ?? 0);

  // Find best scenario (highest sell-through with lowest margin pressure)
  const bestIdx = scenarios ? scenarios.reduce((best, s, i) => {
    const score = s.projected_sell_through_improvement - s.margin_pressure * 0.5;
    const bestScore = scenarios[best].projected_sell_through_improvement - scenarios[best].margin_pressure * 0.5;
    return score > bestScore ? i : best;
  }, 0) : -1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical className="h-6 w-6" /> Strategy Lab <Badge variant="outline" className="text-[10px] ml-2">What-If Simulation</Badge></h1>
        <p className="text-sm text-muted-foreground">Multi-scenario comparison with profit awareness & direct apply</p>
      </div>

      {/* Safe Mode Banner */}
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-emerald-700 dark:text-emerald-400">Simulation Mode — Safe Preview</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This is <strong>NOT</strong> live pricing. No database changes occur until you explicitly apply a scenario. Results show projected outcomes based on discount tiers applied to loser products.
              </p>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-500" /> No prices changed</span>
                <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-500" /> No campaigns created</span>
                <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-500" /> Read-only until you click Apply</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configure */}
      <Card>
        <CardHeader><CardTitle className="text-base">Configure Simulation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end">
            <div>
              <Label>Products to simulate</Label>
              <Input type="number" value={productCount} onChange={e => setProductCount(e.target.value)} className="w-32" />
            </div>
            <div><Badge variant="secondary">Tiers: 10%, 15%, 20%, 25%</Badge></div>
            <Button onClick={runSimulation} disabled={running}>{running ? "Running..." : "Run Simulation"}</Button>
          </div>
          {r && (
            <div className="flex gap-6 text-sm text-muted-foreground">
              <span>Base inventory: <strong className="text-foreground">{baseInventory.toLocaleString()}</strong> units</span>
              <span>Base revenue: <strong className="text-foreground">{formatCurrency(baseRevenue)}</strong></span>
              {centralKPIs && (
                <span className="flex items-center gap-1"><Warehouse className="h-3 w-3" /> Central pool: <strong className="text-foreground">{centralKPIs.totalAvailable.toLocaleString()}</strong> units</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scenario Cards */}
      {scenarios && (
        <>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Target className="h-5 w-5" /> Scenario Comparison
            <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-400">SIMULATION ONLY</Badge>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {scenarios.map((s, i) => {
              const conf = getConfidence(s.discount_percent, baseInventory);
              const warnings = getRiskWarnings(s, baseInventory);
              const isBest = i === bestIdx;
              return (
                <Card key={i} className={`relative transition-all hover:shadow-md ${isBest ? "border-primary/50 ring-1 ring-primary/20" : ""}`}>
                  {isBest && <div className="absolute -top-2.5 left-3"><Badge className="text-[10px] bg-primary">Recommended</Badge></div>}
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold">{s.discount_percent}%</span>
                      <Badge variant="outline" className={`text-[10px] ${conf.color}`}>{conf.label}</Badge>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Projected Revenue</span><span className="font-mono font-medium">{formatCurrency(s.projected_revenue)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Revenue Impact</span><span className="font-mono text-destructive">-{formatCurrency(s.revenue_impact)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Sell-Through ↑</span><span className="font-mono text-emerald-600 dark:text-emerald-400">+{s.projected_sell_through_improvement}%</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Inv Reduction</span><span className="font-mono">{s.projected_inventory_reduction.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Margin Pressure</span><span className="font-mono text-amber-600">{s.margin_pressure}%</span></div>
                    </div>

                    {/* Risk Warnings */}
                    {warnings.length > 0 && (
                      <div className="space-y-1">
                        {warnings.map((w, wi) => (
                          <div key={wi} className="flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      size="sm"
                      className="w-full"
                      variant={isBest ? "default" : "outline"}
                      disabled={applying !== null}
                      onClick={() => handleApplyScenario(s.discount_percent)}
                    >
                      <Zap className="h-3 w-3 mr-1" />
                      {applying === s.discount_percent ? "Applying..." : "Apply This Scenario"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Detail Table */}
          <Card>
            <CardHeader><CardTitle className="text-base">Detailed Comparison</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Discount</TableHead>
                    <TableHead className="text-right">Projected Revenue</TableHead>
                    <TableHead className="text-right">Revenue Impact</TableHead>
                    <TableHead className="text-right">Sell-Through ↑</TableHead>
                    <TableHead className="text-right">Inv Reduction</TableHead>
                    <TableHead className="text-right">Margin Pressure</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenarios.map((s, i) => {
                    const conf = getConfidence(s.discount_percent, baseInventory);
                    return (
                      <TableRow key={i} className={i === bestIdx ? "bg-primary/5" : ""}>
                        <TableCell><Badge variant="outline">{s.discount_percent}%</Badge>{i === bestIdx && <Badge className="ml-1 text-[9px]">Best</Badge>}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(s.projected_revenue)}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">-{formatCurrency(s.revenue_impact)}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">+{s.projected_sell_through_improvement}%</TableCell>
                        <TableCell className="text-right font-mono">{s.projected_inventory_reduction.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-amber-600">{s.margin_pressure}%</TableCell>
                        <TableCell className="text-right"><Badge variant="outline" className={`text-[10px] ${conf.color}`}>{conf.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
