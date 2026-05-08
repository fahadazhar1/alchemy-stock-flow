import { useState, useEffect } from "react";
import {
  Download, Upload, Plus, Search, SlidersHorizontal,
  MoreHorizontal, CheckCircle, Send, XCircle, Copy, Edit2,
  X, Truck, MapPin, Hash, PoundSterling, Mail, CreditCard,
  ShoppingCart, Clock, Package, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import {
  useOrders, useOrderDetail, useOrderLineItems,
  normalizeChannel,
  type OrderRow, type OrderStatus,
} from "@/hooks/useOrders";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const fmtGBP = (n: number | null | undefined): string =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const fmtDateTime = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
      " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS_TABS: OrderStatus[] = ["Pending", "Fulfilled", "Cancelled", "Refunded"];

const STATUS_CLS: Record<string, string> = {
  Pending:   "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400",
  Fulfilled: "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400",
  Cancelled: "text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400",
  Refunded:  "text-violet-600 border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 dark:text-violet-400",
  Paid:      "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400",
  Voided:    "text-muted-foreground border-border",
};

const CHANNEL_META: Record<string, { label: string; cls: string }> = {
  web:                  { label: "Online Store",  cls: "text-indigo-600 border-indigo-200 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-800 dark:text-indigo-400" },
  pos:                  { label: "Point of Sale", cls: "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400" },
  shop:                 { label: "Shop App",      cls: "text-pink-600 border-pink-200 bg-pink-50 dark:bg-pink-950/30 dark:border-pink-800 dark:text-pink-400" },
  shopify_draft_orders: { label: "Draft Orders",  cls: "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400" },
  wholesale:            { label: "Wholesale",     cls: "text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400" },
  subscription:         { label: "Subscription",  cls: "text-cyan-600 border-cyan-200 bg-cyan-50 dark:bg-cyan-950/30 dark:border-cyan-800 dark:text-cyan-400" },
};

const CHANNEL_OPTIONS = [
  { value: "all", label: "All channels" },
  { value: "web", label: "Online Store" },
  { value: "pos", label: "Point of Sale" },
  { value: "shop", label: "Shop App" },
  { value: "shopify_draft_orders", label: "Draft Orders" },
  { value: "wholesale", label: "Wholesale" },
  { value: "subscription", label: "Subscription" },
];

const DATE_OPTIONS = [
  { value: "7",  label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "0",  label: "All time" },
];

const STATUS_DOT: Record<OrderStatus, string> = {
  Fulfilled: "#10b981",
  Pending:   "#f59e0b",
  Refunded:  "#8b5cf6",
  Cancelled: "#ef4444",
};

function channelMeta(ch: string) {
  return CHANNEL_META[ch] ?? { label: ch, cls: "text-muted-foreground" };
}

// ─── Order drawer ─────────────────────────────────────────────────────────────

function DrawerSkeleton() {
  return (
    <div className="p-5 space-y-4 animate-pulse">
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map(i => (
          <div key={i} className="rounded-lg border p-3 space-y-2">
            <div className="h-2.5 bg-muted rounded w-16" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="h-3 bg-muted rounded w-3/4" />
                <div className="h-2.5 bg-muted rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border p-4 space-y-3">
        <div className="h-3 bg-muted rounded w-16" />
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-2.5 bg-muted rounded w-1/2" />
            </div>
            <div className="h-3 bg-muted rounded w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderDrawer({ order, onClose }: { order: OrderRow | null; onClose: () => void }) {
  const { data: detail, isLoading: detailLoading } = useOrderDetail(order?.id ?? null);
  const { data: lineItems = [], isLoading: itemsLoading } = useOrderLineItems(order?.id ?? null);

  const isLoading = detailLoading || itemsLoading;

  const subtotal = lineItems.reduce((s, x) => s + x.total, 0);
  const orderTotal = order?.total ?? subtotal;
  const tax = Math.round(subtotal * 0.2);
  const shipping = subtotal > 0 ? (subtotal > 80 ? 0 : 4.5) : 0;

  const customerName = detail?.customer_name ?? detail?.billing_name ?? null;
  const customerEmail = detail?.customer_email ?? detail?.contact_email ?? null;
  const shippingCity = detail?.shipping_city ?? detail?.billing_city ?? null;
  const shippingLine1 = detail?.shipping_address1 ?? detail?.billing_address1 ?? null;
  const shippingZip = detail?.shipping_zip ?? detail?.billing_zip ?? null;
  const initials = customerName
    ? customerName.split(" ").map((s: string) => s[0]).join("").slice(0, 2).toUpperCase()
    : (order?.orderNumber ?? "?").slice(-2).toUpperCase();

  const orderDate = order?.date ?? null;
  const storeObj = Array.isArray(detail?.stores) ? detail?.stores[0] : detail?.stores;
  const storeName = storeObj?.store_name ?? order?.storeName ?? "—";
  const ch = channelMeta(order?.channel ?? "");

  const timeline = order ? [
    {
      t: "Order placed",
      d: fmtDateTime(orderDate),
      icon: ShoppingCart,
      color: "#6366f1",
    },
    {
      t: detail?.financial_status === "paid" ? "Payment captured" : (detail?.financial_status ?? "Payment"),
      d: fmtDateTime(orderDate),
      icon: CreditCard,
      color: "#10b981",
    },
    {
      t: order.status === "Pending"   ? "Awaiting fulfillment"
        : order.status === "Fulfilled" ? "Fulfilled"
        : order.status === "Cancelled" ? "Cancelled"
        : "Refunded",
      d: order.status === "Pending"
        ? "In picking queue"
        : detail?.updated_at ? fmtDateTime(new Date(detail.updated_at)) : "—",
      icon: order.status === "Pending" ? Clock
          : order.status === "Fulfilled" ? Truck
          : XCircle,
      color: order.status === "Pending"   ? "#f59e0b"
           : order.status === "Fulfilled" ? "#10b981"
           : "#ef4444",
    },
  ] : [];

  return (
    <Sheet open={!!order} onOpenChange={open => !open && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:w-[540px] flex flex-col p-0">
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <SheetTitle className="text-[15px]">{order?.orderNumber ?? "—"}</SheetTitle>
                {order && (
                  <>
                    <Badge variant="outline" className={cn("text-xs", STATUS_CLS[order.status])}>{order.status}</Badge>
                    <Badge variant="outline" className={cn("text-xs", STATUS_CLS[order.paymentLabel] ?? "text-muted-foreground")}>{order.paymentLabel}</Badge>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{fmtDateTime(order?.date ?? null)} · {storeName}</p>
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Copy size={14} /></button>
              <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
              <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><MoreHorizontal size={14} /></button>
              <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" onClick={onClose}><X size={14} /></button>
            </div>
          </div>
        </SheetHeader>

        {isLoading ? (
          <ScrollArea className="flex-1"><DrawerSkeleton /></ScrollArea>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-5 space-y-4">
              {/* Customer + shipping */}
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Customer</p>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                        style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}>{initials}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{customerName ?? order?.orderNumber ?? "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{customerEmail ?? "—"}</p>
                      </div>
                    </div>
                    <div className="flex gap-4 mt-2.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Hash size={10} /> {ch.label}</span>
                      <span className="flex items-center gap-1"><PoundSterling size={10} /> {fmtGBP(orderTotal)}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Ship to</p>
                    {shippingLine1 || shippingCity ? (
                      <div className="flex gap-2 text-xs">
                        <MapPin size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                        <div className="leading-5 text-muted-foreground">
                          {customerName && <span className="text-foreground font-medium block">{customerName}</span>}
                          {shippingLine1 && <span>{shippingLine1}<br /></span>}
                          {shippingCity && <span>{shippingCity}{shippingZip ? ` ${shippingZip}` : ""}</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        <MapPin size={13} className="mt-0.5 shrink-0" />
                        <span>Address not available</span>
                      </div>
                    )}
                    <div className="mt-2">
                      <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0">
                        <Truck size={9} strokeWidth={2} /> {storeName}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Line items */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold">Items</h3>
                    <span className="text-xs text-muted-foreground">{lineItems.length}</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {lineItems.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <Package size={22} className="mx-auto mb-2 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">No line items found</p>
                    </div>
                  ) : (
                    lineItems.map(it => (
                      <div key={it.id} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0">
                        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <Package size={13} className="text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{it.productName}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {it.variantSku}{it.size ? ` · ${it.size}` : ""} · {it.vendorName}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {it.qty} × {fmtGBP(it.unitPrice)}
                        </span>
                        <span className="text-sm font-semibold tabular-nums shrink-0 w-16 text-right">
                          {fmtGBP(it.total)}
                        </span>
                      </div>
                    ))
                  )}
                  <div className="border-t px-4 py-3 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="tabular-nums">{fmtGBP(subtotal || orderTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">VAT (20%)</span>
                      <span className="tabular-nums">{fmtGBP(tax)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Shipping</span>
                      <span className="tabular-nums">{shipping ? fmtGBP(shipping) : "Free"}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t font-semibold text-sm">
                      <span>Total</span>
                      <span className="tabular-nums">{fmtGBP(orderTotal)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Timeline */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-4">
                  <h3 className="text-sm font-semibold">Timeline</h3>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-0">
                  {timeline.map((step, i) => {
                    const StepIcon = step.icon;
                    return (
                      <div key={i} className="flex gap-3 relative pb-4 last:pb-0">
                        {i !== timeline.length - 1 && (
                          <span className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-border" />
                        )}
                        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                          style={{ background: step.color + "22", color: step.color }}>
                          <StepIcon size={12} strokeWidth={2} />
                        </div>
                        <div>
                          <p className="text-xs font-medium leading-6">{step.t}</p>
                          <p className="text-[11px] text-muted-foreground">{step.d}</p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        )}

        <div className="border-t px-5 py-3 flex gap-2 shrink-0">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs"><Mail size={13} /> Email customer</Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs"><Download size={13} /> Invoice</Button>
          <Button size="sm" className="gap-1.5 text-xs ml-auto"><CheckCircle size={13} /> Mark fulfilled</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Table skeleton ───────────────────────────────────────────────────────────

function TableRowSkeleton() {
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-4 py-3 w-10"><div className="w-4 h-4 bg-muted animate-pulse rounded" /></td>
      {[100, 64, 80, 64, 72, 56, 56, 64, 80, 24].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-muted animate-pulse rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Orders() {
  const { storeId } = useStoreFilter();

  const [statusFilter, setStatusFilter] = useState("All");
  const [channelFilter, setChannelFilter] = useState("all");
  const [daysBack, setDaysBack] = useState(30);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<OrderRow | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset page on filter change
  useEffect(() => { setPage(0); setSelected(new Set()); }, [search, statusFilter, channelFilter, daysBack]);

  const { data, isLoading, isFetching } = useOrders({
    page, pageSize: PAGE_SIZE,
    search, status: statusFilter, channel: channelFilter,
    daysBack, storeId,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(from + rows.length - 1, total);
  const totalRevenue = rows.reduce((s, o) => s + o.total, 0);

  const toggleSel = (id: string) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allSelected = rows.length > 0 && selected.size === rows.length && rows.every(r => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)));

  return (
    <div className="p-6 space-y-4 max-w-[1600px]">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Loading…" : `${total.toLocaleString()} orders · ${fmtGBP(totalRevenue)} on this page`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8"><Upload size={13} /> Import</Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8"><Download size={13} /> Export CSV</Button>
          <Button size="sm" className="gap-1.5 text-xs h-8"><Plus size={13} /> New order</Button>
        </div>
      </div>

      {/* Status chips + filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-0 rounded-md border overflow-hidden">
          {["All", ...STATUS_TABS].map(v => (
            <button key={v}
              onClick={() => { setStatusFilter(v); setPage(0); setSelected(new Set()); }}
              className={cn("px-3 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0",
                statusFilter === v ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}>
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search order number…" value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-8 h-8 w-52 text-xs" />
          </div>
          <Select value={channelFilter} onValueChange={v => { setChannelFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(daysBack)} onValueChange={v => { setDaysBack(Number(v)); setPage(0); }}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0">
            <SlidersHorizontal size={14} />
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-primary bg-primary/5 text-xs">
          <span className="font-semibold text-primary">{selected.size} selected</span>
          <span className="w-px h-4 bg-border" />
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><CheckCircle size={12} /> Mark fulfilled</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><Send size={12} /> Send invoice</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><Download size={12} /> Export</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-red-500 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30">
            <XCircle size={12} /> Cancel
          </Button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:text-foreground text-xs">Clear</button>
        </div>
      )}

      {/* Orders table */}
      <Card className={cn(isFetching && !isLoading && "opacity-70 transition-opacity")}>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="px-4 py-3 w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </th>
                {["Order", "Date", "Channel", "Store", "Status", "Payment", "Total", ""].map((h, i) => (
                  <th key={i} className={cn("px-4 py-3 font-medium text-muted-foreground text-left whitespace-nowrap",
                    i === 6 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} />)
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No orders found</td></tr>
              ) : (
                rows.map(o => {
                  const ch = channelMeta(o.channel);
                  return (
                    <tr key={o.id}
                      className={cn("border-b last:border-b-0 hover:bg-muted/40 transition-colors cursor-pointer",
                        selected.has(o.id) && "bg-primary/5")}
                      onClick={() => setDrawer(o)}>
                      <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleSel(o.id); }}>
                        <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggleSel(o.id)} />
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap">{o.orderNumber}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(o.date)}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", ch.cls)}>
                          {ch.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap truncate max-w-[120px]">{o.storeName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1", STATUS_CLS[o.status])}>
                          <span className="w-1 h-1 rounded-full inline-block" style={{ background: STATUS_DOT[o.status] }} />
                          {o.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", STATUS_CLS[o.paymentLabel] ?? "text-muted-foreground")}>
                          {o.paymentLabel}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtGBP(o.total)}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <button className="text-muted-foreground hover:text-foreground"><MoreHorizontal size={14} /></button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
            <span>
              {isLoading ? "Loading…" : total === 0 ? "No results" : `Showing ${from}–${to} of ${total.toLocaleString()}`}
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}>
                <ChevronLeft size={13} />
              </Button>
              <span className="px-2 tabular-nums">{page + 1} / {Math.max(1, totalPages)}</span>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={13} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <OrderDrawer order={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
