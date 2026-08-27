import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ArrowDown, ArrowUp, Download, FileText, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { type DateBounds } from "@/lib/dateRanges";
import { useTopProducts } from "@/hooks/useTopProducts";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  open: boolean;
  onClose: () => void;
  bounds: DateBounds;
  range: string;
}

export function TopProductsModal({ open, onClose, bounds, range }: Props) {
  const { data, isLoading } = useTopProducts(30, bounds);
  const { fmtCurrency, symbol } = useCurrency();

  function handleCSV() {
    if (!data?.length) return;
    exportToCSV(
      data.map((p, i) => ({
        Rank: i + 1,
        Product: p.name,
        SKU: p.sku,
        Vendor: p.vendor,
        "Units Sold": p.units,
        [`Revenue (${symbol})`]: p.revenue.toFixed(2),
        "Trend (%)": p.trend ?? "N/A",
      })),
      `top-products-${range.replace(/\s/g, "-")}`
    );
  }

  function handlePDF() {
    if (!data?.length) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    doc.text("Top Selling Products", 14, 16);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(`Period: ${range}  ·  Ranked by revenue`, 14, 23);

    autoTable(doc, {
      startY: 28,
      head: [["#", "Product", "SKU", "Vendor", "Units", `Revenue (${symbol})`, "Trend"]],
      body: data.map((p, i) => [
        i + 1,
        p.name,
        p.sku,
        p.vendor,
        p.units,
        p.revenue.toFixed(2),
        p.trend === null ? "—" : `${p.trend > 0 ? "+" : ""}${p.trend}%`,
      ]),
      styles: { fontSize: 8, cellPadding: 2.5, valign: "middle" },
      headStyles: { fillColor: [23, 23, 23], textColor: 255, fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      columnStyles: {
        0: { cellWidth: 8 },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    });

    doc.save(`top-products-${range.replace(/\s/g, "-")}.pdf`);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold">
                Top selling products
                <span className="text-muted-foreground font-normal ml-1.5 text-sm">
                  by revenue · {range}
                </span>
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Top 30 best sellers for the selected period</p>
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
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          {isLoading ? (
            <div className="px-5 py-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-md shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                  <Skeleton className="h-6 w-16 shrink-0" />
                </div>
              ))}
            </div>
          ) : !data?.length ? (
            <div className="px-5 py-12 text-center">
              <Package size={32} className="mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No product data for this period</p>
            </div>
          ) : (
            <div>
              {/* Table header */}
              <div className="grid grid-cols-[28px_1fr_80px_80px_80px] gap-3 px-5 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b bg-muted/30">
                <span>#</span>
                <span>Product</span>
                <span className="text-right">Revenue</span>
                <span className="text-right">Units</span>
                <span className="text-right">Trend</span>
              </div>
              {data.map((p, i) => (
                <div
                  key={p.product_id}
                  className="grid grid-cols-[28px_1fr_80px_80px_80px] gap-3 items-center px-5 py-2.5 border-b last:border-b-0 hover:bg-muted/40 transition-colors"
                >
                  <span className="text-xs font-mono text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.vendor} · <span className="font-mono">{p.sku}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{fmtCurrency(p.revenue)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">{p.units} units</div>
                  </div>
                  <div className="flex justify-end">
                    {p.trend === null ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30 bg-muted/40">
                        —
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 py-0 gap-0.5",
                          p.trend > 0
                            ? "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400"
                            : "text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400"
                        )}
                      >
                        {p.trend > 0 ? <ArrowUp size={8} strokeWidth={2.5} /> : <ArrowDown size={8} strokeWidth={2.5} />}
                        {Math.abs(p.trend)}%
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
