import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Bot, AlertTriangle, Clock, TrendingDown, Package, Pencil, Save, Plus, Trash2, Play, ShieldAlert, Gauge } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Json } from "@/integrations/supabase/types";
import { Skeleton } from "@/components/ui/skeleton";

interface Condition {
  field: "age" | "stock" | "velocity" | "expiry";
  operator: ">" | "<" | ">=" | "<=";
  value: number;
}

interface AutoPilotRule {
  id: string;
  name: string;
  conditions: Condition[];
  action: "apply_discount" | "remove_discount" | "send_to_review" | "mark_replenishment";
  discount_percent?: number;
  execution_mode: "manual" | "semi_auto" | "fully_auto";
  schedule: "daily" | "weekly" | "custom";
  schedule_interval_hours?: number;
  safety: {
    max_discount: number;
    protect_winners: boolean;
    no_overwrite_campaigns: boolean;
    margin_floor: number;
  };
  active: boolean;
  icon: string;
  color: string;
  last_executed_at?: string;
  last_inventory_reduced?: number;
  last_sell_through_improvement?: number;
}

const DEFAULT_RULES: AutoPilotRule[] = [
  {
    id: "rule-1",
    name: "Zero Velocity > 14 days",
    conditions: [{ field: "age", operator: ">", value: 14 }, { field: "velocity", operator: "<", value: 1 }],
    action: "apply_discount",
    discount_percent: 10,
    execution_mode: "semi_auto",
    schedule: "daily",
    safety: { max_discount: 30, protect_winners: true, no_overwrite_campaigns: true, margin_floor: 15 },
    active: true,
    icon: "TrendingDown",
    color: "text-orange-500",
  },
  {
    id: "rule-2",
    name: "Stale Stock > 21 days",
    conditions: [{ field: "age", operator: ">", value: 21 }, { field: "stock", operator: ">", value: 10 }],
    action: "apply_discount",
    discount_percent: 15,
    execution_mode: "semi_auto",
    schedule: "daily",
    safety: { max_discount: 30, protect_winners: true, no_overwrite_campaigns: true, margin_floor: 15 },
    active: true,
    icon: "Clock",
    color: "text-amber-600",
  },
  {
    id: "rule-3",
    name: "High Dead Capital > 45 days",
    conditions: [{ field: "age", operator: ">", value: 45 }],
    action: "apply_discount",
    discount_percent: 25,
    execution_mode: "manual",
    schedule: "weekly",
    safety: { max_discount: 35, protect_winners: true, no_overwrite_campaigns: false, margin_floor: 10 },
    active: true,
    icon: "AlertTriangle",
    color: "text-destructive",
  },
  {
    id: "rule-4",
    name: "Near Expiry Risk",
    conditions: [{ field: "expiry", operator: "<", value: 15 }],
    action: "apply_discount",
    discount_percent: 20,
    execution_mode: "fully_auto",
    schedule: "daily",
    safety: { max_discount: 40, protect_winners: false, no_overwrite_campaigns: false, margin_floor: 5 },
    active: true,
    icon: "Clock",
    color: "text-red-500",
  },
  {
    id: "rule-5",
    name: "Low Stock Winner",
    conditions: [{ field: "stock", operator: "<", value: 15 }, { field: "velocity", operator: ">", value: 5 }],
    action: "mark_replenishment",
    execution_mode: "semi_auto",
    schedule: "weekly",
    safety: { max_discount: 0, protect_winners: true, no_overwrite_campaigns: true, margin_floor: 20 },
    active: true,
    icon: "Package",
    color: "text-emerald-600",
  },
];

