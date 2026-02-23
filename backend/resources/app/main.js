const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const { appState, addLog } = require("./src/config/appState");
const { initializeConnectionPool, getCurrentCode } = require("./src/network/connectionManager");
const { createWebSocketConnection } = require("./src/network/socketManager");
const fileLogger = require("./src/utils/fileLogger");

// Polyfill for Headers API (required for Supabase in older Node.js versions)
if (typeof global.Headers === 'undefined') {
  global.Headers = class Headers {
    constructor(init) {
      this.headers = {};
      if (init) {
        if (init instanceof Headers) {
          this.headers = { ...init.headers };
        } else if (typeof init === 'object') {
          Object.entries(init).forEach(([key, value]) => {
            this.headers[key.toLowerCase()] = String(value);
          });
        }
      }
    }
    append(name, value) {
      const key = name.toLowerCase();
      if (this.headers[key]) {
        this.headers[key] += ', ' + value;
      } else {
        this.headers[key] = String(value);
      }
    }
    delete(name) {
      delete this.headers[name.toLowerCase()];
    }
    get(name) {
      return this.headers[name.toLowerCase()] || null;
    }
    has(name) {
      return name.toLowerCase() in this.headers;
    }
    set(name, value) {
      this.headers[name.toLowerCase()] = String(value);
    }
    forEach(callback, thisArg) {
      Object.entries(this.headers).forEach(([key, value]) => {
        callback.call(thisArg, value, key, this);
      });
    }
    entries() {
      return Object.entries(this.headers)[Symbol.iterator]();
    }
    keys() {
      return Object.keys(this.headers)[Symbol.iterator]();
    }
    values() {
      return Object.values(this.headers)[Symbol.iterator]();
    }
    [Symbol.iterator]() {
      return this.entries();
    }
  };
}

// Polyfill for fetch API (required for Supabase in older Node.js versions)
if (!globalThis.fetch) {
  const nodeFetch = require('node-fetch');
  globalThis.fetch = nodeFetch;
  globalThis.Headers = nodeFetch.Headers;
  globalThis.Request = nodeFetch.Request;
  globalThis.Response = nodeFetch.Response;
}

const { createClient } = require('@supabase/supabase-js');

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

// Supabase connection for metrics
const supabase = createClient(
  'https://gpjmbaxvfnfggkbxlaey.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwam1iYXh2Zm5mZ2drYnhsYWV5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODEzMjQ1OCwiZXhwIjoyMDgzNzA4NDU4fQ.0edK_ThNBzag3vWeG5jhW2ldsozQKtZkBwUL11ckfCY'
);

console.log('[SUPABASE] Connected to Supabase for metrics tracking');

// Configuration
const API_PORT = process.env.API_PORT || 3000;

console.log(`Starting G.O.A.T Backend Server on port ${API_PORT}`);

// Express Server Setup
const apiServer = express();
apiServer.use(bodyParser.json());

// Fix #4: hoist outside middleware — one allocation at startup, not per-request
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://galaxykicklock2.vercel.app',
  'https://galaxykicklock2-galaxykicklocks-projects.vercel.app',
  'https://galaxykicklock2-galaxykicklock77-galaxykicklocks-projects.vercel.app',
  'https://galaxykicklock2g.vercel.app'
];

// CORS Configuration
apiServer.use((req, res, next) => {
  const allowedOrigins = ALLOWED_ORIGINS;
  
  const origin = req.headers.origin;
  let isAllowed = false;
  
  // Allow requests without origin (direct API calls, curl, Postman, etc.)
  if (!origin) {
    isAllowed = true;
  }
  // SECURITY: Only allow exact matches from whitelist
  else if (allowedOrigins.includes(origin)) {
    isAllowed = true;
  }
  // SECURITY: Allow ONLY the user's specific loca.lt subdomain (set via env var)
  else if (process.env.TUNNEL_SUBDOMAIN) {
    const allowedTunnelUrl = `https://${process.env.TUNNEL_SUBDOMAIN}.loca.lt`;
    if (origin === allowedTunnelUrl) {
      isAllowed = true;
    }
  }
  // SECURITY: Allow any loca.lt subdomain for flexibility
  else if (origin && origin.match(/^https:\/\/[\w-]+\.loca\.lt$/)) {
    isAllowed = true;
  }
  // SECURITY: Allow any Vercel deployment URL for flexibility
  else if (origin && origin.match(/^https:\/\/.*\.vercel\.app$/)) {
    isAllowed = true;
  }
  
  // Set CORS headers for allowed origins
  if (isAllowed) {
    // Always set CORS headers for allowed origins
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 
      'Content-Type, Authorization, X-API-Key, ' +
      'bypass-tunnel-reminder, cache-control, pragma, expires, ' +
      'x-requested-with, accept, origin, referer, user-agent, ' +
      'x-user-id'
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    next();
  } else {
    // SECURITY: Reject unknown origins
    console.log(`⚠️ CORS blocked: ${origin}`);
    console.log(`   Allowed: ${allowedOrigins.join(', ')}`);
    console.log(`   Vercel pattern test: ${origin && origin.match(/^https:\/\/.*\.vercel\.app$/) ? 'MATCHES' : 'NO MATCH'}`);
    console.log(`   Loca.lt pattern test: ${origin && origin.match(/^https:\/\/[\w-]+\.loca\.lt$/) ? 'MATCHES' : 'NO MATCH'}`);

    // Still set basic CORS headers for error responses
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    return res.status(403).json({ error: 'Access denied', receivedOrigin: origin });
  }
});

