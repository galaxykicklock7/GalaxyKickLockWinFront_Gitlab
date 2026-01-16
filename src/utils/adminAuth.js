import { supabase } from './supabase';
import rateLimiter from './rateLimiter';
import { validateUsername, validatePassword, detectSQLInjection } from './inputValidator';

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
        login_time: new Date().toISOString()
      };
      localStorage.setItem('adminSession', JSON.stringify(adminSession));
      
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
  localStorage.removeItem('adminSession');
}

// Get Admin Session
export function getAdminSession() {
  const sessionStr = localStorage.getItem('adminSession');
  if (!sessionStr) return null;

  try {
    const session = JSON.parse(sessionStr);
    
    // Check if session is expired (24 hours)
    const loginTime = new Date(session.login_time);
    const now = new Date();
    const hoursDiff = (now - loginTime) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      logoutAdmin();
      return null;
    }
    
    return session;
  } catch (error) {
    console.error('Error parsing admin session:', error);
    return null;
  }
}

// Check if Admin is Authenticated
export function isAdminAuthenticated() {
  return getAdminSession() !== null;
}
