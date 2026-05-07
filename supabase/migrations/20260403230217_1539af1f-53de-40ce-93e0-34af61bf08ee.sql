
-- Fix views to use SECURITY INVOKER
ALTER VIEW public.v_product_inventory_summary SET (security_invoker = on);
ALTER VIEW public.v_dashboard_kpis SET (security_invoker = on);
ALTER VIEW public.v_loser_products SET (security_invoker = on);
ALTER VIEW public.v_campaign_performance SET (security_invoker = on);
ALTER VIEW public.v_replenishment_candidates SET (security_invoker = on);
