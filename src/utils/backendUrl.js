/**
 * Get the current backend URL
 * Priority:
 * 1. Deployed backend URL from storage (set after successful deployment)
 * 2. Environment variable (fallback) - ONLY for local development
 * 3. Return null if no backend is deployed
 */

import { storageManager } from './storageManager';

export const getBackendUrl = () => {
  // Check if user has deployed their own backend (using secure storage)
  const deployedUrl = storageManager.getItem('backendUrl');

  // Validate deployed URL - reject localhost in production
  if (deployedUrl) {
    if (window.location.hostname !== 'localhost' &&
        (deployedUrl.includes('localhost') || deployedUrl.includes('127.0.0.1'))) {
      storageManager.removeItem('backendUrl');
      storageManager.removeItem('deploymentStatus');
      return null;
    }
    return deployedUrl;
  }

  // Get environment variable
  const envUrl = import.meta.env.VITE_BACKEND_URL;

  // ONLY allow localhost URLs for local development
  if (envUrl && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1'))) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return envUrl;
    }
    return null;
  }

  // Check if deployment is active for remote URLs
  const isDeployed = storageManager.getItem('deploymentStatus') === 'deployed';

  if (!isDeployed) {
    return null;
  }

  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl;
  }

  return null;
};

/**
 * Set the backend URL after deployment (uses secure storage)
 * @param {string} url - The backend URL
 */
export const setBackendUrl = (url) => {
  storageManager.setItem('backendUrl', url);
};

/**
 * Clear the backend URL (on deactivation or logout)
 */
export const clearBackendUrl = () => {
  storageManager.removeItem('backendUrl');
};

/**
 * Check if using deployed backend
 */
export const isUsingDeployedBackend = () => {
  return !!storageManager.getItem('backendUrl');
};
