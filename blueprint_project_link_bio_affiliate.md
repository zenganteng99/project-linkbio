# BLUEPRINT & ARCHITECTURE DOCUMENT

## TikTok & Shopee Affiliate Bio Link (Dynamic Multi-Tenant System)

### 1. Project Overview

* **Project Name:** Custom Dynamic Bio Link & Mini Catalog

* **Target Users:** TikTok/Shopee Affiliates, Local UMKM, Content Creators

* **Tech Stack:**

  * Frontend: HTML5 / Tailwind CSS (Single File or React via VS Code)

  * AI & Development Tool: VS Code + Cline + Claude API

  * Backend & Storage: Supabase (Free Tier, Multi-Project Strategy: 100 clients per 1 Supabase project)

### 2. System Architecture & Multi-Tenant Strategy

To maintain **zero infrastructure cost (Rp 0 / Free Tier forever)** and isolate traffic spikes (viral protection):

* **Max Capacity per Supabase Project:** 100 Clients / Landing Pages.

* **Scaling Rule:** Project 1 handles clients 1–100. When client 101 joins, spin up a new free Supabase project.

* **Routing / Configuration:** Use a local mapping file or a master configuration to route each client slug (`/store-a`, `/store-b`) to the correct Supabase API URL and Anon Key.

### 3. Database Schema (Supabase PostgreSQL)

For each Supabase project, create these two tables:

#### Table 1: `settings` (Stores Hero & General Page Config)

*Designed to hold only 1 active row per client/tenant.*

* `id` (UUID or INT, Primary Key)

* `client_slug` (TEXT, Unique - e.g., `brand-a`)

* `profile_name` (TEXT - Display name on the bio link)

* `hero_title` (TEXT - Main heading text)

* `hero_subtitle` (TEXT - Bio / caption text)

* `background_url` (TEXT - Public URL for hero background image)

* `profile_image_url` (TEXT - Public URL for avatar/profile picture)

* `instagram_link` (TEXT - Permanent Instagram URL at the very bottom)

* `updated_at` (TIMESTAMP)

#### Table 2: `products` (Stores the 10 Affiliate Products)

* `id` (UUID or INT, Primary Key)

* `client_slug` (TEXT - Links product to the specific tenant)

* `sort_order` (INT - Display order from 1 to 10)

* `title` (TEXT - Product name)

* `price` (TEXT - Optional: Product price)

* `image_url` (TEXT - Public URL of the product image)

* `affiliate_link` (TEXT - TikTok / Shopee affiliate target URL)

* `is_active` (BOOLEAN - Toggle to show/hide product temporarily)

### 4. Admin Panel Features (Client-Facing)

A simple, mobile-friendly admin page (`/admin`) for non-technical clients:

1. **Hero & Profile Editor:**

   * Text inputs for Title, Subtitle, and Instagram Link.

   * File upload buttons for Profile Picture and Background Image.

2. **Auto-Delete Storage Logic:**

   * When a client uploads a new image, the script automatically deletes the old image file from Supabase Storage to prevent storage quota bloat.

3. **Product Manager (1 to 10 slots):**

   * Fields for Product Title, Image URL (or direct file upload), and Affiliate Link.

   * Instant save button that performs a `UPSERT` or `UPDATE` query to Supabase.

### 5. Frontend Rendering Logic (Visitor View)

When a user visits `yourdomain.com/[client_slug]`:

1. JavaScript fetches data from Supabase where `client_slug` matches the URL path.

2. Dynamically renders:

   * Profile picture & header details.

   * Background image styling.

   * Up to 10 product cards with direct click-through to affiliate links.

   * Permanent Instagram button pinned at the very bottom.

### 6. Step-by-Step Implementation Guide for Cline / Claude

1. **Step 1:** Initialize the single-file HTML/Tailwind structure or React component.

2. **Step 2:** Setup Supabase client initialization using environment variables.

3. **Step 3:** Code the frontend view to fetch data on page load (`useEffect` or Vanilla JS `async/await`).

4. **Step 4:** Code the simple Admin Form with Supabase Storage upload and Auto-Delete functionality.

5. **Step 5:** Deploy the static frontend for free on Vercel or Netlify.