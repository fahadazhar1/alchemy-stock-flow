-- Collection Performance report — priority-based attribution.
--
-- Background: a product usually belongs to several collections. The report can
-- only credit ONE (single-primary keeps totals exact / no double counting).
-- The previous version credited the LARGEST collection, which dumped almost
-- everything into broad shelves ("Islamic Books", "Best Sellers") and made the
-- real categories (Children, Biography, Quran, ...) look weak.
--
-- Fix: rank collections by a meaningful PRIORITY (audience > topic > Quran
-- edition > general > language > non-book product > marketing). For each
-- product we pick the highest-priority collection it belongs to; ties within a
-- tier break to the SMALLER (more specific) collection, then by name.
--
--   * Catch-alls ("All", "Trending Now") are never candidates — a product that
--     lives ONLY in those falls back to 'Uncategorised'.
--   * Unknown / newly-added collections default to the middle tier (45) until
--     they are explicitly ranked here.
--   * Reporting-only: Shopify product<->collection membership is untouched.
--
-- Matching is by lower(name) LIKE pattern so it applies per store automatically
-- and tolerates curly apostrophes (e.g. "Prophet's Seerah").

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
  -- Priority map. Lower tier wins. lower(name) LIKE pat (no % = exact match).
  prio (pat, tier) AS (
    VALUES
      -- 10  Audience (always win)
      ('islamic children books', 10), ('muslim children books', 10),
      ('kids summer collection', 10), ('learning roots', 10),
      -- 20  Topic
      ('biography', 20), ('prophet%seerah', 20), ('tafseer', 20), ('fiqh', 20),
      ('ahadith e nabvi', 20), ('ahadith qudsi', 20), ('hadith books online', 20),
      ('history', 20), ('faith/aqeedah', 20), ('islamic faith', 20),
      ('pillars of islam', 20), ('companions of prophet%', 20),
      ('imams%scholars', 20), ('fasting', 20), ('hajj and umrah', 20),
      ('zakaat', 20), ('dawah', 20), ('science', 20), ('prayer/supplication', 20),
      ('women', 20), ('family', 20), ('marital relations', 20), ('education', 20),
      -- 30  Quran editions
      ('buy quran', 30), ('quran mushaf', 30), ('quran tajweed', 30),
      ('quran with english translation', 30), ('quran translation', 30),
      ('parah/parts', 30), ('urdu translation', 30),
      -- 40  General
      ('islamic books', 40), ('miscellaneous books', 40), ('lifestyle', 40),
      -- 50  Language
      ('arabic books', 50), ('urdu books', 50),
      -- 60  Non-book products
      ('islamic products', 60), ('organic products', 60), ('food items', 60),
      ('shalwar kameez', 60), ('abayas', 60), ('thobes', 60), ('oud', 60),
      -- 70  Marketing
      ('best sellers', 70), ('clearance sale', 70), ('ramadan special', 70)
  ),
  -- Tier per real collection (unmatched / new collections default to 45).
  ranked AS (
    SELECT c.id, c.name, COALESCE(MIN(p.tier), 45) AS tier
    FROM public.collections c
    LEFT JOIN prio p ON lower(c.name) LIKE p.pat
    WHERE c.id NOT IN (SELECT id FROM catchall)
    GROUP BY c.id, c.name
  ),
  -- One collection per product: highest priority, then most specific (smallest).
  resolved AS (
    SELECT DISTINCT ON (pc.product_id)
           pc.product_id,
           r.id AS coll_id
    FROM public.product_collections pc
    JOIN ranked r       ON r.id = pc.collection_id
    LEFT JOIN coll_size s ON s.collection_id = pc.collection_id
    ORDER BY pc.product_id, r.tier ASC, s.n ASC NULLS LAST, r.name ASC
  )
  SELECT
    COALESCE(c.name, 'Uncategorised')                       AS collection,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric  AS revenue,
    COALESCE(SUM(oi.quantity), 0)::numeric                  AS units
  FROM public.order_items oi
  JOIN public.orders   o ON o.id = oi.order_id
  LEFT JOIN resolved      r ON r.product_id = oi.product_id
  LEFT JOIN public.collections c ON c.id = r.coll_id
  WHERE o.cancelled_at IS NULL
    AND (p_from IS NULL OR o.shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
  GROUP BY c.name
  ORDER BY revenue DESC
$$;
