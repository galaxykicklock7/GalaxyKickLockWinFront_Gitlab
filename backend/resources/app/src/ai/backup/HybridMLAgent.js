/**
 * Hybrid ML Agent - Q-Learning + Adaptive Binary Search
 * 
 * Game Strategy (CORRECT):
 * - 3S_ERROR → Increase timing (too fast, wait longer)
 * - SUCCESS → Decrease timing (try to catch earlier)
 * - FAILURE → Oscillate (search both directions)
 * 
 * Two-Phase Learning:
 * Phase 1: Q-Learning decides which range to search (coarse)
 * Phase 2: Adaptive Binary Search finds exact timing (fine, 1ms precision)
 * 
 * Why Hybrid?
 * - Q-Learning: Learns from database, adapts to ping/context
 * - Binary Search: Finds exact optimal timing with game strategy
 * - Result: Fast learning + precise timing
 */

const { createClient } = require('@supabase/supabase-js');

// Timing bounds
const MIN_TIMING = 1600;
const MAX_TIMING = 2100;

// Q-Learning parameters (for range selection)
const LEARNING_RATE = 0.3;
const DISCOUNT_FACTOR = 0.95;
const EPSILON = 0.20;  // 20% exploration

// Binary Search parameters (for fine-tuning)
const INITIAL_STEP = 15;     // Start with 15ms steps
const MIN_STEP = 3;          // Minimum 3ms steps
const STEP_DECAY = 0.8;      // Reduce step size by 20% each time

// Rewards
const REWARD_SUCCESS = 20;
const REWARD_FAILURE = -5;
const REWARD_3S_ERROR = -10;

class HybridMLAgent {
    constructor(userId, connectionNumber, supabaseUrl, supabaseKey, getCurrentPingFn, getContextFromPingFn) {
        this.userId = userId;
        this.connectionNumber = connectionNumber;
        
        // Handle mock URLs for testing
        if (supabaseUrl === 'mock-url' || !supabaseUrl || supabaseUrl === '') {
            this.supabase = null; // Mock mode
        } else {
            this.supabase = createClient(supabaseUrl, supabaseKey);
        }
        
        // Ping and context functions
        this.getCurrentPing = getCurrentPingFn;
        this.getContextFromPing = getContextFromPingFn;
        
        // Q-Learning (coarse range selection)
        this.qTable = new Map();
        this.epsilon = EPSILON;
        
        // Adaptive Binary Search (fine-tuning)
        this.currentTiming = null;
        this.stepSize = INITIAL_STEP;
        this.lastResult = null;
        this.consecutiveSameResult = 0;
        
        // Boundaries tracking
        this.last3sErrorTiming = null;  // Upper boundary (too fast)
        this.lastSuccessTiming = null;   // Lower boundary (good)
        
        // Statistics
        this.attemptCount = 0;
        this.successCount = 0;
        this.failureCount = 0;
        this.errorCount = 0;
        this.totalReward = 0;
        
        // History
        this.recentResults = [];
        this.maxHistorySize = 10;
        
        // Defense tracking (when rivals kick you)
        this.defenseData = {
            timesKicked: 0,
            rivalTimings: [], // Store rival timings that beat you
            fastestRival: null, // Fastest rival timing seen
            averageRivalTiming: null,
            percentileFaster: 0 // % of rivals faster than you
        };
        
        console.log(`🧠 Hybrid ML Agent initialized (Q-Learning + Adaptive Binary Search + Defense Tracking)`);
    }
    
    /**
     * Get current state for Q-Learning
     */
    getCurrentState() {
        const ping = this.getCurrentPing ? this.getCurrentPing() : 175;
        const context = this.getContextFromPing ? this.getContextFromPing() : 'NORMAL';
        
        const pingBucket = Math.floor(ping / 50) * 50;
        const successRate = this.getRecentSuccessRate();
        const errorRate = this.getRecentErrorRate();
        
        return `ping${pingBucket}_${context}_succ${successRate}_err${errorRate}`;
    }
    
    getRecentSuccessRate() {
        if (this.recentResults.length === 0) return 50;
        const successCount = this.recentResults.filter(r => r === 'SUCCESS').length;
        return Math.floor((successCount / this.recentResults.length) * 100 / 25) * 25;
    }
    
