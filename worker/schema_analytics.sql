-- =============================================================================
-- CustomLink Analytics Schema - Optimized for Cloudflare D1 Serverless SQLite
-- High-frequency writes dengan UPSERT pattern (ON CONFLICT DO UPDATE)
-- =============================================================================

-- Daily aggregated metrics per client
CREATE TABLE IF NOT EXISTS analytics_daily (
    client_slug TEXT,
    date_str TEXT,
    views INTEGER DEFAULT 0,
    product_clicks INTEGER DEFAULT 0,
    social_clicks INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, date_str)
);

-- Product click tracking per client per product
CREATE TABLE IF NOT EXISTS analytics_products (
    client_slug TEXT,
    product_target TEXT,
    clicks INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, product_target)
);

-- Device type distribution per client
CREATE TABLE IF NOT EXISTS analytics_devices (
    client_slug TEXT,
    device_type TEXT,
    views INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, device_type)
);

-- Referrer sources per client
CREATE TABLE IF NOT EXISTS analytics_referrers (
    client_slug TEXT,
    referrer TEXT,
    views INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, referrer)
);

-- Geographic location tracking per client
CREATE TABLE IF NOT EXISTS analytics_locations (
    client_slug TEXT,
    country TEXT,
    city TEXT,
    views INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, country, city)
);