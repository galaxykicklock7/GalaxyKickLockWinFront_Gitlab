/**
 * Storage Manager
 * 
 * Unified storage with encryption and key obfuscation.
 * Uses the same clean AES-GCM pattern as payloadCrypto.
 */

// Map of logical keys to obfuscated keys
const KEY_MAP = {
  'galaxyKickLockSession': '_s1',
  'railwayBackendUrl': '_e2',
  'backendUrl': '_e2',
  'adminSession': '_s2',
  'galaxyKickLockConfig': '_c1',
  'deploymentStatus': '_d1',
  'pipelineId': '_p1',
  'localTestMode': '_t1',
  'activeTabId': '_a1',
  'aiCoreEnabled': '_ai1',
  'gitlabToken': '_g1',
  'gitlabProjectId': '_g2',
  'gitlabBranch': '_g3',
  'aiChatEnabled': '_ai2',
  'svc_endpoint': '_e3',
  'userId': '_u1',
  'rememberedUsername': '_r1',
  'userSession': '_s2'
};

// Reverse mapping
const REVERSE_KEY_MAP = {};
for (const [key, value] of Object.entries(KEY_MAP)) {
  REVERSE_KEY_MAP[value] = key;
}

// Storage state
let cache = new Map();
let initialized = false;
let encryptionKey = null;

/**
 * Get or create encryption key (similar to payloadCrypto pattern)
 */
async function getKey() {
  if (encryptionKey) return encryptionKey;

  const encoder = new TextEncoder();
  
  // Use a stable salt based on browser fingerprint
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    new Date().getTimezoneOffset(),
    screen.colorDepth,
    screen.width + 'x' + screen.height
  ].join('|');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(fingerprint),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('gkl-storage-v1'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return encryptionKey;
}

/**
 * Encrypt value using AES-GCM (same pattern as payloadCrypto)
 */
