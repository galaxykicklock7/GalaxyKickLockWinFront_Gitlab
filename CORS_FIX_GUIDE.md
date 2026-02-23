# CORS Fix Guide

## Problem
Frontend (Vercel) cannot access backend (loca.lt) due to CORS policy:
```
Access to fetch at 'https://bharanitest898.loca.lt/api/timer-status/1' 
from origin 'https://galaxykicklock2.vercel.app' has been blocked by CORS policy
```

## Solution Applied

### 1. Backend CORS Configuration (main.js)

**Updated CORS middleware to:**
- ✅ Allow all `*.loca.lt` subdomains (dynamic tunnels)
- ✅ Allow all `*.vercel.app` domains (preview deployments)
- ✅ Always set `Access-Control-Allow-Origin` header for allowed origins
- ✅ Handle OPTIONS preflight requests properly
- ✅ Include all necessary headers (bypass-tunnel-reminder, x-user-id, etc.)

**Key changes:**
```javascript
// Allow any loca.lt subdomain
else if (origin && origin.match(/^https:\/\/[\w-]+\.loca\.lt$/)) {
    isAllowed = true;
}
// Allow any Vercel deployment URL
else if (origin && origin.match(/^https:\/\/.*\.vercel\.app$/)) {
    isAllowed = true;
}

// Always set CORS headers for allowed origins
res.setHeader('Access-Control-Allow-Origin', origin || '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 
  'Content-Type, Authorization, X-API-Key, ' +
  'bypass-tunnel-reminder, cache-control, pragma, expires, ' +
  'x-requested-with, accept, origin, referer, user-agent, ' +
  'x-user-id'
);
```

### 2. Frontend CSP Configuration (vercel.json)

**Updated Content-Security-Policy to:**
- ✅ Allow connections to `https://*.loca.lt`
- ✅ Allow WebSocket connections to `wss://*.loca.lt`
- ✅ Allow localhost for development

**Key changes:**
```json
"connect-src 'self' http://localhost:3000 http://localhost:5173 https://*.supabase.co https://*.loca.lt https://*.vercel.app https://gitlab.com wss://*.loca.lt"
```

## Testing

### 1. Test CORS from Browser Console

Open browser console on https://galaxykicklock2.vercel.app and run:

```javascript
// Test timer-status endpoint
fetch('https://bharanitest898.loca.lt/api/timer-status/1', {
  headers: {
    'bypass-tunnel-reminder': 'true'
  }
})
.then(r => r.json())
.then(d => console.log('✅ CORS working:', d))
.catch(e => console.error('❌ CORS failed:', e));
```

### 2. Test from Command Line

```bash
# Test with curl (should work)
curl -H "Origin: https://galaxykicklock2.vercel.app" \
     -H "bypass-tunnel-reminder: true" \
     -v https://bharanitest898.loca.lt/api/timer-status/1

# Look for these headers in response:
# Access-Control-Allow-Origin: https://galaxykicklock2.vercel.app
# Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
```

### 3. Check Backend Logs

Backend should log:
```
✅ Allowing origin: https://galaxykicklock2.vercel.app
```

NOT:
```
⚠️ CORS blocked: https://galaxykicklock2.vercel.app
```

## Deployment Steps

### Backend (Restart Required)
1. Stop the backend application
2. Restart with updated main.js
3. Verify loca.lt tunnel is running
4. Check logs for CORS messages

### Frontend (Deploy to Vercel)
1. Commit changes to git
2. Push to repository
3. Vercel auto-deploys
4. Or manually: `vercel deploy --prod`

## Common Issues

### Issue 1: "CORS blocked" in backend logs
**Cause:** Origin not matching allowed patterns
**Fix:** Check origin format matches regex patterns in CORS middleware

### Issue 2: "No 'Access-Control-Allow-Origin' header"
**Cause:** Backend not setting header for the origin
**Fix:** Verify origin is in allowedOrigins or matches regex pattern

### Issue 3: Preflight OPTIONS request fails
**Cause:** OPTIONS handler not returning 200
**Fix:** Ensure `if (req.method === 'OPTIONS') return res.sendStatus(200);`

### Issue 4: CSP blocks connection
**Cause:** Frontend CSP doesn't allow loca.lt
**Fix:** Add `https://*.loca.lt` to `connect-src` in vercel.json

## Verification Checklist

- [ ] Backend CORS allows `*.loca.lt` domains
- [ ] Backend CORS allows `*.vercel.app` domains
- [ ] Backend sets `Access-Control-Allow-Origin` header
- [ ] Backend handles OPTIONS preflight requests
- [ ] Frontend CSP allows `https://*.loca.lt` in connect-src
- [ ] Frontend CSP allows `wss://*.loca.lt` for WebSockets
- [ ] Backend restarted after changes
- [ ] Frontend deployed to Vercel after changes
- [ ] Test fetch from browser console works
- [ ] No CORS errors in browser console
- [ ] Backend logs show allowed origins, not blocked

## Dynamic URL Flow

1. **User deploys backend** → Gets loca.lt URL (e.g., `https://bharanitest898.loca.lt`)
2. **Frontend stores URL** → `localStorage.setItem('backendUrl', url)`
3. **Frontend makes requests** → Uses stored URL with proper headers
4. **Backend receives request** → Checks origin against patterns
5. **Backend allows request** → Sets CORS headers and processes
6. **Frontend receives response** → No CORS errors

## Files Modified

1. `backend/resources/app/main.js` - CORS middleware
2. `vercel.json` - CSP configuration

## Notes

- loca.lt URLs are dynamic and change on each deployment
- CORS must allow pattern matching, not specific URLs
- Both backend AND frontend CSP must allow the connection
- Restart backend after CORS changes
- Redeploy frontend after CSP changes
