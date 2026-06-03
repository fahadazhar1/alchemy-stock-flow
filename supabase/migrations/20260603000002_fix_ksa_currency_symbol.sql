UPDATE public.stores
SET currency_symbol = 'SAR'
WHERE store_url LIKE '%hgty2t-hm.myshopify.com%'
   OR store_code = 'hgty2t-hm.myshopify.com';
