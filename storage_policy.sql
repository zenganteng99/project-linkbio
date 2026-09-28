-- ============================================
-- FIX RLS for Supabase Storage Bucket
-- Bucket: public-assets
-- Project: aonbjbcytrpjaxuhyucq
-- ============================================

-- ============================================
-- 1. ENABLE RLS ON storage.objects
-- ============================================
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. DELETE EXISTING POLICIES (clean slate)
-- ============================================
DROP POLICY IF EXISTS "Public SELECT on public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Public INSERT on public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Public UPDATE on public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Public DELETE on public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads to public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow public access to public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow public write access to public-assets" ON storage.objects;

-- ============================================
-- 3. CREATE NEW POLICIES FOR PUBLIC-ASSETS BUCKET
-- ============================================

-- Policy: Public SELECT (READ) - Everyone can view files
CREATE POLICY "Public SELECT on public-assets"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'public-assets');

-- Policy: Public INSERT (UPLOAD) - Everyone can upload files
CREATE POLICY "Public INSERT on public-assets"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'public-assets');

-- Policy: Public UPDATE (UPDATE) - Everyone can update files
CREATE POLICY "Public UPDATE on public-assets"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'public-assets')
WITH CHECK (bucket_id = 'public-assets');

-- Policy: Public DELETE (DELETE) - Everyone can delete files
CREATE POLICY "Public DELETE on public-assets"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'public-assets');

-- ============================================
-- 4. ALSO CREATE BUCKET IF NOT EXISTS
-- ============================================
-- Note: Run this in SQL Editor if bucket doesn't exist yet
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('public-assets', 'public-assets', true)
-- ON CONFLICT (id) DO UPDATE SET public = true;

-- ============================================
-- 5. VERIFICATION QUERIES
-- ============================================
-- Run these to verify the policies were created:

-- Check existing policies:
-- SELECT policyname, cmd FROM pg_policies 
-- WHERE tablename = 'objects' AND schemaname = 'storage';

-- Check bucket status:
-- SELECT * FROM storage.buckets WHERE id = 'public-assets';

-- ============================================
-- DONE! Refresh admin.html and try uploading again.
-- ============================================
