import { useState, useMemo, useCallback } from "react";
import { MessageSquare, Loader2, RefreshCw, Send } from "lucide-react";
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
  useKpiConfig, useDailyKpiEntries, useUpsertKpiEntry, useUpdateKpiConfig, useSendKpiReport,
  useKpiSalesHistory, useKpiGa4History, useDailyKpiEntriesHistory, useShopifySessions,
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

function last15Dates(): string[] {
  const today = todayKarachiDate();
  const out: string[] = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
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

  // The KPI table's "Sales (today and MTD)" row always shows both, independent
  // of the page's date-range filter bar above (that filter only drives the
  // Sales Pulse cards section, same as the Sales Pulse page itself).
  const todayBounds = useMemo(() => getDateBounds("Today"), []);
  const mtdBounds = useMemo(() => getDateBounds("MTD"), []);
  const { data: pulseTodayRaw = [] } = useStoreSalesPulse(todayBounds, excludeShipping);
  const { data: pulseMtdRaw = [] } = useStoreSalesPulse(mtdBounds, excludeShipping);
  // Same channel filter as the Sales Pulse cards above (controlled, lifted
  // into this page) — without this the KPI table's Sales row always summed
  // ALL channels regardless of what the dropdown had selected.
  const pulseToday = useMemo(() => pulseTodayRaw.map(p => applyChannelFilter(p, channelFilter)), [pulseTodayRaw, channelFilter]);
  const pulseMtd = useMemo(() => pulseMtdRaw.map(p => applyChannelFilter(p, channelFilter)), [pulseMtdRaw, channelFilter]);

  const { data: pulse = [], isLoading: pulseLoading, isFetching: pulseFetching, refetch: refetchPulse } = useStoreSalesPulse(bounds, excludeShipping);
  const { data: channelRows = [], isFetching: channelFetching } = useGa4ChannelSummary(gaStart, gaEnd);
  const { data: config = [], isLoading: configLoading } = useKpiConfig();
  const { data: entries = [], isLoading: entriesLoading } = useDailyKpiEntries(today);
  const { data: salesHistory = [] } = useKpiSalesHistory();
  const { data: ga4History = [] } = useKpiGa4History();
  const { data: entriesHistory = [] } = useDailyKpiEntriesHistory();
  const { data: shopifySessions = [], isFetching: sessionsFetching } = useShopifySessions();
  const historyDates = useMemo(() => last15Dates(), []);

  const upsertEntry = useUpsertKpiEntry();
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

  const autoValue = useCallback((metricKey: string, storeId: string): string => {
    if (metricKey === "sales") {
      const t = pulseToday.find(x => x.storeId === storeId);
      const m = pulseMtd.find(x => x.storeId === storeId);
      if (!t && !m) return "—";
      const sym = t?.currencySymbol ?? m?.currencySymbol ?? "";
      const todayStr = t ? `${fmtCurrency(t.revenue, sym)} (${t.orders})` : "—";
      const mtdStr = m ? `${fmtCurrency(m.revenue, sym)} (${m.orders})` : "—";
      return `Today: ${todayStr} · MTD: ${mtdStr}`;
    }
    if (metricKey === "organic_traffic") {
      const sessions = channelRows
        .filter(r => r.storeId === storeId && r.channelGroup === "Organic Search")
        .reduce((s, r) => s + r.sessions, 0);
      return `${sessions.toLocaleString()} sessions`;
    }
    if (metricKey === "bounce_cro") {
      // Follows the page's date-range filter bar (gaStart..gaEnd), same as
      // Organic traffic above — aggregated as sum(bounces)/sum(sessions) and
      // sum(conversions)/sum(sessions), not an average of daily rates.
      const rows = shopifySessions.filter(r => r.storeId === storeId && r.date >= gaStart && r.date <= gaEnd);
      if (rows.length === 0) return "No data yet";
      const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
      const totalBounces = rows.reduce((s, r) => s + r.bounces, 0);
      const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);
      if (totalSessions === 0) return "No data yet";
      const bounceRate = (totalBounces / totalSessions) * 100;
      const cro = (totalConversions / totalSessions) * 100;
      return `${bounceRate.toFixed(1)}% bounce · ${cro.toFixed(2)}% CRO`;
    }
    return "—";
  }, [pulseToday, pulseMtd, channelRows, shopifySessions, gaStart, gaEnd]);

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
      const result: any = await sendReport.mutateAsync(today);
      const failed = Object.entries(result?.results ?? {}).filter(([, v]: any) => !v.sent);
      if (failed.length > 0) {
        toast.error(`Sent with ${failed.length} failure(s) — check ClickUp`);
      } else {
        toast.success("KPI report sent to ClickUp");
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
            Daily KPI tracker, store-wise · <span className="font-medium">{bounds.label}</span> for Sales/Traffic · manual fields are for {today}
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
                        <th className="text-left font-medium px-3 py-2 w-[26%]">Metric</th>
                        <th className="text-left font-medium px-3 py-2 w-[14%]">Owner</th>
                        <th className="text-left font-medium px-3 py-2 w-[14%]">Target</th>
                        <th className="text-left font-medium px-3 py-2 w-[36%]">Actual</th>
                        <th className="text-left font-medium px-3 py-2 w-[10%]">Reviewed</th>
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
                                <EditableCell
                                  value={entry?.value_text ?? ""}
                                  placeholder="Type today's figure…"
                                  onSave={(v) => upsertEntry.mutate({
                                    store_id: store.storeId, entry_date: today, metric_key: m.metric_key, value_text: v,
                                  })}
                                />
                              )}
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
                            {storeConfig.map(m => (
                              <td key={m.id} className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                                {historyValue(m.metric_key, store.storeId, date, store.currencySymbol)}
                              </td>
                            ))}
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
