// GitLab Pipeline management utilities

const GITLAB_TOKEN = import.meta.env.VITE_GITLAB_TOKEN;
const GITLAB_PROJECT_ID = import.meta.env.VITE_GITLAB_PROJECT_ID;
const GITLAB_TRIGGER_TOKEN = import.meta.env.VITE_GITLAB_TRIGGER_TOKEN;
const GITLAB_API_URL = 'https://gitlab.com/api/v4';

// Validate environment variables
if (!GITLAB_TOKEN || !GITLAB_PROJECT_ID || !GITLAB_TRIGGER_TOKEN) {
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
 * Trigger GitLab pipeline deployment
 * @param {string} username - The logged-in username
 * @returns {Promise<{success: boolean, pipeline_id?: number, error?: string, subdomain?: string}>}
 */
export const triggerGitLabPipeline = async (username) => {
  try {
    // Validate configuration
    if (!GITLAB_TOKEN) {
      throw new Error('System configuration error. Please contact support.');
    }
    if (!GITLAB_PROJECT_ID) {
      throw new Error('System configuration error. Please contact support.');
    }

    if (!username) {
      throw new Error('Username is required to trigger pipeline.');
    }

    // Generate unique subdomain for this user
    const subdomain = generateUserSubdomain(username);

    // Try main branch first, then master if main fails
    const branches = ['main', 'master'];
    let lastError = null;

    for (const branch of branches) {
      try {
        // Use Pipeline API with personal access token and pass SUBDOMAIN variable
        const response = await fetch(
          `${GITLAB_API_URL}/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}/pipeline?ref=${branch}`,
          {
            method: 'POST',
            headers: {
              'PRIVATE-TOKEN': GITLAB_TOKEN,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              variables: [
                {
                  key: 'SUBDOMAIN',
                  value: subdomain,
                  variable_type: 'env_var'
                }
              ]
            })
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          
          // If it's a 400 with ref error, try next branch
          if (response.status === 400 && errorData.message?.ref) {
            lastError = new Error('System configuration error');
            continue;
          }
          
          // Provide generic error messages (no GitLab details)
          if (response.status === 403) {
            throw new Error('Access denied. Please contact support.');
          } else if (response.status === 404) {
            throw new Error('System configuration error. Please contact support.');
          } else if (response.status === 401) {
            throw new Error('Authentication failed. Please contact support.');
          } else if (response.status === 400) {
            throw new Error('Invalid request. Please contact support.');
          }
          
          throw new Error('System error occurred. Please try again.');
        }

        const data = await response.json();
        
        return {
          success: true,
          pipeline_id: data.id,
          subdomain: subdomain
        };
      } catch (error) {
        lastError = error;
        // If this is not a branch-related error, throw immediately
        if (!error.message?.includes('ref') && !error.message?.includes('branch') && !error.message?.includes('configuration')) {
          throw error;
        }
      }
    }

    // If we get here, all branches failed
    throw lastError || new Error('System activation failed. Please try again.');

  } catch (error) {
    return { success: false, error: error.message || 'System error occurred' };
  }
};

/**
 * Get pipeline status
 * @param {number} pipelineId - The pipeline ID
 * @returns {Promise<{success: boolean, status?: string, error?: string}>}
 */
export const getGitLabPipelineStatus = async (pipelineId) => {
  try {
    const response = await fetch(
      `${GITLAB_API_URL}/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}/pipelines/${pipelineId}`,
      {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
        }
      }
    );

    if (!response.ok) {
      return { success: false, error: 'System error' };
    }

    const data = await response.json();
    
    return {
      success: true,
      status: data.status,
      created_at: data.created_at,
      updated_at: data.updated_at
    };
  } catch (error) {
    return { success: false, error: 'System error' };
  }
};

/**
 * Get pipeline jobs
 * @param {number} pipelineId - The pipeline ID
 * @returns {Promise<{success: boolean, jobs?: array, error?: string}>}
 */
