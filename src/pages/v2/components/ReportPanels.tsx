import { useState, useRef, type RefObject } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ComposedChart, Area, LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingDown, RefreshCw, Download, FileText } from "lucide-react";
import {
  useSalesByChannel, useSalesTrend, useTopProducts,
  useInventoryHealth, useInventoryKPIs,
  useFulfillmentSummary, useFulfillmentTrend,
  useCollectionPerformance, useRevenueKPIs,
} from "../lib/useReportData";
import { useCurrency } from "@/hooks/useCurrency";
import { downloadCsv, csvName, printElementAsPdf, type CsvColumn } from "../lib/exportReport";
import type { DateRange } from "../lib/reportsEngine";

// ─── CSV export button ────────────────────────────────────────────────────────

function CsvButton({ rows, name, columns }:
  { rows: any[] | undefined; name: string; columns: CsvColumn<any>[] }) {
  const disabled = !rows?.length;
  return (
    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
      disabled={disabled} onClick={() => rows && downloadCsv(csvName(name), columns, rows)}>
      <Download size={12} /> CSV
    </Button>
  );
}

function PdfButton({ targetRef, title, disabled }:
  { targetRef: RefObject<HTMLElement>; title: string; disabled?: boolean }) {
  return (
    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
      disabled={disabled} onClick={() => printElementAsPdf(targetRef.current, title)}>
      <FileText size={12} /> PDF
    </Button>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const fmtN = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n));
const pct = (n: number | null) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const CHANNEL_COLORS: Record<string, string> = {
  web: "#6366f1", "online store": "#6366f1",
  pos: "#10b981", "point_of_sale": "#10b981",
  android: "#f59e0b", ios: "#f59e0b",
  unknown: "#94a3b8", Unknown: "#94a3b8",
};
const colorFor = (ch: string) =>
  CHANNEL_COLORS[ch.toLowerCase()] ?? "#8b5cf6";

const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function KpiCard({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="rounded-xl border p-4 bg-card overflow-hidden relative"
         style={subColor ? { borderLeftWidth: "3px", borderLeftColor: subColor } : {}}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
      <p className="text-[26px] font-bold tabular-nums leading-none">{value}</p>
      {sub && <p className="text-xs mt-2 font-medium" style={{ color: subColor ?? "inherit" }}>{sub}</p>}
    </div>
  );
}

function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-muted-foreground">
      <AlertTriangle size={20} className="text-amber-500" />
      <p>{msg}</p>
      <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 bg-muted rounded animate-pulse" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

