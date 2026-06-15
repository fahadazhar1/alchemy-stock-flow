// ─── Formatters ──────────────────────────────────────────────────────────────

export const fmtNum = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-GB");
export const fmtPct = (n: number | null | undefined): string =>
  n == null ? "—" : n.toFixed(1) + "%";

// ─── Sales trend ─────────────────────────────────────────────────────────────

export interface TrendPoint {
  date: Date;
  label: string;
  revenue: number;
  orders: number;
  visitors: number;
}

function buildSalesTrend(): TrendPoint[] {
  const out: TrendPoint[] = [];
  const today = new Date(2026, 4, 8);
  const base = 8400;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const day = d.getDay();
    const wave = Math.sin(i * 0.45) * 1800;
    const weekend = day === 0 || day === 6 ? 1.18 : 1;
    const trend = (29 - i) * 60;
    const noise = (Math.sin(i * 13.7) + Math.cos(i * 7.3)) * 800;
    const revenue = Math.max(2200, Math.round((base + wave + trend + noise) * weekend));
    const orders = Math.round(revenue / 96 + Math.sin(i) * 6);
    out.push({
      date: d,
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      revenue,
      orders,
      visitors: Math.round(orders / 0.024 + Math.sin(i * 2) * 200),
    });
  }
  return out;
}

export const salesTrend = buildSalesTrend();
export const totalRevenueMTD = salesTrend.slice(-8).reduce((s, x) => s + x.revenue, 0);
export const totalOrdersMTD = salesTrend.slice(-8).reduce((s, x) => s + x.orders, 0);
export const totalRevenueToday = salesTrend[salesTrend.length - 1].revenue;
export const totalRevenueWTD = salesTrend.slice(-7).reduce((s, x) => s + x.revenue, 0);

// ─── Channels ────────────────────────────────────────────────────────────────

export interface Channel {
  name: string;
  key: ChannelKey;
  revenue: number;
  orders: number;
  share: number;
  color: string;
}

export const channels: Channel[] = [
  { name: "Online Store",  key: "web",       revenue: 187200, orders: 1842, share: 46.4, color: "#5E5CE6" },
  { name: "Point of Sale", key: "pos",       revenue:  92500, orders:  612, share: 22.9, color: "#10B981" },
  { name: "Shop App",      key: "shop",      revenue:  68800, orders:  894, share: 17.0, color: "#EC4899" },
  { name: "Wholesale",     key: "wholesale", revenue:  38400, orders:   71, share:  9.5, color: "#F59E0B" },
  { name: "Subscription",  key: "sub",       revenue:  16100, orders:  410, share:  4.0, color: "#06B6D4" },
];

// ─── Products ────────────────────────────────────────────────────────────────

export interface Product {
  name: string;
  sku: string;
  units: number;
  revenue: number;
  vendor: string;
  img: string;
  trend: number;
}

export const topProducts: Product[] = [
  { name: "Organic Argan Oil 100ml",   sku: "ARG-100-OR", units: 612, revenue: 18360, vendor: "Marrakesh Beauty", img: "🪔", trend:  18.4 },
  { name: "Hibiscus Rosehip Toner",    sku: "HIB-RT-200", units: 487, revenue: 14123, vendor: "Bloom & Co.",      img: "🌺", trend:  11.2 },
  { name: "Vitamin C Serum 30ml",      sku: "VIT-C-030",  units: 421, revenue: 25260, vendor: "GlowLab",          img: "🍋", trend:  24.8 },
  { name: "Ceramide Night Cream",      sku: "CER-NC-50",  units: 388, revenue: 19400, vendor: "Skin Theory",      img: "🌙", trend:  -3.1 },
  { name: "Bakuchiol Bio-Retinol",     sku: "BAK-BR-30",  units: 305, revenue: 22875, vendor: "GlowLab",          img: "🌿", trend:   7.6 },
  { name: "Hyaluronic Hydrobase",      sku: "HYA-HB-50",  units: 274, revenue: 13700, vendor: "Skin Theory",      img: "💧", trend:   5.4 },
  { name: "Niacinamide 10% + Zinc",    sku: "NIA-Z-30",   units: 251, revenue:  7530, vendor: "PureForm",         img: "🧪", trend:  -8.2 },
];