export const getGitLabPipelineJobs = async (pipelineId) => {
  try {
    const response = await fetch(
      `${GITLAB_API_URL}/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}/pipelines/${pipelineId}/jobs`,
      {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
        }
      }
    );

    if (!response.ok) {
      return { success: false, error: 'System error' };
    }

    const data = await response.json();
    
    return {
      success: true,
      jobs: data || []
    };
  } catch (error) {
    return { success: false, error: 'System error' };
  }
};

/**
 * Get pipeline job logs
 * @param {number} pipelineId - The pipeline ID
 * @returns {Promise<{success: boolean, logs?: string, error?: string}>}
 */
export const getGitLabPipelineJobLogs = async (pipelineId) => {
  try {
    // First get the jobs for this pipeline
    const jobsResult = await getGitLabPipelineJobs(pipelineId);
    
    if (!jobsResult.success || !jobsResult.jobs || jobsResult.jobs.length === 0) {
      return { success: false, error: 'No jobs found' };
    }

    // Find the running or most recent job
    const job = jobsResult.jobs.find(j => j.status === 'running') || jobsResult.jobs[0];
    
    if (!job) {
      return { success: false, error: 'No job found' };
    }

    // Get the job trace (logs)
    const response = await fetch(
      `${GITLAB_API_URL}/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}/jobs/${job.id}/trace`,
      {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
        }
      }
    );

    if (!response.ok) {
      return { success: false, error: 'Failed to fetch logs' };
    }

    const logs = await response.text();
    
    return {
      success: true,
      logs: logs
    };
  } catch (error) {
    return { success: false, error: 'Failed to fetch logs' };
  }
};

/**
 * Check if backend is ready by looking for specific message in logs
 * @param {number} pipelineId - The pipeline ID
 * @returns {Promise<{success: boolean, isReady?: boolean, error?: string}>}
 */
export const checkBackendReady = async (pipelineId) => {
  try {
    const logsResult = await getGitLabPipelineJobLogs(pipelineId);
    
    if (!logsResult.success) {
      return { success: false, error: logsResult.error };
    }

    // Check if logs contain the ready message
    const isReady = logsResult.logs.includes('Backend is ready but not connected');
    
    return {
      success: true,
      isReady: isReady
    };
  } catch (error) {
    return { success: false, error: 'Failed to check backend status' };
  }
};

/**
 * Cancel a running pipeline
 * @param {number} pipelineId - The pipeline ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const cancelGitLabPipeline = async (pipelineId) => {
  try {
    const response = await fetch(
      `${GITLAB_API_URL}/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}/pipelines/${pipelineId}/cancel`,
      {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
        }
      }
    );

    if (!response.ok) {
      return { success: false, error: 'Failed to stop system' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Failed to stop system' };
  }
};

/**
 * Get the latest running pipeline
 * @returns {Promise<number|null>}
 */
export const getLatestRunningGitLabPipeline = async () => {
  try {
    const response = await fetch(
      `${GITLAB_API_URL}/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}/pipelines?status=running&per_page=1`,
      {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data[0]?.id || null;
  } catch (error) {
    return null;
  }
};

/**
 * Poll pipeline until backend is ready
 * @param {number} pipelineId - The pipeline ID
 * @param {function} onProgress - Progress callback
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const pollGitLabPipelineUntilRunning = async (pipelineId, onProgress) => {
  const maxAttempts = 120; // 10 minutes max (5 seconds * 120)
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    // Get pipeline status
    const statusResult = await getGitLabPipelineStatus(pipelineId);
    
    if (!statusResult.success) {
      return { success: false, error: 'System error occurred' };
    }

    // Update progress
    if (onProgress) {
      onProgress({
        status: statusResult.status,
        attempt: attempts,
        maxAttempts
      });
    }

    // Check if pipeline failed
    if (statusResult.status === 'failed' || statusResult.status === 'canceled') {
      return { 
        success: false, 
        error: 'System activation failed. Please try again.' 
      };
    }

    // Check if pipeline is running
    if (statusResult.status === 'running') {
      // Check if backend is ready by looking at logs
      const backendReadyResult = await checkBackendReady(pipelineId);
      
      if (backendReadyResult.success && backendReadyResult.isReady) {
        return { success: true };
      }
    }

    // Wait 5 seconds before next check
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return { success: false, error: 'System activation timeout. Please try again.' };
};
