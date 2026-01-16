import { useState, useEffect, useCallback } from 'react';
import { getGitLabPipelineStatus } from '../utils/gitlab';
import { clearBackendUrl } from '../utils/backendUrl';
import { storageManager } from '../utils/storageManager';

/**
 * Custom hook to monitor GitLab pipeline status
 * Detects when backend pipeline stops/crashes and auto-resets UI
 */
export const useWorkflowMonitor = (showToast) => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [pipelineId, setPipelineId] = useState(null);

  const resetDeploymentState = useCallback((reason) => {
    // Clear deployment state using storage manager
    storageManager.removeItem('deploymentStatus');
    storageManager.removeItem('pipelineId');
    storageManager.removeItem('backendSubdomain');
    clearBackendUrl();

    // Emit event to reset UI
    window.dispatchEvent(new CustomEvent('deploymentStatusChanged', {
      detail: { status: 'idle' }
    }));

    // Show toast notification
    if (showToast) {
      showToast(
        `Deployment closed unexpectedly. ${reason}. Please activate deployment again.`,
        'error'
      );
    }

    // Stop monitoring
    setIsMonitoring(false);
    setPipelineId(null);
  }, [showToast]);

  const checkPipelineStatus = useCallback(async () => {
    if (!pipelineId) return;

    try {
      const result = await getGitLabPipelineStatus(pipelineId);

      if (!result.success) {
        return;
      }

      // Check if pipeline has stopped
      if (result.status === 'success' || result.status === 'failed' || result.status === 'canceled' || result.status === 'skipped') {
        // Pipeline completed
        let reason = 'Pipeline completed';

        if (result.status === 'success') {
          reason = 'Pipeline finished successfully';
        } else if (result.status === 'failed') {
          reason = 'Pipeline failed';
        } else if (result.status === 'canceled') {
          reason = 'Pipeline was cancelled';
        }

        resetDeploymentState(reason);
      }
    } catch (error) {
      // Silent error - don't expose system details
    }
  }, [pipelineId, resetDeploymentState]);

  // Start monitoring when deployment is active
  useEffect(() => {
    const savedDeploymentStatus = storageManager.getItem('deploymentStatus');
    const savedPipelineId = storageManager.getItem('pipelineId');
    
    if (savedDeploymentStatus === 'deployed' && savedPipelineId) {
      setPipelineId(parseInt(savedPipelineId));
      setIsMonitoring(true);
    }
  }, []);

  // Monitor pipeline status with smart polling
  useEffect(() => {
    if (!isMonitoring || !pipelineId) return;

    // Check immediately
    checkPipelineStatus();

    // Then check every 10 seconds
    const monitorInterval = setInterval(() => {
      checkPipelineStatus();
    }, 10000); // 10 seconds

    return () => {
      clearInterval(monitorInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring, pipelineId]); // checkPipelineStatus removed to prevent restart loop

  // Start monitoring manually (called after successful deployment)
  const startMonitoring = useCallback((runId) => {
    setPipelineId(runId);
    setIsMonitoring(true);
  }, []);

  // Stop monitoring manually
  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setPipelineId(null);
  }, []);

  return {
    isMonitoring,
    startMonitoring,
    stopMonitoring,
  };
};
