import { supabase } from './supabase';
import rateLimiter from './rateLimiter';
import { validateUsername, validatePassword, detectSQLInjection } from './inputValidator';
import { storageManager } from './storageManager';

// Admin Registration
export async function registerAdmin(username, password) {
  try {
    // Rate limiting
    const rateCheck = rateLimiter.isAllowed('admin-signup', 3, 300000);
    if (!rateCheck.allowed) {
      return { 
        success: false, 
        error: `Too many attempts. Try again in ${rateCheck.remainingSeconds} seconds.` 
      };
    }

    rateLimiter.recordAttempt('admin-signup');

    // Validate inputs
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return { success: false, error: usernameValidation.error };
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }

    if (detectSQLInjection(username)) {
      return { success: false, error: 'Invalid characters detected' };
    }

    const { data, error } = await supabase.rpc('register_admin', {
      p_username: usernameValidation.value,
      p_password: password
    });

    if (error) throw error;

    if (data.success) {
      rateLimiter.reset('admin-signup');
      return { success: true, data: data };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Admin registration error:', error);
    return { success: false, error: error.message };
  }
}

// Admin Login
export async function loginAdmin(username, password) {
  try {
    // Rate limiting
    const rateCheck = rateLimiter.isAllowed('admin-login', 5, 60000);
    if (!rateCheck.allowed) {
      return { 
        success: false, 
        error: `Too many login attempts. Try again in ${rateCheck.remainingSeconds} seconds.` 
      };
    }

    rateLimiter.recordAttempt('admin-login');

    // Validate inputs
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return { success: false, error: 'Invalid credentials' };
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return { success: false, error: 'Invalid credentials' };
    }

    if (detectSQLInjection(username)) {
      return { success: false, error: 'Invalid characters detected' };
    }

    const { data, error } = await supabase.rpc('authenticate_admin', {
      p_username: usernameValidation.value,
      p_password: password
    });

    if (error) throw error;

    if (data.success) {
      // Store admin session in localStorage
      const adminSession = {
        admin_id: data.admin_id,
        username: data.username,
        session_token: data.session_token,
        expires_at: data.expires_at,
        login_time: new Date().toISOString()
      };
      storageManager.setItem('adminSession', JSON.stringify(adminSession));
      
      rateLimiter.reset('admin-login');
      return { success: true, data: adminSession };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Admin login error:', error);
    return { success: false, error: error.message };
  }
}

// Admin Logout
export function logoutAdmin() {
  storageManager.removeItem('adminSession');
}

// Get Admin Session
export function getAdminSession() {
  const sessionStr = storageManager.getItem('adminSession');
  if (!sessionStr) return null;

  try {
    const session = JSON.parse(sessionStr);
    const now = new Date();

    // Check server-provided expiry first
    if (session.expires_at) {
      if (now > new Date(session.expires_at)) {
        logoutAdmin();
        return null;
      }
    } else {
      // Fallback: 24-hour check from login_time (for sessions created before this update)
      const loginTime = new Date(session.login_time);
      const hoursDiff = (now - loginTime) / (1000 * 60 * 60);
      if (hoursDiff > 24) {
        logoutAdmin();
        return null;
      }
    }

    // Validate session has required fields
    if (!session.admin_id || !session.username || !session.session_token) {
      logoutAdmin();
      return null;
    }

    return session;
  } catch (error) {
    console.error('Error parsing admin session:', error);
    return null;
  }
}

// Check if Admin is Authenticated (local check only — use validateAdminSessionWithBackend for server-side)
export function isAdminAuthenticated() {
  return getAdminSession() !== null;
}

// Validate admin session with backend (server-side check)
export async function validateAdminSessionWithBackend() {
  const session = getAdminSession();
  if (!session || !session.session_token) {
    return { valid: false, reason: 'No admin session' };
  }

  try {
    const { data, error } = await supabase.rpc('validate_admin_session', {
      p_session_token: session.session_token
    });

    if (error) {
      console.error('Admin session validation error:', error);
      // Network error — don't logout, let caller decide
      throw error;
    }

    if (!data || !data.valid) {
      logoutAdmin();
      return { valid: false, reason: data?.error || 'Admin session invalid' };
    }

    return { valid: true };
  } catch (err) {
    // Re-throw so caller can distinguish network error from invalid session
    throw err;
  }
}
