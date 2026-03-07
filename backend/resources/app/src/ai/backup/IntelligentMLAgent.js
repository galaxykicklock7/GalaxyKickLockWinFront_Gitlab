/**
 * Intelligent Zone-Based ML Agent
 * 
 * SMART LEARNING STRATEGY:
 * 1. 3S_ERROR = You're TOO FAST → Slow down 5-10ms (increase timing)
 * 2. SUCCESS = You caught them → Oscillate in zone to find sweet spot
 * 3. KICKED = Rival is faster → Estimate rival timing, move to AGGRESSIVE zone
 * 4. FAILURE = Missed them → Analyze threat, adjust zone if needed
 * 5. No 3S errors = GOOD SIGN → Continue refining in current zone
 * 6. ZONES guide timing → Fit perfectly into optimal zone
 * 
 * Zones (CRITICAL - timing must fit perfectly):
 * - AGGRESSIVE (1840-1880ms): Beat fast rivals, accept some 3S_ERROR
 * - BALANCED (1900-1920ms): Balance offense and defense
 * - CONSERVATIVE (1920-1940ms): Maximize NPC catches, vulnerable to rivals
 * 
 * GOAL: 95% success rate by intelligently fitting into the right zone
 */

const { createClient } = require('@supabase/supabase-js');

// Timing bounds
const MIN_TIMING = 1600;
const MAX_TIMING = 2100;

// Zone definitions - Updated to match new timing ranges
// FAST context (ping < 50ms): 1975-2075ms
// NORMAL context (50-150ms): 1875-1975ms
// SLOW context (ping > 150ms): 1775-1875ms
const ZONES = {
    FAST: { min: 1975, max: 2075, center: 2025 },
    NORMAL: { min: 1875, max: 1975, center: 1925 },
    SLOW: { min: 1775, max: 1875, center: 1825 }
};

// Analysis parameters
const HISTORY_SAMPLE_SIZE = 100;  // Analyze last 100 attempts
const BUCKET_SIZE = 10;            // 10ms buckets for success rate calculation
const CONVERGENCE_THRESHOLD = 0.70; // 70% success rate = converged
const CONVERGENCE_ATTEMPTS = 10;    // Need 10 attempts to confirm convergence

class IntelligentMLAgent {
    constructor(userId, connectionNumber, supabaseUrl, supabaseKey, getCurrentPingFn, getContextFromPingFn) {
        this.userId = userId;
        this.connectionNumber = connectionNumber;
        
        // Handle mock URLs for testing
        if (supabaseUrl === 'mock-url' || !supabaseUrl || supabaseUrl === '') {
            this.supabase = null;
        } else {
            this.supabase = createClient(supabaseUrl, supabaseKey);
        }
        
        // Ping and context functions
        this.getCurrentPing = getCurrentPingFn;
        this.getContextFromPing = getContextFromPingFn;
        
        // Current state
        this.currentTiming = null;
        this.currentZone = 'NORMAL';  // Start with NORMAL (will be set based on ping)
        this.isConverged = false;
        
        // Historical data cache
        this.successRateMap = new Map();  // timing bucket -> success rate
        this.safeZone = null;              // { min, max, center, successRate }
        this.dangerZones = [];             // Array of danger zones
        
        // Defense data (SMART RIVAL ESTIMATION)
        this.defenseData = {
            timesKicked: 0,
            rivalTimings: [],              // YOUR timings when kicked (not rival's actual timing!)
            estimatedRivalTimings: [],     // ESTIMATED rival timings (your timing - 40-80ms)
            fastestRival: null,            // Fastest ESTIMATED rival timing
            averageRival: null,            // Average ESTIMATED rival timing
            kickedRate: 0,
            threatLevel: 'LOW',            // LOW, MEDIUM, HIGH
            consecutive3sErrors: 0,        // Track consecutive 3S errors (means you're close!)
            lastResultWas3s: false         // Track if last result was 3S error
        };
        
        // Statistics
        this.attemptCount = 0;
        this.successCount = 0;
        this.failureCount = 0;
        this.errorCount = 0;
        this.consecutiveSuccesses = 0;     // Track consecutive successes (for oscillation)
        this.consecutiveFailures = 0;      // Track consecutive failures (need to move zones)
        
        // Recent results for convergence detection
        this.recentResults = [];
        this.maxHistorySize = 10;
        
        // Oscillation tracking (when converged, oscillate to find sweet spot)
        this.oscillationDirection = 1;     // 1 = increase, -1 = decrease
        this.oscillationCount = 0;         // How many oscillations performed
        
        // Adjustment tracking
        this.lastAdjustmentReason = 'INIT';
        
        console.log(`🧠 Intelligent Zone-Based ML Agent initialized`);
        console.log(`   Strategy: Smart Zone Fitting + Rival Estimation + 3S Learning`);
    }
    
