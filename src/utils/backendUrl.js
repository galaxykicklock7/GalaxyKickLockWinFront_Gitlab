/**
 * Get the current backend URL
 * Priority:
 * 1. Deployed backend URL from localStorage (set after successful Railway deployment)
 * 2. Environment variable (fallback) - ONLY for local development
 * 3. Return null if no backend is deployed
 */
export const getBackendUrl = () => {
  // Check if user has deployed their own backend
  const deployedUrl = localStorage.getItem('backendUrl');

  // Validate deployed URL - reject localhost in production
  if (deployedUrl) {
    if (window.location.hostname !== 'localhost' &&
        (deployedUrl.includes('localhost') || deployedUrl.includes('127.0.0.1'))) {
      console.warn('Localhost backend URL detected in production, clearing...');
      localStorage.removeItem('backendUrl');
      localStorage.removeItem('deploymentStatus');
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
  const isDeployed = localStorage.getItem('deploymentStatus') === 'deployed';

  if (!isDeployed) {
    return null;
  }

  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl;
  }

  return null;
};

/**
 * Set the backend URL after deployment
 * @param {string} url - The backend URL (e.g., https://myapp.up.railway.app)
 */
export const setBackendUrl = (url) => {
  localStorage.setItem('backendUrl', url);
};

/**
 * Clear the backend URL (on deactivation or logout)
 */
export const clearBackendUrl = () => {
  localStorage.removeItem('backendUrl');
};

/**
 * Check if using deployed backend
 */
export const isUsingDeployedBackend = () => {
  return !!localStorage.getItem('backendUrl');
};