apiServer.use(express.static(path.join(__dirname, 'public')));
// Add support for serving the GUI in browser
apiServer.use(express.static(path.join(__dirname)));

// ==================== SECURITY HELPERS ====================

/**
 * Sanitize config object by redacting sensitive fields
 * @param {Object} config - Configuration object
 * @returns {Object} - Sanitized config with redacted sensitive fields
 */
function sanitizeConfig(config) {
  const safe = { ...config };
  
  // Redact recovery codes
  if (safe.rc1) safe.rc1 = '***REDACTED***';
  if (safe.rc2) safe.rc2 = '***REDACTED***';
  if (safe.rc3) safe.rc3 = '***REDACTED***';
  if (safe.rc4) safe.rc4 = '***REDACTED***';
  if (safe.rc5) safe.rc5 = '***REDACTED***';
  
  // Redact alternate codes
  if (safe.rcl1) safe.rcl1 = '***REDACTED***';
  if (safe.rcl2) safe.rcl2 = '***REDACTED***';
  if (safe.rcl3) safe.rcl3 = '***REDACTED***';
  if (safe.rcl4) safe.rcl4 = '***REDACTED***';
  if (safe.rcl5) safe.rcl5 = '***REDACTED***';
  
  // Redact kick recovery code
  if (safe.kickrc) safe.kickrc = '***REDACTED***';
  
  return safe;
}

/**
 * Remove sensitive fields from config object
 * @param {Object} config - Configuration object
 * @returns {Object} - Config without sensitive fields
 */
function filterSensitiveData(config) {
  const filtered = { ...config };
  
  // Remove all recovery codes
  delete filtered.rc1;
  delete filtered.rc2;
  delete filtered.rc3;
  delete filtered.rc4;
  delete filtered.rc5;
  delete filtered.rcl1;
  delete filtered.rcl2;
  delete filtered.rcl3;
  delete filtered.rcl4;
  delete filtered.rcl5;
  delete filtered.kickrc;
  
  return filtered;
}

// ==================== API ENDPOINTS ====================
apiServer.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

apiServer.get('/api/status', (req, res) => {
  // SECURITY: Filter sensitive data before sending
  const safeConfig = filterSensitiveData(appState.config);
  
  // Build prison status map for frontend
  const prisonStatus = {};
  Object.keys(appState.gameLogic).forEach(key => {
    const logic = appState.gameLogic[key];
    const wsNum = parseInt(key.replace('logic', ''));
    
    if (logic) {
      // Determine which recovery code this connection is using
      let codeKey = null;
      if (logic.config.rc1 && wsNum === 1) codeKey = 'rc1';
      else if (logic.config.rc2 && wsNum === 2) codeKey = 'rc2';
      else if (logic.config.rc3 && wsNum === 3) codeKey = 'rc3';
      else if (logic.config.rc4 && wsNum === 4) codeKey = 'rc4';
      else if (logic.config.rc5 && wsNum === 5) codeKey = 'rc5';
      else if (logic.config.rcl1 && wsNum === 1) codeKey = 'rcl1';
      else if (logic.config.rcl2 && wsNum === 2) codeKey = 'rcl2';
      else if (logic.config.rcl3 && wsNum === 3) codeKey = 'rcl3';
      else if (logic.config.rcl4 && wsNum === 4) codeKey = 'rcl4';
      else if (logic.config.rcl5 && wsNum === 5) codeKey = 'rcl5';
      
      if (codeKey) {
        const currentPlanet = logic.currentPlanet || 'Unknown';
        const isInPrison = logic.inPrison || (currentPlanet && currentPlanet.startsWith('Prison'));
        prisonStatus[codeKey] = isInPrison;
      }
    }
  });
  
  const minimalState = {
    connected: appState.connected,
    wsStatus: appState.wsStatus,
    config: safeConfig, // ✅ Filtered - no recovery codes
    gameState: appState.gameState,
    prisonStatus: prisonStatus // ✅ Added: { "rc1": true, "rc2": false, ... }
  };
  res.json(minimalState);
});

apiServer.get('/api/logs', (req, res) => {
  // SECURITY: Logs are safe (no sensitive data stored in logs)
  // addLog() function only stores user-facing messages, not recovery codes
  res.json(appState.logs);
});