    /**
     * PHASE 1: Historical Pattern Analysis
     * Query database and build success rate map
     */
    async analyzeHistoricalPatterns() {
        try {
            if (!this.supabase) {
                console.log(`[Historical Analysis] Mock mode - using default patterns`);
                return this.buildDefaultPatterns();
            }
            
            console.log(`[Historical Analysis] Querying last ${HISTORY_SAMPLE_SIZE} attempts...`);
            
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value, is_success, ping_ms, context')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .not('timing_value', 'is', null)
                .order('created_at', { ascending: false })
                .limit(HISTORY_SAMPLE_SIZE);
            
            if (error || !data || data.length < 10) {
                console.log(`[Historical Analysis] Insufficient data (${data?.length || 0} records), using defaults`);
                return this.buildDefaultPatterns();
            }
            
            console.log(`[Historical Analysis] Analyzing ${data.length} attempts...`);
            
            // Build success rate map (10ms buckets)
            const bucketStats = new Map();
            
            data.forEach(record => {
                const bucket = Math.floor(record.timing_value / BUCKET_SIZE) * BUCKET_SIZE;
                
                if (!bucketStats.has(bucket)) {
                    bucketStats.set(bucket, { total: 0, successes: 0 });
                }
                
                const stats = bucketStats.get(bucket);
                stats.total++;
                if (record.is_success) stats.successes++;
            });
            
            // Calculate success rates
            this.successRateMap.clear();
            bucketStats.forEach((stats, bucket) => {
                const successRate = stats.successes / stats.total;
                this.successRateMap.set(bucket, {
                    successRate,
                    attempts: stats.total,
                    center: bucket + BUCKET_SIZE / 2
                });
            });
            
            // Identify safe zone (highest success rate with enough attempts)
            let bestZone = null;
            let bestRate = 0;
            
            this.successRateMap.forEach((stats, bucket) => {
                if (stats.attempts >= 5 && stats.successRate > bestRate) {
                    bestRate = stats.successRate;
                    bestZone = {
                        min: bucket,
                        max: bucket + BUCKET_SIZE,
                        center: stats.center,
                        successRate: stats.successRate,
                        attempts: stats.attempts
                    };
                }
            });
            
            this.safeZone = bestZone;
            
            // Identify danger zones (success rate < 30%)
            this.dangerZones = [];
            this.successRateMap.forEach((stats, bucket) => {
                if (stats.successRate < 0.30 && stats.attempts >= 3) {
                    this.dangerZones.push({
                        min: bucket,
                        max: bucket + BUCKET_SIZE,
                        center: stats.center,
                        successRate: stats.successRate
                    });
                }
            });
            
            console.log(`[Historical Analysis] Results:`);
            if (this.safeZone) {
                console.log(`   Safe Zone: ${this.safeZone.min}-${this.safeZone.max}ms (${(this.safeZone.successRate * 100).toFixed(0)}% success, ${this.safeZone.attempts} attempts)`);
            }
            console.log(`   Danger Zones: ${this.dangerZones.length} identified`);
            this.dangerZones.forEach(zone => {
                console.log(`     ${zone.min}-${zone.max}ms (${(zone.successRate * 100).toFixed(0)}% success)`);
            });
            
        } catch (error) {
            console.error('[Historical Analysis] Error:', error);
            this.buildDefaultPatterns();
        }
    }
    
