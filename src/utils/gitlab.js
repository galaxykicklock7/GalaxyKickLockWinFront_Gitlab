// Deployment system management utilities
// Uses Supabase Edge Functions to call Railway API directly (no GitLab CI middleman)

import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Get clean username for Supabase lookup (lowercase, alphanumeric only)
 */
export const getCleanUsername = (username) => {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * Call a Supabase Edge Function
 */
const callEdgeFunction = async (functionName, body) => {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || `Edge function ${functionName} failed`);
  }

  return data;
};

/**
 * ACTIVATE — Redeploy Railway service via Edge Function
 * Returns { success, backend_url, health, userId }
 */
export const activateBackend = async (username) => {
  try {
    if (!username) {
      throw new Error('Username is required.');
    }

    const userId = getCleanUsername(username);

    const result = await callEdgeFunction('railway-deploy', { user_id: userId });

    return {
      success: true,
      backend_url: result.backend_url,
      health: result.health,
      userId,
    };
  } catch (error) {
    return { success: false, error: error.message || 'Activation failed' };
  }
};

/**
 * DEACTIVATE — Stop Railway deployment via Edge Function
 * Returns { success }
 */
export const deactivateBackend = async (username) => {
  try {
    const userId = username ? getCleanUsername(username) : '';
    if (!userId) {
      throw new Error('Username is required.');
    }

    await callEdgeFunction('railway-stop', { user_id: userId });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Deactivation failed' };
  }
};

/**
 * Get backend URL from Supabase user_deployments table
 */
export const getBackendUrlFromSupabase = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('user_deployments')
      .select('backend_url, railway_service_id, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return { success: false, error: 'No active deployment found' };
    }

    return {
      success: true,
      url: data.backend_url,
      serviceId: data.railway_service_id
    };
  } catch (error) {
    return { success: false, error: 'Failed to fetch deployment URL' };
  }
};
