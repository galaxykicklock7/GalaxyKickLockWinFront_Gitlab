/**
 * Simple AI Core - Minimal rival data storage and retrieval
 * No ML, no complex strategies - just database operations
 * Drop-in replacement for SmartMLAgent
 */
const DEBUG = process.env.DEBUG === 'true';

class SimpleAICore {
    constructor(supabase, userId, wsNumber, connectionNumber) {
        this.supabase = supabase;
        this.userId = userId;
        this.wsNumber = wsNumber;
        this.connectionNumber = connectionNumber;

        // Current state (will be initialized from DB ping)
        this.currentTiming = null; // Will be set based on ping
        this.attackTiming = null;
        this.defenseTiming = null;
        this.currentRivalName = null;
        this.initialTimingSet = false; // Flag to track if initial timing was set

        // Zone danger tracking (for zone-aware ML)
        this.zoneMultipliers = { SLOW: 1.0, NORMAL: 1.0, FAST: 1.0 };

        // Context-based timing-memory)
        this.rivalCache = new Map(); // rivalName -> { optimalTiming, lastUpdated, recordCount }

        // Stats tracking
        this.stats = {
            totalAttempts: 0,
            successCount: 0,
            kickedCount: 0,
            errorCount: 0,
            attackAttempts: 0,
            attackSuccess: 0,
            defenseAttempts: 0,
            defenseSuccess: 0
        };

        // Last adjustment reason
        this.lastAdjustmentReason = 'INIT';

        // Opponent intelligence (for LEFT_EARLY tracking)
        this.opponentIntelligence = {
            opponentLeavingTimes: []
        };

        // Database requery flags (always false for simple mode)
        this.shouldRequeryDatabase = false;
        this.requeryTimingType = null;

        // 🔥 ML PREDICTION ENGINE
        this.mlHistory = []; // Track opponent zones and results (KICKED/3S_ERROR only)
        this.opponentZoneHistory = []; // Track opponent timing zones
        this.consecutiveFailures = 0;
        this.lastTimingType = null; // Track mode to reset failures on mode switch

        // 🔄 ZONE OSCILLATION (unpredictability strategy)
        // Alternates between opponent's zone and adjacent zone on each SUCCESS
        this.zoneOscillationToggle = false; // flips true/false each SUCCESS round
        this.oscillatedTiming = null;       // stores oscillated zone timing for next fire
        //   → null = use currentTiming directly (no oscillation active)

        // 🎯 PREEMPTIVE SHIFT: Track consecutive successes in same zone
        // After 2+ successes, opponent will likely shift away — anticipate it
        this.consecutiveSuccessCount = 0;
        this.lastSuccessZone = null;       // zone where successes are clustering
        this.lastSuccessTiming = null;     // timing of the last success

        // 🛡️ DB TRUST CONTROL: Reduce DB influence right after ML corrects from KICKED
        // Prevents DB refresh from dragging timing back to stale success zones
        this.recentKickedCount = 0;        // how many KICKs since last SUCCESS (0 = DB can trust normally)

        // 🔒 FIX B: LEFT_EARLY drop cap — never drop more than 50ms below last known success
        this.lastKnownSuccessTiming = null; // timing where we last got SUCCESS

        // 🚀 FIX C: Adaptive 3S_ERROR step — accelerate when clearly chasing from behind
        this.consecutive3sErrors = 0;       // count of consecutive 3S_ERRORs (reset on any non-3S_ERROR)

        // 🧠 OPPONENT BOUNDS: Mathematical tracking of where opponent CAN possibly be
        // Based on: results give guaranteed boundaries + humans move max ~50ms per round
        this.opponentFloor = null;          // lowest the opponent can possibly be (guaranteed)
        this.opponentCeiling = null;        // highest the opponent can possibly be (estimated)
        this.opponentLastKnownAt = null;    // most accurate known position (from SUCCESS)
        this.opponentBoundsRound = 0;       // which round the bounds were last updated
        this.MAX_OPPONENT_MOVE = 50;        // max ms an opponent can shift per round

        // 🎯 SPEED PRESET BOUNDS: When user selects SLOW/NORMAL/FAST, timing is clamped to that range
        // Default: full range 1775-2150 (no preset selected)
        this.speedPreset = '';              // '', 'SLOW', 'NORMAL', 'FAST'
        this.timingFloor = 1775;            // absolute minimum timing
        this.timingCeiling = 2150;          // absolute maximum timing

        DEBUG && console.log(`✅ Simple AI Core initialized with ML prediction for user ${userId}, connection ${connectionNumber}`);

        // Note: Timing will be initialized on first getOptimalTiming() call
    }



    /**
     * 🎯 Set speed preset from frontend config
     * Updates timing bounds and re-initializes timing to the preset's median
     * SLOW: 1775-1875 (median 1825), NORMAL: 1875-1975 (median 1925), FAST: 1975-2150 (median 2062)
     *
     * IMPORTANT: When preset changes, zone multipliers are reset to neutral (1.0) because
     * the historical kick data (slowZoneKicked, etc.) is now in a different context.
     */
    setSpeedPreset(preset) {
        const oldPreset = this.speedPreset;
        this.speedPreset = preset || '';

        if (this.speedPreset === 'SLOW') {
            this.timingFloor = 1775;
            this.timingCeiling = 1875;
        } else if (this.speedPreset === 'NORMAL') {
            this.timingFloor = 1875;
            this.timingCeiling = 1975;
        } else if (this.speedPreset === 'FAST') {
            this.timingFloor = 1975;
            this.timingCeiling = 2150;
        } else {
            // No preset — full range
            this.timingFloor = 1775;
            this.timingCeiling = 2150;
        }

        DEBUG && console.log(`🎯 Speed preset: ${oldPreset || 'NONE'} → ${this.speedPreset || 'NONE'} (bounds: ${this.timingFloor}-${this.timingCeiling}ms)`);

        // Reset zone multipliers to neutral when preset changes (old DB stats now in different context)
        if (oldPreset !== this.speedPreset) {
            this.zoneMultipliers = { SLOW: 1.0, NORMAL: 1.0, FAST: 1.0 };
            DEBUG && console.log(`   🔄 Zone multipliers reset to neutral (1.0x) due to preset change`);
        }

        // Re-clamp current timing to new bounds
        if (this.currentTiming !== null) {
            const before = this.currentTiming;
            this.currentTiming = this.clampTiming(this.currentTiming);
            if (this.attackTiming !== null) this.attackTiming = this.clampTiming(this.attackTiming);
            if (this.defenseTiming !== null) this.defenseTiming = this.clampTiming(this.defenseTiming);
            if (before !== this.currentTiming) {
                DEBUG && console.log(`   ⚠️ Timing re-clamped: ${before}ms → ${this.currentTiming}ms`);
            }
        }
    }

    /**
     * 🔒 Clamp timing to current speed preset bounds
     * Replaces all hardcoded Math.max(1775, Math.min(2150, ...)) calls
     */
    clampTiming(timing) {
        return Math.max(this.timingFloor, Math.min(this.timingCeiling, timing));
    }

