/**
 * Universal Storage Manager
 * Handles session persistence across all devices and browsers
 * with multiple fallback mechanisms
 */

class StorageManager {
  constructor() {
    this.storageAvailable = this.checkStorageAvailability();
    this.cookieEnabled = this.checkCookieAvailability();
  }

  /**
   * Check if localStorage is available and working
   */
  checkStorageAvailability() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      console.warn('localStorage not available:', e);
      return false;
    }
  }

  /**
   * Check if cookies are enabled
   */
  checkCookieAvailability() {
    try {
      document.cookie = 'cookietest=1; SameSite=Lax';
      const cookieEnabled = document.cookie.indexOf('cookietest=') !== -1;
      document.cookie = 'cookietest=1; expires=Thu, 01-Jan-1970 00:00:01 GMT; SameSite=Lax';
      return cookieEnabled;
    } catch (e) {
      console.warn('Cookies not available:', e);
      return false;
    }
  }

  /**
   * Set item in all available storage locations
   */
  setItem(key, value) {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    let success = false;

    // Try localStorage
    if (this.storageAvailable) {
      try {
        localStorage.setItem(key, stringValue);
        success = true;
      } catch (e) {
        console.warn('localStorage.setItem failed:', e);
      }
    }

    // Try sessionStorage (always attempt as fallback)
    try {
      sessionStorage.setItem(key, stringValue);
      success = true;
    } catch (e) {
      console.warn('sessionStorage.setItem failed:', e);
    }

    // Try cookie (with size limit check)
    if (this.cookieEnabled && stringValue.length < 4000) {
      try {
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + 24);
        const cookieValue = `${key}=${encodeURIComponent(stringValue)}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
        document.cookie = cookieValue;
        success = true;
      } catch (e) {
        console.warn('Cookie set failed:', e);
      }
    }

    // Try IndexedDB as last resort for large data
    if (!success || stringValue.length >= 4000) {
      this.setItemIndexedDB(key, stringValue).catch(e => {
        console.warn('IndexedDB set failed:', e);
      });
    }

    return success;
  }

  /**
   * Get item from any available storage location
   */
  getItem(key) {
    let value = null;

    // Try localStorage first
    if (this.storageAvailable) {
      try {
        value = localStorage.getItem(key);
        if (value) {
          // Restore to other locations if found
          this.syncToOtherStorages(key, value);
          return value;
        }
      } catch (e) {
        console.warn('localStorage.getItem failed:', e);
      }
    }

    // Try sessionStorage
    try {
      value = sessionStorage.getItem(key);
      if (value) {
        // Restore to localStorage if available
        this.syncToOtherStorages(key, value);
        return value;
      }
    } catch (e) {
      console.warn('sessionStorage.getItem failed:', e);
    }

    // Try cookie
    if (this.cookieEnabled) {
      try {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
          const [name, val] = cookie.trim().split('=');
          if (name === key && val) {
            value = decodeURIComponent(val);
            // Restore to storage if found
            this.syncToOtherStorages(key, value);
            return value;
          }
        }
      } catch (e) {
        console.warn('Cookie read failed:', e);
      }
    }

    // Try IndexedDB as last resort
    // Note: This is async, so we return null here and let the app handle it
    this.getItemIndexedDB(key).then(val => {
      if (val) {
        this.syncToOtherStorages(key, val);
      }
    }).catch(e => {
      console.warn('IndexedDB get failed:', e);
    });

    return value;
  }

  /**
   * Sync value to all available storage locations
   */
  syncToOtherStorages(key, value) {
    if (this.storageAvailable) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        // Ignore
      }
    }

    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      // Ignore
    }

    if (this.cookieEnabled && value.length < 4000) {
      try {
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + 24);
        document.cookie = `${key}=${encodeURIComponent(value)}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Remove item from all storage locations
   */
  removeItem(key) {
    // Remove from localStorage
    if (this.storageAvailable) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn('localStorage.removeItem failed:', e);
      }
    }

    // Remove from sessionStorage
    try {
      sessionStorage.removeItem(key);
    } catch (e) {
      console.warn('sessionStorage.removeItem failed:', e);
    }

    // Remove from cookie
    if (this.cookieEnabled) {
      try {
        document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
      } catch (e) {
        console.warn('Cookie remove failed:', e);
      }
    }

    // Remove from IndexedDB
    this.removeItemIndexedDB(key).catch(e => {
      console.warn('IndexedDB remove failed:', e);
    });
  }

  /**
   * IndexedDB operations for large data or when other storage fails
   */
  async setItemIndexedDB(key, value) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('GalaxyKickLockDB', 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('storage')) {
          db.createObjectStore('storage', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['storage'], 'readwrite');
        const store = transaction.objectStore('storage');
        const putRequest = store.put({ key, value, timestamp: Date.now() });

        putRequest.onsuccess = () => resolve(true);
        putRequest.onerror = () => reject(putRequest.error);
      };
    });
  }

  async getItemIndexedDB(key) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('GalaxyKickLockDB', 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('storage')) {
          db.createObjectStore('storage', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('storage')) {
          resolve(null);
          return;
        }

        const transaction = db.transaction(['storage'], 'readonly');
        const store = transaction.objectStore('storage');
        const getRequest = store.get(key);

        getRequest.onsuccess = () => {
          const result = getRequest.result;
          if (result && result.value) {
            // Check if data is not too old (24 hours)
            const age = Date.now() - result.timestamp;
            if (age < 24 * 60 * 60 * 1000) {
              resolve(result.value);
            } else {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        };

        getRequest.onerror = () => reject(getRequest.error);
      };
    });
  }

  async removeItemIndexedDB(key) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('GalaxyKickLockDB', 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('storage')) {
          resolve(true);
          return;
        }

        const transaction = db.transaction(['storage'], 'readwrite');
        const store = transaction.objectStore('storage');
        const deleteRequest = store.delete(key);

        deleteRequest.onsuccess = () => resolve(true);
        deleteRequest.onerror = () => reject(deleteRequest.error);
      };
    });
  }

  /**
   * Clear all storage locations
   */
  clear() {
    // Clear localStorage
    if (this.storageAvailable) {
      try {
        localStorage.clear();
      } catch (e) {
        console.warn('localStorage.clear failed:', e);
      }
    }

    // Clear sessionStorage
    try {
      sessionStorage.clear();
    } catch (e) {
      console.warn('sessionStorage.clear failed:', e);
    }

    // Clear all cookies
    if (this.cookieEnabled) {
      try {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
          const name = cookie.split('=')[0].trim();
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
        }
      } catch (e) {
        console.warn('Cookie clear failed:', e);
      }
    }

    // Clear IndexedDB
    try {
      indexedDB.deleteDatabase('GalaxyKickLockDB');
    } catch (e) {
      console.warn('IndexedDB clear failed:', e);
    }
  }

  /**
   * Get storage diagnostics
   */
  getDiagnostics() {
    return {
      localStorage: this.storageAvailable,
      sessionStorage: (() => {
        try {
          sessionStorage.setItem('test', 'test');
          sessionStorage.removeItem('test');
          return true;
        } catch (e) {
          return false;
        }
      })(),
      cookies: this.cookieEnabled,
      indexedDB: 'indexedDB' in window,
      protocol: window.location.protocol,
      userAgent: navigator.userAgent
    };
  }
}

// Export singleton instance
export const storageManager = new StorageManager();
