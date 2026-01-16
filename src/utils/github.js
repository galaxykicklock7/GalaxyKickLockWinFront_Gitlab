// Workflow management utilities

const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN;
const GITHUB_OWNER = import.meta.env.VITE_GITHUB_OWNER;
const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO;
const WORKFLOW_FILE = import.meta.env.VITE_GITHUB_WORKFLOW;

// Validate environment variables
if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO || !WORKFLOW_FILE) {
  // Missing configuration will be handled by the functions
}

/**
 * Generate a unique subdomain for the user
 * @param {string} username - The logged-in username
 * @returns {string} - Subdomain like "bharanitest007"
 */
const generateUserSubdomain = (username) => {
  // Generate 3-digit random number (000-999)
  const randomNumber = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  // Convert username to lowercase and remove special characters
  const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${cleanUsername}${randomNumber}`;
};

/**
 * Trigger workflow deployment
 * @param {string} username - The logged-in username
 * @returns {Promise<{success: boolean, run_id?: number, error?: string, subdomain?: string}>}
 */
export const triggerWorkflow = async (username) => {
  try {
    // Validate configuration
    if (!GITHUB_TOKEN) {
      throw new Error('System configuration error. Please contact support.');
    }
    if (!GITHUB_OWNER || !GITHUB_REPO || !WORKFLOW_FILE) {
      throw new Error('System configuration error. Please contact support.');
    }

    if (!username) {
      throw new Error('Username is required to trigger workflow.');
    }

    // Generate unique subdomain for this user
    const subdomain = generateUserSubdomain(username);

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main', // branch name
          inputs: {
            subdomain: subdomain // Pass the generated subdomain to workflow
          }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      // Provide helpful error messages
      if (response.status === 403) {
        throw new Error('Access denied. Please check your permissions or try again.');
      } else if (response.status === 404) {
        throw new Error('System configuration error. Please contact support.');
      } else if (response.status === 401) {
        throw new Error('Authentication failed. Please try again.');
      }
      
      throw new Error(errorData.message || `System error: ${response.status}`);
    }

    // Workflow dispatch returns 204 No Content on success
    // We need to fetch the latest run to get the run_id
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds for workflow to start

    const latestRun = await getLatestWorkflowRun();
    
    return {
      success: true,
      run_id: latestRun?.id,
      html_url: latestRun?.html_url,
      subdomain: subdomain
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Get the latest workflow run
 * @returns {Promise<object|null>}
 */
export const getLatestWorkflowRun = async () => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`System error: ${response.status}`);
    }

    const data = await response.json();
    return data.workflow_runs?.[0] || null;
  } catch (error) {
    return null;
  }
};

/**
 * Get workflow run status
 * @param {number} runId - The workflow run ID
 * @returns {Promise<{success: boolean, status?: string, conclusion?: string, error?: string}>}
 */
export const getWorkflowRunStatus = async (runId) => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`System error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      status: data.status, // queued, in_progress, completed
      conclusion: data.conclusion, // success, failure, cancelled, etc.
      html_url: data.html_url,
      created_at: data.created_at,
      updated_at: data.updated_at
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Get workflow run jobs
 * @param {number} runId - The workflow run ID
 * @returns {Promise<{success: boolean, jobs?: array, error?: string}>}
 */
export const getWorkflowRunJobs = async (runId) => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/jobs`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`System error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      jobs: data.jobs || []
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Check if workflow has reached "Keep running" stage
 * @param {number} runId - The workflow run ID
 * @returns {Promise<{success: boolean, isRunning?: boolean, error?: string}>}
 */
export const checkWorkflowKeepRunning = async (runId) => {
  try {
    const jobsResult = await getWorkflowRunJobs(runId);
    
    if (!jobsResult.success) {
      return { success: false, error: jobsResult.error };
    }

    // Check if any job has a step that indicates "Keep running"
    const hasKeepRunningStep = jobsResult.jobs.some(job => {
      return job.steps?.some(step => 
        step.name?.toLowerCase().includes('keep running') && 
        step.status === 'in_progress'
      );
    });

    return {
      success: true,
      isRunning: hasKeepRunningStep
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Cancel a running workflow
 * @param {number} runId - The workflow run ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const cancelWorkflowRun = async (runId) => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/cancel`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        }
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to cancel workflow: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Get the latest running workflow run ID
 * @returns {Promise<number|null>}
 */
export const getLatestRunningWorkflowId = async () => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=in_progress&per_page=1`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`System error: ${response.status}`);
    }

    const data = await response.json();
    return data.workflow_runs?.[0]?.id || null;
  } catch (error) {
    return null;
  }
};
export const pollWorkflowUntilRunning = async (runId, onProgress) => {
  const maxAttempts = 60; // 5 minutes max (5 seconds * 60)
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    // Get workflow status
    const statusResult = await getWorkflowRunStatus(runId);
    
    if (!statusResult.success) {
      return { success: false, error: statusResult.error };
    }

    // Update progress
    if (onProgress) {
      onProgress({
        status: statusResult.status,
        conclusion: statusResult.conclusion,
        attempt: attempts,
        maxAttempts
      });
    }

    // Check if workflow failed
    if (statusResult.status === 'completed' && statusResult.conclusion !== 'success') {
      return { 
        success: false, 
        error: `Deployment failed with status: ${statusResult.conclusion}` 
      };
    }

    // Check if workflow is in progress
    if (statusResult.status === 'in_progress') {
      // Check if it has reached "Keep running" stage
      const keepRunningResult = await checkWorkflowKeepRunning(runId);
      
      if (keepRunningResult.success && keepRunningResult.isRunning) {
        return { success: true };
      }
    }

    // Wait 5 seconds before next check
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return { success: false, error: 'Deployment timeout - workflow did not reach running stage' };
};
