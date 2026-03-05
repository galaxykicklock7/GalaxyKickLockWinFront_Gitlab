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
  const autoReconnectAttempted = useRef(false);

  // Inflight flags prevent request pile-up when responses take >poll-interval
  const fetchStatusInflight = useRef(false);
  const fetchLogsInflight   = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (fetchStatusInflight.current) return;
    fetchStatusInflight.current = true;
    try {
      const statusData = await apiClient.getStatus();
      setStatus(statusData);

      // Auto-reconnect: if backend says not connected but we were before refresh,
      // automatically reconnect once (config is already persisted in localStorage)
      if (!statusData.connected && !autoReconnectAttempted.current &&
          sessionStorage.getItem('wsConnected') === 'true') {
        autoReconnectAttempted.current = true;
        sessionStorage.setItem('wsConnected', 'false');
        // Fire-and-forget reconnect — don't await, let polling update state
        apiClient.connect().catch(() => {});
      } else {
        setConnected(statusData.connected);
        sessionStorage.setItem('wsConnected', statusData.connected ? 'true' : 'false');
      }

      setError(null);
      consecutiveFailures.current = 0;
    } catch (err) {
      consecutiveFailures.current++;
      if (err.code !== 'NETWORK_ERROR') {
        setConnected(false);
        sessionStorage.setItem('wsConnected', 'false');
      }
      if (consecutiveFailures.current >= 10) {
        console.warn('⚠️ Backend unreachable for 10 seconds, but keeping deployment active');
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    } finally {
      setLoading(false);
      fetchStatusInflight.current = false;
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    if (fetchLogsInflight.current) return;
    fetchLogsInflight.current = true;
    try {
      const logsData = await apiClient.getLogs();
      if (logsData && (logsData.log1 || logsData.log2 || logsData.log3 || logsData.log4 || logsData.log5)) {
        setLogs(logsData);
      } else if (logsData && logsData.logs) {
        setLogs(logsData.logs);
      }
      consecutiveFailures.current = 0;
    } catch (err) {
      if (err.code === 'NETWORK_ERROR') {
        consecutiveFailures.current++;
        if (consecutiveFailures.current >= 10) {
          console.warn('⚠️ Backend unreachable for 10 seconds, but keeping deployment active');
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        }
      }
    } finally {
      fetchLogsInflight.current = false;
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

      // Poll every 2 seconds; skip when tab is hidden to save CPU + tunnel quota
      pollingIntervalRef.current = setInterval(() => {
        if (document.hidden) return;
        if (storageManager.getItem('deploymentStatus') === 'deployed') {
          if (!fetchStatus._inflight) fetchStatus();
          if (!fetchLogs._inflight)   fetchLogs();
        }
      }, 2000);

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
      autoReconnectAttempted.current = false;

      // Restart polling if deployed
      if (e.detail.status === 'deployed') {
        pollInterval = checkDeploymentAndPoll();
      } else {
        setLoading(false);
        setConnected(false);
        sessionStorage.setItem('wsConnected', 'false');
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
      sessionStorage.setItem('wsConnected', 'true');
      // Reset failure counter and restart polling if it was stopped
      consecutiveFailures.current = 0;
      if (!pollingIntervalRef.current && storageManager.getItem('deploymentStatus') === 'deployed') {
        pollingIntervalRef.current = setInterval(() => {
          if (document.hidden) return;
          if (storageManager.getItem('deploymentStatus') === 'deployed') {
            fetchStatus();
            fetchLogs();
          }
        }, 2000);
      }
      await fetchStatus();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, fetchLogs]);

  const disconnect = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiClient.disconnect();
      sessionStorage.setItem('wsConnected', 'false');
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
    try {
      const result = await apiClient.configure(config);
      return result;
    } catch (err) {
      console.error('updateConfig error:', err);
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