    /**
     * Build default patterns when no historical data available
     */
    buildDefaultPatterns() {
        const ping = this.getCurrentPing ? this.getCurrentPing() : 100;
        // New timing ranges based on ping context
        let baseCenter;
        if (ping < 50) {
            baseCenter = 2025; // FAST: 1975-2075ms
            this.currentZone = 'FAST';
        } else if (ping > 150) {
            baseCenter = 1825; // SLOW: 1775-1875ms
            this.currentZone = 'SLOW';
        } else {
            baseCenter = 1925; // NORMAL: 1875-1975ms
            this.currentZone = 'NORMAL';
        }
        
        console.log(`📊 Using ${this.currentZone} zone (ping: ${ping}ms): ${ZONES[this.currentZone].min}-${ZONES[this.currentZone].max}ms, starting at ${baseCenter}ms`);
        
        this.safeZone = {
            min: baseCenter - 10,
            max: baseCenter + 10,
            center: baseCenter,
            successRate: 0.50,
            attempts: 0
        };
        
        this.dangerZones = [];
        
        console.log(`[Historical Analysis] Using default safe zone: ${this.safeZone.min}-${this.safeZone.max}ms`);
    }
    
    /**
     * PHASE 2: Defense Analysis (SMART RIVAL ESTIMATION)
     * Estimate rival timings from YOUR timings when kicked
     */
    async analyzeDefenseData() {
        try {
            if (!this.supabase) {
                console.log(`[Defense Analysis] Mock mode - no defense data`);
                return;
            }
            
            console.log(`[Defense Analysis] Querying defense metrics...`);
            
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value')
                .eq('user_id', this.userId)
                .eq('is_defense', true)
                .not('timing_value', 'is', null)
                .order('created_at', { ascending: false })
                .limit(50);
            
            if (error || !data || data.length === 0) {
                console.log(`[Defense Analysis] No defense data found`);
                this.defenseData.threatLevel = 'LOW';
                return;
            }
            
            // Store YOUR timings when kicked
            this.defenseData.rivalTimings = data.map(r => r.timing_value);
            this.defenseData.timesKicked = data.length;
            
            // 🎯 SMART ESTIMATION: Rival was 40-80ms faster than your timing
            // If you got kicked at 1920ms, rival was probably using 1840-1880ms
            this.defenseData.estimatedRivalTimings = this.defenseData.rivalTimings.map(yourTiming => {
                // Estimate rival was 60ms faster on average (middle of 40-80ms range)
                return yourTiming - 60;
            });
            
            if (this.defenseData.estimatedRivalTimings.length > 0) {
                this.defenseData.fastestRival = Math.min(...this.defenseData.estimatedRivalTimings);
                const sum = this.defenseData.estimatedRivalTimings.reduce((a, b) => a + b, 0);
                this.defenseData.averageRival = Math.round(sum / this.defenseData.estimatedRivalTimings.length);
                
                // Calculate kicked rate (as percentage of total attempts)
                const totalAttempts = this.attemptCount || 50;
                this.defenseData.kickedRate = this.defenseData.timesKicked / totalAttempts;
                
                // Determine threat level
                if (this.defenseData.kickedRate > 0.30) {
                    this.defenseData.threatLevel = 'HIGH';
                } else if (this.defenseData.kickedRate > 0.15) {
                    this.defenseData.threatLevel = 'MEDIUM';
                } else {
                    this.defenseData.threatLevel = 'LOW';
                }
                
                console.log(`[Defense Analysis] Results (SMART ESTIMATION):`);
                console.log(`   Times Kicked: ${this.defenseData.timesKicked}`);
                console.log(`   Your Timings When Kicked: ${this.defenseData.rivalTimings.slice(0, 3).join(', ')}ms...`);
                console.log(`   ESTIMATED Rival Timings: ${this.defenseData.estimatedRivalTimings.slice(0, 3).join(', ')}ms...`);
                console.log(`   ESTIMATED Fastest Rival: ${this.defenseData.fastestRival}ms`);
                console.log(`   ESTIMATED Average Rival: ${this.defenseData.averageRival}ms`);
                console.log(`   Kicked Rate: ${(this.defenseData.kickedRate * 100).toFixed(0)}%`);
                console.log(`   Threat Level: ${this.defenseData.threatLevel}`);
            }
            
        } catch (error) {
            console.error('[Defense Analysis] Error:', error);
            this.defenseData.threatLevel = 'LOW';
        }
    }
    