export const collectionSales = [
  { name: "Skincare",    revenue: 178400, color: "#5E5CE6" },
  { name: "Haircare",    revenue:  92800, color: "#EC4899" },
  { name: "Body & Bath", revenue:  64500, color: "#10B981" },
  { name: "Wellness",    revenue:  42100, color: "#F59E0B" },
  { name: "Fragrance",   revenue:  25200, color: "#06B6D4" },
];

export const customerSplit = { new: 38, returning: 62, newRevenue: 142800, returningRevenue: 260200 };

// ─── Inventory ───────────────────────────────────────────────────────────────

export const inventoryByCategory = [
  { name: "Skincare",    units: 8240, color: "#5E5CE6" },
  { name: "Haircare",    units: 4180, color: "#EC4899" },
  { name: "Body & Bath", units: 3120, color: "#10B981" },
  { name: "Wellness",    units: 2840, color: "#F59E0B" },
  { name: "Fragrance",   units: 1962, color: "#06B6D4" },
];

export interface Loser {
  id: string; name: string; sku: string; vendor: string;
  collection: string; stock: number; days: number; price: number; compare: number;
}

export const losers: Loser[] = [
  { id:"L001", name:"Coconut Body Polish 250g",   sku:"COC-BP-250", vendor:"Bloom & Co.",      collection:"Body & Bath", stock:142, days:84, price:24, compare:32 },
  { id:"L002", name:"Lavender Pillow Mist 100ml",  sku:"LAV-PM-100", vendor:"Aroma House",      collection:"Wellness",    stock: 98, days:71, price:18, compare:22 },
  { id:"L003", name:"Charcoal Detox Mask",          sku:"CHA-DM-75",  vendor:"PureForm",         collection:"Skincare",    stock:211, days:68, price:16, compare:24 },
  { id:"L004", name:"Citrus Cuticle Oil 15ml",      sku:"CIT-CO-15",  vendor:"Marrakesh Beauty", collection:"Body & Bath", stock: 76, days:62, price:12, compare:16 },
  { id:"L005", name:"Tea Tree Foot Cream",           sku:"TEA-FC-100", vendor:"Bloom & Co.",      collection:"Body & Bath", stock:184, days:55, price:14, compare:18 },
  { id:"L006", name:"Rose Quartz Roller",            sku:"RQ-RLR-01",  vendor:"Glow Tools",       collection:"Skincare",    stock: 53, days:49, price:22, compare:30 },
];

export const expiringSoon = [
  { name:"Vitamin C Serum 30ml",   sku:"VIT-C-030",  days:12, units:84 },
  { name:"Probiotic Cleanser",      sku:"PRO-CL-150", days:18, units:42 },
  { name:"Retinol 0.5% Booster",   sku:"RET-B-15",   days:21, units:67 },
  { name:"AHA/BHA Toner",           sku:"AHA-T-200",  days:28, units:51 },
];

export const replenishmentQueue = [
  { name:"Hibiscus Rosehip Toner",   sku:"HIB-RT-200", suggested:300, vendor:"Bloom & Co.",      urgency:"High"   as const },
  { name:"Organic Argan Oil 100ml",  sku:"ARG-100-OR", suggested:500, vendor:"Marrakesh Beauty", urgency:"High"   as const },
  { name:"Bakuchiol Bio-Retinol",    sku:"BAK-BR-30",  suggested:240, vendor:"GlowLab",          urgency:"Medium" as const },
  { name:"Ceramide Night Cream",     sku:"CER-NC-50",  suggested:180, vendor:"Skin Theory",      urgency:"Medium" as const },
  { name:"Niacinamide 10% + Zinc",   sku:"NIA-Z-30",   suggested:320, vendor:"PureForm",         urgency:"Low"    as const },
];

