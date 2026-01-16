import { supabase } from './supabase';
import rateLimiter from './rateLimiter';
import { validateUsername, validatePassword, validateToken, detectSQLInjection } from './inputValidator';
import { storageManager } from './storageManager';

/**
 * Register a new user
 * @param {string} username - Username (3-50 characters, alphanumeric, underscore, hyphen)
 * @param {string} password - Password (minimum 8 characters)
 * @param {string} confirmPassword - Password confirmation
 * @param {string} token - User token
 * @returns {Promise<{success: boolean, error?: string, data?: object}>}
 */
export const registerUser = async (username, password, confirmPassword, token) => {
  try {
    // Rate limiting check
    const rateCheck = rateLimiter.isAllowed('signup', 3, 300000); // 3 attempts per 5 minutes
    if (!rateCheck.allowed) {
      return { 
        success: false, 
        error: `Too many signup attempts. Please try again in ${rateCheck.remainingSeconds} seconds.` 
      };
    }

    // Record attempt
    rateLimiter.recordAttempt('signup');

    // Validate inputs
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return { success: false, error: usernameValidation.error };
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }

    const tokenValidation = validateToken(token);
    if (!tokenValidation.valid) {
      return { success: false, error: tokenValidation.error };
    }

    if (password !== confirmPassword) {
      return { success: false, error: 'Passwords do not match' };
    }

    // Check for SQL injection attempts
    if (detectSQLInjection(username) || detectSQLInjection(token)) {
      return { success: false, error: 'Invalid characters detected' };
    }

    const trimmedUsername = usernameValidation.value;
    const trimmedToken = tokenValidation.value;

    // Call Supabase function to register user
    const { data, error } = await supabase.rpc('register_user', {
      p_username: trimmedUsername,
      p_password: password,
      p_token_value: trimmedToken,
    });

    if (error) {
      console.error('Registration error:', error);

      // Provide user-friendly error messages
      if (error.message.includes('duplicate') || error.message.includes('already exists')) {
        return { success: false, error: 'Username already taken. Please choose another.' };
      }
      if (error.message.includes('token')) {
        return { success: false, error: 'Invalid or expired access token' };
      }

      return { success: false, error: 'Registration failed. Please try again.' };
    }

    if (!data.success) {
      // Handle specific error messages from the database function
      const errorMsg = data.error || 'Registration failed';

      if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
        return { success: false, error: 'Username already taken. Please choose another.' };
      }
      if (errorMsg.includes('token') && errorMsg.includes('not found')) {
        return { success: false, error: 'Invalid access token. Please check and try again.' };
      }
      if (errorMsg.includes('token') && errorMsg.includes('used')) {
        return { success: false, error: 'This access token has already been used' };
      }
      if (errorMsg.includes('expired')) {
        return { success: false, error: 'Access token has expired' };
      }

      return { success: false, error: errorMsg };
    }

    // Success - reset rate limiter
    rateLimiter.reset('signup');

    return { success: true, data };
  } catch (err) {
    console.error('Registration exception:', err);

    if (err.message.includes('fetch') || err.message.includes('network')) {
      return { success: false, error: 'Unable to connect to server. Please check your internet connection.' };
    }

    return { success: false, error: 'An unexpected error occurred. Please try again.' };
  }
};

/**
 * Authenticate user (login)
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<{success: boolean, error?: string, data?: object}>}
 */
export const loginUser = async (username, password) => {
  try {
    // Rate limiting check
    const rateCheck = rateLimiter.isAllowed('login', 5, 60000); // 5 attempts per minute
    if (!rateCheck.allowed) {
      return { 
        success: false, 
        error: `Too many login attempts. Please try again in ${rateCheck.remainingSeconds} seconds.` 
      };
    }

    // Record attempt
    rateLimiter.recordAttempt('login');

    // Validate inputs
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return { success: false, error: 'Invalid username or password' }; // Don't reveal specific error
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return { success: false, error: 'Invalid username or password' }; // Don't reveal specific error
    }

    // Check for SQL injection attempts
    if (detectSQLInjection(username)) {
      return { success: false, error: 'Invalid characters detected' };
    }

    const trimmedUsername = usernameValidation.value;

    // Call Supabase function to authenticate user
    const { data, error } = await supabase.rpc('authenticate_user', {
      p_username: trimmedUsername,
      p_password: password,
    });

    if (error) {
      console.error('Login error:', error);

      // Don't reveal specific details for security
      return { success: false, error: 'Invalid username or password' };
    }

    if (!data || !data.success) {
      const errorMsg = data?.error || 'Login failed';

      // Pass through admin-related messages
      if (errorMsg.includes('removed by admin') || errorMsg.includes('contact admin')) {
        return { success: false, error: errorMsg };
      }
      if (errorMsg.includes('deactivated by admin')) {
        return { success: false, error: errorMsg };
      }

      // Provide user-friendly messages without revealing too much
      if (errorMsg.includes('not found') || errorMsg.includes('invalid')) {
        return { success: false, error: 'Invalid username or password' };
      }
      if (errorMsg.includes('expired')) {
        return { success: false, error: 'Your subscription has expired. Please contact support.' };
      }
      if (errorMsg.includes('inactive')) {
        return { success: false, error: 'Account is inactive. Please contact support.' };
      }

      return { success: false, error: 'Login failed. Please try again.' };
    }

    // Validate required session data
    if (!data.user_id || !data.username || !data.session_token) {
      console.error('Invalid session data received');
      return { success: false, error: 'Login failed. Invalid session data.' };
    }

    // Store session using universal storage manager
    const session = {
      user_id: data.user_id,
      username: data.username,
      subscription_months: data.subscription_months,
      token_expiry_date: data.token_expiry_date,
      session_token: data.session_token,
      session_id: data.session_id,
      expires_at: data.expires_at,
      login_time: new Date().toISOString(),
    };

    // Use storage manager for cross-platform compatibility
    const stored = storageManager.setItem('galaxyKickLockSession', session);
    
    if (!stored) {
      console.error('Failed to store session in any storage location');
      const diagnostics = storageManager.getDiagnostics();
      console.error('Storage diagnostics:', diagnostics);
      return { 
        success: false, 
        error: 'Unable to save session. Please enable cookies and storage in your browser settings.' 
      };
    }

    // Success - reset rate limiter
    rateLimiter.reset('login');

    return { success: true, data: session };
  } catch (err) {
    console.error('Login exception:', err);

    if (err.message.includes('fetch') || err.message.includes('network')) {
      return { success: false, error: 'Unable to connect to server. Please check your internet connection.' };
    }

    return { success: false, error: 'An unexpected error occurred. Please try again.' };
  }
};

