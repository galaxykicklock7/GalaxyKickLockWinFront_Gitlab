/**
 * Smart ML Agent - Intelligent Cross-Range Exploration
 * 
 * FIXES:
 * - Old system was locked to YOUR ping range
 * - Couldn't adapt when opponent was in different range
 * - Took too many cycles to find optimal timing
 * 
 * NEW INTELLIGENCE:
 * - Detects opponent range in 2-3 attempts
 * - Explores cross-range patterns from database
 * - Validates safety before switching ranges
 * - Detects traps (alternating, baiting, boundary camping)
 * - Max 5 attempts to understand opponent
 * - Then uses fine-tuning for optimization
 * 
 * SCENARIOS HANDLED:
 * 1. Same Range: 1-2 attempts
 * 2. Different Range: 2-3 attempts (with safety validation)
 * 3. Boundary Camping: 3-4 attempts
 * 4. Alternating Trap: 3-4 attempts
 * 5. Baiting Trap: 4-5 attempts
 */

const { createClient } = require('@supabase/supabase-js');

// Timing bounds
const MIN_TIMING = 1600;
const MAX_TIMING = 2100;

// Zone definitions (based on ping context)
// CRITICAL: Higher ping = Need FASTER timing (lower ms value)
//           Lower ping = Need SLOWER timing (higher ms value)
const ZONES = {
    SLOW: { min: 1775, max: 1885, center: 1830 },   // High ping (>150ms) → Fast timing
    NORMAL: { min: 1885, max: 1995, center: 1940 }, // Normal ping (50-150ms)
    FAST: { min: 1995, max: 2100, center: 2035 }    // Low ping (<50ms) → Slow timing (extended to 2100)
};

class SmartMLAgent {
    constructor(userId, connectionNumber, supabaseUrl, supabaseKey, getCurrentPingFn, getContextFromPingFn, getOpponentCommandFn) {
            this.userId = userId;
            this.connectionNumber = connectionNumber;
            this.supabase = null;
            this.getCurrentPing = getCurrentPingFn;
            this.getContextFromPing = getContextFromPingFn;
            this.getOpponentCommand = getOpponentCommandFn;

            // Initialize Supabase client
            if (supabaseUrl && supabaseKey) {
                try {
                    const { createClient } = require('@supabase/supabase-js');
                    this.supabase = createClient(supabaseUrl, supabaseKey);
                    console.log(`✅ Supabase client initialized for SmartMLAgent`);
                } catch (error) {
                    console.error('❌ Failed to initialize Supabase:', error);
                }
            }

            // Core timing state
            this.currentTiming = 1925; // Start with NORMAL range center
            this.currentZone = 'NORMAL';

            // Tracking
            this.attemptCount = 0;
            this.successCount = 0;
            this.errorCount = 0;
            this.consecutiveSuccesses = 0;
            this.consecutiveKicked = 0;
            this.lastSuccessTiming = null;
            this.last3sErrorTiming = null;
            this.lastAdjustmentReason = 'INIT';

            // ✅ NEW: Track current rival name for hybrid learning
            this.currentRivalName = null;
            this.lastRivalName = null;

            // ✅ NEW: Full DB cache - loaded once on start, updated incrementally
            this.fullDBCache = {
                allRecords: [],           // ALL records from DB
                rivalIndex: {},           // Per-rival index: { 'daniel': [...records], 'адидас': [...records] }
                lastFetchTime: null,      // Last time we fetched from DB
                isInitialized: false      // Has initial full load completed?
            };

            // ✅ NEW: Hybrid database learning cache (legacy - will be replaced by fullDBCache)
            this.hybridLearningCache = {
                specificRival: null,      // Data for current rival
                generalRivals: null,      // Data for all rivals
                lastQueryAttempt: 0,      // Last attempt when we queried
                confidence: 0             // Confidence in cached data
            };

            // Defense tracking
            this.defenseData = {
                timesKicked: 0,
                rivalAttackTimings: [],
                lastKickedAt: null
            };

            // Result history
            this.recentResults = [];
            this.maxHistorySize = 20;

            // Opponent intelligence tracking
            this.opponentIntelligence = {
                opponentLeavingTimes: [],
                opponentRange: null,
                opponentVariance: 0,
                explorationPhase: true,
                explorationAttempts: 0,
                maxExplorationAttempts: 10,
                lastRangeSwitch: null,
                rangeConfidence: 0,
                resultPattern: [],      // ✅ FIX: Added for detectOpponentRange
                timingPattern: []       // ✅ FIX: Added for detectOpponentRange
            };

            // ✅ FIX: Range exploration tracking
            this.rangeExploration = {
                rangesTried: [],
                needsRangeSwitch: false,
                switchReason: null
            };

            // Sweet spot tracking
            this.sweetSpotData = {
                successTimings: [],     // ✅ FIX: Changed from center/radius/attempts/successes
                kickTimings: []         // ✅ FIX: Match expected shape
            };
            
            // ✅ Stay Behind Strategy
            this.stayBehindStrategy = {
                enabled: true,
                rivalTiming: null,        // When rival actually kicks (from LEFT_EARLY)
                targetTiming: null,       // Our target timing (rival - offset)
                offset: 25,               // Stay 25ms behind rival
                stepSize: 10,             // Adjustment step size
                sweetSpotFound: false,
                sweetSpotRange: { min: null, max: null },
                // ✅ PHASE 1: Stuck detection
                consecutiveErrorsInRange: 0,
                lastErrorRange: null,
                // ✅ PHASE 1: Gap-aware movement tracking
                myHistory: [],
                // ✅ PHASE 3: Bayesian zone probability
                zoneProbs: { SLOW: 0.33, NORMAL: 0.34, FAST: 0.33 },
                bestZone: 'NORMAL',
                zoneConf: 0.34,
                // ✅ PHASE 4: Freeze/bait counter system
                leftEarlyCount: 0,
                noConfirmCount: 0,
                wasFrozen: false,
                // ✅ PHASE 4: Oscillation detection
                boundaryLog: [],
                oscMode: false,
                oscMidpoint: null,
                lastZone: null,
                sameZoneCount: 0
            };

            // Database requery flags
            this.shouldRequeryDatabase = false;
            this.requeryTimingType = 'attack';
        }

    /**
     * ✅ NEW: Linear interpolation helper for smooth movement
     * @param {number} start - Starting value
     * @param {number} end - Target value
     * @param {number} t - Interpolation factor (0.0 to 1.0)
     * @returns {number} - Interpolated value
     */
    lerp(start, end, t) {
        return Math.round(start + (end - start) * t);
    }

    /**
     * ✅ PHASE 3: Bayesian zone probability update
     * Updates zone probabilities based on signal credibility
     * @param {number} rawOppTime - Opponent timing from signal
     * @param {string} signal - Signal type (SUCCESS, KICKED, 3S_ERROR, LEFT_EARLY)
     */
    updateZoneProbs(rawOppTime, signal) {
        const CRED = {
            'SUCCESS': 1.0,
            'KICKED': 0.9,
            '3S_ERROR': 0.5,
            'LEFT_EARLY': 0.2,
            'NONE': 0.35
        };
        
        const cred = CRED[signal] || 0.35;
        const strategy = this.stayBehindStrategy;
        
        // Calculate probability for each zone based on distance
        for (const zoneName in ZONES) {
            const zone = ZONES[zoneName];
            const dist = Math.abs(rawOppTime - zone.center);
            const prob = 1 / (1 + dist / 100);
            
            // Bayesian update: blend old belief with new evidence
            strategy.zoneProbs[zoneName] = 
                (strategy.zoneProbs[zoneName] * (1 - cred)) + (prob * cred);
        }
        
        // Normalize probabilities to sum = 1.0
        const sum = Object.values(strategy.zoneProbs).reduce((a, b) => a + b, 0);
        for (const zoneName in strategy.zoneProbs) {
            strategy.zoneProbs[zoneName] /= sum;
        }
        
        // Update best zone and confidence
        const best = Object.entries(strategy.zoneProbs)
            .sort((a, b) => b[1] - a[1])[0];
        strategy.bestZone = best[0];
        strategy.zoneConf = best[1];
        
        console.log(`📊 Zone probs: SLOW=${(strategy.zoneProbs.SLOW*100).toFixed(0)}% NORMAL=${(strategy.zoneProbs.NORMAL*100).toFixed(0)}% FAST=${(strategy.zoneProbs.FAST*100).toFixed(0)}% → Best: ${strategy.bestZone} (${(strategy.zoneConf*100).toFixed(0)}%)`);
    }

    
    /**
     * Detect opponent speed based on their command (JOIN vs 353)
     * CRITICAL INTELLIGENCE: Command type reveals opponent's relative speed
     */
    detectOpponentSpeedFromCommand() {
        if (!this.getOpponentCommand) {
            return null;
        }
        
        const opponentCmd = this.getOpponentCommand();
        
        if (!opponentCmd) {
            return null;
        }
        
        this.opponentIntelligence.opponentCommand = opponentCmd;
        
        if (opponentCmd === '353') {
            // Opponent is in DEFENSE (353) → They got in first → They're FASTER or NORMAL
            console.log(`🎯 COMMAND INTELLIGENCE: Opponent in 353 (DEFENSE) → They're FASTER/NORMAL`);
            console.log(`   → Our bot should use SLOW/NORMAL range (slower timings)`);
            
            this.opponentIntelligence.opponentSpeed = 'FASTER';
            
            return {
                opponentSpeed: 'FASTER',
                recommendedRanges: ['SLOW', 'NORMAL'],
                confidence: 80,
                reason: 'OPPONENT_IN_DEFENSE'
            };
            
        } else if (opponentCmd === 'JOIN') {
            // Opponent is in ATTACK (JOIN) → They're still trying to get in → We're FASTER
            console.log(`🎯 COMMAND INTELLIGENCE: Opponent in JOIN (ATTACK) → We're FASTER`);
            console.log(`   → Our bot should use NORMAL/FAST range (faster timings)`);
            
            this.opponentIntelligence.opponentSpeed = 'SLOWER';
            
            return {
                opponentSpeed: 'SLOWER',
                recommendedRanges: ['NORMAL', 'FAST'],
                confidence: 80,
                reason: 'OPPONENT_IN_ATTACK'
            };
        }
        
        return null;
    }
    
    /**
     * Get next higher range (for slower opponents)
     */
    getNextHigherRange(currentRange) {
        const rangeOrder = ['FAST', 'NORMAL', 'SLOW'];
        const currentIndex = rangeOrder.indexOf(currentRange);
        
        if (currentIndex < rangeOrder.length - 1) {
            return rangeOrder[currentIndex + 1];
        }
        
        return currentRange;
    }
    
    /**
     * Get next lower range (for faster opponents)
     */
    getNextLowerRange(currentRange) {
        const rangeOrder = ['FAST', 'NORMAL', 'SLOW'];
        const currentIndex = rangeOrder.indexOf(currentRange);
        
        if (currentIndex > 0) {
            return rangeOrder[currentIndex - 1];
        }
        
        return currentRange;
    }
    
    /**
     * Detect if opponent is using alternating strategy
     */
    isAlternatingPattern(pattern) {
        if (pattern.length < 3) return false;
        
        const last4 = pattern.slice(-4);
        
        if (last4.length === 4) {
            return (last4[0] !== last4[1] && 
                    last4[1] !== last4[2] && 
                    last4[2] !== last4[3]);
        }
        
        return false;
    }
    
    /**
     * Detect baiting trap (3S then sudden KICKED)
     */
    isBaitingTrap(pattern) {
        if (pattern.length < 4) return false;
        
        const last4 = pattern.slice(-4);
        
        const multiple3s = last4.slice(0, 3).every(r => r === '3S_ERROR');
        const thenKicked = last4[3] === 'KICKED';
        
        return multiple3s && thenKicked;
    }
    
    /**
     * Helper: Determine which range a timing belongs to
     */
    getRangeFromTiming(timing) {
        if (timing >= ZONES.SLOW.min && timing <= ZONES.SLOW.max) {
            return 'SLOW';
        } else if (timing >= ZONES.NORMAL.min && timing <= ZONES.NORMAL.max) {
            return 'NORMAL';
        } else if (timing >= ZONES.FAST.min && timing <= ZONES.FAST.max) {
            return 'FAST';
        }
        return null;
    }
    
    /**
     * Track opponent's leaving time and detect baiting behavior
     * CRITICAL: This prevents falling for traps where opponent leaves early to bait us into faster range
     */
    trackOpponentLeaving(opponentLeftTime, result) {
        const intel = this.opponentIntelligence;
        
        // Handle KICKED result (opponent kicked us)
        if (result === 'KICKED') {
            intel.gotKickedCount = (intel.gotKickedCount || 0) + 1;
            console.log(`🔴 [KICKED] Got kicked by opponent! Total kicks: ${intel.gotKickedCount}`);
            
            // Store KICKED event without opponent leaving time (we don't know when they left)
            intel.opponentLeavingTimes.push({
                time: null,
                result: 'KICKED',
                ourTiming: this.currentTiming,
                timestamp: Date.now()
            });
            
            // Keep only last 10 events
            if (intel.opponentLeavingTimes.length > 10) {
                intel.opponentLeavingTimes.shift();
            }
            return;
        }
        
        // Only track if we have valid opponent leaving time
        if (!opponentLeftTime || opponentLeftTime <= 0) {
            return;
        }
        
        intel.lastOpponentLeaveTime = opponentLeftTime;
        intel.opponentLeavingTimes.push({
            time: opponentLeftTime,
            result: result,
            ourTiming: this.currentTiming,
            timestamp: Date.now()
        });
        
        // Keep only last 10 opponent leaving times
        if (intel.opponentLeavingTimes.length > 10) {
            intel.opponentLeavingTimes.shift();
        }
        
        console.log(`📊 Opponent left at: ${opponentLeftTime}ms (Result: ${result}, Our timing: ${this.currentTiming}ms)`);
    }
    
