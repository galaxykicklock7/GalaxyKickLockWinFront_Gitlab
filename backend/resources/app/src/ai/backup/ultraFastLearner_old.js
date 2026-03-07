/**
 * Ultra-Fast AI Learning Engine
 * 
 * Conservative Learning Strategy (mimics human gameplay):
 * - Small, gradual adjustments (5-15ms typically)
 * - Larger jumps only when really stuck
 * - Respects the importance of millisecond precision
 * 
 * Result meanings:
 * - 3S_ERROR: Tried to kick too early → Increase timing (wait longer)
 * - SUCCESS: Caught rival → Decrease timing slightly (try to catch earlier)
 * - FAILURE: Rival escaped → Timing might be too slow OR rival left
 * 
 * Features:
 * - Context detection (FAST/NORMAL/SLOW based on ping)
 * - Pattern detection (predictable vs unpredictable)
 * - Bounded learning (1600-2100ms range)
 * - Conservative adjustments (precision matters)
 */

const { createClient } = require('@supabase/supabase-js');

// Timing bounds (safe operating range)
const MIN_TIMING = 1600;
const MAX_TIMING = 2100;

// Smart defaults based on testing (used only as fallback)
const SMART_DEFAULTS = {
    attack: 1950,
    defense: 1920
};

class UltraFastLearner {
    constructor(userId, connectionNumber, supabaseUrl, supabaseKey, getCurrentPingFn, getContextFromPingFn) {
        this.userId = userId;
        this.connectionNumber = connectionNumber;
        this.supabase = createClient(supabaseUrl, supabaseKey);
        
        // Ping and context functions (passed from GameLogic)
        this.getCurrentPing = getCurrentPingFn;
        this.getContextFromPing = getContextFromPingFn;
        
        // Current state
        this.currentTiming = null;
        this.attemptCount = 0;
        
        // Learning history (in-memory for speed)
        this.history = [];
        
        // Separate tracking for attack/defense
        this.attackTiming = null;
        this.defenseTiming = null;
        this.attackHistory = [];
        this.defenseHistory = [];
        this.attackAttemptCount = 0;
        this.defenseAttemptCount = 0;
        
        // Personal stats cache
        this.personalStats = {};
        
        console.log(`🧠 AI Core initialized for user ${userId}, connection ${connectionNumber} (context-aware)`);
    }
    
    /**
     * Get optimal timing (3-layer approach with context awareness)
     */
    async getOptimalTiming(timingType) {
        // Get current context from ping
        const context = this.getContextFromPing ? this.getContextFromPing() : 'NORMAL';
        const ping = this.getCurrentPing ? this.getCurrentPing() : null;
        
        console.log(`🎯 Getting optimal timing for ${timingType} (context: ${context}, ping: ${ping}ms)...`);
        
        // Layer 1: Personal history (context-aware)
        const personalOptimal = await this.getPersonalOptimal(timingType, context);
        if (personalOptimal) {
            this.currentTiming = personalOptimal.optimal_timing;
            console.log(`📊 Using personal history: ${this.currentTiming}ms (${personalOptimal.success_rate}% success, ${personalOptimal.total_attempts} attempts, context: ${context})`);
            return this.currentTiming;
        }
        
        // Layer 2: Transfer learning (context-aware)
        const transferOptimal = await this.getTransferLearningOptimal(timingType, context);
        if (transferOptimal) {
            this.currentTiming = transferOptimal.optimal_timing;
            console.log(`📚 Using transfer learning: ${this.currentTiming}ms (from ${transferOptimal.user_count} users, ${transferOptimal.total_attempts} attempts, context: ${context})`);
            return this.currentTiming;
        }
        
        // Layer 3: Smart defaults (no context needed - fallback only)
        this.currentTiming = SMART_DEFAULTS[timingType];
        console.log(`🎯 Using smart default: ${this.currentTiming}ms (no data for context: ${context})`);
        return this.currentTiming;
    }
    
    /**
     * Get personal optimal from database (context-aware)
     */
    async getPersonalOptimal(timingType, context) {
        try {
            const { data, error } = await this.supabase.rpc('ai_get_personal_optimal', {
                p_user_id: this.userId,
                p_connection_number: this.connectionNumber,
                p_context: context, // Use actual measured context
                p_timing_type: timingType
            });
            
            if (error) {
                console.error('[AI] Error getting personal optimal:', error);
                return null;
            }
            
            if (data && data.success) {
                return data;
            }
            
            return null;
        } catch (error) {
            console.error('[AI] Exception getting personal optimal:', error);
            return null;
        }
    }
    
