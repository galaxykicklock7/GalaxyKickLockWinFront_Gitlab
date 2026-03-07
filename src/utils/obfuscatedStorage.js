/**
 * Obfuscated Storage Manager
 * 
 * Hides localStorage keys and encrypts values to prevent
 * easy inspection of sensitive data in browser DevTools.
 */

import { securityManager } from './securityManager';

// Map of logical keys to obfuscated keys
const KEY_MAP = {
  // User session data
  'galaxyKickLockSession': '_s1',
  'userSession': '_s2',
  'adminSession': '_s3',
  
  // Configuration
  'galaxyKickLockConfig': '_c1',
  'deploymentStatus': '_c2',
  
  // Backend URLs
  'railwayBackendUrl': '_e1',
  'backendUrl': '_e2',
  'svc_endpoint': '_e3',
  
  // User data
  'userId': '_u1',
  'activeTabId': '_u2',
  
  // Feature flags
  'aiChatEnabled': '_f1',
  'aiCoreEnabled': '_f2',
  
  // Supabase
  'sb-': '_sb_' // Prefix for Supabase keys
};

class ObfuscatedStorage {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize by migrating existing keys
   */
  async initialize() {
    if (this.initialized) return;
    
    // Migrate existing keys to obfuscated versions
    await this.migrateExistingKeys();
    
    this.initialized = true;
  }

  /**
   * Migrate existing localStorage keys to obfuscated versions
   */
  async migrateExistingKeys() {
    const keysToMigrate = Object.keys(KEY_MAP);
    
    for (const logicalKey of keysToMigrate) {
      const existingValue = localStorage.getItem(logicalKey);
      
      if (existingValue) {
        // Migrate to obfuscated key with encryption
        await this.setItem(logicalKey, existingValue);
        
        // Remove old key
        localStorage.removeItem(logicalKey);
      }
    }
    
    // Handle Supabase keys (they start with 'sb-')
    const allKeys = Object.keys(localStorage);
    for (const key of allKeys) {
      if (key.startsWith('sb-')) {
        const value = localStorage.getItem(key);
        const obfuscatedKey = this.getObfuscatedKey(key);
        
        // Encrypt and store
        const encrypted = await securityManager.encrypt(value);
        localStorage.setItem(obfuscatedKey, encrypted);
        
        // Remove old key
        localStorage.removeItem(key);
      }
    }
  }

  /**
   * Get obfuscated key for a logical key
   */
  getObfuscatedKey(logicalKey) {
    // Check if it's a Supabase key
    if (logicalKey.startsWith('sb-')) {
      const suffix = logicalKey.substring(3);
      return `_sb_${this.hashString(suffix)}`;
    }
    
    // Check if we have a mapping
    if (KEY_MAP[logicalKey]) {
      return KEY_MAP[logicalKey];
    }
    
    // Generate a hash-based obfuscated key
    return `_${this.hashString(logicalKey)}`;
  }

  /**
   * Simple hash function for key obfuscation
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Set item with obfuscation and encryption
   */
  async setItem(logicalKey, value) {
    try {
      const obfuscatedKey = this.getObfuscatedKey(logicalKey);
      
      // Encrypt the value
      const encrypted = await securityManager.encrypt(
        typeof value === 'string' ? value : JSON.stringify(value)
      );
      
      // Store with obfuscated key
      localStorage.setItem(obfuscatedKey, encrypted);
      
      return true;
    } catch (error) {
      securityManager.safeLog('error', 'Failed to set obfuscated item', error);
      return false;
    }
  }

  /**
   * Get item with deobfuscation and decryption
   */
  async getItem(logicalKey) {
    try {
      const obfuscatedKey = this.getObfuscatedKey(logicalKey);
      const encrypted = localStorage.getItem(obfuscatedKey);
      
      if (!encrypted) {
        // Try the original key as fallback (for backward compatibility)
        const fallback = localStorage.getItem(logicalKey);
        if (fallback) {
          // Migrate it
          await this.setItem(logicalKey, fallback);
          localStorage.removeItem(logicalKey);
          return fallback;
        }
        return null;
      }
      
      // Decrypt the value
      const decrypted = await securityManager.decrypt(encrypted);
      
      // Try to parse as JSON, otherwise return as string
      try {
        return JSON.parse(decrypted);
      } catch {
        return decrypted;
      }
    } catch (error) {
      securityManager.safeLog('error', 'Failed to get obfuscated item', error);
      return null;
    }
  }

  /**
   * Remove item
   */
  removeItem(logicalKey) {
    try {
      const obfuscatedKey = this.getObfuscatedKey(logicalKey);
      localStorage.removeItem(obfuscatedKey);
      
      // Also remove original key if it exists
      localStorage.removeItem(logicalKey);
      
      return true;
    } catch (error) {
      securityManager.safeLog('error', 'Failed to remove obfuscated item', error);
      return false;
    }
  }

  /**
   * Clear all obfuscated items
   */
  clear() {
    try {
      const allKeys = Object.keys(localStorage);
      
      // Remove all obfuscated keys (start with _)
      for (const key of allKeys) {
        if (key.startsWith('_')) {
          localStorage.removeItem(key);
        }
      }
      
      return true;
    } catch (error) {
      securityManager.safeLog('error', 'Failed to clear obfuscated storage', error);
      return false;
    }
  }

  /**
   * Get all obfuscated keys (for debugging in dev mode)
   */
  getAllKeys() {
    if (!import.meta.env.DEV) {
      return [];
    }
    
    const allKeys = Object.keys(localStorage);
    return allKeys.filter(key => key.startsWith('_'));
  }
}

// Export singleton instance
export const obfuscatedStorage = new ObfuscatedStorage();
export default obfuscatedStorage;