apiServer.post('/api/configure', (req, res) => {
  try {
    const config = req.body;

    // SECURITY: Validate input exists
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid request' 
      });
    }

    // Fix #3: skip expensive JSON.stringify on every configure call; only log in debug mode
    if (process.env.DEBUG === 'true') {
      console.log('[API] /api/configure received:', JSON.stringify(sanitizeConfig(config), null, 2));
    }

    // Update sensitive config keys (recovery codes)
    if (config.rc1 !== undefined) appState.config.rc1 = config.rc1;
    if (config.rc2 !== undefined) appState.config.rc2 = config.rc2;
    if (config.rc3 !== undefined) appState.config.rc3 = config.rc3;
    if (config.rc4 !== undefined) appState.config.rc4 = config.rc4;
    if (config.rc5 !== undefined) appState.config.rc5 = config.rc5;

    // Update alts
    if (config.rcl1 !== undefined) appState.config.rcl1 = config.rcl1;
    if (config.rcl2 !== undefined) appState.config.rcl2 = config.rcl2;
    if (config.rcl3 !== undefined) appState.config.rcl3 = config.rcl3;
    if (config.rcl4 !== undefined) appState.config.rcl4 = config.rcl4;
    if (config.rcl5 !== undefined) appState.config.rcl5 = config.rcl5;

    // Update kick recovery code (special case - starts with 'rc' but is not a recovery code)
    if (config.kickrc !== undefined) appState.config.kickrc = config.kickrc;

    // Update all other settings (excluding rc1-5 and rcl1-5)
    Object.keys(config).forEach(key => {
      // Skip recovery codes (rc1-5, rcl1-5) and kickrc (already handled above)
      if (!key.match(/^rc[1-5]$/) && !key.match(/^rcl[1-5]$/) && key !== 'kickrc') {
        appState.config[key] = config[key];
      }
    });

    // Store userId for metrics tracking (if provided)
    if (config.userId) {
      appState.config.userId = config.userId;
      console.log('[API] User ID stored for metrics tracking');
    }

    // SECURITY: Log sanitized kick settings (no recovery codes)
    console.log('[API] Updated config - Kick settings:', {
      kickmode: appState.config.kickmode,
      imprisonmode: appState.config.imprisonmode,
      kickall: appState.config.kickall,
      kickbybl: appState.config.kickbybl,
      dadplus: appState.config.dadplus,
      kickrc: appState.config.kickrc ? '***REDACTED***' : '(empty)'
    });

    // Reset auto interval starting values when user changes timing from UI
    const timingKeys = ['attack1','attack2','attack3','attack4','attack5','waiting1','waiting2','waiting3','waiting4','waiting5'];
    const hasTimingChange = timingKeys.some(k => config[k] !== undefined);
    if (hasTimingChange || config.timershift !== undefined) {
      // Reset stored starting values so auto interval picks up new base
      Object.values(appState.gameLogic).forEach(logic => {
        if (logic && logic.autoIntervalStartValues) {
          logic.autoIntervalStartValues = {};
        }
      });
    }

    // Re-initialize pool
    initializeConnectionPool();

    res.json({ success: true, message: 'Configuration updated' });
  } catch (error) {
    // SECURITY: Don't expose internal error details
    console.error('[API] /api/configure error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Configuration failed' 
    });
  }
});

apiServer.post('/api/connect', (req, res) => {
  try {
    appState.connected = true;
    appState.config.connected = true;
    appState.config.exitting = false; // "Standing" mode

    const connected = connectAll();
    res.json({ success: true, count: connected });
  } catch (error) {
    // SECURITY: Don't expose internal error details
    console.error('[API] /api/connect error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Connection failed' 
    });
  }
});

apiServer.post('/api/disconnect', (req, res) => {
  try {
    appState.connected = false;
    appState.config.connected = false;

    disconnectAll();
    res.json({ success: true, message: 'Disconnected' });
  } catch (error) {
    // SECURITY: Don't expose internal error details
    console.error('[API] /api/disconnect error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Disconnect failed' 
    });
  }
});

apiServer.post('/api/send', (req, res) => {
  try {
    const { wsNumber, command } = req.body;
    
    // SECURITY: Validate input
    if (!wsNumber || !command) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid request' 
      });
    }

    const wsKey = `ws${wsNumber}`;
    const ws = appState.websockets[wsKey];
    
    if (!ws || ws.readyState !== ws.OPEN) {
      return res.status(400).json({ 
        success: false, 
        message: 'Connection not available' 
      });
    }

    ws.send(`${command}\r\n`);
    addLog(wsNumber, `📤 Sent: ${command}`);
    res.json({ success: true, message: 'Command sent' });
  } catch (error) {
    // SECURITY: Don't expose internal error details
    console.error('[API] /api/send error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Command failed' 
    });
  }
});

apiServer.post('/api/fly', (req, res) => {
  try {
    console.log('[API] /api/fly called');
    
    const { planet } = req.body;
    
    // SECURITY: Validate input
    if (!planet) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid request' 
      });
    }

    // Update config planet for all connections
    appState.config.planet = planet;
    
    let sent = 0;
    let errors = [];
    let reflown = 0;

    Object.keys(appState.websockets).forEach(key => {
      try {
        const ws = appState.websockets[key];
        const wsNum = parseInt(key.replace('ws', ''));
        
        if (!ws) {
          errors.push(`Connection ${wsNum} not initialized`);
          return;
        }
        
        if (ws.readyState !== ws.OPEN) {
          errors.push(`Connection ${wsNum} not ready`);
          return;
        }
        
        // Check if already on the same planet
        const logicKey = `logic${wsNum}`;
        const currentPlanet = appState.gameLogic[logicKey]?.currentPlanet;
        const isRefly = currentPlanet === planet;
        
        if (isRefly) {
          reflown++;
          addLog(wsNum, `🔄 Reflying to ${planet}`);
        } else {
          addLog(wsNum, `🚀 Flying to ${planet}`);
        }
        
        ws.send(`JOIN ${planet}\r\n`);
        sent++;
        
        // Update gameLogic planet tracking
        if (appState.gameLogic[logicKey]) {
          appState.gameLogic[logicKey].currentPlanet = planet;
          appState.gameLogic[logicKey].inPrison = planet.startsWith('Prison');
        }
      } catch (error) {
        // SECURITY: Don't expose internal error details
        console.error(`[API] Error processing ${key}:`, error.message);
        errors.push(`Connection ${key.replace('ws', '')} failed`);
      }
    });

    const response = {
      success: sent > 0,
      message: sent > 0 ? `Sent to ${sent} connection(s)` : 'No connections available',
      sent,
      total: Object.keys(appState.websockets).length
    };
    
    if (errors.length > 0 && errors.length < Object.keys(appState.websockets).length) {
      response.partial = true;
    }
    
    res.json(response);
  } catch (error) {
    // SECURITY: Don't expose internal error details
    console.error('[API] /api/fly error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Operation failed' 
    });
  }
});

