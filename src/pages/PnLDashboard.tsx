import { Fragment, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Wallet,
  TrendingUp, TrendingDown, Receipt, Coins, ArrowUp, ArrowDown, Percent, Tag, Share2, ShoppingCart,
  Download, Printer, LineChart as LineChartIcon, Info, LayoutGrid, RotateCcw, Globe, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useStore } from "@/contexts/StoreContext";
import { useRole } from "@/hooks/useRole";
import { useStoreSalesPulse, type ChannelSalesStat } from "@/hooks/useStoreSalesPulse";
import {
  getMonthBounds, useAllCostEntries, useCostEntryMutations, useEnsureFxRates, useUpsertFxRate,
  useSalesBridge, useMonthlyNetSalesTrend, useCheckoutAbandonment, useTrafficSource, useDiscountTiers, currencyToSar,
  COST_CATEGORIES, platformOptionsFor,
  type CostEntry, type CostEntryInput, type SalesBridgeRow, type MonthlyTrendPoint, type AbandonmentRow, type TrafficSourceRow, type DiscountTierRow,
} from "@/hooks/usePnL";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePageLayout } from "@/hooks/usePageLayout";
import { useGa4ChannelSummary } from "@/hooks/useGa4";

// Reorderable page sections, saved per-account via usePageLayout("pnl", ...).
// Keys are stable identifiers persisted to the DB — never rename a key
// without a migration, only append new ones (unknown/missing keys are
// handled gracefully by usePageLayout).
const PNL_SECTIONS: { key: string; label: string }[] = [
  { key: "kpis", label: "KPI Summary" },
  { key: "revenue-costs", label: "Revenue & Costs" },
  { key: "store-cards", label: "Store P&L Cards" },
  { key: "ranking", label: "Net Sales Ranking" },
  { key: "channels-abandonment", label: "Sales by Channel & Cart Abandonment" },
  { key: "marketing", label: "Marketing & Traffic (GA4)" },
  { key: "trend", label: "Net Sales Trend" },
  { key: "ledger", label: "Cost Entries" },
];
const PNL_DEFAULT_ORDER = PNL_SECTIONS.map(s => s.key);

