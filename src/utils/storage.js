/**
 * Unified Storage API
 * 
 * Automatically uses obfuscated storage in production
 * and regular localStorage in development for easier debugging.
 */

import { obfuscatedStorage } from './obfuscatedStorage';

class UnifiedStorage {
  constructor() {
    this.useObfuscation = !import.meta.env.DEV;
    
    // Initialize obfuscated storage in production
    if (this.useObfuscation) {
      obfuscatedStorage.initialize();
    }
  }

  /**
   * Set item
   */
  async setItem(key, value) {
    if (this.useObfuscation) {
      return await obfuscatedStorage.setItem(key, value);
    } else {
      // Development: use regular localStorage
      try {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem(key, stringValue);
        return true;
      } catch (error) {
        console.error('Failed to set item:', error);
        return false;
      }
    }
  }

  /**
   * Get item
   */
  async getItem(key) {
    if (this.useObfuscation) {
      return await obfuscatedStorage.getItem(key);
    } else {
      // Development: use regular localStorage
      try {
        const value = localStorage.getItem(key);
        if (!value) return null;
        
        // Try to parse as JSON
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      } catch (error) {
        console.error('Failed to get item:', error);
        return null;
      }
    }
  }

  /**
   * Remove item
   */
  removeItem(key) {
    if (this.useObfuscation) {
      return obfuscatedStorage.removeItem(key);
    } else {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (error) {
        console.error('Failed to remove item:', error);
        return false;
      }
    }
  }

  /**
   * Clear all
   */
  clear() {
    if (this.useObfuscation) {
      return obfuscatedStorage.clear();
    } else {
      try {
        localStorage.clear();
        return true;
      } catch (error) {
        console.error('Failed to clear storage:', error);
        return false;
      }
    }
  }
}

// Export singleton instance
export const storage = new UnifiedStorage();
export default storage;
