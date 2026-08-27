UPDATE public.stores
SET currency = 'AED', currency_symbol = 'د.إ', timezone = 'Asia/Dubai'
WHERE store_code = 'DarussalamUAE'
   OR store_url LIKE '%fxikrx-wy.myshopify.com%';