apiServer.post('/api/release', (req, res) => {
  try {
    // Track detailed status for each connection
    const connectionStatus = {
      inPrison: [],
      notInPrison: [],
      released: [],
      failed: [],
      noCode: []
    };
    
    // SECURITY: Map connection number to recovery code (redacted for security)
    // Frontend needs to know which code is in prison
    const prisonStatus = {}; // { "rc1": true/false, "rc2": true/false, ... }

    const promises = [];

    Object.keys(appState.gameLogic).forEach(key => {
      const logic = appState.gameLogic[key];
      const wsNum = parseInt(key.replace('logic', ''));
      
      if (!logic) {
        return;
      }
      
      // Determine which recovery code this connection is using
      let codeKey = null;
      if (logic.config.rc1 && wsNum === 1) codeKey = 'rc1';
      else if (logic.config.rc2 && wsNum === 2) codeKey = 'rc2';
      else if (logic.config.rc3 && wsNum === 3) codeKey = 'rc3';
      else if (logic.config.rc4 && wsNum === 4) codeKey = 'rc4';
      else if (logic.config.rc5 && wsNum === 5) codeKey = 'rc5';
      else if (logic.config.rcl1 && wsNum === 1) codeKey = 'rcl1';
      else if (logic.config.rcl2 && wsNum === 2) codeKey = 'rcl2';
      else if (logic.config.rcl3 && wsNum === 3) codeKey = 'rcl3';
      else if (logic.config.rcl4 && wsNum === 4) codeKey = 'rcl4';
      else if (logic.config.rcl5 && wsNum === 5) codeKey = 'rcl5';
      
      // Check if any recovery codes are configured
      const hasRC = ['rc1', 'rc2', 'rc3', 'rc4', 'rc5', 'rcl1', 'rcl2', 'rcl3', 'rcl4', 'rcl5']
        .some(key => logic.config[key] && logic.config[key].trim() !== '');
      
      if (!hasRC) {
        connectionStatus.noCode.push(wsNum);
        if (codeKey) prisonStatus[codeKey] = null; // No code configured
        addLog(wsNum, `⚠️ No recovery codes - cannot escape`);
        return;
      }
      
      // Check if actually in prison
      const currentPlanet = logic.currentPlanet || 'Unknown';
      const isInPrison = logic.inPrison || (currentPlanet && currentPlanet.startsWith('Prison'));
      
      // Update prison status for this code
      if (codeKey) {
        prisonStatus[codeKey] = isInPrison;
      }
      
      // If currentPlanet is unknown (connection just established), attempt escape anyway
      // The escape will fail gracefully if not in prison
      if (!isInPrison && currentPlanet !== 'Unknown') {
        connectionStatus.notInPrison.push({ id: wsNum, planet: currentPlanet, code: codeKey });
        addLog(wsNum, `✅ Already on planet: ${currentPlanet}`);
        return;
      }
      
      // In prison OR unknown status - attempt escape
      if (currentPlanet === 'Unknown') {
        connectionStatus.inPrison.push({ id: wsNum, planet: 'Unknown (checking...)', code: codeKey });
        addLog(wsNum, `🔓 Attempting escape (location unknown)...`);
      } else {
        connectionStatus.inPrison.push({ id: wsNum, planet: currentPlanet, code: codeKey });
        addLog(wsNum, `🔓 Attempting prison escape from ${currentPlanet}...`);
      }
      
      const promise = logic.escapeWithCode(logic.config.rc1 || logic.config.rcl1, 'Manual')
        .then(success => {
          if (success) {
            connectionStatus.released.push(wsNum);
            addLog(wsNum, `✅ Successfully escaped from prison!`);
            logic.inPrison = false;
            
            // Update prison status after successful escape
            if (codeKey) {
              prisonStatus[codeKey] = false;
            }
            
            // Rejoin target planet
            const ws = appState.websockets[`ws${wsNum}`];
            const targetPlanet = logic.config.planet;
            if (targetPlanet && ws && ws.readyState === ws.OPEN) {
              setTimeout(() => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(`JOIN ${targetPlanet}\r\n`);
                  addLog(wsNum, `🔄 Rejoining ${targetPlanet}`);
                }
              }, 3000);
            }
            return { wsNum, success: true };
          } else {
            connectionStatus.failed.push(wsNum);
            addLog(wsNum, `❌ Escape failed`);
            return { wsNum, success: false };
          }
        })
        .catch(error => {
          console.error(`[API] Escape error for WS${wsNum}:`, error.message);
          connectionStatus.failed.push(wsNum);
          addLog(wsNum, `❌ Escape error`);
          return { wsNum, success: false };
        });
      
      promises.push(promise);
    });

    // Wait for all escape attempts to complete
    Promise.all(promises).then(results => {
      console.log(`[API] Release complete:`, {
        inPrison: connectionStatus.inPrison.length,
        released: connectionStatus.released.length,
        failed: connectionStatus.failed.length,
        notInPrison: connectionStatus.notInPrison.length,
        noCode: connectionStatus.noCode.length
      });
    });

    // Build smart response message
    let message = '';
    const parts = [];
    
    if (connectionStatus.inPrison.length > 0) {
      parts.push(`${connectionStatus.inPrison.length} in prison`);
    }
    if (connectionStatus.notInPrison.length > 0) {
      parts.push(`${connectionStatus.notInPrison.length} already free`);
    }
    if (connectionStatus.noCode.length > 0) {
      parts.push(`${connectionStatus.noCode.length} missing codes`);
    }
    
    if (parts.length > 0) {
      message = parts.join(', ');
    } else {
      message = 'No connections available';
    }

    const response = {
      success: connectionStatus.inPrison.length > 0,
      message: message,
      details: {
        inPrison: connectionStatus.inPrison.length,
        notInPrison: connectionStatus.notInPrison.length,
        noCode: connectionStatus.noCode.length,
        total: Object.keys(appState.gameLogic).length
      },
      prisonStatus: prisonStatus // ✅ Added: { "rc1": true, "rc2": false, ... }
    };
    
    res.json(response);
  } catch (error) {
    console.error('[API] /api/release error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Operation failed' 
    });
  }
});

