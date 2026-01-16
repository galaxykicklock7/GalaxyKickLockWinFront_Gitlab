// Client-side rate limiter for authentication endpoints
// Prevents spam attacks on login/signup

class RateLimiter {
  constructor() {
    // Initialize as Maps explicitly
    this.attempts = new Map();
    this.blocked = new Map();
  }

  // Check if action is allowed
  isAllowed(key, maxAttempts = 5, windowMs = 60000) {
    const now = Date.now();
    
    // Ensure blocked is a Map
    if (!(this.blocked instanceof Map)) {
      this.blocked = new Map();
    }
    
    // Check if blocked
    const blockUntil = this.blocked.get(key);
    if (blockUntil && now < blockUntil) {
      const remainingSeconds = Math.ceil((blockUntil - now) / 1000);
      return { allowed: false, remainingSeconds };
    }
    
    // Remove expired block
    if (blockUntil && now >= blockUntil) {
      this.blocked.delete(key);
    }

    // Ensure attempts is a Map
    if (!(this.attempts instanceof Map)) {
      this.attempts = new Map();
    }

    // Get attempt history
    const attemptHistory = this.attempts.get(key) || [];
    
    // Remove old attempts outside window
    const recentAttempts = attemptHistory.filter(time => now - time < windowMs);
    
    // Check if exceeded limit
    if (recentAttempts.length >= maxAttempts) {
      // Block for 5 minutes
      const newBlockUntil = now + 300000;
      this.blocked.set(key, newBlockUntil);
      return { allowed: false, remainingSeconds: 300 };
    }

    return { allowed: true };
  }

  // Record an attempt
  recordAttempt(key) {
    if (!(this.attempts instanceof Map)) {
      this.attempts = new Map();
    }
    
    const now = Date.now();
    const attemptHistory = this.attempts.get(key) || [];
    attemptHistory.push(now);
    this.attempts.set(key, attemptHistory);
  }

  // Reset attempts for a key (on successful login)
  reset(key) {
    if (this.attempts instanceof Map) {
      this.attempts.delete(key);
    }
    if (this.blocked instanceof Map) {
      this.blocked.delete(key);
    }
  }

  // Clear old data periodically
  cleanup() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour

    if (!(this.attempts instanceof Map)) {
      this.attempts = new Map();
    }
    if (!(this.blocked instanceof Map)) {
      this.blocked = new Map();
    }

    // Clean attempts
    for (const [key, attempts] of this.attempts.entries()) {
      const recentAttempts = attempts.filter(time => now - time < maxAge);
      if (recentAttempts.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, recentAttempts);
      }
    }

    // Clean blocks
    for (const [key, blockUntil] of this.blocked.entries()) {
      if (now >= blockUntil) {
        this.blocked.delete(key);
      }
    }
  }
}

// Singleton instance
const rateLimiter = new RateLimiter();

// Cleanup every 5 minutes
setInterval(() => rateLimiter.cleanup(), 300000);

export default rateLimiter;
