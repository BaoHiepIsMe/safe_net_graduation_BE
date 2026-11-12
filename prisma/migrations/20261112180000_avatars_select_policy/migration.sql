-- Upload with `x-upsert: true` is INSERT .. ON CONFLICT DO UPDATE, which also
-- needs SELECT on the row. Public reads use the public URL, so scope this to
-- the owner's folder.
DROP POLICY IF EXISTS "avatars_select_own_folder" ON storage.objects;
CREATE POLICY "avatars_select_own_folder" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