    /**
     * ✅ ENHANCED: Stay Behind Rival Strategy - ALL PHASES COMPLETE
     * PHASE 1: lerp() gap-aware movement, stuck detection, hard cap, overshoot brake
     * PHASE 3: Bayesian zone probability updates
     * PHASE 4: Freeze/bait counter, oscillation detection, belief flush
     * 
     * Uses LEFT_EARLY data to position bot BEHIND rival's timing
     * Approach from behind using 3S_ERROR as progress indicator
     */
    updateStayBehindStrategy(opponentLeftTime, result) {
        const strategy = this.stayBehindStrategy;
        
        console.log(`\n🎯 ========== STAY BEHIND STRATEGY UPDATE ==========`);
        console.log(`🎯 Result: ${result}`);
        console.log(`🎯 Opponent left time: ${opponentLeftTime}ms`);
        console.log(`🎯 Current bot timing: ${this.currentTiming}ms`);
        
        // ✅ PHASE 4: Belief flush on freeze exit
        if (strategy.wasFrozen && result !== 'LEFT_EARLY') {
            console.log(`🔄 [BELIEF FLUSH] Clearing stale data after freeze`);
            
            // Clear rival timing
            strategy.rivalTiming = null;
            strategy.targetTiming = null;
            
            // Reset zone probabilities
            strategy.zoneProbs = { SLOW: 0.33, NORMAL: 0.34, FAST: 0.33 };
            strategy.bestZone = 'NORMAL';
            strategy.zoneConf = 0.34;
            
            // Reset counters
            strategy.leftEarlyCount = 0;
            strategy.noConfirmCount = 0;
            
            // Clear oscillation
            strategy.boundaryLog = [];
            strategy.oscMode = false;
            
            // Clear opponent leaving times (trap data)
            this.opponentIntelligence.opponentLeavingTimes = [];
            
            strategy.wasFrozen = false;
        }
        // ✅ CRITICAL: Use ABSOLUTE bounds across all zones
        const pingMs = this.getCurrentPing();
        const context = this.getContextFromPing();
        
        const minSafeTiming = 1775;  // SLOW zone min (absolute minimum)
        const maxSafeTiming = 2100;  // Absolute maximum (extended to cover all zones)
        
        console.log(`🛡️ [BOUNDS] Ping: ${pingMs}ms (${context}) → Absolute safe range: ${minSafeTiming}-${maxSafeTiming}ms`);
        
        // ✅ CRITICAL: Filter out BAITING/TRAP LEFT_EARLY times
        if (opponentLeftTime && opponentLeftTime < minSafeTiming) {
            console.log(`⚠️ [TRAP DETECTED] Opponent left at ${opponentLeftTime}ms < ${minSafeTiming}ms minimum`);
            console.log(`   → IGNORING this LEFT_EARLY data (rival is BAITING/TRAPPING)`);
            opponentLeftTime = null;
        }
        
        // ✅ PHASE 3: Update Bayesian zone probabilities
        if (opponentLeftTime && opponentLeftTime > 0) {
            this.updateZoneProbs(opponentLeftTime, 'LEFT_EARLY');
        } else if (result === 'SUCCESS') {
            this.updateZoneProbs(this.currentTiming, 'SUCCESS');
        } else if (result === 'KICKED') {
            this.updateZoneProbs(this.currentTiming, 'KICKED');
        } else if (result === '3S_ERROR') {
            this.updateZoneProbs(this.currentTiming, '3S_ERROR');
        }
        
        // ✅ PHASE 4: Track LEFT_EARLY and no-confirm counts
        if (result === 'LEFT_EARLY') {
            strategy.leftEarlyCount++;
        } else if (result !== 'SUCCESS' && result !== 'KICKED') {
            strategy.noConfirmCount++;
        }
        
        // ✅ PHASE 4: Oscillation detection
        if (opponentLeftTime && opponentLeftTime > 0) {
            const newZone = this.getRangeFromTiming(opponentLeftTime);
            if (newZone !== strategy.lastZone && strategy.lastZone !== null) {
                strategy.boundaryLog.push(Date.now());
                strategy.sameZoneCount = 0;
                console.log(`🔄 [OSC] Zone boundary crossed: ${strategy.lastZone} → ${newZone}`);
            } else {
                strategy.sameZoneCount++;
            }
            strategy.lastZone = newZone;
            
            // Filter to last 2500ms
            strategy.boundaryLog = strategy.boundaryLog.filter(
                t => Date.now() - t < 2500
            );
            
            // Detect oscillation
            if (strategy.boundaryLog.length >= 2) {
                strategy.oscMode = true;
                // ✅ FIXED: Track minimum rival timing instead of midpoint
                // Bot should stay behind the LOWEST timing to avoid getting kicked
                if (!strategy.oscMinTiming || opponentLeftTime < strategy.oscMinTiming) {
                    strategy.oscMinTiming = opponentLeftTime;
                }
                console.log(`🔄 [OSC MODE] Rival bouncing zones (${strategy.boundaryLog.length} crossings in 2.5s)`);
                console.log(`   Minimum rival timing: ${strategy.oscMinTiming}ms`);
            }
            
            // Auto-exit oscillation mode
            if (strategy.oscMode && strategy.sameZoneCount >= 3) {
                strategy.oscMode = false;
                strategy.boundaryLog = [];
                strategy.oscMinTiming = null; // Reset min timing
                console.log(`✅ [OSC EXIT] Rival stable in ${newZone} zone`);
            }
        }
        
        // ✅ PHASE 4: Check freeze condition (bait detection)
        const gap = strategy.rivalTiming ? Math.abs(strategy.rivalTiming - this.currentTiming) : 0;
        if (strategy.leftEarlyCount >= 2 && strategy.noConfirmCount >= 3) {
            const leftEarlyZone = opponentLeftTime ? this.getRangeFromTiming(opponentLeftTime) : null;
            if (leftEarlyZone && leftEarlyZone !== strategy.bestZone) {
                strategy.wasFrozen = true;
                console.log(`❄️ [FREEZE] Bait detected: ${strategy.leftEarlyCount} LEFT_EARLY in ${leftEarlyZone}, but bestZone is ${strategy.bestZone}`);
                console.log(`   → FREEZING (not moving)`);
                console.log(`🎯 ========== STAY BEHIND STRATEGY END ==========\n`);
                return; // Don't move
            }
        }
        
        // ✅ PHASE 4: Auto-unfreeze when gap is large
        if (strategy.wasFrozen && gap > 80) {
            strategy.wasFrozen = false;
            strategy.leftEarlyCount = 0;
            strategy.noConfirmCount = 0;
            console.log(`🔓 [UNFREEZE] Gap too large (${gap}ms), chasing rival`);
        }
        
        // ✅ MULTI-RIVAL FIX: Update rival timing from LEFT_EARLY data
        // Check if this is an OLD rival (in DB) or NEW rival
        if (opponentLeftTime && opponentLeftTime > 0) {
            const previousRivalTiming = strategy.rivalTiming;
            
            // ✅ PHASE 4: Check freeze condition BEFORE updating rivalTiming
            // If we're getting LEFT_EARLY in a different zone than bestZone, it might be bait
            if (strategy.leftEarlyCount >= 2 && strategy.noConfirmCount >= 3) {
                const leftEarlyZone = this.getRangeFromTiming(opponentLeftTime);
                if (leftEarlyZone && leftEarlyZone !== strategy.bestZone) {
                    strategy.wasFrozen = true;
                    console.log(`❄️ [FREEZE] Bait detected: ${strategy.leftEarlyCount} LEFT_EARLY in ${leftEarlyZone}, but bestZone is ${strategy.bestZone}`);
                    console.log(`   → FREEZING (ignoring this LEFT_EARLY)`);
                    console.log(`🎯 ========== STAY BEHIND STRATEGY END ==========\n`);
                    return; // Don't update rivalTiming, don't move
                }
            }
            
            // ✅ MULTI-RIVAL: Check if we have DB data for this rival (from fullDBCache)
            // This tells us if it's an OLD rival (in DB) or NEW rival
            const rivalData = this.getRivalOptimalTiming(this.currentRivalName);
            const isOldRival = rivalData !== null && rivalData.isOldRival;
            const hasValidData = rivalData !== null && rivalData.hasValidData;
            
            if (isOldRival) {
                console.log(`🔄 [MULTI-RIVAL] OLD rival "${this.currentRivalName}" detected in DB`);
                console.log(`   DB Records: ${rivalData.recordCount} | LEFT_EARLY: ${rivalData.leftEarlyCount} | SUCCESS: ${rivalData.successCount} | KICKED: ${rivalData.kickedCount} | 3S_ERROR: ${rivalData.error3sCount}`);
                if (hasValidData) {
                    console.log(`   DB Optimal: ${rivalData.optimalTiming}ms | Confidence: ${rivalData.confidence}% | Source: ${rivalData.dataSource}`);
                } else {
                    console.log(`   ⚠️ No valid timing data (${rivalData.reason})`);
                }
            } else {
                console.log(`🆕 [MULTI-RIVAL] NEW rival "${this.currentRivalName}" - not in DB`);
            }
            
            // ✅ MULTI-RIVAL: If we already have a stable position, be conservative with LEFT_EARLY
            if (previousRivalTiming) {
                const timingDiff = Math.abs(opponentLeftTime - previousRivalTiming);
                
                // If new LEFT_EARLY is very different (>100ms), check if it's from DB or truly new
                if (timingDiff > 100) {
                    // If we have DB data for this specific rival, use it (OLD rival)
                    if (isOldRival && hasValidData && rivalData.confidence >= 30) {
                        const dbOptimalTiming = rivalData.optimalTiming;
                        console.log(`   Current: ${previousRivalTiming}ms | LEFT_EARLY: ${opponentLeftTime}ms | Diff: ${timingDiff}ms`);
                        
                        // Use weighted average between DB optimal and new LEFT_EARLY
                        const weight = 0.4; // 40% new data, 60% DB data
                        strategy.rivalTiming = Math.round(dbOptimalTiming * (1 - weight) + opponentLeftTime * weight);
                        console.log(`   → Weighted update: ${strategy.rivalTiming}ms (DB weight: ${1-weight})`);
                    } else if (isOldRival && !hasValidData) {
                        // OLD rival but no valid data - accept new LEFT_EARLY cautiously
                        console.log(`   ⚠️ OLD rival but no valid DB data - accepting new LEFT_EARLY cautiously`);
                        const weight = 0.7; // 70% new data, 30% current (more trust in new data)
                        strategy.rivalTiming = Math.round(previousRivalTiming * (1 - weight) + opponentLeftTime * weight);
                        console.log(`   → Weighted update: ${strategy.rivalTiming}ms (new weight: ${weight})`);
                    } else {
                        // No DB data - this might be a NEW rival or different timing
                        // Ignore if too different (treat as noise)
                        console.log(`🚫 [MULTI-RIVAL] Ignoring LEFT_EARLY ${opponentLeftTime}ms (diff ${timingDiff}ms from current ${previousRivalTiming}ms)`);
                        console.log(`   → No DB data for this rival, treating as noise/different timing`);
                        console.log(`🎯 ========== STAY BEHIND STRATEGY END ==========\n`);
                        return; // Don't update, don't move
                    }
                } else {
                    // Close timing (≤100ms) - use weighted average for smooth adjustment
                    const weight = 0.3; // 30% new data, 70% existing (conservative)
                    strategy.rivalTiming = Math.round(previousRivalTiming * (1 - weight) + opponentLeftTime * weight);
                    console.log(`🎯 [MULTI-RIVAL] Weighted update: ${previousRivalTiming}ms → ${strategy.rivalTiming}ms (new: ${opponentLeftTime}ms, weight: ${weight})`);
                }
            } else {
                // First time - check if we have DB data for this rival
                if (isOldRival && hasValidData && rivalData.confidence >= 30) {
                    const dbOptimalTiming = rivalData.optimalTiming;
                    console.log(`   DB Optimal: ${dbOptimalTiming}ms | LEFT_EARLY: ${opponentLeftTime}ms`);
                    
                    // Use weighted average between DB optimal and new LEFT_EARLY
                    const weight = 0.4; // 40% new data, 60% DB data
                    strategy.rivalTiming = Math.round(dbOptimalTiming * (1 - weight) + opponentLeftTime * weight);
                    console.log(`   → Using DB data: ${strategy.rivalTiming}ms (DB weight: ${1-weight})`);
                } else if (isOldRival && !hasValidData) {
                    // OLD rival but no valid data - accept LEFT_EARLY
                    console.log(`   ⚠️ OLD rival but no valid DB data - accepting LEFT_EARLY`);
                    strategy.rivalTiming = opponentLeftTime;
                    console.log(`   → Initial timing: ${strategy.rivalTiming}ms`);
                } else {
                    // Truly new rival - accept LEFT_EARLY
                    strategy.rivalTiming = opponentLeftTime;
                    console.log(`🎯 [STAY BEHIND] NEW rival - Initial timing: ${opponentLeftTime}ms`);
                }
            }
            
            // ✅ CRITICAL: Check if we're ahead FIRST (before repositioning)
            const currentGap = strategy.rivalTiming - this.currentTiming;
            if (currentGap < 0) {
                // We're AHEAD! Snap back immediately
                console.log(`🚨 [AHEAD DETECTED] Bot ahead by ${Math.abs(currentGap)}ms! Snapping back immediately`);
                strategy.offset = 25; // Reset offset
                this.currentTiming = strategy.rivalTiming - strategy.offset;
                this.currentTiming = Math.max(minSafeTiming, Math.min(maxSafeTiming, this.currentTiming));
                console.log(`🎯 [SNAP BACK] Repositioned to ${this.currentTiming}ms`);
                console.log(`🎯 ========== STAY BEHIND STRATEGY END ==========\n`);
                return;
            }
            
            // Detect if rival changed timing significantly (after weighted average)
            if (previousRivalTiming && Math.abs(strategy.rivalTiming - previousRivalTiming) > 20) {
                const timingChange = strategy.rivalTiming - previousRivalTiming;
                console.log(`🎯 [STAY BEHIND] Rival timing changed by ${timingChange > 0 ? '+' : ''}${timingChange}ms`);
                
                // Reposition using lerp for smooth transition
                strategy.targetTiming = strategy.rivalTiming - strategy.offset;
                const step = 0.72; // Large step for repositioning
                this.currentTiming = this.lerp(this.currentTiming, strategy.targetTiming, step);
                console.log(`🎯 [STAY BEHIND] Repositioned with lerp (step ${step}): ${this.currentTiming}ms`);
                
                this.currentTiming = Math.max(minSafeTiming, Math.min(maxSafeTiming, this.currentTiming));
                console.log(`🎯 ========== STAY BEHIND STRATEGY END ==========\n`);
                return;
            }
            
            // First time seeing rival timing
            if (!strategy.targetTiming) {
                strategy.targetTiming = strategy.rivalTiming - strategy.offset;
                this.currentTiming = strategy.targetTiming;
                console.log(`🎯 [STAY BEHIND] Initial positioning ${strategy.offset}ms behind rival: ${this.currentTiming}ms`);
            }
        }
        
        // ✅ Calculate gap for lerp-based movement
        let step = 0.16; // Default fine-tune step
        let target = this.currentTiming;
        
        // ✅ IMPROVED: Handle oscillation mode
        if (strategy.oscMode) {
            // ✅ FIXED: Stay behind the MINIMUM rival timing to avoid getting kicked
            // When rival oscillates (e.g., 1850ms ↔ 1950ms), bot stays at 1825ms (25ms behind 1850ms)
            // This way bot never gets kicked, only gets 3S_ERROR (safe)
            const targetTiming = strategy.oscMinTiming - 25; // 25ms behind minimum
            step = 0.72; // Move to target position
            target = targetTiming;
            this.currentTiming = this.lerp(this.currentTiming, target, step);
            console.log(`🔄 [OSC MODE] Staying behind minimum rival timing (${strategy.oscMinTiming}ms)`);
            console.log(`   Target: ${targetTiming}ms (25ms behind minimum)`);
            console.log(`   Current: ${this.currentTiming}ms`);
            console.log(`🎯 ========== STAY BEHIND STRATEGY END ==========\n`);
            return;
        }
        
        // Handle results with lerp-based gap-aware movement
        if (result === '3S_ERROR') {
            console.log(`⚠️ [STAY BEHIND] 3S_ERROR = Too fast! Slowing down...`);
            
            // ✅ IMPROVED: Stuck detection ONLY when we have rivalTiming
            // When exploring blindly (no rivalTiming), don't use stuck detection
            // Let the bot consistently move forward with +25ms steps
            if (strategy.rivalTiming) {
                const range = Math.floor(this.currentTiming / 50) * 50;
                if (strategy.lastErrorRange === range) {
                    strategy.consecutiveErrorsInRange++;
                } else {
                    strategy.consecutiveErrorsInRange = 1;
                    strategy.lastErrorRange = range;
                }
                
                // Aggressive escape if stuck (when we have rivalTiming but it might be wrong)
                if (strategy.consecutiveErrorsInRange >= 10) {
                    console.log(`🚨 [STUCK DETECTED] ${strategy.consecutiveErrorsInRange} consecutive 3S_ERROR in ${range}ms range!`);
                    console.log(`   → AGGRESSIVE ESCAPE: Jumping +100ms AND clearing trap rivalTiming`);
                    this.currentTiming += 100;
                    strategy.consecutiveErrorsInRange = 8; // Keep high to disable hard cap
                    strategy.lastErrorRange = null;
                    // Clear trap rivalTiming - it's clearly wrong!
                    strategy.rivalTiming = null;
                    strategy.targetTiming = null;
                }
            } else {
                // No rivalTiming - reset stuck counter (we're exploring, not stuck)
                strategy.consecutiveErrorsInRange = 0;
                strategy.lastErrorRange = null;
            }
            
            // Movement logic
            if (!strategy.rivalTiming) {
                // ✅ FIXED: No GPS signal - explore consistently with +25ms steps
                // Don't use stuck detection during blind exploration
                const moveAmount = 25;
                const oldTiming = this.currentTiming;
                this.currentTiming += moveAmount;
                
                // Apply only absolute bounds (no hard cap, no overshoot brake)
                this.currentTiming = Math.max(minSafeTiming, Math.min(maxSafeTiming, this.currentTiming));
                
                console.log(`🎯 [BLIND EXPLORATION] No rival data, moving +${moveAmount}ms: ${oldTiming}ms → ${this.currentTiming}ms`);
                console.log(`🎯 ========== STAY BEHIND STRATEGY END ==========\n`);
                return; // ✅ EXIT immediately - don't let other logic interfere!
            } else {
                // ✅ ENHANCED: More aggressive movement to get closer to rival timing
                // Goal: Get as close as possible to rival timing to maximize success rate
                // Even if we're slightly fast, we still get 3S_ERROR, so we need to be aggressive
                
                // Calculate how much we need to move to get close to rival
                const targetGap = 8; // Target: stay 8ms behind rival
                const currentGap = strategy.rivalTiming - this.currentTiming;
                
                if (currentGap > targetGap) {
                    // We're too far behind - move aggressively closer
                    if (gap > 80) step = 0.85;      // Very far: very big jump (85% of gap)
                    else if (gap > 40) step = 0.72; // Far: big jump (72% of gap)
                    else if (gap > 20) step = 0.60; // Medium: medium jump (60% of gap)
                    else if (gap > 10) step = 0.45; // Close: smaller jump (45% of gap)
                    else step = 0.30;               // Very close: careful approach (30% of gap)
                    
                    // If stuck (high error count), ignore rivalTiming and explore upward
                    if (strategy.consecutiveErrorsInRange >= 8) {
                        target = this.currentTiming + 50; // Explore upward
                    } else {
                        target = strategy.rivalTiming - targetGap; // Target: 8ms behind rival
                    }
                    
                    const oldTiming = this.currentTiming;
                    this.currentTiming = this.lerp(this.currentTiming, target, step);
                    
                    // ✅ CRITICAL FIX: Ensure minimum +1ms movement to prevent getting stuck
                    if (this.currentTiming === oldTiming) {
                        this.currentTiming = oldTiming + 1;
                        console.log(`   ⚠️ Lerp resulted in 0 movement, forcing +1ms`);
                    }
                    
                    const actualMove = this.currentTiming - oldTiming;
                    console.log(`🎯 [AGGRESSIVE 3S] Gap: ${gap}ms → Moving +${actualMove}ms (step ${step}) → ${this.currentTiming}ms`);
                    console.log(`   Target: Get within ${targetGap}ms of rival (${strategy.rivalTiming}ms)`);
                } else {
                    // We're already close to target gap - fine-tune
                    step = 0.16;
                    target = strategy.rivalTiming - targetGap;
                    const oldTiming = this.currentTiming;
                    this.currentTiming = this.lerp(this.currentTiming, target, step);
                    
                    // ✅ CRITICAL FIX: Ensure minimum +1ms movement to prevent getting stuck
                    if (this.currentTiming === oldTiming) {
                        this.currentTiming = oldTiming + 1;
                        console.log(`   ⚠️ Lerp resulted in 0 movement, forcing +1ms`);
                    }
                    
                    console.log(`🎯 [FINE-TUNE 3S] Already close (gap ${gap}ms), fine-tuning: ${oldTiming}ms → ${this.currentTiming}ms`);
                }
            }
            
        } else if (result === 'SUCCESS') {
            console.log(`🎉 [STAY BEHIND] SUCCESS! Sweet spot found at ${this.currentTiming}ms`);
            strategy.sweetSpotFound = true;
            strategy.sweetSpotRange.max = this.currentTiming;
            strategy.consecutiveErrorsInRange = 0; // Reset stuck counter
            
            // ✅ IMPROVED: Gap-aware SUCCESS handling
            // If gap is large (>50ms), we're too far behind - move UP to get closer
            // If gap is optimal (15-50ms), fine-tune downward to test lower bound
            if (gap > 50 && !strategy.rivalTiming) {
                // No rivalTiming and large gap - move up to get closer
                const moveAmount = 15;
                this.currentTiming += moveAmount;
                console.log(`🎯 [SUCCESS+FAR] Gap too large (${gap}ms), moving up +${moveAmount}ms: ${this.currentTiming}ms`);
            } else {
                // Normal fine-tuning - test lower bound
                step = 0.92;
                target = this.currentTiming - 5;
                this.currentTiming = this.lerp(this.currentTiming, target, step);
                console.log(`🎯 [LERP] Testing lower bound with step ${step}: ${this.currentTiming}ms`);
            }
            
        } else if (result === 'KICKED') {
            console.log(`⚠️ [STAY BEHIND] KICKED! Rival is faster than expected`);
            strategy.consecutiveErrorsInRange = 0; // Reset stuck counter
            
            if (strategy.rivalTiming) {
                // Check if we're ahead of rival (negative gap)
                const currentGap = strategy.rivalTiming - this.currentTiming;
                
                if (currentGap < 0) {
                    // We're AHEAD! Snap back immediately
                    console.log(`🚨 [AHEAD DETECTED] Bot ahead by ${Math.abs(currentGap)}ms! Snapping back immediately`);
                    strategy.offset = 25; // Reset offset
                    this.currentTiming = strategy.rivalTiming - strategy.offset;
                    console.log(`🎯 [SNAP BACK] Repositioned to ${this.currentTiming}ms`);
                } else {
                    // We're behind but got kicked - increase offset
                    strategy.offset += 20;
                    target = strategy.rivalTiming - strategy.offset;
                    step = 0.85; // Evade snap
                    this.currentTiming = this.lerp(this.currentTiming, target, step);
                    console.log(`🎯 [LERP] Increased offset to ${strategy.offset}ms, step ${step}: ${this.currentTiming}ms`);
                }
            } else {
                this.currentTiming -= 30;
                console.log(`🎯 [STAY BEHIND] No rival timing, decreased by 30ms: ${this.currentTiming}ms`);
            }
        }
        
        // Apply bounds
        const beforeBounds = this.currentTiming;
        this.currentTiming = Math.max(minSafeTiming, Math.min(maxSafeTiming, this.currentTiming));
        
        if (beforeBounds !== this.currentTiming) {
            console.log(`🛡️ [BOUNDS] Adjusted: ${beforeBounds}ms → ${this.currentTiming}ms`);
        }
        
        // ✅ IMPROVED: Hard cap - never exceed rival timing (UNLESS stuck OR exploring blindly)
        // Only apply hard cap when:
        // 1. We have rivalTiming (not null)
        // 2. We're not stuck (consecutiveErrorsInRange < 8)
        // 3. We're not in blind exploration mode
        if (strategy.rivalTiming && strategy.consecutiveErrorsInRange < 8) {
            const beforeCap = this.currentTiming;
            this.currentTiming = Math.min(this.currentTiming, strategy.rivalTiming - 8);
            if (beforeCap !== this.currentTiming) {
                console.log(`🛡️ [HARD CAP] Never exceed rival: ${beforeCap}ms → ${this.currentTiming}ms`);
            }
        } else if (strategy.rivalTiming && strategy.consecutiveErrorsInRange >= 8) {
            console.log(`⚠️ [HARD CAP DISABLED] Stuck detected (${strategy.consecutiveErrorsInRange} errors), allowing exploration above rivalTiming`);
        } else if (!strategy.rivalTiming) {
            console.log(`🔍 [NO HARD CAP] Blind exploration mode - no rivalTiming to cap against`);
        }
        
        // ✅ NEW: Track timing history for overshoot brake
        strategy.myHistory.push(this.currentTiming);
        if (strategy.myHistory.length > 5) {
            strategy.myHistory.shift();
        }
        
        // ✅ NEW: Overshoot brake (check for wild jumps)
        if (strategy.myHistory.length >= 3) {
            const recent = strategy.myHistory.slice(-3);
            const span = Math.max(...recent) - Math.min(...recent);
            if (span > 250 && result !== 'KICKED') {
                console.log(`⚠️ [OVERSHOOT BRAKE] Wild jump detected (${span}ms span), capping movement`);
                // Recalculate with capped step
                const cappedStep = Math.min(step, 0.22);
                this.currentTiming = this.lerp(beforeBounds, target, cappedStep);
                this.currentTiming = Math.max(minSafeTiming, Math.min(maxSafeTiming, this.currentTiming));
            }
        }
        
        console.log(`🎯 [STAY BEHIND] Final timing: ${this.currentTiming}ms`);
        if (strategy.rivalTiming) {
            const finalGap = strategy.rivalTiming - this.currentTiming;
            console.log(`🎯 [STAY BEHIND] Gap to rival: ${finalGap}ms (${finalGap > 0 ? 'behind' : 'ahead'})`);
        }
        console.log(`🎯 ========== STAY BEHIND STRATEGY END ==========\n`);
    }
    
