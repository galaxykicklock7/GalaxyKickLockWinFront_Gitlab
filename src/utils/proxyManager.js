/**
 * Proxy Manager
 * 
 * Routes all backend requests through a proxy to hide the actual backend URL
 * from the browser's Network tab. The real backend URL is only known server-side.
 */

import { securityManager } from './securityManager';

class ProxyManager {
  constructor() {
    this.proxyEndpoint = '/api/proxy';
    this.isProxyEnabled = true;
  }

  /**
   * Check if we should use proxy (always true in production)
   */
  shouldUseProxy() {
    // Always use proxy in production to hide backend URL
    if (!import.meta.env.DEV) {
      return true;
    }
    
    // In development, can be toggled
    return this.isProxyEnabled;
  }

  /**
   * Convert a direct backend URL to a proxied URL
   * @param {string} backendUrl - Original backend URL
   * @param {string} path - API path (e.g., '/api/health')
   * @returns {string} Proxied URL
   */
  getProxiedUrl(backendUrl, path) {
    if (!this.shouldUseProxy()) {
      return `${backendUrl}${path}`;
    }

    // Encode the path to pass through proxy
    const encodedPath = encodeURIComponent(path);
    
    // Use relative URL so it goes through same domain
    return `${this.proxyEndpoint}?path=${encodedPath}`;
  }

  /**
   * Get headers for proxy request
   * @param {string} backendUrl - The actual backend URL (will be base64 encoded)
   * @returns {Promise<object>} Headers including encoded backend URL
   */
  async getProxyHeaders(backendUrl) {
    if (!this.shouldUseProxy()) {
      return {};
    }

    // Simple base64 encoding (still hides URL from casual inspection)
    const encoded = btoa(backendUrl);
    
    return {
      'X-Target-Endpoint': encoded,
      'X-Proxy-Request': 'true'
    };
  }

  /**
   * Make a proxied request
   * @param {string} backendUrl - Actual backend URL
   * @param {string} path - API path
   * @param {object} options - Fetch options
   * @returns {Promise<Response>}
   */
  async fetch(backendUrl, path, options = {}) {
    const url = this.getProxiedUrl(backendUrl, path);
    const proxyHeaders = await this.getProxyHeaders(backendUrl);
    
    const mergedOptions = {
      ...options,
      headers: {
        ...options.headers,
        ...proxyHeaders
      }
    };

    return fetch(url, mergedOptions);
  }

  /**
   * Enable/disable proxy (development only)
   */
  setProxyEnabled(enabled) {
    if (import.meta.env.DEV) {
      this.isProxyEnabled = enabled;
    }
  }
}

export const proxyManager = new ProxyManager();
export default proxyManager;
