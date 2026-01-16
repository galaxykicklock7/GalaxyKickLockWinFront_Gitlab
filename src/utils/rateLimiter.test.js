// Quick test for rate limiter
import rateLimiter from './rateLimiter.js';

console.log('Testing Rate Limiter...');

// Test 1: Should allow first attempt
const test1 = rateLimiter.isAllowed('test', 3, 60000);
console.log('Test 1 (first attempt):', test1); // Should be { allowed: true }

// Record attempts
rateLimiter.recordAttempt('test');
rateLimiter.recordAttempt('test');
rateLimiter.recordAttempt('test');

// Test 2: Should block after 3 attempts
const test2 = rateLimiter.isAllowed('test', 3, 60000);
console.log('Test 2 (after 3 attempts):', test2); // Should be { allowed: false, remainingSeconds: 300 }

// Test 3: Reset should clear
rateLimiter.reset('test');
const test3 = rateLimiter.isAllowed('test', 3, 60000);
console.log('Test 3 (after reset):', test3); // Should be { allowed: true }

console.log('Rate Limiter Tests Complete!');