    /**
     * Analyze if opponent is baiting us (leaving early to make us think they're slow)
     * Returns baiting score 0-100 and recommended action
     */
    analyzeOpponentBaiting() {
        const intel = this.opponentIntelligence;
        const leaveTimes = intel.opponentLeavingTimes;
        
        console.log(`🔍 [BAIT CHECK] Total leave times tracked: ${leaveTimes.length}`);
        if (leaveTimes.length > 0) {
            console.log(`🔍 [BAIT CHECK] Leave times:`, leaveTimes.map(lt => `${lt.time}ms (${lt.result})`).join(', '));
        }
        
        if (leaveTimes.length < 2) {
            console.log(`🔍 [BAIT CHECK] Insufficient data (need 2, have ${leaveTimes.length})`);
            return {
                isBaiting: false,
                baitingScore: 0,
                reason: 'INSUFFICIENT_DATA',
                recommendation: 'CONTINUE_EXPLORATION'
            };
        }
        
        // Get recent 3S errors and their opponent leaving times
        const recent3sErrors = leaveTimes.filter(lt => lt.result === '3S_ERROR').slice(-5);
        
        console.log(`🔍 [BAIT CHECK] Recent 3S errors: ${recent3sErrors.length}`);
        
        if (recent3sErrors.length < 2) {
            console.log(`🔍 [BAIT CHECK] Not enough 3S errors (need 2, have ${recent3sErrors.length})`);
            return {
                isBaiting: false,
                baitingScore: 0,
                reason: 'NO_3S_PATTERN',
                recommendation: 'CONTINUE_EXPLORATION'
            };
        }
        
        // Calculate opponent's leaving time range
        const opponentLeaveTimes = recent3sErrors.map(e => e.time);
        const avgOpponentLeave = opponentLeaveTimes.reduce((a, b) => a + b, 0) / opponentLeaveTimes.length;
        const minOpponentLeave = Math.min(...opponentLeaveTimes);
        const maxOpponentLeave = Math.max(...opponentLeaveTimes);
        const leaveTimeVariance = maxOpponentLeave - minOpponentLeave;
        
        // Get our timing range during these 3S errors
        const ourTimings = recent3sErrors.map(e => e.ourTiming);
        const avgOurTiming = ourTimings.reduce((a, b) => a + b, 0) / ourTimings.length;
        
        console.log(`🔍 BAIT ANALYSIS:`);
        console.log(`   Opponent avg leave time: ${avgOpponentLeave.toFixed(0)}ms (range: ${minOpponentLeave}-${maxOpponentLeave})`);
        console.log(`   Our avg timing: ${avgOurTiming.toFixed(0)}ms`);
        console.log(`   Leave time variance: ${leaveTimeVariance}ms`);
        
        // BAITING DETECTION LOGIC
        let baitingScore = 0;
        let baitingReasons = [];
        
        // 1. Check if opponent is leaving BEFORE us (early leave = potential bait)
        const leavingBeforeUs = avgOpponentLeave < avgOurTiming;
        const timeDifference = avgOurTiming - avgOpponentLeave;
        
        if (leavingBeforeUs && timeDifference > 30) {
            // Opponent consistently leaves 30ms+ before us but we still get 3S
            // This is STRONG indicator of baiting (they're not actually slow)
            const points = Math.min(50, Math.floor(timeDifference / 3)); // More points for bigger difference
            baitingScore += points;
            baitingReasons.push(`Opponent leaves ${timeDifference.toFixed(0)}ms before us`);
        }
        
        // 2. Check if opponent's leave time is in NORMAL range despite 3S errors
        const currentZone = ZONES[this.currentZone];
        const opponentInNormalRange = avgOpponentLeave >= ZONES.NORMAL.min && avgOpponentLeave <= ZONES.NORMAL.max;
        const weAreInNormalRange = this.currentZone === 'NORMAL';
        
        if (opponentInNormalRange && weAreInNormalRange) {
            // Both in NORMAL range but getting 3S = opponent is baiting
            baitingScore += 35;
            baitingReasons.push('Both in NORMAL range but getting 3S');
        }
        
        // 3. Check for high variance in opponent leaving times (inconsistent = baiting)
        if (leaveTimeVariance > 80) {
            // Opponent's timing varies by 80ms+ = they're playing games
            baitingScore += 20;
            baitingReasons.push(`High variance in opponent timing (${leaveTimeVariance}ms)`);
        }
        
        // 4. Check if we got KICKED after moving to faster range
        const recentKicks = leaveTimes.filter(lt => lt.result === 'KICKED').slice(-3);
        if (recentKicks.length >= 1 && recent3sErrors.length >= 2) {
            // Got 3S errors, then got KICKED = classic bait trap
            baitingScore += 30;
            baitingReasons.push('Got KICKED after 3S errors (classic bait)');
        }
        
        intel.opponentBaitingScore = baitingScore;
        
        console.log(`   🎯 BAITING SCORE: ${baitingScore}/100`);
        if (baitingReasons.length > 0) {
            console.log(`   Reasons: ${baitingReasons.join(', ')}`);
        }
        
        // RECOMMENDATION LOGIC
        let recommendation = 'CONTINUE_EXPLORATION';
        let targetRange = this.currentZone;
        
        if (baitingScore >= 60) {
            // HIGH baiting score = opponent is definitely baiting
            // STAY in current range or move to MEDIAN between current and suggested
            recommendation = 'STAY_OR_MEDIAN';
            targetRange = this.currentZone;
            console.log(`   ⚠️ HIGH BAITING DETECTED - Stay in ${this.currentZone} or use median timing`);
        } else if (baitingScore >= 30) {
            // MEDIUM baiting score = opponent might be baiting
            // Use MEDIAN timing between current and next range
            recommendation = 'USE_MEDIAN';
            targetRange = 'MEDIAN';
            console.log(`   ⚠️ POSSIBLE BAITING - Use median timing between ranges`);
        } else {
            // LOW baiting score = opponent is genuinely slow
            // Safe to move to faster range
            recommendation = 'SAFE_TO_SWITCH';
            targetRange = this.getNextHigherRange(this.currentZone);
            console.log(`   ✅ LOW BAITING - Safe to move to ${targetRange}`);
        }
        
        return {
            isBaiting: baitingScore >= 30,
            baitingScore: baitingScore,
            reasons: baitingReasons,
            recommendation: recommendation,
            targetRange: targetRange,
            opponentAvgLeaveTime: avgOpponentLeave,
            ourAvgTiming: avgOurTiming
        };
    }
    
