/**
 * Ultra-Fast AI Learning Engine - CONSERVATIVE VERSION
 * 
 * Conservative Learning Strategy (mimics human gameplay):
 * - Small, gradual adjustments (5-15ms typically)
 * - Larger jumps only when really stuck (30-50ms)
 * - Respects the importance of millisecond precision
 * 
 * Result meanings:
 * - 3S_ERROR: Tried to kick too early → Increase timing (wait longer)
 * - SUCCESS: Caught rival → Decrease timing slightly (try to catch earlier)
 * - FAILURE: Rival escaped → Analyze pattern and adjust
 */

const { createClient } = require('@supabase/supabase-js');

// Timing bounds
const MIN_TIMING = 1600;
const MAX_TIMING = 2100;

// Smart defaults
const SMART_DEFAULTS = {
    attack: 1950,
    defense: 1920
};

class UltraFastLearner {
    constructor(userId, connectionNumber, supabaseUrl, supabaseKey, getCurrentPingFn, getContextFromPingFn) {
        this.userId = userId;
        this.connectionNumber = connectionNumber;
        this.supabase = createClient(supabaseUrl, supabaseKey);
        
        // Ping and context functions
        this.getCurrentPing = getCurrentPingFn;
        this.getContextFromPing = getContextFromPingFn;
        
        // Current state
        this.currentTiming = null;
        this.attemptCount = 0;
        
        // Learning history
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
        
        console.log(`🧠 AI Core initialized (CONSERVATIVE mode)`);
    }
    
    /**
     * Get optimal timing (3-layer approach with context awareness)
     */
    async getOptimalTiming(timingType) {
        const context = this.getContextFromPing ? this.getContextFromPing() : 'NORMAL';
        const ping = this.getCurrentPing ? this.getCurrentPing() : null;
        
        console.log(`🎯 Getting optimal timing for ${timingType} (context: ${context}, ping: ${ping}ms)...`);
        
        // Layer 1: Personal history
        const personalOptimal = await this.getPersonalOptimal(timingType, context);
        if (personalOptimal) {
            this.currentTiming = personalOptimal.optimal_timing;
            console.log(`📊 Using personal history: ${this.currentTiming}ms`);
            return this.currentTiming;
        }
        
        // Layer 2: Transfer learning
        const transferOptimal = await this.getTransferLearningOptimal(timingType, context);
        if (transferOptimal) {
            this.currentTiming = transferOptimal.optimal_timing;
            console.log(`📚 Using transfer learning: ${this.currentTiming}ms`);
            return this.currentTiming;
        }
        
        // Layer 3: Smart defaults
        this.currentTiming = SMART_DEFAULTS[timingType];
        console.log(`🎯 Using smart default: ${this.currentTiming}ms`);
        return this.currentTiming;
    }
    
    async getPersonalOptimal(timingType, context) {
        try {
            const { data, error } = await this.supabase.rpc('ai_get_personal_optimal', {
                p_user_id: this.userId,
                p_connection_number: this.connectionNumber,
                p_context: context,
                p_timing_type: timingType
            });
            
            if (error) {
                console.error('[AI] Error getting personal optimal:', error);
                return null;
            }
            
            return (data && data.success) ? data : null;
        } catch (error) {
            console.error('[AI] Exception getting personal optimal:', error);
            return null;
        }
    }
    
    async getTransferLearningOptimal(timingType, context) {
        try {
            const { data, error } = await this.supabase.rpc('ai_get_transfer_learning_optimal', {
                p_context: context,
                p_timing_type: timingType
            });
            
            if (error) {
                console.error('[AI] Error getting transfer learning optimal:', error);
                return null;
            }
            
            return (data && data.success) ? data : null;
        } catch (error) {
            console.error('[AI] Exception getting transfer learning optimal:', error);
            return null;
        }
    }
    
