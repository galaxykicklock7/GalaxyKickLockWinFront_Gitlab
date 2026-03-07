/**
 * Backend URL Storage Utility
 *
 * Stores and retrieves the Railway backend URL from localStorage.
 * Coordinates with ConnectionManager for seamless URL management.
 */

import { storageManager } from './storageManager';
import { connectionManager } from './connectionManager';

const BACKEND_URL_KEY = 'railwayBackendUrl';

export const backendStorage = {
  /**
   * Save the Railway backend URL
   * @param {string} url - Railway backend URL
   * @returns {boolean}
   */
  saveBackendUrl(url) {
    if (!url || typeof url !== 'string') return false;
    storageManager.setItem(BACKEND_URL_KEY, url);
    connectionManager.setUrl(url);
    console.log(`Backend URL saved: ${url}`);
    return true;
  },

  /**
   * Load the stored Railway backend URL
   * @returns {string|null}
   */
  loadBackendUrl() {
    return storageManager.getItem(BACKEND_URL_KEY);
  },

  /**
   * Initialize connection manager from storage on app load
   * Only loads if deployment is currently active
   */
  initializeConnectionManager() {
    const deploymentStatus = storageManager.getItem('deploymentStatus');

    if (deploymentStatus !== 'deployed') {
      console.log('No active deployment - skipping backend URL initialization');
      return;
    }

    const url = this.loadBackendUrl();
    if (!url) {
      console.log('No backend URL in storage to initialize');
      return;
    }

    connectionManager.setUrl(url);
    console.log(`Connection manager initialized with: ${url}`);
  },

  /**
   * Clear backend URL from storage and connection manager
   */
  clearBackendUrl() {
    connectionManager.clear();
    storageManager.removeItem(BACKEND_URL_KEY);
    console.log('Backend URL cleared from storage and manager');
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
