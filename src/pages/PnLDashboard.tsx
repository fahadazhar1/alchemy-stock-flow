import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useStore } from "@/contexts/StoreContext";
import { useRole } from "@/hooks/useRole";
import { useStoreSalesPulse } from "@/hooks/useStoreSalesPulse";
import {
  getMonthBounds, useAllCostEntries, useCostEntryMutations, useFxRates, useUpsertFxRate,
  currencyToSar, COST_CATEGORIES, AD_PLATFORMS, MARKETPLACE_PLATFORMS,
  type CostEntry, type CostEntryInput,
} from "@/hooks/usePnL";

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

// ─── Month picker ───────────────────────────────────────────────────────────

function MonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const prev = () => (month === 1 ? onChange(year - 1, 12) : onChange(year, month - 1));
  const next = () => (month === 12 ? onChange(year + 1, 1) : onChange(year, month + 1));
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={prev}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="text-sm font-medium w-32 text-center">{label}</span>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={next}><ChevronRight className="h-4 w-4" /></Button>
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

// ─── Main page ──────────────────────────────────────────────────────────────

export default function PnLDashboard() {
  const { stores, selectedStoreId, selectedStore, isAllStores } = useStore();
  const { isAdmin } = useRole();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  const bounds = useMemo(() => getMonthBounds(year, month), [year, month]);
  const { data: salesPulse = [], isLoading: revenueLoading } = useStoreSalesPulse(bounds, true);
  const { data: entries = [], isLoading: entriesLoading } = useAllCostEntries(monthKey);
  const { data: fxRates = {} } = useFxRates(monthKey);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CostEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { remove } = useCostEntryMutations();

  const activeStores = stores.filter(s => s.is_active);

  // Per-store rollup: revenue (from Sales Pulse) + costs (from entries) = net.
  const rows = useMemo(() => {
    return activeStores.map(s => {
      const pulse = salesPulse.find(p => p.storeId === s.id);
      const revenue = pulse?.revenue ?? 0;
      const storeEntries = entries.filter(e => e.store_id === s.id);
      const costs = storeEntries.reduce((sum, e) => sum + Number(e.amount), 0);
      const net = revenue - costs;
      const revenueSar = currencyToSar(revenue, s.currency ?? "GBP", fxRates);
      const costsSar = currencyToSar(costs, s.currency ?? "GBP", fxRates);
      const netSar = revenueSar !== null && costsSar !== null ? revenueSar - costsSar : null;
      return { store: s, revenue, costs, net, revenueSar, costsSar, netSar, entries: storeEntries };
    });
  }, [activeStores, salesPulse, entries, fxRates]);

  const missingRates = rows.some(r => r.netSar === null);

  const grandTotalSar = rows.reduce((acc, r) => {
    if (r.revenueSar === null || r.costsSar === null) return acc;
    return { revenue: acc.revenue + r.revenueSar, costs: acc.costs + r.costsSar };
  }, { revenue: 0, costs: 0 });

  const displayRow = !isAllStores && selectedStoreId ? rows.find(r => r.store.id === selectedStoreId) : null;
  const displayEntries = !isAllStores && selectedStoreId ? entries.filter(e => e.store_id === selectedStoreId) : entries;

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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Profit &amp; Loss</h1>
          <p className="text-sm text-muted-foreground">Revenue is live from Shopify (shipping excluded). Costs are entered manually below.</p>
        </div>
        <div className="flex items-center gap-3">
          <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
          {isAdmin && (
            <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Cost Entry</Button>
          )}
        </div>
      </div>

      {isAllStores ? (
        <>
          {missingRates && (
            <Card className="border-amber-400/50 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" /> Missing FX rate for {monthKey} — some stores excluded from the SAR total below.
                </div>
                {isAdmin && <FxRateEditor monthKey={monthKey} fxRates={fxRates} />}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Total Revenue (SAR)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{fmtMoney(grandTotalSar.revenue, "SAR ")}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Total Costs (SAR)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-red-500">−{fmtMoney(grandTotalSar.costs, "SAR ")}</p></CardContent></Card>
            <Card className="border-primary/40"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Net Sales (SAR)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-primary">{fmtMoney(grandTotalSar.revenue - grandTotalSar.costs, "SAR ")}</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Store-by-Store</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Costs</TableHead>
                  <TableHead className="text-right">Net (native)</TableHead>
                  <TableHead className="text-right">Net (SAR)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.store.id}>
                      <TableCell className="font-medium">{r.store.store_name}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.revenue, r.store.currency_symbol ?? "")}</TableCell>
                      <TableCell className="text-right text-red-500">−{fmtMoney(r.costs, r.store.currency_symbol ?? "")}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(r.net, r.store.currency_symbol ?? "")}</TableCell>
                      <TableCell className="text-right">{r.netSar !== null ? fmtMoney(r.netSar, "SAR ") : <span className="text-amber-600 text-xs">rate missing</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Revenue</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{fmtMoney(displayRow?.revenue ?? 0, selectedStore?.currency_symbol ?? "")}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Costs</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-red-500">−{fmtMoney(displayRow?.costs ?? 0, selectedStore?.currency_symbol ?? "")}</p></CardContent></Card>
          <Card className="border-primary/40"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Net Sales</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-primary">{fmtMoney(displayRow?.net ?? 0, selectedStore?.currency_symbol ?? "")}</p></CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Cost Entries — {monthKey}{isAllStores ? " (All Stores)" : selectedStore ? ` — ${selectedStore.store_name}` : ""}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : displayEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cost entries for this period.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                {isAllStores && <TableHead>Store</TableHead>}
                <TableHead>Category</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Notes</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {displayEntries.map(e => {
                  const s = activeStores.find(st => st.id === e.store_id);
                  return (
                    <TableRow key={e.id}>
                      {isAllStores && <TableCell>{s?.store_name ?? "—"}</TableCell>}
                      <TableCell>{categoryLabel(e.category)}</TableCell>
                      <TableCell>{platformLabel(e.platform)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(Number(e.amount), s?.currency_symbol ?? "")}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{e.notes ?? "—"}</TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeletingId(e.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
  );
}