    /**
     * Get transfer learning optimal from database (context-aware)
     */
    async getTransferLearningOptimal(timingType, context) {
        try {
            const { data, error } = await this.supabase.rpc('ai_get_transfer_learning_optimal', {
                p_context: context, // Use actual measured context
                p_timing_type: timingType
            });
            
            if (error) {
                console.error('[AI] Error getting transfer learning optimal:', error);
                return null;
            }
            
            if (data && data.success) {
                return data;
            }
            
            return null;
        } catch (error) {
            console.error('[AI] Exception getting transfer learning optimal:', error);
            return null;
        }
    }
    
    /**
     * Apply bounds to timing (keep within safe range)
     */
    applyBounds(timing) {
        if (timing < MIN_TIMING) {
            console.log(`⚠️ Timing ${timing}ms below minimum, clamping to ${MIN_TIMING}ms`);
            return MIN_TIMING;
        }
        if (timing > MAX_TIMING) {
            console.log(`⚠️ Timing ${timing}ms above maximum, clamping to ${MAX_TIMING}ms`);
            return MAX_TIMING;
        }
        return timing;
    }
    
    /**
     * Get next timing based on result (Conservative Learning)
     * Mimics human gameplay: small adjustments, precision matters
     */
    getNextTiming(lastResult, timingType) {
        this.attemptCount++;
        
        // Get current context for adaptive learning
        const currentContext = this.getContextFromPing ? this.getContextFromPing() : 'NORMAL';
        const currentPing = this.getCurrentPing ? this.getCurrentPing() : null;
        
        // Track separately for attack/defense
        if (timingType === 'attack') {
            this.attackAttemptCount++;
            this.attackHistory.push({
                timing: this.currentTiming,
                result: lastResult,
                attempt: this.attackAttemptCount,
                context: currentContext,
                ping: currentPing
            });
        } else {
            this.defenseAttemptCount++;
            this.defenseHistory.push({
                timing: this.currentTiming,
                result: lastResult,
                attempt: this.defenseAttemptCount,
                context: currentContext,
                ping: currentPing
            });
        }
        
        // Record to combined history
        this.history.push({
            timing: this.currentTiming,
            result: lastResult,
            attempt: this.attemptCount,
            type: timingType,
            context: currentContext,
            ping: currentPing
        });
        
        console.log(`🔄 Attempt ${this.attemptCount} (${timingType}): ${this.currentTiming}ms → ${lastResult} [${currentContext}, ${currentPing}ms]`);
        
        // Get type-specific attempt count
        const typeAttemptCount = timingType === 'attack' ? this.attackAttemptCount : this.defenseAttemptCount;
        const typeHistory = timingType === 'attack' ? this.attackHistory : this.defenseHistory;
        
        // 🆕 EVERY 10 ATTEMPTS: Re-query database for better timing
        if (this.attemptCount % 10 === 0) {
            console.log(`📊 Attempt ${this.attemptCount}: Triggering database re-query for better timing...`);
            this.shouldRequeryDatabase = true;
            this.requeryTimingType = timingType;
        }
        
        // Check for stuck state (only after 10+ attempts)
        if (typeAttemptCount >= 10 && this.isStuck(typeHistory, typeAttemptCount)) {
            return this.escapeStuck(typeHistory, timingType, currentContext, currentPing);
        }
        
        // Use conservative learning for all phases
        return this.conservativeLearning(lastResult, typeHistory, currentContext, currentPing);
    }
    
    /**
     * Calculate context-aware adjustment factor
     * FAST context (low ping) → smaller adjustments (more precise)
     * SLOW context (high ping) → larger adjustments (more variance)
     */
    getContextAdjustmentFactor(context) {
        switch (context) {
            case 'FAST':
                return 0.7;  // 30% smaller adjustments (more stable)
            case 'SLOW':
                return 1.3;  // 30% larger adjustments (more variance)
            default:
                return 1.0;  // Normal adjustments
        }
    }
    