    getRecentErrorRate() {
        if (this.recentResults.length === 0) return 0;
        const errorCount = this.recentResults.filter(r => r === '3S_ERROR').length;
        return Math.floor((errorCount / this.recentResults.length) * 100 / 25) * 25;
    }
    
    /**
     * Check if stuck by querying last 3 records from database
     * Returns true if last 3 timing values are identical
     */
    async checkStuckInDatabase() {
        try {
            if (!this.supabase) {
                return false; // Mock mode
            }
            
            console.log(`[DB Check] Checking for stuck pattern in database...`);
            
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value, is_success, created_at')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .not('timing_value', 'is', null)
                .order('created_at', { ascending: false })
                .limit(3);
            
            if (error || !data || data.length < 3) {
                console.log(`[DB Check] Not enough data (${data?.length || 0} records)`);
                return false;
            }
            
            // Check if all 3 timing values are the same
            const timings = data.map(r => r.timing_value);
            const allSame = timings.every(t => t === timings[0]);
            
            if (allSame) {
                console.log(`⚠️ [DB Check] STUCK DETECTED: Last 3 records all at ${timings[0]}ms`);
                console.log(`   Records: ${data.map(r => `${r.timing_value}ms (${r.is_success ? 'SUCCESS' : '3S_ERROR'})`).join(', ')}`);
                return true;
            }
            
            console.log(`✅ [DB Check] Not stuck - timings: ${timings.join(', ')}ms`);
            return false;
            
        } catch (error) {
            console.error('[DB Check] Error:', error);
            return false;
        }
    }
    