const ICON_MAP: Record<string, React.ElementType> = { TrendingDown, Clock, AlertTriangle, Package, ShieldAlert };
const FIELD_LABELS: Record<string, string> = { age: "Product Age (days)", stock: "Stock Quantity", velocity: "Sales Velocity (7d)", expiry: "Days to Expiry" };
const ACTION_LABELS: Record<string, string> = { apply_discount: "Apply Discount", remove_discount: "Remove Discount", send_to_review: "Send to Review", mark_replenishment: "Mark as Replenishment" };
const MODE_LABELS: Record<string, string> = { manual: "Manual Approval", semi_auto: "Semi-Automatic", fully_auto: "Fully Automatic" };
const SCHEDULE_LABELS: Record<string, string> = { daily: "Daily", weekly: "Weekly", custom: "Custom Interval" };

export default function AutoPilot() {
  const queryClient = useQueryClient();
  const [editRule, setEditRule] = useState<AutoPilotRule | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["autopilot-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("*").eq("setting_key", "autopilot_rules").maybeSingle();
      return ((data?.setting_value ?? null) as unknown) as AutoPilotRule[] | null;
    },
  });

  const rules: AutoPilotRule[] = settings ?? DEFAULT_RULES;

  const saveRules = async (updatedRules: AutoPilotRule[]) => {
    try {
      const { data: existing } = await supabase.from("app_settings").select("id").eq("setting_key", "autopilot_rules").maybeSingle();
      if (existing) {
        const { error } = await supabase.from("app_settings").update({ setting_value: updatedRules as unknown as Json }).eq("setting_key", "autopilot_rules");
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert({ setting_key: "autopilot_rules", setting_value: updatedRules as unknown as Json, description: "Auto-pilot automation rules" });
        if (error) throw error;
      }
      toast.success("Auto-pilot rules saved");
      queryClient.invalidateQueries({ queryKey: ["autopilot-settings"] });
    } catch {
      toast.error("Failed to save rules");
    }
  };

  const handleSave = () => {
    if (!editRule) return;
    if (!editRule.name.trim()) { toast.error("Rule name is required"); return; }
    if (editRule.conditions.length === 0) { toast.error("At least one condition is required"); return; }
    let updated: AutoPilotRule[];
    if (isNew) {
      updated = [...rules, editRule];
    } else {
      updated = rules.map(r => r.id === editRule.id ? editRule : r);
    }
    saveRules(updated);
    setEditRule(null);
    setIsNew(false);
  };

  const handleDelete = (id: string) => {
    saveRules(rules.filter(r => r.id !== id));
  };

  const toggleActive = (id: string) => {
    saveRules(rules.map(r => r.id === id ? { ...r, active: !r.active } : r));
  };

  const addNewRule = () => {
    setIsNew(true);
    setEditRule({
      id: `rule-${Date.now()}`,
      name: "",
      conditions: [{ field: "age", operator: ">", value: 14 }],
      action: "apply_discount",
      discount_percent: 10,
      execution_mode: "manual",
      schedule: "daily",
      safety: { max_discount: 30, protect_winners: true, no_overwrite_campaigns: true, margin_floor: 15 },
      active: true,
      icon: "TrendingDown",
      color: "text-orange-500",
    });
  };

  const addCondition = () => {
    if (!editRule) return;
    setEditRule({ ...editRule, conditions: [...editRule.conditions, { field: "stock", operator: ">", value: 10 }] });
  };

  const removeCondition = (i: number) => {
    if (!editRule) return;
    setEditRule({ ...editRule, conditions: editRule.conditions.filter((_, idx) => idx !== i) });
  };

  const updateCondition = (i: number, updates: Partial<Condition>) => {
    if (!editRule) return;
    const conds = [...editRule.conditions];
    conds[i] = { ...conds[i], ...updates };
    setEditRule({ ...editRule, conditions: conds });
  };

  const activeCount = rules.filter(r => r.active).length;
  const autoCount = rules.filter(r => r.active && r.execution_mode === "fully_auto").length;

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="h-6 w-6" /> Auto-Pilot <Badge variant="outline" className="text-[10px] ml-2">Automation Engine</Badge></h1>
          <p className="text-sm text-muted-foreground">Visual rule builder with configurable execution modes, scheduling & safety guardrails</p>
        </div>
        <Button onClick={addNewRule}><Plus className="h-4 w-4 mr-1" /> Add Rule</Button>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{activeCount}</p><p className="text-xs text-muted-foreground">Active Rules</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{autoCount}</p><p className="text-xs text-muted-foreground">Fully Automatic</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{rules.length}</p><p className="text-xs text-muted-foreground">Total Rules</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-emerald-600">On</p><p className="text-xs text-muted-foreground">Audit Logging</p></CardContent></Card>
      </div>

      {/* Rules */}
      <div className="space-y-3">
        {rules.map(rule => {
          const IconComp = ICON_MAP[rule.icon] || Bot;
          return (
            <Card key={rule.id} className={`transition-all ${!rule.active ? "opacity-50" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-muted shrink-0"><IconComp className={`h-5 w-5 ${rule.color}`} /></div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{rule.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{ACTION_LABELS[rule.action]}</Badge>
                      {rule.discount_percent && <Badge variant="outline" className="text-[10px]">{rule.discount_percent}%</Badge>}
                      <Badge variant="outline" className="text-[10px]">{MODE_LABELS[rule.execution_mode]}</Badge>
                      <Badge variant="outline" className="text-[10px]">{SCHEDULE_LABELS[rule.schedule]}</Badge>
                    </div>
                    {/* Visual Rule */}
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      {rule.conditions.map((c, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted font-mono">
                          {i > 0 && <span className="font-semibold text-primary mr-1">AND</span>}
                          IF {FIELD_LABELS[c.field]} {c.operator} {c.value}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">
                        THEN {ACTION_LABELS[rule.action]}{rule.discount_percent ? ` ${rule.discount_percent}%` : ""}
                      </span>
                    </div>
                    {/* Safety */}
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span>Max: {rule.safety.max_discount}%</span>
                      {rule.safety.protect_winners && <span className="text-emerald-600">✓ Protect Winners</span>}
                      {rule.safety.no_overwrite_campaigns && <span>✓ No Overwrite</span>}
                      <span>Floor: {rule.safety.margin_floor}%</span>
                    </div>
                    {/* Performance */}
                    {rule.last_executed_at && (
                      <div className="flex gap-4 text-[10px] text-muted-foreground">
                        <span>Last run: {new Date(rule.last_executed_at).toLocaleString("en-AE")}</span>
                        {rule.last_inventory_reduced != null && <span>Reduced: {rule.last_inventory_reduced} units</span>}
                        {rule.last_sell_through_improvement != null && <span>Sell-through: +{rule.last_sell_through_improvement}%</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => { setIsNew(false); setEditRule({ ...rule }); }}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(rule.id)}><Trash2 className="h-3 w-3" /></Button>
                    <Switch checked={rule.active} onCheckedChange={() => toggleActive(rule.id)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={!!editRule} onOpenChange={open => { if (!open) { setEditRule(null); setIsNew(false); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isNew ? "Create New Rule" : "Edit Rule"}</DialogTitle></DialogHeader>
          {editRule && (
            <div className="space-y-4">
              <div><Label>Rule Name</Label><Input value={editRule.name} onChange={e => setEditRule({ ...editRule, name: e.target.value })} placeholder="e.g. Stale Stock > 21 days" /></div>

              {/* Conditions */}
              <div>
                <Label className="mb-2 block">Conditions</Label>
                {editRule.conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    {i > 0 && <span className="text-xs font-semibold text-primary">AND</span>}
                    <Select value={c.field} onValueChange={v => updateCondition(i, { field: v as Condition["field"] })}>
                      <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="age">Age (days)</SelectItem>
                        <SelectItem value="stock">Stock</SelectItem>
                        <SelectItem value="velocity">Velocity (7d)</SelectItem>
                        <SelectItem value="expiry">Expiry (days)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={c.operator} onValueChange={v => updateCondition(i, { operator: v as Condition["operator"] })}>
                      <SelectTrigger className="w-[60px] h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value=">">&gt;</SelectItem>
                        <SelectItem value="<">&lt;</SelectItem>
                        <SelectItem value=">=">&ge;</SelectItem>
                        <SelectItem value="<=">&le;</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input type="number" value={c.value} onChange={e => updateCondition(i, { value: Number(e.target.value) })} className="w-20 h-8 text-xs" />
                    {editRule.conditions.length > 1 && <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeCondition(i)}><Trash2 className="h-3 w-3" /></Button>}
                  </div>
                ))}
                <Button variant="outline" size="sm" className="text-xs" onClick={addCondition}><Plus className="h-3 w-3 mr-1" /> Add Condition</Button>
              </div>

              {/* Action */}
              <div>
                <Label>Action</Label>
                <Select value={editRule.action} onValueChange={v => setEditRule({ ...editRule, action: v as AutoPilotRule["action"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apply_discount">Apply Discount</SelectItem>
                    <SelectItem value="remove_discount">Remove Discount</SelectItem>
                    <SelectItem value="send_to_review">Send to Review</SelectItem>
                    <SelectItem value="mark_replenishment">Mark as Replenishment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editRule.action === "apply_discount" && (
                <div><Label>Discount %</Label><Input type="number" value={editRule.discount_percent ?? ""} onChange={e => setEditRule({ ...editRule, discount_percent: Number(e.target.value) })} /></div>
              )}

              {/* Execution Mode */}
              <div>
                <Label>Execution Mode</Label>
                <Select value={editRule.execution_mode} onValueChange={v => setEditRule({ ...editRule, execution_mode: v as AutoPilotRule["execution_mode"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual Approval Required</SelectItem>
                    <SelectItem value="semi_auto">Semi-Automatic (Review before sync)</SelectItem>
                    <SelectItem value="fully_auto">Fully Automatic</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Schedule */}
              <div>
                <Label>Schedule</Label>
                <Select value={editRule.schedule} onValueChange={v => setEditRule({ ...editRule, schedule: v as AutoPilotRule["schedule"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="custom">Custom Interval</SelectItem>
                  </SelectContent>
                </Select>
                {editRule.schedule === "custom" && (
                  <div className="mt-2"><Label>Interval (hours)</Label><Input type="number" value={editRule.schedule_interval_hours ?? 12} onChange={e => setEditRule({ ...editRule, schedule_interval_hours: Number(e.target.value) })} /></div>
                )}
              </div>

              {/* Safety */}
              <div className="space-y-3 border rounded-lg p-3">
                <p className="text-xs font-semibold flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> Safety Guardrails</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Max Discount %</Label><Input type="number" value={editRule.safety.max_discount} onChange={e => setEditRule({ ...editRule, safety: { ...editRule.safety, max_discount: Number(e.target.value) } })} className="h-8" /></div>
                  <div><Label className="text-xs">Margin Floor %</Label><Input type="number" value={editRule.safety.margin_floor} onChange={e => setEditRule({ ...editRule, safety: { ...editRule.safety, margin_floor: Number(e.target.value) } })} className="h-8" /></div>
                </div>
                <div className="flex items-center justify-between"><Label className="text-xs">Protect Winners</Label><Switch checked={editRule.safety.protect_winners} onCheckedChange={v => setEditRule({ ...editRule, safety: { ...editRule.safety, protect_winners: v } })} /></div>
                <div className="flex items-center justify-between"><Label className="text-xs">Don't overwrite active campaigns</Label><Switch checked={editRule.safety.no_overwrite_campaigns} onCheckedChange={v => setEditRule({ ...editRule, safety: { ...editRule.safety, no_overwrite_campaigns: v } })} /></div>
              </div>

              <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={editRule.active} onCheckedChange={v => setEditRule({ ...editRule, active: v })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditRule(null); setIsNew(false); }}>Cancel</Button>
            <Button onClick={handleSave}><Save className="h-4 w-4 mr-1" /> {isNew ? "Create Rule" : "Save Rule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
