CREATE TABLE IF NOT EXISTS analytics_daily (
    client_slug TEXT NOT NULL,
    date_str TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    product_clicks INTEGER DEFAULT 0,
    social_clicks INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, date_str)
);

CREATE TABLE IF NOT EXISTS analytics_devices (
    client_slug TEXT NOT NULL,
    device_type TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, device_type)
);

CREATE TABLE IF NOT EXISTS analytics_referrers (
    client_slug TEXT NOT NULL,
    referrer TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, referrer)
);

CREATE TABLE IF NOT EXISTS analytics_locations (
    client_slug TEXT NOT NULL,
    country TEXT NOT NULL,
    city TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, country, city)
);

CREATE TABLE IF NOT EXISTS analytics_products (
    client_slug TEXT NOT NULL,
    product_target TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    PRIMARY KEY (client_slug, product_target)
);