    /**
     * PHASE 3: Strategy Selection
     * Calculate expected value for each zone and select best
     */
    selectOptimalZone() {
        console.log(`[Strategy Selection] Calculating expected values...`);
        
        const zones = [];
        
        // Evaluate each zone
        Object.keys(ZONES).forEach(zoneName => {
            const zone = ZONES[zoneName];
            const ev = this.calculateExpectedValue(zone);
            zones.push({ name: zoneName, zone, ev });
        });
        
        // Sort by expected value
        zones.sort((a, b) => b.ev - a.ev);
        
        // Select best zone
        const best = zones[0];
        this.currentZone = best.name;
        
        console.log(`[Strategy Selection] Zone Evaluation:`);
        zones.forEach(z => {
            console.log(`   ${z.name}: EV = ${z.ev.toFixed(2)} ${z.name === best.name ? '⭐ SELECTED' : ''}`);
        });
        
        return ZONES[this.currentZone];
    }
    
    /**
     * Calculate expected value for a zone
     * EV = (offense_success_rate × 1.0) - (defense_failure_rate × 2.0)
     */
    calculateExpectedValue(zone) {
        // Get offense success rate from historical data
        let offenseSuccess = 0.50;  // Default
        
        if (this.safeZone && this.isInZone(this.safeZone.center, zone)) {
            offenseSuccess = this.safeZone.successRate;
        } else {
            // Estimate based on distance from safe zone
            if (this.safeZone) {
                const distance = Math.abs(zone.center - this.safeZone.center);
                offenseSuccess = Math.max(0.20, this.safeZone.successRate - (distance / 100));
            }
        }
        
        // Get defense success rate based on rival timings
        let defenseSuccess = 0.70;  // Default
        
        if (this.defenseData.averageRival) {
            // If our timing is faster than average rival, we're safer
            if (zone.center < this.defenseData.averageRival) {
                const advantage = this.defenseData.averageRival - zone.center;
                defenseSuccess = Math.min(0.95, 0.70 + (advantage / 100));
            } else {
                const disadvantage = zone.center - this.defenseData.averageRival;
                defenseSuccess = Math.max(0.30, 0.70 - (disadvantage / 50));
            }
        }
        
        // Calculate expected value
        // Offense success gives +1 point, defense failure costs -2 points
        const ev = (offenseSuccess * 1.0) - ((1 - defenseSuccess) * 2.0);
        
        return ev;
    }
    
    /**
     * Check if timing is within a zone
     */
    isInZone(timing, zone) {
        return timing >= zone.min && timing <= zone.max;
    }
    
    /**
     * PHASE 4: Smart Step Size Calculation
     * Calculate dynamic step size based on context
     */
    calculateSmartStepSize(currentTiming, targetZone, lastResult) {
        const distanceToTarget = Math.abs(targetZone.center - currentTiming);
        
        // Check if in danger zone
        const inDangerZone = this.dangerZones.some(zone => 
            this.isInZone(currentTiming, zone)
        );
        
        // Check if converged
        if (this.isConverged) {
            console.log(`[Smart Step] Converged - using micro-adjustment (2-5ms)`);
            return Math.random() < 0.5 ? 3 : 5;  // Random 3 or 5ms
        }
        
        // Large jump if in danger zone
        if (inDangerZone) {
            const jumpSize = Math.max(30, Math.min(50, distanceToTarget));
            console.log(`[Smart Step] In danger zone - large jump (${jumpSize}ms)`);
            return jumpSize;
        }
        
        // Medium step if far from target
        if (distanceToTarget > 20) {
            const stepSize = Math.max(15, Math.min(25, distanceToTarget / 2));
            console.log(`[Smart Step] Far from target - medium step (${stepSize}ms)`);
            return stepSize;
        }
        
        // Small step if near target
        if (distanceToTarget > 10) {
            console.log(`[Smart Step] Near target - small step (8-12ms)`);
            return 10;
        }
        
        // Micro-adjustment if very close
        console.log(`[Smart Step] Very close - micro-adjustment (5-8ms)`);
        return 6;
    }
    
    /**
     * PHASE 5: Convergence Detection
     * Check if we've found optimal timing
     */
    checkConvergence() {
        if (this.recentResults.length < CONVERGENCE_ATTEMPTS) {
            return false;
        }
        
        const recentSuccesses = this.recentResults.filter(r => r === 'SUCCESS').length;
        const successRate = recentSuccesses / this.recentResults.length;
        
        if (successRate >= CONVERGENCE_THRESHOLD) {
            if (!this.isConverged) {
                console.log(`✅ CONVERGED! Success rate: ${(successRate * 100).toFixed(0)}% over last ${CONVERGENCE_ATTEMPTS} attempts`);
                this.isConverged = true;
            }
            return true;
        }
        
        if (this.isConverged && successRate < CONVERGENCE_THRESHOLD - 0.10) {
            console.log(`⚠️ DIVERGED! Success rate dropped to ${(successRate * 100).toFixed(0)}%`);
            this.isConverged = false;
        }
        
        return false;
    }
    
