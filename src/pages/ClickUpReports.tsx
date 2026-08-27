import { useState, useMemo, useCallback } from "react";
import { MessageSquare, Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  type DateRangeKey, type DateBounds,
  getDateBounds, getCustomDateBounds,
} from "@/lib/dateRanges";
import { useStoreSalesPulse } from "@/hooks/useStoreSalesPulse";
import { useGa4ChannelSummary } from "@/hooks/useGa4";
import {
  useKpiConfig, useDailyKpiEntries, useUpsertKpiEntry, useDeleteKpiEntry, useUpdateKpiConfig, useSendKpiReport,
  useKpiSalesHistory, useKpiGa4History, useDailyKpiEntriesRange, useShopifySessions,
  type KpiMetricConfig,
} from "@/hooks/useKpiTracker";
import { DateRangePicker, SalesPulseSection, applyChannelFilter } from "@/pages/StorePerformanceDashboard";

const STORE_SORT_ORDER: Record<string, number> = {
  darussalamuk: 1,
  darusslampk: 2,
  DarussalamKSA: 3,
  DarussalamUAE: 4,
};

function isoToKarachiDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Karachi" });
}

function todayKarachiDate(): string {
  return isoToKarachiDate(new Date().toISOString());
}

function fmtCurrency(value: number, sym: string): string {
  return `${sym}${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const HISTORY_DAYS = 15;

// The last 15 calendar days before real today. The caller additionally
// excludes whichever date is currently selected as "Actual" (gaEnd) — see
// the clobbering-bug note where this is filtered.
function last15Dates(): string[] {
  const today = todayKarachiDate();
  const out: string[] = [];
  for (let i = 1; i <= HISTORY_DAYS; i++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out; // newest first
}

// ─── Editable cell — inline input, saves on blur if changed ────────────────
function EditableCell({ value, onSave, placeholder }: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  if (!dirty && draft !== value) setDraft(value); // external refresh (e.g. date change)

  return (
    <Input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
      onBlur={() => {
        if (dirty && draft !== value) onSave(draft);
        setDirty(false);
      }}
      className="h-7 text-xs border-transparent bg-transparent hover:border-input focus:border-input px-2"
    />
  );
}

export default function ClickUpReports() {
  const [range, setRange] = useState<DateRangeKey>("Today");
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo] = useState<Date | null>(null);
  const [excludeShipping, setExcludeShipping] = useState(false);
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set());

  const bounds = useMemo<DateBounds>(() => {
    if (range === "Custom" && customFrom && customTo) return getCustomDateBounds(customFrom, customTo);
    return getDateBounds(range);
  }, [range, customFrom, customTo]);

  const gaStart = isoToKarachiDate(bounds.startISO);
  const gaEnd = isoToKarachiDate(bounds.endISO);
  const today = todayKarachiDate();

  const { data: pulse = [], isLoading: pulseLoading, isFetching: pulseFetching, refetch: refetchPulse } = useStoreSalesPulse(bounds, excludeShipping);

  // MTD = month-to-date up to the END of whatever's selected in the filter
  // bar (e.g. if "25 Aug" is picked, MTD = 1–25 Aug) — a separate column from
  // "Actual", summed from the same daily data (live RPCs for Sales/Organic/
  // Bounce, plain sums of daily_kpi_entries for manual metrics), so it grows
  // day by day as the team fills in the daily figures.
  const monthStart = useMemo(() => {
    const [y, m] = gaEnd.split("-").map(Number);
    return `${y}-${String(m).padStart(2, "0")}-01`;
  }, [gaEnd]);
  const salesMtdBounds = useMemo<DateBounds>(() => {
    const endDate = new Date(bounds.endISO);
    const monthStartDate = new Date(`${monthStart}T12:00:00Z`);
    return getCustomDateBounds(monthStartDate, endDate);
  }, [bounds.endISO, monthStart]);
  const { data: pulseMtdRaw = [] } = useStoreSalesPulse(salesMtdBounds, excludeShipping);

  // Same channel filter as the Sales Pulse cards above (controlled, lifted
  // into this page) — without this the KPI table's Sales row always summed
  // ALL channels regardless of what the dropdown had selected.
  const pulseSelected = useMemo(() => pulse.map(p => applyChannelFilter(p, channelFilter)), [pulse, channelFilter]);
  const pulseMtd = useMemo(() => pulseMtdRaw.map(p => applyChannelFilter(p, channelFilter)), [pulseMtdRaw, channelFilter]);
  const { data: channelRows = [], isFetching: channelFetching } = useGa4ChannelSummary(gaStart, gaEnd);
  const { data: channelRowsMtd = [] } = useGa4ChannelSummary(monthStart, gaEnd);
  const { data: config = [], isLoading: configLoading } = useKpiConfig();
  // Manual metrics' "Actual" is for whatever date is selected in the filter
  // bar (gaEnd), NOT always literal today — matches Sales/Organic/Bounce,
  // which already follow the filter. Previously this was hardcoded to
  // todayKarachiDate(), so typing a value while a past/custom date was
  // selected silently saved it under today's date instead.
  const { data: entries = [], isLoading: entriesLoading } = useDailyKpiEntries(gaEnd);
  const { data: salesHistory = [] } = useKpiSalesHistory();
  const { data: ga4History = [] } = useKpiGa4History();
  // Exclude gaEnd from History — it's already editable in the Actual row
  // above; showing it twice reintroduces the two-independent-inputs
  // clobbering bug fixed earlier (see project memory).
  const historyDates = useMemo(() => last15Dates().filter(d => d !== gaEnd), [gaEnd]);
  const oldestHistoryDate = historyDates[historyDates.length - 1];
  const { data: entriesHistory = [] } = useDailyKpiEntriesRange(oldestHistoryDate, today);
  const { data: entriesMtd = [] } = useDailyKpiEntriesRange(monthStart, gaEnd);
  const { data: shopifySessions = [], isFetching: sessionsFetching } = useShopifySessions();

  const upsertEntry = useUpsertKpiEntry();
  const deleteEntry = useDeleteKpiEntry();
  const updateConfig = useUpdateKpiConfig();
  const sendReport = useSendKpiReport();
  const [sendingStatus, setSendingStatus] = useState<string | null>(null);

  const storesInOrder = useMemo(() => {
    const byStore = new Map<string, { storeId: string; storeName: string; storeCode: string; currencySymbol: string }>();
    for (const p of pulse) {
      byStore.set(p.storeId, { storeId: p.storeId, storeName: p.storeName, storeCode: p.storeCode, currencySymbol: p.currencySymbol });
    }
    return Array.from(byStore.values()).sort(
      (a, b) => (STORE_SORT_ORDER[a.storeCode] ?? 99) - (STORE_SORT_ORDER[b.storeCode] ?? 99)
    );
  }, [pulse]);

  // Shared aggregator for "Bounce rate and CRO" — sum(bounces)/sum(sessions)
  // and sum(conversions)/sum(sessions) across whatever date rows are passed
  // in, not an average of daily rates. Used for both the Actual and MTD
  // columns with different date windows.
  const aggregateBounce = useCallback((storeId: string, fromDate: string, toDate: string): string => {
    const storeRows = shopifySessions.filter(r => r.storeId === storeId);
    const rows = storeRows.filter(r => r.date >= fromDate && r.date <= toDate);
    if (rows.length === 0) return "No data yet";
    const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
    const totalBounces = rows.reduce((s, r) => s + r.bounces, 0);
    const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);
    if (totalSessions === 0) return "No data yet";
    const bounceRate = (totalBounces / totalSessions) * 100;
    const cro = (totalConversions / totalSessions) * 100;
    // shopify_sessions_daily only carries a rolling ~95-day window — flag it
    // rather than silently showing a partial figure for a longer range
    // (QTD/YTD) as if it covered the whole requested period.
    const earliestAvailable = storeRows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
    const partial = earliestAvailable > fromDate;
    return `${bounceRate.toFixed(1)}% bounce · ${cro.toFixed(2)}% CRO${partial ? ` (from ${earliestAvailable})` : ""}`;
  }, [shopifySessions]);

  const autoValue = useCallback((metricKey: string, storeId: string): string => {
    if (metricKey === "sales") {
      const t = pulseSelected.find(x => x.storeId === storeId);
      if (!t) return "—";
      return `${fmtCurrency(t.revenue, t.currencySymbol)} (${t.orders})`;
    }
    if (metricKey === "organic_traffic") {
      const sessions = channelRows
        .filter(r => r.storeId === storeId && r.channelGroup === "Organic Search")
        .reduce((s, r) => s + r.sessions, 0);
      return `${sessions.toLocaleString()} sessions`;
    }
    if (metricKey === "bounce_cro") return aggregateBounce(storeId, gaStart, gaEnd);
    return "—";
  }, [pulseSelected, channelRows, aggregateBounce, gaStart, gaEnd]);

  const mtdValue = useCallback((metricKey: string, storeId: string, sym: string): string => {
    if (metricKey === "sales") {
      const m = pulseMtd.find(x => x.storeId === storeId);
      return m ? `${fmtCurrency(m.revenue, sym)} (${m.orders})` : "—";
    }
    if (metricKey === "organic_traffic") {
      const sessions = channelRowsMtd
        .filter(r => r.storeId === storeId && r.channelGroup === "Organic Search")
        .reduce((s, r) => s + r.sessions, 0);
      return `${sessions.toLocaleString()} sessions`;
    }
    if (metricKey === "bounce_cro") return aggregateBounce(storeId, monthStart, gaEnd);
    // Manual metrics — sum whatever numeric values were typed in this month
    // (non-numeric daily entries, e.g. free-text notes, are skipped).
    const nums = entriesMtd
      .filter(e => e.store_id === storeId && e.metric_key === metricKey)
      .map(e => parseFloat(e.value_text))
      .filter(n => !Number.isNaN(n));
    if (nums.length === 0) return "—";
    return nums.reduce((s, n) => s + n, 0).toLocaleString();
  }, [pulseMtd, channelRowsMtd, aggregateBounce, monthStart, gaEnd, entriesMtd]);

  const historyValue = useCallback((metricKey: string, storeId: string, date: string, sym: string): string => {
    if (metricKey === "sales") {
      const row = salesHistory.find(r => r.storeId === storeId && r.day === date);
      if (!row) return "—";
      return `${fmtCurrency(row.revenue, sym)} (${row.orders})`;
    }
    if (metricKey === "organic_traffic") {
      const row = ga4History.find(r => r.storeId === storeId && r.day === date);
      return row ? `${row.organicSessions.toLocaleString()}` : "—";
    }
    if (metricKey === "bounce_cro") {
      const row = shopifySessions.find(r => r.storeId === storeId && r.date === date);
      if (!row) return "—";
      return `${(row.bounceRate * 100).toFixed(1)}% / ${(row.conversionRate * 100).toFixed(2)}%`;
    }
    const entry = entriesHistory.find(e => e.store_id === storeId && e.metric_key === metricKey && e.entry_date === date);
    return entry?.value_text || "—";
  }, [salesHistory, ga4History, entriesHistory, shopifySessions]);

  const isRefreshing = pulseFetching || channelFetching || sessionsFetching;
  const loading = pulseLoading || configLoading || entriesLoading;

  async function handleSend() {
    setSendingStatus("sending");
    try {
      // Sends the currently-selected date (gaEnd), not always literal today —
      // the ClickUp report's title/Actual column reflect whatever's picked in
      // the filter bar above, same as the on-page Actual column.
      const result: any = await sendReport.mutateAsync(gaEnd);
      const failed = Object.entries(result?.results ?? {}).filter(([, v]: any) => !v.sent);
      if (failed.length > 0) {
        toast.error(`Sent with ${failed.length} failure(s) — check ClickUp`);
      } else {
        toast.success(`KPI report for ${gaEnd} sent to ClickUp`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send report");
    } finally {
      setSendingStatus(null);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6 max-w-[1800px] mx-auto">
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare size={18} className="text-primary" />
            <h1 className="text-xl font-bold tracking-tight">ClickUp Reports</h1>
            {isRefreshing && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          </div>
          <p className="text-sm text-muted-foreground">
            Daily KPI tracker, store-wise · Actual follows <span className="font-medium">{bounds.label}</span> · MTD sums 1st of the month through that date · manual fields are for {gaEnd}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DateRangePicker
            range={range}
            onRangeChange={setRange}
            customFrom={customFrom}
            customTo={customTo}
            onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
          />
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
            onClick={() => refetchPulse()} disabled={isRefreshing}>
            {isRefreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSend} disabled={sendingStatus === "sending"}>
            {sendingStatus === "sending" ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Send to ClickUp
          </Button>
        </div>
      </div>

      {/* ── Sales Pulse — same filter bar/cards used everywhere else ── */}
      <section>
        <SalesPulseSection
          pulse={pulse}
          loading={pulseLoading}
          bounds={bounds}
          range={range}
          excludeShipping={excludeShipping}
          onExcludeShippingChange={setExcludeShipping}
          channelFilter={channelFilter}
          onChannelFilterChange={setChannelFilter}
        />
      </section>

      {/* ── Store-wise KPI tables ── */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {storesInOrder.map((store) => {
            const storeConfig = config
              .filter((c: KpiMetricConfig) => c.store_id === store.storeId)
              .sort((a, b) => a.sort_order - b.sort_order);

            return (
              <Card key={store.storeId} className="overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/40 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{store.storeName}</h3>
                  <Badge variant="outline" className="text-[10px]">{store.storeCode}</Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/20 text-muted-foreground">
                        <th className="text-left font-medium px-3 py-2 w-[20%]">Metric</th>
                        <th className="text-left font-medium px-3 py-2 w-[11%]">Owner</th>
                        <th className="text-left font-medium px-3 py-2 w-[11%]">Target</th>
                        <th className="text-left font-medium px-3 py-2 w-[27%]">Actual</th>
                        <th className="text-left font-medium px-3 py-2 w-[23%]">MTD</th>
                        <th className="text-left font-medium px-3 py-2 w-[8%]">Reviewed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storeConfig.map((m) => {
                        const entry = entries.find(e => e.store_id === store.storeId && e.metric_key === m.metric_key);
                        return (
                          <tr key={m.id} className="border-b last:border-b-0">
                            <td className="px-3 py-1.5 font-medium">{m.metric_label}</td>
                            <td className="px-0.5 py-0.5">
                              <EditableCell
                                value={m.owner}
                                placeholder="—"
                                onSave={(v) => updateConfig.mutate({ id: m.id, owner: v })}
                              />
                            </td>
                            <td className="px-0.5 py-0.5">
                              <EditableCell
                                value={m.target}
                                placeholder="—"
                                onSave={(v) => updateConfig.mutate({ id: m.id, target: v })}
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              {m.is_auto ? (
                                <span className="text-foreground">{autoValue(m.metric_key, store.storeId)}</span>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <EditableCell
                                    value={entry?.value_text ?? ""}
                                    placeholder={`Type figure for ${gaEnd}…`}
                                    onSave={(v) => upsertEntry.mutate({
                                      store_id: store.storeId, entry_date: gaEnd, metric_key: m.metric_key, value_text: v,
                                    })}
                                  />
                                  {entry?.value_text && (
                                    <button
                                      type="button"
                                      title="Delete this entry"
                                      onClick={() => deleteEntry.mutate({ store_id: store.storeId, entry_date: gaEnd, metric_key: m.metric_key })}
                                      className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                              {mtdValue(m.metric_key, store.storeId, store.currencySymbol)}
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground">Daily</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <details className="border-t">
                  <summary className="px-4 py-2 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none">
                    History — last {HISTORY_DAYS} days
                  </summary>
                  <div className="overflow-x-auto px-1 pb-2">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b bg-muted/20 text-muted-foreground">
                          <th className="text-left font-medium px-2 py-1.5 sticky left-0 bg-background">Date</th>
                          {storeConfig.map(m => (
                            <th key={m.id} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">{m.metric_label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {historyDates.map(date => (
                          <tr key={date} className="border-b last:border-b-0">
                            <td className="px-2 py-1 font-medium whitespace-nowrap sticky left-0 bg-background">{date}</td>
                            {storeConfig.map(m => {
                              if (m.is_auto) {
                                return (
                                  <td key={m.id} className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                                    {historyValue(m.metric_key, store.storeId, date, store.currencySymbol)}
                                  </td>
                                );
                              }
                              const histEntry = entriesHistory.find(
                                e => e.store_id === store.storeId && e.metric_key === m.metric_key && e.entry_date === date
                              );
                              return (
                                <td key={m.id} className="px-1 py-0.5 whitespace-nowrap">
                                  <div className="flex items-center gap-1">
                                    <EditableCell
                                      value={histEntry?.value_text ?? ""}
                                      placeholder="—"
                                      onSave={(v) => upsertEntry.mutate({
                                        store_id: store.storeId, entry_date: date, metric_key: m.metric_key, value_text: v,
                                      })}
                                    />
                                    {histEntry?.value_text && (
                                      <button
                                        type="button"
                                        title="Delete this entry"
                                        onClick={() => deleteEntry.mutate({ store_id: store.storeId, entry_date: date, metric_key: m.metric_key })}
                                        className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
