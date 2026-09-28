-- =============================================
-- SETUP DATABASE FOR BIO LINK AFFILIATE SYSTEM
-- Supabase Project: aonbjbcytrpjaxuhyucq
-- =============================================

-- =============================================
-- STEP 1: Create settings table
-- This table stores hero & profile configuration for each client
-- =============================================
CREATE TABLE IF NOT EXISTS settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_slug TEXT UNIQUE NOT NULL,
    profile_name TEXT DEFAULT '' NOT NULL,
    hero_title TEXT DEFAULT '' NOT NULL,
    hero_subtitle TEXT DEFAULT '' NOT NULL,
    background_url TEXT DEFAULT '' NOT NULL,
    profile_image_url TEXT DEFAULT '' NOT NULL,
    instagram_link TEXT DEFAULT '' NOT NULL,
    admin_pin TEXT DEFAULT '123456' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- STEP 2: Create products table
-- This table stores up to 10 affiliate products per client
-- =============================================
CREATE TABLE IF NOT EXISTS products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_slug TEXT NOT NULL,
    title TEXT DEFAULT '' NOT NULL,
    price TEXT DEFAULT '' NOT NULL,
    image_url TEXT DEFAULT '' NOT NULL,
    affiliate_link TEXT DEFAULT '' NOT NULL,
    sort_order INT DEFAULT 1 NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- STEP 3: Disable Row Level Security (RLS)
-- For development - allows direct access without auth
-- IMPORTANT: For production, configure RLS policies instead
-- =============================================
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;

-- =============================================
-- STEP 4: Create indexes for better query performance
-- =============================================
CREATE INDEX IF NOT EXISTS idx_settings_client_slug ON settings(client_slug);
CREATE INDEX IF NOT EXISTS idx_products_client_slug ON products(client_slug);
CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products(sort_order);

-- =============================================
-- STEP 5: Insert sample data for testing
-- Default client with initial settings and products
-- =============================================

-- Insert default settings
INSERT INTO settings (
    client_slug, 
    profile_name, 
    hero_title, 
    hero_subtitle, 
    instagram_link,
    admin_pin
) VALUES (
    'default',
    'Toko Affiliate Saya',
    'ðŸŽ‰ Promo Spesial Hari Ini!',
    'Temukan produk berkualitas dengan harga terbaik. Klik untuk melihat collection terbaru!',
    'https://instagram.com/username',
    '123456'
) ON CONFLICT (client_slug) DO UPDATE SET
    profile_name = EXCLUDED.profile_name,
    hero_title = EXCLUDED.hero_title,
    hero_subtitle = EXCLUDED.hero_subtitle,
    instagram_link = EXCLUDED.instagram_link,
    admin_pin = EXCLUDED.admin_pin,
    updated_at = NOW();

-- Insert sample products (only if table is empty)
INSERT INTO products (client_slug, title, price, affiliate_link, sort_order, is_active)
SELECT 'default', 'Produk Unggulan #1', 'Rp 99.000', 'https://tiktok.com', 1, true
WHERE NOT EXISTS (SELECT 1 FROM products WHERE client_slug = 'default' AND sort_order = 1);

INSERT INTO products (client_slug, title, price, affiliate_link, sort_order, is_active)
SELECT 'default', 'Produk Populer #2', 'Rp 149.000', 'https://shopee.com', 2, true
WHERE NOT EXISTS (SELECT 1 FROM products WHERE client_slug = 'default' AND sort_order = 2);

INSERT INTO products (client_slug, title, price, affiliate_link, sort_order, is_active)
SELECT 'default', 'Produk Terlaris #3', 'Rp 199.000', 'https://tiktok.com', 3, true
WHERE NOT EXISTS (SELECT 1 FROM products WHERE client_slug = 'default' AND sort_order = 3);

-- =============================================
-- STEP 6: Verify setup
-- Run these queries to check if tables were created correctly
-- =============================================
-- SELECT * FROM settings;
-- SELECT * FROM products;

-- =============================================
-- SETUP COMPLETE!
-- Now you can:
-- 1. Go to admin.html
-- 2. Enter Client Slug: default
-- 3. Enter PIN: 123456
-- 4. Click "Masuk"
-- =============================================