    /**
     * Calculate median timing between two ranges
     * Used when opponent baiting is detected
     */
    calculateMedianTiming(range1, range2) {
        const zone1 = ZONES[range1];
        const zone2 = ZONES[range2];
        
        if (!zone1 || !zone2) {
            return null;
        }
        
        // Calculate median between the two ranges
        const median = Math.floor((zone1.min + zone1.max + zone2.min + zone2.max) / 4);
        
        console.log(`📊 MEDIAN TIMING: ${range1} (${zone1.min}-${zone1.max}) + ${range2} (${zone2.min}-${zone2.max}) = ${median}ms`);
        
        return median;
    }


    /**
     * Detect which range opponent is in based on patterns
     * CRITICAL: Must be CONFIDENT before switching ranges!
     * ENHANCED: Uses command intelligence (JOIN vs 353) BUT overrides with 3S pattern
     */
    detectOpponentRange() {
        const attempts = this.opponentIntelligence.explorationAttempts;
        const pattern = this.opponentIntelligence.resultPattern;
        const timings = this.opponentIntelligence.timingPattern;
        
        // PRIORITY 0: Check LEFT_EARLY data FIRST (most reliable)
        // LEFT_EARLY tells us opponent's ACTUAL timing
        const leaveTimes = this.opponentIntelligence.opponentLeavingTimes;
        
        if (leaveTimes.length >= 2) {
            // Filter out KICKED events (they have null time) and get only LEFT_EARLY times
            const recentLeaveTimes = leaveTimes
                .filter(lt => lt.time !== null && lt.time > 0)
                .slice(-3)
                .map(lt => lt.time);
            
            if (recentLeaveTimes.length >= 2) {
                const avgOpponentLeave = recentLeaveTimes.reduce((a, b) => a + b, 0) / recentLeaveTimes.length;
                const opponentRange = this.getRangeFromTiming(avgOpponentLeave);
                
                console.log(`\n🔍 [LEFT_EARLY CHECK] Opponent leaving times:`, recentLeaveTimes);
                console.log(`   Avg opponent leave: ${avgOpponentLeave.toFixed(0)}ms → ${opponentRange} range`);
                console.log(`   Current bot range: ${this.currentZone}`);
                
                if (opponentRange) {
                    // Check if opponent is in SAME range as us
                    if (opponentRange === this.currentZone) {
                        console.log(`   ✅ Opponent in SAME range (${opponentRange})`);
                        console.log(`   → Adjust within range, don't switch`);
                        
                        // Check if we've tried the full range
                        const currentZone = ZONES[this.currentZone];
                        const hasTriedTopOfRange = this.currentTiming >= currentZone.max - 30;
                        
                        if (!hasTriedTopOfRange) {
                            console.log(`   → Haven't tried top of range yet (current: ${this.currentTiming}ms, max: ${currentZone.max}ms)`);
                            return {
                                detectedRange: this.currentZone,
                                confidence: 70,
                                reason: 'OPPONENT_IN_SAME_RANGE_TRY_FULL',
                                shouldSwitch: false,
                                adjustWithinRange: true
                            };
                        }
                    } else {
                        // Opponent in DIFFERENT range
                        console.log(`   ⚠️ Opponent in DIFFERENT range!`);
                        console.log(`   → Bot: ${this.currentZone}, Opponent: ${opponentRange}`);
                        console.log(`   → Should switch to ${opponentRange}`);
                        
                        return {
                            detectedRange: opponentRange,
                            confidence: 85,
                            reason: 'LEFT_EARLY_DIFFERENT_RANGE',
                            shouldSwitch: true
                        };
                    }
                }
            }
        }
        
        // CRITICAL FIX: Check for excessive 3S errors FIRST (overrides command intelligence)
        // But NOW also check for BAITING before switching ranges
        // AND check if we're at TOP of range (don't switch if in middle!)
        const last5 = pattern.slice(-5);
        const excessive3sCount = last5.filter(r => r === '3S_ERROR').length;
        
        if (excessive3sCount >= 3 && last5.length >= 3) {
            // Getting 3S repeatedly - but is opponent BAITING us?
            console.log(`🚨 EXCESSIVE 3S DETECTED: ${excessive3sCount}/5 are 3S errors`);
            
            // Check if we're at TOP of range
            const currentZone = ZONES[this.currentZone];
            const avgTiming = timings.slice(-5).reduce((a, b) => a + b, 0) / Math.min(timings.length, 5);
            const atTopOfRange = avgTiming >= currentZone.max - 20;
            
            console.log(`   Current timing: ${avgTiming.toFixed(0)}ms`);
            console.log(`   Range: ${currentZone.min}-${currentZone.max}ms`);
            console.log(`   At top of range: ${atTopOfRange}`);
            
            if (!atTopOfRange && excessive3sCount < 4) {
                // In MIDDLE of range with 3 3S errors - adjust within range first
                console.log(`   → In middle of range, adjust within range (don't switch yet)`);
                return {
                    detectedRange: this.currentZone,
                    confidence: 60,
                    reason: '3S_IN_MIDDLE_ADJUST_WITHIN',
                    shouldSwitch: false,
                    adjustWithinRange: true
                };
            }
            
            // ANTI-BAIT CHECK: Analyze opponent leaving times
            const baitAnalysis = this.analyzeOpponentBaiting();
            
            if (baitAnalysis.isBaiting) {
                console.log(`⚠️ BAITING DETECTED (Score: ${baitAnalysis.baitingScore}/100)`);
                console.log(`   Opponent is leaving early to bait us into faster range!`);
                
                if (baitAnalysis.recommendation === 'STAY_OR_MEDIAN') {
                    // HIGH baiting - stay in current range
                    console.log(`   🛡️ STAYING in ${this.currentZone} to avoid trap`);
                    return {
                        detectedRange: this.currentZone,
                        confidence: 80,
                        reason: 'BAITING_DETECTED_STAY',
                        shouldSwitch: false,
                        baitingScore: baitAnalysis.baitingScore
                    };
                } else if (baitAnalysis.recommendation === 'USE_MEDIAN') {
                    // MEDIUM baiting - use median timing
                    const nextRange = this.getNextHigherRange(this.currentZone);
                    const medianTiming = this.calculateMedianTiming(this.currentZone, nextRange);
                    
                    console.log(`   📊 Using MEDIAN timing: ${medianTiming}ms (between ${this.currentZone} and ${nextRange})`);
                    return {
                        detectedRange: this.currentZone, // Stay in current range
                        confidence: 70,
                        reason: 'BAITING_USE_MEDIAN',
                        shouldSwitch: false,
                        useMedianTiming: true,
                        medianTiming: medianTiming,
                        baitingScore: baitAnalysis.baitingScore
                    };
                }
            } else {
                // LOW baiting score - opponent is genuinely slow
                console.log(`✅ LOW BAITING (Score: ${baitAnalysis.baitingScore}/100) - Opponent is genuinely slower`);
            }
            
            // Original 3S logic (if not baiting)
            const zone3s = ZONES[this.currentZone];
            const avg3sTiming = timings.slice(-5).reduce((a, b) => a + b, 0) / Math.min(timings.length, 5);
            const at3sTopOfRange = avg3sTiming >= zone3s.max - 20;
            
            if (at3sTopOfRange) {
                console.log(`🚨 3S at top of range → We're kicking TOO EARLY`);
                console.log(`   Switching to higher range`);
                
                return {
                    detectedRange: this.getNextHigherRange(this.currentZone),
                    confidence: 90,
                    reason: '3S_OVERRIDE_AT_BOUNDARY',
                    shouldSwitch: true,
                    override: true
                };
            } else if (excessive3sCount >= 4) {
                // Even in middle, if 4+ 3S errors, we're kicking too early
                console.log(`🚨 ${excessive3sCount}/5 are 3S → We're kicking TOO EARLY`);
                console.log(`   Switching to higher range`);
                
                return {
                    detectedRange: this.getNextHigherRange(this.currentZone),
                    confidence: 85,
                    reason: '3S_OVERRIDE_EXCESSIVE',
                    shouldSwitch: true,
                    override: true
                };
            }
        }
        
        // PRIORITY 1: Check command intelligence (if no 3S override)
        // Command intelligence provides DIRECTION HINT, not immediate switch
        // CRITICAL: We ALWAYS start in NORMAL, command only guides which direction to explore
        const commandIntel = this.detectOpponentSpeedFromCommand();
        
        if (commandIntel && commandIntel.confidence >= 80) {
            console.log(`🎯 COMMAND INTELLIGENCE: ${commandIntel.reason}`);
            console.log(`   Suggested direction: ${commandIntel.recommendedRanges.join(' or ')}`);
            console.log(`   ⏳ Waiting for pattern confirmation (KICKED/3S) before switching`);
            
            // Command intelligence guides which direction to switch
            // But we MUST have pattern confirmation (KICKED or 3S) to actually switch
            
            // Opponent in 353 (DEFENSE) → Suggests they're faster
            if (commandIntel.opponentSpeed === 'FASTER') {
                // Check if we have KICKED pattern to confirm
                const kickedCount = pattern.filter(r => r === 'KICKED').length;
                
                if (kickedCount >= 2) {
                    // KICKED + Command intelligence → High confidence to go SLOW
                    console.log(`   ✓ KICKED pattern CONFIRMS command intelligence`);
                    console.log(`   ✓ Switching from ${this.currentZone} to SLOW (opponent is faster)`);
                    return {
                        detectedRange: 'SLOW',
                        confidence: 95,
                        reason: 'COMMAND_KICKED_CONFIRM',
                        shouldSwitch: true
                    };
                } else {
                    // Command suggests SLOWER, but no KICKED pattern yet
                    console.log(`   ⏳ Command suggests SLOW/NORMAL, but no KICKED pattern yet (${kickedCount}/2)`);
                    console.log(`   ⏳ Staying in ${this.currentZone} until pattern confirms`);
                }
            }
            // Opponent in JOIN (ATTACK) → Suggests we're faster
            else if (commandIntel.opponentSpeed === 'SLOWER') {
                // Check if we have 3S pattern to confirm
                const error3sCount = pattern.filter(r => r === '3S_ERROR').length;
                
                if (error3sCount >= 2) {
                    // 🚨 CRITICAL: ANTI-BAIT CHECK BEFORE SWITCHING
                    // Check if opponent is baiting us by leaving early
                    console.log(`   🔍 Checking for baiting before switching...`);
                    const baitAnalysis = this.analyzeOpponentBaiting();
                    
                    console.log(`   📊 Baiting Score: ${baitAnalysis.baitingScore}/100`);
                    
                    if (baitAnalysis.isBaiting) {
                        console.log(`   ⚠️ BAITING DETECTED (Score: ${baitAnalysis.baitingScore}/100) - NOT switching to FAST`);
                        console.log(`   🛡️ Opponent is leaving early to bait us into faster range!`);
                        
                        if (baitAnalysis.recommendation === 'USE_MEDIAN') {
                            const nextRange = this.getNextHigherRange(this.currentZone);
                            const medianTiming = this.calculateMedianTiming(this.currentZone, nextRange);
                            
                            console.log(`   📊 Using MEDIAN timing: ${medianTiming}ms (between ${this.currentZone} and ${nextRange})`);
                            return {
                                detectedRange: this.currentZone,
                                confidence: 70,
                                reason: 'BAITING_USE_MEDIAN',
                                shouldSwitch: false,
                                useMedianTiming: true,
                                medianTiming: medianTiming,
                                baitingScore: baitAnalysis.baitingScore
                            };
                        } else {
                            console.log(`   🛡️ STAYING in ${this.currentZone} to avoid bait trap`);
                            return {
                                detectedRange: this.currentZone,
                                confidence: 75,
                                reason: 'BAITING_DETECTED_STAY',
                                shouldSwitch: false,
                                baitingScore: baitAnalysis.baitingScore
                            };
                        }
                    } else {
                        console.log(`   ✅ NO BAITING detected (Score: ${baitAnalysis.baitingScore}/100)`);
                    }
                    
                    // 3S + Command intelligence + NO BAITING → High confidence to go FAST
                    console.log(`   ✓ 3S pattern CONFIRMS command intelligence`);
                    console.log(`   ✓ Switching from ${this.currentZone} to FAST (we're faster)`);
                    return {
                        detectedRange: 'FAST',
                        confidence: 95,
                        reason: 'COMMAND_3S_CONFIRM',
                        shouldSwitch: true
                    };
                } else {
                    // Command suggests FASTER, but no 3S pattern yet
                    console.log(`   ⏳ Command suggests NORMAL/FAST, but no 3S pattern yet (${error3sCount}/2)`);
                    console.log(`   ⏳ Staying in ${this.currentZone} until pattern confirms`);
                }
            }
        }
        
        // PRIORITY 2: KICKED pattern → Opponent is SLOWER (kicked us because they're still there)
        // CRITICAL FIX: KICKED means we tried to kick too early, opponent was still there
        // Opponent's timing > our timing, so opponent is SLOWER, we need HIGHER timing
        const last3 = pattern.slice(-3);
        const kickedCount = last3.filter(r => r === 'KICKED').length;
        
        if (kickedCount >= 2 && last3.length >= 2) {
            const currentZone = ZONES[this.currentZone];
            const avgTiming = timings.slice(-3).reduce((a, b) => a + b, 0) / timings.slice(-3).length;
            
            console.log(`🎯 DETECTION: ${kickedCount}/3 are KICKED → Opponent is SLOWER (we kicked too early)`);
            
            // HIGH CONFIDENCE: Kicked means opponent is slower (higher timing)
            // We need to move to HIGHER range (SLOWER timing)
            return {
                detectedRange: this.getNextHigherRange(this.currentZone),
                confidence: 90,
                reason: 'KICKED_PATTERN',
                shouldSwitch: true
            };
        }
        
        // PRIORITY 3: 3S_ERROR pattern → IMPROVED: Switch after 2-3 3S errors (don't wait for top)
        const error3sCount = last3.filter(r => r === '3S_ERROR').length;
        
        if (error3sCount >= 2 && last3.length >= 2) {
            const currentZone = ZONES[this.currentZone];
            const avgTiming = timings.slice(-3).reduce((a, b) => a + b, 0) / timings.slice(-3).length;
            
            // NEW LOGIC: 2-3 consecutive 3S_ERROR = clear pattern (rival is slower)
            // Don't wait for top of range - adaptive probing will handle it
            console.log(`🎯 DETECTION: ${error3sCount}/3 are 3S_ERROR → Rival is SLOWER`);
            console.log(`   Current timing: ${avgTiming}ms in ${this.currentZone} range`);
            
            // Check if we're using adaptive probing (exploration phase)
            if (this.opponentIntelligence.explorationPhase && this.opponentIntelligence.explorationAttempts <= 3) {
                // In exploration phase - adaptive probing will handle range switch
                console.log(`   → Using adaptive probing (will switch if pattern continues)`);
                
                return {
                    detectedRange: this.currentZone,
                    confidence: 60,
                    reason: '3S_PATTERN_ADAPTIVE_PROBING',
                    shouldSwitch: false,
                    adjustWithinRange: true
                };
            }
            
            // Check if we're at the TOP of current range
            const atTopOfRange = avgTiming >= currentZone.max - 20;
            
            // IMPROVED: For random opponents, check if 2+ 3S errors even in middle of range
            // This handles cases where opponent has random timing in SLOW range
            if (atTopOfRange || error3sCount >= 3) {
                // At top of range OR 3+ 3S errors → Switch to higher range
                console.log(`🎯 DETECTION: 3S at top of ${this.currentZone} range (${avgTiming}ms) → Need to wait longer`);
                
                return {
                    detectedRange: this.getNextHigherRange(this.currentZone),
                    confidence: 80,
                    reason: '3S_AT_BOUNDARY_OR_PATTERN',
                    shouldSwitch: true
                };
            } else if (error3sCount === 2 && avgTiming >= currentZone.center) {
                // 2 3S errors in upper half of range → Likely opponent in higher range
                console.log(`🎯 DETECTION: 2 3S in upper half of ${this.currentZone} range (${avgTiming}ms) → Likely higher range`);
                
                return {
                    detectedRange: this.getNextHigherRange(this.currentZone),
                    confidence: 70,
                    reason: '3S_UPPER_HALF_PATTERN',
                    shouldSwitch: true
                };
            } else {
                // We're in middle of range, getting 3S → Just adjust within range
                console.log(`⚠️ DETECTION: 3S in middle of ${this.currentZone} range (${avgTiming}ms) → Stay in range, adjust up`);
                
                return {
                    detectedRange: this.currentZone,
                    confidence: 50,
                    reason: '3S_ADJUST_WITHIN_RANGE',
                    shouldSwitch: false
                };
            }
        }
        
        // PRIORITY 4: SUCCESS pattern → Opponent is in same range or close
        const successCount = last3.filter(r => r === 'SUCCESS').length;
        
        if (successCount >= 1 && last3.length >= 1) {
            // Even 1 SUCCESS is valuable information!
            const confidence = successCount === 1 ? 70 : 85;
            console.log(`✅ DETECTION: ${successCount}/${last3.length} are SUCCESS → Opponent in ${this.currentZone} range`);
            
            return {
                detectedRange: this.currentZone,
                confidence: confidence,
                reason: 'SUCCESS_PATTERN',
                shouldSwitch: false
            };
        }
        
        // PRIORITY 5: Alternating SUCCESS/KICKED → Trap or multiple opponents
        if (attempts >= 3 && this.isAlternatingPattern(pattern)) {
            console.log(`🎭 DETECTION: Alternating pattern → Trap or multiple opponents`);
            
            return {
                detectedRange: this.currentZone,
                confidence: 60,
                reason: 'ALTERNATING_TRAP',
                isTrap: true,
                shouldSwitch: false
            };
        }
        
        // PRIORITY 6: Mixed results → Need more data
        if (attempts >= 3) {
            console.log(`⚠️ DETECTION: Mixed results → Need more exploration`);
            
            return {
                detectedRange: this.currentZone,
                confidence: 30,
                reason: 'MIXED_RESULTS',
                shouldSwitch: false
            };
        }
        
        return {
            detectedRange: null,
            confidence: 0,
            reason: 'INSUFFICIENT_DATA',
            shouldSwitch: false
        };
    }
    
