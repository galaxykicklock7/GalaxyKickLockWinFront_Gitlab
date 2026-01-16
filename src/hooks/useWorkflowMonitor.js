import { useState, useEffect, useCallback } from 'react';
import { getWorkflowRunStatus } from '../utils/github';
import { clearBackendUrl } from '../utils/backendUrl';
import { storageManager } from '../utils/storageManager';

/**
 * Custom hook to monitor GitHub workflow status
 * Detects when backend workflow stops/crashes and auto-resets UI
 */
export const useWorkflowMonitor = (showToast) => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [workflowRunId, setWorkflowRunId] = useState(null);

  const resetDeploymentState = useCallback((reason) => {
    // Clear deployment state using storage manager
    storageManager.removeItem('deploymentStatus');
    storageManager.removeItem('workflowRunId');
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
    setWorkflowRunId(null);
  }, [showToast]);

  const checkWorkflowStatus = useCallback(async () => {
    if (!workflowRunId) return;

    try {
      const result = await getWorkflowRunStatus(workflowRunId);

      if (!result.success) {
        return;
      }

      // Check if workflow has stopped
      if (result.status === 'completed') {
        // Workflow completed - could be success, failure, or cancelled
        let reason = 'Workflow completed';

        if (result.conclusion === 'success') {
          reason = 'Workflow finished successfully';
        } else if (result.conclusion === 'failure') {
          reason = 'Workflow failed';
        } else if (result.conclusion === 'cancelled') {
          reason = 'Workflow was cancelled';
        } else if (result.conclusion === 'timed_out') {
          reason = 'Workflow timed out';
        }

        resetDeploymentState(reason);
      }
    } catch (error) {
    }
  }, [workflowRunId, resetDeploymentState]);

  // Start monitoring when deployment is active
  useEffect(() => {
    const savedDeploymentStatus = storageManager.getItem('deploymentStatus');
    const savedRunId = storageManager.getItem('workflowRunId');
    
    if (savedDeploymentStatus === 'deployed' && savedRunId) {
      setWorkflowRunId(parseInt(savedRunId));
      setIsMonitoring(true);
    }
  }, []);

  // Monitor workflow status with smart polling
  useEffect(() => {
    if (!isMonitoring || !workflowRunId) return;

    // Check immediately
    checkWorkflowStatus();

    // Then check every 10 seconds (faster detection, still GitHub API friendly)
    const monitorInterval = setInterval(() => {
      checkWorkflowStatus();
    }, 10000); // 10 seconds

    return () => {
      clearInterval(monitorInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring, workflowRunId]); // checkWorkflowStatus removed to prevent restart loop

  // Start monitoring manually (called after successful deployment)
  const startMonitoring = useCallback((runId) => {
    setWorkflowRunId(runId);
    setIsMonitoring(true);
  }, []);

  // Stop monitoring manually
  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setWorkflowRunId(null);
  }, []);

  return {
    isMonitoring,
    startMonitoring,
    stopMonitoring,
  };
};