export const agingBuckets = [
  { label:"0–14d",  units: 9420, color:"#10B981" },
  { label:"15–30d", units: 5180, color:"#5E5CE6" },
  { label:"31–60d", units: 3290, color:"#F59E0B" },
  { label:"61–90d", units: 1480, color:"#EF4444" },
  { label:"90+d",   units:  472, color:"#7C2D12" },
];

// ─── Orders ──────────────────────────────────────────────────────────────────

export type ChannelKey = "web" | "pos" | "shop" | "wholesale" | "sub";
export type OrderStatus = "Pending" | "Fulfilled" | "Cancelled" | "Refunded";

export const channelLabels: Record<ChannelKey, string> = {
  web: "Online", pos: "POS", shop: "Shop App", wholesale: "Wholesale", sub: "Subscription",
};

export interface Order {
  id: string; number: string; date: Date;
  customer: string; email: string; city: string;
  channel: ChannelKey; store: string;
  status: OrderStatus; payment: string;
  items: number; total: number;
}

export interface LineItem {
  name: string; sku: string; vendor: string; img: string;
  qty: number; price: number; total: number;
}

const customerNames = [
  "Amelia Howard","Liam Patel","Sophia Chen","Noah Adams","Isabella Rossi",
  "Ethan Kim","Olivia Brown","Lucas Singh","Mia García","Aiden Walker",
  "Charlotte Davies","Mason Wright","Ava Martín","Logan Reed","Zoe Hassan",
  "Jacob Foster","Lily O'Connor","Henry Müller","Ella Tanaka","Sebastián López",
  "Maya Khan","Owen Hughes","Aria Nakamura","Caleb Romano","Layla Costa",
];
const channelKeys: ChannelKey[] = ["web","pos","shop","wholesale","sub"];
const storeNames = ["Inv. Alchemist UK","Inv. Alchemist DE","Wholesale Hub"];

function buildOrders(n = 48): Order[] {
  const out: Order[] = [];
  let id = 5240;
  const today = new Date(2026, 4, 8);
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - Math.floor(i * 0.7));
    d.setHours(9 + (i % 12), (i * 17) % 60);
    const r = (i * 9301 + 49297) % 233280;
    const items = 1 + (r % 4);
    const ppm = 18 + (r % 60);
    const total = items * ppm + (r % 12);
    const roll = (r * 31 + i * 3) % 100;
    const status: OrderStatus =
      i < 8 ? "Pending" :
      roll < 70 ? "Fulfilled" :
      roll < 78 ? "Pending" :
      roll < 90 ? "Refunded" : "Cancelled";
    const cities = ["London","Manchester","Birmingham","Edinburgh","Bristol","Leeds","Glasgow","Cardiff"];
    out.push({
      id: "ORD-" + id++,
      number: "#" + (10240 + i),
      date: d,
      customer: customerNames[i % customerNames.length],
      email: customerNames[i % customerNames.length].toLowerCase().replace(/\s/g,".").replace(/[^a-z.]/g,"") + "@gmail.com",
      city: cities[i % cities.length],
      channel: channelKeys[r % channelKeys.length],
      store: storeNames[r % storeNames.length],
      status,
      payment: status === "Cancelled" ? "Voided" : status === "Refunded" ? "Refunded" : "Paid",
      items,
      total,
    });
  }
  return out;
}

export const orders = buildOrders(48);

