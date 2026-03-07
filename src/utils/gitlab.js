// Deployment system management utilities
// Uses Supabase Edge Functions with encrypted payloads

import { supabase } from './supabase';
import { securityManager } from './securityManager';
import { encryptPayload, decryptPayload } from './payloadCrypto';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Get clean username for Supabase lookup (lowercase, alphanumeric only)
 */
export const getCleanUsername = (username) => {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * Call a Supabase Edge Function with encrypted request/response
 */
const callEdgeFunction = async (functionName, body) => {
  try {
    const encrypted = await encryptPayload(body);

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'text/plain',
        },
        body: encrypted,
      }
    );

    const responseText = await response.text();

    // Always try to decrypt first, regardless of HTTP status
    let data;
    try {
      data = await decryptPayload(responseText);
    } catch (decryptError) {
      // Fallback: edge function may not encrypt yet, try plain JSON
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        // If both fail, log details and throw
        console.error('Failed to decrypt or parse response:', {
          functionName,
          httpStatus: response.status,
          responsePreview: responseText.substring(0, 100),
          decryptError: decryptError.message,
          parseError: parseError.message
        });
        
        // Return a structured error
        throw new Error(
          response.status === 500 
            ? 'Backend service error. Please try again or contact support.'
            : `Invalid response from ${functionName}`
        );
      }
    }

    // Now check if the operation was successful
    // Note: Even 500 errors may have encrypted error messages
    if (!data.success) {
      throw new Error(data.error || 'Service operation failed');
    }

    return data;
  } catch (error) {
    throw new Error(securityManager.sanitizeError(error));
  }
};

/**
 * ACTIVATE — Redeploy service via Edge Function
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
    securityManager.safeLog('error', 'Activation failed');
    return { success: false, error: securityManager.sanitizeError(error) };
  }
};

/**
 * DEACTIVATE — Stop deployment via Edge Function
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
    securityManager.safeLog('error', 'Deactivation failed');
    return { success: false, error: securityManager.sanitizeError(error) };
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
    securityManager.safeLog('error', 'Failed to fetch deployment');
    return { success: false, error: securityManager.sanitizeError(error) };
  }
};