async function encryptValue(value) {
  const key = await getKey();
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(value);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return '_enc_' + btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt value using AES-GCM (same pattern as payloadCrypto)
 */
async function decryptValue(encryptedValue) {
  if (!encryptedValue || !encryptedValue.startsWith('_enc_')) {
    return encryptedValue;
  }

  try {
    const key = await getKey();
    const base64 = encryptedValue.substring(5);
    const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  } catch (err) {
    // Don't log error here - let caller handle it
    // This is expected when migrating from old encryption
    throw new Error('Decryption failed - likely encrypted with different key');
  }
}

/**
 * Get obfuscated key for storage
 */
function getObfuscatedKey(key) {
  return KEY_MAP[key] || `_${key}`;
}

/**
 * Initialize storage manager
 * - Loads encryption key
 * - Loads cached values from localStorage
 * - Migrates old unencrypted keys
 */
async function initialize() {
  if (initialized) return;

  try {
    // Check if localStorage is available
    if (typeof localStorage === 'undefined') {
      console.error('localStorage is not available');
      initialized = true;
      return;
    }

    // Test localStorage access
    try {
      localStorage.setItem('_test', 'test');
      localStorage.removeItem('_test');
    } catch (err) {
      console.error('localStorage is blocked or unavailable:', err);
      initialized = true;
      return;
    }

    // Initialize encryption key
    await getKey();

    // Load existing encrypted values into cache
    for (let i = 0; i < localStorage.length; i++) {
      const obfuscatedKey = localStorage.key(i);
      if (!obfuscatedKey || !obfuscatedKey.startsWith('_')) continue;

      const encryptedValue = localStorage.getItem(obfuscatedKey);
      if (!encryptedValue) continue;

      try {
        if (encryptedValue.startsWith('_enc_')) {
          // Try to decrypt with new key
          try {
            const decryptedValue = await decryptValue(encryptedValue);
            const realKey = REVERSE_KEY_MAP[obfuscatedKey] || obfuscatedKey;
            cache.set(realKey, decryptedValue);
          } catch (decryptErr) {
            // Decryption failed - likely encrypted with old key
            // Remove it so it can be re-created fresh
            if (import.meta.env.DEV) {
              console.log('Removing entry encrypted with old key:', obfuscatedKey);
            }
            localStorage.removeItem(obfuscatedKey);
          }
        } else {
          // Old unencrypted obfuscated value - migrate it
          const realKey = REVERSE_KEY_MAP[obfuscatedKey] || obfuscatedKey;
          cache.set(realKey, encryptedValue);
          // Re-encrypt it with new key
          const encrypted = await encryptValue(encryptedValue);
          localStorage.setItem(obfuscatedKey, encrypted);
        }
      } catch (err) {
        // Remove corrupted entries
        if (import.meta.env.DEV) {
          console.warn('Removing corrupted storage entry:', obfuscatedKey, err);
        }
        localStorage.removeItem(obfuscatedKey);
      }
    }

    // Migrate old plain-text keys to encrypted obfuscated keys
    const keysToMigrate = Object.keys(KEY_MAP);
    for (const logicalKey of keysToMigrate) {
      const plainValue = localStorage.getItem(logicalKey);
      if (plainValue !== null) {
        // Old unencrypted entry found - migrate it
        if (!cache.has(logicalKey)) {
          cache.set(logicalKey, plainValue);
        }
        try {
          const obfuscatedKey = KEY_MAP[logicalKey];
          const encrypted = await encryptValue(plainValue);
          localStorage.setItem(obfuscatedKey, encrypted);
        } catch (err) {
          console.warn('Failed to migrate key:', logicalKey);
        }
        // Remove old plain key
        localStorage.removeItem(logicalKey);
      }
    }

    initialized = true;
    
    // Log summary
    const migratedCount = keysToMigrate.filter(k => localStorage.getItem(k) === null).length;
    
    // Check if this is first run after encryption update
    const isFirstRunAfterUpdate = migratedCount > 0 || 
      Object.keys(localStorage).some(k => k.startsWith('_') && localStorage.getItem(k)?.startsWith('_enc_'));
    
    if (migratedCount > 0) {
      console.log(`✓ Storage initialized: migrated ${migratedCount} keys to encrypted storage`);
      
      // Show one-time info message about migration
      if (!sessionStorage.getItem('_migration_info_shown')) {
        sessionStorage.setItem('_migration_info_shown', 'true');
        console.info(
          '%c🔐 Storage Security Update',
          'color: #00f3ff; font-size: 14px; font-weight: bold;',
          '\nYour data has been upgraded to AES-256 encryption. Old encrypted data was cleaned up. You may need to re-enter some settings.'
        );
      }
    } else {
      console.log('✓ Storage manager initialized with encryption');
    }
  } catch (err) {
    console.error('Storage initialization error:', err);
    initialized = true; // Mark as initialized anyway to prevent blocking
  }
}

/**
 * Get item from storage (synchronous from cache)
 * Works even before initialization by falling back to localStorage
 */
function getItem(key) {
  // If initialized, use cache
  if (initialized && cache.has(key)) {
    return cache.get(key);
  }

  // Fallback: try to load from localStorage directly
  // This handles the case where getItem is called before initialize() completes
  try {
    const obfuscatedKey = getObfuscatedKey(key);
    const value = localStorage.getItem(obfuscatedKey);
    
    if (value) {
      // If it's not encrypted, return as-is
      if (!value.startsWith('_enc_')) {
        if (initialized) {
          cache.set(key, value);
        }
        return value;
      }
      // If encrypted, we can't decrypt synchronously, return null
      // The value will be available after initialization completes
      return null;
    }
    
    // Also try the plain key for backward compatibility
    const plainValue = localStorage.getItem(key);
    if (plainValue && !plainValue.startsWith('_enc_')) {
      if (initialized) {
        cache.set(key, plainValue);
      }
      return plainValue;
    }
  } catch (err) {
    console.error(`Failed to get item ${key}:`, err);
  }

  return null;
}

/**
 * Set item in storage (synchronous cache + async encryption)
 * Works even before initialization by storing directly to localStorage
 */
function setItem(key, value) {
  try {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    
    // Update cache if initialized
    if (initialized) {
      cache.set(key, stringValue);
      // Encrypt and save asynchronously
      encryptAndSave(key, stringValue);
    } else {
      // Not initialized yet - store directly to localStorage without encryption
      // This will be migrated to encrypted storage when initialize() runs
      const obfuscatedKey = getObfuscatedKey(key);
      localStorage.setItem(obfuscatedKey, stringValue);
    }
    
    return true;
  } catch (err) {
    console.error(`Failed to set item ${key}:`, err);
    return false;
  }
}

/**
 * Encrypt and save to localStorage (async)
 */
async function encryptAndSave(key, value) {
  try {
    const encrypted = await encryptValue(value);
    const obfuscatedKey = getObfuscatedKey(key);
    localStorage.setItem(obfuscatedKey, encrypted);
  } catch (err) {
    console.error(`Failed to encrypt ${key}:`, err);
  }
}

/**
 * Remove item from storage
 */
function removeItem(key) {
  try {
    cache.delete(key);
    const obfuscatedKey = getObfuscatedKey(key);
    localStorage.removeItem(obfuscatedKey);
    // Also remove old plain key if it exists
    localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.error(`Failed to remove item ${key}:`, err);
    return false;
  }
}

/**
 * Clear all storage
 */
function clear() {
  cache.clear();
  localStorage.clear();
  initialized = false;
  encryptionKey = null;
}

/**
 * Get diagnostics info
 */
function getDiagnostics() {
  return {
    initialized,
    cacheSize: cache.size,
    localStorageSize: localStorage.length,
    hasEncryptionKey: !!encryptionKey,
    encryptedKeys: Object.keys(localStorage).filter(k => {
      const val = localStorage.getItem(k);
      return val && val.startsWith('_enc_');
    }).length
  };
}

/**
 * Get all keys (for debugging)
 */
function getAllKeys() {
  return Array.from(cache.keys());
}

export const storageManager = {
  initialize,
  getItem,
  setItem,
  removeItem,
  clear,
  getDiagnostics,
  getAllKeys
};