    /**
     * Initialize from database (transfer learning)
     */
    async initializeFromDatabase() {
        try {
            const ping = this.getCurrentPing ? this.getCurrentPing() : 175;
            const context = this.getContextFromPing ? this.getContextFromPing() : 'NORMAL';
            
            // Mock mode (for testing)
            if (!this.supabase) {
                console.log(`📚 Mock mode: Using ping-based estimate`);
                // New timing ranges based on ping context
                if (ping < 50) {
                    this.currentTiming = 2025; // FAST: 1975-2075ms
                } else if (ping > 150) {
                    this.currentTiming = 1825; // SLOW: 1775-1875ms
                } else {
                    this.currentTiming = 1925; // NORMAL: 1875-1975ms
                }
                return;
            }
            
            console.log(`📚 Loading successful timings from database...`);
            
            // Query 1: Your successful attacks
            const { data: attackData, error: attackError } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value, ping_ms')
                .eq('is_success', true)
                .eq('context', context)
                .gte('ping_ms', ping - 50)
                .lte('ping_ms', ping + 50)
                .order('created_at', { ascending: false })
                .limit(50);
            
            // Query 2: Defense data (when rivals kicked you)
            const { data: defenseData, error: defenseError } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value, player_name, ping_ms')
                .eq('is_defense', true)
                .eq('context', context)
                .gte('ping_ms', ping - 50)
                .lte('ping_ms', ping + 50)
                .order('created_at', { ascending: false })
                .limit(100);
            
            // Process defense data
            if (!defenseError && defenseData && defenseData.length > 0) {
                this.defenseData.rivalTimings = defenseData
                    .map(r => r.timing_value)
                    .filter(t => t && t >= MIN_TIMING && t <= MAX_TIMING);
                
                if (this.defenseData.rivalTimings.length > 0) {
                    // Calculate statistics
                    this.defenseData.fastestRival = Math.min(...this.defenseData.rivalTimings);
                    const sum = this.defenseData.rivalTimings.reduce((a, b) => a + b, 0);
                    this.defenseData.averageRivalTiming = Math.round(sum / this.defenseData.rivalTimings.length);
                    this.defenseData.timesKicked = this.defenseData.rivalTimings.length;
                    
                    console.log(`🛡️ Defense data loaded: ${this.defenseData.timesKicked} rival attacks`);
                    console.log(`   Fastest rival: ${this.defenseData.fastestRival}ms`);
                    console.log(`   Average rival: ${this.defenseData.averageRivalTiming}ms`);
                }
            }
            
            // Determine starting timing
            if (attackError || !attackData || attackData.length === 0) {
                // No attack data - use defense-informed estimate
                if (this.defenseData.fastestRival) {
                    // Start 10ms faster than fastest rival
                    this.currentTiming = this.defenseData.fastestRival - 10;
                    console.log(`📚 No attack data, using defense-based timing: ${this.currentTiming}ms (fastest rival - 10ms)`);
                } else {
                    // No data at all - use ping-based timing
                    if (ping < 50) {
                        this.currentTiming = 2025; // FAST: 1975-2075ms
                    } else if (ping > 150) {
                        this.currentTiming = 1825; // SLOW: 1775-1875ms
                    } else {
                        this.currentTiming = 1925; // NORMAL: 1875-1975ms
                    }
                    console.log(`📚 No data, using ping-based estimate: ${this.currentTiming}ms`);
                }
            } else {
                // Use median of successful attacks
                const timings = attackData.map(r => r.timing_value).sort((a, b) => a - b);
                const medianAttack = timings[Math.floor(timings.length / 2)];
                
                // Adjust based on defense data
                if (this.defenseData.fastestRival) {
                    // If rivals are faster than your median, adjust down
                    if (this.defenseData.fastestRival < medianAttack) {
                        this.currentTiming = Math.min(medianAttack, this.defenseData.fastestRival - 5);
                        console.log(`📚 Adjusted for fast rivals: ${this.currentTiming}ms (rivals at ${this.defenseData.fastestRival}ms)`);
                    } else {
                        this.currentTiming = medianAttack;
                        console.log(`📚 Using attack median: ${this.currentTiming}ms (faster than rivals)`);
                    }
                } else {
                    this.currentTiming = medianAttack;
                    console.log(`📚 Using attack median: ${this.currentTiming}ms`);
                }
                
                console.log(`✅ Initialized from ${attackData.length} successful attempts`);
            }
            
            // Apply bounds
            this.currentTiming = Math.max(MIN_TIMING, Math.min(MAX_TIMING, this.currentTiming));
            
            // Track that this was initialized from database
            this.lastAdjustmentReason = 'DB_INIT';
            
        } catch (error) {
            console.error('[Transfer Learning] Error:', error);
            const ping = this.getCurrentPing ? this.getCurrentPing() : 100;
            // New timing ranges based on ping context
            if (ping < 50) {
                this.currentTiming = 2025; // FAST: 1975-2075ms
            } else if (ping > 150) {
                this.currentTiming = 1825; // SLOW: 1775-1875ms
            } else {
                this.currentTiming = 1925; // NORMAL: 1875-1975ms
            }
        }
    }
    
    /**
     * Record when a rival kicked you (defense data)
     * @param {number} rivalTiming - Estimated timing the rival used
     */
    recordRivalAttack(rivalTiming) {
        if (!rivalTiming || rivalTiming < MIN_TIMING || rivalTiming > MAX_TIMING) {
            return;
        }
        
        this.defenseData.timesKicked++;
        this.defenseData.rivalTimings.push(rivalTiming);
        
        // Keep only last 50 rival attacks
        if (this.defenseData.rivalTimings.length > 50) {
            this.defenseData.rivalTimings.shift();
        }
        
        // Update statistics
        this.defenseData.fastestRival = Math.min(...this.defenseData.rivalTimings);
        const sum = this.defenseData.rivalTimings.reduce((a, b) => a + b, 0);
        this.defenseData.averageRivalTiming = Math.round(sum / this.defenseData.rivalTimings.length);
        
        // Calculate how many rivals are faster than current timing
        const fasterCount = this.defenseData.rivalTimings.filter(t => t < this.currentTiming).length;
        this.defenseData.percentileFaster = Math.round((fasterCount / this.defenseData.rivalTimings.length) * 100);
        
        console.log(`🛡️ Rival kicked you at ~${rivalTiming}ms`);
        console.log(`   Fastest rival: ${this.defenseData.fastestRival}ms`);
        console.log(`   Average rival: ${this.defenseData.averageRivalTiming}ms`);
        console.log(`   Your timing: ${this.currentTiming}ms`);
        console.log(`   Risk: ${this.defenseData.percentileFaster}% of rivals are faster than you`);
        
        // Adjust timing if too many rivals are faster
        if (this.defenseData.percentileFaster > 40 && this.defenseData.rivalTimings.length >= 10) {
            const adjustment = Math.round((this.currentTiming - this.defenseData.fastestRival) / 2);
            if (adjustment > 5) {
                console.log(`⚠️ HIGH RISK: ${this.defenseData.percentileFaster}% of rivals faster than you!`);
                console.log(`   Recommendation: Decrease timing by ${adjustment}ms to ${this.currentTiming - adjustment}ms`);
            }
        }
    }
    
