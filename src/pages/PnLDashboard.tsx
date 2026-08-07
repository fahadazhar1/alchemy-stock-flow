import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Wallet,
  TrendingUp, TrendingDown, Receipt, Coins, ArrowUp, ArrowDown,
} from "lucide-react";
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
import { useStoreSalesPulse } from "@/hooks/useStoreSalesPulse";
import {
  getMonthBounds, useAllCostEntries, useCostEntryMutations, useEnsureFxRates, useUpsertFxRate,
  currencyToSar, COST_CATEGORIES, AD_PLATFORMS, MARKETPLACE_PLATFORMS,
  type CostEntry, type CostEntryInput,
} from "@/hooks/usePnL";

// Same accent palette + assignment order as Store Performance, so a store's
// colour means the same thing on both pages.
const STORE_COLORS = ["#6366f1", "#f59e0b", "#06b6d4", "#10b981", "#f43f5e", "#a855f7", "#3b82f6", "#84cc16"];
function storeColor(idx: number): string { return STORE_COLORS[idx % STORE_COLORS.length]; }

const CATEGORY_COLORS: Record<string, string> = {
  ad_spend: "#6366f1",
  shopify_plan: "#06b6d4",
  shopify_apps: "#10b981",
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
function platformLabel(p: string | null) {
  if (!p) return "—";
  return [...AD_PLATFORMS, ...MARKETPLACE_PLATFORMS].find(x => x.value === p)?.label ?? p;
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

  const needsPlatform = form.category === "ad_spend" || form.category === "marketplace_fee";
  const platformOptions = form.category === "ad_spend" ? AD_PLATFORMS : MARKETPLACE_PLATFORMS;
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

function SummaryCards({ totalRevenue, totalCosts, netSales, revenueDelta, costsDelta, netDelta, biggestCostLabel, loading }: {
  totalRevenue: number; totalCosts: number; netSales: number;
  revenueDelta: number | null; costsDelta: number | null; netDelta: number | null;
  biggestCostLabel: string; loading: boolean;
}) {
  const cards = [
    { label: "Total Revenue (SAR)", value: `SAR ${fmtNum(totalRevenue)}`, icon: TrendingUp, color: "#6366f1", bg: "#eef2ff", delta: revenueDelta, inverse: false, sub: "vs last month" },
    { label: "Total Costs (SAR)", value: `−SAR ${fmtNum(totalCosts)}`, icon: Receipt, color: "#dc2626", bg: "#fee2e2", delta: costsDelta, inverse: true, sub: "vs last month" },
    { label: "Net Sales (SAR)", value: `SAR ${fmtNum(netSales)}`, icon: Coins, color: "#059669", bg: "#d1fae5", delta: netDelta, inverse: false, sub: "vs last month" },
    { label: "Biggest Cost", value: biggestCostLabel, icon: TrendingDown, color: "#d97706", bg: "#fef3c7", delta: null as number | null, inverse: false, sub: "this month" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(c => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
              <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: c.bg, color: c.color }}>
                <c.icon size={11} strokeWidth={2.2} />
              </span>
              {c.label}
            </div>
            {loading ? <Skeleton className="h-7 w-24 mb-1.5" /> : (
              <div className={cn("font-bold tracking-tight leading-none", c.label === "Biggest Cost" ? "text-sm" : "text-[22px] tabular-nums")}>{c.value}</div>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 text-xs min-h-[16px]">
              {c.delta !== null && !loading && <DeltaBadge value={c.delta} inverse={c.inverse} />}
              <span className="text-muted-foreground truncate text-[11px]">{c.sub}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Per-store P&L card ─────────────────────────────────────────────────────

interface StoreRow {
  store: { id: string; store_name: string; currency: string | null; currency_symbol: string | null };
  revenue: number; costs: number; net: number; revenueDelta: number | null;
  revenueSar: number | null; costsSar: number | null; netSar: number | null;
  prevRevenueSar: number | null; prevCostsSar: number | null; prevNetSar: number | null;
  entries: CostEntry[];
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

function CategoryBreakdownCard({ breakdown, loading }: {
  breakdown: { category: string; amount: number; pct: number }[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Receipt size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Cost Breakdown by Category</h3>
          <span className="text-xs text-muted-foreground">All stores combined, converted to SAR</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : breakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No costs entered this period.</p>
        ) : (
          <div className="space-y-3">
            {breakdown.map((b, idx) => {
              const color = categoryColor(b.category);
              return (
                <div key={b.category}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                      {categoryLabel(b.category)}
                      {idx === 0 && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                          Biggest
                        </Badge>
                      )}
                    </span>
                    <span className="text-sm font-bold tabular-nums">SAR {fmtNum(b.amount)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, b.pct)}%`, background: color }} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{b.pct.toFixed(0)}%</span>
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
  const { data: salesPulse = [], isLoading: revenueLoading } = useStoreSalesPulse(bounds, true);
  const { data: entries = [], isLoading: entriesLoading } = useAllCostEntries(monthKey);
  const { data: prevEntries = [] } = useAllCostEntries(prevKey);
  const { data: fxData, isError: fxError, refetch: refetchFxRates } = useEnsureFxRates(monthKey);
  const fxRates = fxData?.rates ?? {};

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CostEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [ledgerStoreFilter, setLedgerStoreFilter] = useState<string>("all"); // local to the ledger, only relevant in All Stores mode
  const { remove } = useCostEntryMutations();

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
    return { store: s, revenue, costs, net, revenueDelta: pulse?.revenueDelta ?? null, revenueSar, costsSar, prevRevenueSar, prevCostsSar, netSar, prevNetSar, entries: storeEntries };
  }), [activeStores, salesPulse, entries, prevEntries, fxRates]);

  const missingRates = rows.some(r => r.netSar === null);

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

  const pctDelta = (cur: number, prev: number): number | null =>
    prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null;

  const revenueDelta = pctDelta(grandTotal.revenue, grandTotal.prevRevenue);
  const costsDelta = pctDelta(grandTotal.costs, grandTotal.prevCosts);
  const netDelta = pctDelta(grandTotal.revenue - grandTotal.costs, grandTotal.prevNet);

  // Category totals, converted to SAR and combined across every store — the
  // single source both the "Biggest Cost" KPI and the breakdown card read from.
  const categoryBreakdown = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const r of rows) {
      for (const e of r.entries) {
        const amtSar = currencyToSar(Number(e.amount), r.store.currency ?? "GBP", fxRates);
        if (amtSar === null) continue;
        byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + amtSar);
      }
    }
    const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
    return [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [rows, fxRates]);

  const biggestCostLabel = categoryBreakdown.length === 0 ? "None yet" : categoryLabel(categoryBreakdown[0].category);

  const displayRows = isAllStores ? rows : rows.filter(r => r.store.id === selectedStoreId);
  const displayEntries = !isAllStores && selectedStoreId
    ? entries.filter(e => e.store_id === selectedStoreId)
    : ledgerStoreFilter === "all" ? entries : entries.filter(e => e.store_id === ledgerStoreFilter);
  const ledgerShowsStoreColumn = isAllStores && ledgerStoreFilter === "all";

  const openAdd = () => { setEditingEntry(null); setDialogOpen(true); };
  const openEdit = (e: CostEntry) => { setEditingEntry(e); setDialogOpen(true); };

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
        <div className="flex items-center gap-2 shrink-0">
          <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
          {isAdmin && <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openAdd}><Plus size={13} /> Add Cost Entry</Button>}
        </div>
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

      {/* Summary KPIs */}
      <SummaryCards
        totalRevenue={grandTotal.revenue}
        totalCosts={grandTotal.costs}
        netSales={grandTotal.revenue - grandTotal.costs}
        revenueDelta={revenueDelta}
        costsDelta={costsDelta}
        netDelta={netDelta}
        biggestCostLabel={biggestCostLabel}
        loading={loading}
      />

      {/* Cost breakdown by category — All Stores only, this is inherently a combined view */}
      {isAllStores && (
        <section>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">Costs</span>
            <h2 className="text-base font-semibold">Where the Money Goes</h2>
          </div>
          <CategoryBreakdownCard breakdown={categoryBreakdown} loading={loading} />
        </section>
      )}

      {/* Per-store cards */}
      <section>
        <div className="flex items-center gap-2.5 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-primary/10 text-primary">Stores</span>
          <h2 className="text-base font-semibold">{isAllStores ? "Store P&L Cards" : selectedStore?.store_name ?? ""}</h2>
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

      {/* Ranking — All Stores only */}
      {isAllStores && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">Ranking</span>
            <h2 className="text-base font-semibold">Net Sales Ranking</h2>
            <span className="text-xs text-muted-foreground">By Net Sales (SAR) · cost ratio = costs ÷ revenue</span>
          </div>
          <RankingTable rows={rows} loading={loading} />
        </section>
      )}

      {/* Cost entries */}
      <section>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">Ledger</span>
          <h2 className="text-base font-semibold">Cost Entries</h2>
          <span className="text-xs text-muted-foreground">{monthKey}{isAllStores ? " · All Stores" : selectedStore ? ` · ${selectedStore.store_name}` : ""}</span>
          {isAllStores && (
            <Select value={ledgerStoreFilter} onValueChange={setLedgerStoreFilter}>
              <SelectTrigger className="h-7 w-[160px] text-xs ml-auto"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {activeStores.map(s => <SelectItem key={s.id} value={s.id}>{s.store_name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
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
                      {isAdmin && <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {displayEntries.map(e => {
                      const s = activeStores.find(st => st.id === e.store_id);
                      return (
                        <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          {ledgerShowsStoreColumn && <td className="px-4 py-2.5">{s?.store_name ?? "—"}</td>}
                          <td className="px-4 py-2.5">{categoryLabel(e.category)}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{platformLabel(e.platform)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-red-600 dark:text-red-400">−{fmtC(Number(e.amount), s?.currency_symbol ?? "")}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{e.notes ?? "—"}</td>
                          {isAdmin && (
                            <td className="px-4 py-2.5 text-right">
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
    </div>
  );
}
