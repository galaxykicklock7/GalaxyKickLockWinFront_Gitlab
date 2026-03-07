import axios from 'axios';
import { getBackendUrl } from './backendUrl';
import { connectionManager } from './connectionManager';
import { backendStorage } from './backendStorage';
import { securityManager } from './securityManager';
import { proxyManager } from './proxyManager';

// Restore backend URL from localStorage so the first API call uses the correct URL.
// This is async but we don't await it at module level - it will complete before first API call
backendStorage.initializeConnectionManager().catch(err => {
  securityManager.safeLog('error', 'Failed to initialize connection manager', err);
});

/**
 * Returns the current backend URL — from connection manager or plain backendUrl.
 */
export const getBestUrl = () => {
  const managed = connectionManager.getUrl();
  return managed || getBackendUrl();
};

// Persistent axios instances per backend URL (max 5 entries)
const API_INSTANCE_CACHE_MAX = 5;
const apiInstanceCache = new Map();

const createApiInstance = () => {
  const baseURL = getBestUrl();

  // Reuse existing axios instance for same backend URL (connection pooling)
  if (apiInstanceCache.has(baseURL)) {
    return apiInstanceCache.get(baseURL);
  }

  const axiosInstance = axios.create({
    baseURL: proxyManager.shouldUseProxy() ? window.location.origin : baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    }
  });

  // Interceptor to add proxy headers and modify URLs
  axiosInstance.interceptors.request.use(async (config) => {
    config.startTime = Date.now();
    
    // If using proxy, modify the request
    if (proxyManager.shouldUseProxy() && baseURL) {
      const path = config.url.startsWith('/') ? config.url : `/${config.url}`;
      const proxyHeaders = await proxyManager.getProxyHeaders(baseURL);
      
      // Update URL to proxy endpoint
      config.url = proxyManager.getProxiedUrl(baseURL, path);
      
      // Add proxy headers
      config.headers = {
        ...config.headers,
        ...proxyHeaders
      };
    }
    
    return config;
  });

  // Auto-retry + health tracking
  axiosInstance.interceptors.response.use(
    (response) => {
      if (response.config) {
        response.config.retryCount = 0;
        const startTime = response.config.startTime || Date.now();
        const responseTime = Date.now() - startTime;
        connectionManager.recordSuccess(baseURL, responseTime);
      }
      return response;
    },
    async (error) => {
      connectionManager.recordFailure(baseURL, error.code || error.message);

      const isRetryable =
        error.code === 'ECONNABORTED' ||
        error.code === 'ERR_NETWORK' ||
        error.code === 'ERR_CONNECTION_REFUSED' ||
        error.message?.includes('Network Error') ||
        error.message?.includes('CORS') ||
        error.message?.includes('ERR_FAILED') ||
        error.response?.status === 503 ||
        error.response?.status === 504;

      const config = error.config;
      if (!config) {
        return Promise.reject({
          message: securityManager.sanitizeError(error),
          code: 'REQUEST_ERROR'
        });
      }

      config.retryCount = config.retryCount || 0;
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 500;

      if (config.retryCount < MAX_RETRIES && isRetryable) {
        config.retryCount++;
        const delayMs = RETRY_DELAY_MS * config.retryCount;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return axiosInstance(config);
      }

      // Sanitize error before returning
      const sanitizedMessage = securityManager.sanitizeError(error);
      
      if (error.code === 'ERR_NETWORK' || error.code === 'ERR_CONNECTION_REFUSED' ||
          error.message?.includes('Network Error') || error.message?.includes('CORS') ||
          error.message?.includes('ERR_FAILED')) {
        return Promise.reject({ 
          message: sanitizedMessage,
          code: 'NETWORK_ERROR' 
        });
      }
      
      return Promise.reject({ 
        message: sanitizedMessage,
        code: error.code || 'UNKNOWN_ERROR'
      });
    }
  );

  // Store start time for response time calculation (moved to request interceptor above)

  // Cache the instance; evict oldest if over cap
  if (apiInstanceCache.size >= API_INSTANCE_CACHE_MAX) {
    const oldestKey = apiInstanceCache.keys().next().value;
    apiInstanceCache.delete(oldestKey);
  }
  apiInstanceCache.set(baseURL, axiosInstance);

  return axiosInstance;
};

const getApi = () => createApiInstance();

// API methods
export const apiClient = {
  async health() {
    const api = getApi();
    const response = await api.get('/api/health');
    return response.data;
  },

  async getStatus() {
    const api = getApi();
    const response = await api.get('/api/status', {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    return response.data;
  },

  async getLogs() {
    const api = getApi();
    const response = await api.get('/api/logs', {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    return response.data;
  },

  async configure(config) {
    const api = getApi();
    const backendUrl = getBackendUrl();

    if (!backendUrl) {
      throw new Error('Service not configured. Please enable deployment mode.');
    }

    const response = await api.post('/api/configure', config);
    return response.data;
  },

  async connect() {
    const api = getApi();
    const response = await api.post('/api/connect');
    return response.data;
  },

  async disconnect() {
    const api = getApi();
    const response = await api.post('/api/disconnect');
    return response.data;
  },

  async sendCommand(wsNumber, command) {
    const api = getApi();
    const response = await api.post('/api/send', {
      wsNumber,
      command
    });
    return response.data;
  },

  async release() {
    const api = getApi();
    const response = await api.post('/api/release');
    return response.data;
  }
};

export default getApi;
export { getBackendUrl as BACKEND_URL };