    /**
     * Initialize from database (SMART ZONE SELECTION)
     */
    async initializeFromDatabase() {
        try {
            console.log(`🧠 Initializing Smart Zone-Based ML Agent...`);
            
            // Phase 1: Analyze historical patterns
            await this.analyzeHistoricalPatterns();
            
            // Phase 2: Analyze defense data (with smart rival estimation)
            await this.analyzeDefenseData();
            
            // Phase 3: Smart zone selection based on threat level
            let targetZone;
            
            if (this.defenseData.threatLevel === 'HIGH') {
                // High threat → AGGRESSIVE zone
                targetZone = ZONES.AGGRESSIVE;
                this.currentZone = 'AGGRESSIVE';
                console.log(`   🚨 HIGH threat detected → Starting in AGGRESSIVE zone`);
            } else if (this.defenseData.threatLevel === 'MEDIUM') {
                // Medium threat → BALANCED zone
                targetZone = ZONES.BALANCED;
                this.currentZone = 'BALANCED';
                console.log(`   ⚠️ MEDIUM threat detected → Starting in BALANCED zone`);
            } else if (this.safeZone && this.safeZone.successRate >= 0.70) {
                // Low threat + good safe zone → Use safe zone
                targetZone = this.safeZone;
                
                // Determine which zone the safe zone falls into
                if (this.safeZone.center >= ZONES.AGGRESSIVE.min && this.safeZone.center <= ZONES.AGGRESSIVE.max) {
                    this.currentZone = 'AGGRESSIVE';
                } else if (this.safeZone.center >= ZONES.BALANCED.min && this.safeZone.center <= ZONES.BALANCED.max) {
                    this.currentZone = 'BALANCED';
                } else {
                    this.currentZone = 'CONSERVATIVE';
                }
                
                console.log(`   ✅ LOW threat + good history → Starting in ${this.currentZone} zone (safe zone)`);
            } else {
                // Default → BALANCED zone
                targetZone = ZONES.BALANCED;
                this.currentZone = 'BALANCED';
                console.log(`   ℹ️ No strong signals → Starting in BALANCED zone`);
            }
            
            // Set initial timing to target zone center
            this.currentTiming = targetZone.center;
            this.lastAdjustmentReason = 'DB_INIT';
            
            console.log(`✅ Initialization complete:`);
            console.log(`   Initial Timing: ${this.currentTiming}ms`);
            console.log(`   Target Zone: ${this.currentZone} (${ZONES[this.currentZone].min}-${ZONES[this.currentZone].max}ms)`);
            console.log(`   Threat Level: ${this.defenseData.threatLevel}`);
            if (this.defenseData.averageRival) {
                console.log(`   ESTIMATED Average Rival: ${this.defenseData.averageRival}ms`);
            }
            
        } catch (error) {
            console.error('[Initialization] Error:', error);
            const ping = this.getCurrentPing ? this.getCurrentPing() : 100;
            // New timing ranges based on ping context
            if (ping < 50) {
                this.currentTiming = 2025; // FAST: 1975-2075ms
                this.currentZone = 'FAST';
            } else if (ping > 150) {
                this.currentTiming = 1825; // SLOW: 1775-1875ms
                this.currentZone = 'SLOW';
            } else {
                this.currentTiming = 1925; // NORMAL: 1875-1975ms
                this.currentZone = 'NORMAL';
            }
            this.lastAdjustmentReason = 'INIT';
        }
    }
    
    /**
     * Get optimal timing (called when AI is enabled)
     */
    async getOptimalTiming(timingType) {
        if (this.currentTiming === null) {
            await this.initializeFromDatabase();
        }
        
        console.log(`🧠 Intelligent ML Decision:`);
        console.log(`   Timing: ${this.currentTiming}ms`);
        console.log(`   Zone: ${this.currentZone}`);
        console.log(`   Converged: ${this.isConverged}`);
        console.log(`   Threat: ${this.defenseData.threatLevel}`);
        
        return this.currentTiming;
    }
    