    /**
     * Detect opponent behavior pattern from recent history
     * Returns: 'predictable' (consistent timing), 'unpredictable' (variable timing), or 'unknown'
     * 
     * NOTE: This doesn't detect if opponent is bot/human - it detects behavior patterns.
     * A bot can be unpredictable (randomized), a human can be predictable (consistent).
     * What matters is: Can we find a stable timing window?
     */
    detectOpponentPattern(typeHistory) {
        if (typeHistory.length < 5) return 'unknown';
        
        // Analyze last 10 attempts
        const recentAttempts = typeHistory.slice(-10);
        
        // Calculate timing variance
        const timings = recentAttempts.map(h => h.timing);
        const avgTiming = timings.reduce((sum, t) => sum + t, 0) / timings.length;
        const variance = timings.reduce((sum, t) => sum + Math.pow(t - avgTiming, 2), 0) / timings.length;
        const stdDev = Math.sqrt(variance);
        
        // Calculate result consistency
        const successCount = recentAttempts.filter(h => h.result === 'SUCCESS').length;
        const errorCount = recentAttempts.filter(h => h.result === '3S_ERROR').length;
        const failureCount = recentAttempts.length - successCount - errorCount;
        
        // Predictable pattern: Low variance + consistent results
        // This means there's a stable timing window we can exploit
        if (stdDev < 50 && (successCount > 6 || errorCount > 6)) {
            console.log(`🎯 Opponent pattern: PREDICTABLE (low variance: ${stdDev.toFixed(1)}ms, consistent results)`);
            return 'predictable';
        }
        
        // Unpredictable pattern: High variance + mixed results
        // This means timing window is unstable, need adaptive approach
        if (stdDev > 100 || (successCount > 2 && errorCount > 2 && failureCount > 2)) {
            console.log(`� Opponent pattern: UNPREDICTABLE (high variance: ${stdDev.toFixed(1)}ms, mixed results)`);
            return 'unpredictable';
        }
        
        console.log(`❓ Opponent pattern: UNKNOWN (variance: ${stdDev.toFixed(1)}ms)`);
        return 'unknown';
    }
    
    /**
     * Phase 1: Aggressive binary search with context awareness
     */
    aggressiveBinarySearch(result, context, ping) {
        const contextFactor = this.getContextAdjustmentFactor(context);
        
        if (result === '3S_ERROR') {
            // Too fast → Jump up (adjusted by context)
            const adjustment = Math.round(100 * contextFactor);
            this.currentTiming += adjustment;
            console.log(`⬆️ Binary search: Too fast (3S error), jumping to ${this.currentTiming}ms (+${adjustment}ms) [${context}]`);
        } else if (result === 'SUCCESS') {
            // Success → Try faster (adjusted by context)
            const adjustment = Math.round(50 * contextFactor);
            this.currentTiming -= adjustment;
            console.log(`⬇️ Binary search: Success, trying ${this.currentTiming}ms (-${adjustment}ms) [${context}]`);
        } else {
            // FAILURE → Rival escaped, try faster (adjusted by context)
            const adjustment = Math.round(30 * contextFactor);
            this.currentTiming -= adjustment;
            console.log(`⬇️ Binary search: Failure (rival escaped), trying faster ${this.currentTiming}ms (-${adjustment}ms) [${context}]`);
        }
        
        // Apply bounds
        this.currentTiming = this.applyBounds(this.currentTiming);
        return this.currentTiming;
    }
    
