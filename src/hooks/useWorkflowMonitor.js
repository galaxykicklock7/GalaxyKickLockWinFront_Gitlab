import { useState, useEffect, useCallback } from 'react';
import { getGitLabPipelineStatus } from '../utils/gitlab';
import { clearBackendUrl } from '../utils/backendUrl';
import { storageManager } from '../utils/storageManager';

/**
 * Custom hook to monitor deployment system status
 * Detects when backend deployment stops/crashes and auto-resets UI
 */
export const useWorkflowMonitor = (showToast) => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [deploymentId, setDeploymentId] = useState(null);

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
        `System closed unexpectedly. ${reason}. Please activate system again.`,
        'error'
      );
    }

    // Stop monitoring
    setIsMonitoring(false);
    setDeploymentId(null);
  }, [showToast]);

  const checkDeploymentStatus = useCallback(async () => {
    if (!deploymentId) return;

    try {
      const result = await getGitLabPipelineStatus(deploymentId);

      if (!result.success) {
        return;
      }

      // Check if deployment has stopped
      if (result.status === 'success' || result.status === 'failed' || result.status === 'canceled' || result.status === 'skipped') {
        // Deployment completed
        let reason = 'Deployment completed';

        if (result.status === 'success') {
          reason = 'System finished successfully';
        } else if (result.status === 'failed') {
          reason = 'System failed';
        } else if (result.status === 'canceled') {
          reason = 'System was cancelled';
        }

        resetDeploymentState(reason);
      }
    } catch (error) {
      // Silent error - don't expose system details
    }
  }, [deploymentId, resetDeploymentState]);

  // Start monitoring when deployment is active
  useEffect(() => {
    const savedDeploymentStatus = storageManager.getItem('deploymentStatus');
    const savedDeploymentId = storageManager.getItem('pipelineId');
    
    if (savedDeploymentStatus === 'deployed' && savedDeploymentId) {
      setDeploymentId(parseInt(savedDeploymentId));
      setIsMonitoring(true);
    }
  }, []);

  // Monitor deployment status with smart polling
  useEffect(() => {
    if (!isMonitoring || !deploymentId) return;

    // Check immediately
    checkDeploymentStatus();

    // Then check every 10 seconds
    const monitorInterval = setInterval(() => {
      checkDeploymentStatus();
    }, 10000); // 10 seconds

    return () => {
      clearInterval(monitorInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring, deploymentId]); // checkDeploymentStatus removed to prevent restart loop

  // Start monitoring manually (called after successful deployment)
  const startMonitoring = useCallback((runId) => {
    setDeploymentId(runId);
    setIsMonitoring(true);
  }, []);

  // Stop monitoring manually
  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setDeploymentId(null);
  }, []);

  return {
    isMonitoring,
    startMonitoring,
    stopMonitoring,
  };
};
