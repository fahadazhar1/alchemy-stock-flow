-- Per-collection product breakdown for the Collection Performance report.
--
-- Returns the products attributed to ONE collection, using the SAME priority
-- resolution as get_report_collection_performance (migration ...010), so the
-- per-product rows reconcile exactly with the collection's headline revenue/
-- units. Used by the expandable row drill-down in the Reports UI.

CREATE OR REPLACE FUNCTION public.get_report_collection_products(
  p_collection text,
  p_from       timestamptz DEFAULT NULL,
  p_store_id   uuid        DEFAULT NULL
)
RETURNS TABLE (product text, revenue numeric, units numeric)
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
  prio (pat, tier) AS (
    VALUES
      ('islamic children books', 10), ('muslim children books', 10),
      ('kids summer collection', 10), ('learning roots', 10),
      ('biography', 20), ('prophet%seerah', 20), ('tafseer', 20), ('fiqh', 20),
      ('ahadith e nabvi', 20), ('ahadith qudsi', 20), ('hadith books online', 20),
      ('history', 20), ('faith/aqeedah', 20), ('islamic faith', 20),
      ('pillars of islam', 20), ('companions of prophet%', 20),
      ('imams%scholars', 20), ('fasting', 20), ('hajj and umrah', 20),
      ('zakaat', 20), ('dawah', 20), ('science', 20), ('prayer/supplication', 20),
      ('women', 20), ('family', 20), ('marital relations', 20), ('education', 20),
      ('buy quran', 30), ('quran mushaf', 30), ('quran tajweed', 30),
      ('quran with english translation', 30), ('quran translation', 30),
      ('parah/parts', 30), ('urdu translation', 30),
      ('islamic books', 40), ('miscellaneous books', 40), ('lifestyle', 40),
      ('arabic books', 50), ('urdu books', 50),
      ('islamic products', 60), ('organic products', 60), ('food items', 60),
      ('shalwar kameez', 60), ('abayas', 60), ('thobes', 60), ('oud', 60),
      ('best sellers', 70), ('clearance sale', 70), ('ramadan special', 70)
  ),
  ranked AS (
    SELECT c.id, c.name, COALESCE(MIN(p.tier), 45) AS tier
    FROM public.collections c
    LEFT JOIN prio p ON lower(c.name) LIKE p.pat
    WHERE c.id NOT IN (SELECT id FROM catchall)
    GROUP BY c.id, c.name
  ),
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
    COALESCE(p.name, '(deleted product)')                  AS product,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric AS revenue,
    COALESCE(SUM(oi.quantity), 0)::numeric                 AS units
  FROM public.order_items oi
  JOIN public.orders   o ON o.id = oi.order_id
  LEFT JOIN resolved      r ON r.product_id = oi.product_id
  LEFT JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.collections c ON c.id = r.coll_id
  WHERE o.cancelled_at IS NULL
    AND (p_from IS NULL OR o.shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND COALESCE(c.name, 'Uncategorised') = p_collection
  GROUP BY p.name
  ORDER BY revenue DESC
  LIMIT 200
$$;