    /**
     * Query database: What ranges work with MY ping context?
     */
    async analyzeCrossRangePatterns() {
        if (!this.supabase) return null;
        
        const myPing = this.getCurrentPing ? this.getCurrentPing() : 100;
        const myContext = this.getContextFromPing ? this.getContextFromPing() : 'NORMAL';
        
        console.log(`📊 Analyzing cross-range patterns (My ping: ${myPing}ms, Context: ${myContext})`);
        
        try {
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value, is_success, context')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .gte('ping_ms', myPing - 30)
                .lte('ping_ms', myPing + 30)
                .eq('is_success', true)
                .order('created_at', { ascending: false })
                .limit(1000);
            
            if (error || !data || data.length === 0) {
                console.log(`📊 No cross-range data available`);
                return null;
            }
            
            const rangeStats = {
                FAST: { count: 0, total: 0 },
                NORMAL: { count: 0, total: 0 },
                SLOW: { count: 0, total: 0 }
            };
            
            data.forEach(record => {
                const timing = record.timing_value;
                
                if (timing >= ZONES.FAST.min && timing <= ZONES.FAST.max) {
                    rangeStats.FAST.count++;
                } else if (timing >= ZONES.NORMAL.min && timing <= ZONES.NORMAL.max) {
                    rangeStats.NORMAL.count++;
                } else if (timing >= ZONES.SLOW.min && timing <= ZONES.SLOW.max) {
                    rangeStats.SLOW.count++;
                }
            });
            
            const total = data.length;
            Object.keys(rangeStats).forEach(range => {
                rangeStats[range].percentage = (rangeStats[range].count / total) * 100;
            });
            
            console.log(`📊 Cross-range analysis:`);
            console.log(`   FAST: ${rangeStats.FAST.count}/${total} (${rangeStats.FAST.percentage.toFixed(0)}%)`);
            console.log(`   NORMAL: ${rangeStats.NORMAL.count}/${total} (${rangeStats.NORMAL.percentage.toFixed(0)}%)`);
            console.log(`   SLOW: ${rangeStats.SLOW.count}/${total} (${rangeStats.SLOW.percentage.toFixed(0)}%)`);
            
            const bestRange = Object.keys(rangeStats).reduce((best, range) => {
                return rangeStats[range].count > rangeStats[best].count ? range : best;
            }, 'NORMAL');
            
            console.log(`   Best range: ${bestRange} (${rangeStats[bestRange].percentage.toFixed(0)}% of successes)`);
            
            return {
                rangeStats,
                bestRange,
                confidence: rangeStats[bestRange].percentage
            };
            
        } catch (error) {
            console.error('📊 Cross-range analysis error:', error);
            return null;
        }
    }
    
    /**
     * Cautiously switch range with transition strategy
     * CRITICAL: Moving from NORMAL to FAST/SLOW is risky
     * - NORMAL → FAST: Opponent gets more chance to kick us
     * - NORMAL → SLOW: We get more 3S, opponent gets more chance
     * Solution: Find sweet spot at boundary first
     */
    async cautiousSwitchRange(targetRange, reason) {
        const oldRange = this.currentZone;
        const oldTiming = this.currentTiming;
        
        console.log(`\n🔄 ========== CAUTIOUS RANGE SWITCH ==========`);
        console.log(`   From: ${oldRange} range (${oldTiming}ms)`);
        console.log(`   To: ${targetRange} range`);
        console.log(`   Reason: ${reason}`);
        
        // Check safety first
        const safety = await this.validateRangeSafety(targetRange);
        
        if (!safety.safe) {
            console.log(`   ⚠️ Target range is RISKY (${(safety.kickRate * 100).toFixed(0)}% kick rate)`);
            console.log(`   ❌ Aborting switch, staying in ${oldRange}`);
            return {
                switched: false,
                timing: oldTiming,
                reason: 'UNSAFE_TARGET_RANGE'
            };
        }
        
        // Find safest timing in target range
        const safeTiming = await this.findSafestTimingInRange(targetRange);
        
        console.log(`   ✅ Safe timing found: ${safeTiming}ms`);
        console.log(`   🎯 Switching to ${targetRange} range at ${safeTiming}ms`);
        
        // Switch range
        this.currentZone = targetRange;
        this.currentTiming = safeTiming;
        this.lastAdjustmentReason = 'CAUTIOUS_RANGE_SWITCH';
        this.rangeExploration.rangesTried.push(targetRange);
        
        // Reset sweet spot data for new range
        this.sweetSpotData = {
            successTimings: [],
            kickTimings: []
        };
        
        console.log(`   ✅ Switch complete: Now in ${targetRange} range at ${safeTiming}ms`);
        console.log(`   📊 Will find sweet spot in next 3-5 attempts`);
        
        return {
            switched: true,
            timing: safeTiming,
            reason: 'SWITCHED_SUCCESSFULLY'
        };
    }
    
    /**
     * Check if target range is safe (won't get kicked too much)
     */
    async validateRangeSafety(targetRange) {
        if (!this.supabase) return { safe: true, kickRate: 0 };
        
        const zone = ZONES[targetRange];
        
        try {
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('is_defense, is_success')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .gte('timing_value', zone.min)
                .lte('timing_value', zone.max)
                .order('created_at', { ascending: false })
                .limit(50);
            
            if (error || !data || data.length < 10) {
                return { safe: true, kickRate: 0, reason: 'INSUFFICIENT_DATA' };
            }
            
            const totalAttempts = data.length;
            const kickedCount = data.filter(r => r.is_defense).length;
            const kickRate = kickedCount / totalAttempts;
            
            const isSafe = kickRate < 0.35;
            
            console.log(`🛡️ Safety check for ${targetRange} range:`);
            console.log(`   Attempts: ${totalAttempts}, Kicked: ${kickedCount}, Rate: ${(kickRate * 100).toFixed(0)}%`);
            console.log(`   ${isSafe ? '✅ SAFE' : '⚠️ RISKY'}`);
            
            return {
                safe: isSafe,
                kickRate: kickRate,
                attempts: totalAttempts,
                reason: isSafe ? 'LOW_KICK_RATE' : 'HIGH_KICK_RATE'
            };
            
        } catch (error) {
            console.error('🛡️ Safety validation error:', error);
            return { safe: true, kickRate: 0, reason: 'ERROR' };
        }
    }
    
    /**
     * Find the safest timing in target range
     */
    async findSafestTimingInRange(targetRange) {
        if (!this.supabase) {
            return ZONES[targetRange].center;
        }
        
        const zone = ZONES[targetRange];
        
        try {
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value, is_success, is_defense')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .gte('timing_value', zone.min)
                .lte('timing_value', zone.max)
                .order('created_at', { ascending: false })
                .limit(1000);
            
            if (error || !data || data.length < 5) {
                console.log(`🎯 No data for ${targetRange}, using center: ${zone.center}ms`);
                return zone.center;
            }
            
            const buckets = new Map();
            
            data.forEach(record => {
                const bucket = Math.floor(record.timing_value / 10) * 10;
                
                if (!buckets.has(bucket)) {
                    buckets.set(bucket, {
                        timing: bucket + 5,
                        attempts: 0,
                        successes: 0,
                        kicks: 0
                    });
                }
                
                const stats = buckets.get(bucket);
                stats.attempts++;
                if (record.is_success) stats.successes++;
                if (record.is_defense) stats.kicks++;
            });
            
            let bestTiming = zone.center;
            let bestScore = -1;
            
            buckets.forEach((stats, bucket) => {
                if (stats.attempts < 3) return;
                
                const successRate = stats.successes / stats.attempts;
                const kickRate = stats.kicks / stats.attempts;
                
                const safetyScore = successRate - (kickRate * 2);
                
                if (safetyScore > bestScore) {
                    bestScore = safetyScore;
                    bestTiming = stats.timing;
                }
            });
            
            console.log(`🎯 Safest timing in ${targetRange}: ${bestTiming}ms (score: ${bestScore.toFixed(2)})`);
            
            return bestTiming;
            
        } catch (error) {
            console.error('🎯 Find safest timing error:', error);
            return zone.center;
        }
    }

    /**
     * Calculate median timing for trap scenarios
     */
    calculateMedianSafeTiming() {
        const timings = this.opponentIntelligence.timingPattern;
        
        if (timings.length === 0) {
            return ZONES[this.currentZone].center;
        }
        
        const sorted = [...timings].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        
        console.log(`📊 Median timing from attempts: ${median}ms`);
        
        return median;
    }
    
