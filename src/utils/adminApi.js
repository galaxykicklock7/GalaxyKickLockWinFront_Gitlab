import { supabase } from './supabase';

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
