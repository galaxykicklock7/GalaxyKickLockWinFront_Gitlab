import axios from 'axios';
import { getBackendUrl } from './backendUrl';

// Create a function to get the current axios instance with the right backend URL
const createApiInstance = () => {
  const BACKEND_URL = getBackendUrl();
  
  // Always use the backend URL directly (no proxy)
  const baseURL = BACKEND_URL;

  // Removed excessive logging - only log in development if needed
  // console.log('🔧 Creating API instance with baseURL:', baseURL);

  // Create axios instance
  const axiosInstance = axios.create({
    baseURL: baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      'bypass-tunnel-reminder': 'true'
    }
  });

  // Intercept response to silently handle CORS/network errors
  axiosInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.code === 'ERR_NETWORK' || error.code === 'ERR_CONNECTION_REFUSED' || 
          error.message.includes('Network Error') || error.message.includes('CORS') ||
          error.message.includes('ERR_FAILED')) {
        return Promise.reject({ message: 'Network error', code: 'NETWORK_ERROR' });
      }
      return Promise.reject(error);
    }
  );

  return axiosInstance;
};

// Get the current API instance
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
    // Add timestamp to prevent caching
    const response = await api.get(`/api/status?t=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    return response.data;
  },

  // Get logs
  async getLogs() {
    const api = getApi();
    // Add timestamp to prevent caching
    const response = await api.get(`/api/logs?t=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    return response.data;
  },

  // Configure
  async configure(config) {
    const api = getApi();
    const backendUrl = getBackendUrl();
    console.log('🌐 API POST /api/configure - Sending payload:', config);
    console.log('🌐 Backend URL:', backendUrl);
    console.log('🌐 Full URL:', backendUrl ? `${backendUrl}/api/configure` : 'NO BACKEND URL!');
    
    if (!backendUrl) {
      console.error('❌ Backend URL is null! Cannot send config.');
      throw new Error('Backend URL not configured. Enable Local Test mode or deploy backend.');
    }
    
    try {
      const response = await api.post('/api/configure', config);
      console.log('✅ API POST /api/configure - Response:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ API POST /api/configure - Error:', error);
      throw error;
    }
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
