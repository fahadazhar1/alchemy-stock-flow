import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useStore } from "@/contexts/StoreContext";
import { useRole } from "@/hooks/useRole";
import { useStoreSalesPulse } from "@/hooks/useStoreSalesPulse";
import {
  getMonthBounds, useAllCostEntries, useCostEntryMutations, useEnsureFxRates, useUpsertFxRate,
  currencyToSar, COST_CATEGORIES, AD_PLATFORMS, MARKETPLACE_PLATFORMS,
  type CostEntry, type CostEntryInput,
} from "@/hooks/usePnL";

// ─── Darussalam ledger palette — same 4 hex values used across every monthly
// PDF report, so the dashboard finally reads as the same company as the PDFs. ──
const NAVY = "#0b2e24";
const GOLD = "#d4a52d";
const GOLD_SOFT = "#f3e5c3";
const OXBLOOD = "#8a3324";
const INK = "#6b6b6b";
const BAR_PALETTE = [NAVY, GOLD, OXBLOOD, INK];

function fmtMoney(n: number, symbol: string): string {
  return `${symbol}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function categoryLabel(c: string) {
  return COST_CATEGORIES.find(x => x.value === c)?.label ?? c;
}
function platformLabel(p: string | null) {
  if (!p) return "—";
  return [...AD_PLATFORMS, ...MARKETPLACE_PLATFORMS].find(x => x.value === p)?.label ?? p;
}
function prevMonthKey(year: number, month: number) {
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

// ─── Count-up number — the one motion moment on this page. Respects reduced-motion. ──
function useCountUp(target: number, durationMs = 700) {
  const [value, setValue] = useState(target);
  const prevTarget = useRef(target);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !Number.isFinite(target)) { setValue(target); prevTarget.current = target; return; }

    const from = prevTarget.current;
    const to = target;
    prevTarget.current = target;
    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      setValue(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}

// ─── Month picker ───────────────────────────────────────────────────────────

function MonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const prev = () => (month === 1 ? onChange(year - 1, 12) : onChange(year, month - 1));
  const next = () => (month === 12 ? onChange(year + 1, 1) : onChange(year, month + 1));
  return (
    <div className="flex items-center gap-1 rounded-md border" style={{ borderColor: `${NAVY}30` }}>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={prev}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="text-sm font-medium w-32 text-center tracking-wide" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>{label}</span>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={next}><ChevronRight className="h-4 w-4" /></Button>
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

// ─── FX rate inline editor (admin, for GBP/PKR only) ───────────────────────

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

// ─── Regional Ledger Bar — the signature element. One proportional strip,
// segmented by store, revenue share of the group total. ────────────────────

function RegionalLedgerBar({ segments }: { segments: { name: string; share: number; sar: number }[] }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) { setGrown(true); return; }
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div>
      <div className="flex h-8 w-full overflow-hidden rounded-sm" style={{ background: `${INK}15` }}>
        {segments.map((s, i) => (
          <div
            key={s.name}
            title={`${s.name} — ${s.share.toFixed(1)}%`}
            style={{
              width: grown ? `${s.share}%` : "0%",
              background: BAR_PALETTE[i % BAR_PALETTE.length],
              transition: `width 700ms cubic-bezier(0.22,1,0.36,1) ${i * 80}ms`,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
        {segments.map((s, i) => (
          <div key={s.name} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: BAR_PALETTE[i % BAR_PALETTE.length] }} />
            <span className="font-medium" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>{s.name}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: INK }}>{s.share.toFixed(1)}% · SAR {s.sar.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ledger table — thin single rules, serif numerals, double rule under totals. ──

function LedgerTable({ head, rows: rowsData, totalRow }: {
  head: { label: string; align?: "left" | "right" }[];
  rows: ReactNode[][];
  totalRow?: ReactNode[];
}) {
  return (
    <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} className="text-[10px] uppercase tracking-wider font-semibold pb-2"
              style={{ color: INK, textAlign: h.align ?? "left", borderBottom: `1.5px solid ${NAVY}` }}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowsData.map((r, ri) => (
          <tr key={ri}>
            {r.map((cell, ci) => (
              <td key={ci} className="py-2.5"
                style={{
                  textAlign: head[ci]?.align ?? "left",
                  borderBottom: `1px solid ${NAVY}18`,
                  fontFamily: ci === 0 ? "'IBM Plex Sans', sans-serif" : "'IBM Plex Mono', monospace",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: ci === 0 ? "0.875rem" : "0.8rem",
                  fontWeight: 500,
                  color: "#1a1a1a",
                }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
        {totalRow && (
          <tr>
            {totalRow.map((cell, ci) => (
              <td key={ci} className="py-3 font-bold"
                style={{
                  textAlign: head[ci]?.align ?? "left",
                  borderTop: `2.5px double ${GOLD}`,
                  fontFamily: ci === 0 ? "'IBM Plex Sans', sans-serif" : "'IBM Plex Mono', monospace",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: ci === 0 ? "0.875rem" : "0.85rem",
                  color: NAVY,
                }}>
                {cell}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
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
  const { remove } = useCostEntryMutations();

  const activeStores = stores.filter(s => s.is_active);

  // Per-store rollup: revenue (from Sales Pulse) + costs (from entries) = net.
  const rows = useMemo(() => activeStores.map(s => {
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
    const prevNetSar = currencyToSar(prevNet, s.currency ?? "GBP", fxRates);
    const netSar = revenueSar !== null && costsSar !== null ? revenueSar - costsSar : null;
    return { store: s, revenue, costs, net, prevNet, revenueSar, costsSar, netSar, prevNetSar, entries: storeEntries };
  }), [activeStores, salesPulse, entries, prevEntries, fxRates]);

  const missingRates = rows.some(r => r.netSar === null);

  const grandTotalSar = rows.reduce((acc, r) => {
    if (r.revenueSar === null || r.costsSar === null) return acc;
    return { revenue: acc.revenue + r.revenueSar, costs: acc.costs + r.costsSar, prevNet: acc.prevNet + (r.prevNetSar ?? 0) };
  }, { revenue: 0, costs: 0, prevNet: 0 });

  const displayRow = !isAllStores && selectedStoreId ? rows.find(r => r.store.id === selectedStoreId) : null;
  const displayEntries = !isAllStores && selectedStoreId ? entries.filter(e => e.store_id === selectedStoreId) : entries;

  // Hero figure + trend, in whichever view is active.
  const heroNet = isAllStores ? grandTotalSar.revenue - grandTotalSar.costs : (displayRow?.net ?? 0);
  const heroPrevNet = isAllStores ? grandTotalSar.prevNet : (displayRow?.prevNet ?? 0);
  const heroSymbol = isAllStores ? "SAR " : (selectedStore?.currency_symbol ?? "");
  const heroTrendPct = heroPrevNet !== 0 ? ((heroNet - heroPrevNet) / Math.abs(heroPrevNet)) * 100 : null;
  const animatedHero = useCountUp(heroNet);

  // Signature insight sentence — reuses the same "biggest drag" logic as the PDF reports.
  const insight = useMemo(() => {
    if (isAllStores) {
      const withRatio = rows
        .filter(r => r.revenue > 0 && r.costs > 0)
        .map(r => ({ name: r.store.store_name, ratio: r.costs / r.revenue }));
      if (withRatio.length === 0) return "No costs entered yet this month — Net Sales equals Total Revenue across every store.";
      const worst = withRatio.sort((a, b) => b.ratio - a.ratio)[0];
      return `${worst.name}'s costs are consuming ${(worst.ratio * 100).toFixed(0)}% of its revenue — the largest drag in the group this month.`;
    }
    const byCategory = new Map<string, number>();
    for (const e of displayEntries) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));
    if (byCategory.size === 0) return "No costs entered yet this month.";
    const [topCat, topAmt] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
    const totalCosts = [...byCategory.values()].reduce((a, b) => a + b, 0);
    return `${categoryLabel(topCat)} is the biggest cost this month at ${fmtMoney(topAmt, selectedStore?.currency_symbol ?? "")} (${((topAmt / totalCosts) * 100).toFixed(0)}% of costs).`;
  }, [isAllStores, rows, displayEntries, selectedStore]);

  const barSegments = useMemo(() => {
    const total = grandTotalSar.revenue;
    if (total <= 0) return [];
    return rows
      .filter(r => r.revenueSar !== null && r.revenueSar > 0)
      .map(r => ({ name: r.store.store_name.replace(/^Darussalam\s*/, ""), share: (r.revenueSar! / total) * 100, sar: r.revenueSar! }))
      .sort((a, b) => b.share - a.share);
  }, [rows, grandTotalSar.revenue]);

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

  const loading = revenueLoading || entriesLoading;

  return (
    <div className="min-h-full -m-3 sm:-m-6 p-4 sm:p-8" style={{ background: "linear-gradient(180deg, #fdfbf5 0%, #f7f4ec 100%)" }}>
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: GOLD }}>Executive Summary</p>
            <h1 className="text-2xl font-semibold" style={{ fontFamily: "'Cormorant Garamond', serif", color: NAVY }}>Profit &amp; Loss Ledger</h1>
          </div>
          <div className="flex items-center gap-3">
            <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
            {isAdmin && (
              <Button size="sm" onClick={openAdd} style={{ background: NAVY }}><Plus className="h-4 w-4 mr-1" /> Add Cost Entry</Button>
            )}
          </div>
        </div>

        {missingRates && (
          <Card className="border" style={{ background: "#fef8ea", borderColor: "#f0d78a" }}>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#8a6416" }}>
                <AlertTriangle className="h-4 w-4" />
                {fxError
                  ? `Auto-fetching the exchange rate for ${monthKey} failed — some stores excluded from the SAR total below.`
                  : `Fetching this month's exchange rate…`}
                {fxError && (
                  <Button size="sm" variant="outline" className="h-6 ml-2" onClick={() => refetchFxRates()}>Retry</Button>
                )}
              </div>
              {fxError && isAdmin && <FxRateEditor monthKey={monthKey} fxRates={fxRates} />}
            </CardContent>
          </Card>
        )}

        {/* Hero — the ledger's closing line */}
        <div className="rounded-lg px-6 sm:px-10 py-8 sm:py-10 text-center relative overflow-hidden" style={{ background: NAVY }}>
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />
          <p className="text-[11px] uppercase tracking-[0.2em] font-medium" style={{ color: `${GOLD_SOFT}` }}>
            Net Sales — {isAllStores ? "All Stores" : selectedStore?.store_name ?? ""}
          </p>
          <p className="mt-2 leading-none" style={{ fontFamily: "'IBM Plex Mono', monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: "clamp(2.1rem, 6vw, 3.75rem)", color: GOLD }}>
            {fmtMoney(animatedHero, heroSymbol)}
          </p>
          {heroTrendPct !== null && (
            <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium" style={{ color: heroTrendPct >= 0 ? "#8fd19e" : "#e8a598" }}>
              {heroTrendPct >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              {Math.abs(heroTrendPct).toFixed(1)}% vs last month
            </div>
          )}
          <p className="mt-4 text-sm max-w-xl mx-auto" style={{ color: "#cbd5c9", fontFamily: "'IBM Plex Sans', sans-serif" }}>{insight}</p>
        </div>

        {/* Regional Ledger Bar — signature element, All Stores only */}
        {isAllStores && barSegments.length > 0 && (
          <Card className="border-none shadow-sm" style={{ background: "white" }}>
            <CardContent className="pt-5 pb-5">
              <p className="text-[11px] uppercase tracking-wider font-semibold mb-3" style={{ color: INK }}>Revenue Share by Region</p>
              <RegionalLedgerBar segments={barSegments} />
            </CardContent>
          </Card>
        )}

        {/* Store-by-store ledger */}
        {isAllStores ? (
          <Card className="border-none shadow-sm" style={{ background: "white" }}>
            <CardHeader className="pb-1"><CardTitle className="text-sm" style={{ color: NAVY }}>Store-by-Store</CardTitle></CardHeader>
            <CardContent>
              <LedgerTable
                head={[{ label: "Store" }, { label: "Revenue", align: "right" }, { label: "Costs", align: "right" }, { label: "Net (native)", align: "right" }, { label: "Net (SAR)", align: "right" }]}
                rows={rows.map(r => [
                  r.store.store_name,
                  fmtMoney(r.revenue, r.store.currency_symbol ?? ""),
                  <span key="c" style={{ color: OXBLOOD }}>−{fmtMoney(r.costs, r.store.currency_symbol ?? "")}</span>,
                  fmtMoney(r.net, r.store.currency_symbol ?? ""),
                  r.netSar !== null ? fmtMoney(r.netSar, "SAR ") : "rate missing",
                ])}
                totalRow={["Group Total", "—", `−${fmtMoney(grandTotalSar.costs, "SAR ")}`, "—", fmtMoney(grandTotalSar.revenue - grandTotalSar.costs, "SAR ")]}
              />
            </CardContent>
          </Card>
        ) : null}

        {/* Cost entries ledger */}
        <Card className="border-none shadow-sm" style={{ background: "white" }}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm" style={{ color: NAVY }}>
              Cost Entries — {monthKey}{isAllStores ? " (All Stores)" : selectedStore ? ` — ${selectedStore.store_name}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm" style={{ color: INK }}>Loading…</p>
            ) : displayEntries.length === 0 ? (
              <p className="text-sm" style={{ color: INK }}>No cost entries for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {isAllStores && <th className="text-left text-[10px] uppercase tracking-wider font-semibold pb-2" style={{ color: INK, borderBottom: `1.5px solid ${NAVY}` }}>Store</th>}
                    <th className="text-left text-[10px] uppercase tracking-wider font-semibold pb-2" style={{ color: INK, borderBottom: `1.5px solid ${NAVY}` }}>Category</th>
                    <th className="text-left text-[10px] uppercase tracking-wider font-semibold pb-2" style={{ color: INK, borderBottom: `1.5px solid ${NAVY}` }}>Platform</th>
                    <th className="text-right text-[10px] uppercase tracking-wider font-semibold pb-2" style={{ color: INK, borderBottom: `1.5px solid ${NAVY}` }}>Amount</th>
                    <th className="text-left text-[10px] uppercase tracking-wider font-semibold pb-2" style={{ color: INK, borderBottom: `1.5px solid ${NAVY}` }}>Notes</th>
                    {isAdmin && <th className="text-right text-[10px] uppercase tracking-wider font-semibold pb-2" style={{ color: INK, borderBottom: `1.5px solid ${NAVY}` }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {displayEntries.map(e => {
                    const s = activeStores.find(st => st.id === e.store_id);
                    return (
                      <tr key={e.id}>
                        {isAllStores && <td className="py-2.5" style={{ borderBottom: `1px solid ${NAVY}18`, color: "#1a1a1a" }}>{s?.store_name ?? "—"}</td>}
                        <td className="py-2.5" style={{ borderBottom: `1px solid ${NAVY}18`, color: "#1a1a1a" }}>{categoryLabel(e.category)}</td>
                        <td className="py-2.5" style={{ borderBottom: `1px solid ${NAVY}18`, color: "#1a1a1a" }}>{platformLabel(e.platform)}</td>
                        <td className="py-2.5 text-right" style={{ borderBottom: `1px solid ${NAVY}18`, fontFamily: "'IBM Plex Mono', monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: "0.8rem", color: OXBLOOD }}>
                          −{fmtMoney(Number(e.amount), s?.currency_symbol ?? "")}
                        </td>
                        <td className="py-2.5 text-xs" style={{ borderBottom: `1px solid ${NAVY}18`, color: INK }}>{e.notes ?? "—"}</td>
                        {isAdmin && (
                          <td className="py-2.5 text-right" style={{ borderBottom: `1px solid ${NAVY}18` }}>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeletingId(e.id)}><Trash2 className="h-3.5 w-3.5" style={{ color: OXBLOOD }} /></Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

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
    </div>
  );
}
