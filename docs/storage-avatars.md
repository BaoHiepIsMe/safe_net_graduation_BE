# Storage: bucket `avatars`

Created by migration `20261112100000_profile_settings_theme_avatars`
(public bucket, 5 MB, `image/jpeg|png|webp`). The app uploads straight to
Supabase Storage with the user's JWT; RLS only allows writes inside the
folder named after the caller's `auth.uid()`.

## Apply the migration

`npx prisma migrate deploy` needs a direct/session connection. If it hangs or
fails on the pooler (`:6543`) or reports a permission error on
`storage.objects`, run the file in the Supabase SQL Editor instead, then:

```bash
npx prisma migrate resolve --applied 20261112100000_profile_settings_theme_avatars
```

Check the `avatars` bucket exists in Dashboard → Storage.

## Verify RLS with curl

Use two real users (A, B). Get a JWT for A via `POST /api/v1/auth/login`
(`data.session.accessToken`) and A's id from `data.user.id`.

```bash
SUPABASE_URL=https://<project>.supabase.co
ANON_KEY=<anon key>
JWT_A=<access token of user A>
A=<user A id>
B=<user B id>
head -c 1024 /dev/urandom > /tmp/small.jpg      # content is irrelevant to RLS
head -c 6291456 /dev/urandom > /tmp/big.jpg     # > 5 MB

# 1) own folder -> expect 200
curl -i -X POST "$SUPABASE_URL/storage/v1/object/avatars/$A/avatar.jpg" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_A" \
  -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @/tmp/small.jpg

# 2) someone else's folder -> expect 403 (row-level security)
curl -i -X POST "$SUPABASE_URL/storage/v1/object/avatars/$B/avatar.jpg" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_A" \
  -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @/tmp/small.jpg

# 3) file > 5 MB -> expect 413 (or 400)
curl -i -X POST "$SUPABASE_URL/storage/v1/object/avatars/$A/avatar.jpg" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_A" \
  -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @/tmp/big.jpg

# public read (no auth) -> expect 200
curl -I "$SUPABASE_URL/storage/v1/object/public/avatars/$A/avatar.jpg"
```