/**
 * Logout user (invalidates current session)
 */
export const logoutUser = async () => {
  try {
    const session = getSession();
    if (session && session.session_token) {
      // Call backend to invalidate session
      await supabase.rpc('logout_user', {
        p_session_token: session.session_token
      });
    }
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    // Always clear all storage locations using storage manager
    storageManager.removeItem('galaxyKickLockSession');
    storageManager.removeItem('galaxyKickLockConfig');
  }
};

/**
 * Logout from all sessions (all devices)
 */
export const logoutAllSessions = async () => {
  try {
    const session = getSession();
    if (session && session.user_id) {
      const { data, error } = await supabase.rpc('logout_all_sessions', {
        p_user_id: session.user_id
      });

      if (error) throw error;

      // Clear all storage locations using storage manager
      storageManager.removeItem('galaxyKickLockSession');
      storageManager.removeItem('galaxyKickLockConfig');

      return { success: true, data };
    }
    return { success: false, error: 'No active session' };
  } catch (error) {
    console.error('Logout all sessions error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get current session
 * @returns {object|null} Session object or null if not logged in
 */
export const getSession = () => {
  try {
    // Use universal storage manager to retrieve session
    const sessionStr = storageManager.getItem('galaxyKickLockSession');
    
    if (!sessionStr) return null;

    const session = JSON.parse(sessionStr);

    // Validate session structure
    if (!session.user_id || !session.username || !session.session_token) {
      console.warn('Invalid session structure, clearing session');
      logoutUser();
      return null;
    }

    // NO AUTOMATIC EXPIRY CHECKS
    // Session persists until manual logout or admin revocation
    // This prevents unexpected logouts on mobile devices
    
    // Optional: Log warnings but don't logout
    const loginTime = new Date(session.login_time);
    const now = new Date();
    const hoursSinceLogin = (now - loginTime) / (1000 * 60 * 60);

    if (hoursSinceLogin > 24) {
      console.warn('Session is older than 24 hours, but keeping active');
    }

    if (session.token_expiry_date) {
      const expiryDate = new Date(session.token_expiry_date);
      if (now > expiryDate) {
        console.warn('Token expiry date passed, but keeping session active');
      }
    }

    return session;
  } catch (err) {
    console.error('Error getting session:', err);
    // Don't logout on error - could be JSON parse issue
    // Just return null and let user try again
    return null;
  }
};

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export const isAuthenticated = () => {
  return getSession() !== null;
};

/**
 * Validate session with backend
 * @returns {Promise<{valid: boolean, reason?: string, error?: string}>}
 */
export const validateSessionWithBackend = async () => {
  try {
    const session = getSession();
    if (!session || !session.session_token) {
      return { valid: false, reason: 'Session expired' };
    }

    const { data, error } = await supabase.rpc('validate_session', {
      p_session_token: session.session_token
    });

    if (error) {
      console.error('Session validation error:', error);
      // DON'T logout on error - could be network issue
      // Let the caller decide what to do
      throw error; // Throw so App.jsx can catch and handle
    }

    if (!data || !data.valid) {
      // Session is invalid on backend - this is a real invalidation
      console.warn('Session validation failed:', data?.error || 'Session invalid');
      
      // Check if user was deleted by admin
      if (data?.user_deleted) {
        return { valid: false, reason: 'Your account has been removed by admin' };
      }
      
      // Check if it's a token revocation
      if (data?.token_deleted || data?.token_invalid) {
        return { valid: false, reason: 'Your access has been revoked by admin' };
      }
      
      // Use custom reason if provided
      if (data?.reason) {
        return { valid: false, reason: data.reason };
      }
      
      return { valid: false, reason: 'Session expired' };
    }

    return { valid: true };
  } catch (err) {
    console.error('Session validation exception:', err);
    // DON'T logout on exception - could be network issue
    // Throw the error so App.jsx can catch and handle
    throw err;
  }
};

/**
 * Validate session with backend
 * @returns {Promise<boolean>}
 */
export const validateSession = async () => {
  try {
    const session = getSession();
    if (!session) return false;

    const { data, error } = await supabase.rpc('validate_session', {
      p_username: session.username,
      p_session_token: session.session_token,
    });

    if (error || !data) {
      logoutUser();
      return false;
    }

    return data;
  } catch (err) {
    console.error('Session validation error:', err);
    logoutUser();
    return false;
  }
};
