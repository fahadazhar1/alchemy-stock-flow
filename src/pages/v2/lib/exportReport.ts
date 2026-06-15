// Lightweight client-side export helpers for v2 Reports.
// CSV: no dependency, Excel-safe (UTF-8 BOM + quoted fields).
// PDF: uses the browser print dialog scoped to a single element (no heavy lib).

export type CsvColumn<T> = {
  key: keyof T | string;
  header: string;
  // optional value transform (e.g. round, format date). Default: raw value.
  map?: (row: T) => string | number | null | undefined;
};

function escapeCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from rows + column defs. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map(c => escapeCell(c.header)).join(",");
  const body = rows.map(row =>
    columns
      .map(c => escapeCell(c.map ? c.map(row) : (row as any)[c.key]))
      .join(",")
  );
  return [head, ...body].join("\r\n");
}

/** Trigger a CSV download in the browser. */
export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const csv = toCsv(columns, rows);
  // BOM so Excel renders UTF-8 (£, accented names) correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Convenience: filename like "top-products_2026-06-15.csv". */
export const csvName = (base: string) => `${base}_${stamp()}.csv`;

/**
 * Print a single element as PDF via the browser print dialog.
 * Opens a clean print window with the element's HTML + the page's stylesheets,
 * so the user gets "Save as PDF" without printing the whole dashboard chrome.
 */
export function printElementAsPdf(el: HTMLElement | null, title: string): void {
  if (!el) return;
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;

  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map(node => node.outerHTML)
    .join("\n");

  win.document.write(`<!doctype html><html><head><title>${title}</title>${styles}
    <style>
      @page { margin: 14mm; }
      body { background: #fff; color: #111; padding: 0; font-family: system-ui, sans-serif; }
      .print-title { font: 600 18px/1.3 system-ui, sans-serif; margin: 0 0 4px; }
      .print-meta { font: 400 11px/1.3 system-ui, sans-serif; color: #666; margin: 0 0 16px;
        padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
      /* Stack the report's side-by-side grid (chart + table) vertically and keep
         each block intact across page breaks for a tidy printout. */
      .print-body .grid { display: block !important; }
      .print-body .grid > * { margin-bottom: 16px; page-break-inside: avoid; }
      .print-body .recharts-wrapper,
      .print-body .recharts-responsive-container { page-break-inside: avoid; margin: 0 auto; }
      .print-body svg { max-width: 100% !important; height: auto; }
      .print-body table { width: 100%; border-collapse: collapse; }
      .print-body th, .print-body td { padding: 6px 8px; }
      /* Force chart fills / colour swatches to print (browsers drop them by default). */
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    </style></head><body>
    <p class="print-title">${title}</p>
    <p class="print-meta">Generated ${new Date().toLocaleString("en-GB")}</p>
    <div class="print-body">${el.innerHTML}</div>
    </body></html>`);
  win.document.close();
  win.focus();
  // give the cloned stylesheets a tick to apply before printing
  win.setTimeout(() => { win.print(); win.close(); }, 400);
}