function ReportTooltip({ active, payload, label, currency = true }:
  { active?: boolean; payload?: any[]; label?: string; currency?: boolean }) {
  const { fmtCurrencyInt: fmt } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-lg text-xs space-y-1">
      <p className="font-medium text-muted-foreground">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-semibold">{currency ? fmt(p.value) : fmtN(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Date range picker ────────────────────────────────────────────────────────

const RANGES: { label: string; value: DateRange }[] = [
  { label: "This Week", value: "thisweek" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
  { label: "365d", value: "365d" },
  { label: "All", value: "all" },
];

export function RangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted border text-xs">
      {RANGES.map(r => (
        <button key={r.value} onClick={() => onChange(r.value)}
          className={`px-2.5 py-1 rounded-md font-medium transition-all ${
            value === r.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

// ─── 1. Sales Overview ────────────────────────────────────────────────────────

export function SalesOverviewReport() {
  const { fmtCurrencyInt: fmt, symbol } = useCurrency();
  const [range, setRange] = useState<DateRange>("30d");
  const kpis = useRevenueKPIs(range);
  const trend = useSalesTrend(range);
  const channels = useSalesByChannel(range);
  const printRef = useRef<HTMLDivElement>(null);
  const rangeLabel = RANGES.find(r => r.value === range)?.label ?? range;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Sales overview</h2>
        <div className="flex items-center gap-2">
          <CsvButton rows={channels.data} name="sales-by-channel"
            columns={[
              { key: "channel", header: "Channel" },
              { key: "revenue", header: "Revenue" },
              { key: "orders", header: "Orders" },
              { key: "aov", header: "AOV" },
            ]} />
          <PdfButton targetRef={printRef} disabled={!channels.data?.length}
            title={`Sales Overview — ${rangeLabel}`} />
          <RangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <div ref={printRef} className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        {kpis.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)
        ) : kpis.error ? (
          <div className="col-span-3"><ErrorState msg={kpis.error} onRetry={kpis.refetch} /></div>
        ) : kpis.data ? (
          <>
            <KpiCard label="Revenue" value={fmt(kpis.data.revenue)}
              sub={kpis.data.revenueChange != null ? `${pct(kpis.data.revenueChange)} vs prior period` : undefined}
              subColor={kpis.data.revenueChange != null && kpis.data.revenueChange >= 0 ? "#10b981" : "#ef4444"} />
            <KpiCard label="Orders" value={fmtN(kpis.data.orders)} />
            <KpiCard label="AOV" value={fmt(kpis.data.aov)} />
          </>
        ) : null}
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Revenue over time</h3>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {trend.isLoading ? <Skeleton rows={4} /> : trend.error ? (
            <ErrorState msg={trend.error} onRetry={trend.refetch} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={trend.data ?? []} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} minTickGap={40} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `${symbol}${Math.round(v / 1000)}k`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={42} />
                <Tooltip content={<ReportTooltip />} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2.5} fill="url(#salesRevGrad)" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Channel breakdown */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">By channel</h3>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {channels.isLoading ? <Skeleton /> : channels.error ? (
            <ErrorState msg={channels.error} onRetry={channels.refetch} />
          ) : !channels.data?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No data for this period.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {["Channel", "Revenue", "Orders", "AOV"].map(h => (
                    <th key={h} className="py-2 text-left font-medium text-muted-foreground first:pl-0 last:text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {channels.data.map((r, i) => (
                  <tr key={i} className="border-b last:border-b-0 hover:bg-muted/40">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ background: colorFor(r.channel) }} />
                        {r.channel}
                      </div>
                    </td>
                    <td className="py-2.5 tabular-nums">{fmt(r.revenue)}</td>
                    <td className="py-2.5 tabular-nums">{fmtN(r.orders)}</td>
                    <td className="py-2.5 tabular-nums text-right">{fmt(r.aov)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

// ─── 2. Top Products ──────────────────────────────────────────────────────────

export function TopProductsReport() {
  const { fmtCurrencyInt: fmt } = useCurrency();
  const [range, setRange] = useState<DateRange>("30d");
  const q = useTopProducts(range);
  const total = q.data?.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const printRef = useRef<HTMLDivElement>(null);
  const rangeLabel = RANGES.find(r => r.value === range)?.label ?? range;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Top products by revenue</h2>
        <div className="flex items-center gap-2">
          <CsvButton rows={q.data} name="top-products"
            columns={[
              { key: "name", header: "Product" },
              { key: "type", header: "Type" },
              { key: "revenue", header: "Revenue" },
              { key: "units", header: "Units" },
              { key: "orders", header: "Order lines" },
              { key: "share", header: "Share %", map: r => total ? ((r.revenue / total) * 100).toFixed(1) : "0" },
            ]} />
          <PdfButton targetRef={printRef} disabled={!q.data?.length}
            title={`Top Products — ${rangeLabel}`} />
          <RangePicker value={range} onChange={setRange} />
        </div>
      </div>
      <div ref={printRef}>
      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-4"><Skeleton /></div>
          ) : q.error ? (
            <ErrorState msg={q.error} onRetry={q.refetch} />
          ) : !q.data?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No order data for this period.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {["#", "Product", "Type", "Revenue", "Units", "Share"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.map((r, i) => {
                  const share = total ? (r.revenue / total) * 100 : 0;
                  return (
                    <tr key={i} className="border-b last:border-b-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">{r.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.type}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmt(r.revenue)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtN(r.units)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-muted-foreground">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

// ─── 3. Inventory Health ──────────────────────────────────────────────────────

export function InventoryHealthReport() {
  const { fmtCurrencyInt: fmt } = useCurrency();
  const kpis = useInventoryKPIs();
  const items = useInventoryHealth();
  const [filter, setFilter] = useState<"all" | "low" | "out" | "expiring">("all");

  const filtered = items.data?.filter(r => {
    if (filter === "low") return r.isLowStock && !r.isOutOfStock;
    if (filter === "out") return r.isOutOfStock;
    if (filter === "expiring") return r.isExpiringSoon;
    return true;
  }) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Inventory health</h2>
        <CsvButton rows={filtered} name="inventory-health"
          columns={[
            { key: "product", header: "Product" },
            { key: "sku", header: "SKU" },
            { key: "inventory", header: "In stock" },
            { key: "committed", header: "Committed" },
            { key: "available", header: "Available" },
            { key: "price", header: "Price" },
            { key: "status", header: "Status", map: r => r.isOutOfStock ? "Out of stock" : r.isLowStock ? "Low stock" : r.isExpiringSoon ? "Expiring" : "OK" },
          ]} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)
        ) : kpis.error ? (
          <div className="col-span-4"><ErrorState msg={kpis.error} onRetry={kpis.refetch} /></div>
        ) : kpis.data ? (
          <>
            <KpiCard label="Total SKUs" value={fmtN(kpis.data.totalSKUs)} />
            <KpiCard label="Out of stock" value={fmtN(kpis.data.outOfStock)} subColor="#ef4444"
              sub={kpis.data.totalSKUs ? `${((kpis.data.outOfStock / kpis.data.totalSKUs) * 100).toFixed(1)}% of SKUs` : undefined} />
            <KpiCard label="Low stock" value={fmtN(kpis.data.lowStock)} subColor="#f59e0b"
              sub="≤ 5 units" />
            <KpiCard label="Expiring soon" value={fmtN(kpis.data.expiringSoon)} subColor="#f59e0b"
              sub="Within 30 days" />
          </>
        ) : null}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted border">
          {(["all", "out", "low", "expiring"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                filter === f ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}>
              {f === "all" ? "All" : f === "out" ? "Out of stock" : f === "low" ? "Low stock" : "Expiring soon"}
            </button>
          ))}
        </div>
        {!items.isLoading && <span className="text-xs text-muted-foreground">{filtered.length} variants</span>}
      </div>

      <Card>
        <CardContent className="p-0">
          {items.isLoading ? (
            <div className="p-4"><Skeleton /></div>
          ) : items.error ? (
            <ErrorState msg={items.error} onRetry={items.refetch} />
          ) : !filtered.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No variants match this filter.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {["Product", "SKU", "In stock", "Committed", "Available", "Price", "Status"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((r, i) => (
                  <tr key={i} className={`border-b last:border-b-0 hover:bg-muted/40 ${r.isOutOfStock ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}>
                    <td className="px-4 py-2.5 font-medium max-w-[160px] truncate">{r.product}</td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono">{r.sku}</td>
                    <td className="px-4 py-2.5 tabular-nums">{r.inventory}</td>
                    <td className="px-4 py-2.5 tabular-nums text-amber-600">{r.committed}</td>
                    <td className="px-4 py-2.5 tabular-nums font-medium">{r.available}</td>
                    <td className="px-4 py-2.5 tabular-nums">{fmt(r.price)}</td>
                    <td className="px-4 py-2.5">
                      {r.isOutOfStock ? (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Out of stock</Badge>
                      ) : r.isLowStock ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">Low stock</Badge>
                      ) : r.isExpiringSoon ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-orange-600 border-orange-300">Expiring</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-600 border-emerald-300">OK</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 4. Fulfillment Report ────────────────────────────────────────────────────

export function FulfillmentReport() {
  const [range, setRange] = useState<DateRange>("30d");
  const summary = useFulfillmentSummary(range);
  const trend = useFulfillmentTrend(range);
  const printRef = useRef<HTMLDivElement>(null);
  const rangeLabel = RANGES.find(r => r.value === range)?.label ?? range;

  const pieData = summary.data
    ? [
        { name: "Fulfilled", value: summary.data.fulfilled, color: "#10b981" },
        { name: "Unfulfilled", value: summary.data.unfulfilled, color: "#ef4444" },
        { name: "Partial", value: summary.data.partial, color: "#f59e0b" },
      ].filter(d => d.value > 0)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Fulfillment report</h2>
        <div className="flex items-center gap-2">
          <CsvButton rows={trend.data} name="fulfillment-trend"
            columns={[
              { key: "date", header: "Date" },
              { key: "fulfilled", header: "Fulfilled" },
              { key: "partial", header: "Partial" },
              { key: "unfulfilled", header: "Unfulfilled" },
            ]} />
          <PdfButton targetRef={printRef} disabled={!summary.data}
            title={`Fulfillment Report — ${rangeLabel}`} />
          <RangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <div ref={printRef} className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {summary.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)
        ) : summary.error ? (
          <div className="col-span-4"><ErrorState msg={summary.error} onRetry={summary.refetch} /></div>
        ) : summary.data ? (
          <>
            <KpiCard label="Total orders" value={fmtN(summary.data.total)} />
            <KpiCard label="Fulfilled" value={fmtN(summary.data.fulfilled)}
              sub={summary.data.total ? `${((summary.data.fulfilled / summary.data.total) * 100).toFixed(1)}%` : undefined}
              subColor="#10b981" />
            <KpiCard label="Unfulfilled" value={fmtN(summary.data.unfulfilled)}
              subColor="#ef4444"
              sub={summary.data.total ? `${((summary.data.unfulfilled / summary.data.total) * 100).toFixed(1)}%` : undefined} />
            <KpiCard label="Paid" value={fmtN(summary.data.paid)}
              subColor="#10b981"
              sub={summary.data.total ? `${((summary.data.paid / summary.data.total) * 100).toFixed(1)}%` : undefined} />
          </>
        ) : null}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 280px" }}>
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fulfillment trend</h3>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {trend.isLoading ? <Skeleton rows={4} /> : trend.error ? (
              <ErrorState msg={trend.error} onRetry={trend.refetch} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trend.data ?? []} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} minTickGap={40} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<ReportTooltip currency={false} />} />
                  <Bar dataKey="fulfilled" name="Fulfilled" stackId="a" fill="#10b981" isAnimationActive={false} />
                  <Bar dataKey="partial" name="Partial" stackId="a" fill="#f59e0b" isAnimationActive={false} />
                  <Bar dataKey="unfulfilled" name="Unfulfilled" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status split</h3>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center pb-4">
            {summary.isLoading ? <Skeleton rows={3} /> : !pieData.length ? (
              <p className="text-xs text-muted-foreground py-4">No data</p>
            ) : (
              <>
                <PieChart width={180} height={180}>
                  <Pie data={pieData} cx={90} cy={90} innerRadius={58} outerRadius={80}
                    strokeWidth={0} paddingAngle={3} dataKey="value">
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                </PieChart>
                <div className="space-y-1.5 w-full mt-2">
                  {pieData.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: d.color }} />
                        <span className="text-muted-foreground">{d.name}</span>
                      </div>
                      <span className="font-medium tabular-nums">{fmtN(d.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}

// ─── 5. Collection Performance ────────────────────────────────────────────────

export function CollectionPerformanceReport() {
  const { fmtCurrencyInt: fmt } = useCurrency();
  const [range, setRange] = useState<DateRange>("thisweek");
  const q = useCollectionPerformance(range);
  const total = q.data?.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const printRef = useRef<HTMLDivElement>(null);
  const rangeLabel = RANGES.find(r => r.value === range)?.label ?? range;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Collection performance</h2>
        <div className="flex items-center gap-2">
          <CsvButton rows={q.data} name="collection-performance"
            columns={[
              { key: "collection", header: "Collection" },
              { key: "revenue", header: "Revenue" },
              { key: "units", header: "Units" },
              { key: "share", header: "Share %", map: r => total ? ((r.revenue / total) * 100).toFixed(1) : "0" },
            ]} />
          <PdfButton targetRef={printRef} disabled={!q.data?.length}
            title={`Collection Performance — ${rangeLabel}`} />
          <RangePicker value={range} onChange={setRange} />
        </div>
      </div>
      <div ref={printRef} className="grid gap-4" style={{ gridTemplateColumns: "1fr 260px" }}>
        <Card>
          <CardContent className="p-0">
            {q.isLoading ? (
              <div className="p-4"><Skeleton /></div>
            ) : q.error ? (
              <ErrorState msg={q.error} onRetry={q.refetch} />
            ) : !q.data?.length ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No data for this period.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    {["Collection", "Revenue", "Units", "Share"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.data.map((r, i) => {
                    const share = total ? (r.revenue / total) * 100 : 0;
                    return (
                      <tr key={i} className="border-b last:border-b-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5 font-medium">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            {r.collection}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{fmt(r.revenue)}</td>
                        <td className="px-4 py-2.5 tabular-nums">{fmtN(r.units)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-20 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${share}%`, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            </div>
                            <span className="text-muted-foreground">{share.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-center justify-center p-4">
            {q.isLoading ? <Skeleton rows={3} /> : !q.data?.length ? null : (
              <>
                <PieChart width={180} height={180}>
                  <Pie data={q.data.map((r, i) => ({ name: r.collection, value: r.revenue, color: PIE_COLORS[i % PIE_COLORS.length] }))}
                    cx={90} cy={90} innerRadius={55} outerRadius={80} strokeWidth={0} paddingAngle={2} dataKey="value">
                    {q.data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                </PieChart>
                <div className="space-y-1.5 w-full mt-2">
                  {q.data.slice(0, 6).map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-muted-foreground truncate max-w-[120px]">{r.collection}</span>
                      </div>
                      <span className="font-medium tabular-nums">{fmt(r.revenue)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
