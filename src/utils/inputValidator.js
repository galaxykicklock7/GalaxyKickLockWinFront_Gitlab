// Input validation and sanitization utilities

// Sanitize string input (prevent XSS)
export function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
}

// Validate username
export function validateUsername(username) {
  const sanitized = sanitizeString(username);
  
  if (!sanitized) {
    return { valid: false, error: 'Username is required' };
  }
  
  if (sanitized.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  
  if (sanitized.length > 50) {
    return { valid: false, error: 'Username must not exceed 50 characters' };
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  
  return { valid: true, value: sanitized };
}

// Validate password
export function validatePassword(password) {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }
  
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  
  if (password.length > 128) {
    return { valid: false, error: 'Password is too long' };
  }
  
  return { valid: true, value: password };
}

// Validate token
export function validateToken(token) {
  const sanitized = sanitizeString(token);
  
  if (!sanitized) {
    return { valid: false, error: 'Token is required' };
  }
  
  if (sanitized.length < 10) {
    return { valid: false, error: 'Invalid token format' };
  }
  
  if (sanitized.length > 200) {
    return { valid: false, error: 'Invalid token format' };
  }
  
  return { valid: true, value: sanitized };
}

// Validate email (if needed in future)
export function validateEmail(email) {
  const sanitized = sanitizeString(email);
  
  if (!sanitized) {
    return { valid: false, error: 'Email is required' };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized)) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  return { valid: true, value: sanitized };
}

// Detect potential SQL injection patterns
export function detectSQLInjection(input) {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /(--|;|\/\*|\*\/)/g,
    /(\bOR\b.*=.*)/gi,
    /(\bAND\b.*=.*)/gi,
    /('|")\s*(OR|AND)\s*('|")/gi
  ];
  
  return sqlPatterns.some(pattern => pattern.test(input));
}

// Validate and sanitize all inputs
export function validateAndSanitize(data) {
  const errors = [];
  const sanitized = {};
  
  // Check for SQL injection attempts
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && detectSQLInjection(value)) {
      errors.push(`Invalid characters detected in ${key}`);
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  // Sanitize each field
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return { valid: true, data: sanitized };
}
