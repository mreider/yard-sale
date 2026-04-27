-- Migration: Add sale privacy, profile privacy, and region support
-- Author: Matt Reider (claude session)
-- Date: 2026-04-27
--
-- Adds visibility modes (public/private), regional discovery, and profile
-- privacy controls. Part of M6 (privacy + discovery feature).

-- sales table
ALTER TABLE sales ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE sales ADD COLUMN private_token TEXT UNIQUE;
ALTER TABLE sales ADD COLUMN region_country TEXT;
ALTER TABLE sales ADD COLUMN region_city TEXT;
CREATE INDEX idx_sales_private_token ON sales(private_token)
  WHERE private_token IS NOT NULL;
CREATE INDEX idx_sales_discovery ON sales(visibility, region_country, region_city)
  WHERE visibility = 'public';

-- users table
ALTER TABLE users ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN default_region_country TEXT;
ALTER TABLE users ADD COLUMN default_region_city TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
