-- Collection Performance report fix.
--
-- Problem: get_report_collection_performance bucketed each order line by
-- products.collection_id (a single FK the sync sets). For Darussalam that FK
-- frequently points at catch-all smart collections ("All", "Trending Now")
-- which contain the whole catalog, so "All" surfaced as the #1 performer and
-- the genuine topic collections were hidden.
--
-- Fix (single-primary, clean totals — no double counting):
--   * Keep ONE collection per product so revenue/units totals stay exact.
--   * Never attribute to a catch-all ("All", "Trending Now"). If a product's
--     primary collection_id is a catch-all (or null), re-home it to the
--     LARGEST real collection it belongs to (via the product_collections
--     junction), which maps to a recognisable browse category.
--   * Products with no real collection fall back to 'Uncategorised'.
--
-- Catch-all set is matched by name (case-insensitive) across all stores so it
-- applies per store automatically.

CREATE OR REPLACE FUNCTION public.get_report_collection_performance(
  p_from      timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (collection text, revenue numeric, units numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH catchall AS (
    SELECT id FROM public.collections
    WHERE name ILIKE 'all' OR name ILIKE 'trending now'
  ),
  coll_size AS (
    SELECT collection_id, COUNT(*)::int AS n
    FROM public.product_collections
    GROUP BY collection_id
  ),
  -- For each product, its largest real (non-catch-all) collection.
  fallback AS (
    SELECT DISTINCT ON (pc.product_id)
           pc.product_id,
           pc.collection_id
    FROM public.product_collections pc
    JOIN public.collections c ON c.id = pc.collection_id
    LEFT JOIN coll_size s ON s.collection_id = pc.collection_id
    WHERE pc.collection_id NOT IN (SELECT id FROM catchall)
    ORDER BY pc.product_id, s.n DESC NULLS LAST, c.name ASC
  ),
  -- Resolve one collection per product: keep the primary FK unless it is a
  -- catch-all/null, otherwise use the fallback.
  resolved AS (
    SELECT
      p.id AS product_id,
      CASE
        WHEN p.collection_id IS NOT NULL
         AND p.collection_id NOT IN (SELECT id FROM catchall)
        THEN p.collection_id
        ELSE f.collection_id
      END AS coll_id
    FROM public.products p
    LEFT JOIN fallback f ON f.product_id = p.id
  )
  SELECT
    COALESCE(c.name, 'Uncategorised')                       AS collection,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric  AS revenue,
    COALESCE(SUM(oi.quantity), 0)::numeric                  AS units
  FROM public.order_items oi
  JOIN public.orders   o ON o.id = oi.order_id
  LEFT JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN resolved      r ON r.product_id = oi.product_id
  LEFT JOIN public.collections c ON c.id = r.coll_id
  WHERE o.cancelled_at IS NULL
    AND (p_from IS NULL OR o.shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
  GROUP BY c.name
  ORDER BY revenue DESC
$$;