    /**
     * Get defense statistics
     */
    getDefenseStats() {
        return {
            timesKicked: this.defenseData.timesKicked,
            fastestRival: this.defenseData.fastestRival,
            averageRival: this.defenseData.averageRivalTiming,
            percentileFaster: this.defenseData.percentileFaster,
            rivalCount: this.defenseData.rivalTimings.length,
            yourTiming: this.currentTiming,
            speedAdvantage: this.defenseData.averageRivalTiming ? 
                this.defenseData.averageRivalTiming - this.currentTiming : null
        };
    }
    
    /**
     * Get optimal timing (called when AI is enabled)
     */
    async getOptimalTiming(timingType) {
        if (this.currentTiming === null) {
            await this.initializeFromDatabase();
        }
        
        const ping = this.getCurrentPing ? this.getCurrentPing() : 175;
        const context = this.getContextFromPing ? this.getContextFromPing() : 'NORMAL';
        
        console.log(`🧠 Hybrid ML Decision:`);
        console.log(`   Timing: ${this.currentTiming}ms`);
        console.log(`   Step Size: ${this.stepSize}ms`);
        console.log(`   Context: ${context} (${ping}ms ping)`);
        console.log(`   Boundaries: 3S=${this.last3sErrorTiming}ms, Success=${this.lastSuccessTiming}ms`);
        
        return this.currentTiming;
    }
    