    /**
     * SMART ZONE-BASED LEARNING (CORE ALGORITHM)
     * Learn from result and adjust timing intelligently
     */
    async getNextTiming(lastResult, timingType) {
        this.attemptCount++;
        
        // Track result
        this.recentResults.push(lastResult);
        if (this.recentResults.length > this.maxHistorySize) {
            this.recentResults.shift();
        }
        
        // Update statistics
        if (lastResult === 'SUCCESS') {
            this.successCount++;
            this.consecutiveSuccesses++;
            this.consecutiveFailures = 0;
            this.defenseData.consecutive3sErrors = 0;
            this.defenseData.lastResultWas3s = false;
        } else if (lastResult === 'FAILURE') {
            this.failureCount++;
            this.consecutiveFailures++;
            this.consecutiveSuccesses = 0;
            this.defenseData.consecutive3sErrors = 0;
            this.defenseData.lastResultWas3s = false;
        } else if (lastResult === '3S_ERROR') {
            this.errorCount++;
            this.consecutiveFailures = 0;
            this.consecutiveSuccesses = 0;
            this.defenseData.consecutive3sErrors++;
            this.defenseData.lastResultWas3s = true;
        }
        
        console.log(`\n📊 ========== SMART LEARNING ==========`);
        console.log(`📊 Result: ${lastResult} (Attempt ${this.attemptCount})`);
        console.log(`📊 Current: ${this.currentTiming}ms in ${this.currentZone} zone`);
        console.log(`📊 Stats: ${this.consecutiveSuccesses} successes, ${this.consecutiveFailures} failures, ${this.defenseData.consecutive3sErrors} 3S errors`);
        
        // Re-analyze every 10 attempts
        if (this.attemptCount % 10 === 0) {
            console.log(`🔄 Re-analyzing patterns (every 10 attempts)...`);
            await this.analyzeHistoricalPatterns();
            await this.analyzeDefenseData();
        }
        
        // 🎯 SMART DECISION TREE
        let newTiming = this.currentTiming;
        let adjustmentReason = '';
        
        // ========== RULE 1: 3S_ERROR = TOO FAST! Slow down 5-10ms ==========
        if (lastResult === '3S_ERROR') {
            // You're too fast, need to slow down
            // Decrease timing by 5-10ms to avoid the error
            const decrease = this.defenseData.consecutive3sErrors >= 2 ? 10 : 7;
            newTiming = this.currentTiming + decrease;
            adjustmentReason = `3S_ERROR (${this.defenseData.consecutive3sErrors}x) → +${decrease}ms (slow down)`;
            
            console.log(`🎯 RULE 1: 3S_ERROR detected → Slow down +${decrease}ms`);
        }
        
        // ========== RULE 2: SUCCESS = Oscillate in zone to find sweet spot ==========
        else if (lastResult === 'SUCCESS') {
            // Check if converged (3+ consecutive successes)
            if (this.consecutiveSuccesses >= 3) {
                this.isConverged = true;
                
                // Oscillate ±3-5ms to find perfect timing
                this.oscillationCount++;
                const oscillationSize = 4;
                
                // Change direction every 2 oscillations
                if (this.oscillationCount % 2 === 0) {
                    this.oscillationDirection *= -1;
                }
                
                newTiming = this.currentTiming + (this.oscillationDirection * oscillationSize);
                adjustmentReason = `SUCCESS (converged) → Oscillate ${this.oscillationDirection > 0 ? '+' : ''}${this.oscillationDirection * oscillationSize}ms`;
                
                console.log(`🎯 RULE 2: CONVERGED → Oscillate to find sweet spot`);
            } else {
                // Not converged yet, stay in current zone but move toward center
                const targetZone = ZONES[this.currentZone];
                const distanceToCenter = targetZone.center - this.currentTiming;
                
                if (Math.abs(distanceToCenter) > 5) {
                    // Move toward zone center
                    const moveSize = Math.min(8, Math.abs(distanceToCenter));
                    newTiming = this.currentTiming + (distanceToCenter > 0 ? moveSize : -moveSize);
                    adjustmentReason = `SUCCESS → Move ${moveSize}ms toward ${this.currentZone} center`;
                } else {
                    // Already near center, small oscillation
                    newTiming = this.currentTiming + (Math.random() < 0.5 ? 3 : -3);
                    adjustmentReason = `SUCCESS → Small oscillation ±3ms`;
                }
                
                console.log(`🎯 RULE 2: SUCCESS → Refining position in ${this.currentZone} zone`);
            }
        }
        
        // ========== RULE 3: FAILURE = Analyze and adjust zone ==========
        else if (lastResult === 'FAILURE') {
            // Check if we're getting kicked frequently (rival threat)
            if (this.consecutiveFailures >= 3 || this.defenseData.threatLevel === 'HIGH') {
                // Move to AGGRESSIVE zone to beat rivals
                const targetZone = ZONES.AGGRESSIVE;
                
                if (this.currentZone !== 'AGGRESSIVE') {
                    // Jump to AGGRESSIVE zone
                    newTiming = targetZone.center;
                    this.currentZone = 'AGGRESSIVE';
                    adjustmentReason = `FAILURE (${this.consecutiveFailures}x) → Jump to AGGRESSIVE zone (${targetZone.center}ms)`;
                    
                    console.log(`🎯 RULE 3: High threat → Jump to AGGRESSIVE zone`);
                } else {
                    // Already in AGGRESSIVE, move faster
                    newTiming = this.currentTiming - 10;
                    adjustmentReason = `FAILURE in AGGRESSIVE → Move faster -10ms`;
                    
                    console.log(`🎯 RULE 3: Already AGGRESSIVE → Move faster`);
                }
            } else {
                // Not a rival threat, might be too fast or too slow
                // Move toward BALANCED zone
                const targetZone = ZONES.BALANCED;
                const distanceToTarget = targetZone.center - this.currentTiming;
                
                if (Math.abs(distanceToTarget) > 20) {
                    // Far from BALANCED, jump there
                    newTiming = targetZone.center;
                    this.currentZone = 'BALANCED';
                    adjustmentReason = `FAILURE → Jump to BALANCED zone (${targetZone.center}ms)`;
                    
                    console.log(`🎯 RULE 3: FAILURE → Jump to BALANCED zone`);
                } else {
                    // Near BALANCED, small adjustment
                    newTiming = this.currentTiming + (distanceToTarget > 0 ? 8 : -8);
                    adjustmentReason = `FAILURE → Adjust ${distanceToTarget > 0 ? '+' : '-'}8ms toward BALANCED`;
                    
                    console.log(`🎯 RULE 3: FAILURE → Adjust toward BALANCED`);
                }
            }
            
            // Reset convergence
            this.isConverged = false;
            this.oscillationCount = 0;
        }
        
        // ========== RULE 4: No 3S errors = SUCCESS! Stay in zone, refine ==========
        // No 3S errors means your timing is good, not too fast
        // This is actually a GOOD sign - you're catching people successfully
        // Just continue refining within the current zone
        
        // ========== RULE 5: Fit timing perfectly into zone ==========
        // Ensure timing stays within zone bounds
        const currentZoneBounds = ZONES[this.currentZone];
        if (newTiming < currentZoneBounds.min) {
            newTiming = currentZoneBounds.min + 5;
            adjustmentReason += ` (clamped to ${this.currentZone} min)`;
        } else if (newTiming > currentZoneBounds.max) {
            newTiming = currentZoneBounds.max - 5;
            adjustmentReason += ` (clamped to ${this.currentZone} max)`;
        }
        
        // Apply global bounds
        newTiming = Math.max(MIN_TIMING, Math.min(MAX_TIMING, newTiming));
        
        // Update timing
        const oldTiming = this.currentTiming;
        this.currentTiming = newTiming;
        this.lastAdjustmentReason = adjustmentReason;
        
        // Check convergence
        this.checkConvergence();
        
        console.log(`🎯 DECISION: ${oldTiming}ms → ${this.currentTiming}ms`);
        console.log(`🎯 Reason: ${adjustmentReason}`);
        console.log(`🎯 Zone: ${this.currentZone} (${currentZoneBounds.min}-${currentZoneBounds.max}ms)`);
        console.log(`🎯 Converged: ${this.isConverged}`);
        console.log(`========================================\n`);
        
        return this.currentTiming;
    }
    
