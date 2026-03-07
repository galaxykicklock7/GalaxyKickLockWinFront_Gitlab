# Edge Function Encryption Fix

## Problem
All Railway edge functions were failing with "Decryption failed" errors because:
- `SUPABASE_ANON_KEY` is a reserved environment variable in Supabase Edge Functions
- It's automatically injected with a short 46-character internal key
- Frontend uses the full 215-character JWT anon key from `.env`
- Key mismatch caused decryption to fail

## Solution
Changed the fallback encryption key from `SUPABASE_ANON_KEY` to `PAYLOAD_ENCRYPTION_KEY`.

## Files Changed

### 1. `supabase/functions/_shared/payloadCrypto.ts`
- Changed fallback from `SUPABASE_ANON_KEY` to `PAYLOAD_ENCRYPTION_KEY`
- Updated comments to document the change

## Deployment Steps

### 1. Add Secret to All Edge Functions
For each edge function, add this secret in Supabase Dashboard:

**Secret Name:** `PAYLOAD_ENCRYPTION_KEY`

**Secret Value:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwam1iYXh2Zm5mZ2drYnhsYWV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxMzI0NTgsImV4cCI6MjA4MzcwODQ1OH0.zQbTTNMLuVvst9dUkNOUqsaP46AJyAjUT-eGa24Rbb0
```

**Edge Functions that need this secret:**
- ✅ `railway-deploy` (already deployed and working)
- `railway-stop`
- `railway-delete`
- `railway-provision`
- `railway-status`

### 2. Deploy Updated Functions
Deploy all edge functions using:
```bash
supabase functions deploy railway-deploy
supabase functions deploy railway-stop
supabase functions deploy railway-delete
supabase functions deploy railway-provision
supabase functions deploy railway-status
```

Or deploy all at once:
```bash
supabase functions deploy
```

## How It Works

### Request Flow:
1. Frontend encrypts payload using `VITE_SUPABASE_ANON_KEY` from `.env`
2. Frontend sends encrypted payload with `Authorization: Bearer <anon_key>` header
3. Edge function extracts anon key from Authorization header
4. Edge function decrypts using the extracted key
5. Edge function processes request
6. Edge function encrypts response using same key
7. Frontend decrypts response

### Fallback Behavior:
- Primary: Uses anon key from Authorization header (extracted by `parseEncryptedRequest`)
- Fallback: Uses `PAYLOAD_ENCRYPTION_KEY` environment variable
- The fallback ensures encryption works even if Authorization header is missing

## Testing
After deployment, test each function:
- ✅ `railway-deploy` - Click "Activate" button (already working)
- `railway-stop` - Click "Deactivate" button
- Admin functions require admin panel testing

## Notes
- All edge functions share the same encryption logic via `_shared/payloadCrypto.ts`
- The encryption uses AES-256-GCM with PBKDF2 key derivation
- Salt: `'gkl-payload-v1'`
- Iterations: 1000
- This matches the frontend `src/utils/payloadCrypto.js` implementation