    /**
     * Learn from result and adjust timing (GAME STRATEGY)
     */
    async getNextTiming(lastResult, timingType) {
        this.attemptCount++;
        
        // Track result
        this.recentResults.push(lastResult);
        if (this.recentResults.length > this.maxHistorySize) {
            this.recentResults.shift();
        }
        
        // 🆕 Track timing history (not just results)
        if (!this.timingHistory) {
            this.timingHistory = [];
        }
        this.timingHistory.push(this.currentTiming);
        if (this.timingHistory.length > this.maxHistorySize) {
            this.timingHistory.shift();
        }
        
        // Get reward
        let reward = 0;
        if (lastResult === 'SUCCESS') {
            reward = REWARD_SUCCESS;
            this.successCount++;
            this.lastSuccessTiming = this.currentTiming;
        } else if (lastResult === 'FAILURE') {
            reward = REWARD_FAILURE;
            this.failureCount++;
        } else if (lastResult === '3S_ERROR') {
            reward = REWARD_3S_ERROR;
            this.errorCount++;
            this.last3sErrorTiming = this.currentTiming;
        }
        
        this.totalReward += reward;
        
        console.log(`📊 Result: ${lastResult}, Reward: ${reward > 0 ? '+' : ''}${reward}`);
        
        // 🆕 UNIVERSAL STUCK DETECTION: Check if timing value hasn't changed
        // Works for ANY result type (3S_ERROR, SUCCESS, FAILURE)
        const last3Timings = this.timingHistory.slice(-3);
        const timingStuckAtSameValue = last3Timings.length >= 3 && 
                                       last3Timings.every(t => t === last3Timings[0]);
        
        // 🆕 Also check database for stuck pattern
        const dbStuck = await this.checkStuckInDatabase();
        
        if (timingStuckAtSameValue || dbStuck) {
            const oldTiming = this.currentTiming;
            const oldStepSize = this.stepSize;
            
            // 🆕 Track that this was a stuck escape adjustment
            this.lastAdjustmentReason = 'STUCK_ESCAPE';
            
            // Determine escape direction based on last result
            let escapeStep;
            if (lastResult === '3S_ERROR') {
                // Too fast - increase timing
                escapeStep = Math.max(20, this.stepSize * 5);
                this.currentTiming += escapeStep;
                console.log(`⚠️ STUCK DETECTED: 3 consecutive attempts at ${oldTiming}ms with 3S_ERROR`);
                console.log(`🔧 FORCING INCREASE: ${oldTiming}ms → ${this.currentTiming}ms (+${escapeStep}ms)`);
            } else if (lastResult === 'SUCCESS') {
                // Success but stuck - try going faster
                escapeStep = Math.max(20, this.stepSize * 5);
                this.currentTiming -= escapeStep;
                console.log(`⚠️ STUCK DETECTED: 3 consecutive attempts at ${oldTiming}ms with SUCCESS`);
                console.log(`🔧 FORCING DECREASE: ${oldTiming}ms → ${this.currentTiming}ms (-${escapeStep}ms)`);
            } else {
                // Failure - try increasing (rival might be faster)
                escapeStep = Math.max(20, this.stepSize * 5);
                this.currentTiming += escapeStep;
                console.log(`⚠️ STUCK DETECTED: 3 consecutive attempts at ${oldTiming}ms with FAILURE`);
                console.log(`🔧 FORCING INCREASE: ${oldTiming}ms → ${this.currentTiming}ms (+${escapeStep}ms)`);
            }
            
            // Reset step size to allow bigger movements
            this.stepSize = Math.max(10, INITIAL_STEP);
            console.log(`🔧 RESETTING STEP SIZE: ${oldStepSize}ms → ${this.stepSize}ms`);
            
            // Apply bounds and return
            this.currentTiming = Math.max(MIN_TIMING, Math.min(MAX_TIMING, this.currentTiming));
            console.log(`🎯 Next timing: ${this.currentTiming}ms (forced escape from stuck state)`);
            return this.currentTiming;
        }
        
        // 🆕 Track normal adjustment reason
        this.lastAdjustmentReason = lastResult;
        
        // GAME STRATEGY: Adjust timing based on result
        const oldTiming = this.currentTiming;
        
        if (lastResult === '3S_ERROR') {
            // 3S_ERROR: Too fast → INCREASE timing (wait longer)
            this.currentTiming += this.stepSize;
            console.log(`⬆️ 3S Error: Too fast, increasing ${oldTiming}ms → ${this.currentTiming}ms (+${this.stepSize}ms)`);
            
            // Reduce step size (converging) but not below 5ms to avoid getting stuck
            this.stepSize = Math.max(5, Math.round(this.stepSize * STEP_DECAY));
            
        } else if (lastResult === 'SUCCESS') {
            // SUCCESS: Caught rival → DECREASE timing (try to catch earlier)
            this.currentTiming -= this.stepSize;
            console.log(`⬇️ Success: Caught rival, decreasing ${oldTiming}ms → ${this.currentTiming}ms (-${this.stepSize}ms)`);
            
            // Reduce step size (converging) but not below 5ms to avoid getting stuck
            this.stepSize = Math.max(5, Math.round(this.stepSize * STEP_DECAY));
            
        } else if (lastResult === 'FAILURE') {
            // FAILURE: Rival escaped → OSCILLATE (search both directions)
            
            // Analyze recent pattern
            const recent3Errors = this.recentResults.filter(r => r === '3S_ERROR').length;
            const recentSuccesses = this.recentResults.filter(r => r === 'SUCCESS').length;
            const recentFailures = this.recentResults.filter(r => r === 'FAILURE').length;
            
            // 🆕 If too many failures, increase step size to escape local minimum
            if (recentFailures >= 5) {
                this.stepSize = Math.max(10, Math.min(INITIAL_STEP, this.stepSize * 1.5));
                console.log(`⚠️ High failure rate (${recentFailures}/10) - increasing step size to ${this.stepSize}ms`);
            }
            
            if (recent3Errors > recentSuccesses) {
                // More 3S errors → timing too fast → increase
                this.currentTiming += this.stepSize;
                console.log(`⬆️ Failure: Recent 3S errors, increasing ${oldTiming}ms → ${this.currentTiming}ms (+${this.stepSize}ms)`);
            } else if (recentSuccesses > recent3Errors) {
                // More successes → timing might be too slow → decrease
                this.currentTiming -= this.stepSize;
                console.log(`⬇️ Failure: Recent successes, decreasing ${oldTiming}ms → ${this.currentTiming}ms (-${this.stepSize}ms)`);
            } else {
                // Balanced → oscillate (try opposite direction)
                if (this.consecutiveSameResult >= 2) {
                    // Stuck with failures → increase step and try opposite
                    this.stepSize = Math.min(INITIAL_STEP, this.stepSize * 1.5);
                    this.currentTiming += this.stepSize;
                    console.log(`🔀 Failure: Oscillating, trying ${oldTiming}ms → ${this.currentTiming}ms (+${this.stepSize}ms)`);
                } else {
                    // Normal oscillation
                    this.currentTiming -= this.stepSize;
                    console.log(`🔀 Failure: Oscillating, trying ${oldTiming}ms → ${this.currentTiming}ms (-${this.stepSize}ms)`);
                }
            }
        }
        
        // Apply bounds
        this.currentTiming = Math.max(MIN_TIMING, Math.min(MAX_TIMING, this.currentTiming));
        
        // Check if converged (oscillating between 3S and SUCCESS)
        if (this.last3sErrorTiming && this.lastSuccessTiming) {
            const gap = Math.abs(this.last3sErrorTiming - this.lastSuccessTiming);
            if (gap <= 10) {
                console.log(`✅ CONVERGED! Optimal window: ${Math.min(this.lastSuccessTiming, this.last3sErrorTiming)}ms - ${Math.max(this.lastSuccessTiming, this.last3sErrorTiming)}ms (gap: ${gap}ms)`);
                // Use middle of the gap
                this.currentTiming = Math.round((this.lastSuccessTiming + this.last3sErrorTiming) / 2);
                this.stepSize = MIN_STEP; // Use minimum step
            }
        }
        
        console.log(`🎯 Next timing: ${this.currentTiming}ms (step: ${this.stepSize}ms)`);
        
        return this.currentTiming;
    }
    
