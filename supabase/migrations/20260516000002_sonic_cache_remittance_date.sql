-- Add remittance_date to sonic_cache (referenced by sonic-tracking function but missing from initial schema)
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS remittance_date timestamptz;
