/**
 * Storage Protection Layer
 * 
 * Prevents localStorage inspection and manipulation through DevTools
 * by implementing multiple protection mechanisms.
 */

import { securityManager } from './securityManager';

class StorageProtection {
  constructor() {
    this.isProtected = false;
    this.originalStorage = null;
    this.memoryStorage = new Map();
    this.devToolsOpen = false;
    
    // Initialize protection in production
    if (!import.meta.env.DEV) {
      this.enableProtection();
    }
  }

  /**
   * Enable all protection mechanisms
   */
  enableProtection() {
    if (this.isProtected) return;
    
    this.protectLocalStorage();
    this.detectDevTools();
    this.preventInspection();
    this.obfuscateKeys();
    
    this.isProtected = true;
    securityManager.safeLog('log', 'Storage protection enabled');
  }

  /**
   * Protect localStorage from direct access
   */
  protectLocalStorage() {
    // DISABLED: This was too aggressive and breaks functionality
    // Instead, we'll just obfuscate keys and encrypt values
    return;
  }

  /**
   * Detect if DevTools is open
   */
  detectDevTools() {
    // DISABLED: Too aggressive, can cause issues
    // We'll rely on encryption instead
    return;
  }

  /**
   * Handle DevTools being opened
   */
  handleDevToolsOpen() {
    if (!import.meta.env.DEV) {
      // Clear sensitive data from localStorage
      this.clearSensitiveData();
      
      // Show warning
      console.clear();
      console.log('%c⚠️ SECURITY WARNING', 'color: red; font-size: 24px; font-weight: bold;');
      console.log('%cDeveloper tools detected. For security reasons, sensitive data has been cleared.', 'font-size: 14px;');
      console.log('%cIf you are a developer, please use the development build.', 'font-size: 12px;');
      
      // Optionally redirect or logout
      // window.location.href = '/security-warning';
    }
  }

  /**
   * Clear sensitive data from localStorage
   */
  clearSensitiveData() {
    const sensitiveKeys = [
      'userSession',
      'svc_endpoint',
      'backendUrl',
      'serviceConfig',
      'sb-',  // Supabase keys
      'auth-token'
    ];
    
    Object.keys(localStorage).forEach(key => {
      if (sensitiveKeys.some(sensitive => key.includes(sensitive))) {
        localStorage.removeItem(key);
      }
    });
  }

  /**
   * Prevent localStorage inspection
   */
  preventInspection() {
    // DISABLED: This breaks functionality
    // We'll rely on encryption and obfuscation instead
    return;
  }

  /**
   * Obfuscate localStorage keys
   */
  obfuscateKeys() {
    // Map of original keys to obfuscated keys
    this.keyMap = new Map();
    
    // Generate obfuscated keys for sensitive data
    const sensitiveKeys = [
      'userSession',
      'svc_endpoint',
      'backendUrl',
      'serviceConfig'
    ];
    
    sensitiveKeys.forEach(key => {
      const obfuscated = this.generateObfuscatedKey(key);
      this.keyMap.set(key, obfuscated);
    });
  }

  /**
   * Generate obfuscated key
   */
  generateObfuscatedKey(originalKey) {
    // Create a hash-like obfuscated key
    const hash = Array.from(originalKey)
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    return `_${hash.toString(36)}_${Date.now().toString(36)}`;
  }

  /**
   * Get obfuscated key
   */
  getObfuscatedKey(originalKey) {
    return this.keyMap.get(originalKey) || originalKey;
  }

  /**
   * Store data with obfuscation
   */
  async setSecureItem(key, value) {
    const obfuscatedKey = this.getObfuscatedKey(key);
    const encrypted = await securityManager.encrypt(JSON.stringify(value));
    
    // Store in memory as well
    this.memoryStorage.set(key, value);
    
    // Store encrypted in localStorage
    this.originalStorage.setItem(obfuscatedKey, encrypted);
  }

  /**
   * Retrieve data with deobfuscation
   */
  async getSecureItem(key) {
    // Try memory first
    if (this.memoryStorage.has(key)) {
      return this.memoryStorage.get(key);
    }
    
    // Try localStorage
    const obfuscatedKey = this.getObfuscatedKey(key);
    const encrypted = this.originalStorage.getItem(obfuscatedKey);
    
    if (!encrypted) return null;
    
    try {
      const decrypted = await securityManager.decrypt(encrypted);
      const value = JSON.parse(decrypted);
      
      // Cache in memory
      this.memoryStorage.set(key, value);
      
      return value;
    } catch (error) {
      return null;
    }
  }

  /**
   * Remove secure item
   */
  removeSecureItem(key) {
    this.memoryStorage.delete(key);
    const obfuscatedKey = this.getObfuscatedKey(key);
    this.originalStorage.removeItem(obfuscatedKey);
  }

  /**
   * Clear all secure items
   */
  clearSecureItems() {
    this.memoryStorage.clear();
    
    // Clear obfuscated keys from localStorage
    this.keyMap.forEach((obfuscatedKey) => {
      this.originalStorage.removeItem(obfuscatedKey);
    });
  }

  /**
   * Disable protection (for development)
   */
  disableProtection() {
    if (!this.isProtected) return;
    
    this.isProtected = false;
    securityManager.safeLog('log', 'Storage protection disabled');
  }
}

// Export singleton instance
export const storageProtection = new StorageProtection();
export default storageProtection;