    /**
     * Phase 2: Fine-tuning with context awareness and pattern detection
     */
    fineTuning(result, typeHistory, context, ping) {
        const contextFactor = this.getContextAdjustmentFactor(context);
        const opponentPattern = this.detectOpponentPattern(typeHistory);
        
        // Calculate recent success rate (use last 5 attempts)
        const recentAttempts = typeHistory.slice(-5);
        const successCount = recentAttempts.filter(h => h.result === 'SUCCESS').length;
        const errorCount = recentAttempts.filter(h => h.result === '3S_ERROR').length;
        const failureCount = recentAttempts.length - successCount - errorCount;
        const successRate = successCount / recentAttempts.length;
        
        console.log(`📊 Recent: ${successCount} success, ${errorCount} 3S errors, ${failureCount} failures (${(successRate * 100).toFixed(1)}% success) [${context}, ${opponentPattern}]`);
        
        // Pattern-specific adjustments
        let patternFactor = 1.0;
        if (opponentPattern === 'predictable') {
            // Predictable pattern → smaller, more precise adjustments
            patternFactor = 0.8;
            console.log(`🎯 Predictable pattern: Using precise adjustments (factor: ${patternFactor})`);
        } else if (opponentPattern === 'unpredictable') {
            // Unpredictable pattern → larger adjustments to find sweet spot
            patternFactor = 1.2;
            console.log(`� Unpredictable pattern: Using adaptive adjustments (factor: ${patternFactor})`);
        }
        
        // Combined adjustment factor
        const totalFactor = contextFactor * patternFactor;
        
        // Decision based on result types
        if (errorCount > successCount) {
            // More 3S errors than successes → timing too fast → go slower
            const adjustment = Math.round(40 * totalFactor);
            this.currentTiming += adjustment;
            console.log(`⬆️ Fine-tuning: Too many 3S errors, increasing to ${this.currentTiming}ms (+${adjustment}ms)`);
        } else if (successRate >= 0.60) {
            // Good success rate (60%+) → Try going slightly faster
            const adjustment = Math.round(20 * totalFactor);
            this.currentTiming -= adjustment;
            console.log(`⬇️ Fine-tuning: Good rate (${(successRate * 100).toFixed(1)}%), trying ${this.currentTiming}ms (-${adjustment}ms)`);
        } else if (failureCount > successCount) {
            // More failures than successes → timing might be too slow → go faster
            const adjustment = Math.round(30 * totalFactor);
            this.currentTiming -= adjustment;
            console.log(`⬇️ Fine-tuning: Too many failures, trying faster ${this.currentTiming}ms (-${adjustment}ms)`);
        } else {
            // Mixed results → small increase for safety
            const adjustment = Math.round(20 * totalFactor);
            this.currentTiming += adjustment;
            console.log(`⬆️ Fine-tuning: Mixed results, increasing to ${this.currentTiming}ms (+${adjustment}ms)`);
        }
        
        // Apply bounds
        this.currentTiming = this.applyBounds(this.currentTiming);
        return this.currentTiming;
    }
    
    /**
     * Phase 3: Micro-adjustments with context and pattern awareness
     */
    microAdjustment(result, typeHistory, context, ping) {
        const contextFactor = this.getContextAdjustmentFactor(context);
        const opponentPattern = this.detectOpponentPattern(typeHistory);
        
        // Pattern-specific adjustments
        let patternFactor = 1.0;
        if (opponentPattern === 'predictable') {
            patternFactor = 0.7;  // Predictable: very precise adjustments
        } else if (opponentPattern === 'unpredictable') {
            patternFactor = 1.3;  // Unpredictable: larger adjustments for variance
        }
        
        const totalFactor = contextFactor * patternFactor;
        
        if (result === '3S_ERROR') {
            // 3S error → timing too fast → increase
            const adjustment = Math.round(25 * totalFactor);
            this.currentTiming += adjustment;
            console.log(`⬆️ Micro-adjust: 3S error, ${this.currentTiming}ms (+${adjustment}ms) [${context}, ${opponentPattern}]`);
        } else if (result === 'SUCCESS') {
            // Success → try slightly faster (but conservatively)
            const adjustment = Math.round(10 * totalFactor);
            this.currentTiming -= adjustment;
            console.log(`⬇️ Micro-adjust: Success, ${this.currentTiming}ms (-${adjustment}ms) [${context}, ${opponentPattern}]`);
        } else {
            // FAILURE → Rival escaped, timing might be too slow → go faster
            const adjustment = Math.round(20 * totalFactor);
            this.currentTiming -= adjustment;
            console.log(`⬇️ Micro-adjust: Failure (rival escaped), ${this.currentTiming}ms (-${adjustment}ms) [${context}, ${opponentPattern}]`);
        }
        
        // Apply bounds
        this.currentTiming = this.applyBounds(this.currentTiming);
        return this.currentTiming;
    }
    
    /**
     * Detect if we're stuck (many attempts, low success) - IMPROVED
     */
    isStuck(typeHistory, typeAttemptCount) {
        // Need at least 5 attempts (reduced from 6 for faster detection)
        if (typeAttemptCount < 5) return false;
        
        // Check last 5 attempts
        const recentAttempts = typeHistory.slice(-5);
        const successCount = recentAttempts.filter(h => h.result === 'SUCCESS').length;
        const successRate = successCount / recentAttempts.length;
        
        // Stuck if < 20% success (0-1 successes out of 5) - slightly more lenient
        return successRate < 0.20;
    }
    
