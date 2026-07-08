import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Download, FileText, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { useCurrency } from "@/hooks/useCurrency";
import { useDeadstockAll, getDeadstockLabel, isOverstocked, type DeadstockProduct } from "@/hooks/useDeadstockPreview";
import { format, parseISO } from "date-fns";

const FILTERS = ["all", "Overstocked", "Dead 90d", "Dead 60d", "Dead 30d"] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(p: DeadstockProduct, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "Overstocked") return isOverstocked(p);
  return p.dead_stock_status === filter;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  "Dead 90d":    "text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400",
  "Dead 60d":    "text-orange-500 border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400",
  "Dead 30d":    "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400",
  "Never Sold":  "text-muted-foreground border-dashed",
  "Overstocked": "text-purple-600 border-purple-200 bg-purple-50 dark:bg-purple-950/30 dark:border-purple-800 dark:text-purple-400",
};

function fmtDate(d: string | null) {
  if (!d) return null;
  try { return format(parseISO(d), "dd MMM yy"); } catch { return null; }
}

function Row({ p, fmtCurrency }: { p: DeadstockProduct; fmtCurrency: (v: number) => string }) {
  const label = getDeadstockLabel(p);
  const dateStr = fmtDate(p.last_sale_at);
  return (
    <div className="grid grid-cols-[1fr_70px_96px_88px_88px_80px] gap-2 items-center px-5 py-2.5 border-b last:border-b-0 hover:bg-muted/40 transition-colors">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{p.product_name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {p.product_type ?? "—"} · <span className="font-mono">{p.sku ?? "—"}</span>
        </div>
      </div>
      <div className="text-right text-xs tabular-nums">{p.total_units.toLocaleString()}</div>
      <div>
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", STATUS_STYLE[label] ?? "")}>
          {label}
        </Badge>
      </div>
      <div className="text-right text-xs tabular-nums">{fmtCurrency(p.unit_price)}</div>
      <div className="text-right text-xs tabular-nums font-semibold">{fmtCurrency(p.inventory_value)}</div>
      <div className="text-right text-xs text-muted-foreground">
        {dateStr ? dateStr : <span className="text-red-400 font-medium">Never</span>}
      </div>
    </div>
  );
}

export function DeadstockLosersModal({ open, onClose }: Props) {
  const { fmtCurrency, symbol } = useCurrency();
  const { data: allData, isLoading } = useDeadstockAll(open);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (open) setFilter("all");
  }, [open]);

  const data = useMemo(
    () => allData?.filter(p => matchesFilter(p, filter)),
    [allData, filter]
  );

  function handleCSV() {
    if (!data?.length) return;
    exportToCSV(
      data.map(p => ({
        Product: p.product_name,
        SKU: p.sku ?? "",
        Type: p.product_type ?? "",
        "Stock Units": p.total_units,
        Status: getDeadstockLabel(p),
        [`Unit Price (${symbol})`]: p.unit_price.toFixed(2),
        [`Inventory Value (${symbol})`]: p.inventory_value.toFixed(2),
        "Last Sale": fmtDate(p.last_sale_at) ?? "Never",
      })),
      "deadstock-losers"
    );
  }

  function handlePDF() {
    if (!data?.length) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    doc.text("Deadstock & Overstocked Products", 14, 16);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(`Ordered by inventory value · ${data.length} products`, 14, 23);
    autoTable(doc, {
      startY: 28,
      head: [["Product", "SKU", "Type", "Stock", "Status", `Unit Price (${symbol})`, `Value (${symbol})`, "Last Sale"]],
      body: data.map(p => [
        p.product_name,
        p.sku ?? "—",
        p.product_type ?? "—",
        p.total_units,
        getDeadstockLabel(p),
        p.unit_price.toFixed(2),
        p.inventory_value.toFixed(2),
        fmtDate(p.last_sale_at) ?? "Never",
      ]),
      styles: { fontSize: 7, cellPadding: 2, valign: "middle" },
      headStyles: { fillColor: [23, 23, 23], textColor: 255, fontStyle: "bold", fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      columnStyles: { 3: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    });
    doc.save("deadstock-losers.pdf");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold">
                Deadstock &amp; Overstocked
                <span className="text-muted-foreground font-normal ml-1.5 text-sm">
                  · {isLoading ? "…" : (data?.length ?? 0)} products
                </span>
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Combined dead stock and overstocked inventory, ordered by value at risk</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleCSV} disabled={!data?.length}>
                <Download size={12} /> CSV
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handlePDF} disabled={!data?.length}>
                <FileText size={12} /> PDF
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-1 pt-2.5 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>
        </DialogHeader>

        {!isLoading && !!data?.length && (() => {
          const totalUnits = data.reduce((s, p) => s + p.total_units, 0);
          const totalValue = data.reduce((s, p) => s + p.inventory_value, 0);
          return (
            <div className="flex items-center gap-4 px-5 py-2.5 bg-muted/40 border-b text-xs flex-wrap">
              <span className="text-muted-foreground">{data.length} products</span>
              <div className="w-px h-3 bg-border" />
              <span className="text-muted-foreground">Total units: <span className="font-semibold text-foreground">{totalUnits.toLocaleString()}</span></span>
              <div className="w-px h-3 bg-border" />
              <span className="text-muted-foreground">Total value at risk: <span className="font-bold text-red-600 dark:text-red-400">{fmtCurrency(totalValue)}</span></span>
            </div>
          );
        })()}

        <ScrollArea className="max-h-[65vh]">
          {isLoading ? (
            <div className="px-5 py-4 space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                  <Skeleton className="h-5 w-20 shrink-0" />
                  <Skeleton className="h-5 w-16 shrink-0" />
                  <Skeleton className="h-5 w-16 shrink-0" />
                </div>
              ))}
            </div>
          ) : !data?.length ? (
            <div className="px-5 py-12 text-center">
              <Package size={32} className="mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No deadstock or overstocked products found</p>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[1fr_70px_96px_88px_88px_80px] gap-2 px-5 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b bg-muted/30">
                <span>Product</span>
                <span className="text-right">Stock</span>
                <span>Status</span>
                <span className="text-right">Unit Price</span>
                <span className="text-right">Value at Risk</span>
                <span className="text-right">Last Sale</span>
              </div>
              {data.map(p => (
                <Row key={p.product_id} p={p} fmtCurrency={fmtCurrency} />
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
