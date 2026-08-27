-- Both stores operate on Pakistan Standard Time (GMT+05:00)
UPDATE public.stores
SET timezone = 'Asia/Karachi'
WHERE timezone IS NULL OR timezone = 'Europe/London';

-- Update the column default to match
ALTER TABLE public.stores
  ALTER COLUMN timezone SET DEFAULT 'Asia/Karachi';
