# Security Fixes Plan (Excluding .env)

## 1. Fix CSP in `vercel.json` — Remove `unsafe-inline`/`unsafe-eval`
- Remove `'unsafe-inline'` and `'unsafe-eval'` from `script-src`
- Vite builds produce module scripts (no inline scripts needed), so this is safe
- Keep `'unsafe-inline'` for `style-src` since CSS-in-JS and inline styles are used throughout
- Remove `https://*.loca.lt` and `wss://*.loca.lt` from `connect-src` (loca.lt tunnel no longer used — Railway now)
- Remove `http://localhost:*` from `connect-src` (dev-only, shouldn't be in production headers)

## 2. Encrypt session data in `storageManager.js`
- Add simple AES-like obfuscation using `crypto.subtle` (Web Crypto API) with a static app key
- NOT true encryption (key is in frontend code), but prevents casual DevTools/XSS theft
- Add `setSecureItem()` / `getSecureItem()` methods that encode data before storing
- Session keys (`galaxyKickLockSession`, `adminSession`) will use these methods

## 3. Stop session duplication — reduce storage to localStorage only
- Remove sessionStorage, cookie, and IndexedDB writes for session data
- Keep multi-storage only for non-sensitive config data
- Add `setSessionItem()` / `getSessionItem()` that only use localStorage (encrypted)
- This reduces attack surface from 4 storage locations to 1

## 4. Admin session: use storageManager instead of raw localStorage
- `adminAuth.js` line 98: change `localStorage.setItem('adminSession', ...)` to use storageManager
- `adminAuth.js` line 113: change `localStorage.removeItem('adminSession')` to use storageManager
- `adminAuth.js` line 118: change `localStorage.getItem('adminSession')` to use storageManager
- `SecurityDatabase.jsx` line 16: change direct `localStorage.getItem('galaxyKickLockSession')` to use storageManager

## 5. Remove dev proxy console logs from `vite.config.js`
- Remove `proxyReq` and `proxyRes` console.log statements
- Keep error logging
- Disable sourcemaps in production build (`sourcemap: false`)

## 6. Sanitize console.error/warn calls that might leak sensitive data
- `auth.js:233`: `console.error('Invalid session data received')` — fine, no data leaked
- `auth.js:253-255`: logs storage diagnostics — fine, no secrets
- Most console logs just log generic messages, not actual token/session values — acceptable
- No changes needed here after review

## Files to modify:
1. `vercel.json` — CSP fix
2. `src/utils/storageManager.js` — add encryption helpers
3. `src/utils/auth.js` — use encrypted storage for session
4. `src/utils/adminAuth.js` — use storageManager with encryption
5. `src/components/premium/SecurityDatabase.jsx` — use storageManager
6. `vite.config.js` — remove dev logs, disable prod sourcemaps