// ==================== METRICS API ENDPOINTS ====================

// POST /api/metrics/imprison - Record imprisonment event (success or 3s error)
apiServer.post('/api/metrics/imprison', async (req, res) => {
  try {
    const { 
      userId,           // UUID from Supabase auth
      connectionNumber, // 1-5
      timestampMs,      // Time in milliseconds since ACTION 3 sent
      playerName,       // Name of imprisoned player
      codeUsed,         // 'primary' or 'alt'
      isClanMember,     // true/false
      isSuccess,        // true for success, false for 3s error
      timingValue,      // Actual timing value used (ms)
      timingType,       // 'attack' or 'defense'
      pingMs,           // Ping in milliseconds (optional)
      context,          // Server context: 'FAST', 'NORMAL', 'SLOW' (optional)
      adjustmentReason, // What caused this timing: '3S_ERROR', 'SUCCESS', 'FAILURE', 'STUCK_ESCAPE', 'INIT', 'DB_INIT' (optional)
      isDefense = false // NEW: Defense flag (default false for backward compatibility)
    } = req.body;

    // Validation
    if (!userId || !connectionNumber || timestampMs === undefined || !playerName || !codeUsed) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    const resultType = isSuccess !== false ? 'SUCCESS' : '3S ERROR';
    const defenseInfo = isDefense ? ' [DEFENSE]' : '';
    const reasonInfo = adjustmentReason ? `, reason=${adjustmentReason}` : '';
    console.log(`[METRICS] Recording ${resultType}${defenseInfo}: user=${userId}, conn=${connectionNumber}, player=${playerName}, code=${codeUsed}, clan=${isClanMember}, time=${timestampMs}ms, timing=${timingValue}ms ${timingType}, ping=${pingMs}ms, context=${context}${reasonInfo}`);

    // Call Supabase function (match EXACT function signature with all parameters)
    const { data, error } = await supabase.rpc('record_imprisonment_metric', {
      p_user_id: userId,
      p_connection_number: connectionNumber,
      p_timestamp_ms: timestampMs,
      p_player_name: playerName,
      p_code_used: codeUsed,
      p_is_clan_member: isClanMember || false,
      p_is_success: isSuccess !== false,  // Default to true if not specified
      p_username: null,                   // ✅ Added missing parameter
      p_timing_value: timingValue || null,  // Pass timing value
      p_timing_type: timingType || null,    // Pass timing type
      p_ping_ms: pingMs || null,            // Pass ping
      p_context: context || null,           // Pass context
      p_adjustment_reason: adjustmentReason || null,  // Pass adjustment reason
      p_is_defense: isDefense || false      // Pass defense flag
    });

    if (error) {
      console.error('[METRICS] Supabase error recording metric:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to record metric' 
      });
    }

    console.log(`[METRICS] Successfully recorded ${resultType}${defenseInfo} for ${playerName}${reasonInfo}`);
    
    res.json(data);

  } catch (error) {
    console.error('[METRICS] Error recording imprisonment metric:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to record metric' 
    });
  }
});