    /**
     * Adaptive probing - uses larger increments to quickly find opponent range
     * CRITICAL: This solves the slow detection issue (6-7 attempts → 3 attempts)
     */
    adaptiveProbing(lastResult, attemptInPhase) {
        const oldTiming = this.currentTiming;
        
        if (lastResult === '3S_ERROR') {
            // Adaptive increment based on attempt number
            let increment;
            
            if (attemptInPhase === 1) {
                increment = 20; // First 3S → Try +20ms (quick probe)
            } else if (attemptInPhase === 2) {
                increment = 40; // Second 3S → Try +40ms (faster probe)
            } else {
                increment = 60; // Third 3S → Try +60ms (will likely exceed range)
            }
            
            this.currentTiming += increment;
            console.log(`⬆️ Adaptive probe (3S #${attemptInPhase}): ${oldTiming}ms → ${this.currentTiming}ms (+${increment}ms)`);
            
            // Check if we exceeded current range
            const currentZone = ZONES[this.currentZone];
            if (this.currentTiming >= currentZone.max) {
                console.log(`🎯 Exceeded ${this.currentZone} range → Rival is in SLOWER range`);
                return {
                    timing: this.currentTiming,
                    shouldSwitchRange: true,
                    targetRange: this.getNextHigherRange(this.currentZone),
                    reason: 'ADAPTIVE_PROBE_EXCEEDED'
                };
            }
            
            return {
                timing: this.currentTiming,
                shouldSwitchRange: false
            };
        }
        
        return null;
    }
    
    

    

    

    
    /**
     * HYBRID LEARNING: Learn from ALL past rivals to make smarter initial guess
     * Analyzes historical data to find most common opponent timing patterns
     */
    /**
     * Set current rival name for hybrid learning
     * OPTIMIZATION: Preload data in background when rival changes
     */
    setRivalName(rivalName) {
        if (rivalName && rivalName !== this.currentRivalName) {
            this.lastRivalName = this.currentRivalName;
            this.currentRivalName = rivalName;
            console.log(`🎯 [HYBRID] Rival changed: ${this.lastRivalName || 'none'} → ${rivalName}`);
            
            // Reset cache when rival changes
            this.hybridLearningCache.specificRival = null;
            this.hybridLearningCache.confidence = 0;
            
            // ✅ OPTIMIZATION: Preload data for new rival in background (non-blocking)
            console.log(`   ⚡ Preloading data for "${rivalName}" in background...`);
            this.hybridDatabaseLearning().catch(error => {
                console.error(`   ❌ [HYBRID] Preload failed:`, error);
            });
        }
    }

    /**
     * HYBRID DATABASE LEARNING - Query every 5 attempts
     * NON-BLOCKING: Runs in background, uses cache immediately
     * IMPORTANT: Cache is updated with latest DB data to ensure freshness
     */
    async hybridDatabaseLearning() {
        if (!this.supabase) {
            console.log(`   ⚠️ [HYBRID] No database connection`);
            return null;
        }
        
        // ✅ CRITICAL: Always query to get LATEST data, but use cache while waiting
        const shouldUseCache = this.hybridLearningCache.confidence > 0 && 
                               (this.attemptCount - this.hybridLearningCache.lastQueryAttempt) < 5;
        
        if (shouldUseCache) {
            console.log(`\n🔄 [HYBRID] Using cached data while fetching latest...`);
            console.log(`   Cache age: ${this.attemptCount - this.hybridLearningCache.lastQueryAttempt} attempts`);
            console.log(`   Cache confidence: ${this.hybridLearningCache.confidence}%`);
            // Note: Query still runs below to update cache with latest data
        }
        
        try {
            const myPing = this.getCurrentPing ? this.getCurrentPing() : 100;
            
            console.log(`\n🔄 ========== HYBRID DATABASE LEARNING ==========`);
            console.log(`   Current Rival: ${this.currentRivalName || 'Unknown'}`);
            console.log(`   Your Ping: ${myPing}ms`);
            console.log(`   Querying last 200 records (optimized)...`);
            
            const queryStartTime = Date.now();
            
            // ✅ OPTIMIZATION: Reduced from 1000 to 200 records for speed
            // ✅ OPTIMIZATION: Run both queries in parallel
            // ✅ CRITICAL: Always query to get LATEST database data
            const [specificResult, generalResult] = await Promise.all([
                // Query 1: Specific rival (if we know their name)
                this.currentRivalName ? 
                    this.supabase
                        .from('imprisonment_metrics')
                        .select('timing_value, adjustment_reason, player_name')
                        .eq('user_id', this.userId)
                        .eq('connection_number', this.connectionNumber)
                        .eq('is_defense', false)
                        .eq('player_name', this.currentRivalName)
                        .gte('ping_ms', myPing - 30)
                        .lte('ping_ms', myPing + 30)
                        .order('created_at', { ascending: false })
                        .limit(200)
                    : Promise.resolve({ data: null, error: null }),
                
                // Query 2: General rivals
                this.supabase
                    .from('imprisonment_metrics')
                    .select('timing_value, adjustment_reason, player_name')
                    .eq('user_id', this.userId)
                    .eq('connection_number', this.connectionNumber)
                    .eq('is_defense', false)
                    .gte('ping_ms', myPing - 30)
                    .lte('ping_ms', myPing + 30)
                    .order('created_at', { ascending: false })
                    .limit(200)
            ]);
            
            const queryTime = Date.now() - queryStartTime;
            console.log(`   ⚡ Query completed in ${queryTime}ms`);
            
            // Process specific rival data
            let specificRivalData = null;
            if (specificResult.data && specificResult.data.length > 0) {
                specificRivalData = this.analyzeHistoricalData(specificResult.data, 'SPECIFIC');
                console.log(`   ✅ Specific Rival Data: ${specificResult.data.length} records`);
            } else if (this.currentRivalName) {
                console.log(`   ⚠️ No data for rival "${this.currentRivalName}"`);
            }
            
            // Process general data
            let generalRivalData = null;
            if (generalResult.data && generalResult.data.length > 0) {
                generalRivalData = this.analyzeHistoricalData(generalResult.data, 'GENERAL');
                console.log(`   ✅ General Data: ${generalResult.data.length} records`);
            } else {
                console.log(`   ⚠️ No general data available`);
            }
            
            // Determine optimal timing
            let optimalTiming = null;
            let confidence = 0;
            let source = 'NONE';
            
            if (specificRivalData && specificRivalData.confidence >= 30) {
                optimalTiming = specificRivalData.optimalTiming;
                confidence = specificRivalData.confidence;
                source = 'SPECIFIC_RIVAL';
                
                console.log(`\n   🎯 [HYBRID RESULT] Using SPECIFIC rival data`);
                console.log(`      Optimal Timing: ${optimalTiming}ms`);
                console.log(`      Confidence: ${confidence}%`);
                console.log(`      LEFT_EARLY: ${specificRivalData.leftEarlyCount}, SUCCESS: ${specificRivalData.successCount}`);
                console.log(`      KICKED: ${specificRivalData.kickedCount}, 3S_ERROR: ${specificRivalData.errorCount}`);
                
            } else if (generalRivalData && generalRivalData.confidence >= 20) {
                optimalTiming = generalRivalData.optimalTiming;
                confidence = generalRivalData.confidence;
                source = 'GENERAL_RIVALS';
                
                console.log(`\n   🎯 [HYBRID RESULT] Using GENERAL rivals data`);
                console.log(`      Optimal Timing: ${optimalTiming}ms`);
                console.log(`      Confidence: ${confidence}%`);
                console.log(`      LEFT_EARLY: ${generalRivalData.leftEarlyCount}, SUCCESS: ${generalRivalData.successCount}`);
                console.log(`      KICKED: ${generalRivalData.kickedCount}, 3S_ERROR: ${generalRivalData.errorCount}`);
                
            } else {
                console.log(`\n   ⚠️ [HYBRID RESULT] Insufficient data - continuing with current strategy`);
            }
            
            // ✅ CRITICAL: Always update cache with LATEST database data
            this.hybridLearningCache.specificRival = specificRivalData;
            this.hybridLearningCache.generalRivals = generalRivalData;
            this.hybridLearningCache.lastQueryAttempt = this.attemptCount;
            this.hybridLearningCache.confidence = confidence;
            console.log(`   💾 Cache updated with latest database data`);
            
            // ✅ DISABLED: Don't force timing changes during getNextTiming
            // The hybrid learning should only provide suggestions, not override current strategy
            // This was causing the bot to jump to old DB timings (like 1775ms) during exploration
            /*
            if (optimalTiming && confidence >= 30) {
                const oldTiming = this.currentTiming;
                this.currentTiming = optimalTiming;
                this.lastAdjustmentReason = `HYBRID_${source}`;
                
                console.log(`   ✅ Timing adjusted: ${oldTiming}ms → ${optimalTiming}ms (${source})`);
            }
            */
            console.log(`   ℹ️ Hybrid learning provides suggestions only, not forcing timing changes`);
            
            console.log(`================================================\n`);
            
            return {
                optimalTiming,
                confidence,
                source,
                specificRivalData,
                generalRivalData
            };
            
        } catch (error) {
            console.error('   ❌ [HYBRID] Error:', error);
            return null;
        }
    }
    
    /**
     * Analyze historical data to find optimal timing
     * Extracts patterns from LEFT_EARLY, SUCCESS, KICKED, 3S_ERROR
     */
    analyzeHistoricalData(records, dataType) {
        const analysis = {
            leftEarlyCount: 0,
            successCount: 0,
            kickedCount: 0,
            errorCount: 0,
            leftEarlyTimings: [],
            successTimings: [],
            optimalTiming: null,
            confidence: 0
        };
        
        // Categorize records by adjustment_reason (not result_type)
        records.forEach(record => {
            const timing = record.timing_value;
            const result = record.adjustment_reason;  // ✅ Use adjustment_reason
            
            if (result === 'LEFT_EARLY') {
                analysis.leftEarlyCount++;
                analysis.leftEarlyTimings.push(timing);
            } else if (result === 'SUCCESS') {
                analysis.successCount++;
                analysis.successTimings.push(timing);
            } else if (result === 'KICKED') {
                analysis.kickedCount++;
            } else if (result === '3S_ERROR') {
                analysis.errorCount++;
            }
        });
        
        console.log(`   📊 [${dataType}] LEFT_EARLY: ${analysis.leftEarlyCount}, SUCCESS: ${analysis.successCount}, KICKED: ${analysis.kickedCount}, 3S_ERROR: ${analysis.errorCount}`);
        
        // STRATEGY: Find optimal timing based on historical patterns
        
        // If we have SUCCESS data, use median of successful timings
        if (analysis.successTimings.length >= 3) {
            const sorted = [...analysis.successTimings].sort((a, b) => a - b);
            analysis.optimalTiming = sorted[Math.floor(sorted.length / 2)];
            analysis.confidence = Math.min(90, 30 + (analysis.successCount * 5));
            console.log(`   ✅ [${dataType}] Using median SUCCESS timing: ${analysis.optimalTiming}ms`);
        }
        // If we have LEFT_EARLY data, stay behind the earliest timing
        else if (analysis.leftEarlyTimings.length >= 3) {
            const minLeftEarly = Math.min(...analysis.leftEarlyTimings);
            analysis.optimalTiming = minLeftEarly - 50; // Stay 50ms behind
            analysis.confidence = Math.min(70, 20 + (analysis.leftEarlyCount * 3));
            console.log(`   ✅ [${dataType}] Using LEFT_EARLY strategy: ${analysis.optimalTiming}ms (50ms behind ${minLeftEarly}ms)`);
        }
        // If we have 3S_ERROR data, it means we're too fast - slow down
        else if (analysis.errorCount >= 3) {
            // Use current timing + 50ms (slow down)
            analysis.optimalTiming = this.currentTiming + 50;
            analysis.confidence = 20;
            console.log(`   ⚠️ [${dataType}] Multiple 3S_ERROR - suggesting slower: ${analysis.optimalTiming}ms`);
        }
        
        return analysis;
    }
    
    /**
     * Initialize from database with HYBRID LEARNING
     * HYBRID: Learn from past rivals + adapt to current rival
     */
    async initializeFromDatabase() {
        if (!this.supabase) {
            console.log(`⚠️ [INIT] No database connection - skipping initialization`);
            return;
        }

        console.log(`\n🔄 ========== INITIALIZING FROM DATABASE ==========`);
        console.log(`   Loading ALL records for user ${this.userId}, connection ${this.connectionNumber}...`);
        
        try {
            const startTime = Date.now();
            
            // ✅ LOAD ALL RECORDS (no limit) - one-time full load
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('player_name, timing_value, adjustment_reason, timestamp_ms, created_at, is_success')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .eq('is_defense', false)
                .order('created_at', { ascending: false });
            
            if (error) {
                console.error(`❌ [INIT] Database error:`, error);
                return;
            }
            
            const loadTime = Date.now() - startTime;
            console.log(`   ✅ Loaded ${data?.length || 0} records in ${loadTime}ms`);
            
            if (!data || data.length === 0) {
                console.log(`   ⚠️ No historical data found - starting fresh`);
                this.fullDBCache.isInitialized = true;
                return;
            }
            
            // Store all records
            this.fullDBCache.allRecords = data;
            this.fullDBCache.lastFetchTime = new Date().toISOString();
            
            // Build per-rival index
            const rivalIndex = {};
            data.forEach(record => {
                const rivalName = record.player_name;
                if (!rivalName) return;
                
                if (!rivalIndex[rivalName]) {
                    rivalIndex[rivalName] = [];
                }
                rivalIndex[rivalName].push(record);
            });
            
            this.fullDBCache.rivalIndex = rivalIndex;
            this.fullDBCache.isInitialized = true;
            
            // Log summary
            const rivalCount = Object.keys(rivalIndex).length;
            console.log(`   📊 Built index for ${rivalCount} rivals:`);
            Object.entries(rivalIndex).forEach(([name, records]) => {
                const leftEarly = records.filter(r => r.adjustment_reason === 'LEFT_EARLY').length;
                const success = records.filter(r => r.adjustment_reason === 'SUCCESS').length;
                const kicked = records.filter(r => r.adjustment_reason === 'KICKED').length;
                const error3s = records.filter(r => r.adjustment_reason === '3S_ERROR').length;
                console.log(`      ${name}: ${records.length} records (LEFT_EARLY: ${leftEarly}, SUCCESS: ${success}, KICKED: ${kicked}, 3S_ERROR: ${error3s})`);
            });
            
            console.log(`================================================\n`);
            
        } catch (error) {
            console.error(`❌ [INIT] Error loading database:`, error);
        }
    }
    
