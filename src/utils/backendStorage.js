/**
 * Backend URL Storage Utility
 *
 * Stores and retrieves backend URLs with encryption from localStorage.
 * Coordinates with ConnectionManager for seamless URL management.
 */

import { storageManager } from './storageManager';
import { connectionManager } from './connectionManager';
import { securityManager } from './securityManager';

const BACKEND_URL_KEY = 'svc_endpoint';

export const backendStorage = {
  /**
   * Save the backend URL with encryption
   * @param {string} url - Backend URL
   * @returns {Promise<boolean>}
   */
  async saveBackendUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    try {
      const encrypted = await securityManager.encrypt(url);
      storageManager.setItem(BACKEND_URL_KEY, encrypted);
      connectionManager.setUrl(url);
      securityManager.safeLog('log', 'Service endpoint configured');
      return true;
    } catch (error) {
      securityManager.safeLog('error', 'Failed to save endpoint');
      return false;
    }
  },

  /**
   * Load the stored backend URL with decryption
   * @returns {Promise<string|null>}
   */
  async loadBackendUrl() {
    try {
      const encrypted = storageManager.getItem(BACKEND_URL_KEY);
      if (!encrypted) return null;
      
      return await securityManager.decrypt(encrypted);
    } catch (error) {
      securityManager.safeLog('error', 'Failed to load endpoint');
      return null;
    }
  },

  /**
   * Initialize connection manager from storage on app load
   * Only loads if deployment is currently active
   */
  async initializeConnectionManager() {
    const deploymentStatus = storageManager.getItem('deploymentStatus');

    if (deploymentStatus !== 'deployed') {
      securityManager.safeLog('log', 'No active deployment');
      return;
    }

    const url = await this.loadBackendUrl();
    if (!url) {
      securityManager.safeLog('log', 'No endpoint in storage');
      return;
    }

    connectionManager.setUrl(url);
    securityManager.safeLog('log', 'Connection manager initialized');
  },

  /**
   * Clear backend URL from storage and connection manager
   */
  clearBackendUrl() {
    connectionManager.clear();
    storageManager.removeItem(BACKEND_URL_KEY);
    securityManager.safeLog('log', 'Service endpoint cleared');
  },

  /**
   * Get backend status summary
   * @returns {object}
   */
  getStatusSummary() {
    const statuses = connectionManager.getStatus();
    const healthy = statuses.filter(t => t.status === 'HEALTHY').length;
    const degraded = statuses.filter(t => t.status === 'DEGRADED').length;
    const offline = statuses.filter(t => t.status === 'OFFLINE').length;

    return {
      total: statuses.length,
      healthy,
      degraded,
      offline,
      backends: statuses
    };
  },
};

export default backendStorage;
