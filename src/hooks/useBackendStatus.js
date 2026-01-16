import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../utils/api';
import { storageManager } from '../utils/storageManager';

export const useBackendStatus = () => {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState({ log1: [], log2: [], log3: [], log4: [], log5: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const consecutiveFailures = useRef(0);
  const pollingIntervalRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const statusData = await apiClient.getStatus();
      setStatus(statusData);
      setConnected(statusData.connected);
      setError(null);
      consecutiveFailures.current = 0;
    } catch (err) {
      consecutiveFailures.current++;
      if (err.code !== 'NETWORK_ERROR') {
        setConnected(false);
      }
      // Don't auto-reset deployment status - let user manually deactivate
      // This prevents false positives from temporary network issues
      if (consecutiveFailures.current >= 10) {
        console.warn('⚠️ Backend unreachable for 10 seconds, but keeping deployment active');
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const logsData = await apiClient.getLogs();

      // Backend returns logs directly, not wrapped in a 'logs' property
      if (logsData && (logsData.log1 || logsData.log2 || logsData.log3 || logsData.log4 || logsData.log5)) {
        setLogs(logsData);
      } else if (logsData && logsData.logs) {
        // Fallback: if backend wraps in 'logs' property
        setLogs(logsData.logs);
      }
      consecutiveFailures.current = 0;
    } catch (err) {
      if (err.code === 'NETWORK_ERROR') {
        consecutiveFailures.current++;
        // Don't auto-reset deployment status - let user manually deactivate
        if (consecutiveFailures.current >= 10) {
          console.warn('⚠️ Backend unreachable for 10 seconds, but keeping deployment active');
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        }
      }
    }
  }, []);

  // Efficient polling - only when deployed
  useEffect(() => {
    // Check if backend is deployed
    const checkDeploymentAndPoll = () => {
      const isDeployed = storageManager.getItem('deploymentStatus') === 'deployed';
      
      if (!isDeployed) {
        setLoading(false);
        setConnected(false);
        return null;
      }

      // Initial fetch
      fetchStatus();
      fetchLogs();

      // Poll every 1 second for real-time feel
      pollingIntervalRef.current = setInterval(() => {
        if (storageManager.getItem('deploymentStatus') === 'deployed') {
          fetchStatus();
          fetchLogs();
        }
      }, 1000);

      return pollingIntervalRef.current;
    };

    let pollInterval = checkDeploymentAndPoll();

    // Listen for deployment status changes (custom event from same tab)
    const handleDeploymentChange = (e) => {
      // Clear existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      consecutiveFailures.current = 0;

      // Restart polling if deployed
      if (e.detail.status === 'deployed') {
        pollInterval = checkDeploymentAndPoll();
      } else {
        setLoading(false);
        setConnected(false);
      }
    };

    window.addEventListener('deploymentStatusChanged', handleDeploymentChange);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      window.removeEventListener('deploymentStatusChanged', handleDeploymentChange);
    };
  }, [fetchStatus, fetchLogs]);

  const connect = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiClient.connect();
      await fetchStatus();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const disconnect = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiClient.disconnect();
      await fetchStatus();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const updateConfig = useCallback(async (config) => {
    console.log('🎯 useBackendStatus.updateConfig() CALLED with config:', config);
    try {
      console.log('🎯 Calling apiClient.configure()...');
      const result = await apiClient.configure(config);
      console.log('🎯 apiClient.configure() returned:', result);
      // Don't fetch status immediately to avoid overwriting the UI
      return result;
    } catch (err) {
      console.error('🎯 updateConfig ERROR:', err);
      setError(err.message);
      throw err;
    }
  }, []);

  const sendCommand = useCallback(async (wsNumber, command) => {
    try {
      const result = await apiClient.sendCommand(wsNumber, command);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  return {
    status,
    logs,
    loading,
    error,
    connected,
    connect,
    disconnect,
    updateConfig,
    sendCommand,
    refresh: fetchStatus
  };
};