function LayoutCustomizer({ order, onSave, onReset, onClose, saving }: {
  order: string[]; onSave: (order: string[]) => void; onReset: () => void; onClose: () => void; saving: boolean;
}) {
  const [draft, setDraft] = useState(order);
  const labelOf = (key: string) => PNL_SECTIONS.find(s => s.key === key)?.label ?? key;
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[idx], next[target]] = [next[target], next[idx]];
    setDraft(next);
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Customize Page Layout</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 py-1 max-h-[60vh] overflow-y-auto">
          {draft.map((key, idx) => (
            <div key={key} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="flex-1 text-sm font-medium truncate">{labelOf(key)}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label="Move up">
                <ArrowUp size={13} />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={idx === draft.length - 1} onClick={() => move(idx, 1)} aria-label="Move down">
                <ArrowDown size={13} />
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter className="flex-row items-center !justify-between sm:justify-between pt-2 border-t">
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1.5" onClick={onReset}>
            <RotateCcw size={12} /> Reset to default
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => onSave(draft)} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Same accent palette + assignment order as Store Performance, so a store's
// colour means the same thing on both pages.
const STORE_COLORS = ["#6366f1", "#f59e0b", "#06b6d4", "#10b981", "#f43f5e", "#a855f7", "#3b82f6", "#84cc16"];
function storeColor(idx: number): string { return STORE_COLORS[idx % STORE_COLORS.length]; }

const CATEGORY_COLORS: Record<string, string> = {
  ad_spend: "#6366f1",
  shopify: "#95BF47",
  marketplace_fee: "#f59e0b",
  other: "#94a3b8",
};
function categoryColor(cat: string): string { return CATEGORY_COLORS[cat] ?? "#94a3b8"; }

function fmtC(value: number, sym: string): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${sym}${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function categoryLabel(c: string) { return COST_CATEGORIES.find(x => x.value === c)?.label ?? c; }
function platformLabel(category: string, p: string | null) {
  if (!p) return "—";
  return platformOptionsFor(category).find(x => x.value === p)?.label ?? p;
}
function prevMonthKey(year: number, month: number) {
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function DeltaBadge({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  const positive = inverse ? value <= 0 : value >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-xs font-medium",
      positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400",
    )}>
      {positive ? <ArrowUp size={9} strokeWidth={2.5} /> : <ArrowDown size={9} strokeWidth={2.5} />}
      {Math.abs(value)}%
    </span>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("bg-muted animate-pulse rounded", className)} />;
}

// ─── Month picker — same pill-button chrome as the date range picker ───────

function MonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const prev = () => (month === 1 ? onChange(year - 1, 12) : onChange(year, month - 1));
  const next = () => (month === 12 ? onChange(year + 1, 1) : onChange(year, month + 1));
  return (
    <div className="flex items-center rounded-lg border overflow-hidden text-xs">
      <button onClick={prev} className="px-2 py-1.5 hover:bg-muted text-muted-foreground transition-colors border-r"><ChevronLeft size={13} /></button>
      <span className="px-3 py-1.5 font-medium w-32 text-center">{label}</span>
      <button onClick={next} className="px-2 py-1.5 hover:bg-muted text-muted-foreground transition-colors border-l"><ChevronRight size={13} /></button>
    </div>
  );
}

// ─── Cost entry form (create/edit) ─────────────────────────────────────────

interface EntryFormState {
  store_id: string;
  category: CostEntry["category"];
  platform: CostEntry["platform"];
  amount: string;
  notes: string;
}

function CostEntryDialog({
  open, onOpenChange, monthKey, stores, editing, defaultStoreId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  monthKey: string;
  stores: { id: string; store_name: string; currency: string | null }[];
  editing: CostEntry | null;
  defaultStoreId: string | null;
}) {
  const { create, update } = useCostEntryMutations();
  const [form, setForm] = useState<EntryFormState>(() => ({
    store_id: editing?.store_id ?? defaultStoreId ?? stores[0]?.id ?? "",
    category: editing?.category ?? "ad_spend",
    platform: editing?.platform ?? null,
    amount: editing ? String(editing.amount) : "",
    notes: editing?.notes ?? "",
  }));

  const platformOptions = platformOptionsFor(form.category);
  const needsPlatform = platformOptions.length > 0;
  const store = stores.find(s => s.id === form.store_id);

  const handleSubmit = async () => {
    const amount = parseFloat(form.amount);
    if (!form.store_id) return toast.error("Select a store");
    if (!amount || amount < 0) return toast.error("Enter a valid amount");
    if (!store) return toast.error("Store not found");

    const input: CostEntryInput = {
      store_id: form.store_id,
      category: form.category,
      platform: needsPlatform ? form.platform : null,
      month: monthKey,
      amount,
      currency: store.currency ?? "GBP",
      notes: form.notes || undefined,
    };

    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...input });
        toast.success("Cost entry updated");
      } else {
        await create.mutateAsync(input);
        toast.success("Cost entry added");
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save entry");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? "Edit Cost Entry" : "Add Cost Entry"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Store</Label>
            <Select value={form.store_id} onValueChange={(v) => setForm(f => ({ ...f, store_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
              <SelectContent>
                {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.store_name} ({s.currency})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v: any) => setForm(f => ({ ...f, category: v, platform: null }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COST_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {needsPlatform && (
            <div>
              <Label>Platform</Label>
              <Select value={form.platform ?? ""} onValueChange={(v: any) => setForm(f => ({ ...f, platform: v }))}>
                <SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger>
                <SelectContent>
                  {platformOptions.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Amount ({store?.currency ?? "—"})</Label>
            <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>
            {editing ? "Save Changes" : "Add Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── FX rate inline editor (admin fallback, for GBP/PKR only) ──────────────

function FxRateEditor({ monthKey, fxRates }: { monthKey: string; fxRates: Record<string, number> }) {
  const upsert = useUpsertFxRate();
  const [gbp, setGbp] = useState(String(fxRates.GBP ?? ""));
  const [pkr, setPkr] = useState(String(fxRates.PKR ?? ""));

  const save = async (currency: "GBP" | "PKR", value: string) => {
    const rate = parseFloat(value);
    if (!rate || rate <= 0) return toast.error("Enter a valid rate");
    try {
      await upsert.mutateAsync({ currency, monthKey, rate });
      toast.success(`${currency}→SAR rate saved`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save rate");
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <div>
        <Label className="text-xs">1 GBP = ? SAR</Label>
        <div className="flex gap-1">
          <Input className="w-24 h-8" value={gbp} onChange={e => setGbp(e.target.value)} placeholder="e.g. 4.83" />
          <Button size="sm" className="h-8" onClick={() => save("GBP", gbp)}>Save</Button>
        </div>
      </div>
      <div>
        <Label className="text-xs">1 PKR = ? SAR</Label>
        <div className="flex gap-1">
          <Input className="w-24 h-8" value={pkr} onChange={e => setPkr(e.target.value)} placeholder="e.g. 0.0134" />
          <Button size="sm" className="h-8" onClick={() => save("PKR", pkr)}>Save</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Global summary KPI row ─────────────────────────────────────────────────

function SummaryCards({ totalRevenue, totalCosts, netSales, prevRevenue, prevCosts, prevNet, orderCount, revenueDelta, costsDelta, netDelta, biggestCostLabel, symbol, unit, loading }: {
  totalRevenue: number; totalCosts: number; netSales: number;
  prevRevenue: number; prevCosts: number; prevNet: number; orderCount: number;
  revenueDelta: number | null; costsDelta: number | null; netDelta: number | null;
  biggestCostLabel: string; symbol: string; unit: string; loading: boolean;
}) {
  const orders = `${fmtNum(orderCount)} order${orderCount === 1 ? "" : "s"}`;
  const cards = [
    { label: `Total Revenue ${unit}`.trim(), value: `${symbol}${fmtNum(totalRevenue)}`, icon: TrendingUp, color: "#6366f1", bg: "#eef2ff", delta: revenueDelta, inverse: false, sub: `vs ${symbol}${fmtNum(prevRevenue)} last month`, orders },
    { label: `Total Costs ${unit}`.trim(), value: `−${symbol}${fmtNum(totalCosts)}`, icon: Receipt, color: "#dc2626", bg: "#fee2e2", delta: costsDelta, inverse: true, sub: `vs ${symbol}${fmtNum(prevCosts)} last month`, orders: null },
    { label: `Net Sales ${unit}`.trim(), value: `${symbol}${fmtNum(netSales)}`, icon: Coins, color: "#059669", bg: "#d1fae5", delta: netDelta, inverse: false, sub: `vs ${symbol}${fmtNum(prevNet)} last month`, orders },
    { label: "Biggest Cost", value: biggestCostLabel, icon: TrendingDown, color: "#d97706", bg: "#fef3c7", delta: null as number | null, inverse: false, sub: "this month", orders: null },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(c => (
        <Card key={c.label} className="overflow-hidden transition-shadow hover:shadow-md">
          <div className="h-1.5 w-full" style={{ background: c.color }} />
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: c.bg, color: c.color }}>
                <c.icon size={17} strokeWidth={2.2} />
              </span>
              {c.delta !== null && !loading && <KpiDeltaPill value={c.delta} inverse={c.inverse} />}
            </div>
            <div className="text-[11px] text-muted-foreground font-medium mb-1">{c.label}</div>
            {loading ? <Skeleton className="h-8 w-28" /> : (
              <div className={cn("font-bold tracking-tight leading-none", c.label === "Biggest Cost" ? "text-base" : "text-[26px] tabular-nums")}>{c.value}</div>
            )}
            <div className="text-[11px] text-muted-foreground mt-1.5">{c.sub}</div>
            {c.orders && !loading && <div className="text-[11px] text-muted-foreground mt-0.5">{c.orders}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Pill-style delta for the top KPI row — distinct from the plain-text
 *  DeltaBadge used inline elsewhere on this page (per-store cards, ranking
 *  table), where a filled pill would feel too heavy in that denser layout. */
function KpiDeltaPill({ value, inverse = false }: { value: number; inverse?: boolean }) {
  const positive = inverse ? value <= 0 : value >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full shrink-0",
      positive
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
        : "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
    )}>
      {positive ? <ArrowUp size={9} strokeWidth={2.8} /> : <ArrowDown size={9} strokeWidth={2.8} />}
      {Math.abs(value)}%
    </span>
  );
}

// ─── Per-store P&L card ─────────────────────────────────────────────────────

interface StoreRow {
  store: { id: string; store_name: string; currency: string | null; currency_symbol: string | null };
  revenue: number; costs: number; net: number;
  prevRevenue: number; prevCosts: number; prevNet: number;
  revenueDelta: number | null; costsDelta: number | null; netDelta: number | null;
  revenueSar: number | null; costsSar: number | null; netSar: number | null;
  prevRevenueSar: number | null; prevCostsSar: number | null; prevNetSar: number | null;
  entries: CostEntry[];
  channels: ChannelSalesStat[];
}

function pctDelta(cur: number, prev: number): number | null {
  return prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null;
}

/** A store's own biggest cost category, in its native currency — no FX needed. */
function biggestCategoryFor(entries: CostEntry[]): string {
  const byCategory = new Map<string, number>();
  for (const e of entries) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));
  if (byCategory.size === 0) return "None yet";
  const [top] = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  return categoryLabel(top[0]);
}

function PnLCard({ r, idx }: { r: StoreRow; idx: number }) {
  const color = storeColor(idx);
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of r.entries) map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [r.entries]);

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="h-1.5 w-full" style={{ background: color }} />
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
          <h3 className="font-semibold text-sm">{r.store.store_name}</h3>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-mono">{r.store.currency}</span>
        </div>

        <div className="pt-1 border-t space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Revenue</span>
            <span className="flex items-center gap-1.5">
              <span className="font-semibold tabular-nums">{fmtC(r.revenue, r.store.currency_symbol ?? "")}</span>
              <DeltaBadge value={r.revenueDelta} />
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Costs</span>
            <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">−{fmtC(r.costs, r.store.currency_symbol ?? "")}</span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-2">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Net</div>
            <div className="text-base font-bold tabular-nums">{fmtC(r.net, r.store.currency_symbol ?? "")}</div>
          </div>
          <div className="text-right text-[10px] text-muted-foreground">
            {r.netSar !== null ? `SAR ${fmtNum(r.netSar)}` : "rate missing"}
          </div>
        </div>

        <div className="border-t pt-2 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Costs by category</span>
            <span className="text-[10px] text-muted-foreground">{byCategory.length} active</span>
          </div>
          {byCategory.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-3 text-center">No costs entered this period.</p>
          ) : (
            <div className="divide-y divide-border/50">
              {byCategory.map(([cat, amt]) => (
                <div key={cat} className="flex items-center gap-2.5 py-1.5">
                  <span className="text-xs font-medium truncate flex-1 min-w-0">{categoryLabel(cat)}</span>
                  <span className="text-xs font-semibold tabular-nums">{fmtC(amt, r.store.currency_symbol ?? "")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Cost breakdown by category — combined across every store, one card ────

function CategoryBreakdownCard({ breakdown, excludedStoreNames, symbol, subtitle, loading }: {
  breakdown: { category: string; amount: number; pct: number; platforms: { platform: string; amount: number }[] }[];
  excludedStoreNames: string[];
  symbol: string;
  subtitle: string;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (category: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(category)) next.delete(category); else next.add(category);
    return next;
  });
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#fef3c7", color: "#d97706" }}>
            <Receipt size={12} strokeWidth={2.2} />
          </span>
          <h3 className="text-sm font-semibold">Cost Breakdown by Category</h3>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center">
        {!loading && excludedStoreNames.length > 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-2.5 py-1.5 mb-3">
            Missing exchange rate — excludes {excludedStoreNames.join(", ")}. Totals below understate the true cost.
          </p>
        )}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : breakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No costs entered this period.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 mb-1 border-b">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Costs</span>
              <span className="text-lg font-extrabold tabular-nums">{symbol}{fmtNum(breakdown.reduce((sum, b) => sum + b.amount, 0))}</span>
            </div>
            {breakdown.map((b, idx) => {
              const color = categoryColor(b.category);
              const canExpand = b.platforms.length > 0;
              const isOpen = expanded.has(b.category);
              return (
                <div key={b.category}>
                  <div
                    className={cn("flex items-center gap-3", canExpand && "cursor-pointer")}
                    role={canExpand ? "button" : undefined}
                    tabIndex={canExpand ? 0 : undefined}
                    onClick={canExpand ? () => toggle(b.category) : undefined}
                    onKeyDown={canExpand ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(b.category); } } : undefined}
                  >
                    <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}>
                      <Tag size={13} strokeWidth={2.2} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-medium truncate">
                          {categoryLabel(b.category)}
                          {idx === 0 && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800 shrink-0">
                              Biggest
                            </Badge>
                          )}
                          {canExpand && <ChevronRight size={12} className={cn("text-muted-foreground transition-transform shrink-0", isOpen && "rotate-90")} />}
                        </span>
                        <span className="text-sm font-bold tabular-nums shrink-0">{symbol}{fmtNum(b.amount)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, b.pct)}%`, background: color }} />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums w-9 text-right shrink-0">{b.pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                  {canExpand && isOpen && (
                    <div className="ml-10 mt-2 space-y-1.5 pl-3 border-l-2" style={{ borderColor: `${color}40` }}>
                      {b.platforms.map(p => (
                        <div key={p.platform} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{platformLabel(b.category, p.platform)}</span>
                          <span className="font-semibold tabular-nums">{symbol}{fmtNum(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sales by channel — combined across every store when All Stores selected ──
// Reuses the same per-store `channels` breakdown already computed by
// useStoreSalesPulse for the Revenue KPI (current_total_price, KSA-shifted,
// current vs previous period) — no new RPC or fetch needed.

interface ChannelRow { key: string; name: string; color: string; amount: number; orders: number; pct: number }

function ChannelBreakdownCard({ channels, symbol, subtitle, loading }: {
  channels: ChannelRow[];
  symbol: string;
  subtitle: string;
  loading: boolean;
}) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#e0f2fe", color: "#0284c7" }}>
            <Share2 size={12} strokeWidth={2.2} />
          </span>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No sales this period.</p>
        ) : (
          <div className="space-y-4">
            {channels.map((c, idx) => (
              <div key={c.key} className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${c.color}1a`, color: c.color }}>
                  <Share2 size={13} strokeWidth={2.2} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium truncate">
                      {c.name}
                      {idx === 0 && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-sky-700 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200 dark:border-sky-800 shrink-0">
                          Top
                        </Badge>
                      )}
                    </span>
                    <span className="text-sm font-bold tabular-nums shrink-0">{symbol}{fmtNum(c.amount)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, c.pct)}%`, background: c.color }} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-9 text-right shrink-0">{c.pct.toFixed(0)}%</span>
                    <span className="text-[10px] text-muted-foreground w-16 text-right shrink-0">{c.orders} order{c.orders === 1 ? "" : "s"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sales bridge: Gross -> Discounts -> Net (Returns not tracked, disclosed) ──

interface DiscountTierSummary { tier: number; orders: number; revenue: number }

function tierLabel(tier: number): string {
  if (tier === 0) return "No Discount";
  if (tier >= 35) return "35%+";
  return `${tier}%`;
}

function SalesBridgeCard({ grossSales, discounts, netSales, orderCount, symbol, loading, tiersExpanded, onToggleTiers, tiers, tiersLoading }: {
  grossSales: number; discounts: number; netSales: number; orderCount: number; symbol: string; loading: boolean;
  tiersExpanded: boolean; onToggleTiers: () => void; tiers: DiscountTierSummary[]; tiersLoading: boolean;
}) {
  const discountPct = grossSales > 0 ? (discounts / grossSales) * 100 : 0;
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Gross → Discounts → Net</h3>
          {!loading && <span className="text-xs text-muted-foreground">{fmtNum(orderCount)} order{orderCount === 1 ? "" : "s"}</span>}
          <TooltipProvider delayDuration={100}>
            <UiTooltip>
              <TooltipTrigger asChild>
                <button className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary shrink-0" aria-label="Methodology">
                  <Info size={9} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] p-2.5 text-left">
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Gross Sales is derived as Net Sales + Discounts, so it always matches the Net Sales figure shown elsewhere on this page. <b className="text-foreground">Returns/refunds are not included</b> — this dashboard doesn't sync that field from Shopify yet. For verified return figures, check the monthly PDF performance report for this store.
                </p>
              </TooltipContent>
            </UiTooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : (
          <div className="flex items-stretch">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "#eef2ff", color: "#6366f1" }}>
                  <TrendingUp size={11} strokeWidth={2.2} />
                </span>
                Gross Sales
              </div>
              <div className="text-lg font-bold tabular-nums tracking-tight truncate">{fmtC(grossSales, symbol)}</div>
            </div>

            <div className="flex items-center justify-center px-1.5 text-muted-foreground/30 shrink-0">
              <ChevronRight size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "#fee2e2", color: "#dc2626" }}>
                  <Percent size={11} strokeWidth={2.2} />
                </span>
                Discounts
              </div>
              <div className="text-lg font-bold tabular-nums tracking-tight truncate text-red-600 dark:text-red-400">−{fmtC(discounts, symbol)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{discountPct.toFixed(1)}% of gross</div>
            </div>

            <div className="flex items-center justify-center px-1.5 text-muted-foreground/30 shrink-0">
              <ChevronRight size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "#d1fae5", color: "#059669" }}>
                  <Coins size={11} strokeWidth={2.2} />
                </span>
                Net Sales
              </div>
              <div className="text-lg font-bold tabular-nums tracking-tight truncate text-emerald-600 dark:text-emerald-400">{fmtC(netSales, symbol)}</div>
            </div>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t">
          Returns not included — not synced to this dashboard yet. See the monthly PDF report for verified figures.
        </p>
        {!loading && (
          <button
            onClick={onToggleTiers}
            className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline mt-2 self-start"
          >
            <ChevronRight size={11} className={cn("transition-transform", tiersExpanded && "rotate-90")} />
            {tiersExpanded ? "Hide" : "View"} by discount tier
          </button>
        )}
        {tiersExpanded && (
          <div className="mt-2 pt-2 border-t">
            {tiersLoading ? (
              <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
            ) : tiers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">No orders this period.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium pb-1">Tier</th>
                    <th className="text-right font-medium pb-1">Orders</th>
                    <th className="text-right font-medium pb-1">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map(t => (
                    <tr key={t.tier} className="border-t border-border/50">
                      <td className="py-1.5">{tierLabel(t.tier)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtNum(t.orders)}</td>
                      <td className="py-1.5 text-right tabular-nums font-semibold">{fmtC(t.revenue, symbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cart abandonment — live from Shopify's /checkouts.json, synced every ──
// 15 min by the existing shopify-sync edge function. Not an approximation.
// Single store: the 3-stat flow below. All Stores: a per-store breakdown
// instead of one blended number — abandonment rate varies hugely by store
// (e.g. 58% vs 23%), so a single combined figure would hide which store
// actually needs attention.

const ABANDONMENT_FOOTNOTE = "Live from Shopify's checkout data, synced every 15 minutes · online-store channel only (excludes POS & draft orders) · counts checkouts not yet recovered.";

function AbandonmentCard({ abandonedCount, revenueAtRisk, abandonmentRate, symbol, hasSynced, loading }: {
  abandonedCount: number; revenueAtRisk: number; abandonmentRate: number | null;
  symbol: string; hasSynced: boolean; loading: boolean;
}) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#ffe4e6", color: "#e11d48" }}>
            <ShoppingCart size={12} strokeWidth={2.2} />
          </span>
          <span className="text-xs text-muted-foreground">This month</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : !hasSynced ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Not synced for this store yet.</p>
        ) : (
          <div className="flex items-stretch">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "#ffe4e6", color: "#e11d48" }}>
                  <ShoppingCart size={11} strokeWidth={2.2} />
                </span>
                Abandoned Checkouts
              </div>
              <div className="text-lg font-bold tabular-nums tracking-tight truncate">{fmtNum(abandonedCount)}</div>
            </div>

            <div className="flex items-center justify-center px-1.5 text-muted-foreground/30 shrink-0">
              <ChevronRight size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "#fee2e2", color: "#dc2626" }}>
                  <Coins size={11} strokeWidth={2.2} />
                </span>
                Revenue at Risk
              </div>
              <div className="text-lg font-bold tabular-nums tracking-tight truncate text-red-600 dark:text-red-400">{fmtC(revenueAtRisk, symbol)}</div>
            </div>

            <div className="flex items-center justify-center px-1.5 text-muted-foreground/30 shrink-0">
              <ChevronRight size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "#fef3c7", color: "#d97706" }}>
                  <Percent size={11} strokeWidth={2.2} />
                </span>
                Abandonment Rate
              </div>
              <div className="text-lg font-bold tabular-nums tracking-tight truncate">{abandonmentRate !== null ? `${abandonmentRate.toFixed(1)}%` : "—"}</div>
            </div>
          </div>
        )}
        {hasSynced && !loading && (
          <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t">{ABANDONMENT_FOOTNOTE}</p>
        )}
      </CardContent>
    </Card>
  );
}

interface StoreAbandonmentRow {
  storeId: string; storeName: string; color: string;
  abandonedCount: number; revenueAtRisk: number; currencySymbol: string;
  rate: number | null; hasSynced: boolean; sarRisk: number;
}

function AbandonmentByStoreCard({ rows, loading }: { rows: StoreAbandonmentRow[]; loading: boolean }) {
  const synced = rows.filter(r => r.hasSynced);
  const totalSar = synced.reduce((s, r) => s + r.sarRisk, 0);
  const sorted = [...synced].sort((a, b) => b.sarRisk - a.sarRisk);
  const unsynced = rows.filter(r => !r.hasSynced);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#ffe4e6", color: "#e11d48" }}>
            <ShoppingCart size={12} strokeWidth={2.2} />
          </span>
          <span className="text-xs text-muted-foreground">By store</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Not synced for any store yet.</p>
        ) : (
          <div className="space-y-4">
            {sorted.map((r, idx) => {
              const pct = totalSar > 0 ? (r.sarRisk / totalSar) * 100 : 0;
              return (
                <div key={r.storeId} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${r.color}1a`, color: r.color }}>
                    <ShoppingCart size={13} strokeWidth={2.2} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-medium truncate">
                        {r.storeName}
                        {idx === 0 && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800 shrink-0">
                            Highest Risk
                          </Badge>
                        )}
                      </span>
                      <span className="text-sm font-bold tabular-nums shrink-0 text-red-600 dark:text-red-400">{fmtC(r.revenueAtRisk, r.currencySymbol)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, pct)}%`, background: r.color }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-9 text-right shrink-0">{r.rate !== null ? `${r.rate.toFixed(0)}%` : "—"}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">{r.abandonedCount} abandoned</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {unsynced.length > 0 && (
              <p className="text-[11px] text-muted-foreground pt-1">
                Not synced yet: {unsynced.map(r => r.storeName).join(", ")}.
              </p>
            )}
          </div>
        )}
        {sorted.length > 0 && !loading && (
          <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t">{ABANDONMENT_FOOTNOTE}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Marketing & Traffic (GA4) — synced daily via ga4-sync edge function ───
// GA4's most recent 1-2 days are frequently incomplete (engaged-session
// data settles over 24-48h), so very recent days can show an anomalously
// high bounce rate that isn't real user behavior — disclosed via footnote
// rather than silently excluded (excluding days would be its own source of
// error — no reliable way to know which days are "done" processing).

// "Is Marketing Paying Off?" — a blended Cost-per-Sale vs Revenue-per-Sale
// verdict, not per-sale ad attribution (spreads total ad spend across ALL
// sales that month, including ones that cost nothing to win). Simpler than
// true attribution, and still shows the thing that matters: is spend
// growing faster than sales, or slower.
function MarketingRoiCard({ costPerSale, revenuePerSale, costPerSaleDelta, orderCount, symbol, hasData, loading }: {
  costPerSale: number | null; revenuePerSale: number | null; costPerSaleDelta: number | null; orderCount: number;
  symbol: string; hasData: boolean; loading: boolean;
}) {
  const ratio = costPerSale && costPerSale > 0 && revenuePerSale !== null ? revenuePerSale / costPerSale : null;
  const verdict = ratio === null ? null : ratio >= 2 ? "profitable" : ratio >= 1 ? "even" : "losing";
  const verdictMeta = {
    profitable: { label: "✓ PROFITABLE", bg: "#d1fae5", fg: "#047857" },
    even: { label: "⚠ BREAKING EVEN", bg: "#fef3c7", fg: "#b45309" },
    losing: { label: "✕ LOSING MONEY", bg: "#fee2e2", fg: "#b91c1c" },
  } as const;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#ede9fe", color: "#7c3aed" }}>
            <TrendingUp size={12} strokeWidth={2.2} />
          </span>
          <span className="text-xs text-muted-foreground">{hasData && !loading ? `Based on ${fmtNum(orderCount)} sales this month` : "This month"}</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center items-center text-center">
        {loading ? (
          <div className="space-y-3 w-full">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : !hasData || verdict === null || costPerSale === null || revenuePerSale === null ? (
          <p className="text-sm text-muted-foreground py-4">No ad spend recorded this month yet.</p>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: verdictMeta[verdict].bg, color: verdictMeta[verdict].fg }}>
              {verdictMeta[verdict].label}
            </span>
            <p className="text-lg font-extrabold leading-snug mb-1">
              You spend <span style={{ color: "#dc2626" }}>{fmtC(costPerSale, symbol)}</span> to win a sale worth <span style={{ color: "#059669" }}>{fmtC(revenuePerSale, symbol)}</span>
            </p>
            <p className="text-xs text-muted-foreground mb-5">
              {ratio !== null ? `That's a ${ratio.toFixed(1)}× return on every advertising ${symbol.trim() || "unit"} spent` : ""}
            </p>
            <div className="flex items-end justify-center gap-8 mb-2">
              <div className="flex flex-col items-center">
                <div className="w-12 rounded-t-lg" style={{ height: 34, background: "linear-gradient(180deg,#fca5a5,#ef4444)" }} />
                <div className="text-[11px] text-muted-foreground mt-2">Cost per Sale</div>
                <div className="text-base font-extrabold text-red-600 dark:text-red-400">{fmtC(costPerSale, symbol)}</div>
              </div>
              <div className="flex flex-col items-center">
                <div className="w-12 rounded-t-lg" style={{ height: Math.min(88, Math.max(34, 34 * (ratio ?? 1))), background: "linear-gradient(180deg,#6ee7b7,#059669)" }} />
                <div className="text-[11px] text-muted-foreground mt-2">Revenue per Sale</div>
                <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">{fmtC(revenuePerSale, symbol)}</div>
              </div>
            </div>
            {costPerSaleDelta !== null && (
              <span className={cn(
                "inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full mt-2",
                costPerSaleDelta <= 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
              )}>
                {costPerSaleDelta <= 0 ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                {Math.abs(costPerSaleDelta)}% {costPerSaleDelta <= 0 ? "cheaper" : "more expensive"} per sale vs last month
              </span>
            )}
            <div className="w-full mt-5 rounded-xl border border-violet-500/15 bg-violet-500/5 dark:bg-violet-500/10 p-3.5 text-left">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-violet-600 dark:text-violet-400 shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">How this is worked out</span>
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                This month's ad spend and net sales are each divided by your {fmtNum(orderCount)} sales, giving <b className="text-foreground">{fmtC(costPerSale, symbol)} spent</b> and <b className="text-foreground">{fmtC(revenuePerSale, symbol)} earned</b> per sale. {ratio !== null && <>Revenue per sale ÷ cost per sale = <b className="text-foreground">{ratio.toFixed(1)}×</b> — that's total revenue, not profit, for every {symbol.trim() || "unit"}1 put into ads.</>}
              </p>
            </div>
          </>
        )}
        <p className="text-[10px] text-muted-foreground mt-4 pt-2 border-t w-full">
          Blended across all {fmtNum(orderCount)} sales this month, not just ad-attributed ones — see "Where Your Sales Really Come From" for the paid vs. free split.
        </p>
      </CardContent>
    </Card>
  );
}

// "Where Your Sales Really Come From" — classifies each online-store order
// as paid/organic/direct using its landing_site. "Paid" requires a real
// ad-click ID (gclid/fbclid/ttclid/gbraid/wbraid), not just utm_source=
// google — Shopify's free Google Shopping listing sync also stamps
// utm_source=google on completely free traffic (confirmed on real order
// data before this was built).
export interface TrafficSourceCardRow { source: "paid" | "organic" | "direct"; orders: number; revenue: number }

const TRAFFIC_SOURCE_META = {
  paid: { label: "Paid Ads", desc: "Came from a Google/Meta/TikTok ad click", color: "#6366f1" },
  organic: { label: "Free/Organic", desc: "Search, free listings, social — no ad spend", color: "#10b981" },
  direct: { label: "Direct", desc: "Typed the URL, bookmarks, no trace", color: "#94a3b8" },
} as const;

function TrafficSourceCard({ rows, symbol, loading }: { rows: TrafficSourceCardRow[]; symbol: string; loading: boolean }) {
  const total = rows.reduce((sum, r) => sum + r.orders, 0);
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#fef3c7", color: "#d97706" }}>
            <Globe size={12} strokeWidth={2.2} />
          </span>
          <span className="text-xs text-muted-foreground">This month</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No online-store sales this period.</p>
        ) : (
          <>
            <div className="flex items-center justify-between pb-3 mb-3 border-b">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</span>
              <span className="text-sm font-bold tabular-nums">{fmtNum(total)} orders · {fmtC(rows.reduce((sum, r) => sum + r.revenue, 0), symbol)}</span>
            </div>
            <div className="flex h-4 rounded-lg overflow-hidden mb-4">
              {rows.map(r => total > 0 && r.orders > 0 && (
                <div key={r.source} style={{ width: `${(r.orders / total) * 100}%`, background: TRAFFIC_SOURCE_META[r.source].color }} />
              ))}
            </div>
            <div className="space-y-1">
              {rows.map(r => {
                const meta = TRAFFIC_SOURCE_META[r.source];
                return (
                  <div key={r.source} className="flex items-center gap-3 py-2 border-b last:border-0 border-border/50">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: meta.color }} />
                    <span className="text-sm font-semibold w-28 shrink-0">{meta.label}</span>
                    <span className="text-xs text-muted-foreground flex-1 truncate hidden sm:block">{meta.desc}</span>
                    <span className="text-xs text-muted-foreground w-20 text-right shrink-0">{fmtNum(r.orders)} orders</span>
                    <span className="text-sm font-bold tabular-nums w-24 text-right shrink-0">{fmtC(r.revenue, symbol)}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t">
              Online Store orders only — excludes POS, Draft Orders, and other marketplace channels (Amazon/eBay/TikTok Shop, etc.).
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// "Marketing Spend vs. Sales" — ad spend as a % of revenue, overall and per
// platform. Pure arithmetic on data already on this page (Cost Entries +
// the Sales Bridge's Net Sales) — no new data source.
function MarketingSpendCard({ totalPct, platforms, netSales, symbol, loading }: {
  totalPct: number; platforms: { platform: string; pct: number }[]; netSales: number; symbol: string; loading: boolean;
}) {
  const platformColor: Record<string, string> = { google: "#4285F4", meta: "#1877F2", tiktok: "#69C9D0", shopify: "#95BF47", other: "#94a3b8" };
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#ede9fe", color: "#7c3aed" }}>
            <Percent size={12} strokeWidth={2.2} />
          </span>
          <span className="text-xs text-muted-foreground">This month</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : platforms.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No ad spend recorded this month.</p>
        ) : (
          <>
            <div className="text-center pb-4 mb-1">
              <div className="text-4xl font-black" style={{ color: "#7c3aed" }}>{totalPct.toFixed(0)}%</div>
              <div className="text-xs text-muted-foreground mt-1.5">of every sale went back into ads</div>
            </div>
            <div className="space-y-2.5">
              {platforms.map(p => (
                <div key={p.platform} className="flex items-center gap-3">
                  <span className="text-xs font-semibold w-16 shrink-0 capitalize">{p.platform}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.pct / Math.max(totalPct, 1)) * 100)}%`, background: platformColor[p.platform] ?? "#94a3b8" }} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right shrink-0">{p.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
            <div className="w-full mt-5 rounded-xl border border-violet-500/15 bg-violet-500/5 dark:bg-violet-500/10 p-3.5 text-left">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-violet-600 dark:text-violet-400 shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">How this is worked out</span>
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Each platform's ad spend this month is divided by your Net Sales (<b className="text-foreground">{fmtC(netSales, symbol)}</b>) to get its share. {platforms[0] && <>{platforms[0].platform === "other" ? "Other" : platforms[0].platform.charAt(0).toUpperCase() + platforms[0].platform.slice(1)} spent enough to equal <b className="text-foreground">{platforms[0].pct.toFixed(1)}%</b> of sales. </>}Add every platform together and you get <b className="text-foreground">{totalPct.toFixed(0)}%</b> — the total slice of this month's sales that went back into ads.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ChannelTrafficRow { key: string; sessions: number; pct: number }

function TrafficByChannelCard({ channels, subtitle, loading }: {
  channels: ChannelTrafficRow[]; subtitle: string; loading: boolean;
}) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#e0e7ff", color: "#4f46e5" }}>
            <Globe size={12} strokeWidth={2.2} />
          </span>
          <h3 className="text-sm font-semibold">Traffic by Channel</h3>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 flex-1 flex flex-col justify-center">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Not synced for this store yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 mb-1 border-b">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Sessions</span>
              <span className="text-lg font-extrabold tabular-nums">{fmtNum(channels.reduce((sum, c) => sum + c.sessions, 0))}</span>
            </div>
            {channels.map((c, idx) => {
              const color = storeColor(idx + 4); // offset from store colors so it reads as a distinct palette
              return (
                <div key={c.key} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}>
                    <Globe size={13} strokeWidth={2.2} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-medium truncate">
                        {c.key}
                        {idx === 0 && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 shrink-0">
                            Top
                          </Badge>
                        )}
                      </span>
                      <span className="text-sm font-bold tabular-nums shrink-0">{fmtNum(c.sessions)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, c.pct)}%`, background: color }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-9 text-right shrink-0">{c.pct.toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Net Sales trend, last 6 months ─────────────────────────────────────────
// All Stores: indexed to 100 at the earliest month, so stores in different
// currencies can share one chart without needing an FX rate for every past
// month (a real risk — the FX table only fills in for months someone has
// actually opened). Single store: absolute Net Sales in its own currency.

function TrendChart({ mode, series, loading }: {
  mode: "indexed" | "native";
  series: { key: string; name: string; color: string; symbol?: string; points: { month: string; value: number }[] }[];
  loading: boolean;
}) {
  const months = series[0]?.points.map(p => p.month) ?? [];
  const chartData = months.map((month, i) => {
    const row: Record<string, number | string> = { month };
    for (const s of series) row[s.key] = s.points[i]?.value ?? 0;
    return row;
  });

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <LineChartIcon size={14} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{mode === "indexed" ? "Indexed to 100 at the earliest month — compares growth, not scale" : "Last 6 months"}</span>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-4 pt-1">
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">Not enough history yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={mode === "indexed" ? 36 : 56} />
              <RechartsTooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, name: string) => {
                  const s = series.find(x => x.key === name);
                  if (mode === "indexed") return [value.toFixed(0), s?.name ?? name];
                  return [fmtC(value, s?.symbol ?? ""), s?.name ?? name];
                }}
              />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => series.find(s => s.key === value)?.name ?? value} />}
              {series.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Store ranking by Net Sales (SAR) ───────────────────────────────────────

function RankingTable({ rows, loading }: { rows: StoreRow[]; loading: boolean }) {
  const ranked = useMemo(() => [...rows].sort((a, b) => (b.netSar ?? -Infinity) - (a.netSar ?? -Infinity)), [rows]);
  const maxNet = Math.max(1, ...ranked.map(r => r.netSar ?? 0));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                {["Rank", "Store", "Net Sales (SAR)", "Cost Ratio", "Status"].map((h, i) => (
                  <th key={i} className={cn("px-4 py-2.5 font-medium text-muted-foreground text-left", i > 1 && "text-right", i === 0 && "w-14")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {Array.from({ length: 5 }).map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className={cn("h-3", j === 1 ? "w-20" : "w-12")} /></td>)}
                  </tr>
                ))
              ) : ranked.map((r, idx) => {
                const color = storeColor(idx);
                const ratio = r.revenueSar && r.revenueSar > 0 && r.costsSar !== null ? (r.costsSar / r.revenueSar) * 100 : null;
                const status =
                  ratio === null ? { label: "No Cost Data", cls: "text-muted-foreground bg-muted" } :
                  ratio < 10 ? { label: "Healthy", cls: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" } :
                  ratio < 25 ? { label: "Watch", cls: "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800" } :
                  { label: "At Risk", cls: "text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-800" };
                return (
                  <tr key={r.store.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs" style={{ background: color + "22", color }}>{idx + 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="font-medium">{r.store.store_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, ((r.netSar ?? 0) / maxNet) * 100)}%`, background: color }} />
                        </div>
                        <span className="font-bold tabular-nums w-16 text-right">{r.netSar !== null ? fmtNum(r.netSar) : "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {ratio !== null ? <span className={ratio >= 25 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>{ratio.toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", status.cls)}>{status.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function PnLDashboard() {
  const { stores, selectedStoreId, selectedStore, isAllStores } = useStore();
  const { isAdmin } = useRole();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const prevKey = prevMonthKey(year, month);

  const bounds = useMemo(() => getMonthBounds(year, month), [year, month]);
  // GA4 dates are plain calendar dates in each property's own reporting
  // timezone — no KSA UTC-shift needed, unlike bounds above.
  const ga4StartDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const ga4EndDate = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const { data: ga4ChannelRows = [], isLoading: ga4ChannelLoading } = useGa4ChannelSummary(ga4StartDate, ga4EndDate);
  const { data: salesPulse = [], isLoading: revenueLoading } = useStoreSalesPulse(bounds, true);
  const { data: entries = [], isLoading: entriesLoading } = useAllCostEntries(monthKey);
  const { data: prevEntries = [] } = useAllCostEntries(prevKey);
  const { data: fxData, isError: fxError, refetch: refetchFxRates } = useEnsureFxRates(monthKey);
  const fxRates = fxData?.rates ?? {};
  const { data: bridgeRows = [], isLoading: bridgeLoading } = useSalesBridge(bounds);
  const prevBounds = useMemo(() => {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    return getMonthBounds(prevYear, prevMonth);
  }, [year, month]);
  const { data: prevBridgeRows = [] } = useSalesBridge(prevBounds);
  const bridgeByStoreForRoi = new Map(bridgeRows.map(b => [b.storeId, b]));
  const { data: trafficSourceRows = [], isLoading: trafficSourceLoading } = useTrafficSource(bounds);
  const { data: abandonmentRows = [], isLoading: abandonmentLoading } = useCheckoutAbandonment(bounds);

  // Last 6 full calendar months, ending with the month currently in view.
  const trendBounds = useMemo(() => {
    const startMonth = month - 5 <= 0 ? month - 5 + 12 : month - 5;
    const startYear = month - 5 <= 0 ? year - 1 : year;
    return { startISO: getMonthBounds(startYear, startMonth).startISO, endISO: bounds.endISO };
  }, [year, month, bounds.endISO]);
  const { data: trendData = [], isLoading: trendLoading } = useMonthlyNetSalesTrend(trendBounds.startISO, trendBounds.endISO);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CostEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [ledgerStoreFilter, setLedgerStoreFilter] = useState<string>("all"); // local to the ledger, only relevant in All Stores mode
  const { remove } = useCostEntryMutations();
  const { order: sectionOrder, save: saveLayout, reset: resetLayout } = usePageLayout("pnl", PNL_DEFAULT_ORDER);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [showDiscountTiers, setShowDiscountTiers] = useState(false);
  const { data: discountTierRows = [], isLoading: discountTiersLoading } = useDiscountTiers(bounds, showDiscountTiers);

  const activeStores = stores.filter(s => s.is_active);
  const loading = revenueLoading || entriesLoading;

  const rows: StoreRow[] = useMemo(() => activeStores.map(s => {
    const pulse = salesPulse.find(p => p.storeId === s.id);
    const revenue = pulse?.revenue ?? 0;
    const prevRevenue = pulse?.prevRevenue ?? 0;
    const storeEntries = entries.filter(e => e.store_id === s.id);
    const costs = storeEntries.reduce((sum, e) => sum + Number(e.amount), 0);
    const prevCosts = prevEntries.filter(e => e.store_id === s.id).reduce((sum, e) => sum + Number(e.amount), 0);
    const net = revenue - costs;
    const prevNet = prevRevenue - prevCosts;
    const revenueSar = currencyToSar(revenue, s.currency ?? "GBP", fxRates);
    const costsSar = currencyToSar(costs, s.currency ?? "GBP", fxRates);
    const prevRevenueSar = currencyToSar(prevRevenue, s.currency ?? "GBP", fxRates);
    const prevCostsSar = currencyToSar(prevCosts, s.currency ?? "GBP", fxRates);
    const prevNetSar = currencyToSar(prevNet, s.currency ?? "GBP", fxRates);
    const netSar = revenueSar !== null && costsSar !== null ? revenueSar - costsSar : null;
    // Percentage deltas computed natively (same currency on both sides) — accurate
    // for a single store regardless of whether that month's FX rate is on record.
    return {
      store: s, revenue, costs, net,
      prevRevenue, prevCosts, prevNet,
      revenueDelta: pulse?.revenueDelta ?? null,
      costsDelta: pctDelta(costs, prevCosts),
      netDelta: pctDelta(net, prevNet),
      revenueSar, costsSar, prevRevenueSar, prevCostsSar, netSar, prevNetSar,
      entries: storeEntries,
      channels: pulse?.channels ?? [],
    };
  }), [activeStores, salesPulse, entries, prevEntries, fxRates]);

  const missingRates = rows.some(r => r.netSar === null);
  const excludedStoreNames = rows.filter(r => r.netSar === null).map(r => r.store.store_name);

  const grandTotal = rows.reduce((acc, r) => {
    if (r.revenueSar === null || r.costsSar === null) return acc;
    return {
      revenue: acc.revenue + r.revenueSar,
      costs: acc.costs + r.costsSar,
      prevRevenue: acc.prevRevenue + (r.prevRevenueSar ?? 0),
      prevCosts: acc.prevCosts + (r.prevCostsSar ?? 0),
      prevNet: acc.prevNet + (r.prevNetSar ?? 0),
    };
  }, { revenue: 0, costs: 0, prevRevenue: 0, prevCosts: 0, prevNet: 0 });

  const groupRevenueDelta = pctDelta(grandTotal.revenue, grandTotal.prevRevenue);
  const groupCostsDelta = pctDelta(grandTotal.costs, grandTotal.prevCosts);
  const groupNetDelta = pctDelta(grandTotal.revenue - grandTotal.costs, grandTotal.prevNet);

  // Category totals, converted to SAR and combined across every store — the
  // single source both the "Biggest Cost" KPI and the breakdown card read from.
  const categoryBreakdown = useMemo(() => {
    const byCategory = new Map<string, number>();
    const byCategoryPlatform = new Map<string, Map<string, number>>();
    for (const r of rows) {
      for (const e of r.entries) {
        const amtSar = currencyToSar(Number(e.amount), r.store.currency ?? "GBP", fxRates);
        if (amtSar === null) continue;
        byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + amtSar);
        if (e.platform) {
          if (!byCategoryPlatform.has(e.category)) byCategoryPlatform.set(e.category, new Map());
          const pm = byCategoryPlatform.get(e.category)!;
          pm.set(e.platform, (pm.get(e.platform) ?? 0) + amtSar);
        }
      }
    }
    const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
    return [...byCategory.entries()]
      .map(([category, amount]) => ({
        category, amount, pct: total > 0 ? (amount / total) * 100 : 0,
        platforms: [...(byCategoryPlatform.get(category)?.entries() ?? [])]
          .map(([platform, amt]) => ({ platform, amount: amt }))
          .sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [rows, fxRates]);

  const groupBiggestCostLabel = categoryBreakdown.length === 0 ? "None yet" : categoryLabel(categoryBreakdown[0].category);

  const displayRows = isAllStores ? rows : rows.filter(r => r.store.id === selectedStoreId);

  // KPI row reflects whatever scope is selected: the group total in SAR for All
  // Stores, or that one store's own native-currency numbers — not the group
  // total again, which is what was showing regardless of the store picker before.
  const kpiOrderCount = isAllStores
    ? activeStores.reduce((sum, s) => sum + (bridgeByStoreForRoi.get(s.id)?.orderCount ?? 0), 0)
    : selectedStoreId ? bridgeByStoreForRoi.get(selectedStoreId)?.orderCount ?? 0 : 0;

  const summary = isAllStores
    ? {
        revenue: grandTotal.revenue, costs: grandTotal.costs, net: grandTotal.revenue - grandTotal.costs,
        prevRevenue: grandTotal.prevRevenue, prevCosts: grandTotal.prevCosts, prevNet: grandTotal.prevNet,
        revenueDelta: groupRevenueDelta, costsDelta: groupCostsDelta, netDelta: groupNetDelta,
        symbol: "SAR ", unit: "(SAR)", biggestCostLabel: groupBiggestCostLabel, orderCount: kpiOrderCount,
      }
    : {
        revenue: displayRows[0]?.revenue ?? 0, costs: displayRows[0]?.costs ?? 0, net: displayRows[0]?.net ?? 0,
        prevRevenue: displayRows[0]?.prevRevenue ?? 0, prevCosts: displayRows[0]?.prevCosts ?? 0, prevNet: displayRows[0]?.prevNet ?? 0,
        revenueDelta: displayRows[0]?.revenueDelta ?? null, costsDelta: displayRows[0]?.costsDelta ?? null, netDelta: displayRows[0]?.netDelta ?? null,
        symbol: selectedStore?.currency_symbol ?? "", unit: "",
        biggestCostLabel: biggestCategoryFor(displayRows[0]?.entries ?? []), orderCount: kpiOrderCount,
      };

  // Category breakdown: SAR-combined across every store for All Stores, that
  // one store's own native-currency split otherwise — no FX needed there, so
  // a single store's breakdown is never blocked by a missing exchange rate.
  const displayCategoryBreakdown = useMemo(() => {
    if (isAllStores) return categoryBreakdown;
    const entries = displayRows[0]?.entries ?? [];
    const byCategory = new Map<string, number>();
    const byCategoryPlatform = new Map<string, Map<string, number>>();
    for (const e of entries) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));
      if (e.platform) {
        if (!byCategoryPlatform.has(e.category)) byCategoryPlatform.set(e.category, new Map());
        const pm = byCategoryPlatform.get(e.category)!;
        pm.set(e.platform, (pm.get(e.platform) ?? 0) + Number(e.amount));
      }
    }
    const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
    return [...byCategory.entries()]
      .map(([category, amount]) => ({
        category, amount, pct: total > 0 ? (amount / total) * 100 : 0,
        platforms: [...(byCategoryPlatform.get(category)?.entries() ?? [])]
          .map(([platform, amt]) => ({ platform, amount: amt }))
          .sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [isAllStores, categoryBreakdown, displayRows]);

  // Sales by channel: SAR-combined across every store's channels for All
  // Stores (converted per store, same missing-rate rule as everything else
  // on this page), that one store's own native-currency channels otherwise.
  const displayChannelBreakdown = useMemo(() => {
    const targetRows = isAllStores ? rows : displayRows;
    const map = new Map<string, { name: string; color: string; amount: number; orders: number }>();
    for (const r of targetRows) {
      for (const c of r.channels) {
        const amt = isAllStores ? currencyToSar(c.revenue, r.store.currency ?? "GBP", fxRates) : c.revenue;
        if (amt === null) continue;
        if (!map.has(c.key)) map.set(c.key, { name: c.name, color: c.color, amount: 0, orders: 0 });
        const entry = map.get(c.key)!;
        entry.amount += amt;
        entry.orders += c.orders;
      }
    }
    const total = [...map.values()].reduce((a, b) => a + b.amount, 0);
    return [...map.entries()]
      .map(([key, v]) => ({ key, name: v.name, color: v.color, amount: v.amount, orders: v.orders, pct: total > 0 ? (v.amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [isAllStores, rows, displayRows, fxRates]);

  // Sales bridge summary, same scope rule as the KPI row above.
  const bridgeByStore = new Map(bridgeRows.map(b => [b.storeId, b]));
  const bridgeSummary = useMemo(() => {
    if (!isAllStores) {
      const b = selectedStoreId ? bridgeByStore.get(selectedStoreId) : undefined;
      return { grossSales: b?.grossSales ?? 0, discounts: b?.discounts ?? 0, netSales: b?.netSales ?? 0, orderCount: b?.orderCount ?? 0, symbol: selectedStore?.currency_symbol ?? "" };
    }
    let gross = 0, disc = 0, net = 0, orders = 0;
    for (const s of activeStores) {
      const b = bridgeByStore.get(s.id);
      if (!b) continue;
      orders += b.orderCount;
      const netSar = currencyToSar(b.netSales, s.currency ?? "GBP", fxRates);
      const discSar = currencyToSar(b.discounts, s.currency ?? "GBP", fxRates);
      if (netSar === null || discSar === null) continue;
      net += netSar; disc += discSar; gross += netSar + discSar;
    }
    return { grossSales: gross, discounts: disc, netSales: net, orderCount: orders, symbol: "SAR " };
  }, [isAllStores, selectedStoreId, selectedStore, bridgeRows, activeStores, fxRates]);

  // Cart abandonment summary, same scope rule as the KPI row above. Counts
  // (abandoned/completed) never need FX; only revenueAtRisk does for the
  // All Stores SAR total. A store that's never synced is excluded from the
  // combined total rather than silently counted as zero.
  const abandonmentByStore = new Map(abandonmentRows.map(a => [a.storeId, a]));
  const abandonmentSummary = useMemo(() => {
    if (!isAllStores) {
      const a = selectedStoreId ? abandonmentByStore.get(selectedStoreId) : undefined;
      const abandoned = a?.abandonedCount ?? 0;
      const completed = a?.completedOnlineOrders ?? 0;
      const total = abandoned + completed;
      return {
        abandonedCount: abandoned,
        revenueAtRisk: a?.revenueAtRisk ?? 0,
        abandonmentRate: total > 0 ? (abandoned / total) * 100 : null,
        symbol: selectedStore?.currency_symbol ?? "",
        hasSynced: a?.hasSynced ?? false,
      };
    }
    let abandoned = 0, completed = 0, revenueSar = 0, anySynced = false;
    for (const s of activeStores) {
      const a = abandonmentByStore.get(s.id);
      if (!a?.hasSynced) continue;
      anySynced = true;
      abandoned += a.abandonedCount;
      completed += a.completedOnlineOrders;
      const riskSar = currencyToSar(a.revenueAtRisk, s.currency ?? "GBP", fxRates);
      if (riskSar !== null) revenueSar += riskSar;
    }
    const total = abandoned + completed;
    return {
      abandonedCount: abandoned,
      revenueAtRisk: revenueSar,
      abandonmentRate: total > 0 ? (abandoned / total) * 100 : null,
      symbol: "SAR ",
      hasSynced: anySynced,
    };
  }, [isAllStores, selectedStoreId, selectedStore, abandonmentRows, activeStores, fxRates]);

  // Per-store abandonment breakdown for All Stores view — a single blended
  // number would hide which store actually needs attention (rates vary a
  // lot store to store, e.g. 58% vs 23%).
  const storeAbandonmentRows: StoreAbandonmentRow[] = useMemo(() => activeStores.map((s, idx) => {
    const a = abandonmentByStore.get(s.id);
    const abandoned = a?.abandonedCount ?? 0;
    const completed = a?.completedOnlineOrders ?? 0;
    const total = abandoned + completed;
    const revenueAtRisk = a?.revenueAtRisk ?? 0;
    const sarRisk = currencyToSar(revenueAtRisk, s.currency ?? "GBP", fxRates) ?? 0;
    return {
      storeId: s.id, storeName: s.store_name, color: storeColor(idx),
      abandonedCount: abandoned, revenueAtRisk, currencySymbol: s.currency_symbol ?? "",
      rate: total > 0 ? (abandoned / total) * 100 : null,
      hasSynced: a?.hasSynced ?? false, sarRisk,
    };
  }), [activeStores, abandonmentRows, fxRates]);

  // Collapsed to top 3 + "Other" — a CEO-glance view, not a full GA4
  // taxonomy dump (Direct/Organic/Paid Search/Paid Social/Referral/Email/
  // Cross-network/Unassigned/AI Assistant/... is 10+ rows nobody skims).
  const ga4ChannelBreakdown: ChannelTrafficRow[] = useMemo(() => {
    const targetIds = isAllStores ? activeStores.map(s => s.id) : [selectedStoreId].filter(Boolean) as string[];
    const map = new Map<string, number>();
    for (const row of ga4ChannelRows) {
      if (!targetIds.includes(row.storeId)) continue;
      map.set(row.channelGroup, (map.get(row.channelGroup) ?? 0) + row.sessions);
    }
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    const sorted = [...map.entries()]
      .map(([key, sessions]) => ({ key, sessions, pct: total > 0 ? (sessions / total) * 100 : 0 }))
      .sort((a, b) => b.sessions - a.sessions);
    if (sorted.length <= 4) return sorted;
    const top3 = sorted.slice(0, 3);
    const rest = sorted.slice(3);
    const otherSessions = rest.reduce((sum, r) => sum + r.sessions, 0);
    return [...top3, { key: `Everything else (${rest.length} sources)`, sessions: otherSessions, pct: total > 0 ? (otherSessions / total) * 100 : 0 }];
  }, [isAllStores, selectedStoreId, ga4ChannelRows, activeStores]);

  // "Is Marketing Paying Off?" — spreads total ad spend across ALL sales
  // this month (not just ad-attributed ones), so it's a blended efficiency
  // signal, not per-sale attribution. Same currency-scope rule as the rest
  // of the page: native for a single store, SAR-combined for All Stores.
  const prevBridgeByStore = new Map(prevBridgeRows.map(b => [b.storeId, b]));
  const marketingRoi = useMemo(() => {
    const sumAdSpend = (rows: CostEntry[], toSar: boolean, onlyStoreId: string | null) => {
      let total = 0;
      for (const e of rows) {
        if (e.category !== "ad_spend") continue;
        if (onlyStoreId && e.store_id !== onlyStoreId) continue;
        const store = activeStores.find(s => s.id === e.store_id);
        if (!store) continue;
        if (toSar) {
          const sar = currencyToSar(Number(e.amount), store.currency ?? "GBP", fxRates);
          if (sar !== null) total += sar;
        } else {
          total += Number(e.amount);
        }
      }
      return total;
    };

    if (!isAllStores) {
      const adSpend = sumAdSpend(entries, false, selectedStoreId);
      const prevAdSpend = sumAdSpend(prevEntries, false, selectedStoreId);
      const orderCount = selectedStoreId ? bridgeByStoreForRoi.get(selectedStoreId)?.orderCount ?? 0 : 0;
      const prevOrderCount = selectedStoreId ? prevBridgeByStore.get(selectedStoreId)?.orderCount ?? 0 : 0;
      const costPerSale = orderCount > 0 ? adSpend / orderCount : null;
      const prevCostPerSale = prevOrderCount > 0 ? prevAdSpend / prevOrderCount : null;
      const revenuePerSale = orderCount > 0 ? bridgeSummary.netSales / orderCount : null;
      return {
        costPerSale, revenuePerSale, orderCount,
        costPerSaleDelta: costPerSale !== null && prevCostPerSale !== null ? pctDelta(costPerSale, prevCostPerSale) : null,
        symbol: selectedStore?.currency_symbol ?? "",
        hasData: adSpend > 0 && orderCount > 0,
      };
    }

    const adSpend = sumAdSpend(entries, true, null);
    const prevAdSpend = sumAdSpend(prevEntries, true, null);
    const orderCount = activeStores.reduce((sum, s) => sum + (bridgeByStoreForRoi.get(s.id)?.orderCount ?? 0), 0);
    const prevOrderCount = activeStores.reduce((sum, s) => sum + (prevBridgeByStore.get(s.id)?.orderCount ?? 0), 0);
    const costPerSale = orderCount > 0 ? adSpend / orderCount : null;
    const prevCostPerSale = prevOrderCount > 0 ? prevAdSpend / prevOrderCount : null;
    const revenuePerSale = orderCount > 0 ? bridgeSummary.netSales / orderCount : null;
    return {
      costPerSale, revenuePerSale, orderCount,
      costPerSaleDelta: costPerSale !== null && prevCostPerSale !== null ? pctDelta(costPerSale, prevCostPerSale) : null,
      symbol: "SAR ",
      hasData: adSpend > 0 && orderCount > 0,
    };
  }, [isAllStores, selectedStoreId, selectedStore, entries, prevEntries, bridgeRows, prevBridgeRows, activeStores, fxRates, bridgeSummary.netSales]);

  // "Where Your Sales Really Come From" — paid/organic/direct, orders + revenue.
  const trafficSourceSummary: TrafficSourceCardRow[] = useMemo(() => {
    const targetRows = isAllStores ? trafficSourceRows : trafficSourceRows.filter(r => r.storeId === selectedStoreId);
    const map = new Map<string, { orders: number; revenueSar: number; revenueNative: number }>();
    for (const row of targetRows) {
      const store = activeStores.find(s => s.id === row.storeId);
      if (!store) continue;
      if (!map.has(row.source)) map.set(row.source, { orders: 0, revenueSar: 0, revenueNative: 0 });
      const entry = map.get(row.source)!;
      entry.orders += row.orders;
      entry.revenueNative += row.revenue;
      if (isAllStores) {
        const sar = currencyToSar(row.revenue, store.currency ?? "GBP", fxRates);
        if (sar !== null) entry.revenueSar += sar;
      }
    }
    const order = ["paid", "organic", "direct"] as const;
    return order.map(source => {
      const entry = map.get(source) ?? { orders: 0, revenueSar: 0, revenueNative: 0 };
      return { source, orders: entry.orders, revenue: isAllStores ? entry.revenueSar : entry.revenueNative };
    });
  }, [isAllStores, selectedStoreId, trafficSourceRows, activeStores, fxRates]);

  // "Marketing Spend vs. Sales" — ad spend as a % of revenue, overall and
  // per platform. Uses the same Net Sales figure as the Sales Bridge card.
  const marketingSpendBreakdown = useMemo(() => {
    const byPlatform = new Map<string, number>();
    for (const e of entries) {
      if (e.category !== "ad_spend") continue;
      if (!isAllStores && e.store_id !== selectedStoreId) continue;
      const store = activeStores.find(s => s.id === e.store_id);
      if (!store) continue;
      const amt = isAllStores ? currencyToSar(Number(e.amount), store.currency ?? "GBP", fxRates) : Number(e.amount);
      if (amt === null) continue;
      const platform = e.platform ?? "other";
      byPlatform.set(platform, (byPlatform.get(platform) ?? 0) + amt);
    }
    const netSales = bridgeSummary.netSales;
    const platforms = [...byPlatform.entries()]
      .map(([platform, amount]) => ({ platform, pct: netSales > 0 ? (amount / netSales) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);
    const totalPct = platforms.reduce((sum, p) => sum + p.pct, 0);
    return { totalPct, platforms };
  }, [isAllStores, selectedStoreId, entries, activeStores, fxRates, bridgeSummary.netSales]);

  // Discount tier breakdown for the Sales Bridge card's expandable table.
  // All Stores combines orders directly (counts, no FX needed) and revenue
  // in SAR; single store shows native currency. Only fetched once expanded
  // (see useDiscountTiers' `enabled` flag) — most people never open this.
  const discountTierSummary: DiscountTierSummary[] = useMemo(() => {
    const targetRows = isAllStores ? discountTierRows : discountTierRows.filter(r => r.storeId === selectedStoreId);
    const map = new Map<number, { orders: number; revenue: number }>();
    for (const row of targetRows) {
      const store = activeStores.find(s => s.id === row.storeId);
      if (!store) continue;
      const revenue = isAllStores ? currencyToSar(row.revenue, store.currency ?? "GBP", fxRates) : row.revenue;
      if (revenue === null) continue;
      if (!map.has(row.tier)) map.set(row.tier, { orders: 0, revenue: 0 });
      const entry = map.get(row.tier)!;
      entry.orders += row.orders;
      entry.revenue += revenue;
    }
    return [...map.entries()]
      .map(([tier, v]) => ({ tier, orders: v.orders, revenue: v.revenue }))
      .sort((a, b) => a.tier - b.tier);
  }, [isAllStores, selectedStoreId, discountTierRows, activeStores, fxRates]);

  // Net Sales trend — indexed to 100 in All Stores mode (avoids needing an FX
  // rate for every past month just to draw a line chart), native currency
  // for a single store.
  const trendSeries = useMemo(() => {
    const monthKeys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      let m = month - i, y = year;
      while (m <= 0) { m += 12; y -= 1; }
      monthKeys.push(`${y}-${String(m).padStart(2, "0")}`);
    }
    const monthLabels = monthKeys.map(k => {
      const [y, m] = k.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short" });
    });

    const targetStores = isAllStores ? activeStores : activeStores.filter(s => s.id === selectedStoreId);
    return targetStores.map((s, idx) => {
      const byMonth = new Map(trendData.filter(t => t.storeId === s.id).map(t => [t.monthStart.slice(0, 7), t.netSales]));
      const raw = monthKeys.map(k => byMonth.get(k) ?? 0);
      const base = raw.find(v => v !== 0) ?? 0;
      const values = isAllStores && base !== 0 ? raw.map(v => (v / base) * 100) : raw;
      return {
        key: s.id,
        name: s.store_name,
        color: storeColor(activeStores.findIndex(a => a.id === s.id)),
        symbol: s.currency_symbol ?? "",
        points: monthLabels.map((month, i) => ({ month, value: values[i] })),
      };
    });
  }, [trendData, activeStores, isAllStores, selectedStoreId, month, year]);

  const displayEntries = !isAllStores && selectedStoreId
    ? entries.filter(e => e.store_id === selectedStoreId)
    : ledgerStoreFilter === "all" ? entries : entries.filter(e => e.store_id === ledgerStoreFilter);
  const ledgerShowsStoreColumn = isAllStores && ledgerStoreFilter === "all";

  const openAdd = () => { setEditingEntry(null); setDialogOpen(true); };
  const openEdit = (e: CostEntry) => { setEditingEntry(e); setDialogOpen(true); };

  const handleExportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Store", "Category", "Platform", "Amount", "Currency", "Notes"].join(","),
      ...displayEntries.map(e => {
        const s = activeStores.find(st => st.id === e.store_id);
        return [q(s?.store_name ?? ""), q(categoryLabel(e.category)), q(platformLabel(e.category, e.platform)), q(Number(e.amount).toFixed(2)), q(e.currency), q(e.notes ?? "")].join(",");
      }),
      "",
      ["", "Total Revenue", "", summary.revenue.toFixed(2), summary.symbol.trim(), ""].join(","),
      ["", "Total Costs", "", summary.costs.toFixed(2), summary.symbol.trim(), ""].join(","),
      ["", "Net Sales", "", summary.net.toFixed(2), summary.symbol.trim(), ""].join(","),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PnL_${isAllStores ? "AllStores" : selectedStore?.store_name.replace(/\s+/g, "_") ?? "Store"}_${monthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    try {
      await remove.mutateAsync(deletingId);
      toast.success("Entry deleted");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  const sectionContent: Record<string, ReactNode> = {
    kpis: (
      // Summary KPIs — group total (SAR) for All Stores, that store's own
      // native-currency numbers otherwise
      <SummaryCards
        totalRevenue={summary.revenue}
        totalCosts={summary.costs}
        netSales={summary.net}
        prevRevenue={summary.prevRevenue}
        prevCosts={summary.prevCosts}
        prevNet={summary.prevNet}
        orderCount={summary.orderCount}
        revenueDelta={summary.revenueDelta}
        costsDelta={summary.costsDelta}
        netDelta={summary.netDelta}
        biggestCostLabel={summary.biggestCostLabel}
        symbol={summary.symbol}
        unit={summary.unit}
        loading={loading}
      />
    ),

    "revenue-costs": (
      // Revenue bridge + cost breakdown, side by side on wide screens — both
      // stretch to the taller card's height (whichever has more categories)
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <section className="flex flex-col">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Revenue</span>
            <h2 className="text-base font-semibold">Where the Money Comes From</h2>
          </div>
          <div className="flex-1">
            <SalesBridgeCard
              grossSales={bridgeSummary.grossSales}
              discounts={bridgeSummary.discounts}
              netSales={bridgeSummary.netSales}
              orderCount={bridgeSummary.orderCount}
              symbol={bridgeSummary.symbol}
              loading={loading}
              tiersExpanded={showDiscountTiers}
              onToggleTiers={() => setShowDiscountTiers(v => !v)}
              tiers={discountTierSummary}
              tiersLoading={discountTiersLoading}
            />
          </div>
        </section>

        {/* Cost breakdown by category — SAR-combined for All Stores, that
            store's own native-currency split otherwise. The per-store cards'
            own "Costs by category" list only renders in All Stores view (see
            below), so there's no duplicate in single-store view. */}
        <section className="flex flex-col">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">Costs</span>
            <h2 className="text-base font-semibold">Where the Money Goes</h2>
          </div>
          <div className="flex-1">
            <CategoryBreakdownCard
              breakdown={displayCategoryBreakdown}
              excludedStoreNames={isAllStores ? excludedStoreNames : []}
              symbol={isAllStores ? "SAR " : selectedStore?.currency_symbol ?? ""}
              subtitle={isAllStores ? "All stores combined, converted to SAR" : selectedStore?.store_name ?? ""}
              loading={loading}
            />
          </div>
        </section>
      </div>
    ),

    "store-cards": isAllStores ? (
      // Per-store cards — All Stores only. In single-store view this would
      // just repeat the same Revenue/Costs/Net already shown in the KPI row
      // above, so it's redundant there.
      <section>
        <div className="flex items-center gap-2.5 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-primary/10 text-primary">Stores</span>
          <h2 className="text-base font-semibold">Store P&L Cards</h2>
          <span className="text-xs text-muted-foreground">{loading ? "Loading…" : `${displayRows.length} store${displayRows.length === 1 ? "" : "s"}`}</span>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <div className="h-1.5 bg-muted animate-pulse" />
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {displayRows.map((r) => <PnLCard key={r.store.id} r={r} idx={activeStores.findIndex(s => s.id === r.store.id)} />)}
          </div>
        )}
      </section>
    ) : null,

    ranking: isAllStores ? (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">Ranking</span>
          <h2 className="text-base font-semibold">Net Sales Ranking</h2>
          <span className="text-xs text-muted-foreground">By Net Sales (SAR) · cost ratio = costs ÷ revenue</span>
        </div>
        <RankingTable rows={rows} loading={loading} />
      </section>
    ) : null,

    "channels-abandonment": (
      // Sales by channel + cart abandonment, side by side on wide screens
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <section className="flex flex-col">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">Channels</span>
            <h2 className="text-base font-semibold">Sales by Channel</h2>
          </div>
          <div className="flex-1">
            <ChannelBreakdownCard
              channels={displayChannelBreakdown}
              symbol={isAllStores ? "SAR " : selectedStore?.currency_symbol ?? ""}
              subtitle={isAllStores ? "All stores combined, converted to SAR" : selectedStore?.store_name ?? ""}
              loading={loading}
            />
          </div>
        </section>

        <section className="flex flex-col">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">Risk</span>
            <h2 className="text-base font-semibold">Cart Abandonment</h2>
          </div>
          <div className="flex-1">
            {isAllStores ? (
              <AbandonmentByStoreCard rows={storeAbandonmentRows} loading={loading || abandonmentLoading} />
            ) : (
              <AbandonmentCard
                abandonedCount={abandonmentSummary.abandonedCount}
                revenueAtRisk={abandonmentSummary.revenueAtRisk}
                abandonmentRate={abandonmentSummary.abandonmentRate}
                symbol={abandonmentSummary.symbol}
                hasSynced={abandonmentSummary.hasSynced}
                loading={loading || abandonmentLoading}
              />
            )}
          </div>
        </section>
      </div>
    ),

    marketing: (
      // CEO-glance marketing view: one profitability verdict, real
      // paid-vs-organic order attribution, simplified traffic sources, and
      // spend-as-%-of-sales — replaces the earlier raw Sessions/Bounce Rate/
      // Conversion Rate trio, which tested as "basic" and disconnected from
      // money. See project_pnl_dashboard memory for the full design history.
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <section className="flex flex-col">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">Marketing</span>
              <h2 className="text-base font-semibold">Is Marketing Paying Off?</h2>
            </div>
            <div className="flex-1">
              <MarketingRoiCard
                costPerSale={marketingRoi.costPerSale}
                revenuePerSale={marketingRoi.revenuePerSale}
                costPerSaleDelta={marketingRoi.costPerSaleDelta}
                orderCount={marketingRoi.orderCount}
                symbol={marketingRoi.symbol}
                hasData={marketingRoi.hasData}
                loading={loading || bridgeLoading}
              />
            </div>
          </section>

          <section className="flex flex-col">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400">Spend</span>
              <h2 className="text-base font-semibold">Marketing Spend vs. Sales</h2>
            </div>
            <div className="flex-1">
              <MarketingSpendCard
                totalPct={marketingSpendBreakdown.totalPct}
                platforms={marketingSpendBreakdown.platforms}
                netSales={bridgeSummary.netSales}
                symbol={bridgeSummary.symbol}
                loading={loading}
              />
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <section className="flex flex-col">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">Traffic</span>
              <h2 className="text-base font-semibold">Where Customers Come From</h2>
            </div>
            <div className="flex-1">
              <TrafficByChannelCard
                channels={ga4ChannelBreakdown}
                subtitle={isAllStores ? "All stores combined" : selectedStore?.store_name ?? ""}
                loading={ga4ChannelLoading}
              />
            </div>
          </section>

          <section className="flex flex-col">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">Source</span>
              <h2 className="text-base font-semibold">Where Your Sales Really Come From</h2>
            </div>
            <div className="flex-1">
              <TrafficSourceCard
                rows={trafficSourceSummary}
                symbol={isAllStores ? "SAR " : selectedStore?.currency_symbol ?? ""}
                loading={trafficSourceLoading}
              />
            </div>
          </section>
        </div>
      </div>
    ),

    trend: (
      <section>
        <div className="flex items-center gap-2.5 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">Trend</span>
          <h2 className="text-base font-semibold">Net Sales Trend</h2>
        </div>
        <TrendChart mode={isAllStores ? "indexed" : "native"} series={trendSeries} loading={trendLoading} />
      </section>
    ),

    ledger: (
      <section>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">Ledger</span>
          <h2 className="text-base font-semibold">Cost Entries</h2>
          <span className="text-xs text-muted-foreground">{monthKey}{isAllStores ? " · All Stores" : selectedStore ? ` · ${selectedStore.store_name}` : ""}</span>
          <div className="flex items-center gap-2 ml-auto print:hidden">
            {isAllStores && (
              <Select value={ledgerStoreFilter} onValueChange={setLedgerStoreFilter}>
                <SelectTrigger className="h-7 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stores</SelectItem>
                  {activeStores.map(s => <SelectItem key={s.id} value={s.id}>{s.store_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleExportCsv} disabled={displayEntries.length === 0}>
              <Download size={12} /> Export CSV
            </Button>
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /></div>
            ) : displayEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">No cost entries for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      {ledgerShowsStoreColumn && <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Store</th>}
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Category</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Platform</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Amount</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Notes</th>
                      {isAdmin && <th className="px-4 py-2.5 text-right font-medium text-muted-foreground print:hidden">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {displayEntries.map(e => {
                      const s = activeStores.find(st => st.id === e.store_id);
                      return (
                        <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          {ledgerShowsStoreColumn && <td className="px-4 py-2.5">{s?.store_name ?? "—"}</td>}
                          <td className="px-4 py-2.5">{categoryLabel(e.category)}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{platformLabel(e.category, e.platform)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-red-600 dark:text-red-400">−{fmtC(Number(e.amount), s?.currency_symbol ?? "")}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{e.notes ?? "—"}</td>
                          {isAdmin && (
                            <td className="px-4 py-2.5 text-right print:hidden">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(e)}><Pencil size={13} /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeletingId(e.id)}><Trash2 size={13} className="text-red-500" /></Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    ),
  };

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6 max-w-[1800px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={18} className="text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Profit &amp; Loss</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Revenue live from Shopify (shipping excluded) · costs entered manually · <span className="font-medium">{monthKey}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 print:hidden">
          <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setCustomizerOpen(true)}><LayoutGrid size={13} /> Customize Layout</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => window.print()}><Printer size={13} /> Export PDF</Button>
          {isAdmin && <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openAdd}><Plus size={13} /> Add Cost Entry</Button>}
        </div>
      </div>

      {/* Print header — only visible on the printed page, gives the exported PDF a proper title/date */}
      <div className="hidden print:block text-center mb-2">
        <h1 className="text-lg font-bold">Darussalam Group — Profit &amp; Loss</h1>
        <p className="text-xs text-muted-foreground">{isAllStores ? "All Stores (SAR)" : selectedStore?.store_name} · {monthKey}</p>
      </div>

      {missingRates && (
        <Card className="border-amber-300/60 dark:border-amber-800/60">
          <CardContent className="p-3.5 space-y-3">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-medium">
              {fxError
                ? `Auto-fetching the exchange rate for ${monthKey} failed — some stores excluded from the SAR total below.`
                : `Fetching this month's exchange rate…`}
              {fxError && <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => refetchFxRates()}>Retry</Button>}
            </div>
            {fxError && isAdmin && <FxRateEditor monthKey={monthKey} fxRates={fxRates} />}
          </CardContent>
        </Card>
      )}

      {sectionOrder.map(key => <Fragment key={key}>{sectionContent[key]}</Fragment>)}

      {isAdmin && (
        <CostEntryDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          monthKey={monthKey}
          stores={activeStores}
          editing={editingEntry}
          defaultStoreId={!isAllStores ? selectedStoreId : null}
        />
      )}

      <AlertDialog open={!!deletingId} onOpenChange={(v) => !v && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this cost entry?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {customizerOpen && (
        <LayoutCustomizer
          order={sectionOrder}
          saving={saveLayout.isPending}
          onClose={() => setCustomizerOpen(false)}
          onSave={async (newOrder) => {
            try {
              await saveLayout.mutateAsync(newOrder);
              toast.success("Layout saved");
              setCustomizerOpen(false);
            } catch (e: any) {
              toast.error(e.message ?? "Failed to save layout");
            }
          }}
          onReset={async () => {
            try {
              await resetLayout.mutateAsync();
              toast.success("Layout reset to default");
              setCustomizerOpen(false);
            } catch (e: any) {
              toast.error(e.message ?? "Failed to reset layout");
            }
          }}
        />
      )}
    </div>
  );
}
