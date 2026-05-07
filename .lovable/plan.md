

# Inventory Alchemist — Full-Stack Build Plan

## Overview
A pricing & inventory markdown command center built on Lovable + Supabase. UAE timezone (Asia/Dubai). 2,000+ seeded products, real persistent mutations, approval workflows, AI recommendations, simulation mode, and exportable reports.

## Phase 1: Database Foundation
- Create all 15 tables (products, variants, collections, vendors, tags, product_tags, inventory_sync_logs, product_velocity_metrics, pricing_campaigns, pricing_campaign_items, orders, order_items, inventory_batches, simulation_logs, ai_recommendations)
- User roles table (admin/manager/viewer) per security best practices
- App settings table for configurable thresholds
- All check constraints, indexes, and updated_at triggers
- pgcrypto extension, gen_random_uuid() everywhere

## Phase 2: Views & RPC Functions
- Create reporting views: v_product_inventory_summary, v_dashboard_kpis, v_loser_products, v_campaign_performance, v_replenishment_candidates, v_inventory_health_metrics
- RPC functions: create_campaign_draft, approve_and_execute_campaign, apply_bulk_discount, preview_bulk_discount, revert_variant_pricing, preview_what_if_simulation, execute_ai_recommendations
- Margin floor protection in all discount RPCs
- Rounding rules (whole/.00/.99)
- Campaign name uniqueness/versioning

## Phase 3: Seed Data
- 2,000+ products with variants (S/M/L/XL), realistic prices & stock
- Multiple vendors, collections, tags, product types
- Varied created_at dates (some stale/losers)
- Already-discounted items, out-of-stock items, near-expiry items
- Orders (pending/unfulfilled/fulfilled/cancelled) with order_items
- Committed quantities on variants
- Sample campaigns (Draft/Pending/Approved/Rejected/Executed)
- AI recommendations, simulation logs, velocity metrics
- Inventory batches with expiry dates

## Phase 4: App Shell & Navigation
- Sidebar navigation with all 12 pages
- Global search/command bar (Cmd+K) searching products, SKUs, campaigns, vendors, collections
- UAE timezone utility for all timestamps
- CSV/Excel export utility
- Loading skeletons, error states, empty states, toast notifications

## Phase 5: Dashboard Page
- Row 1: On-Hand Inventory, Available Units, Pending Order Inventory, Sell-Through Ratio %
- Row 2: Out of Stock, Losers (red), Winners (green), Collections, Vendors
- Row 3: Near Expiry (amber), Low Stock Winners, Campaigns Running, Pending Approvals (violet)
- Inventory Actuals section with expandable breakdown by collection/vendor/product type
- Shelf Life of Losers table (paginated, 10/page)
- All wired to v_dashboard_kpis view

## Phase 6: Product Master Page
- Filterable table: date range, multi-select collection/vendor/tags, search, expiry status
- Columns: checkbox, badge (🔴/🟢), name, SKU, inventory, original price, current price, days old, status, campaign, expiry status, revert button
- Selection controls (individual, page, all, clear)
- Working Revert button per row (persistent via RPC)
- Paginated, server-side filtered

## Phase 7: Manual Sync Page
- Dedicated command-center interface
- Product selection (from Product Master or inline)
- Discount %, fixed price, campaign name, overwrite toggle, skip discounted toggle, rounding dropdown
- Pre-flight summary (selected, affected, skipped, overwritten counts)
- Preview modal showing only eligible rows
- Confirm & Sync → calls RPC (draft if approval required, execute if not)
- Refreshes dashboard, product master, audit logs

## Phase 8: AI Co-Pilot Page
- Trigger-based recommendations: High Dead Capital, Stale Stock, Zero Velocity, Near Expiry, Low Stock Winner
- Review table with product, SKU, current price, suggested price, discount %, reason
- Only approved 5% markdown tiers (5/10/15/20/25/30%)
- Confirm → creates campaign draft or executes based on approval setting
- Persists to ai_recommendations table

## Phase 9: Auto-Pilot Page
- Rule-based automation display
- Shows trigger rules, discount logic, queued recommendations
- Automation status and review requirement
- All actions auditable, respect approval workflow

## Phase 10: Supporting Pages
- **Audit Logs**: paginated table from inventory_sync_logs, expandable metadata, UAE timestamps
- **Campaign Performance**: campaign metrics table from v_campaign_performance view
- **Replenishment**: low-stock winners from v_replenishment_candidates, status labels
- **Approval Queue**: campaigns by workflow status, approve/reject actions, audit logging
- **Simulation/What-If**: multi-tier discount comparison (10/15/20%), projected metrics, no mutations, save to simulation_logs
- **Expiry Monitoring**: near-expiry/expired/healthy products, filter by status, suggest markdowns
- **Settings**: configurable thresholds (loser days/stock, expiry days, margin floor, discount tiers, rounding, approval required, auto-pilot review)

## Phase 11: Polish & QA
- Consistent badge language across pages
- Partial failure handling with success/failure counts
- Empty states for all pages
- Loading skeletons
- Responsive tables (desktop-first)
- All mutations invalidate relevant queries
- Performance: pagination, server-side filtering for 2,000+ products