    /**
     * Apply bounds to timing
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
     * Get next timing based on result (CONSERVATIVE)
     */
    getNextTiming(lastResult, timingType) {
        this.attemptCount++;
        
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
        
        this.history.push({
            timing: this.currentTiming,
            result: lastResult,
            attempt: this.attemptCount,
            type: timingType,
            context: currentContext,
            ping: currentPing
        });
        
        console.log(`🔄 Attempt ${this.attemptCount}: ${this.currentTiming}ms → ${lastResult} [${currentContext}, ${currentPing}ms]`);
        
        const typeHistory = timingType === 'attack' ? this.attackHistory : this.defenseHistory;
        const typeAttemptCount = timingType === 'attack' ? this.attackAttemptCount : this.defenseAttemptCount;
        
        // Re-query database every 10 attempts
        if (this.attemptCount % 10 === 0) {
            console.log(`📊 Attempt ${this.attemptCount}: Triggering database re-query...`);
            this.shouldRequeryDatabase = true;
            this.requeryTimingType = timingType;
        }
        
        // Check for stuck (only after 10+ attempts)
        if (typeAttemptCount >= 10 && this.isStuck(typeHistory)) {
            return this.escapeStuck(typeHistory, currentContext);
        }
        
        // Use conservative learning
        return this.conservativeLearning(lastResult, typeHistory, currentContext);
    }
    
    /**
     * Conservative learning - small adjustments
     */
    conservativeLearning(result, typeHistory, context) {
        // Base adjustments (SMALL)
        let adjustment = 0;
        
        if (result === '3S_ERROR') {
            // 3S ERROR: Kicked too early → Increase timing
            adjustment = 12;  // Small increase
            this.currentTiming += adjustment;
            console.log(`⬆️ 3S error: +${adjustment}ms → ${this.currentTiming}ms`);
            
        } else if (result === 'SUCCESS') {
            // SUCCESS: Caught rival → Try earlier
            adjustment = 8;  // Small decrease
            this.currentTiming -= adjustment;
            console.log(`⬇️ Success: -${adjustment}ms → ${this.currentTiming}ms`);
            
        } else {
            // FAILURE: Rival escaped → Analyze recent pattern
            const recent = typeHistory.slice(-3);
            const recentErrors = recent.filter(h => h.result === '3S_ERROR').length;
            const recentSuccesses = recent.filter(h => h.result === 'SUCCESS').length;
            
            if (recentErrors > recentSuccesses) {
                // More errors → timing too fast → increase
                adjustment = 10;
                this.currentTiming += adjustment;
                console.log(`⬆️ Failure (recent errors): +${adjustment}ms → ${this.currentTiming}ms`);
            } else {
                // More successes → timing too slow → decrease
                adjustment = 10;
                this.currentTiming -= adjustment;
                console.log(`⬇️ Failure (rival escaped): -${adjustment}ms → ${this.currentTiming}ms`);
            }
        }
        
        this.currentTiming = this.applyBounds(this.currentTiming);
        return this.currentTiming;
    }
    
    /**
     * Detect stuck state
     */
    isStuck(typeHistory) {
        if (typeHistory.length < 10) return false;
        
        const recent = typeHistory.slice(-10);
        const successCount = recent.filter(h => h.result === 'SUCCESS').length;
        
        // Stuck if < 20% success (0-2 successes out of 10)
        return successCount < 2;
    }
    
    /**
     * Escape stuck state
     */
    escapeStuck(typeHistory, context) {
        console.log(`🚨 STUCK DETECTED! Attempting escape...`);
        
        const recent = typeHistory.slice(-10);
        const errorCount = recent.filter(h => h.result === '3S_ERROR').length;
        const failureCount = recent.filter(h => h.result !== 'SUCCESS' && h.result !== '3S_ERROR').length;
        
        console.log(`📊 Last 10: ${errorCount} errors, ${failureCount} failures`);
        
        if (errorCount > failureCount) {
            // More errors → timing too fast → jump up
            this.currentTiming += 50;
            console.log(`⬆️ Stuck escape: +50ms → ${this.currentTiming}ms`);
        } else {
            // More failures → timing too slow → jump down
            this.currentTiming -= 40;
            console.log(`⬇️ Stuck escape: -40ms → ${this.currentTiming}ms`);
        }
        
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
        
        const attackSuccessCount = this.attackHistory.filter(h => h.result === 'SUCCESS').length;
        const attackSuccessRate = this.attackAttemptCount > 0 ? (attackSuccessCount / this.attackAttemptCount) * 100 : 0;
        
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