    // ✅ NEW: Fetch only NEW records (incremental update)
    async fetchNewRecords() {
        if (!this.supabase || !this.fullDBCache.isInitialized) {
            return;
        }
        
        try {
            // Fetch only records created after last fetch
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('player_name, timing_value, adjustment_reason, timestamp_ms, created_at, is_success')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .eq('is_defense', false)
                .gt('created_at', this.fullDBCache.lastFetchTime)
                .order('created_at', { ascending: false });
            
            if (error || !data || data.length === 0) {
                return; // No new records
            }
            
            console.log(`   🔄 [CACHE UPDATE] Fetched ${data.length} new records`);
            
            // Append to allRecords
            this.fullDBCache.allRecords = [...data, ...this.fullDBCache.allRecords];
            this.fullDBCache.lastFetchTime = new Date().toISOString();
            
            // Update rival index
            data.forEach(record => {
                const rivalName = record.player_name;
                if (!rivalName) return;
                
                if (!this.fullDBCache.rivalIndex[rivalName]) {
                    this.fullDBCache.rivalIndex[rivalName] = [];
                }
                this.fullDBCache.rivalIndex[rivalName].unshift(record); // Add to front (most recent)
            });
            
        } catch (error) {
            console.error(`❌ [CACHE UPDATE] Error:`, error);
        }
    }
    
    // ✅ NEW: Get optimal timing for a specific rival from memory
    // Returns rival info even if no valid timing data (to distinguish OLD vs NEW)
    getRivalOptimalTiming(rivalName) {
        if (!this.fullDBCache.isInitialized || !rivalName) {
            return null;
        }
        
        const rivalRecords = this.fullDBCache.rivalIndex[rivalName];
        if (!rivalRecords || rivalRecords.length === 0) {
            return null; // NEW rival - not in DB
        }
        
        // ✅ CRITICAL: Rival EXISTS in DB (OLD rival)
        // Now check what data we have
        const leftEarlyRecords = rivalRecords.filter(r => r.adjustment_reason === 'LEFT_EARLY');
        const successRecords = rivalRecords.filter(r => r.adjustment_reason === 'SUCCESS');
        const kickedRecords = rivalRecords.filter(r => r.adjustment_reason === 'KICKED');
        const error3sRecords = rivalRecords.filter(r => r.adjustment_reason === '3S_ERROR');
        
        // Try LEFT_EARLY first (rival's actual timing)
        // ✅ CRITICAL: Use timing_value (rival's actual timing), NOT timestamp_ms (event timestamp)
        if (leftEarlyRecords.length > 0) {
            const timings = leftEarlyRecords.map(r => r.timing_value).filter(t => t >= 1775 && t <= 2100);
            if (timings.length > 0) {
                // Use median to avoid outliers
                timings.sort((a, b) => a - b);
                const median = timings[Math.floor(timings.length / 2)];
                
                return {
                    isOldRival: true,
                    hasValidData: true,
                    optimalTiming: median - 25, // Stay 25ms behind
                    confidence: Math.min(100, leftEarlyRecords.length * 10), // 10% per record, max 100%
                    recordCount: rivalRecords.length,
                    leftEarlyCount: leftEarlyRecords.length,
                    successCount: successRecords.length,
                    kickedCount: kickedRecords.length,
                    error3sCount: error3sRecords.length,
                    dataSource: 'LEFT_EARLY'
                };
            }
        }
        
        // Fallback to SUCCESS timings (our successful timings against this rival)
        if (successRecords.length > 0) {
            const timings = successRecords.map(r => r.timing_value).filter(t => t >= 1775 && t <= 2100);
            if (timings.length > 0) {
                timings.sort((a, b) => a - b);
                const median = timings[Math.floor(timings.length / 2)];
                
                return {
                    isOldRival: true,
                    hasValidData: true,
                    optimalTiming: median,
                    confidence: Math.min(100, successRecords.length * 15), // 15% per success, max 100%
                    recordCount: rivalRecords.length,
                    leftEarlyCount: leftEarlyRecords.length,
                    successCount: successRecords.length,
                    kickedCount: kickedRecords.length,
                    error3sCount: error3sRecords.length,
                    dataSource: 'SUCCESS'
                };
            }
        }
        
        // ✅ CRITICAL: Rival is in DB but has NO VALID timing data
        // Return info showing it's OLD rival but no usable data
        return {
            isOldRival: true,
            hasValidData: false,
            optimalTiming: null,
            confidence: 0,
            recordCount: rivalRecords.length,
            leftEarlyCount: leftEarlyRecords.length,
            successCount: successRecords.length,
            kickedCount: kickedRecords.length,
            error3sCount: error3sRecords.length,
            dataSource: 'NONE',
            reason: 'ALL_DATA_IS_TRAP_OR_NO_TIMING_DATA'
        };
    }

    async initializeFromDatabase_OLD() {
        console.log(`🧠 Initializing Smart ML Agent (HYBRID LEARNING)...`);
        
        try {
            // Start with NORMAL range (will query database every 5 attempts)
            this.currentZone = 'NORMAL';
            this.currentTiming = ZONES['NORMAL'].center; // 1925ms
            this.lastAdjustmentReason = 'NORMAL_START';
            
            console.log(`   📍 Starting with NORMAL range (median): ${this.currentTiming}ms`);
            console.log(`   🔄 Will query database every 5 attempts for hybrid learning`);
            
            // Check opponent command for additional intelligence
            const commandIntel = this.detectOpponentSpeedFromCommand();
            
            if (commandIntel && commandIntel.confidence >= 80) {
                console.log(`   🎯 Command Intelligence: ${commandIntel.reason}`);
                console.log(`   📍 Suggested direction: ${commandIntel.recommendedRanges.join(' or ')}`);
                console.log(`   ⏳ Will validate with pattern results`);
            }
            
            this.opponentIntelligence.explorationPhase = true;
            this.opponentIntelligence.explorationAttempts = 0;
            
            console.log(`✅ Initialization complete: ${this.currentTiming}ms in ${this.currentZone} range`);
            console.log(`   Strategy: Start NORMAL → Query DB every 5 attempts → Adapt based on hybrid data`);
            
        } catch (error) {
            console.error('[Initialization] Error:', error);
            // Even on error, start with NORMAL
            this.currentTiming = 1925;
            this.currentZone = 'NORMAL';
            this.lastAdjustmentReason = 'INIT';
        }
    }
    
    /**
     * Get optimal timing (called when AI is enabled)
     */
    async getOptimalTiming(timingType) {
        // ✅ CRITICAL: Initialize DB cache if not already done
        if (this.currentTiming === null || !this.fullDBCache.isInitialized) {
            console.log(`\n🔄 [INIT] Initializing SmartML from database...`);
            await this.initializeFromDatabase();
        }
        
        console.log(`🧠 Smart ML Decision:`);
        console.log(`   Timing: ${this.currentTiming}ms`);
        console.log(`   Zone: ${this.currentZone}`);
        console.log(`   Exploration: ${this.opponentIntelligence.explorationPhase ? `${this.opponentIntelligence.explorationAttempts}/5` : 'Complete'}`);
        console.log(`   DB Cache: ${this.fullDBCache.isInitialized ? `✅ Initialized (${this.fullDBCache.allRecords.length} records, ${Object.keys(this.fullDBCache.rivalIndex).length} rivals)` : '❌ Not initialized'}`);
        
        return this.currentTiming;
    }
    
    /**
     * INTELLIGENT DECISION ENGINE WITH SWEET SPOT METHODOLOGY
     * Phase 1: Detect opponent range (2-3 attempts)
     * Phase 2: Find sweet spot in that range (3-5 attempts)
     * Phase 3: Stick to sweet spot and oscillate (ongoing)
     */
    async getNextTiming(lastResult, timingType) {
        this.attemptCount++;
        
        this.recentResults.push(lastResult);
        if (this.recentResults.length > this.maxHistorySize) {
            this.recentResults.shift();
        }
        
        console.log(`\n🎯 ========== ATTEMPT ${this.attemptCount} ==========`);
        console.log(`📊 Last Result: ${lastResult} at ${this.currentTiming}ms in ${this.currentZone} range`);
        
        // ✅ CRITICAL: Ensure DB cache is initialized (important for reconnections)
        if (!this.fullDBCache.isInitialized) {
            console.log(`\n🔄 [DB CACHE] Not initialized - loading now...`);
            await this.initializeFromDatabase();
        }
        
        // ✅ OPTIMIZATION: Fetch new records every 10 attempts (incremental update)
        if (this.attemptCount % 10 === 0 && this.fullDBCache.isInitialized) {
            console.log(`\n🔄 [DB CACHE] Fetching new records (attempt ${this.attemptCount})...`);
            
            // Run in background (non-blocking)
            this.fetchNewRecords().catch(error => {
                console.error(`   ❌ [DB CACHE] Fetch new records failed:`, error);
            });
        }
        
        // ✅ OPTIMIZATION: HYBRID APPROACH - Query database every 5 attempts (NON-BLOCKING)
        if (this.attemptCount % 5 === 0) {
            console.log(`\n🔄 [HYBRID LEARNING] Triggering background database query (attempt ${this.attemptCount})...`);
            
            // Run query in background (don't await - non-blocking)
            this.hybridDatabaseLearning().catch(error => {
                console.error(`   ❌ [HYBRID] Background query failed:`, error);
            });
            
            // Continue immediately with current strategy (don't wait for query)
            console.log(`   ⚡ Continuing with current timing while query runs in background...`);
        }
        
        // ✅ CRITICAL: Check if we should clear stale LEFT_EARLY data FIRST
        // If we're getting consecutive 3S_ERROR, the rival has moved ahead
        // Clear old LEFT_EARLY data before checking recentLeaveTimes
        if (lastResult === '3S_ERROR') {
            const strategy = this.stayBehindStrategy;
            const range = Math.floor(this.currentTiming / 50) * 50;
            
            console.log(`\n🔍 [DEBUG] 3S_ERROR at ${this.currentTiming}ms, range ${range}`);
            console.log(`   lastErrorRange: ${strategy.lastErrorRange}, consecutiveErrorsInRange: ${strategy.consecutiveErrorsInRange}`);
            
            // Track consecutive errors in same range
            if (strategy.lastErrorRange === range) {
                strategy.consecutiveErrorsInRange++;
                console.log(`   → Same range, incrementing counter to ${strategy.consecutiveErrorsInRange}`);
            } else {
                strategy.consecutiveErrorsInRange = 1;
                strategy.lastErrorRange = range;
                console.log(`   → Different range, resetting counter to 1`);
            }
            
            // ✅ FIX: Clear stale LEFT_EARLY data BEFORE checking recentLeaveTimes
            // If we get 3+ consecutive 3S_ERROR, rival moved ahead - old LEFT_EARLY is stale
            // Check if we have ANY LEFT_EARLY data (not just rivalTiming)
            const hasLeftEarlyData = this.opponentIntelligence.opponentLeavingTimes.length > 0;
            console.log(`   hasLeftEarlyData: ${hasLeftEarlyData}, LEFT_EARLY count: ${this.opponentIntelligence.opponentLeavingTimes.length}`);
            
            if (strategy.consecutiveErrorsInRange >= 3 && hasLeftEarlyData) {
                console.log(`⚠️ [STALE DATA] ${strategy.consecutiveErrorsInRange} consecutive 3S_ERROR → Clearing old LEFT_EARLY data`);
                console.log(`   Before clear: LEFT_EARLY array = ${JSON.stringify(this.opponentIntelligence.opponentLeavingTimes)}`);
                this.opponentIntelligence.opponentLeavingTimes = []; // Clear stale data
                strategy.rivalTiming = null;
                strategy.targetTiming = null;
                strategy.consecutiveErrorsInRange = 0;
                console.log(`   After clear: LEFT_EARLY array = ${JSON.stringify(this.opponentIntelligence.opponentLeavingTimes)}`);
            }
        }
        
        // ✅ NEW: Use Stay Behind Rival Strategy
        // Get opponent's actual leaving time from LEFT_EARLY tracking
        const recentLeaveTimes = this.opponentIntelligence.opponentLeavingTimes
            .filter(lt => lt.time !== null && lt.time > 0)
            .slice(-3);
        
        // ✅ CRITICAL: If we don't have 3 LEFT_EARLY events yet, still use updateStayBehindStrategy
        // This ensures timing adjustments persist across reconnections
        if (recentLeaveTimes.length < 3) {
            console.log(`⚠️ [STAY BEHIND] Only ${recentLeaveTimes.length} LEFT_EARLY events (need 3 minimum)`);
            
            // ✅ SIMPLIFIED FIX: When getting 3S_ERROR, ALWAYS use blind exploration
            // Don't trust partial LEFT_EARLY data - it causes drops to 1775ms
            if (lastResult === '3S_ERROR') {
                console.log(`   🔍 [3S_ERROR] Ignoring partial LEFT_EARLY data, using blind exploration`);
                this.updateStayBehindStrategy(null, lastResult);
            } else if (recentLeaveTimes.length === 0) {
                // NO LEFT_EARLY data → Use blind exploration
                console.log(`   🔍 [NO LEFT_EARLY] Rival is ahead, using blind exploration (+25ms steps)`);
                this.updateStayBehindStrategy(null, lastResult);
            } else {
                // Have LEFT_EARLY and NOT getting 3S_ERROR → Use it to reposition
                const recentTimes = recentLeaveTimes.map(lt => lt.time);
                const minTime = Math.min(...recentTimes);
                console.log(`   🚪 [PARTIAL LEFT_EARLY] Have ${recentLeaveTimes.length} events: ${recentTimes.join(', ')}ms`);
                console.log(`   → Rival is BEHIND at ~${minTime}ms, repositioning backward`);
                this.updateStayBehindStrategy(minTime, lastResult);
            }
            
            this.lastAdjustmentReason = `STAY_BEHIND_PARTIAL_${lastResult}`;
            return this.currentTiming;
        }
        
        // ✅ We have 3+ LEFT_EARLY events - analyze variance and trend
        const times = recentLeaveTimes.map(lt => lt.time);
        console.log(`🎯 [STAY BEHIND] Analyzing ${times.length} LEFT_EARLY events: ${times.join('ms, ')}ms`);
        
        // Calculate variance
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const variance = maxTime - minTime;
        
        console.log(`📊 [VARIANCE] Min: ${minTime}ms, Max: ${maxTime}ms, Variance: ${variance}ms`);
        
        let targetOpponentTiming;
        let strategy;
        
        // ✅ STRATEGY 1: Low variance (consistent/trending) - Stay behind EARLIEST
        if (variance <= 50) {
            // Rival is consistent or trending - use MINIMUM (earliest/slowest)
            targetOpponentTiming = minTime;
            strategy = 'CONSISTENT';
            console.log(`✅ [STRATEGY] CONSISTENT/TRENDING (variance ${variance}ms ≤ 50ms)`);
            console.log(`   → Using EARLIEST timing: ${targetOpponentTiming}ms (safest)`);
            
            // Check if trending up or down
            const change1 = times[1] - times[0];
            const change2 = times[2] - times[1];
            if (change1 > 10 && change2 > 10) {
                console.log(`   → Trend: INCREASING (${times[0]} → ${times[1]} → ${times[2]})`);
            } else if (change1 < -10 && change2 < -10) {
                console.log(`   → Trend: DECREASING (${times[0]} → ${times[1]} → ${times[2]})`);
            } else {
                console.log(`   → Trend: STABLE`);
            }
        } 
        // ✅ STRATEGY 2: High variance (erratic/baiting) - Use MEDIAN
        else {
            // Rival is erratic/baiting - use MEDIAN (middle ground)
            const sortedTimes = [...times].sort((a, b) => a - b);
            targetOpponentTiming = sortedTimes[Math.floor(sortedTimes.length / 2)];
            strategy = 'HIGH_VARIANCE';
            console.log(`⚠️ [STRATEGY] HIGH VARIANCE (variance ${variance}ms > 50ms)`);
            console.log(`   → Rival is ERRATIC/BAITING`);
            console.log(`   → Using MEDIAN timing: ${targetOpponentTiming}ms (middle ground)`);
            console.log(`   → Sorted times: ${sortedTimes.join('ms, ')}ms`);
        }
        
        console.log(`🎯 [STAY BEHIND] Target opponent timing: ${targetOpponentTiming}ms (${strategy})`);
        
        // Update stay-behind strategy with calculated opponent timing
        this.updateStayBehindStrategy(targetOpponentTiming, lastResult);
        
        // Return the calculated timing
        this.lastAdjustmentReason = `STAY_BEHIND_${strategy}_${lastResult}`;
        return this.currentTiming;
    }
    
    
    /**
     * Calculate sweet spot from live session data (Phase 2)
     */
    calculateLiveSweetSpot() {
        if (!this.sweetSpotData || this.sweetSpotData.successTimings.length < 2) {
            return null;
        }
        
        const successes = this.sweetSpotData.successTimings;
        const kicks = this.sweetSpotData.kickTimings;
        
        // Find success range
        const minSuccess = Math.min(...successes);
        const maxSuccess = Math.max(...successes);
        const avgSuccess = Math.floor(successes.reduce((a, b) => a + b, 0) / successes.length);
        
        // IMPROVED: More aggressive kick zone avoidance (±20ms buffer instead of ±10ms)
        let safeMin = minSuccess;
        let safeMax = maxSuccess;
        
        kicks.forEach(kickTiming => {
            if (kickTiming >= safeMin - 20 && kickTiming <= safeMax + 20) {
                // Kick near success range - create larger buffer
                if (kickTiming - safeMin < safeMax - kickTiming) {
                    safeMin = kickTiming + 20; // Larger buffer
                } else {
                    safeMax = kickTiming - 20; // Larger buffer
                }
            }
        });
        
        // Ensure we have a valid range
        if (safeMax <= safeMin) {
            // Kick zones overlap - use average of successes with small range
            const optimal = avgSuccess;
            return {
                min: optimal - 15,
                max: optimal + 15,
                optimal,
                confidence: 50, // Lower confidence due to overlap
                successCount: successes.length,
                kickCount: kicks.length
            };
        }
        
        const optimal = Math.floor((safeMin + safeMax) / 2);
        const confidence = Math.min(100, (successes.length / 3) * 100);
        
        return {
            min: safeMin,
            max: safeMax,
            optimal,
            confidence,
            successCount: successes.length,
            kickCount: kicks.length
        };
    }
    

    
    /**
     * Record when a rival kicked you
     */
    recordRivalAttack(yourTimingWhenKicked) {
        this.defenseData.timesKicked++;
        this.defenseData.rivalTimings.push(yourTimingWhenKicked);
        
        const estimatedRivalTiming = yourTimingWhenKicked - 60;
        this.defenseData.estimatedRivalTimings.push(estimatedRivalTiming);
        
        if (this.defenseData.estimatedRivalTimings.length > 0) {
            this.defenseData.fastestRival = Math.min(...this.defenseData.estimatedRivalTimings);
            const sum = this.defenseData.estimatedRivalTimings.reduce((a, b) => a + b, 0);
            this.defenseData.averageRival = Math.round(sum / this.defenseData.estimatedRivalTimings.length);
        }
        
        console.log(`🛡️ Rival kicked you (your timing: ${yourTimingWhenKicked}ms, estimated rival: ${estimatedRivalTiming}ms)`);
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
        const totalAttempts = this.successCount + this.errorCount;
        const successRate = totalAttempts > 0 ? (this.successCount / totalAttempts) * 100 : 0;
        
        return {
            attemptCount: this.attemptCount,
            totalAttempts: totalAttempts,
            successCount: this.successCount,
            successRate: successRate.toFixed(1),
            currentTiming: this.currentTiming,
            currentZone: this.currentZone,
            explorationPhase: this.opponentIntelligence.explorationPhase,
            explorationAttempts: this.opponentIntelligence.explorationAttempts,
            detectedRange: this.opponentIntelligence.detectedRange,
            confidence: this.opponentIntelligence.confidence,
            attackAttempts: totalAttempts,
            attackSuccessRate: successRate.toFixed(1),
            defenseAttempts: 0,
            defenseSuccessRate: '0.0',
            timesKicked: this.defenseData.timesKicked,
            fastestRival: this.defenseData.fastestRival,
            averageRival: this.defenseData.averageRival
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
            yourTiming: this.currentTiming
        };
    }
    
