import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportToCSV } from "@/lib/export";
import { ClipboardList, Download, FileText, Package, AlertTriangle, TrendingUp } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ReplenRow = {
  product_id: string;
  product_name: string;
  sku: string;
  available_units: number;
  velocity: number;
  days_of_stock: number;
  replenishment_status: string;
};

const URGENCY_STATUSES = ["Critical", "Replenish Now"];

export default function DraftPO() {
  const { storeId } = useStoreFilter();
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [poSuffix, setPoSuffix] = useState("001");

  const { data, isLoading } = useQuery({
    queryKey: ["draft-po-replenishment", storeId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_replenishment_candidates")
        .select("*")
        .order("days_of_stock", { ascending: true })
        .limit(200);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ReplenRow[];
    },
  });

  const poItems = data?.filter(r => URGENCY_STATUSES.includes(r.replenishment_status)) ?? [];

  const getSuggestedQty = (r: ReplenRow) =>
    Math.max(0, Math.round(r.velocity * (30 / 7) - r.available_units));

  const getQty = (r: ReplenRow) =>
    qtyOverrides[r.product_id] !== undefined ? qtyOverrides[r.product_id] : getSuggestedQty(r);

  const today = new Date().toISOString().slice(0, 10);
  const poNumber = `PO-${today.replace(/-/g, "")}-${poSuffix}`;

  const handleExportCSV = () => {
    if (!poItems.length) return;
    exportToCSV(
      poItems.map(r => ({
        "PO Number": poNumber,
        Date: today,
        SKU: r.sku,
        "Product Name": r.product_name,
        "Urgency": r.replenishment_status,
        "Current Stock": r.available_units,
        "Days of Stock": Math.round(r.days_of_stock),
        "Weekly Sales": r.velocity,
        "Suggested Qty": getSuggestedQty(r),
        "Order Qty": getQty(r),
        Notes: "",
      })),
      `draft-po-${today}`
    );
  };

  const handleExportPDF = () => {
    if (!poItems.length) return;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const totalUnits = poItems.reduce((s, r) => s + getQty(r), 0);

    // ── Header bar ──────────────────────────────────────────────
    doc.setFillColor(17, 24, 39); // dark slate
    doc.rect(0, 0, pageW, 22, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("DARUSSALAM UK", 10, 9);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Purchase Order", 10, 15);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("PURCHASE ORDER", pageW - 10, 9, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(poNumber, pageW - 10, 15, { align: "right" });

    // ── Meta block ───────────────────────────────────────────────
    doc.setTextColor(30, 30, 30);
    const metaY = 30;
    const col = pageW / 4;

    const meta = [
      ["Date", today],
      ["Total SKUs", String(poItems.length)],
      ["Total Units", String(totalUnits)],
      ["Status", "DRAFT"],
    ];
    meta.forEach(([label, value], i) => {
      const x = 10 + i * col;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(label, x, metaY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(30, 30, 30);
      doc.text(value, x, metaY + 6);
    });

    // ── Divider ──────────────────────────────────────────────────
    doc.setDrawColor(220, 220, 220);
    doc.line(10, metaY + 12, pageW - 10, metaY + 12);

    // ── Table ────────────────────────────────────────────────────
    autoTable(doc, {
      startY: metaY + 16,
      margin: { left: 10, right: 10 },
      head: [["#", "Product Name", "SKU", "Urgency", "Current Stock", "Days Left", "Weekly Sales", "Order Qty"]],
      body: poItems.map((r, i) => [
        i + 1,
        r.product_name,
        r.sku,
        r.replenishment_status,
        r.available_units,
        `${Math.round(r.days_of_stock)}d`,
        r.velocity,
        getQty(r),
      ]),
      foot: [["", "", "", "", "", "", "Total Units", totalUnits]],
      headStyles: {
        fillColor: [243, 244, 246],
        textColor: [50, 50, 50],
        fontStyle: "bold",
        fontSize: 8,
        halign: "center",
      },
      footStyles: {
        fillColor: [243, 244, 246],
        textColor: [30, 30, 30],
        fontStyle: "bold",
        fontSize: 9,
      },
      bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
      columnStyles: {
        0: { halign: "center", cellWidth: 8 },
        1: { cellWidth: 80 },
        2: { halign: "center", cellWidth: 22 },
        3: { halign: "center", cellWidth: 28 },
        4: { halign: "center", cellWidth: 24 },
        5: { halign: "center", cellWidth: 20 },
        6: { halign: "center", cellWidth: 24 },
        7: { halign: "center", cellWidth: 20, fontStyle: "bold" },
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      didParseCell: (data) => {
        // Highlight Critical rows
        if (data.section === "body" && data.row.index < poItems.length) {
          const status = poItems[data.row.index]?.replenishment_status;
          if (status === "Critical") {
            data.cell.styles.textColor = [185, 28, 28];
            data.cell.styles.fontStyle = "bold";
          }
        }
      },
    });

    // ── Footer note ──────────────────────────────────────────────
    const finalY = (doc as any).lastAutoTable?.finalY ?? 180;
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Generated by Inventory Alchemist · ${today} · Order quantities may be edited before submission`,
      10,
      finalY + 8
    );

    doc.save(`${poNumber}.pdf`);
  };

  if (isLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" /> Draft Purchase Order
          </h1>
          <p className="text-sm text-muted-foreground">
            Auto-generated from Critical + Replenish Now items — edit quantities before export
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCSV} disabled={!poItems.length}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
          <Button onClick={handleExportPDF} disabled={!poItems.length}>
            <FileText className="h-4 w-4 mr-1" /> Download PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">PO Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 pt-0">
          <div>
            <p className="text-xs text-muted-foreground mb-1">PO Number</p>
            <div className="flex items-center gap-1">
              <span className="font-mono text-sm">PO-{today.replace(/-/g, "")}-</span>
              <Input
                className="h-7 w-16 font-mono text-sm px-2"
                value={poSuffix}
                onChange={e => setPoSuffix(e.target.value.slice(0, 4))}
              />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Date</p>
            <p className="font-mono text-sm">{today}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Items</p>
            <p className="font-mono text-sm">{poItems.length} SKUs</p>
          </div>
        </CardContent>
      </Card>

      {!poItems.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No urgent replenishment items</p>
          <p className="text-xs mt-1">Critical and Replenish Now items will appear here</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead className="text-right">Days Left</TableHead>
                <TableHead className="text-right">Weekly Sales</TableHead>
                <TableHead className="text-right w-32">Order Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {poItems.map(r => (
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium max-w-[220px] truncate">{r.product_name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[11px]",
                        r.replenishment_status === "Critical"
                          ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400"
                          : "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400"
                      )}
                    >
                      {r.replenishment_status === "Critical" && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
                      {r.replenishment_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.available_units}</TableCell>
                  <TableCell className={cn("text-right font-mono", r.days_of_stock < 3 ? "text-red-600 font-semibold" : "")}>
                    {Math.round(r.days_of_stock)}d
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span className="flex items-center justify-end gap-1">
                      <TrendingUp className="h-3 w-3 text-muted-foreground" />
                      {r.velocity}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      className="h-7 w-20 text-right font-mono text-sm ml-auto"
                      value={getQty(r)}
                      onChange={e => setQtyOverrides(prev => ({
                        ...prev,
                        [r.product_id]: Math.max(0, Number(e.target.value)),
                      }))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