    /**
     * Escape stuck state with context and pattern awareness
     */
    escapeStuck(typeHistory, timingType, context, ping) {
        console.log(`🚨 STUCK DETECTED for ${timingType}! Attempting aggressive adjustment...`);
        
        const contextFactor = this.getContextAdjustmentFactor(context);
        const opponentPattern = this.detectOpponentPattern(typeHistory);
        
        // Calculate recent average (use last 5 attempts)
        const recentAttempts = typeHistory.slice(-5);
        const recentAvg = recentAttempts.reduce((sum, h) => sum + h.timing, 0) / recentAttempts.length;
        
        // Count error types
        const errorCount = recentAttempts.filter(h => h.result === '3S_ERROR').length;
        const successCount = recentAttempts.filter(h => h.result === 'SUCCESS').length;
        const failureCount = recentAttempts.length - errorCount - successCount;
        
        console.log(`📊 Stuck analysis: ${errorCount} 3S errors, ${successCount} successes, ${failureCount} failures (avg: ${Math.round(recentAvg)}ms) [${context}, ${opponentPattern}]`);
        
        // Pattern-specific escape strategy
        let escapeFactor = 1.0;
        if (opponentPattern === 'predictable') {
            // Predictable: moderate escape (stable timing window exists)
            escapeFactor = 0.8;
            console.log(`🎯 Predictable pattern: Using moderate escape strategy`);
        } else if (opponentPattern === 'unpredictable') {
            // Unpredictable: aggressive escape (timing window is unstable)
            escapeFactor = 1.3;
            console.log(`� Unpredictable pattern: Using aggressive escape strategy`);
        }
        
        const totalFactor = contextFactor * escapeFactor;
        
        // Decision logic based on error type
        if (errorCount > failureCount) {
            // More 3S_ERROR than FAILURE → timing too fast → go slower
            const adjustment = Math.round(100 * totalFactor);
            this.currentTiming = Math.round(recentAvg) + adjustment;
            console.log(`⬆️ Stuck escape: More 3S errors, increasing to ${this.currentTiming}ms (+${adjustment}ms)`);
        } else if (failureCount > errorCount) {
            // More FAILURES than 3S_ERROR → timing too slow → go faster
            const adjustment = Math.round(80 * totalFactor);
            this.currentTiming = Math.round(recentAvg) - adjustment;
            console.log(`⬇️ Stuck escape: More failures, decreasing to ${this.currentTiming}ms (-${adjustment}ms)`);
        } else {
            // Equal errors and failures → try middle ground
            this.currentTiming = Math.round((MIN_TIMING + MAX_TIMING) / 2);
            console.log(`🎯 Stuck escape: Balanced errors, resetting to middle ${this.currentTiming}ms`);
        }
        
        // Apply bounds
        this.currentTiming = this.applyBounds(this.currentTiming);
        return this.currentTiming;
    }
    
    /**
     * Get learning statistics
     */
    getStats() {
        const totalAttempts = this.history.length;
        const successCount = this.history.filter(h => h.result === 'SUCCESS').length;
        const successRate = totalAttempts > 0 ? (successCount / totalAttempts) * 100 : 0;
        
        // Attack stats
        const attackSuccessCount = this.attackHistory.filter(h => h.result === 'SUCCESS').length;
        const attackSuccessRate = this.attackAttemptCount > 0 ? (attackSuccessCount / this.attackAttemptCount) * 100 : 0;
        
        // Defense stats
        const defenseSuccessCount = this.defenseHistory.filter(h => h.result === 'SUCCESS').length;
        const defenseSuccessRate = this.defenseAttemptCount > 0 ? (defenseSuccessCount / this.defenseAttemptCount) * 100 : 0;
        
        return {
            attemptCount: this.attemptCount,
            totalAttempts: totalAttempts,
            successCount: successCount,
            successRate: successRate.toFixed(1),
            currentTiming: this.currentTiming,
            attackAttempts: this.attackAttemptCount,
            attackSuccessRate: attackSuccessRate.toFixed(1),
            defenseAttempts: this.defenseAttemptCount,
            defenseSuccessRate: defenseSuccessRate.toFixed(1)
        };
    }
    
    /**
     * Reset for new context
     */
    reset() {
        this.attemptCount = 0;
        this.history = [];
        this.currentTiming = null;
        this.attackTiming = null;
        this.defenseTiming = null;
        this.attackHistory = [];
        this.defenseHistory = [];
        this.attackAttemptCount = 0;
        this.defenseAttemptCount = 0;
        console.log(`🔄 AI Core reset`);
    }
}

module.exports = { UltraFastLearner, SMART_DEFAULTS };
