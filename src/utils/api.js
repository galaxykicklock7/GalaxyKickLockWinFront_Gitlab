import axios from 'axios';
import { getBackendUrl } from './backendUrl';
import { storageManager } from './storageManager';
import { tunnelManager } from './tunnelManager';
import { tunnelStorage } from './tunnelStorage';

// Eagerly restore tunnels from localStorage so the very first API call
// uses a tunnel URL instead of falling back to the plain backendUrl.
// This runs synchronously at module load time — before any React render.
tunnelStorage.initializeTunnelManager();

/**
 * Returns the best available backend URL — healthy tunnel first, plain URL as fallback.
 * Use this everywhere instead of getBackendUrl() for raw fetch calls.
 */
export const getBestUrl = () => {
  const healthyTunnel = tunnelManager.getHealthyTunnel();
  return healthyTunnel ? healthyTunnel.url : getBackendUrl();
};

// Keep persistent axios instances per backend URL to reuse connections (max 5 entries)
const API_INSTANCE_CACHE_MAX = 5;
const apiInstanceCache = new Map();

// Create a function to get the current axios instance with the right backend URL
const createApiInstance = () => {
  // ✅ NEW: Try to get best tunnel from tunnel manager first
  let BACKEND_URL = null;
  const healthyTunnel = tunnelManager.getHealthyTunnel();

  if (healthyTunnel) {
    BACKEND_URL = healthyTunnel.url;
  } else {
    // Fallback to configured backend URL
    BACKEND_URL = getBackendUrl();
  }

  // Always use the backend URL directly (no proxy)
  const baseURL = BACKEND_URL;

  // ✅ FIX: Reuse existing axios instance for same backend URL (connection pooling)
  if (apiInstanceCache.has(baseURL)) {
    return apiInstanceCache.get(baseURL);
  }

  // Removed excessive logging - only log in development if needed
  // console.log('🔧 Creating API instance with baseURL:', baseURL);

  // Create axios instance with proper headers
  // NOTE: Connection and Keep-Alive headers are automatically managed by browser (unsafe to set from JS)
  const axiosInstance = axios.create({
    baseURL: baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      'bypass-tunnel-reminder': 'true'
    }
  });

  // ✅ FIX: Add automatic retry logic + tunnel failure tracking
  axiosInstance.interceptors.response.use(
    (response) => {
      // Success - clear retry count and record success in tunnel manager
      if (response.config) {
        response.config.retryCount = 0;
        const startTime = response.config.startTime || Date.now();
        const responseTime = Date.now() - startTime;
        tunnelManager.recordSuccess(baseURL, responseTime);
      }
      return response;
    },
    async (error) => {
      // Record failure in tunnel manager
      tunnelManager.recordFailure(baseURL, error.code || error.message);

      // Check if this is a retryable error
      const isRetryable =
        error.code === 'ECONNABORTED' ||  // Timeout
        error.code === 'ERR_NETWORK' ||
        error.code === 'ERR_CONNECTION_REFUSED' ||
        error.message?.includes('Network Error') ||
        error.message?.includes('CORS') ||
        error.message?.includes('ERR_FAILED') ||
        error.response?.status === 503 ||  // Service unavailable
        error.response?.status === 504;    // Gateway timeout

      // Get retry count from error config (starts at 0)
      const config = error.config;
      if (!config) {
        return Promise.reject(error);
      }

      config.retryCount = config.retryCount || 0;
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 500;  // 500ms between retries

      // Only retry if we haven't exceeded max retries and error is retryable
      if (config.retryCount < MAX_RETRIES && isRetryable) {
        config.retryCount++;
        const delayMs = RETRY_DELAY_MS * config.retryCount;  // Exponential: 500ms, 1000ms, 1500ms

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // Retry the request
        return axiosInstance(config);
      }

      // If not retryable or max retries exceeded, return simplified error
      if (error.code === 'ERR_NETWORK' || error.code === 'ERR_CONNECTION_REFUSED' ||
          error.message?.includes('Network Error') || error.message?.includes('CORS') ||
          error.message?.includes('ERR_FAILED')) {
        return Promise.reject({ message: 'Network error', code: 'NETWORK_ERROR' });
      }
      return Promise.reject(error);
    }
  );

  // Store start time for response time calculation
  axiosInstance.interceptors.request.use((config) => {
    config.startTime = Date.now();
    return config;
  });

  // Cache the instance; evict oldest entry if over the cap
  if (apiInstanceCache.size >= API_INSTANCE_CACHE_MAX) {
    const oldestKey = apiInstanceCache.keys().next().value;
    apiInstanceCache.delete(oldestKey);
  }
  apiInstanceCache.set(baseURL, axiosInstance);

  return axiosInstance;
};

// Get the current API instance (with cache for persistent connections)
const getApi = () => createApiInstance();

// API methods
export const apiClient = {
  // Health check
  async health() {
    const api = getApi();
    const response = await api.get('/api/health');
    return response.data;
  },

  // Get status
  async getStatus() {
    const api = getApi();
    const response = await api.get('/api/status', {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    return response.data;
  },

  // Get logs
  async getLogs() {
    const api = getApi();
    const response = await api.get('/api/logs', {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    return response.data;
  },

  // Configure
  async configure(config) {
    const api = getApi();
    const backendUrl = getBackendUrl();

    if (!backendUrl) {
      throw new Error('Backend URL not configured. Enable Local Test mode or deploy backend.');
    }

    const response = await api.post('/api/configure', config);
    return response.data;
  },

  // Connect
  async connect() {
    const api = getApi();
    const response = await api.post('/api/connect');
    return response.data;
  },

  // Disconnect
  async disconnect() {
    const api = getApi();
    const response = await api.post('/api/disconnect');
    return response.data;
  },

  // Send command to specific WebSocket
  async sendCommand(wsNumber, command) {
    const api = getApi();
    const response = await api.post('/api/send', {
      wsNumber,
      command
    });
    return response.data;
  },

  // Release all from prison
  async release() {
    const api = getApi();
    const response = await api.post('/api/release');
    return response.data;
  }
};

export default getApi;
export { getBackendUrl as BACKEND_URL };
