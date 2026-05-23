import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Brain, Zap, TrendingDown, ShieldAlert, Award, AlertTriangle, ArrowDown, Sparkles, Target, Shield, Percent, Warehouse } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCentralInventoryKPIs } from "@/hooks/useCentralInventory";

type ActionType = "Apply Discount" | "Increase Discount" | "Remove Discount" | "Protect Product";

interface EnrichedRec {
  id: string;
  product_id: string | null;
  product_name: string;
  sku: string;
  recommendation_type: string;
  reason: string;
  suggested_discount_percent: number | null;
  suggested_new_price: number | null;
  current_price: number | null;
  inventory_qty: number;
  inventory_value: number;
  days_old: number;
  velocity_7d: number;
  velocity_30d: number;
  expiry_days: number | null;
  priority: "high" | "medium" | "low";
  action_type: ActionType;
  business_reasons: string[];
  expected_sell_through_improvement: number;
  expected_inventory_reduction: number;
  expected_revenue_impact: number;
}

function getPriority(invValue: number, daysOld: number, velocity7d: number, expiryDays: number | null): "high" | "medium" | "low" {
  let score = 0;
  if (invValue > 5000) score += 3;
  else if (invValue > 2000) score += 2;
  else score += 1;
  if (daysOld > 30) score += 3;
  else if (daysOld > 14) score += 2;
  else score += 1;
  if (velocity7d === 0) score += 2;
  else if (velocity7d < 3) score += 1;
  if (expiryDays !== null && expiryDays < 15) score += 3;
  if (score >= 8) return "high";
  if (score >= 5) return "medium";
  return "low";
}

function getActionType(recType: string, hasDiscount: boolean): ActionType {
  if (recType === "Low Stock Winner") return "Protect Product";
  if (hasDiscount && ["Stale Stock", "High Dead Capital"].includes(recType)) return "Increase Discount";
  if (recType === "Low Stock Winner") return "Remove Discount";
  return "Apply Discount";
}

function getBusinessReasons(rec: { recommendation_type: string; inventory_value: number; days_old: number; velocity_7d: number; velocity_30d: number; expiry_days: number | null }, fmtCurr: (n: number) => string): string[] {
  const reasons: string[] = [];
  if (rec.velocity_7d === 0 && rec.velocity_30d === 0) reasons.push("No sales in last 30 days");
  else if (rec.velocity_7d === 0) reasons.push("No sales in last 7 days");
  if (rec.inventory_value > 3000) reasons.push(`Holding ${fmtCurr(rec.inventory_value)} inventory value`);
  if (rec.days_old > 30) reasons.push(`Product is ${rec.days_old} days old`);
  if (rec.expiry_days !== null && rec.expiry_days < 30) reasons.push(`Expiry risk in ${rec.expiry_days} days`);
  if (rec.recommendation_type === "Low Stock Winner") reasons.push("Top-performing product – avoid discount");
  if (!reasons.length) reasons.push(rec.recommendation_type);
  return reasons;
}