const lineItemPool = [
  ...topProducts.slice(0, 6),
  { name:"Coconut Body Polish 250g", sku:"COC-BP-250", vendor:"Bloom & Co.",      img:"🌿", units:0, revenue:0, trend:0 },
  { name:"Lavender Pillow Mist",     sku:"LAV-PM-100", vendor:"Aroma House",      img:"🌿", units:0, revenue:0, trend:0 },
  { name:"Charcoal Detox Mask",      sku:"CHA-DM-75",  vendor:"PureForm",         img:"🌿", units:0, revenue:0, trend:0 },
  { name:"Citrus Cuticle Oil 15ml",  sku:"CIT-CO-15",  vendor:"Marrakesh Beauty", img:"🌿", units:0, revenue:0, trend:0 },
];

export function buildLineItems(order: Order): LineItem[] {
  const r = parseInt(order.id.replace("ORD-", ""));
  return Array.from({ length: order.items }, (_, i) => {
    const p = lineItemPool[(r + i * 7) % lineItemPool.length];
    const qty = 1 + ((r + i) % 3);
    const price = 14 + ((r + i * 11) % 70);
    return { name: p.name, sku: p.sku, vendor: p.vendor, img: p.img, qty, price, total: qty * price };
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export const reportTemplates = [
  { id:"sales-summary",    name:"Sales Summary",      desc:"Revenue, orders, AOV, by channel & date",     icon:"BarChart2",      category:"Sales",     color:"#5E5CE6", lastRun:"2 hours ago" },
  { id:"inventory-aging",  name:"Inventory Aging",    desc:"Days-on-shelf distribution by collection",    icon:"Clock",          category:"Inventory", color:"#F59E0B", lastRun:"Yesterday"   },
  { id:"vendor-perf",      name:"Vendor Performance", desc:"Sell-through, returns, restock by vendor",   icon:"Truck",          category:"Vendors",   color:"#10B981", lastRun:"3 days ago"  },
  { id:"channel-mix",      name:"Channel Breakdown",  desc:"Revenue and AOV by sales channel",            icon:"Globe",          category:"Sales",     color:"#EC4899", lastRun:"Today"       },
  { id:"loser-report",     name:"Loser Products",     desc:"Slow-movers >20 days, suggested actions",    icon:"TrendingDown",   category:"Inventory", color:"#EF4444", lastRun:"Today"       },
  { id:"winner-report",    name:"Winner Products",    desc:"Fast-movers and low-stock at-risk SKUs",     icon:"Award",          category:"Inventory", color:"#10B981", lastRun:"1 hour ago"  },
  { id:"collection-perf",  name:"Collection Performance", desc:"Best-performing collections by revenue & units", icon:"Layers",     category:"Marketing", color:"#0EA5E9", lastRun:"Today"       },
  { id:"customer-cohort",  name:"Customer Cohorts",   desc:"New vs returning, repeat rate by month",     icon:"Users",          category:"Customers", color:"#8B5CF6", lastRun:"6 days ago"  },
  { id:"expiry-monitor",   name:"Expiry Monitor",     desc:"Stock expiring in next 30/60/90 days",       icon:"AlertTriangle",  category:"Inventory", color:"#F59E0B", lastRun:"Today"       },
  { id:"campaign-roi",     name:"Campaign ROI",       desc:"Discount lift, units moved, margin impact",  icon:"Megaphone",      category:"Marketing", color:"#06B6D4", lastRun:"Yesterday"   },
];

export const savedReports = [
  { name:"Q2 Skincare Performance",        template:"Sales Summary",    owner:"You",      updated:"May 7, 2026",  schedule:"Weekly"  },
  { name:"Wholesale Aging — DE store",     template:"Inventory Aging",  owner:"Marcus L.",updated:"May 5, 2026",  schedule:"Monthly" },
  { name:"Top 50 SKUs by margin",          template:"Custom",           owner:"You",      updated:"May 4, 2026",  schedule:null      },
  { name:"Returning customer revenue",     template:"Customer Cohorts", owner:"Priya R.", updated:"Apr 30, 2026", schedule:"Monthly" },
  { name:"End-of-Season Loser Audit",      template:"Loser Products",   owner:"You",      updated:"Apr 28, 2026", schedule:null      },
];
