import { useState, useMemo } from "react";
import { X, Download, Search, FileText, Table2, TrendingDown, TrendingUp, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useCODDeliveredOrders, type CodDeliveredOrder } from "@/hooks/useCODDeliveredOrders";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPKR = (n: number | null | undefined) =>
  n == null ? "—" : `Rs. ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const parsed = new Date(d);
  return isNaN(parsed.getTime())
    ? d
    : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const fmtChannel = (s: string | null) => {
  if (!s) return "—";
  const k = s.toLowerCase();
  if (k === "web" || k === "online_store") return "Online Store";
  if (k === "pos") return "POS";
  if (k === "android" || k === "iphone" || k === "shop") return "Shop App";
  if (k === "shopify_draft_orders") return "Draft";
  return s;
};

function sonicPaymentCls(status: string | null) {
  if (!status) return "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400";
  const s = status.toLowerCase();
  if (s.startsWith("payment -") || s === "paid")
    return "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400";
  return "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400";
}

// ─── Export helpers ───────────────────────────────────────────────────────────

const HEADERS = [
  "Order #", "Date", "Customer Email", "Channel", "Store",
  "Tracking #", "Courier", "Courier Status", "Payment Status",
  "Order Total (PKR)", "COD Amount (PKR)", "Weight Charges (PKR)",
  "Fuel Surcharge (PKR)", "GST (PKR)", "WHT (PKR)", "COD SST (PKR)",
  "Net Receivable (PKR)", "Remittance Date",
];

function rowToArray(r: CodDeliveredOrder): (string | number)[] {
  return [
    r.order_number ?? "",
    r.order_date ? new Date(r.order_date).toLocaleDateString("en-GB") : "",
    r.customer_email ?? "",
    fmtChannel(r.source_name),
    r.store_name ?? "",
    r.tracking_number ?? "",
    r.courier?.toUpperCase() ?? "",
    r.courier_status ?? "",
    r.courier_payment_status ?? "",
    r.order_total ?? "",
    r.cod_amount ?? "",
    r.shipping_charges ?? "",
    r.fuel_surcharge ?? "",
    r.gst ?? "",
    r.wht ?? "",
    r.cod_sst ?? "",
    r.net_receivable ?? "",
    r.remittance_date ? new Date(r.remittance_date).toLocaleDateString("en-GB") : "",
  ];
}

function exportCSV(rows: CodDeliveredOrder[], filename: string) {
  const escape = (v: string | number) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    HEADERS.map(escape).join(","),
    ...rows.map(r => rowToArray(r).map(escape).join(",")),
  ];
  const bom = "﻿"; // UTF-8 BOM so Excel opens correctly
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${filename}.csv`);
}