    /**
     * Record when a rival kicked you (SMART ESTIMATION)
     * @param {number} yourTimingWhenKicked - YOUR timing when you got kicked (not rival's!)
     */
    recordRivalAttack(yourTimingWhenKicked) {
        if (!yourTimingWhenKicked || yourTimingWhenKicked < MIN_TIMING || yourTimingWhenKicked > MAX_TIMING) {
            return;
        }
        
        this.defenseData.timesKicked++;
        this.defenseData.rivalTimings.push(yourTimingWhenKicked);
        
        // 🎯 SMART ESTIMATION: Rival was 40-80ms faster than your timing
        // If you got kicked at 1920ms, rival was probably using 1840-1880ms (AGGRESSIVE zone)
        const estimatedRivalTiming = yourTimingWhenKicked - 60; // Middle of 40-80ms range
        this.defenseData.estimatedRivalTimings.push(estimatedRivalTiming);
        
        // Keep only last 50
        if (this.defenseData.rivalTimings.length > 50) {
            this.defenseData.rivalTimings.shift();
            this.defenseData.estimatedRivalTimings.shift();
        }
        
        // Update statistics (use ESTIMATED timings)
        this.defenseData.fastestRival = Math.min(...this.defenseData.estimatedRivalTimings);
        const sum = this.defenseData.estimatedRivalTimings.reduce((a, b) => a + b, 0);
        this.defenseData.averageRival = Math.round(sum / this.defenseData.estimatedRivalTimings.length);
        
        console.log(`🛡️ KICKED! Your timing: ${yourTimingWhenKicked}ms`);
        console.log(`   ESTIMATED rival timing: ~${estimatedRivalTiming}ms (60ms faster)`);
        console.log(`   ESTIMATED fastest rival: ${this.defenseData.fastestRival}ms`);
        console.log(`   ESTIMATED average rival: ${this.defenseData.averageRival}ms`);
        
        // 🎯 IMMEDIATE ACTION: Move to AGGRESSIVE zone to beat this rival
        const targetZone = ZONES.AGGRESSIVE;
        if (this.currentTiming > targetZone.max) {
            console.log(`   🚨 ACTION: Moving to AGGRESSIVE zone (${targetZone.center}ms) to beat rival!`);
            this.currentTiming = targetZone.center;
            this.currentZone = 'AGGRESSIVE';
            this.isConverged = false;
            this.consecutiveFailures = 0;
            this.consecutiveSuccesses = 0;
        }
    }
    