export default function AICoPilot() {
  const { formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const { storeId, isAllStores } = useStoreFilter();
  const { data: centralKPIs } = useCentralInventoryKPIs();

  const { data: recs, isLoading, error: recsError } = useQuery({
    queryKey: ["ai-recommendations", storeId],
    queryFn: async () => {
      let q = supabase
        .from("ai_recommendations")
        .select("*, products(name, sku, created_at)")
        .eq("status", "Draft")
        .order("created_at", { ascending: false })
        .limit(50);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("*").eq("setting_key", "pricing_config").maybeSingle();
      return (data?.setting_value ?? null) as Record<string, unknown> | null;
    },
  });

  // Fetch variants + velocity for enrichment
  const productIds = [...new Set((recs ?? []).filter(r => r.product_id).map(r => r.product_id!))];

  const { data: variantData } = useQuery({
    queryKey: ["ai-variants", storeId, productIds],
    enabled: productIds.length > 0,
    queryFn: async () => {
      let q = supabase.from("variants").select("product_id, price, compare_at_price, inventory_quantity, expiry_date").in("product_id", productIds);
      if (storeId) q = q.eq("store_id", storeId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: velocityData } = useQuery({
    queryKey: ["ai-velocity", storeId, productIds],
    enabled: productIds.length > 0,
    queryFn: async () => {
      let q = supabase.from("product_velocity_metrics").select("product_id, units_sold_7d, units_sold_30d").in("product_id", productIds);
      if (storeId) q = q.eq("store_id", storeId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const requireApproval = (settings?.require_approval as boolean) ?? true;

  // Enrich recommendations
  const enriched: EnrichedRec[] = (recs ?? []).map(r => {
    const variants = (variantData ?? []).filter(v => v.product_id === r.product_id);
    const velocity = (velocityData ?? []).find(v => v.product_id === r.product_id);
    const minPrice = variants.length ? Math.min(...variants.map(v => Number(v.price))) : null;
    const totalQty = variants.reduce((s, v) => s + v.inventory_quantity, 0);
    const invValue = minPrice ? totalQty * minPrice : 0;
    const hasDiscount = variants.some(v => v.compare_at_price && Number(v.compare_at_price) > 0);
    const createdAt = r.products?.created_at ? new Date(r.products.created_at) : new Date();
    const daysOld = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
    const vel7 = velocity?.units_sold_7d ?? 0;
    const vel30 = velocity?.units_sold_30d ?? 0;

    // Nearest expiry
    const expiryDates = variants.filter(v => v.expiry_date).map(v => new Date(v.expiry_date!));
    const nearestExpiry = expiryDates.length ? Math.min(...expiryDates.map(d => d.getTime())) : null;
    const expiryDays = nearestExpiry ? Math.max(0, Math.floor((nearestExpiry - Date.now()) / 86400000)) : null;

    const priority = getPriority(invValue, daysOld, vel7, expiryDays);
    const actionType = getActionType(r.recommendation_type, hasDiscount);
    const businessReasons = getBusinessReasons({ recommendation_type: r.recommendation_type, inventory_value: invValue, days_old: daysOld, velocity_7d: vel7, velocity_30d: vel30, expiry_days: expiryDays }, formatCurrency);

    const discountPct = r.suggested_discount_percent ?? 10;
    const expectedSellThrough = Math.round(discountPct * 0.8 * 10) / 10;
    const expectedInvReduction = Math.round(totalQty * (discountPct / 100) * 0.5);
    const expectedRevenueImpact = Math.round(invValue * (discountPct / 100) * -1);

    const suggestedNew = minPrice && r.suggested_discount_percent ? Math.round(minPrice * (1 - r.suggested_discount_percent / 100)) : r.suggested_new_price;

    return {
      id: r.id,
      product_id: r.product_id,
      product_name: r.products?.name || "-",
      sku: r.products?.sku || "-",
      recommendation_type: r.recommendation_type,
      reason: r.reason,
      suggested_discount_percent: r.suggested_discount_percent,
      suggested_new_price: suggestedNew,
      current_price: minPrice,
      inventory_qty: totalQty,
      inventory_value: invValue,
      days_old: daysOld,
      velocity_7d: vel7,
      velocity_30d: vel30,
      expiry_days: expiryDays,
      priority,
      action_type: actionType,
      business_reasons: businessReasons,
      expected_sell_through_improvement: expectedSellThrough,
      expected_inventory_reduction: expectedInvReduction,
      expected_revenue_impact: expectedRevenueImpact,
    };
  });

  const handleApplyAll = async () => {
    if (!recs?.length) return;
    try {
      const ids = [...new Set(recs.filter(r => r.product_id).map(r => r.product_id!))];
      const avgDiscount = Math.round(recs.reduce((s, r) => s + (r.suggested_discount_percent || 0), 0) / recs.length / 5) * 5;
      if (requireApproval) {
        const { error } = await supabase.rpc("create_campaign_draft", {
          p_product_ids: ids,
          p_discount_percent: avgDiscount || 10,
          p_campaign_name: `AI Co-Pilot ${new Date().toLocaleDateString('en-AE')}`,
          p_overwrite_existing: false,
          p_rounding_mode: "whole",
          p_source: "ai_copilot",
          p_store_id: storeId,
        });
        if (error) { toast.error("Failed to create draft: " + error.message); return; }
        toast.success("AI campaign draft created — pending approval");
        if (isAllStores) {
          toast.info("Draft created without a specific store selected. It will appear in the All Stores approval queue.");
        }
      } else {
        const { error } = await supabase.rpc("apply_bulk_discount", {
          p_product_ids: ids,
          p_discount_percent: avgDiscount || 10,
          p_campaign_name: `AI Co-Pilot ${new Date().toLocaleDateString('en-AE')}`,
          p_overwrite_existing: false,
          p_rounding_mode: "whole",
        });
        if (error) { toast.error("Sync failed: " + error.message); return; }
        toast.success("AI recommendations applied!");
      }
      await supabase.from("ai_recommendations").update({ status: "Applied" }).in("id", recs.map(r => r.id));
      await queryClient.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message || "An unexpected error occurred");
    }
  };

  const handleQuickApply = async (rec: EnrichedRec, pct: number) => {
    if (!rec.product_id) return;
    try {
      if (rec.action_type === "Remove Discount" || rec.action_type === "Protect Product") {
        const { error } = await supabase.rpc("revert_variant_pricing", { p_product_id: rec.product_id });
        if (error) throw error;
        toast.success(`Discount removed from ${rec.product_name}`);
      } else {
        if (requireApproval) {
          const { error } = await supabase.rpc("create_campaign_draft", {
            p_product_ids: [rec.product_id],
            p_discount_percent: pct,
            p_campaign_name: `AI Quick ${pct}% - ${rec.product_name.slice(0, 30)}`,
            p_overwrite_existing: false,
            p_rounding_mode: "whole",
            p_source: "ai_copilot",
            p_store_id: storeId,
          });
          if (error) throw error;
          toast.success(`Draft created for ${pct}% on ${rec.product_name}`);
          if (isAllStores) {
            toast.info("Draft created without a specific store selected. It will appear in the All Stores approval queue.");
          }
        } else {
          const { error } = await supabase.rpc("apply_bulk_discount", {
            p_product_ids: [rec.product_id],
            p_discount_percent: pct,
            p_campaign_name: `AI Quick ${pct}% - ${rec.product_name.slice(0, 30)}`,
            p_overwrite_existing: false,
            p_rounding_mode: "whole",
          });
          if (error) throw error;
          toast.success(`${pct}% discount applied to ${rec.product_name}`);
        }
      }
      await supabase.from("ai_recommendations").update({ status: "Applied" }).eq("id", rec.id);
      await queryClient.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message || "Quick action failed");
    }
  };

  const priorityConfig = {
    high: { label: "🔴 High Impact", className: "bg-destructive/10 text-destructive border-destructive/30" },
    medium: { label: "🟡 Medium Impact", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30" },
    low: { label: "🟢 Low Impact", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  };

  const actionConfig: Record<ActionType, { color: string; icon: React.ElementType }> = {
    "Apply Discount": { color: "text-blue-600 dark:text-blue-400", icon: Percent },
    "Increase Discount": { color: "text-amber-600 dark:text-amber-400", icon: TrendingDown },
    "Remove Discount": { color: "text-emerald-600 dark:text-emerald-400", icon: Shield },
    "Protect Product": { color: "text-emerald-600 dark:text-emerald-400", icon: Shield },
  };

  const triggerColors: Record<string, string> = {
    "High Dead Capital": "text-destructive",
    "Stale Stock": "text-amber-600",
    "Zero Velocity": "text-orange-500",
    "Near Expiry Risk": "text-red-500",
    "Low Stock Winner": "text-emerald-600",
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-32" /><Skeleton className="h-96" /></div>;

  if (recsError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Brain className="h-6 w-6" /> AI Co-Pilot</h1>
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <AlertTriangle className="h-10 w-10 mx-auto mb-2 text-destructive opacity-60" />
          <p>Failed to load recommendations. Please try again.</p>
        </CardContent></Card>
      </div>
    );
  }

  const highCount = enriched.filter(r => r.priority === "high").length;
  const medCount = enriched.filter(r => r.priority === "medium").length;
  const totalRevImpact = enriched.reduce((s, r) => s + r.expected_revenue_impact, 0);
  const totalInvReduction = enriched.reduce((s, r) => s + r.expected_inventory_reduction, 0);

  const insights = [
    {
      title: "Reduce Dead Stock",
      subtitle: `${enriched.filter(r => r.recommendation_type === "High Dead Capital").length} products with high dead capital`,
      action: "Apply Discount",
      color: "border-destructive/30 bg-destructive/5",
      textColor: "text-destructive",
      icon: TrendingDown,
      badge: highCount > 0 ? "High Impact" : null,
      metric: `${formatCurrency(Math.abs(totalRevImpact))} at risk`,
    },
    {
      title: "Boost Sell-Through",
      subtitle: `${enriched.filter(r => ["Stale Stock", "Zero Velocity"].includes(r.recommendation_type)).length} stale/zero-velocity items`,
      action: "Apply Discount",
      color: "border-amber-500/30 bg-amber-500/5",
      textColor: "text-amber-600 dark:text-amber-400",
      icon: ArrowDown,
      badge: medCount > 3 ? "Recommended Action" : null,
      metric: `~${totalInvReduction} units reducible`,
    },
    {
      title: "Protect Winners",
      subtitle: `${enriched.filter(r => r.recommendation_type === "Low Stock Winner").length} winners need protection`,
      action: "Remove Discount",
      color: "border-emerald-500/30 bg-emerald-500/5",
      textColor: "text-emerald-600 dark:text-emerald-400",
      icon: Award,
      badge: enriched.some(r => r.action_type === "Protect Product") ? "Protect" : null,
      metric: "No discounts recommended",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Brain className="h-6 w-6" /> AI Co-Pilot <Badge variant="outline" className="text-[10px] ml-2">Decision Engine</Badge></h1>
          <p className="text-sm text-muted-foreground">Smart recommendations with impact prediction, priority scoring & quick actions</p>
        </div>
        {enriched.length > 0 && (
          <Button onClick={handleApplyAll}>
            <Zap className="h-4 w-4 mr-1" /> {requireApproval ? "Create Campaign Draft" : "Apply All"}
          </Button>
        )}
      </div>

      {/* AI Insight Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {insights.map(ins => {
          const Icon = ins.icon;
          return (
            <Card key={ins.title} className={`border ${ins.color} transition-all hover:shadow-md hover:-translate-y-0.5`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-background/80">
                      <Icon className={`h-5 w-5 ${ins.textColor}`} />
                    </div>
                    <p className={`text-sm font-semibold ${ins.textColor}`}>{ins.title}</p>
                  </div>
                  {ins.badge && <Badge variant="outline" className="text-[10px]">{ins.badge}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-2">{ins.subtitle}</p>
                <p className="text-xs font-mono font-medium mt-1 text-foreground/70">{ins.metric}</p>
                <p className="text-[10px] font-medium mt-2 uppercase tracking-wider text-muted-foreground">
                  Recommended: {ins.action}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Central Inventory Context */}
      {centralKPIs && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Warehouse className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Central WMS Context</span>
              <Badge variant="outline" className="text-[10px]">Cross-Store Analysis</Badge>
            </div>
            <div className="flex gap-6 text-xs text-muted-foreground">
              <span>Central SKUs: <strong className="text-foreground">{centralKPIs.totalSKUs.toLocaleString()}</strong></span>
              <span>Total Available: <strong className="text-foreground">{centralKPIs.totalAvailable.toLocaleString()}</strong></span>
              <span>Reserved: <strong className="text-foreground">{centralKPIs.totalReserved.toLocaleString()}</strong></span>
              <span>Central Value: <strong className="text-foreground">{formatCurrency(centralKPIs.totalValue)}</strong></span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">AI recommendations consider total dead stock across all stores, not just per-store inventory.</p>
          </CardContent>
        </Card>
      )}

      {/* Trigger Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {["High Dead Capital", "Stale Stock", "Zero Velocity", "Near Expiry Risk", "Low Stock Winner"].map(trigger => (
          <Card key={trigger} className="transition-all hover:shadow-sm">
            <CardContent className="p-3">
              <p className={`text-xs font-medium ${triggerColors[trigger] || ""}`}>{trigger}</p>
              <p className="text-2xl font-bold mt-1">{enriched.filter(r => r.recommendation_type === trigger).length}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recommendations as Cards */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5" /> AI Recommendations
          <Badge variant="secondary" className="ml-2">{enriched.length}</Badge>
        </h2>
        {!enriched.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Brain className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No pending AI recommendations</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {enriched.map(rec => {
              const pc = priorityConfig[rec.priority];
              const ac = actionConfig[rec.action_type];
              const ActionIcon = ac.icon;
              return (
                <Card key={rec.id} className={`border transition-all hover:shadow-md ${rec.priority === "high" ? "border-destructive/20" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Info */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm truncate max-w-[250px]">{rec.product_name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{rec.sku}</span>
                          <Badge variant="outline" className={`text-[10px] ${pc.className}`}>{pc.label}</Badge>
                          <Badge variant="outline" className={`text-[10px] ${ac.color}`}>
                            <ActionIcon className="h-3 w-3 mr-1" />{rec.action_type}
                          </Badge>
                        </div>

                        {/* Business Reasons */}
                        <div className="flex flex-wrap gap-1">
                          {rec.business_reasons.map((reason, i) => (
                            <span key={i} className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {reason}
                            </span>
                          ))}
                        </div>

                        {/* Impact Predictions */}
                        <div className="flex gap-4 text-[11px] text-muted-foreground">
                          <span>📈 Sell-through: <strong className="text-emerald-600 dark:text-emerald-400">+{rec.expected_sell_through_improvement}%</strong></span>
                          <span>📦 Inv reduction: <strong className="text-foreground">{rec.expected_inventory_reduction} units</strong></span>
                          <span>💰 Revenue: <strong className="text-destructive">{formatCurrency(rec.expected_revenue_impact)}</strong></span>
                        </div>

                        {/* Price Info */}
                        <div className="flex gap-4 text-xs">
                          <span>Current: <strong className="font-mono">{rec.current_price ? formatCurrency(rec.current_price) : "-"}</strong></span>
                          {rec.suggested_discount_percent && <span>Discount: <strong className="font-mono">{rec.suggested_discount_percent}%</strong></span>}
                          {rec.suggested_new_price && <span>New: <strong className="font-mono text-primary">{formatCurrency(rec.suggested_new_price)}</strong></span>}
                          <span>Stock: <strong className="font-mono">{rec.inventory_qty}</strong></span>
                          <span>Value: <strong className="font-mono">{formatCurrency(rec.inventory_value)}</strong></span>
                        </div>
                      </div>

                      {/* Right: Quick Actions */}
                      <div className="flex flex-col gap-1 shrink-0">
                        {rec.action_type === "Protect Product" || rec.action_type === "Remove Discount" ? (
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => handleQuickApply(rec, 0)}>
                            <Shield className="h-3 w-3 mr-1" /> Remove
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleQuickApply(rec, 10)}>Apply 10%</Button>
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleQuickApply(rec, 15)}>Apply 15%</Button>
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleQuickApply(rec, 20)}>Apply 20%</Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
