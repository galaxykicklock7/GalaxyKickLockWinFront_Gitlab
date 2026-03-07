/**
 * Secure IndexedDB Storage
 * 
 * Uses IndexedDB instead of localStorage for sensitive data.
 * IndexedDB is harder to inspect and provides better security.
 */

import { securityManager } from './securityManager';

class SecureIndexedDB {
  constructor() {
    this.dbName = '_app_secure_store';
    this.storeName = '_data';
    this.version = 1;
    this.db = null;
    this.initPromise = this.init();
  }

  /**
   * Initialize IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        securityManager.safeLog('error', 'IndexedDB initialization failed');
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        securityManager.safeLog('log', 'IndexedDB initialized');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'key' });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          objectStore.createIndex('expiry', 'expiry', { unique: false });
        }
      };
    });
  }

  /**
   * Set item with encryption
   */
  async setItem(key, value, expiryMs = null) {
    await this.initPromise;

    try {
      // Encrypt the value
      const encrypted = await securityManager.encrypt(JSON.stringify(value));
      
      const item = {
        key: this.obfuscateKey(key),
        value: encrypted,
        timestamp: Date.now(),
        expiry: expiryMs ? Date.now() + expiryMs : null
      };

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.put(item);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      securityManager.safeLog('error', 'Failed to set item in IndexedDB', error);
      return false;
    }
  }

  /**
   * Get item with decryption
   */
  async getItem(key) {
    await this.initPromise;

    try {
      const obfuscatedKey = this.obfuscateKey(key);

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.get(obfuscatedKey);

        request.onsuccess = async () => {
          const item = request.result;
          
          if (!item) {
            resolve(null);
            return;
          }

          // Check expiry
          if (item.expiry && Date.now() > item.expiry) {
            await this.removeItem(key);
            resolve(null);
            return;
          }

          // Decrypt value
          try {
            const decrypted = await securityManager.decrypt(item.value);
            const value = JSON.parse(decrypted);
            resolve(value);
          } catch (error) {
            securityManager.safeLog('error', 'Failed to decrypt item', error);
            resolve(null);
          }
        };

        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      securityManager.safeLog('error', 'Failed to get item from IndexedDB', error);
      return null;
    }
  }

  /**
   * Remove item
   */
  async removeItem(key) {
    await this.initPromise;

    try {
      const obfuscatedKey = this.obfuscateKey(key);

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.delete(obfuscatedKey);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      securityManager.safeLog('error', 'Failed to remove item from IndexedDB', error);
      return false;
    }
  }

  /**
   * Clear all items
   */
  async clear() {
    await this.initPromise;

    try {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.clear();

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      securityManager.safeLog('error', 'Failed to clear IndexedDB', error);
      return false;
    }
  }

  /**
   * Get all keys
   */
  async getAllKeys() {
    await this.initPromise;

    try {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.getAllKeys();

        request.onsuccess = () => {
          const keys = request.result.map(k => this.deobfuscateKey(k));
          resolve(keys);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      securityManager.safeLog('error', 'Failed to get keys from IndexedDB', error);
      return [];
    }
  }

  /**
   * Cleanup expired items
   */
  async cleanupExpired() {
    await this.initPromise;

    try {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);
        const index = objectStore.index('expiry');
        const request = index.openCursor();

        let deletedCount = 0;

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          
          if (cursor) {
            const item = cursor.value;
            
            if (item.expiry && Date.now() > item.expiry) {
              cursor.delete();
              deletedCount++;
            }
            
            cursor.continue();
          } else {
            securityManager.safeLog('log', `Cleaned ${deletedCount} expired items`);
            resolve(deletedCount);
          }
        };

        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      securityManager.safeLog('error', 'Failed to cleanup expired items', error);
      return 0;
    }
  }

  /**
   * Obfuscate key to make it harder to identify
   */
  obfuscateKey(key) {
    // Simple hash-based obfuscation
    const hash = Array.from(key)
      .reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
    
    return `_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Deobfuscate key (not possible with hash, so we store mapping)
   */
  deobfuscateKey(obfuscatedKey) {
    // In production, we don't need to deobfuscate
    // This is just for debugging
    return obfuscatedKey;
  }

  /**
   * Check if IndexedDB is available
   */
  static isAvailable() {
    try {
      return 'indexedDB' in window && window.indexedDB !== null;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const secureIndexedDB = new SecureIndexedDB();
export default secureIndexedDB;