    /**
     * Get adjustment reason for last timing change
     */
    getAdjustmentReason() {
        return this.lastAdjustmentReason || 'INIT';
    }
    
    /**
     * Get statistics
     */
    getStats() {
        const totalAttempts = this.successCount + this.failureCount + this.errorCount;
        const successRate = totalAttempts > 0 ? (this.successCount / totalAttempts) * 100 : 0;
        
        // 🆕 Detect stuck state
        const recentFailures = this.recentResults.filter(r => r === 'FAILURE').length;
        const isStuck = recentFailures >= 5 && this.stepSize <= 5;
        
        return {
            attemptCount: this.attemptCount,
            totalAttempts: totalAttempts,
            successCount: this.successCount,
            successRate: successRate.toFixed(1),
            currentTiming: this.currentTiming,
            totalReward: this.totalReward.toFixed(1),
            stepSize: this.stepSize,
            last3sError: this.last3sErrorTiming,
            lastSuccess: this.lastSuccessTiming,
            attackAttempts: totalAttempts,
            attackSuccessRate: successRate.toFixed(1),
            defenseAttempts: 0,
            defenseSuccessRate: '0.0',
            // Defense stats
            timesKicked: this.defenseData.timesKicked,
            fastestRival: this.defenseData.fastestRival,
            averageRival: this.defenseData.averageRivalTiming,
            riskLevel: this.defenseData.percentileFaster,
            speedAdvantage: this.defenseData.averageRivalTiming ? 
                this.defenseData.averageRivalTiming - this.currentTiming : null,
            // 🆕 Stuck detection
            isStuck: isStuck,
            recentFailures: recentFailures,
            consecutiveSameResult: this.consecutiveSameResult
        };
    }
    
    /**
     * Reset for new session
     */
    reset() {
        this.stepSize = INITIAL_STEP;
        this.lastResult = null;
        this.consecutiveSameResult = 0;
        this.recentResults = [];
        console.log(`🔄 Hybrid ML Agent reset (timing preserved: ${this.currentTiming}ms)`);
    }
}

module.exports = { HybridMLAgent };
