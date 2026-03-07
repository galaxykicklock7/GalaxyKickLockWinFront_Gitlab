import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Generate Token
export async function generateToken(durationMonths) {
  try {
    const { data, error } = await supabase.rpc('generate_token', {
      p_duration_months: durationMonths
    });

    if (error) throw error;

    if (data.success) {
      return { success: true, data: data };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Token generation error:', error);
    return { success: false, error: error.message };
  }
}

// Get Tokens by Duration
export async function getTokensByDuration(durationMonths) {
  try {
    const { data, error } = await supabase.rpc('get_tokens_by_duration', {
      p_duration_months: durationMonths
    });

    if (error) throw error;

    if (data.success) {
      return { success: true, tokens: data.tokens || [] };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Get tokens error:', error);
    return { success: false, error: error.message };
  }
}

// Get All Users
export async function getAllUsers() {
  try {
    const { data, error } = await supabase.rpc('get_all_users');

    if (error) throw error;

    if (data.success) {
      return { success: true, users: data.users || [] };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Get users error:', error);
    return { success: false, error: error.message };
  }
}

// Renew User Token
export async function renewUserToken(userId, durationMonths) {
  try {
    const { data, error } = await supabase.rpc('renew_user_token', {
      p_user_id: userId,
      p_duration_months: durationMonths
    });

    if (error) throw error;

    if (data.success) {
      return {
        success: true,
        token_value: data.token_value,
        expiry_date: data.expiry_date
      };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Token renewal error:', error);
    return { success: false, error: error.message };
  }
}

// Delete User
export async function deleteUser(userId) {
  try {
    const { data, error } = await supabase.rpc('delete_user', {
      p_user_id: userId
    });

    if (error) throw error;

    if (data.success) {
      return { 
        success: true, 
        message: data.message,
        sessions_invalidated: data.sessions_invalidated,
        token_deleted: data.token_deleted
      };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Delete user error:', error);
    return { success: false, error: error.message };
  }
}

// Delete Token
export async function deleteToken(tokenId) {
  try {
    const { data, error } = await supabase.rpc('delete_token', {
      p_token_id: tokenId
    });

    if (error) throw error;

    if (data.success) {
      return {
        success: true,
        message: data.message,
        sessions_invalidated: data.sessions_invalidated
      };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Delete token error:', error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────
// Railway Accounts (Multi-Account Support)
// ─────────────────────────────────────────────

// Get all Railway accounts for the admin
export async function getRailwayAccounts(adminId) {
  try {
    const { data, error } = await supabase
      .from('railway_accounts')
      .select('*')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return { success: true, accounts: data || [] };
  } catch (error) {
    console.error('Get Railway accounts error:', error);
    return { success: false, error: error.message };
  }
}

// Get a single Railway account by ID
export async function getAccountById(accountId) {
  try {
    const { data, error } = await supabase
      .from('railway_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Get account by ID error:', error);
    return { success: false, error: error.message };
  }
}

// Add a new Railway account
export async function addRailwayAccount(adminId, label, railwayApiToken, railwayProjectId) {
  try {
    const { data, error } = await supabase
      .from('railway_accounts')
      .insert({
        admin_id: adminId,
        label,
        railway_api_token: railwayApiToken,
        railway_project_id: railwayProjectId,
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Add Railway account error:', error);
    return { success: false, error: error.message };
  }
}

// Update an existing Railway account
export async function updateRailwayAccount(accountId, updates) {
  try {
    const { data, error } = await supabase
      .from('railway_accounts')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Update Railway account error:', error);
    return { success: false, error: error.message };
  }
}

// Delete a Railway account
export async function deleteRailwayAccount(accountId) {
  try {
    const { error } = await supabase
      .from('railway_accounts')
      .delete()
      .eq('id', accountId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Delete Railway account error:', error);
    return { success: false, error: error.message };
  }
}

// Get service count per Railway account
export async function getServiceCountsByAccount() {
  try {
    const { data, error } = await supabase
      .from('user_deployments')
      .select('railway_account_id');

    if (error) throw error;

    const counts = {};
    (data || []).forEach(row => {
      if (row.railway_account_id) {
        counts[row.railway_account_id] = (counts[row.railway_account_id] || 0) + 1;
      }
    });
    return { success: true, counts };
  } catch (error) {
    console.error('Get service counts error:', error);
    return { success: false, error: error.message };
  }
}

// Get all deployments linked to a specific Railway account
export async function getDeploymentsByAccountId(accountId) {
  try {
    const { data, error } = await supabase
      .from('user_deployments')
      .select('*')
      .eq('railway_account_id', accountId);

    if (error) throw error;
    return { success: true, deployments: data || [] };
  } catch (error) {
    console.error('Get deployments by account error:', error);
    return { success: false, error: error.message };
  }
}

// Update a single user_deployment row in-place (new service_id, backend_url, etc.)
export async function updateUserDeployment(userId, updates) {
  try {
    const { error } = await supabase
      .from('user_deployments')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Update user deployment error:', error);
    return { success: false, error: error.message };
  }
}

// Get live Railway service status via edge function
export async function getRailwayServiceStatus(railwayApiToken, railwayProjectId, serviceId) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/railway-status`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          railway_api_token: railwayApiToken,
          railway_project_id: railwayProjectId,
          service_id: serviceId,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to get service status');
    }

    return { success: true, status: data.status };
  } catch (error) {
    console.error('Get Railway service status error:', error);
    return { success: false, error: error.message };
  }
}

// Provision a Railway service for a token
export async function provisionRailwayService(railwayApiToken, railwayProjectId, serviceName) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/railway-provision`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          railway_api_token: railwayApiToken,
          railway_project_id: railwayProjectId,
          service_name: serviceName,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Provisioning failed');
    }

    return {
      success: true,
      service_id: data.service_id,
      service_name: data.service_name,
      backend_url: data.backend_url,
    };
  } catch (error) {
    console.error('Provision Railway service error:', error);
    return { success: false, error: error.message };
  }
}

// Save service mapping to user_deployments (links token to Railway service)
export async function saveServiceMapping(tokenId, serviceId, backendUrl, railwayAccountId = null) {
  try {
    // Use token_id as a temporary user_id placeholder until user signs up
    const row = {
      user_id: `token_${tokenId}`,
      railway_service_id: serviceId,
      backend_url: backendUrl,
      token_id: tokenId,
      status: 'stopped',
      updated_at: new Date().toISOString()
    };
    if (railwayAccountId) {
      row.railway_account_id = railwayAccountId;
    }

    const { error } = await supabase
      .from('user_deployments')
      .upsert(row, { onConflict: 'user_id' });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Save service mapping error:', error);
    return { success: false, error: error.message };
  }
}

// Delete Railway service
export async function deleteRailwayService(railwayApiToken, railwayProjectId, serviceId) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/railway-delete`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          railway_api_token: railwayApiToken,
          railway_project_id: railwayProjectId,
          service_id: serviceId,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete Railway service');
    }

    return { success: true };
  } catch (error) {
    console.error('Delete Railway service error:', error);
    return { success: false, error: error.message };
  }
}

// Get service info by user_id (clean username)
export async function getServiceByUserId(userId) {
  try {
    const { data, error } = await supabase
      .from('user_deployments')
      .select('railway_service_id, backend_url, status, token_id, railway_account_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return { success: true, data: data || null };
  } catch (error) {
    console.error('Get service by user error:', error);
    return { success: false, error: error.message };
  }
}

// Delete user_deployments row by user_id
export async function deleteUserDeployment(userId) {
  try {
    const { error } = await supabase
      .from('user_deployments')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Delete user deployment error:', error);
    return { success: false, error: error.message };
  }
}

// Get service info for a token
export async function getServiceByTokenId(tokenId) {
  try {
    const { data, error } = await supabase
      .from('user_deployments')
      .select('railway_service_id, backend_url, status, railway_account_id')
      .eq('token_id', tokenId)
      .maybeSingle();

    if (error) throw error;
    return { success: true, data: data || null };
  } catch (error) {
    console.error('Get service by token error:', error);
    return { success: false, error: error.message };
  }
}