function exportExcel(rows: CodDeliveredOrder[], filename: string) {
  // Generate an HTML table that Excel understands natively
  const esc = (v: string | number) =>
    String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const headerRow = HEADERS.map(h => `<th style="background:#1e293b;color:#fff;font-weight:bold;padding:6px 10px;white-space:nowrap">${esc(h)}</th>`).join("");
  const dataRows = rows.map(r => {
    const cells = rowToArray(r);
    return "<tr>" + cells.map((c, i) => {
      const isNum = i >= 9 && i <= 14;
      const val = Number(c);
      const color = isNum && !isNaN(val) ? (val < 0 ? "color:#ef4444" : val > 0 ? "color:#10b981" : "") : "";
      return `<td style="padding:5px 10px;border-bottom:1px solid #e2e8f0;${color}${isNum ? "text-align:right" : ""}">${esc(c)}</td>`;
    }).join("") + "</tr>";
  }).join("");

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook>
    <x:ExcelWorksheets><x:ExcelWorksheet><x:Name>COD Orders</x:Name>
    <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
    <body><table border="1" cellpadding="0" cellspacing="0">
      <thead><tr>${headerRow}</tr></thead>
      <tbody>${dataRows}</tbody>
    </table></body></html>`;

  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
  triggerDownload(blob, `${filename}.xls`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Summary row ──────────────────────────────────────────────────────────────

function SummaryBar({ rows }: { rows: CodDeliveredOrder[] }) {
  const t = useMemo(() => rows.reduce((acc, r) => ({
    order_total:      acc.order_total      + (r.order_total      ?? 0),
    cod_amount:       acc.cod_amount       + (r.cod_amount       ?? 0),
    shipping_charges: acc.shipping_charges + (r.shipping_charges ?? 0),
    fuel_surcharge:   acc.fuel_surcharge   + (r.fuel_surcharge   ?? 0),
    gst:              acc.gst              + (r.gst              ?? 0),
    wht:              acc.wht              + (r.wht              ?? 0),
    cod_sst:          acc.cod_sst          + (r.cod_sst          ?? 0),
    net_receivable:   acc.net_receivable   + (r.net_receivable   ?? 0),
  }), { order_total: 0, cod_amount: 0, shipping_charges: 0, fuel_surcharge: 0, gst: 0, wht: 0, cod_sst: 0, net_receivable: 0 }), [rows]);

  const items = [
    { label: "COD Amount",      val: t.cod_amount,        deduction: false },
    { label: "Weight Charges",  val: t.shipping_charges,  deduction: true  },
    { label: "Fuel Surcharge",  val: t.fuel_surcharge,    deduction: true  },
    { label: "GST",             val: t.gst,               deduction: true  },
    { label: "WHT (2%)",        val: t.wht,               deduction: true  },
    { label: "COD SST (2%)",    val: t.cod_sst,           deduction: true  },
    { label: "Net Receivable",  val: t.net_receivable,    deduction: false },
  ];

  return (
    <div className="grid grid-cols-7 gap-2 p-3 rounded-lg border bg-muted/40 text-xs">
      {items.map(({ label, val, deduction }) => (
        <div key={label} className="text-center">
          <p className="text-muted-foreground mb-0.5 leading-tight">{label}</p>
          <p className={cn("font-bold tabular-nums",
            !deduction
              ? (val < 0 ? "text-red-500 dark:text-red-400" : val > 0 ? "text-emerald-600 dark:text-emerald-400" : "")
              : "text-red-500 dark:text-red-400"
          )}>
            {deduction ? "− " : ""}{fmtPKR(Math.abs(val))}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

function OrdersTable({ rows }: { rows: CodDeliveredOrder[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Table2 size={28} className="mb-2 opacity-40" />
        <p className="text-sm">No orders found</p>
      </div>
    );
  }

  return (
    <table className="w-full text-xs min-w-[1600px]">
      <thead className="sticky top-0 z-10">
        <tr className="border-b bg-muted/80 backdrop-blur">
          {[
            { label: "Order #",         right: false },
            { label: "Date",            right: false },
            { label: "Customer",        right: false },
            { label: "Channel",         right: false },
            { label: "Store",           right: false },
            { label: "Tracking #",      right: false },
            { label: "Courier Status",  right: false },
            { label: "Payment Status",  right: false },
            { label: "Order Total",     right: true  },
            { label: "COD Amount",      right: true  },
            { label: "Weight Chg.",     right: true  },
            { label: "Fuel",            right: true  },
            { label: "GST",             right: true  },
            { label: "WHT",             right: true  },
            { label: "COD SST",         right: true  },
            { label: "Net Receivable",  right: true  },
            { label: "Remitted On",     right: false },
          ].map((h, i) => (
            <th key={i} className={cn(
              "px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap",
              h.right ? "text-right" : "text-left",
            )}>{h.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => {
          const net = r.net_receivable ?? 0;
          const isCod = (r.cod_amount ?? 0) > 0;
          return (
            <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/40 transition-colors">
              <td className="px-3 py-2.5 font-mono font-semibold whitespace-nowrap">{r.order_number}</td>
              <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(r.order_date)}</td>
              <td className="px-3 py-2.5 text-muted-foreground max-w-[140px] truncate">{r.customer_email ?? "—"}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{fmtChannel(r.source_name)}</td>
              <td className="px-3 py-2.5 text-muted-foreground max-w-[120px] truncate">{r.store_name ?? "—"}</td>
              <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{r.tracking_number ?? "—"}</td>
              <td className="px-3 py-2.5">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 whitespace-nowrap bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
                  {r.courier_status ?? "—"}
                </Badge>
              </td>
              <td className="px-3 py-2.5">
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 whitespace-nowrap", sonicPaymentCls(r.courier_payment_status))}>
                  {r.courier_payment_status ?? "Pending"}
                </Badge>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtPKR(r.order_total)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {isCod
                  ? <span className="text-foreground">{fmtPKR(r.cod_amount)}</span>
                  : <span className="text-muted-foreground text-[10px]">Non-COD</span>
                }
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtPKR(r.shipping_charges)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtPKR(r.fuel_surcharge)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtPKR(r.gst)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtPKR(r.wht)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtPKR(r.cod_sst)}</td>
              <td className={cn("px-3 py-2.5 text-right tabular-nums font-semibold",
                net < 0 ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
              )}>
                <span className="flex items-center justify-end gap-1">
                  {net < 0 ? <TrendingDown size={10} /> : <TrendingUp size={10} />}
                  {fmtPKR(net)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(r.remittance_date)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props {
  open:      boolean;
  onClose:   () => void;
  storeId:   string | null;
  released?: boolean;
}

export function CodDeliveredModal({ open, onClose, storeId, released = false }: Props) {
  const [search, setSearch] = useState("");

  const { data = [], isLoading } = useCODDeliveredOrders(storeId, released, open);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(r =>
      r.order_number?.toLowerCase().includes(q) ||
      r.customer_email?.toLowerCase().includes(q) ||
      r.tracking_number?.toLowerCase().includes(q)
    );
  }, [data, search]);

  const title = released ? "SONIC Receivables Released" : "SONIC Receivables Held";
  const filename = released ? "sonic-receivables-released" : "sonic-receivables-held";

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isLoading ? "Loading…" : `${filtered.length} order${filtered.length !== 1 ? "s" : ""}`}
                {!released && " · Net receivable (COD collected minus all courier charges)"}
                {released && " · Already remitted by Sonic"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search order, email, tracking…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 w-56 text-xs"
                />
              </div>
              <Button
                size="sm" variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => exportCSV(filtered, filename)}
                disabled={filtered.length === 0}
              >
                <FileText size={12} /> CSV
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => exportExcel(filtered, filename)}
                disabled={filtered.length === 0}
              >
                <Download size={12} /> Excel
              </Button>
              <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground ml-1">
                <X size={15} />
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Totals summary */}
        {!isLoading && filtered.length > 0 && (
          <div className="px-5 py-3 border-b shrink-0">
            <SummaryBar rows={filtered} />
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading orders…
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="overflow-x-auto">
                <OrdersTable rows={filtered} />
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