    /**
     * Reset for new session
     */
    reset() {
        this.opponentIntelligence.explorationPhase = true;
        this.opponentIntelligence.explorationAttempts = 0;
        this.opponentIntelligence.resultPattern = [];
        this.opponentIntelligence.timingPattern = [];
        this.recentResults = [];
        this.sweetSpot = null;
        this.sweetSpotData = {
            successTimings: [],
            kickTimings: []
        };
        console.log(`🔄 Smart ML Agent reset (timing preserved: ${this.currentTiming}ms)`);
    }
    
    /**
     * Find success clusters from database (ML-based sweet spot detection)
     * Uses CURRENT ZONE (where bot is operating), not ping context
     * Example: Ping=NORMAL but operating in FAST zone to kick slow opponent
     */
    async findSuccessClusters() {
        if (!this.supabase) return null;
        
        try {
            // Get zone boundaries for CURRENT ZONE (where bot is operating)
            const zone = ZONES[this.currentZone];
            
            console.log(`📊 Finding success clusters in ${this.currentZone} zone (${zone.min}-${zone.max}ms)`);
            
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value, context')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .eq('is_success', true)
                .eq('is_defense', false)
                .gte('timing_value', zone.min)  // ✅ Within CURRENT ZONE boundaries
                .lte('timing_value', zone.max)  // ✅ Within CURRENT ZONE boundaries
                .order('created_at', { ascending: false })
                .limit(1000);
            
            if (error || !data || data.length < 3) {
                console.log(`📊 Insufficient data in ${this.currentZone} zone (${data?.length || 0} records)`);
                return null;
            }
            
            console.log(`📊 Found ${data.length} successes in ${this.currentZone} zone (across all ping contexts)`);
            
            // Group into 10ms buckets
            const buckets = {};
            data.forEach(record => {
                const bucket = Math.floor(record.timing_value / 10) * 10;
                buckets[bucket] = (buckets[bucket] || 0) + 1;
            });
            
            // Find clusters (consecutive buckets with successes)
            const clusters = [];
            let currentCluster = null;
            
            Object.keys(buckets).sort((a, b) => a - b).forEach(bucket => {
                const timing = parseInt(bucket);
                const count = buckets[bucket];
                
                if (!currentCluster) {
                    currentCluster = { min: timing, max: timing + 10, count, timings: [timing] };
                } else if (timing - currentCluster.max <= 20) {
                    currentCluster.max = timing + 10;
                    currentCluster.count += count;
                    currentCluster.timings.push(timing);
                } else {
                    clusters.push(currentCluster);
                    currentCluster = { min: timing, max: timing + 10, count, timings: [timing] };
                }
            });
            
            if (currentCluster) clusters.push(currentCluster);
            
            // Return best cluster (most successes)
            const bestCluster = clusters.sort((a, b) => b.count - a.count)[0];
            
            console.log(`📊 Success cluster: ${bestCluster.min}-${bestCluster.max}ms (${bestCluster.count} successes in ${this.currentZone} zone)`);
            
            return bestCluster;
            
        } catch (error) {
            console.error('Error finding success clusters:', error);
            return null;
        }
    }
    
    /**
     * Find kick zones (dangerous timings where you got kicked)
     * Uses CURRENT ZONE (where bot is operating), not ping context
     */
    async findKickZones() {
        if (!this.supabase) return [];
        
        try {
            // Get zone boundaries for CURRENT ZONE (where bot is operating)
            const zone = ZONES[this.currentZone];
            
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('timing_value, context')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .eq('is_defense', true)
                .gte('timing_value', zone.min)  // ✅ Within CURRENT ZONE boundaries
                .lte('timing_value', zone.max)  // ✅ Within CURRENT ZONE boundaries
                .order('created_at', { ascending: false })
                .limit(50);
            
            if (error || !data || data.length === 0) {
                return [];
            }
            
            console.log(`📊 Found ${data.length} kicks in ${this.currentZone} zone (across all ping contexts)`);
            
            // Group into 10ms buckets
            const kickBuckets = {};
            data.forEach(record => {
                const bucket = Math.floor(record.timing_value / 10) * 10;
                kickBuckets[bucket] = (kickBuckets[bucket] || 0) + 1;
            });
            
            // Return dangerous zones (2+ kicks = dangerous)
            const dangerZones = Object.keys(kickBuckets)
                .filter(bucket => kickBuckets[bucket] >= 2)
                .map(bucket => parseInt(bucket));
            
            if (dangerZones.length > 0) {
                console.log(`⚠️ Kick zones in ${this.currentZone} zone: ${dangerZones.join(', ')}ms`);
            }
            
            return dangerZones;
            
        } catch (error) {
            console.error('Error finding kick zones:', error);
            return [];
        }
    }
    
    /**
     * Calculate safe sweet spot (success zones minus kick zones)
     */
    async calculateSweetSpot() {
        const successCluster = await this.findSuccessClusters();
        const kickZones = await this.findKickZones();
        
        if (!successCluster) {
            console.log(`📊 No sweet spot data - using range center`);
            return null;
        }
        
        let safeMin = successCluster.min;
        let safeMax = successCluster.max;
        
        // Remove kick zones from success cluster
        kickZones.forEach(kickBucket => {
            if (kickBucket >= safeMin && kickBucket <= safeMax) {
                console.log(`⚠️ Kick zone ${kickBucket}ms inside success cluster - adjusting`);
                if (kickBucket - safeMin < safeMax - kickBucket) {
                    safeMin = kickBucket + 10;
                } else {
                    safeMax = kickBucket - 10;
                }
            }
        });
        
        // Calculate optimal (middle of safe zone)
        const optimal = Math.floor((safeMin + safeMax) / 2);
        
        // Calculate confidence (based on success count)
        const confidence = Math.min(100, (successCluster.count / 10) * 100);
        
        const sweetSpot = {
            min: safeMin,
            max: safeMax,
            optimal,
            confidence,
            successCount: successCluster.count,
            kickZones: kickZones.length
        };
        
        console.log(`🎯 Sweet spot calculated:`, sweetSpot);
        
        return sweetSpot;
    }
    
    /**
     * Intelligent oscillation within sweet spot (UNPREDICTABLE)
     * Example: Success at 2080ms → Oscillate 2070, 2080, 2075, 2085, 2078 (random pattern)
     */
    oscillateInSweetSpot(sweetSpot) {
        if (!sweetSpot || sweetSpot.confidence < 30) {
            return null;
        }
        
        const range = sweetSpot.max - sweetSpot.min;
        
        // IMPROVED: More aggressive randomness to avoid predictability
        // Use weighted random distribution favoring optimal but with wide variation
        
        if (range <= 10) {
            // Very tight sweet spot - use wider variation (±8ms instead of ±3ms)
            const variation = Math.floor(Math.random() * 17) - 8; // -8 to +8
            return sweetSpot.optimal + variation;
        } else if (range <= 30) {
            // Medium sweet spot - use completely random timing within safe zone
            // 70% chance: near optimal (±10ms)
            // 30% chance: anywhere in range
            const useOptimal = Math.random() < 0.7;
            
            if (useOptimal) {
                const optimalVariation = Math.floor(Math.random() * 21) - 10; // -10 to +10
                const timing = sweetSpot.optimal + optimalVariation;
                // Clamp to range
                return Math.max(sweetSpot.min, Math.min(sweetSpot.max, timing));
            } else {
                // Random anywhere in range
                return sweetSpot.min + Math.floor(Math.random() * range);
            }
        } else {
            // Wide sweet spot - weighted random (favor center but allow edges)
            // 60% chance: center third
            // 40% chance: anywhere
            const useCenter = Math.random() < 0.6;
            
            if (useCenter) {
                const centerMin = sweetSpot.min + Math.floor(range * 0.33);
                const centerMax = sweetSpot.max - Math.floor(range * 0.33);
                const centerRange = centerMax - centerMin;
                return centerMin + Math.floor(Math.random() * centerRange);
            } else {
                return sweetSpot.min + Math.floor(Math.random() * range);
            }
        }
    }
    
    /**
     * Anti-trap oscillation (when success at high timing like 2080ms)
     * Prevents predictable increase to 2095, 2100 where rival can kick
     */
    // ==================== ADVANCED TACTICS ====================
    

    
    async antiTrapOscillation(lastResult, lastTiming) {
        // Only activate at high timings (>2000ms)
        if (lastTiming < 2000) {
            return null;
        }
        
        console.log(`🎭 Anti-trap mode: Last ${lastResult} at ${lastTiming}ms`);
        
        // Update sweet spot every 3 attempts
        if (!this.sweetSpot || this.attemptCount % 3 === 0) {
            this.sweetSpot = await this.calculateSweetSpot();
        }
        
        if (lastResult === 'SUCCESS') {
            // SUCCESS at high timing - DON'T increase predictably!
            if (this.sweetSpot && this.sweetSpot.confidence > 40) {
                // Use sweet spot oscillation (unpredictable)
                const newTiming = this.oscillateInSweetSpot(this.sweetSpot);
                console.log(`✅ SUCCESS at ${lastTiming}ms → Oscillating to ${newTiming}ms (unpredictable)`);
                return newTiming;
            } else {
                // No sweet spot - drop back to avoid trap
                const newTiming = lastTiming - 15;
                console.log(`✅ SUCCESS at ${lastTiming}ms → Dropping to ${newTiming}ms (avoid trap)`);
                return newTiming;
            }
        } else if (lastResult === 'KICKED') {
            // KICKED at high timing - DANGER! Drop significantly
            const newTiming = lastTiming - 30;
            console.log(`🚨 KICKED at ${lastTiming}ms → Emergency drop to ${newTiming}ms`);
            return newTiming;
        } else if (lastResult === '3S_ERROR') {
            // 3S at high timing - we kicked too early, need to wait longer
            const newTiming = lastTiming + 8;
            console.log(`⚠️ 3S_ERROR at ${lastTiming}ms → Careful increase to ${newTiming}ms`);
            return newTiming;
        }
        
        return null;
    }
}

module.exports = { SmartMLAgent };