// POST /api/metrics/defense - Record defense metric (when rival kicks you)
apiServer.post('/api/metrics/defense', async (req, res) => {
  try {
    const {
      userId,
      connectionNumber,
      timestampMs,
      rivalName,
      rivalTiming,        // How fast rival kicked you
      yourTiming,         // Your timing at that moment
      yourPingMs,
      yourContext
    } = req.body;
    
    // Validation
    if (!userId || !connectionNumber || timestampMs === undefined || !rivalName || !rivalTiming) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    console.log(`[DEFENSE] Recording rival kick: user=${userId}, conn=${connectionNumber}, rival=${rivalName}, rivalTiming=${rivalTiming}ms, yourTiming=${yourTiming}ms, ping=${yourPingMs}ms, context=${yourContext}`);
    
    // Call Supabase function
    const { data, error } = await supabase.rpc('record_defense_metric', {
      p_user_id: userId,
      p_connection_number: connectionNumber,
      p_timestamp_ms: timestampMs,
      p_rival_name: rivalName,
      p_rival_timing: rivalTiming,
      p_your_timing: yourTiming || null,
      p_ping_ms: yourPingMs || null,
      p_context: yourContext || null
    });
    
    if (error) {
      console.error('[DEFENSE] Supabase error recording defense metric:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to record defense metric'
      });
    }
    
    console.log(`[DEFENSE] Successfully recorded: ${rivalName} kicked you at ~${rivalTiming}ms`);
    
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('[DEFENSE] Error recording defense metric:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record defense metric'
    });
  }
});

// GET /api/metrics/defense/:userId - Get defense statistics
apiServer.get('/api/metrics/defense/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { context, limit } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID required'
      });
    }
    
    console.log(`[DEFENSE] Fetching defense stats: user=${userId}, context=${context || 'ALL'}, limit=${limit || 100}`);
    
    // Call Supabase function
    const { data, error } = await supabase.rpc('get_defense_stats', {
      p_user_id: userId,
      p_context: context || null,
      p_limit: parseInt(limit) || 100
    });
    
    if (error) {
      console.error('[DEFENSE] Supabase error fetching defense stats:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch defense stats'
      });
    }
    
    console.log(`[DEFENSE] Defense stats:`, data);
    
    res.json({ success: true, data: data[0] || null });
    
  } catch (error) {
    console.error('[DEFENSE] Error fetching defense stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch defense stats'
    });
  }
});

// GET /api/metrics/:connectionNumber - Get metrics for a connection
apiServer.get('/api/metrics/:connectionNumber', async (req, res) => {
  try {
    const { connectionNumber } = req.params;
    
    // Get userId from header (sent by frontend)
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized - User ID required' 
      });
    }

    // Validate connection number
    const connNum = parseInt(connectionNumber);
    if (isNaN(connNum) || connNum < 1 || connNum > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid connection number' 
      });
    }

    console.log(`[METRICS] Fetching metrics: user=${userId}, conn=${connNum}`);

    // Call Supabase function
    const { data, error } = await supabase.rpc('get_imprisonment_metrics', {
      p_user_id: userId,
      p_connection_number: connNum
    });

    if (error) {
      console.error('[METRICS] Supabase error fetching metrics:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch metrics' 
      });
    }

    console.log(`[METRICS] Supabase response:`, JSON.stringify(data));
    console.log(`[METRICS] Found ${data?.data?.length || 0} metrics for conn ${connNum}`);
    
    // Return the data directly (it's already in the correct format from the SQL function)
    res.json(data);

  } catch (error) {
    console.error('[METRICS] Error fetching imprisonment metrics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch metrics' 
    });
  }
});

// GET /api/timer-status/:wsNumber - Get timer status for auto interval indicator
apiServer.get('/api/timer-status/:wsNumber', (req, res) => {
  try {
    const wsNumber = parseInt(req.params.wsNumber);
    
    if (isNaN(wsNumber) || wsNumber < 1 || wsNumber > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wsNumber' 
      });
    }
    
    const logic = appState.gameLogic[`logic${wsNumber}`];
    
    if (logic && logic.timerStatus) {
      res.json({
        success: true,
        state: logic.timerStatus.state,
        lastUpdate: logic.timerStatus.lastUpdate
      });
    } else {
      res.json({ 
        success: true,
        state: 'unknown',
        lastUpdate: Date.now()
      });
    }
  } catch (error) {
    console.error('[API] Error getting timer status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get timer status' 
    });
  }
});

// GET /api/check-stuck-at-max/:wsNumber - Check if stuck at max timing from database
apiServer.get('/api/check-stuck-at-max/:wsNumber', async (req, res) => {
  try {
    const wsNumber = parseInt(req.params.wsNumber);
    
    if (isNaN(wsNumber) || wsNumber < 1 || wsNumber > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wsNumber' 
      });
    }
    
    // Get userId from header
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized - User ID required' 
      });
    }
    
    // Get current config to get max values
    const logic = appState.gameLogic[`logic${wsNumber}`];
    if (!logic || !logic.config) {
      return res.json({ 
        success: true,
        stuckAtMax: false,
        reason: 'No active connection'
      });
    }
    
    const maxAttack = parseInt(logic.config.maxatk || 3000);
    const maxDefense = parseInt(logic.config.maxdef || 3000);
    
    // Call Supabase function to check database
    const { data, error } = await supabase.rpc('check_stuck_at_max', {
      p_user_id: userId,
      p_connection_number: wsNumber,
      p_max_attack: maxAttack,
      p_max_defense: maxDefense
    });
    
    if (error) {
      console.error('[API] Supabase error checking stuck at max:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to check stuck status' 
      });
    }
    
    res.json(data);
    
  } catch (error) {
    console.error('[API] Error checking stuck at max:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check stuck status' 
    });
  }
});