    /**
     * Get adjustment reason
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
        
        return {
            attemptCount: this.attemptCount,
            totalAttempts: totalAttempts,
            successCount: this.successCount,
            successRate: successRate.toFixed(1),
            currentTiming: this.currentTiming,
            currentZone: this.currentZone,
            isConverged: this.isConverged,
            threatLevel: this.defenseData.threatLevel,
            attackAttempts: totalAttempts,
            attackSuccessRate: successRate.toFixed(1),
            defenseAttempts: 0,
            defenseSuccessRate: '0.0',
            timesKicked: this.defenseData.timesKicked,
            fastestRival: this.defenseData.fastestRival,
            averageRival: this.defenseData.averageRival,
            safeZoneCenter: this.safeZone?.center,
            safeZoneSuccessRate: this.safeZone ? (this.safeZone.successRate * 100).toFixed(0) : null,
            consecutive3sErrors: this.defenseData.consecutive3sErrors,
            consecutiveSuccesses: this.consecutiveSuccesses,
            consecutiveFailures: this.consecutiveFailures,
            isStuck: this.consecutiveFailures >= 5
        };
    }
    
    /**
     * Get defense statistics
     */
    getDefenseStats() {
        return {
            timesKicked: this.defenseData.timesKicked,
            fastestRival: this.defenseData.fastestRival,
            averageRival: this.defenseData.averageRival,
            threatLevel: this.defenseData.threatLevel,
            kickedRate: (this.defenseData.kickedRate * 100).toFixed(0),
            yourTiming: this.currentTiming,
            speedAdvantage: this.defenseData.averageRival ? 
                this.defenseData.averageRival - this.currentTiming : null
        };
    }
    
    /**
     * Reset for new session
     */
    reset() {
        this.recentResults = [];
        this.isConverged = false;
        console.log(`🔄 Intelligent ML Agent reset (timing preserved: ${this.currentTiming}ms)`);
    }
}

module.exports = { IntelligentMLAgent };
