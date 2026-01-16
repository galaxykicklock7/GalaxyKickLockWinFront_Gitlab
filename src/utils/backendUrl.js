/**
 * Get the current backend URL
 * Priority:
 * 1. Deployed backend URL from localStorage (set after successful deployment)
 * 2. Environment variable (fallback)
 * 3. For local development: Always allow localhost URLs
 */
export const getBackendUrl = () => {
  // Check if user has deployed their own backend
  const deployedUrl = localStorage.getItem('backendUrl');
  
  if (deployedUrl) {
    return deployedUrl;
  }
  
  // Get environment variable
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  
  // Allow localhost URLs for local development (bypass deployment check)
  if (envUrl && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1'))) {
    console.log('🔧 BACKEND URL: Using local backend:', envUrl);
    return envUrl;
  }
  
  // Check if deployment is active for remote URLs
  const isDeployed = localStorage.getItem('deploymentStatus') === 'deployed';
  
  // If not deployed, don't return remote URL (prevents polling dead backends)
  if (!isDeployed) {
    console.warn('⚠️ BACKEND URL: No active deployment, returning null');
    return null;
  }
  
  return envUrl;
};

/**
 * Set the backend URL after deployment
 * @param {string} url - The backend URL (e.g., https://bharanitest007.loca.lt)
 */
export const setBackendUrl = (url) => {
  localStorage.setItem('backendUrl', url);
};

/**
 * Clear the backend URL (on deactivation or logout)
 */
export const clearBackendUrl = () => {
  localStorage.removeItem('backendUrl');
  localStorage.removeItem('backendSubdomain');
};

/**
 * Check if using deployed backend
 */
export const isUsingDeployedBackend = () => {
  return !!localStorage.getItem('backendUrl');
};
