import { useState, useEffect, useCallback } from 'react';
import { getBackendUrlFromSupabase } from '../utils/gitlab';
import { clearBackendUrl, getBackendUrl } from '../utils/backendUrl';
import { storageManager } from '../utils/storageManager';

/**
 * Custom hook to monitor deployment system status
 * Checks backend health directly — pipeline status no longer relevant
 * since Railway manages the backend lifecycle independently.
 */
export const useWorkflowMonitor = (showToast) => {
  const [isMonitoring, setIsMonitoring] = useState(false);

  const resetDeploymentState = useCallback((reason) => {
    storageManager.removeItem('deploymentStatus');
    storageManager.removeItem('pipelineId');
    clearBackendUrl();

    window.dispatchEvent(new CustomEvent('deploymentStatusChanged', {
      detail: { status: 'idle' }
    }));

    if (showToast) {
      showToast(
        `System closed unexpectedly. ${reason}. Please activate system again.`,
        'error'
      );
    }

    setIsMonitoring(false);
  }, [showToast]);

  const checkBackendHealth = useCallback(async () => {
    const backendUrl = getBackendUrl();
    if (!backendUrl) return;

    try {
      const res = await fetch(`${backendUrl}/api/health`, {
        method: 'GET',
        headers: {},
        signal: AbortSignal.timeout(10000)
      }).catch(err => {
        // Ignore abort errors
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
          return { ok: false, status: 408 };
        }
        throw err;
      });

      if (!res.ok) {
        // Backend responded but not healthy — could be restarting, don't reset yet
        console.warn(`Backend health check: HTTP ${res.status}`);
      }
    } catch (error) {
      // Silently handle abort errors
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return;
      }
      
      // Network error — backend might be down
      // Only reset if we get consistent failures (3 in a row)
      const failKey = '_healthFailCount';
      const failCount = parseInt(storageManager.getItem(failKey) || '0') + 1;
      storageManager.setItem(failKey, failCount.toString());

      if (failCount >= 3) {
        storageManager.removeItem(failKey);
        resetDeploymentState('Backend is not responding');
      }
      return;
    }

    // Reset fail counter on success
    storageManager.removeItem('_healthFailCount');
  }, [resetDeploymentState]);

  // Start monitoring when deployment is active
  useEffect(() => {
    const savedDeploymentStatus = storageManager.getItem('deploymentStatus');

    if (savedDeploymentStatus === 'deployed') {
      setIsMonitoring(true);
    }
  }, []);

  // Monitor backend health with polling
  useEffect(() => {
    if (!isMonitoring) return;

    // Check every 30 seconds (backend is stable on Railway, no need for aggressive polling)
    const monitorInterval = setInterval(() => {
      checkBackendHealth();
    }, 30000);

    return () => {
      clearInterval(monitorInterval);
    };
  }, [isMonitoring, checkBackendHealth]);

  const startMonitoring = useCallback(() => {
    storageManager.removeItem('_healthFailCount');
    setIsMonitoring(true);
  }, []);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    storageManager.removeItem('_healthFailCount');
  }, []);

  return {
    isMonitoring,
    startMonitoring,
    stopMonitoring,
  };
};