// ==================== AI CORE API ENDPOINTS ====================

// POST /api/ai/enable/:wsNumber - Enable AI for connection
apiServer.post('/api/ai/enable/:wsNumber', async (req, res) => {
  try {
    // Explicit CORS headers for loca.lt compatibility
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const wsNumber = parseInt(req.params.wsNumber);
    
    if (isNaN(wsNumber) || wsNumber < 1 || wsNumber > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wsNumber' 
      });
    }
    
    const logic = appState.gameLogic[`logic${wsNumber}`];
    const ws = appState.websockets[`ws${wsNumber}`];
    
    if (!logic) {
      return res.status(400).json({ 
        success: false, 
        error: 'Connection not initialized' 
      });
    }
    
    if (!ws || ws.readyState !== ws.OPEN) {
      return res.status(400).json({ 
        success: false, 
        error: 'Connection not active' 
      });
    }
    
    // Check if already enabled
    if (logic.aiEnabled) {
      return res.json({ 
        success: true, 
        message: 'AI already enabled',
        stats: logic.aiCore ? logic.aiCore.getStats() : null
      });
    }
    
    // Initialize AI
    const supabaseUrl = 'https://gpjmbaxvfnfggkbxlaey.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwam1iYXh2Zm5mZ2drYnhsYWV5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODEzMjQ1OCwiZXhwIjoyMDgzNzA4NDU4fQ.0edK_ThNBzag3vWeG5jhW2ldsozQKtZkBwUL11ckfCY';
    
    console.log(`[API] Enabling AI for WS${wsNumber}...`);
    const initialized = await logic.initializeAI(supabaseUrl, supabaseKey);
    
    if (initialized) {
      console.log(`[API] ✅ AI enabled for WS${wsNumber}: aiEnabled=${logic.aiEnabled}, aiInitialized=${logic.aiInitialized}`);
      addLog(wsNumber, `🧠 AI Core enabled`);
      res.json({ 
        success: true, 
        message: 'AI enabled successfully',
        stats: logic.aiCore.getStats()
      });
    } else {
      console.log(`[API] ❌ AI initialization failed for WS${wsNumber}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to initialize AI' 
      });
    }
    
  } catch (error) {
    console.error('[API] Error enabling AI:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to enable AI' 
    });
  }
});

// POST /api/ai/disable/:wsNumber - Disable AI for connection
apiServer.post('/api/ai/disable/:wsNumber', (req, res) => {
  try {
    // Explicit CORS headers for loca.lt compatibility
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const wsNumber = parseInt(req.params.wsNumber);
    
    if (isNaN(wsNumber) || wsNumber < 1 || wsNumber > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wsNumber' 
      });
    }
    
    const logic = appState.gameLogic[`logic${wsNumber}`];
    
    if (!logic) {
      return res.status(400).json({ 
        success: false, 
        error: 'Connection not initialized' 
      });
    }
    
    // Disable AI
    logic.aiEnabled = false;
    
    console.log(`[WS${wsNumber}] AI disabled`);
    
    res.json({ 
      success: true, 
      message: 'AI disabled successfully'
    });
    
  } catch (error) {
    console.error('[API] Error disabling AI:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to disable AI' 
    });
  }
});

// POST /api/ai/chat/enable/:wsNumber - Enable AI Chat for connection
apiServer.post('/api/ai/chat/enable/:wsNumber', (req, res) => {
  try {
    // Explicit CORS headers for loca.lt compatibility
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const wsNumber = parseInt(req.params.wsNumber);
    
    if (isNaN(wsNumber) || wsNumber < 1 || wsNumber > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wsNumber' 
      });
    }
    
    const logic = appState.gameLogic[`logic${wsNumber}`];
    
    if (!logic) {
      return res.status(400).json({ 
        success: false, 
        error: 'Connection not initialized' 
      });
    }
    
    // Enable AI Chat
    logic.aiChatEnabled = true;
    
    console.log(`[WS${wsNumber}] AI Chat enabled`);
    
    res.json({ 
      success: true, 
      message: 'AI Chat enabled successfully',
      aiChatEnabled: true
    });
    
  } catch (error) {
    console.error('[API] Error enabling AI Chat:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to enable AI Chat' 
    });
  }
});

// POST /api/ai/chat/disable/:wsNumber - Disable AI Chat for connection
apiServer.post('/api/ai/chat/disable/:wsNumber', (req, res) => {
  try {
    // Explicit CORS headers for loca.lt compatibility
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const wsNumber = parseInt(req.params.wsNumber);
    
    if (isNaN(wsNumber) || wsNumber < 1 || wsNumber > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wsNumber' 
      });
    }
    
    const logic = appState.gameLogic[`logic${wsNumber}`];
    
    if (!logic) {
      return res.status(400).json({ 
        success: false, 
        error: 'Connection not initialized' 
      });
    }
    
    // Disable AI Chat
    logic.aiChatEnabled = false;
    
    console.log(`[WS${wsNumber}] AI Chat disabled`);
    
    res.json({ 
      success: true, 
      message: 'AI Chat disabled successfully',
      aiChatEnabled: false
    });
    
  } catch (error) {
    console.error('[API] Error disabling AI Chat:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to disable AI Chat' 
    });
  }
});

// GET /api/ai/stats/:wsNumber - Get AI statistics
apiServer.get('/api/ai/stats/:wsNumber', (req, res) => {
  try {
    // Explicit CORS headers for loca.lt compatibility
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const wsNumber = parseInt(req.params.wsNumber);
    
    if (isNaN(wsNumber) || wsNumber < 1 || wsNumber > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wsNumber' 
      });
    }
    
    const logic = appState.gameLogic[`logic${wsNumber}`];
    
    if (!logic) {
      return res.status(400).json({ 
        success: false, 
        error: 'Connection not initialized' 
      });
    }
    
    if (!logic.aiEnabled || !logic.aiCore) {
      return res.json({ 
        success: true, 
        enabled: false,
        message: 'AI not enabled'
      });
    }
    
    const stats = logic.aiCore.getStats();
    
    res.json({ 
      success: true, 
      enabled: true,
      stats: stats
    });
    
  } catch (error) {
    console.error('[API] Error getting AI stats:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get AI stats' 
    });
  }
});

// GET /api/ai/context/:wsNumber - Get current context
apiServer.get('/api/ai/context/:wsNumber', (req, res) => {
  try {
    // Explicit CORS headers for loca.lt compatibility
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const wsNumber = parseInt(req.params.wsNumber);
    
    if (isNaN(wsNumber) || wsNumber < 1 || wsNumber > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wsNumber' 
      });
    }
    
    const logic = appState.gameLogic[`logic${wsNumber}`];
    
    if (!logic) {
      return res.status(400).json({ 
        success: false, 
        error: 'Connection not initialized' 
      });
    }
    
    if (!logic.aiEnabled || !logic.aiCore) {
      return res.json({ 
        success: true, 
        enabled: false,
        message: 'AI not enabled'
      });
    }
    
    res.json({ 
      success: true, 
      enabled: true,
      context: logic.aiCore.currentContext,
      ping: logic.aiCore.currentPing,
      timing: logic.aiCore.currentTiming
    });
    
  } catch (error) {
    console.error('[API] Error getting AI context:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get AI context' 
    });
  }
});

// ==================== GLOBAL ERROR HANDLERS ====================

// SECURITY: Catch all unhandled errors and return generic message
apiServer.use((err, req, res, next) => {
  // Log error internally (with details)
  console.error('[API] Unhandled error:', err.message);
  console.error('[API] Stack:', err.stack);
  
  // SECURITY: Return generic error to client (no details)
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// SECURITY: Handle 404 for unknown routes
apiServer.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Not found'
  });
});

// Helper: Connect All
function connectAll() {
  let connected = 0;
  initializeConnectionPool(); // Refresh pool from config

  if (appState.config.rc1 || appState.config.rcl1) { createWebSocketConnection(1); connected++; }
  if (appState.config.rc2 || appState.config.rcl2) { createWebSocketConnection(2); connected++; }
  if (appState.config.rc3 || appState.config.rcl3) { createWebSocketConnection(3); connected++; }
  if (appState.config.rc4 || appState.config.rcl4) { createWebSocketConnection(4); connected++; }
  if (appState.config.rc5 || appState.config.rcl5) { createWebSocketConnection(5); connected++; } // Code 5 support

  return connected;
}

// Helper: Disconnect All
function disconnectAll() {
  Object.keys(appState.websockets).forEach(key => {
    try {
      const ws = appState.websockets[key];
      if (ws) {
        if (ws.readyState === ws.OPEN) {
          ws.send("QUIT :ds\r\n");
          ws.close(1000, "User disconnect");
        } else {
          try { ws.terminate(); } catch (e) { }
        }
      }
      appState.websockets[key] = null;
      appState.wsStatus[key] = false;

      // Cleanup GameLogic
      const logicKey = key.replace('ws', 'logic');
      if (appState.gameLogic[logicKey]) {
        if (typeof appState.gameLogic[logicKey].destroy === 'function') {
          appState.gameLogic[logicKey].destroy();
        }
        appState.gameLogic[logicKey] = null;
      }
    } catch (error) {
      console.error(`Error disconnecting ${key}:`, error);
    }
  });
}

// Start API Server
apiServer.listen(API_PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 G.O.A.T Backend Server Started`);
  console.log(`========================================`);
  console.log(`📡 API Server: http://localhost:${API_PORT}`);
  console.log(`📊 Health Check: http://localhost:${API_PORT}/api/health`);
  console.log(`========================================\n`);
});

// Graceful shutdown — Fix #6: flush + stop fileLogger timer before exit
function gracefulShutdown() {
  console.log('\n🛑 Shutting down gracefully...');
  try { fileLogger.destroy(); } catch (e) { /* ignore if not imported */ }
  disconnectAll();
  process.exit(0);
}

process.on('SIGINT',  gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Keep process alive
setInterval(() => {}, 1000);
