# Inventory Dashboard — Shopify Feature Roadmap

## High Impact — Operational

| # | Feature | What it solves | Est. Effort |
|---|---------|----------------|-------------|
| 1 | **Order Fulfillment Tracker** | See unfulfilled/partially fulfilled orders with age, flag stale ones (>48h) | Medium |
| 2 | **Return & Refund Monitor** | Track return rates by product/collection — spot quality issues early | Medium |
| 3 | **Abandoned Checkout Recovery Dashboard** | Surface recovery rate, top lost products, revenue at risk (data already synced) | Low |
| 4 | **Low Stock Alerts + Auto-Draft PO** | Replenishment exists but no PO generation — create a draft purchase order PDF/CSV | Medium |
| 5 | **Discount Code Performance** | Which codes are actually converting — usage, revenue, avg order lift | Low |

---

## Revenue Intelligence

| # | Feature | What it solves | Est. Effort |
|---|---------|----------------|-------------|
| 6 | **Customer Lifetime Value (LTV) Table** | Segment by spend tier — identify top 10% customers | Medium |
| 7 | **Margin Estimator** | Add cost-price field, compute gross margin per product/collection | Medium |
| 8 | **Dead Stock Report** | Products with zero sales in 60/90 days + inventory value tied up | Low |
| 9 | **Geographic Sales Heatmap** | Orders by city/region — useful for marketing targeting | High |
| 10 | **Bundle Opportunity Finder** | Products frequently bought together — suggest bundle candidates | High |

---

## Store Operations

| # | Feature | What it solves | Est. Effort |
|---|---------|----------------|-------------|
| 11 | **SEO Audit** | Products missing meta title/description, alt text — export CSV | Low |
| 12 | **Price Change History** | Log when prices changed and the before/after — audit trail | Medium |
| 13 | **Collection Health Check** | Collections with <3 active products, missing images, draft products | Low |
| 14 | **Scheduled Publish/Unpause** | Set a product to go live or hide on a future date | Medium |
| 15 | **Bulk Metafield Editor** | Edit product metafields (ISBN, author, publisher) in a spreadsheet-style grid | High |

---

## Quick Wins (1–2 day builds)

| # | Feature | What it solves | Est. Effort |
|---|---------|----------------|-------------|
| 16 | **Stock Age Report** | How long current inventory has been sitting | Low |
| 17 | **Daily Email Digest** | Top KPIs emailed at 8am via cron + Resend/Nodemailer | Low |
| 18 | **Variant-level Inventory Diff** | What changed since last sync | Low |
| 19 | **WhatsApp/Slack Alert** | Ping when a product drops below reorder point | Low |

---

## Status Key

- `Low` — 1–2 days
- `Medium` — 3–5 days
- `High` — 1–2 weeks

---

## Build Order (Recommended)

1. Abandoned Checkout Recovery Dashboard — data already exists, highest ROI
2. Dead Stock Report — pure SQL query + table, fast win
3. Discount Code Performance — useful for campaigns
4. Order Fulfillment Tracker — operational necessity
5. Customer LTV Table — long-term retention insight