    /**
     * Initialize timing based on bot's ping from database
     * SLOW: 1775-1875ms (ping < 50) -> median 1825ms
     * NORMAL: 1875-1975ms (ping 50-100) -> median 1925ms
     * FAST: 1975-2150ms (ping > 100) -> median 2062ms
     */
    async initializeTimingFromPing() {
        // If already initialized, skip
        if (this.initialTimingSet) return;

        // 🎯 If speed preset is set, use its median instead of ping-based timing
        if (this.speedPreset) {
            let initialTiming;
            if (this.speedPreset === 'SLOW') {
                initialTiming = 1825;
            } else if (this.speedPreset === 'NORMAL') {
                initialTiming = 1925;
            } else if (this.speedPreset === 'FAST') {
                initialTiming = 2062;
            } else {
                initialTiming = 1925;
            }
            DEBUG && console.log(`🎯 Speed preset ${this.speedPreset} → Starting at ${initialTiming}ms (bounds: ${this.timingFloor}-${this.timingCeiling}ms)`);
            this.currentTiming = initialTiming;
            this.attackTiming = initialTiming;
            this.defenseTiming = initialTiming;
            this.initialTimingSet = true;
            return;
        }

        // If no Supabase client, use default timing
        if (!this.supabase) {
            DEBUG && console.log(`⚠️ No Supabase client, using default timing`);
            this.setDefaultTiming();
            return;
        }

        try {
            DEBUG && console.log(`🔍 Initializing timing from database ping...`);

            // Query database for bot's ping (our ping, not opponent's)
            const { data, error } = await this.supabase
                .from('imprisonment_metrics')
                .select('ping_ms')
                .eq('user_id', this.userId)
                .eq('connection_number', this.connectionNumber)
                .not('ping_ms', 'is', null)
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) {
                console.error(`   ❌ Database query error:`, error);
                this.setDefaultTiming();
                return;
            }

            if (!data || data.length === 0) {
                DEBUG && console.log(`   ℹ️ No ping data found, using default`);
                this.setDefaultTiming();
                return;
            }

            // Calculate average ping from recent records
            const avgPing = Math.round(data.reduce((sum, r) => sum + r.ping_ms, 0) / data.length);
            DEBUG && console.log(`   📊 Average bot ping: ${avgPing}ms (from ${data.length} records)`);

            // Determine timing range based on ping
            let initialTiming;
            if (avgPing < 50) {
                initialTiming = 1825;
                DEBUG && console.log(`   🐢 SLOW ping detected (${avgPing}ms) -> Starting at ${initialTiming}ms`);
            } else if (avgPing <= 100) {
                initialTiming = 1925;
                DEBUG && console.log(`   ⚡ NORMAL ping detected (${avgPing}ms) -> Starting at ${initialTiming}ms`);
            } else {
                initialTiming = 2062;
                DEBUG && console.log(`   🚀 FAST ping detected (${avgPing}ms) -> Starting at ${initialTiming}ms`);
            }

            this.currentTiming = this.clampTiming(initialTiming);
            this.attackTiming = this.currentTiming;
            this.defenseTiming = this.currentTiming;
            this.initialTimingSet = true;

        } catch (error) {
            console.error(`   ❌ Error initializing timing:`, error);
            this.setDefaultTiming();
        }
    }

    /**
     * Set default timing (fallback when no ping data available)
     */
    setDefaultTiming() {
        // Use median of current speed preset bounds
        const median = Math.round((this.timingFloor + this.timingCeiling) / 2);
        this.currentTiming = median;
        this.attackTiming = median;
        this.defenseTiming = median;
        this.initialTimingSet = true;
        DEBUG && console.log(`   ⚙️ Using default timing: ${this.currentTiming}ms`);
    }

    /**
     * Get current timing (called when AI is enabled)
     */
    async getOptimalTiming(timingType) {
        // Ensure timing is initialized
        if (!this.initialTimingSet) {
            await this.initializeTimingFromPing();
        }

        // Fallback: If still null, use safe default (median of current bounds)
        if (!this.currentTiming) {
            const median = Math.round((this.timingFloor + this.timingCeiling) / 2);
            DEBUG && console.log(`⚠️ Timing not initialized, using safe default: ${median}ms`);
            this.currentTiming = median;
            this.attackTiming = median;
            this.defenseTiming = median;
            this.initialTimingSet = true;
        }

        DEBUG && console.log(`🧠 Simple AI: Current timing ${this.currentTiming}ms`);
        return this.currentTiming;
    }

    /**
     * Get zone for a given timing
     * SLOW: 1775-1875ms, NORMAL: 1875-1975ms, FAST: 1975-2150ms
     */
    getZone(timing) {
        if (timing < 1875) return 'SLOW';
        if (timing < 1975) return 'NORMAL';
        return 'FAST';
    }

    /**
     * 🧠 OPPONENT BOUNDS: Update the mathematical bounds on where opponent can be
     * Called every round with the result. Builds guaranteed boundaries.
     *
     * Rules:
     *   3S_ERROR at X  → opponent is guaranteed ABOVE X → floor = max(floor, X)
     *   KICKED at X    → opponent is guaranteed BELOW X → ceiling = min(ceiling, X)
     *   SUCCESS at X   → opponent is approximately AT X → lastKnownAt = X, floor ≈ X-15
     *   LEFT_EARLY at X → opponent WAS at X (snapshot, may be stale)
     *
     * Every round, bounds decay by MAX_OPPONENT_MOVE (opponent can shift ±50ms per round)
     */
    updateOpponentBounds(result, ourTiming, opponentLeftTime = null) {
        const roundsSinceUpdate = this.stats.totalAttempts - this.opponentBoundsRound;

        // Decay existing bounds — opponent could have moved since last update
        // ✅ FIX: Use sqrt decay instead of linear to keep bounds meaningful longer
        // Linear was: ±50ms * rounds (useless after 2-3 rounds)
        // Sqrt is: ±50ms * sqrt(rounds) → 1r=50, 2r=71, 3r=87, 5r=112
        if (this.opponentFloor !== null && roundsSinceUpdate > 0) {
            const decay = Math.round(this.MAX_OPPONENT_MOVE * Math.sqrt(roundsSinceUpdate));
            this.opponentFloor = this.opponentFloor - decay;
            // Clamp to speed preset bounds (respect user-selected SLOW/NORMAL/FAST)
            this.opponentFloor = Math.max(this.timingFloor, this.opponentFloor);
        }
        if (this.opponentCeiling !== null && roundsSinceUpdate > 0) {
            const decay = Math.round(this.MAX_OPPONENT_MOVE * Math.sqrt(roundsSinceUpdate));
            this.opponentCeiling = this.opponentCeiling + decay;
            // Clamp to speed preset bounds (respect user-selected SLOW/NORMAL/FAST)
            this.opponentCeiling = Math.min(this.timingCeiling, this.opponentCeiling);
        }

        // Update bounds based on result
        if (result === '3S_ERROR') {
            // Opponent is ABOVE ourTiming — this is a guaranteed floor
            const newFloor = ourTiming;
            if (this.opponentFloor === null || newFloor > this.opponentFloor) {
                this.opponentFloor = newFloor;
                DEBUG && console.log(`   🧠 BOUNDS: Floor updated → ${this.opponentFloor}ms (opponent is above this)`);
            }
        } else if (result === 'KICKED') {
            // Opponent is BELOW ourTiming — this is a guaranteed ceiling
            const newCeiling = ourTiming;
            if (this.opponentCeiling === null || newCeiling < this.opponentCeiling) {
                this.opponentCeiling = newCeiling;
                DEBUG && console.log(`   🧠 BOUNDS: Ceiling updated → ${this.opponentCeiling}ms (opponent is below this)`);
            }
        } else if (result === 'SUCCESS') {
            // Opponent is approximately AT ourTiming — most accurate data point
            this.opponentLastKnownAt = ourTiming;
            this.opponentFloor = Math.max(this.timingFloor, ourTiming - 15);  // Clamp to speed preset
            this.opponentCeiling = Math.min(this.timingCeiling, ourTiming + 15); // Clamp to speed preset
            DEBUG && console.log(`   🧠 BOUNDS: Known position → ${ourTiming}ms (floor=${this.opponentFloor}, ceiling=${this.opponentCeiling})`);
        } else if (result === 'LEFT_EARLY_VALID') {
            // LEFT_EARLY that passed plausibility check — opponent WAS at this timing
            // Use it as a known position but with wider uncertainty (±30ms)
            this.opponentLastKnownAt = ourTiming; // ourTiming = opponentLeftTime in this case
            this.opponentFloor = Math.max(this.timingFloor, ourTiming - 30);  // Clamp to speed preset
            this.opponentCeiling = Math.min(this.timingCeiling, ourTiming + 30); // Clamp to speed preset
            DEBUG && console.log(`   🧠 BOUNDS: LEFT_EARLY position → ${ourTiming}ms (floor=${this.opponentFloor}, ceiling=${this.opponentCeiling})`);
        }

        this.opponentBoundsRound = this.stats.totalAttempts;

        // Log current bounds
        DEBUG && console.log(`   🧠 BOUNDS: floor=${this.opponentFloor}ms, ceiling=${this.opponentCeiling}ms, lastKnown=${this.opponentLastKnownAt}ms`);
    }

    /**
     * 🧠 OPPONENT BOUNDS: Check if a LEFT_EARLY timing is physically possible
     * Returns true if the timing is within the opponent's possible range
     */
    isLeftEarlyPlausible(leftEarlyTiming) {
        if (this.opponentFloor === null) return true; // No bounds yet, trust it

        // If LEFT_EARLY timing is below our guaranteed floor, it's suspicious
        if (leftEarlyTiming < this.opponentFloor) {
            DEBUG && console.log(`   🧠 BOUNDS CHECK: LEFT_EARLY ${leftEarlyTiming}ms is BELOW floor ${this.opponentFloor}ms → IMPLAUSIBLE`);
            return false;
        }
        return true;
    }

    /**
     * 🧠 OPPONENT BOUNDS: Get the best estimate of where opponent is RIGHT NOW
     * Used by 3S_ERROR handler for smarter stepping
     * IMPORTANT: All estimates are clamped to speed preset bounds
     */
    getOpponentEstimate() {
        // Best case: we have both floor and ceiling → opponent is between them
        if (this.opponentFloor !== null && this.opponentCeiling !== null) {
            const mid = Math.round((this.opponentFloor + this.opponentCeiling) / 2);
            const clamped = this.clampTiming(mid);
            return { estimate: clamped, confidence: 'HIGH', reasoning: `midpoint of ${this.opponentFloor}-${this.opponentCeiling} → ${clamped}ms (clamped)` };
        }

        // Have floor only (common in 3S_ERROR chase) → opponent is above floor
        // Best guess: floor + MAX_OPPONENT_MOVE (they could be up to 50ms above)
        if (this.opponentFloor !== null) {
            const estimate = this.opponentFloor + this.MAX_OPPONENT_MOVE;
            const clamped = this.clampTiming(estimate);
            return { estimate: clamped, confidence: 'MEDIUM', reasoning: `floor ${this.opponentFloor} + ${this.MAX_OPPONENT_MOVE}ms max move → ${clamped}ms (clamped)` };
        }

        // Have ceiling only (rare, after KICKED) → opponent is below ceiling
        if (this.opponentCeiling !== null) {
            const estimate = this.opponentCeiling - this.MAX_OPPONENT_MOVE;
            const clamped = this.clampTiming(estimate);
            return { estimate: clamped, confidence: 'MEDIUM', reasoning: `ceiling ${this.opponentCeiling} - ${this.MAX_OPPONENT_MOVE}ms → ${clamped}ms (clamped)` };
        }

        return { estimate: null, confidence: 'NONE', reasoning: 'no bounds data' };
    }

    /**
     * Scale adjustment based on zone danger
     * ONLY applies to negative adjustments (moving faster/into danger)
     * Positive adjustments (moving slower/away from danger) are NOT scaled
     * 
     * High danger (1.5x) → Reduce adjustment by 40% (multiply by 0.6)
     * Medium danger (1.2x) → Reduce adjustment by 20% (multiply by 0.8)
     * Low danger (0.8x) → Increase adjustment by 20% (multiply by 1.2)
     */
    scaleAdjustmentForZone(adjustment, timing) {
        // CRITICAL: Only scale negative adjustments (moving into potential danger)
        // Positive adjustments (moving away from danger) should be full strength
        if (adjustment > 0) {
            return adjustment; // Don't scale positive adjustments
        }

        const zone = this.getZone(timing);
        const multiplier = this.zoneMultipliers[zone] || 1.0;

        let scaleFactor = 1.0;
        if (multiplier >= 1.5) {
            scaleFactor = 0.6; // High danger - be very careful
        } else if (multiplier >= 1.2) {
            scaleFactor = 0.8; // Medium danger - be somewhat careful
        } else if (multiplier <= 0.8) {
            scaleFactor = 1.2; // Low danger - be more aggressive
        }

        const scaledAdjustment = Math.round(adjustment * scaleFactor);

        if (scaleFactor !== 1.0) {
            DEBUG && console.log(`   🎯 Zone-aware scaling: ${zone} zone (${multiplier}x) → ${adjustment}ms scaled to ${scaledAdjustment}ms`);
        }

        return scaledAdjustment;
    }

    /**
     * ✅ FIX: Update zone multipliers from DB data so scaleAdjustmentForZone() actually works.
     * Uses same thresholds as the SQL function (>=8 = HIGH 1.5x, >=4 = MEDIUM 1.2x, else LOW 0.8x)
     */
    updateZoneMultipliers(rivalData) {
        if (!rivalData) return;
        const slow = rivalData.slowZoneKicked || 0;
        const normal = rivalData.normalZoneKicked || 0;
        const fast = rivalData.fastZoneKicked || 0;

        this.zoneMultipliers.SLOW = slow >= 8 ? 1.5 : slow >= 4 ? 1.2 : 0.8;
        this.zoneMultipliers.NORMAL = normal >= 8 ? 1.5 : normal >= 4 ? 1.2 : 0.8;
        this.zoneMultipliers.FAST = fast >= 8 ? 1.5 : fast >= 4 ? 1.2 : 0.8;

        DEBUG && console.log(`   🗺️ Zone multipliers updated: SLOW=${this.zoneMultipliers.SLOW}, NORMAL=${this.zoneMultipliers.NORMAL}, FAST=${this.zoneMultipliers.FAST}`);
    }

    /**
     * 🔥 ML PREDICTION ENGINE - Predict next timing based on opponent behavior
     * NOTE: SUCCESS and LEFT_EARLY are handled separately in getNextTiming()
     * This only handles KICKED and 3S_ERROR scenarios
     */
    predictNextTimingML(lastResult, lastOpponentZone) {
        // Track history (only for KICKED and 3S_ERROR)
        if (lastResult && lastOpponentZone && (lastResult === 'KICKED' || lastResult === '3S_ERROR')) {
            this.mlHistory.push({
                timing: this.currentTiming,
                result: lastResult,
                opponentZone: lastOpponentZone
            });
            // Cap mlHistory to prevent memory leak in long sessions
            if (this.mlHistory.length > 20) {
                this.mlHistory.shift();
            }

            this.opponentZoneHistory.push(lastOpponentZone);
            if (this.opponentZoneHistory.length > 15) {
                this.opponentZoneHistory.shift();
            }

            // Track consecutive failures
            this.consecutiveFailures++;
        }

        // First attempt - start at median of current speed preset range
        if (this.mlHistory.length === 0) {
            const median = Math.round((this.timingFloor + this.timingCeiling) / 2);
            return { timing: median, reasoning: `Smart start at ${this.speedPreset || 'default'} median (${this.timingFloor}-${this.timingCeiling})` };
        }

        const recent = this.mlHistory.slice(-7); // Last 7 attempts
        const recentKicked = recent.filter(r => r.result === 'KICKED');
        const recentError = recent.filter(r => r.result === '3S_ERROR');

        // 🔥 STRATEGY 1: BINARY SEARCH (when we have both bounds)
        if (recentKicked.length >= 1 && recentError.length >= 1) {
            const maxError = Math.max(...recentError.map(r => r.timing));
            const minKicked = Math.min(...recentKicked.map(r => r.timing));
            const rawAdjustment = Math.round((minKicked - maxError) * 0.25);

            // Only scale if moving faster (negative adjustment)
            const scaledAdjustment = rawAdjustment < 0
                ? this.scaleAdjustmentForZone(rawAdjustment, maxError)
                : rawAdjustment;

            const prediction = maxError + scaledAdjustment;
            return { timing: prediction, reasoning: `BINARY: ${maxError}-${minKicked} → ${prediction}ms` };
        }

        // 🔥 STRATEGY 2: DETECT OSCILLATION
        if (this.opponentZoneHistory.length >= 6) {
            const zones = this.opponentZoneHistory.slice(-6);
            const uniqueZones = [...new Set(zones)];

            if (uniqueZones.length >= 2 && uniqueZones.length <= 3) {
                const minZone = Math.min(...zones);
                const maxZone = Math.max(...zones);
                const middle = Math.round((minZone + maxZone) / 2);

                // CRITICAL FIX: Respect the last result direction
                // If we got 3S_ERROR, we must move SLOWER (increase timing)
                // If we got KICKED, we must move FASTER (decrease timing)
                if (lastResult === '3S_ERROR' && middle < this.currentTiming) {
                    // Don't move faster when we got an error!
                    return { timing: this.currentTiming + 45, reasoning: `ERROR → +45ms (oscillation ignored)` };
                } else if (lastResult === 'KICKED' && middle > this.currentTiming) {
                    // Don't move slower when we got kicked!
                    return { timing: this.currentTiming - 45, reasoning: `KICKED → -45ms (oscillation ignored)` };
                }

                return { timing: middle, reasoning: `Oscillation: ${minZone}-${maxZone} → ${middle}ms` };
            }
        }

        // 🔥 STRATEGY 3: DETECT HIGH VARIANCE
        if (this.opponentZoneHistory.length >= 5) {
            const zones = this.opponentZoneHistory.slice(-5);
            const mean = zones.reduce((a, b) => a + b, 0) / zones.length;
            const variance = zones.reduce((sum, z) =>
                sum + Math.pow(z - mean, 2), 0) / zones.length;
            const stdDev = Math.sqrt(variance);

            if (stdDev > 40) {
                const minZone = Math.min(...zones);
                const maxZone = Math.max(...zones);
                const middle = Math.round((minZone + maxZone) / 2);

                // CRITICAL FIX: Respect the last result direction
                if (lastResult === '3S_ERROR' && middle < this.currentTiming) {
                    // Don't move faster when we got an error!
                    return { timing: this.currentTiming + 45, reasoning: `ERROR → +45ms (variance ignored)` };
                } else if (lastResult === 'KICKED' && middle > this.currentTiming) {
                    // Don't move slower when we got kicked!
                    return { timing: this.currentTiming - 45, reasoning: `KICKED → -45ms (variance ignored)` };
                }

                return { timing: middle, reasoning: `High variance (${Math.round(stdDev)}ms) → ${middle}ms` };
            }
        }

        // 🔥 CHANGE 4: SMALLER ADJUSTMENTS (more precise, less exploration)
        if (lastResult === 'KICKED') {
            const rawAdjustment = this.consecutiveFailures >= 2 ? -40 : -30;
            const scaledAdjustment = this.scaleAdjustmentForZone(rawAdjustment, this.currentTiming);
            // Ensure minimum movement of -20ms to prevent getting stuck
            const finalAdjustment = Math.min(scaledAdjustment, -20);
            return { timing: this.currentTiming + finalAdjustment, reasoning: `KICKED → ${finalAdjustment}ms (precise)` };
        } else if (lastResult === '3S_ERROR') {
            // 🧠 BOUNDS-AWARE 3S_ERROR: Use opponent estimate if available
            const estimate = this.getOpponentEstimate();

            if (estimate.confidence !== 'NONE' && estimate.estimate !== null) {
                // We have bounds data — jump toward estimated opponent position
                const targetTiming = estimate.estimate;
                const gap = targetTiming - this.currentTiming;

                if (gap > 10) {
                    // Opponent estimate is above us — jump most of the way (80%)
                    // We go 80% to avoid overshooting and getting KICKED
                    const boundsStep = Math.round(gap * 0.8);
                    // But cap at reasonable max to stay safe
                    const safeBoundsStep = Math.min(boundsStep, 80);
                    // And ensure minimum movement
                    const finalStep = Math.max(safeBoundsStep, 25);
                    return { timing: this.currentTiming + finalStep, reasoning: `BOUNDS → +${finalStep}ms (est:${targetTiming}, conf:${estimate.confidence})` };
                }
            }

            // Fallback: No useful bounds data — use adaptive step (Fix C)
            let adjustment;
            if (this.consecutive3sErrors >= 6) {
                adjustment = +65;
            } else if (this.consecutive3sErrors >= 4) {
                adjustment = +50;
            } else if (this.consecutiveFailures >= 2) {
                adjustment = +40;
            } else {
                adjustment = +30;
            }
            return { timing: this.currentTiming + adjustment, reasoning: `ERROR → +${adjustment}ms (chase:${this.consecutive3sErrors})` };
        }

        // 🔥 STRATEGY 5: MULTIPLE KICKS/ERRORS (smaller adjustments)
        if (recentKicked.length >= 2) {
            const min = Math.min(...recentKicked.map(r => r.timing));
            const rawAdjustment = -35;
            const scaledAdjustment = this.scaleAdjustmentForZone(rawAdjustment, min);
            // Ensure minimum movement of -20ms to prevent getting stuck
            const finalAdjustment = Math.min(scaledAdjustment, -20);
            return { timing: min + finalAdjustment, reasoning: `${recentKicked.length} kicks → ${finalAdjustment}ms (precise)` };
        }

        if (recentError.length >= 2) {
            const max = Math.max(...recentError.map(r => r.timing));
            // Multiple errors: Smaller adjustment for precision
            const adjustment = +35;
            return { timing: max + adjustment, reasoning: `${recentError.length} errors → +${adjustment}ms (precise)` };
        }

        // Default: conservative exploration (smaller steps)
        const adjustment = +25;
        return { timing: this.currentTiming + adjustment, reasoning: `Explore → +${adjustment}ms (conservative)` };
    }


    /**
     * Get next timing based on last result
     */
    async getNextTiming(lastResult, timingType, opponentLeftTime = null) {
        const beforeTiming = this.currentTiming;
        DEBUG && console.log(`\n🎯 ML AI: Last result = ${lastResult}, Current = ${this.currentTiming}ms`);

        // Reset consecutive failures when switching between attack and defense
        // Prevents defense failures from inflating attack adjustments and vice versa
        if (this.lastTimingType && this.lastTimingType !== timingType) {
            DEBUG && console.log(`   🔄 Mode switch: ${this.lastTimingType} → ${timingType} — resetting failure counters`);
            this.consecutiveFailures = 0;
            this.consecutive3sErrors = 0;
        }
        this.lastTimingType = timingType;

        // 🛡️ DB TRUST DECAY: Gradually reduce recentKickedCount influence each round
        // After 3 rounds of non-KICK results, it becomes 0 and DB trust returns to normal
        if (this.recentKickedCount > 0 && lastResult !== 'KICKED') {
            this.recentKickedCount--;
            DEBUG && console.log(`   🛡️ DB Trust: recentKickedCount decayed ${this.recentKickedCount + 1} → ${this.recentKickedCount}`);
        }

        // Update stats
        this.stats.totalAttempts++;
        if (timingType === 'attack') {
            this.stats.attackAttempts++;
        } else {
            this.stats.defenseAttempts++;
        }

        // 🧠 OPPONENT BOUNDS: Update mathematical bounds FIRST (before any decision making)
        if (lastResult !== 'LEFT_EARLY') {
            // LEFT_EARLY is handled separately with plausibility check
            this.updateOpponentBounds(lastResult, this.currentTiming, opponentLeftTime);
        }

        // ✅ ENHANCED: LEFT_EARLY with zone-aware trap detection + bounds validation
        if (lastResult === 'LEFT_EARLY' && opponentLeftTime) {
            DEBUG && console.log(`\n🔍 LEFT_EARLY detected at ${opponentLeftTime}ms`);

            // 🧠 OPPONENT BOUNDS: Check if this LEFT_EARLY is plausible
            const boundsPlausible = this.isLeftEarlyPlausible(opponentLeftTime);

            if (!boundsPlausible) {
                // LEFT_EARLY is below our floor — suspicious but NOT impossible
                // Opponent MIGHT have made a big move (>50ms) — don't fully ignore
                // Instead: move HALFWAY between current timing and LEFT_EARLY (cautious follow)
                const halfway = Math.round((this.currentTiming + opponentLeftTime) / 2);
                DEBUG && console.log(`   🧠 BOUNDS SUSPICIOUS: LEFT_EARLY ${opponentLeftTime}ms is below floor ${this.opponentFloor}ms`);
                DEBUG && console.log(`   🧠 Opponent may have made large move — cautious follow to halfway: ${halfway}ms`);

                this.currentTiming = halfway;
                this.lastAdjustmentReason = 'LEFT_EARLY_BOUNDS_CAUTIOUS';
                this.consecutiveFailures = 0;
                this.consecutive3sErrors = 0;

                // Reset bounds — our assumptions were wrong, start fresh (clamp to preset)
                this.opponentFloor = Math.max(this.timingFloor, opponentLeftTime - 30);
                this.opponentCeiling = null;
                this.opponentLastKnownAt = null;
                this.opponentBoundsRound = this.stats.totalAttempts;

                // Apply speed preset bounds — do NOT follow LEFT_EARLY below/above our range
                const beforeClampBC = this.currentTiming;
                this.currentTiming = this.clampTiming(this.currentTiming);
                if (beforeClampBC !== this.currentTiming) {
                    DEBUG && console.log(`   🔒 LEFT_EARLY ${beforeClampBC}ms clamped to ${this.currentTiming}ms (speed preset: ${this.speedPreset}, bounds: ${this.timingFloor}-${this.timingCeiling})`);
                }
                if (timingType === 'attack') { this.attackTiming = this.currentTiming; }
                else { this.defenseTiming = this.currentTiming; }

                DEBUG && console.log(`   ✅ TIMING UPDATED: ${beforeTiming}ms → ${this.currentTiming}ms (BOUNDS_CAUTIOUS)`);
                this.oscillatedTiming = null;
                return this.currentTiming;
            }

            // LEFT_EARLY passed bounds check — update bounds with this data
            this.updateOpponentBounds('LEFT_EARLY_VALID', opponentLeftTime);

            // 🎯 NEW: Check zones first
            const currentZone = this.getZone(this.currentTiming);
            const leftEarlyZone = this.getZone(opponentLeftTime);
            const jumpDistance = Math.abs(this.currentTiming - opponentLeftTime);

            DEBUG && console.log(`   📍 Current: ${this.currentTiming}ms (${currentZone} zone)`);
            DEBUG && console.log(`   📍 LEFT_EARLY: ${opponentLeftTime}ms (${leftEarlyZone} zone)`);
            DEBUG && console.log(`   📏 Jump Distance: ${jumpDistance}ms`);

            // 🎯 SAME ZONE + SMALL JUMP = TRUST (skip trap detection)
            if (currentZone === leftEarlyZone && jumpDistance <= 75) {
                DEBUG && console.log(`   ✅ SAME ZONE (${currentZone}) + Small adjustment (${jumpDistance}ms)`);
                DEBUG && console.log(`   ➡️ Trusting LEFT_EARLY (no trap check needed)`);
                this.currentTiming = opponentLeftTime;
                this.lastAdjustmentReason = 'LEFT_EARLY_SAME_ZONE';
                this.consecutiveFailures = 0;
                // Reset 3S_ERROR chase counter
                this.consecutive3sErrors = 0;

                // Apply speed preset bounds — do NOT follow LEFT_EARLY below/above our range
                const beforeClamp = this.currentTiming;
                this.currentTiming = this.clampTiming(this.currentTiming);
                if (beforeClamp !== this.currentTiming) {
                    DEBUG && console.log(`   🔒 LEFT_EARLY ${beforeClamp}ms clamped to ${this.currentTiming}ms (speed preset: ${this.speedPreset}, bounds: ${this.timingFloor}-${this.timingCeiling})`);
                }

                // Update attack/defense timing
                if (timingType === 'attack') {
                    this.attackTiming = this.currentTiming;
                } else {
                    this.defenseTiming = this.currentTiming;
                }

                DEBUG && console.log(`   ✅ TIMING UPDATED: ${beforeTiming}ms → ${this.currentTiming}ms (SAME_ZONE)`);
                // Reset oscillation for LEFT_EARLY - follow opponent's zone, don't oscillate
                this.oscillatedTiming = null;
                return this.currentTiming;
            }

            // 🔍 CROSS-ZONE or LARGE JUMP = Check for trap
            DEBUG && console.log(`   🔍 ${currentZone === leftEarlyZone ? 'LARGE JUMP' : 'CROSS-ZONE'} - Checking for trap...`);

            // Get cached rival data (includes trap metrics)
            const rivalData = this.rivalCache.get(this.currentRivalName);

            if (rivalData && rivalData.leftEarlyCount > 0) {
                const trapScore = rivalData.trapScore;

                DEBUG && console.log(`   📊 Trap Analysis:`);
                DEBUG && console.log(`   Base Trap Score: ${trapScore}/100`);
                DEBUG && console.log(`   LEFT_EARLY StdDev: ${rivalData.leftEarlyStdDev}ms`);
                DEBUG && console.log(`   Historical: ${rivalData.successAfterLeftEarly} success, ${rivalData.kickedAfterLeftEarly} kicked after LEFT_EARLY`);

                // Adjust trap score based on zone and jump distance
                let adjustedTrapScore = trapScore;

                // 🎯 SAME ZONE but LARGE JUMP = Reduce trap score (70% reduction)
                if (currentZone === leftEarlyZone) {
                    adjustedTrapScore = Math.round(trapScore * 0.3);
                    DEBUG && console.log(`   ✅ Same zone bonus: ${trapScore} → ${adjustedTrapScore} (70% reduction)`);
                }

                // Add jump distance penalty
                if (jumpDistance > 100) {
                    adjustedTrapScore += 20;
                    DEBUG && console.log(`   ⚠️ Large jump (+20 trap score) → ${adjustedTrapScore}/100`);
                } else if (jumpDistance > 50) {
                    adjustedTrapScore += 10;
                    DEBUG && console.log(`   ⚠️ Medium jump (+10 trap score) → ${adjustedTrapScore}/100`);
                }

                // Decision based on adjusted trap score
                // Thresholds raised: real LEFT_EARLY signals were being blocked too aggressively
                if (adjustedTrapScore >= 80) {
                    // HIGH RISK - Very likely trap, move cautiously (not ignore completely)
                    // Even "traps" contain useful info — go 30% of the way
                    const partial = Math.round(this.currentTiming * 0.7 + opponentLeftTime * 0.3);
                    DEBUG && console.log(`   🚨 HIGH RISK (${adjustedTrapScore}/100) - Partial follow to ${partial}ms`);
                    this.currentTiming = partial;
                    this.lastAdjustmentReason = 'LEFT_EARLY_HIGH_RISK';

                } else if (adjustedTrapScore >= 50) {
                    // MEDIUM RISK - Move cautiously (halfway)
                    const halfway = Math.round((this.currentTiming + opponentLeftTime) / 2);
                    DEBUG && console.log(`   ⚠️ MEDIUM RISK (${adjustedTrapScore}/100) - Moving cautiously`);
                    DEBUG && console.log(`   🔀 Moving halfway: ${this.currentTiming}ms → ${halfway}ms`);
                    this.currentTiming = halfway;
                    this.lastAdjustmentReason = 'LEFT_EARLY_CAUTIOUS';

                } else {
                    // LOW RISK - Trust LEFT_EARLY
                    DEBUG && console.log(`   ✅ LOW RISK (${adjustedTrapScore}/100) - Trusting LEFT_EARLY`);
                    DEBUG && console.log(`   ➡️ Following to ${opponentLeftTime}ms`);
                    this.currentTiming = opponentLeftTime;
                    this.lastAdjustmentReason = 'LEFT_EARLY';
                }

            } else {
                // No trap data available - use default behavior (trust LEFT_EARLY)
                DEBUG && console.log(`   ℹ️ No trap data available - trusting LEFT_EARLY`);
                this.currentTiming = opponentLeftTime;
                this.lastAdjustmentReason = 'LEFT_EARLY';
            }

            // Reset consecutive failures on LEFT_EARLY
            this.consecutiveFailures = 0;
            // Reset 3S_ERROR chase counter
            this.consecutive3sErrors = 0;

            // Note: Fix B cap removed from LEFT_EARLY — opponent bounds system handles this now
            // The bounds cautious-halfway approach is safer than a hard -50ms cap
            // because opponents CAN make genuine big moves (>50ms)

            // Apply speed preset bounds — do NOT follow LEFT_EARLY below/above our range
            const beforeClampLE = this.currentTiming;
            this.currentTiming = this.clampTiming(this.currentTiming);
            if (beforeClampLE !== this.currentTiming) {
                DEBUG && console.log(`   🔒 LEFT_EARLY ${beforeClampLE}ms clamped to ${this.currentTiming}ms (speed preset: ${this.speedPreset}, bounds: ${this.timingFloor}-${this.timingCeiling})`);
            }

            // Update attack/defense timing
            if (timingType === 'attack') {
                this.attackTiming = this.currentTiming;
            } else {
                this.defenseTiming = this.currentTiming;
            }

            DEBUG && console.log(`   ✅ TIMING UPDATED: ${beforeTiming}ms → ${this.currentTiming}ms (${this.lastAdjustmentReason})`);
            // Reset oscillation for LEFT_EARLY - follow opponent's timing signal, not zone oscillation
            this.oscillatedTiming = null;
            return this.currentTiming;
        }

        // 🔄 SUCCESS: Stay near success position + Preemptive Shift
        if (lastResult === 'SUCCESS') {
            this.stats.successCount++;
            if (timingType === 'attack') {
                this.stats.attackSuccess++;
            } else {
                this.stats.defenseSuccess++;
            }
            this.lastAdjustmentReason = 'SUCCESS';

            // Reset consecutive failures on success
            this.consecutiveFailures = 0;
            // Reset DB trust control — success means ML and DB are aligned
            this.recentKickedCount = 0;
            // Reset 3S_ERROR chase counter
            this.consecutive3sErrors = 0;

            // 🔒 FIX B: Record last known success timing (used by LEFT_EARLY cap)
            this.lastKnownSuccessTiming = this.currentTiming;

            // 🎯 PREEMPTIVE SHIFT: Track consecutive successes in same zone
            const currentZone = this.getZone(this.currentTiming);

            if (this.lastSuccessZone === currentZone) {
                this.consecutiveSuccessCount++;
            } else {
                // Zone changed — reset counter, start tracking new zone
                this.consecutiveSuccessCount = 1;
                this.lastSuccessZone = currentZone;
            }
            this.lastSuccessTiming = this.currentTiming;

            DEBUG && console.log(`   🎯 Consecutive successes in ${currentZone}: ${this.consecutiveSuccessCount}`);

            // 🎯 PREEMPTIVE SHIFT: After 3+ successes in same zone, opponent WILL move
            // Anticipate by shifting toward where opponent would logically escape
            if (this.consecutiveSuccessCount >= 3) {
                // Opponent got kicked 3+ times here — they'll move away
                // Determine shift direction based on where we are in the range
                // If near floor → opponent likely shifts UP, if near ceiling → opponent likely shifts DOWN
                const rangeMid = Math.round((this.timingFloor + this.timingCeiling) / 2);
                const preemptiveShift = this.currentTiming <= rangeMid ? +35 : -35;
                const shiftedTiming = this.currentTiming + preemptiveShift;
                this.currentTiming = this.clampTiming(shiftedTiming); // Clamp to speed preset bounds
                this.oscillatedTiming = null; // Cancel oscillation — preemptive takes priority
                this.consecutiveSuccessCount = 0; // Reset after shift
                this.lastSuccessZone = null;

                DEBUG && console.log(`   🎯 PREEMPTIVE SHIFT: 3+ successes in ${currentZone} → opponent will move!`);
                DEBUG && console.log(`   🎯 Shifting ${preemptiveShift > 0 ? '+' : ''}${preemptiveShift}ms (proposed) → ${this.currentTiming}ms (clamped to ${this.timingFloor}-${this.timingCeiling})`);
                this.lastAdjustmentReason = 'PREEMPTIVE_SHIFT';

            } else {
                // 🎯 FIX A: Stay near success timing instead of jumping to zone medians
                // Oscillate ±20ms around where we just succeeded — stay in winning neighborhood
                // This replaces the old zone oscillation that jumped to fixed medians (1825/1925/2020)
                const successBase = this.currentTiming;
                const oscillationRange = 20;
                const oscillationOffset = this.zoneOscillationToggle ? -oscillationRange : +oscillationRange;
                this.zoneOscillationToggle = !this.zoneOscillationToggle;

                this.oscillatedTiming = this.clampTiming(successBase + oscillationOffset);
                const driftedTiming = this.currentTiming - 5; // Slight drift toward faster (opponent may creep)
                this.currentTiming = this.clampTiming(driftedTiming); // Clamp drift to speed preset bounds

                DEBUG && console.log(`   🎯 SUCCESS NEIGHBORHOOD: base=${successBase}ms, oscillated=${this.oscillatedTiming}ms (±${oscillationRange}ms, clamped to ${this.timingFloor}-${this.timingCeiling})`);
            }

            // Apply bounds on internal timing
            this.currentTiming = this.clampTiming(this.currentTiming);

            // Update attack/defense timing
            if (timingType === 'attack') {
                this.attackTiming = this.currentTiming;
            } else {
                this.defenseTiming = this.currentTiming;
            }

            DEBUG && console.log(`   ✅ TIMING UPDATED: ${beforeTiming}ms → ${this.currentTiming}ms (SUCCESS) | oscillated=${this.oscillatedTiming}ms`);
            return this.currentTiming; // actual fired timing handled by getTimingWithJitter()
        }

        // Update stats based on result
        if (lastResult === '3S_ERROR') {
            this.stats.errorCount++;
            this.lastAdjustmentReason = '3S_ERROR';
            // 🚀 FIX C: Track consecutive 3S_ERRORs for adaptive step size
            this.consecutive3sErrors++;
            // Reset consecutive success — error means success zone is no longer valid
            this.consecutiveSuccessCount = 0;
            this.lastSuccessZone = null;
            this.lastSuccessTiming = null;
        } else if (lastResult === 'KICKED') {
            this.stats.kickedCount++;
            this.lastAdjustmentReason = 'KICKED';
            // 🛡️ DB TRUST: Track that ML just corrected from a KICK
            // This prevents refreshRivalData from dragging us back to stale success zones
            this.recentKickedCount++;
            // Reset consecutive success tracking — the success zone is no longer safe
            this.consecutiveSuccessCount = 0;
            this.lastSuccessZone = null;
            this.lastSuccessTiming = null;
            // Reset 3S_ERROR chase counter — different problem now
            this.consecutive3sErrors = 0;
        } else if (lastResult === 'LEFT_EARLY') {
            this.lastAdjustmentReason = 'LEFT_EARLY';
        }

        // 🔥 CHANGE 2: REFRESH DATABASE MORE OFTEN (every 2 attempts instead of 5)
        // ✅ FIX: Await DB refresh to prevent race condition with ML prediction
        if (this.stats.totalAttempts % 2 === 0 && this.currentRivalName) {
            DEBUG && console.log(`\n🔄 [REFRESH] Attempt ${this.stats.totalAttempts} - Refreshing database data...`);

            try {
                await this.refreshRivalData(this.currentRivalName, timingType);
            } catch (error) {
                console.error(`   ❌ Failed to refresh rival data:`, error);
            }
        }

        // 🔥 USE ML PREDICTION ENGINE (only for KICKED and 3S_ERROR)
        // Estimate opponent zone based on our timing and result
        let estimatedOpponentZone = this.currentTiming;
        if (lastResult === 'KICKED') {
            // 🎯 CRITICAL: Use opponent's EXACT timing if available (from prison message)
            // This is captured from "<RIVAL_NAME> PRISON 0 :Prison for <TIME>" message
            if (opponentLeftTime && opponentLeftTime > 0) {
                estimatedOpponentZone = opponentLeftTime;
                DEBUG && console.log(`   🎯 Using opponent EXACT timing: ${opponentLeftTime}ms (from prison message)`);
            } else {
                // Fallback: Estimate (we were too slow, opponent was faster)
                estimatedOpponentZone = this.currentTiming - 20;
                DEBUG && console.log(`   ⚠️ Estimating opponent timing: ${estimatedOpponentZone}ms (no exact data)`);
            }
        } else if (lastResult === '3S_ERROR') {
            // We were too fast, opponent was slower
            estimatedOpponentZone = this.currentTiming + 20;
        }

        const prediction = this.predictNextTimingML(lastResult, estimatedOpponentZone);
        this.currentTiming = prediction.timing;

        DEBUG && console.log(`   🧠 ML Prediction: ${this.currentTiming}ms (${prediction.reasoning})`);

        // Apply bounds (increased upper bound to 2150ms for slow opponents)
        const beforeBounds = this.currentTiming;
        this.currentTiming = this.clampTiming(this.currentTiming);

        if (beforeBounds !== this.currentTiming) {
            DEBUG && console.log(`   ⚠️  Bounds applied: ${beforeBounds}ms → ${this.currentTiming}ms`);
        }

        // Update attack/defense timing
        if (timingType === 'attack') {
            this.attackTiming = this.currentTiming;
        } else {
            this.defenseTiming = this.currentTiming;
        }

        DEBUG && console.log(`   ✅ TIMING UPDATED: ${beforeTiming}ms → ${this.currentTiming}ms (${lastResult})`);
        // Reset oscillation when ML is steering (KICKED / 3S_ERROR) - let ML converge cleanly
        this.oscillatedTiming = null;
        return this.currentTiming;
    }

    /**
     * Refresh rival data from database (background query every 5 attempts)
     * Uses ZONE-BASED WEIGHTED PRIORITY SYSTEM:
     * 
     * Timing Zones:
     * - SLOW: 1775-1875ms
     * - NORMAL: 1875-1975ms
     * - FAST: 1975-2150ms
     * 
     * Zone Danger Analysis:
     * - Calculates kick density PER ZONE
     * - High-kick zones get HIGHER weight (more vigilant)
     * - Low-kick zones get LOWER weight (more confident)
     * 
     * Base Weights:
     * 1. KICKED (base: 4.0) - Highest priority
     * 2. LEFT_EARLY (base: 3.0) - High priority
     * 3. SUCCESS (base: 2.0) - Medium priority
     * 4. 3S_ERROR (base: 1.0) - Lowest priority
     * 
     * Zone Multiplier (applied to base weights):
     * - High danger zone (>40% kicks): 1.5x weight
     * - Medium danger zone (20-40% kicks): 1.2x weight
     * - Low danger zone (<20% kicks): 0.8x weight (minimum, not zero)
     */
    async refreshRivalData(rivalName, timingType = 'attack') {
        if (!this.supabase || !rivalName) return;

        try {
            DEBUG && console.log(`   🔍 Refreshing data for: ${rivalName} (${timingType})`);

            // 🚀 USE SAME DATABASE FUNCTION (analyzes ALL records, not just 50)
            // ✅ FIX: Pass correct is_defense based on timingType
            const { data, error } = await this.supabase
                .rpc('get_optimal_timing_for_rival', {
                    p_rival_name: rivalName,
                    p_is_defense: timingType === 'defense'
                });

            if (error) {
                console.error(`   ❌ Database function error:`, error);
                return;
            }

            if (!data || data.length === 0 || !data[0].optimal_timing) {
                DEBUG && console.log(`   ℹ️ No new data found`);
                return;
            }

            const result = data[0];
            const dbOptimalTiming = result.optimal_timing;

            DEBUG && console.log(`\n   📊 Database Refresh Results:`);
            DEBUG && console.log(`   🎯 Optimal Timing: ${dbOptimalTiming}ms`);
            DEBUG && console.log(`   📈 Total Records: ${result.record_count}`);
            DEBUG && console.log(`   ✅ SUCCESS: ${result.success_count}`);
            DEBUG && console.log(`   ⚠️ KICKED: ${result.kicked_count}`);
            DEBUG && console.log(`   ⏱️ 3S_ERROR: ${result.error_count}`);
            DEBUG && console.log(`   🏃 LEFT_EARLY: ${result.left_early_count}`);
            DEBUG && console.log(`\n   🗺️ ZONE DANGER ANALYSIS:`);
            DEBUG && console.log(`   SLOW zone: ${result.slow_zone_kicked} KICKED ${result.slow_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.slow_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);
            DEBUG && console.log(`   NORMAL zone: ${result.normal_zone_kicked} KICKED ${result.normal_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.normal_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);
            DEBUG && console.log(`   FAST zone: ${result.fast_zone_kicked} KICKED ${result.fast_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.fast_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);

            // 🔍 NEW: Log trap metrics
            if (result.left_early_count > 0) {
                DEBUG && console.log(`\n   🔍 TRAP DETECTION:`);
                DEBUG && console.log(`   Trap Score: ${result.left_early_trap_score}/100`);
                const riskLevel = result.left_early_trap_score >= 60 ? 'HIGH' :
                    result.left_early_trap_score >= 30 ? 'MEDIUM' : 'LOW';
                DEBUG && console.log(`   Risk Level: ${riskLevel}`);
            }

            // Update cache with trap metrics
            this.rivalCache.set(rivalName, {
                optimalTiming: dbOptimalTiming,
                lastUpdated: Date.now(),
                recordCount: result.record_count,
                successCount: result.success_count,
                kickedCount: result.kicked_count,
                errorCount: result.error_count,
                leftEarlyCount: result.left_early_count,
                slowZoneKicked: result.slow_zone_kicked,
                normalZoneKicked: result.normal_zone_kicked,
                fastZoneKicked: result.fast_zone_kicked,
                // 🔍 NEW: Trap metrics
                trapScore: result.left_early_trap_score || 0,
                leftEarlyAvgTiming: result.left_early_avg_timing || 0,
                leftEarlyStdDev: result.left_early_std_dev || 0,
                successAfterLeftEarly: result.success_after_left_early || 0,
                kickedAfterLeftEarly: result.kicked_after_left_early || 0,
                zoneActivityScore: result.zone_activity_score || 0
            });

            // ✅ FIX: Update zone multipliers so scaleAdjustmentForZone() actually works
            this.updateZoneMultipliers(this.rivalCache.get(rivalName));

            DEBUG && console.log(`   📊 Current timing: ${this.currentTiming}ms`);

            // 🔒 Clamp DB optimal timing to speed preset bounds BEFORE blending
            // Prevents DB from pulling timing toward a zone the user didn't choose
            const clampedDbTiming = this.clampTiming(dbOptimalTiming);
            if (clampedDbTiming !== dbOptimalTiming) {
                DEBUG && console.log(`   🔒 DB timing ${dbOptimalTiming}ms clamped to ${clampedDbTiming}ms (speed preset: ${this.speedPreset}, bounds: ${this.timingFloor}-${this.timingCeiling})`);
            }

            // 🛡️ DB TRUST CONTROL: After recent KICKED, ML has corrected — don't let DB drag us back
            // recentKickedCount > 0 means ML just adjusted from a KICK, trust ML more than DB
            const timingDiff = Math.abs(clampedDbTiming - this.currentTiming);

            if (this.recentKickedCount >= 2) {
                // Multiple recent kicks — ML is actively correcting, DB is stale
                // SKIP DB override entirely, let ML drive
                DEBUG && console.log(`   🛡️ DB TRUST BLOCKED: ${this.recentKickedCount} recent KICKs — ML is correcting, keeping ${this.currentTiming}ms`);
                DEBUG && console.log(`   🛡️ DB suggested: ${dbOptimalTiming}ms (IGNORED — stale success anchor)`);

            } else if (this.recentKickedCount === 1) {
                // Single recent kick — trust ML heavily (80% current, 20% DB — inverted ratio)
                if (timingDiff > 25) {
                    const newTiming = Math.round(this.currentTiming * 0.8 + clampedDbTiming * 0.2);
                    DEBUG && console.log(`   🛡️ DB TRUST REDUCED: 1 recent KICK — ${this.currentTiming}ms * 80% + ${clampedDbTiming}ms * 20% = ${newTiming}ms`);
                    this.currentTiming = newTiming;
                } else {
                    DEBUG && console.log(`   ✅ Small difference (${timingDiff}ms) after KICK - Keeping ML timing`);
                }

            } else {
                // No recent kicks — normal DB trust
                if (timingDiff > 50) {
                    const newTiming = Math.round(this.currentTiming * 0.2 + clampedDbTiming * 0.8);
                    DEBUG && console.log(`   🔄 Large difference (${timingDiff}ms) - Trusting DATABASE: ${newTiming}ms (80% DB)`);
                    this.currentTiming = newTiming;
                } else if (timingDiff > 25) {
                    const newTiming = Math.round(this.currentTiming * 0.3 + clampedDbTiming * 0.7);
                    DEBUG && console.log(`   🔄 Medium difference (${timingDiff}ms) - Trusting DATABASE: ${newTiming}ms (70% DB)`);
                    this.currentTiming = newTiming;
                } else {
                    DEBUG && console.log(`   ✅ Small difference (${timingDiff}ms) - Keeping current timing`);
                }
            }

            // Clamp to speed preset bounds after DB blend
            this.currentTiming = this.clampTiming(this.currentTiming);

        } catch (error) {
            console.error(`   ❌ Error refreshing rival data:`, error);
        }
    }


    /**
     * 🎲 Get timing for actual firing (called from getTiming() in gameLogic.js).
     * This is where jitter + oscillation are ACTUALLY applied to the fire time.
     * 
     * Priority:
     *   1. If oscillatedTiming is set (SUCCESS round) → fire from oscillated zone + jitter
     *   2. Otherwise → fire from currentTiming + jitter
     * 
     * Internal currentTiming is NEVER modified here — ML stays clean.
     * 
     * @param {string} mode - 'attack' or 'defense'
     * @returns {number} - timing with jitter applied
     */
    getTimingWithJitter(mode) {
        // Use mode-specific timing, falling back to currentTiming
        const modeTiming = mode === 'defense' ? this.defenseTiming : this.attackTiming;
        const base = this.oscillatedTiming || modeTiming || this.currentTiming;
        if (!base) return this.currentTiming;
        const fired = this.applyJitter(base);
        DEBUG && console.log(`   🎲 [${mode.toUpperCase()}] getTimingWithJitter: base=${base}ms (${this.oscillatedTiming ? 'oscillated' : mode}) → fired=${fired}ms`);
        return fired;
    }

    /**
     * 🔄 Determine zone oscillation pair based on rival's historical zone data.
     * Uses zone kick counts already loaded from SQL (no new DB call needed).
     *
     * IMPORTANT: Oscillation pair is calculated dynamically based on current speed preset bounds!
     * Not hardcoded to 1825/1925/2020 — respects user's SLOW/NORMAL/FAST selection.
     *
     * Rules:
     *   FAST opponent  → oscillate FAST ↔ NORMAL
     *   NORMAL opponent → oscillate NORMAL ↔ SLOW
     *   SLOW opponent  → oscillate SLOW ↔ NORMAL
     *
     * @param {Object} rivalData - cached rival data from rivalCache
     * @returns {{ primary: number, secondary: number } | null}
     */
    getOscillationPair(rivalData) {
        if (!rivalData) return null;

        const fast = rivalData.fastZoneKicked || 0;
        const normal = rivalData.normalZoneKicked || 0;
        const slow = rivalData.slowZoneKicked || 0;

        // Need at least 1 kick recorded to know opponent's zone
        if (fast === 0 && normal === 0 && slow === 0) return null;

        // Calculate zone medians within current speed preset bounds
        const slowMid = Math.round((1775 + 1875) / 2);      // 1825 (SLOW zone midpoint)
        const normalMid = Math.round((1875 + 1975) / 2);    // 1925 (NORMAL zone midpoint)
        const fastMid = Math.round((1975 + 2150) / 2);      // 2062 (FAST zone midpoint)

        // Clamp all zone medians to current speed preset bounds
        const slowMidClamped = this.clampTiming(slowMid);
        const normalMidClamped = this.clampTiming(normalMid);
        const fastMidClamped = this.clampTiming(fastMid);

        // Determine dominant zone (most kicks) and build oscillation pair
        if (fast >= normal && fast >= slow) {
            // Opponent mainly in FAST zone → oscillate FAST ↔ NORMAL
            return { primary: fastMidClamped, secondary: normalMidClamped, label: 'FAST↔NORMAL' };
        } else if (normal >= fast && normal >= slow) {
            // Opponent mainly in NORMAL zone → oscillate NORMAL ↔ SLOW
            return { primary: normalMidClamped, secondary: slowMidClamped, label: 'NORMAL↔SLOW' };
        } else {
            // Opponent mainly in SLOW zone → oscillate SLOW ↔ NORMAL
            return { primary: slowMidClamped, secondary: normalMidClamped, label: 'SLOW↔NORMAL' };
        }
    }

    /**
     * 🔄 Apply zone oscillation — flips between primary and secondary zone each SUCCESS round.
     * this.currentTiming (internal) is NOT changed — only the fired value alternates.
     *
     * IMPORTANT: Result is clamped to speed preset bounds (redundant but safe).
     *
     * @param {Object} rivalData - cached rival data from rivalCache
     * @returns {number|null} - oscillated timing clamped to preset, or null if no data
     */
    applyZoneOscillation(rivalData) {
        const pair = this.getOscillationPair(rivalData);
        if (!pair) return null;

        // Flip toggle each SUCCESS round
        this.zoneOscillationToggle = !this.zoneOscillationToggle;

        const target = this.zoneOscillationToggle ? pair.primary : pair.secondary;
        const clamped = this.clampTiming(target);
        DEBUG && console.log(`   🔄 OSCILLATION PAIR: ${pair.label} → ${this.zoneOscillationToggle ? 'PRIMARY' : 'SECONDARY'} (${target}ms → ${clamped}ms clamped)`);
        return clamped;
    }

    /**
     * Apply random jitter to the fired timing value.
     * IMPORTANT: this.currentTiming is NOT modified — internal learning stays clean.
     * Only the value that gets sent to ACTION 3 has noise.
     * 
     * @param {number} timing - The clean calculated timing (this.currentTiming)
     * @param {number} range  - Max jitter in ms (default ±15ms)
     * @returns {number} - timing + random noise, clamped to speed preset bounds
     */
    applyJitter(timing, range = 15) {
        const noise = Math.round((Math.random() * range * 2) - range); // -15 to +15
        const jittered = timing + noise;
        // Clamp within speed preset bounds after noise
        return this.clampTiming(jittered);
    }

    /**
     * Get adjustment reason (for database logging)
     */
    getAdjustmentReason() {
        return this.lastAdjustmentReason;
    }

    /**
     * Get stats (for UI display)
     */
    getStats() {
        const successRate = this.stats.totalAttempts > 0
            ? Math.round((this.stats.successCount / this.stats.totalAttempts) * 100)
            : 0;

        const attackSuccessRate = this.stats.attackAttempts > 0
            ? Math.round((this.stats.attackSuccess / this.stats.attackAttempts) * 100)
            : 0;

        const defenseSuccessRate = this.stats.defenseAttempts > 0
            ? Math.round((this.stats.defenseSuccess / this.stats.defenseAttempts) * 100)
            : 0;

        return {
            currentZone: 'NORMAL',
            explorationPhase: false,
            explorationAttempts: 0,
            successRate,
            attackSuccessRate,
            defenseSuccessRate,
            totalAttempts: this.stats.totalAttempts,
            successCount: this.stats.successCount,
            kickedCount: this.stats.kickedCount,
            errorCount: this.stats.errorCount
        };
    }

    /**
     * Track opponent leaving (LEFT_EARLY events)
     */
    trackOpponentLeaving(opponentLeftTime, resultType) {
        if (opponentLeftTime && opponentLeftTime > 0) {
            this.opponentIntelligence.opponentLeavingTimes.push({
                time: opponentLeftTime,
                timestamp: Date.now(),
                result: resultType
            });

            // Keep only last 10 events
            if (this.opponentIntelligence.opponentLeavingTimes.length > 10) {
                this.opponentIntelligence.opponentLeavingTimes.shift();
            }

            DEBUG && console.log(`📊 Tracked LEFT_EARLY: ${opponentLeftTime}ms (${resultType})`);
        }
    }

    /**
     * Record rival attack (when we get kicked)
     */
    recordRivalAttack(timing) {
        DEBUG && console.log(`🛡️ Recorded rival attack at ${timing}ms`);
        // Simple mode: just log it
    }

    /**
     * Detect context (ping measurement)
     */
    async detectContext(ws, force = false) {
        // Simple mode: stub this method
        DEBUG && console.log(`🔍 Context detection (stub)`);
        return 'NORMAL';
    }

    /**
     * Set rival name (alias for setCurrentRival)
     */
    async setRivalName(rivalName) {
        return await this.setCurrentRival(rivalName);
    }

    /**
     * Store rival data in database
     */
    async storeRivalData(rivalName, timing, result, ping) {
        if (!this.supabase || !rivalName) return;

        try {
            DEBUG && console.log(`💾 Storing data: ${rivalName} at ${timing}ms (${result})`);

            // Store in database (handled by gameLogic.js calling record_imprisonment_metric)
            // Just update cache here
            if (!this.rivalCache.has(rivalName)) {
                this.rivalCache.set(rivalName, {
                    optimalTiming: timing,
                    lastUpdated: Date.now(),
                    recordCount: 1
                });
            } else {
                const cached = this.rivalCache.get(rivalName);
                cached.recordCount++;
                cached.lastUpdated = Date.now();
                // Update optimal timing (proper weighted average — new value gets 1/N influence)
                cached.optimalTiming = Math.round(
                    (cached.optimalTiming * (cached.recordCount - 1) + timing) / cached.recordCount
                );
            }

        } catch (error) {
            console.error(`❌ Error storing rival data:`, error);
        }
    }

    /**
     * Retrieve rival data from database
     */
    async getRivalData(rivalName, timingType = 'attack') {
        if (!this.supabase || !rivalName) return null;

        try {
            // Check cache first
            if (this.rivalCache.has(rivalName)) {
                const cached = this.rivalCache.get(rivalName);
                const age = Date.now() - cached.lastUpdated;

                // Use cache if less than 5 minutes old
                if (age < 5 * 60 * 1000) {
                    DEBUG && console.log(`📦 Using cached data for ${rivalName}: ${cached.optimalTiming}ms`);
                    return cached;
                }
            }

            // 🚀 NEW: Use database function for fast server-side calculation
            // ✅ FIX: Pass correct is_defense based on timingType
            DEBUG && console.log(`🔍 Querying database function for rival: ${rivalName} (${timingType})`);

            const { data, error } = await this.supabase
                .rpc('get_optimal_timing_for_rival', {
                    p_rival_name: rivalName,
                    p_is_defense: timingType === 'defense'
                });

            if (error) {
                console.error(`❌ Database function error:`, error);
                return null;
            }

            if (!data || data.length === 0 || !data[0].optimal_timing) {
                DEBUG && console.log(`   ℹ️ No data found for ${rivalName}`);
                return null;
            }

            const result = data[0];
            DEBUG && console.log(`\n   📊 Database Function Results:`);
            DEBUG && console.log(`   🎯 Optimal Timing: ${result.optimal_timing}ms`);
            DEBUG && console.log(`   📈 Total Records: ${result.record_count}`);
            DEBUG && console.log(`   ✅ SUCCESS: ${result.success_count}`);
            DEBUG && console.log(`   ⚠️ KICKED: ${result.kicked_count}`);
            DEBUG && console.log(`   ⏱️ 3S_ERROR: ${result.error_count}`);
            DEBUG && console.log(`   🏃 LEFT_EARLY: ${result.left_early_count}`);
            DEBUG && console.log(`\n   🗺️ ZONE DANGER ANALYSIS:`);
            DEBUG && console.log(`   SLOW zone: ${result.slow_zone_kicked} KICKED ${result.slow_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.slow_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);
            DEBUG && console.log(`   NORMAL zone: ${result.normal_zone_kicked} KICKED ${result.normal_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.normal_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);
            DEBUG && console.log(`   FAST zone: ${result.fast_zone_kicked} KICKED ${result.fast_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.fast_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);

            // 🔍 NEW: Log trap detection metrics
            if (result.left_early_count > 0) {
                DEBUG && console.log(`\n   🔍 LEFT_EARLY TRAP ANALYSIS:`);
                DEBUG && console.log(`   Trap Score: ${result.left_early_trap_score}/100`);
                DEBUG && console.log(`   Avg LEFT_EARLY: ${result.left_early_avg_timing}ms`);
                DEBUG && console.log(`   Consistency: ${result.left_early_std_dev}ms stdDev`);
                DEBUG && console.log(`   After LEFT_EARLY: ${result.success_after_left_early} SUCCESS, ${result.kicked_after_left_early} KICKED`);
                DEBUG && console.log(`   Zone Activity: ${result.zone_activity_score} records`);

                const riskLevel = result.left_early_trap_score >= 60 ? 'HIGH RISK 🚨' :
                    result.left_early_trap_score >= 30 ? 'MEDIUM RISK ⚠️' :
                        'LOW RISK ✅';
                DEBUG && console.log(`   Risk Level: ${riskLevel}`);
            }

            const rivalData = {
                optimalTiming: result.optimal_timing,
                lastUpdated: Date.now(),
                recordCount: result.record_count,
                successCount: result.success_count,
                kickedCount: result.kicked_count,
                errorCount: result.error_count,
                leftEarlyCount: result.left_early_count,
                slowZoneKicked: result.slow_zone_kicked,
                normalZoneKicked: result.normal_zone_kicked,
                fastZoneKicked: result.fast_zone_kicked,
                // 🔍 NEW: Trap detection metrics
                trapScore: result.left_early_trap_score || 0,
                leftEarlyAvgTiming: result.left_early_avg_timing || 0,
                leftEarlyStdDev: result.left_early_std_dev || 0,
                successAfterLeftEarly: result.success_after_left_early || 0,
                kickedAfterLeftEarly: result.kicked_after_left_early || 0,
                zoneActivityScore: result.zone_activity_score || 0
            };

            // Update cache
            this.rivalCache.set(rivalName, rivalData);

            // ✅ FIX: Update zone multipliers so scaleAdjustmentForZone() actually works
            this.updateZoneMultipliers(rivalData);

            return rivalData;

        } catch (error) {
            console.error(`❌ Error retrieving rival data:`, error);
            return null;
        }
    }

    /**
     * Set current rival (called when targeting a player)
     */
    async setCurrentRival(rivalName) {
        this.currentRivalName = rivalName;
        DEBUG && console.log(`🎯 Current rival set to: ${rivalName}`);

        // Ensure initial timing is set from ping
        if (!this.initialTimingSet) {
            await this.initializeTimingFromPing();
        }

        // Reset ML history for new rival
        this.mlHistory = [];
        this.opponentZoneHistory = [];
        this.consecutiveFailures = 0;
        this.lastTimingType = null;
        // Reset preemptive shift and DB trust tracking for new rival
        this.consecutiveSuccessCount = 0;
        this.lastSuccessZone = null;
        this.lastSuccessTiming = null;
        this.recentKickedCount = 0;
        // Reset Fix B + C state for new rival
        this.lastKnownSuccessTiming = null;
        this.consecutive3sErrors = 0;
        // Reset opponent bounds for new rival
        this.opponentFloor = null;
        this.opponentCeiling = null;
        this.opponentLastKnownAt = null;
        this.opponentBoundsRound = 0;

        // 🔥 CHANGE 1: LOAD DATABASE DATA FIRST (blocking call)
        DEBUG && console.log(`   🔍 Loading database knowledge for ${rivalName}...`);
        const rivalData = await this.getRivalData(rivalName);

        if (rivalData && rivalData.optimalTiming && rivalData.recordCount > 0) {
            // 🔥 USE DATABASE TIMING as starting point (override ping-based timing)
            // Clamp to speed preset bounds
            this.currentTiming = this.clampTiming(rivalData.optimalTiming);
            this.attackTiming = this.currentTiming;
            this.defenseTiming = this.currentTiming;

            DEBUG && console.log(`   ✅ Starting with DATABASE timing: ${this.currentTiming}ms (based on ${rivalData.recordCount} records, bounds: ${this.timingFloor}-${this.timingCeiling})`);
            DEBUG && console.log(`   📊 Stats: SUCCESS=${rivalData.successCount}, KICKED=${rivalData.kickedCount}, ERROR=${rivalData.errorCount}, LEFT_EARLY=${rivalData.leftEarlyCount}`);
        } else {
            // No rival data - use median of speed preset bounds or safe default
            const median = Math.round((this.timingFloor + this.timingCeiling) / 2);
            if (this.currentTiming === null || this.currentTiming < this.timingFloor || this.currentTiming > this.timingCeiling) {
                this.currentTiming = median;
                DEBUG && console.log(`   ℹ️ No database data - using preset median: ${this.currentTiming}ms`);
            } else {
                DEBUG && console.log(`   ℹ️ No database data - keeping current timing: ${this.currentTiming}ms`);
            }
        }
    }

    /**
     * Reset state (called on disconnect/reconnect)
     */
    async resetState() {
        DEBUG && console.log(`🔄 ML AI: Resetting state`);

        // Reset to ping-based timing (will be re-initialized if needed)
        this.initialTimingSet = false;
        this.currentTiming = null;
        this.attackTiming = null;
        this.defenseTiming = null;
        this.currentRivalName = null;

        // Reset ML history
        this.mlHistory = [];
        this.opponentZoneHistory = [];
        this.consecutiveFailures = 0;
        this.lastTimingType = null;
        // Reset preemptive shift and DB trust tracking
        this.consecutiveSuccessCount = 0;
        this.lastSuccessZone = null;
        this.lastSuccessTiming = null;
        this.recentKickedCount = 0;
        // Reset Fix B + C state
        this.lastKnownSuccessTiming = null;
        this.consecutive3sErrors = 0;
        // Reset opponent bounds
        this.opponentFloor = null;
        this.opponentCeiling = null;
        this.opponentLastKnownAt = null;
        this.opponentBoundsRound = 0;

        // Re-initialize timing from ping (await to prevent null timing race condition)
        await this.initializeTimingFromPing();

        // Keep cache - don't clear it
    }

    /**
     * Get current ping (placeholder)
     */
    getCurrentPing() {
        return 100; // Default ping
    }
}

module.exports = SimpleAICore;
