-- =========================================================
-- Codebase Chat: Avatar Storage
-- =========================================================

-- 1. Create a public avatar bucket with upload restrictions.
INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'avatars',
    'avatars',
    TRUE,
    2097152,
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp'
    ]
);

-- 2. Allow public read access to avatar images.
CREATE POLICY "Anyone can view avatars"
ON storage.objects
FOR SELECT
TO public
USING (
    bucket_id = 'avatars'
);

-- 3. Allow authenticated users to upload to their own folder.
CREATE POLICY "Users can upload their own avatars"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

-- 4. Allow users to update their own avatar files.
CREATE POLICY "Users can update their own avatars"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
)
WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

-- 5. Allow users to delete their own avatar files.
CREATE POLICY "Users can delete their own avatars"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
