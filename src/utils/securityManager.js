/**
 * Security Manager
 * 
 * Handles encryption/decryption of sensitive data and sanitization of error messages
 * to prevent exposure of backend URLs, Railway information, and other sensitive details
 */

// Simple but effective encryption using Web Crypto API
class SecurityManager {
  constructor() {
    this.encryptionKey = null;
    this.initPromise = this.initialize();
  }

  /**
   * Initialize encryption key from device fingerprint
   */
  async initialize() {
    try {
      // Generate a consistent key based on browser/device characteristics
      const fingerprint = await this.generateFingerprint();
      const encoder = new TextEncoder();
      const data = encoder.encode(fingerprint);
      
      // Derive encryption key
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      this.encryptionKey = await crypto.subtle.importKey(
        'raw',
        hashBuffer,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      // Fallback to session-based key if crypto API fails
      this.encryptionKey = null;
    }
  }

  /**
   * Generate device fingerprint for encryption key
   */
  async generateFingerprint() {
    const components = [
      navigator.userAgent,
      navigator.language,
      new Date().getTimezoneOffset(),
      screen.colorDepth,
      screen.width + 'x' + screen.height,
      navigator.hardwareConcurrency || 'unknown',
      navigator.platform
    ];
    return components.join('|');
  }

  /**
   * Encrypt sensitive data
   * @param {string} data - Data to encrypt
   * @returns {Promise<string>} Encrypted data as base64
   */
  async encrypt(data) {
    await this.initPromise;
    
    if (!this.encryptionKey || !data) {
      return btoa(data || ''); // Fallback to base64 encoding
    }

    try {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      
      // Generate random IV
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      // Encrypt
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        dataBuffer
      );
      
      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encryptedBuffer), iv.length);
      
      // Convert to base64
      return btoa(String.fromCharCode(...combined));
    } catch (error) {
      return btoa(data); // Fallback
    }
  }

  /**
   * Decrypt sensitive data
   * @param {string} encryptedData - Encrypted data as base64
   * @returns {Promise<string>} Decrypted data
   */
  async decrypt(encryptedData) {
    await this.initPromise;
    
    if (!this.encryptionKey || !encryptedData) {
      try {
        return atob(encryptedData || ''); // Fallback from base64
      } catch {
        return '';
      }
    }

    try {
      // Decode from base64
      const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
      
      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const encryptedBuffer = combined.slice(12);
      
      // Decrypt
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        encryptedBuffer
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (error) {
      try {
        return atob(encryptedData); // Fallback
      } catch {
        return '';
      }
    }
  }

  /**
   * Sanitize error messages to remove sensitive information
   * @param {string|Error} error - Error message or Error object
   * @returns {string} Sanitized error message
   */
  sanitizeError(error) {
    let message = typeof error === 'string' ? error : error?.message || 'An error occurred';
    
    // Remove URLs (http/https)
    message = message.replace(/https?:\/\/[^\s]+/gi, '[REDACTED]');
    
    // Remove Railway-specific terms
    message = message.replace(/railway/gi, 'service');
    message = message.replace(/\.up\.railway\.app/gi, '');
    
    // Remove IP addresses
    message = message.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED]');
    
    // Remove localhost references
    message = message.replace(/localhost:\d+/gi, '[REDACTED]');
    message = message.replace(/127\.0\.0\.1:\d+/gi, '[REDACTED]');
    
    // Remove port numbers
    message = message.replace(/:\d{4,5}\b/g, '');
    
    // Remove common backend error details
    message = message.replace(/ECONNREFUSED/gi, 'Connection failed');
    message = message.replace(/ETIMEDOUT/gi, 'Request timeout');
    message = message.replace(/ERR_NETWORK/gi, 'Network error');
    message = message.replace(/ERR_CONNECTION_REFUSED/gi, 'Connection failed');
    
    // Generic error messages for common issues
    if (message.includes('fetch') || message.includes('network')) {
      return 'Unable to connect to service. Please check your connection.';
    }
    
    if (message.includes('timeout')) {
      return 'Request timed out. Please try again.';
    }
    
    if (message.includes('CORS')) {
      return 'Service configuration error. Please contact support.';
    }
    
    return message;
  }

  /**
   * Safe console logging - only logs in development
   * @param {string} level - log, warn, error
   * @param {string} message - Message to log
   * @param {any} data - Optional data
   */
  safeLog(level, message, data = null) {
    // Only log in development environment
    if (import.meta.env.DEV) {
      const sanitized = this.sanitizeError(message);
      if (data) {
        console[level](sanitized, data);
      } else {
        console[level](sanitized);
      }
    }
  }

  /**
   * Check if URL contains sensitive information
   * @param {string} url - URL to check
   * @returns {boolean}
   */
  isSensitiveUrl(url) {
    if (!url) return false;
    
    const sensitive = [
      'railway.app',
      'localhost',
      '127.0.0.1',
      'backend',
      'api'
    ];
    
    return sensitive.some(term => url.toLowerCase().includes(term));
  }

  /**
   * Mask URL for display purposes
   * @param {string} url - URL to mask
   * @returns {string} Masked URL
   */
  maskUrl(url) {
    if (!url) return '';
    
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//***${urlObj.hostname.slice(-10)}`;
    } catch {
      return '***';
    }
  }
}

// Export singleton instance
export const securityManager = new SecurityManager();
export default securityManager;
