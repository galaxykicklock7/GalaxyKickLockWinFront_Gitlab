/**
 * Simple AI Core - Minimal rival data storage and retrieval
 * No ML, no complex strategies - just database operations
 * Drop-in replacement for SmartMLAgent
 */
const DEBUG = process.env.DEBUG === 'true';
const fileLogger = require('../utils/fileLogger');

class SimpleAICore {
    constructor(supabase, userId, wsNumber, connectionNumber) {
        this.supabase = supabase;
        this.userId = userId;
        this.wsNumber = wsNumber;
        this.connectionNumber = connectionNumber;

        // Current rival and shared state
        this.currentRivalName = null;
        this.initialTimingSet = false; // Flag to track if initial timing was set

        // Context-based timing-memory
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

        // Track mode to detect mode switches for logging
        this.lastTimingType = null;

        // ðŸŽ¯ PATTERN DETECTION: Track opponent timing patterns
        this.opponentHistory = [];        // Store opponent escape/kick timings
        this.opponentPattern = null;       // Current detected pattern

        // ðŸ§  PER-MODE STATE: All ML state is split between attack and defense modes.
        // This prevents attack-mode timing climbs (chasing 3S_ERROR) from corrupting
        // defense timing and vice versa.
        this.modeState = {
            attack: this._createModeState(),
            defense: this._createModeState(),
        };
        this.activeMode = 'attack';
        // Convenience pointer â€" updated by _setActiveMode() at start of each getNextTiming() call
        this.ms = this.modeState.attack;

        // ðŸ§  PER-RIVAL STATE CACHE: When switching rivals mid-session, save current ML state
        // so it can be restored when returning to the same rival later.
        // Key = rivalName, Value = snapshot of all ML state fields
        this.rivalStateCache = new Map();

        // ðŸŽ¯ SPEED PRESET BOUNDS: When user selects SLOW/NORMAL/FAST, timing is clamped to that range
        // Default: full range 1675-2150 (no preset selected)
        this.speedPreset = '';              // '', 'SLOW', 'NORMAL', 'FAST'
        this.timingFloor = 1675;            // absolute minimum timing
        this.timingCeiling = 2150;          // absolute maximum timing

        DEBUG && console.log(`âœ… Simple AI Core initialized with ML prediction for user ${userId}, connection ${connectionNumber}`);

        // Note: Timing will be initialized on first getOptimalTiming() call
    }

    /**
     * Create a fresh per-mode ML state object.
     * Called for both attack and defense modes independently.
     *
     * BOUNDARY ML: Simple binary search state.
     * - bFloor: lowest known "too early" point (from 3S_ERROR / LEFT_EARLY)
     * - bCeiling: highest known "rival is below here" point (from SUCCESS / KICKED)
     * - Every result updates one edge. Next timing = median(bFloor, bCeiling).
     */
    _createModeState(initialTiming = null) {
        return {
            currentTiming: initialTiming,
            // Boundary ML state
            bFloor: null,       // 3S_ERROR or LEFT_EARLY sets this (we were too early)
            bCeiling: null,     // SUCCESS or KICKED sets this (rival is at or below here)
            // LEFT_EARLY recovery: track 2x consecutive 3S_ERROR after LEFT_EARLY
            consecutive3sError: 0,
            inLeftEarlyRecovery: false,
            leftEarlyCeiling: null, // preserved ceiling from LEFT_EARLY for 2x trigger
            // LEFT_EARLY low floor protection: 2x consecutive low LEFT_EARLY to reset floor
            consecutiveLowLeftEarly: 0,
            pendingLowFloor: null,
            // DB trust control
            recentKickedCount: 0,
            // Legacy compat (used by getTimingWithJitter)
            oscillatedTiming: null,
            // ADAPTIVE RIVAL DETECTION: track result history for flip-flop detection
            resultHistory: [],       // last 8 results: 'S','K','E','L'
            adaptiveDetected: false,  // true when rival is adapting to us
            // CONSECUTIVE KICKED: 3+ KICKED in a row → floor is trapping us, reset it
            consecutiveKicked: 0,
            // ADAPTIVE: consecutive SUCCESS streak counter (for reversal anticipation)
            consecutiveSuccess: 0,
            // ERRATIC: boundary wipe flag — after big jump, use aggressive re-convergence
            boundaryWiped: false,
            // ERRATIC: last known rival position (from LEFT_EARLY opponentLeftTime)
            lastRivalPosition: null,
        };
    }

    /**
     * Switch the active mode pointer to attack or defense.
     * Must be called at the start of getNextTiming() before any ms.* access.
     */
    _setActiveMode(timingType) {
        const mode = timingType === 'defense' ? 'defense' : 'attack';
        this.activeMode = mode;
        this.ms = this.modeState[mode];
    }

    // --- Per-mode timing getters/setters ---
    get attackTiming() { return this.modeState.attack.currentTiming; }
    set attackTiming(v) { this.modeState.attack.currentTiming = v; }
    get defenseTiming() { return this.modeState.defense.currentTiming; }
    set defenseTiming(v) { this.modeState.defense.currentTiming = v; }
    // currentTiming always reads/writes the ACTIVE mode's timing
    get currentTiming() { return this.ms.currentTiming; }
    set currentTiming(v) { this.ms.currentTiming = v; }

    /**
     * ðŸŽ¯ Set speed preset from frontend config
     * Updates timing bounds and re-initializes timing to the preset's median
     * SLOW: 1675-1875 (median 1775), NORMAL: 1875-1975 (median 1925), FAST: 1975-2150 (median 2062)
     *
     * IMPORTANT: When preset changes, zone multipliers are reset to neutral (1.0) because
     * the historical kick data (slowZoneKicked, etc.) is now in a different context.
     */
    setSpeedPreset(preset) {
        const oldPreset = this.speedPreset;
        this.speedPreset = preset || '';

        // Â±25ms overlap between zone boundaries so rivals sitting at boundary edges
        // (e.g. macuxi ~1937ms at SLOW/NORMAL, lucas ~1980ms at NORMAL/FAST)
        // fall clearly inside a zone instead of causing oscillation between zones.
        // SLOW ceiling extends 25ms into NORMAL, NORMAL extends 25ms into both neighbors,
        // FAST floor extends 25ms into NORMAL. Absolute floor (1675) and ceiling (2150) unchanged.
        // Preset controls FLOOR only. Ceiling always 2150.
        // SLOW can reach normal + fast zone. NORMAL can reach fast zone. FAST = fast only.
        // This lets boundary ML adapt upward to wherever the rival actually plays.
        if (this.speedPreset === 'SLOW') {
            this.timingFloor = 1675;
        } else if (this.speedPreset === 'NORMAL') {
            this.timingFloor = 1850;
        } else if (this.speedPreset === 'FAST') {
            this.timingFloor = 1950;
        } else {
            // No preset â€" full range
            this.timingFloor = 1675;
        }
        this.timingCeiling = 2150; // always absolute max â€" ML adapts to rival

        DEBUG && console.log(`ðŸŽ¯ Speed preset: ${oldPreset || 'NONE'} â†' ${this.speedPreset || 'NONE'} (floor: ${this.timingFloor}ms, ceiling: ${this.timingCeiling}ms)`);

        // Reset zone multipliers and ML history on preset change
        // Old boundary state is relative to different timing ranges.
        // IMPORTANT: Only reset when changing presets, not on first-time set.
        const isFirstTimeSet = oldPreset === '' && this.stats.totalAttempts === 0;
        if (oldPreset !== this.speedPreset && !isFirstTimeSet) {
            // Reset boundary state for both modes â€" old boundaries are in a different range
            for (const mode of ['attack', 'defense']) {
                const ms = this.modeState[mode];
                ms.bFloor = null;
                ms.bCeiling = null;
            }
            DEBUG && console.log(`   ðŸ"„ Preset change: reset boundary state (both modes)`);
        }

        // Re-clamp current timing to new bounds for both modes
        if (this.modeState.attack.currentTiming !== null) {
            const before = this.modeState.attack.currentTiming;
            this.modeState.attack.currentTiming = this.clampTiming(this.modeState.attack.currentTiming);
            if (before !== this.modeState.attack.currentTiming) {
                DEBUG && console.log(`   âš ï¸ Attack timing re-clamped: ${before}ms â†' ${this.modeState.attack.currentTiming}ms`);
            }
        }
        if (this.modeState.defense.currentTiming !== null) {
            const before = this.modeState.defense.currentTiming;
            this.modeState.defense.currentTiming = this.clampTiming(this.modeState.defense.currentTiming);
            if (before !== this.modeState.defense.currentTiming) {
                DEBUG && console.log(`   âš ï¸ Defense timing re-clamped: ${before}ms â†' ${this.modeState.defense.currentTiming}ms`);
            }
        }
    }

    /**
     * ðŸ"' Clamp timing to current speed preset bounds
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

        // ðŸŽ¯ If speed preset is set, use its median instead of ping-based timing
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
            DEBUG && console.log(`ðŸŽ¯ Speed preset ${this.speedPreset} â†' Starting at ${initialTiming}ms (bounds: ${this.timingFloor}-${this.timingCeiling}ms)`);
            this.modeState.attack.currentTiming = initialTiming;
            this.modeState.defense.currentTiming = initialTiming;
            this.initialTimingSet = true;
            return;
        }

        // If no Supabase client, use default timing
        if (!this.supabase) {
            DEBUG && console.log(`âš ï¸ No Supabase client, using default timing`);
            this.setDefaultTiming();
            return;
        }

        try {
            DEBUG && console.log(`ðŸ" Initializing timing from database ping...`);

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
                console.error(`   âŒ Database query error:`, error);
                this.setDefaultTiming();
                return;
            }

            if (!data || data.length === 0) {
                DEBUG && console.log(`   â„¹ï¸ No ping data found, using default`);
                this.setDefaultTiming();
                return;
            }

            // Calculate average ping from recent records
            const avgPing = Math.round(data.reduce((sum, r) => sum + r.ping_ms, 0) / data.length);
            DEBUG && console.log(`   ðŸ"Š Average bot ping: ${avgPing}ms (from ${data.length} records)`);

            // Determine timing range based on ping
            let initialTiming;
            if (avgPing < 50) {
                initialTiming = 1825;
                DEBUG && console.log(`   ðŸ¢ SLOW ping detected (${avgPing}ms) -> Starting at ${initialTiming}ms`);
            } else if (avgPing <= 100) {
                initialTiming = 1925;
                DEBUG && console.log(`   âš¡ NORMAL ping detected (${avgPing}ms) -> Starting at ${initialTiming}ms`);
            } else {
                initialTiming = 2062;
                DEBUG && console.log(`   ðŸš€ FAST ping detected (${avgPing}ms) -> Starting at ${initialTiming}ms`);
            }

            const clampedInitial = this.clampTiming(initialTiming);
            this.modeState.attack.currentTiming = clampedInitial;
            this.modeState.defense.currentTiming = clampedInitial;
            this.initialTimingSet = true;

        } catch (error) {
            console.error(`   âŒ Error initializing timing:`, error);
            this.setDefaultTiming();
        }
    }

    /**
     * Set default timing (fallback when no ping data available)
     */
    setDefaultTiming() {
        // Use median of current speed preset bounds
        const median = Math.round((this.timingFloor + this.timingCeiling) / 2);
        this.modeState.attack.currentTiming = median;
        this.modeState.defense.currentTiming = median;
        this.initialTimingSet = true;
        DEBUG && console.log(`   âš™ï¸ Using default timing: ${median}ms`);
    }

    /**
     * Get current timing (called when AI is enabled)
     */
    async getOptimalTiming(timingType) {
        this._setActiveMode(timingType);

        // Ensure timing is initialized
        if (!this.initialTimingSet) {
            await this.initializeTimingFromPing();
        }

        // Fallback: If still null, use safe default (median of current bounds)
        if (!this.ms.currentTiming) {
            const median = Math.round((this.timingFloor + this.timingCeiling) / 2);
            DEBUG && console.log(`âš ï¸ Timing not initialized, using safe default: ${median}ms`);
            this.ms.currentTiming = median;
            this.initialTimingSet = true;
        }

        DEBUG && console.log(`ðŸ§  Simple AI: Current ${timingType} timing ${this.ms.currentTiming}ms`);
        return this.ms.currentTiming;
    }

    /**
     * ðŸ§  BOUNDARY ML: Get the median of current boundary (binary search next timing)
     *
     * When one edge is unknown, use absolute floor/ceiling as default.
     * Every result narrows the boundary. Next timing = always median.
     */
    getBoundaryMedian() {
        const lo = this.ms.bFloor !== null ? this.ms.bFloor : this.timingFloor;
        const hi = this.ms.bCeiling !== null ? this.ms.bCeiling : this.timingCeiling;
        return this.clampTiming(Math.round((lo + hi) / 2));
    }

    /**
     * ðŸŽ¯ PATTERN DETECTION: Detect opponent's timing pattern from LEFT_EARLY/KICKED data
     * Analyzes opponent history to predict their next escape/kick timing
     */
    detectOpponentPattern() {
        // Need at least 4 data points for reliable pattern
        if (this.opponentHistory.length < 4) {
            return { type: 'INSUFFICIENT_DATA', confidence: 0, predictedTiming: null };
        }

        const timings = this.opponentHistory.map(h => h.timing);
        const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
        
        // Calculate standard deviation
        const variance = timings.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / timings.length;
        const stdDev = Math.sqrt(variance);

        // Pattern 1: STATIC (consistent timing, stdDev < 30ms)
        if (stdDev < 30) {
            return {
                type: 'STATIC',
                predictedTiming: avg,
                confidence: Math.min(0.85, 0.5 + (30 - stdDev) / 60),
                stdDev,
                description: 'Static ~' + Math.round(avg) + 'ms (+/-' + Math.round(stdDev) + 'ms)'
            };
        }

        // Pattern 2: Find clusters (timings within 60ms of each other)
        const clusters = this._findClusters(timings, 60);
        
        if (clusters.length === 2) {
            const isAlternating = this._checkAlternating(timings, clusters);
            if (isAlternating) {
                const nextTiming = this._predictNextAlternation(timings, clusters);
                return {
                    type: 'OSCILLATING',
                    predictedTiming: nextTiming,
                    confidence: 0.65,
                    clusters,
                    description: 'Oscillating ' + clusters.join('ms <-> ') + 'ms'
                };
            }
        }

        // Pattern 3: DRIFTING (linear trend > 10ms per round)
        const drift = this._calculateDrift(timings);
        if (Math.abs(drift) > 10) {
            const lastTiming = timings[timings.length - 1];
            return {
                type: 'DRIFTING',
                predictedTiming: lastTiming + drift,
                confidence: Math.min(0.75, 0.5 + Math.abs(drift) / 50),
                driftRate: drift,
                description: 'Drifting ' + (drift > 0 ? '+' : '') + Math.round(drift) + 'ms/round'
            };
        }

        // Pattern 4: RANDOM (high variance, no clear pattern)
        return {
            type: 'RANDOM',
            predictedTiming: avg,
            confidence: 0.3,
            stdDev,
            description: 'Random (+/-' + Math.round(stdDev) + 'ms)'
        };
    }

    /**
     * ðŸŽ¯ Helper: Find clusters in timing data
     */
    _findClusters(timings, threshold) {
        const sorted = [...timings].sort((a, b) => a - b);
        const clusters = [];
        let currentCluster = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] - sorted[i-1] < threshold) {
                currentCluster.push(sorted[i]);
            } else {
                const clusterAvg = Math.round(currentCluster.reduce((a,b)=>a+b,0) / currentCluster.length);
                clusters.push(clusterAvg);
                currentCluster = [sorted[i]];
            }
        }
        const lastClusterAvg = Math.round(currentCluster.reduce((a,b)=>a+b,0) / currentCluster.length);
        clusters.push(lastClusterAvg);
        return clusters;
    }

    /**
     * ðŸŽ¯ Helper: Check if timings alternate between clusters
     */
    _checkAlternating(timings, clusters) {
        let lastClusterIdx = -1;
        let alternations = 0;

        for (const t of timings) {
            const clusterIdx = clusters.findIndex(c => Math.abs(t - c) < 60);
            if (clusterIdx !== lastClusterIdx) {
                alternations++;
                lastClusterIdx = clusterIdx;
            }
        }

        return alternations >= timings.length * 0.5;
    }

    /**
     * ðŸŽ¯ Helper: Predict next timing in alternation
     */
    _predictNextAlternation(timings, clusters) {
        const lastTiming = timings[timings.length - 1];
        let lastClusterIdx = clusters.findIndex(c => Math.abs(lastTiming - c) < 60);
        const nextClusterIdx = (lastClusterIdx + 1) % clusters.length;
        return clusters[nextClusterIdx];
    }

    /**
     * ðŸŽ¯ Helper: Calculate drift rate using linear regression
     */
    _calculateDrift(timings) {
        const n = timings.length;
        const xMean = (n - 1) / 2;
        const yMean = timings.reduce((a, b) => a + b, 0) / n;
        
        let numerator = 0, denominator = 0;
        for (let i = 0; i < n; i++) {
            numerator += (i - xMean) * (timings[i] - yMean);
            denominator += Math.pow(i - xMean, 2);
        }
        
        return denominator === 0 ? 0 : numerator / denominator;
    }

    /**
     * PATTERN DETECTION: Get predicted fire timing based on pattern
     * Returns timing to fire (2-5ms before predicted opponent timing)
     * Small offset because we want to be JUST before rival, not far before (3S_ERROR risk)
     */
    _getPredictedTiming() {
        if (!this.opponentPattern || this.opponentPattern.confidence < 0.5) {
            return null;
        }

        const { predictedTiming, type } = this.opponentPattern;
        if (predictedTiming === null) return null;

        // Fire 2-5ms before predicted opponent timing
        // Small offset — we want to be just before rival, not risk 3S_ERROR
        const offset = type === 'OSCILLATING' ? 3 : 2;
        let predictedFire = Math.round(predictedTiming - offset);

        // Clamp to valid range
        return this.clampTiming(predictedFire);
    }

    /**
     * PATTERN DETECTION: Check if a LEFT_EARLY timing looks like a trap
     * Trap = opponent suddenly fires far from their established pattern
     * Returns true if this LEFT_EARLY should be ignored (trap detected)
     */
    _isTrap(opponentLeftTime) {
        if (!this.opponentPattern) return false;
        if (this.opponentPattern.confidence < 0.6) return false;
        if (this.opponentPattern.type === 'RANDOM') return false;

        const predicted = this.opponentPattern.predictedTiming;
        if (predicted === null) return false;

        // If opponent timing is >80ms away from predicted → likely a trap
        const distance = Math.abs(opponentLeftTime - predicted);
        if (distance > 80) {
            DEBUG && console.log(`   TRAP detected: rivalAt=${opponentLeftTime}ms, predicted=${predicted}ms, distance=${distance}ms`);
            fileLogger.log('AI-TRAP', `rivalAt=${opponentLeftTime}ms | predicted=${predicted}ms | distance=${distance}ms | pattern=${this.opponentPattern.type} (${Math.round(this.opponentPattern.confidence * 100)}%)`, this.wsNumber);
            return true;
        }
        return false;
    }

    /**
     * PATTERN DETECTION: Apply pattern-based timing after boundary ML calculates
     * Only intervenes in specific cases:
     *   - OSCILLATING + high confidence → use predicted timing
     *   - DRIFTING + high confidence → blend 70% boundary + 30% pattern
     *   - STATIC + narrow boundary → boundary ML is already optimal, no change
     *   - RANDOM or low confidence → boundary ML only
     */
    _applyPatternOverride(boundaryTiming) {
        // Pattern detection is LOG-ONLY — does not modify timing
        // v3 boundary ML handles all rival types effectively on its own
        // Logging kept for analysis: see what patterns exist in real games
        if (!this.opponentPattern || this.opponentPattern.confidence < 0.5) {
            return boundaryTiming;
        }
        var gap = this._getBoundaryGap();
        var predictedFire = this._getPredictedTiming();
        fileLogger.log('AI-PATTERN', this.opponentPattern.type + ' | conf=' + Math.round(this.opponentPattern.confidence * 100) + '% | gap=' + gap + 'ms | predicted=' + predictedFire + 'ms | boundary=' + boundaryTiming + 'ms', this.wsNumber);
        return boundaryTiming; // boundary ML only — no override
    }

    /**
     * Get current boundary gap (ceiling - floor). Returns large number if either is unknown.
     */
    _getBoundaryGap() {
        if (this.ms.bFloor === null || this.ms.bCeiling === null) return 999;
        return this.ms.bCeiling - this.ms.bFloor;
    }

    /**
     * ADAPTIVE RIVAL DETECTION
     * Records result and checks for flip-flop pattern (SUCCESS<->KICKED alternation).
     * Adaptive rival: reacts to our results — goes higher after we SUCCESS, lower after we KICKED.
     * Detection: 3+ direction changes (S->K or K->S) in last 8 meaningful results.
     */
    _recordResultAndDetectAdaptive(result) {
        // Only track SUCCESS and KICKED — these show rival's position relative to us
        // 3S_ERROR and LEFT_EARLY don't indicate rival adapting
        if (result !== 'SUCCESS' && result !== 'KICKED') return;

        this.ms.resultHistory.push(result === 'SUCCESS' ? 'S' : 'K');
        // Keep last 8
        if (this.ms.resultHistory.length > 8) {
            this.ms.resultHistory.shift();
        }

        // Need at least 6 results to detect pattern
        if (this.ms.resultHistory.length < 6) {
            this.ms.adaptiveDetected = false;
            return;
        }

        // Count direction changes: S->K or K->S
        var changes = 0;
        for (var i = 1; i < this.ms.resultHistory.length; i++) {
            if (this.ms.resultHistory[i] !== this.ms.resultHistory[i - 1]) {
                changes++;
            }
        }

        // 3+ alternations in last 6-8 results = adaptive rival
        var wasAdaptive = this.ms.adaptiveDetected;
        this.ms.adaptiveDetected = changes >= 3;

        if (this.ms.adaptiveDetected && !wasAdaptive) {
            DEBUG && console.log('   ADAPTIVE RIVAL DETECTED: ' + this.ms.resultHistory.join(',') + ' (' + changes + ' changes)');
            fileLogger.log('AI-ADAPTIVE', 'DETECTED | history=' + this.ms.resultHistory.join(',') + ' | changes=' + changes, this.wsNumber);
        } else if (!this.ms.adaptiveDetected && wasAdaptive) {
            DEBUG && console.log('   ADAPTIVE cleared — rival stabilized');
            fileLogger.log('AI-ADAPTIVE', 'CLEARED | history=' + this.ms.resultHistory.join(',') + ' | changes=' + changes, this.wsNumber);
        }
    }

    /**
     * Detect rival's timing direction from recent opponentHistory.
     * Returns: 'down' if rival trending lower, 'up' if trending higher, 'flat' if stable/unknown.
     * Also returns variance to distinguish erratic vs directional.
     */
    _getRivalTrend() {
        var hist = this.opponentHistory;
        if (hist.length < 3) return { direction: 'flat', variance: 0 };

        // Use last 5 entries (or fewer)
        var recent = hist.slice(-5);
        var timings = [];
        for (var i = 0; i < recent.length; i++) {
            timings.push(recent[i].timing);
        }

        // Calculate variance
        var sum = 0;
        for (var i = 0; i < timings.length; i++) sum += timings[i];
        var mean = sum / timings.length;
        var varSum = 0;
        for (var i = 0; i < timings.length; i++) {
            var diff = timings[i] - mean;
            varSum += diff * diff;
        }
        var variance = varSum / timings.length;

        // Calculate direction: count drops/rises AND total magnitude
        var drops = 0;
        var rises = 0;
        var totalDrop = 0;
        var totalRise = 0;
        for (var i = timings.length - 1; i > 0; i--) {
            var delta = timings[i] - timings[i - 1];
            if (delta < 0) { drops++; totalDrop += Math.abs(delta); }
            else if (delta > 0) { rises++; totalRise += delta; }
        }

        // Require minimum 10ms total magnitude to filter out ±5 noise on stable rivals
        // A real adaptive rival dropping -15/round will easily clear this
        var direction = 'flat';
        if (drops >= 2 && drops > rises && totalDrop > 10) direction = 'down';
        else if (rises >= 2 && rises > drops && totalRise > 10) direction = 'up';

        return { direction: direction, variance: variance };
    }

    // â"€â"€â"€ OLD ML METHODS REMOVED â"€â"€â"€
    // The following methods were part of the old reactive ML system and are no longer used:
    // updateOpponentBounds, isLeftEarlyPlausible, getOpponentEstimate, scaleAdjustmentForZone,
    // updateZoneMultipliers, updateEMA, getEMATarget, predictNextTimingML
    // Replaced by Boundary ML binary search (getBoundaryMedian + getNextTiming)
    // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€


    /**
     * BOUNDARY ML: Get next timing based on last result.
     *
     * Pure binary search approach:
     *   LEFT_EARLY @X  â†' floor = X (rival was here before us)
     *   3S_ERROR @X    â†' floor = X (we were too early, need to go higher)
     *   KICKED @X      â†' ceiling = X (rival beat us, they're below X)
     *   SUCCESS @X     â†' ceiling = X (we won, rival is at or above X)
     *
     * When one edge is unknown, use median(edge, absolute_limit) to find it.
     * Every round halves the search space. Converges in 3-4 rounds.
     */
    async getNextTiming(lastResult, timingType, opponentLeftTime = null) {
        // Switch active mode FIRST
        this._setActiveMode(timingType);

        const beforeTiming = this.ms.currentTiming;
        DEBUG && console.log(`\nðŸŽ¯ BOUNDARY ML: result=${lastResult}, current=${this.ms.currentTiming}ms [${timingType}]`);
        fileLogger.log('AI-ROUND', `result=${lastResult} | before=${beforeTiming}ms | type=${timingType} | rival=${this.currentRivalName || '?'} | attempt#${this.stats.totalAttempts + 1} | floor=${this.ms.bFloor} | ceil=${this.ms.bCeiling}`, this.wsNumber);

        // Mode switch detection
        if (this.lastTimingType && this.lastTimingType !== timingType) {
            DEBUG && console.log(`   ðŸ"„ Mode switch: ${this.lastTimingType} â†' ${timingType}`);
        }
        this.lastTimingType = timingType;

        // PATTERN DETECTION: Record opponent timing for pattern learning
        // LEFT_EARLY/KICKED: we know where rival was (opponentLeftTime)
        // SUCCESS: rival was at or above our timing (use our timing as lower bound estimate)
        if ((lastResult === 'LEFT_EARLY' || lastResult === 'KICKED') && opponentLeftTime) {
            this.opponentHistory.push({
                timing: opponentLeftTime,
                result: lastResult,
                round: this.stats.totalAttempts,
                timestamp: Date.now()
            });
        } else if (lastResult === 'SUCCESS' && this.ms.currentTiming) {
            // On SUCCESS, rival was at or above our timing — record our timing as estimate
            this.opponentHistory.push({
                timing: this.ms.currentTiming,
                result: 'SUCCESS',
                round: this.stats.totalAttempts,
                timestamp: Date.now()
            });
        }

        // Keep last 20 events to prevent unbounded growth
        if (this.opponentHistory.length > 20) {
            this.opponentHistory.shift();
        }

        // Detect pattern (need at least 4 data points)
        if (this.opponentHistory.length >= 4) {
            this.opponentPattern = this.detectOpponentPattern();
            DEBUG && console.log('   Pattern: ' + this.opponentPattern.type + ' (' + Math.round(this.opponentPattern.confidence * 100) + '% confidence)');
        }

        // DB trust decay
        if (this.ms.recentKickedCount > 0 && lastResult !== 'KICKED') {
            this.ms.recentKickedCount--;
        }

        // Update stats
        this.stats.totalAttempts++;
        if (timingType === 'attack') this.stats.attackAttempts++;
        else this.stats.defenseAttempts++;

        // ADAPTIVE RIVAL DETECTION: record result and check for flip-flop
        this._recordResultAndDetectAdaptive(lastResult);

        // â"€â"€â"€ LEFT_EARLY: rival left before us â†' narrow boundary â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
        // Ceiling always tightens: min(currentCeiling, ourTiming)
        // Floor logic (v3 â€" 2x consecutive low LEFT_EARLY protection):
        //   - No floor or rivalLeftAt >= floor â†' update floor normally
        //   - rivalLeftAt < floor â†' outlier or genuine low rival. Count it.
        //     2 consecutive low LEFT_EARLYs â†' rival genuinely low, reset floor.
        //     1 low LEFT_EARLY â†' ignore floor change (protect ERRATIC noise)
        // 2x 3S_ERROR trigger is safety net if we go too low after floor reset.
        if (lastResult === 'LEFT_EARLY' && opponentLeftTime) {
            this.lastAdjustmentReason = 'LEFT_EARLY';
            this.ms.consecutiveKicked = 0;
            this.ms.consecutiveSuccess = 0;

            // FIX 1: Detect big jump (>50ms) — erratic rival shifted dramatically
            var bigJump = false;
            if (this.ms.lastRivalPosition !== null) {
                var jumpSize = Math.abs(opponentLeftTime - this.ms.lastRivalPosition);
                if (jumpSize > 75) {
                    // Big jump: widen boundaries instead of full wipe — keep some context
                    // Widen floor down and ceiling up to give room for re-convergence
                    if (this.ms.bFloor !== null) this.ms.bFloor = Math.max(this.timingFloor, this.ms.bFloor - 30);
                    if (this.ms.bCeiling !== null) this.ms.bCeiling = Math.min(this.timingCeiling, this.ms.bCeiling + 30);
                    this.ms.boundaryWiped = true;
                    bigJump = true;
                    DEBUG && console.log('   ERRATIC JUMP: ' + jumpSize + 'ms — boundary wipe');
                    fileLogger.log('AI-ERRATIC', 'BIG_JUMP ' + jumpSize + 'ms | old=' + this.ms.lastRivalPosition + ' new=' + opponentLeftTime + ' — boundary wiped', this.wsNumber);
                }
            }
            this.ms.lastRivalPosition = opponentLeftTime;

            // Ceiling: always tighten, never widen
            if (this.ms.bCeiling === null || this.ms.currentTiming < this.ms.bCeiling) {
                this.ms.bCeiling = this.ms.currentTiming;
            }

            // Floor: v3 protection against erratic outliers (skip if we just wiped)
            if (bigJump) {
                // After boundary wipe, set floor directly from rival position
                this.ms.bFloor = opponentLeftTime;
                this.ms.consecutiveLowLeftEarly = 0;
                this.ms.pendingLowFloor = null;
            } else if (this.ms.bFloor === null || opponentLeftTime >= this.ms.bFloor) {
                // rivalLeftAt is above or equal to floor — normal update
                this.ms.bFloor = opponentLeftTime;
                this.ms.consecutiveLowLeftEarly = 0;
                this.ms.pendingLowFloor = null;
            } else {
                // rivalLeftAt is BELOW current floor — outlier or genuine low rival
                this.ms.consecutiveLowLeftEarly++;
                this.ms.pendingLowFloor = opponentLeftTime;
                if (this.ms.consecutiveLowLeftEarly >= 2) {
                    // 2 consecutive low LEFT_EARLYs — rival genuinely playing low, reset floor
                    this.ms.bFloor = this.ms.pendingLowFloor;
                    this.ms.consecutiveLowLeftEarly = 0;
                    this.ms.pendingLowFloor = null;
                    DEBUG && console.log(`   2x low LEFT_EARLY: reset floor=${this.ms.bFloor}`);
                    fileLogger.log('AI-LOW_LEFT_TRIGGER', `2x low LEFT_EARLY — reset floor=${this.ms.bFloor} | ceil=${this.ms.bCeiling}`, this.wsNumber);
                }
            }

            // Start LEFT_EARLY recovery tracking (for 2x 3S_ERROR trigger)
            this.ms.leftEarlyCeiling = this.ms.bCeiling;
            this.ms.inLeftEarlyRecovery = true;
            this.ms.consecutive3sError = 0;

            // Binary search: median(floor, ceiling)
            this.ms.currentTiming = this.getBoundaryMedian();
            // Apply pattern override (oscillation/drift prediction)
            this.ms.currentTiming = this._applyPatternOverride(this.ms.currentTiming);

            this.ms.currentTiming = this.clampTiming(this.ms.currentTiming);
            this.ms.oscillatedTiming = null;

            DEBUG && console.log(`   LEFT_EARLY @${opponentLeftTime}ms — floor=${this.ms.bFloor} | ceil=${this.ms.bCeiling} | timing: ${beforeTiming}->${this.ms.currentTiming}ms`);
            fileLogger.log('AI-LEFT_EARLY', `${beforeTiming}ms -> ${this.ms.currentTiming}ms | rivalAt=${opponentLeftTime}ms | floor=${this.ms.bFloor} | ceil=${this.ms.bCeiling} | lowCount=${this.ms.consecutiveLowLeftEarly}`, this.wsNumber);
            return this.ms.currentTiming;
        }

        // â"€â"€â"€ SUCCESS: we beat the rival â†' this is a ceiling â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
        if (lastResult === 'SUCCESS') {
            this.stats.successCount++;
            if (timingType === 'attack') this.stats.attackSuccess++;
            else this.stats.defenseSuccess++;
            this.lastAdjustmentReason = 'SUCCESS';
            this.ms.recentKickedCount = 0;
            this.ms.inLeftEarlyRecovery = false;
            this.ms.consecutive3sError = 0;
            this.ms.consecutiveLowLeftEarly = 0;
            this.ms.consecutiveKicked = 0;
            this.ms.consecutiveSuccess++;

            // Update ceiling â€" rival was at or above our timing
            if (this.ms.bCeiling === null || this.ms.currentTiming < this.ms.bCeiling) {
                this.ms.bCeiling = this.ms.currentTiming;
            }

            if (this.ms.adaptiveDetected) {
                // Fix 3: Anticipate reversal — after 5+ consecutive SUCCESS, rival WILL reverse down
                // Fix 1: Check rival direction — if rival trending down, don't drift into it
                var trend = this._getRivalTrend();

                if (this.ms.consecutiveSuccess >= 5) {
                    // Reversal imminent — hold timing, rival will hard-reverse down soon
                    DEBUG && console.log('   ADAPTIVE: streak=' + this.ms.consecutiveSuccess + ' — reversal anticipated, holding');
                    fileLogger.log('AI-ADAPTIVE', 'SUCCESS hold-reversal | streak=' + this.ms.consecutiveSuccess + ' | timing=' + this.ms.currentTiming + 'ms', this.wsNumber);
                } else if (trend.direction === 'down') {
                    // Rival trending down toward us — DON'T drift into its path, nudge UP slightly
                    this.ms.currentTiming = this.clampTiming(this.ms.currentTiming + 2);
                    DEBUG && console.log('   ADAPTIVE: rival trending DOWN — nudge up +2');
                    fileLogger.log('AI-ADAPTIVE', 'SUCCESS nudge-up | rival-trend=down | timing=' + this.ms.currentTiming + 'ms', this.wsNumber);
                } else {
                    // Normal adaptive hold — rival going higher after our success
                    DEBUG && console.log('   ADAPTIVE: holding timing (no drift) — rival will go higher');
                    fileLogger.log('AI-ADAPTIVE', 'SUCCESS hold | timing=' + this.ms.currentTiming + 'ms', this.wsNumber);
                }
            } else {
                // FIX 2: Aggressive re-convergence after boundary wipe
                var gap = this._getBoundaryGap();
                var drift;
                if (this.ms.boundaryWiped && gap > 40) {
                    // After erratic jump, use wide steps to find rival fast (1 round vs 3-4)
                    drift = 5;
                    DEBUG && console.log('   ERRATIC RE-CONVERGE: drift=-5 (gap=' + gap + ')');
                } else {
                    // Smart drift: aggressive when searching, gentle when converged
                    drift = gap < 25 ? 1 : 3;
                    // Clear wipe flag once converged
                    if (this.ms.boundaryWiped && gap <= 40) {
                        this.ms.boundaryWiped = false;
                    }
                }
                this.ms.currentTiming = this.clampTiming(this.ms.currentTiming - drift);
                // But don't go below floor
                if (this.ms.bFloor !== null && this.ms.currentTiming <= this.ms.bFloor) {
                    this.ms.currentTiming = this.getBoundaryMedian();
                }
            }

            // Apply pattern override (oscillation/drift prediction)
            this.ms.currentTiming = this._applyPatternOverride(this.ms.currentTiming);

            this.ms.currentTiming = this.clampTiming(this.ms.currentTiming);
            this.ms.oscillatedTiming = null;

            // FIX 3: 3S_ERROR prediction guard — don't commit timing within 10ms of known floor
            if (this.ms.bFloor !== null && this.ms.currentTiming < this.ms.bFloor + 10) {
                this.ms.currentTiming = this.clampTiming(this.ms.bFloor + 10);
            }

            DEBUG && console.log(`   SUCCESS -> ceil=${this.ms.bCeiling} | timing: ${beforeTiming}->${this.ms.currentTiming}ms`);
            fileLogger.log('AI-SUCCESS', `${beforeTiming}ms -> ${this.ms.currentTiming}ms | floor=${this.ms.bFloor} | ceil=${this.ms.bCeiling}`, this.wsNumber);
            return this.ms.currentTiming;
        }

        // â"€â"€â"€ 3S_ERROR: we were too early â†' this is a floor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
        // If 2 consecutive 3S_ERROR after LEFT_EARLY: restore LEFT_EARLY ceiling,
        // keep current floor (last 3S_ERROR), median between them.
        if (lastResult === '3S_ERROR') {
            this.stats.errorCount++;
            this.lastAdjustmentReason = '3S_ERROR';

            // Update floor â€" we need to go higher
            if (this.ms.bFloor === null || this.ms.currentTiming > this.ms.bFloor) {
                this.ms.bFloor = this.ms.currentTiming;
            }

            // LEFT_EARLY recovery: 2x consecutive 3S_ERROR trigger
            if (this.ms.inLeftEarlyRecovery) {
                this.ms.consecutive3sError++;
                if (this.ms.consecutive3sError >= 2) {
                    // Went too low after LEFT_EARLY â€" restore the LEFT_EARLY ceiling
                    this.ms.bCeiling = this.ms.leftEarlyCeiling;
                    this.ms.inLeftEarlyRecovery = false;
                    this.ms.consecutive3sError = 0;
                    DEBUG && console.log(`   ðŸ"„ LEFT_EARLY 2x 3S_ERROR trigger: restored ceil=${this.ms.bCeiling}`);
                    fileLogger.log('AI-3S_TRIGGER', `2x 3S_ERROR after LEFT_EARLY â†' restored ceil=${this.ms.bCeiling} | floor=${this.ms.bFloor}`, this.wsNumber);
                }
            }

            // Binary search: median(floor, ceiling)
            this.ms.currentTiming = this.getBoundaryMedian();
            // If median lands at or below floor (boundary too narrow), step above
            if (this.ms.bFloor !== null && this.ms.currentTiming <= this.ms.bFloor) {
                this.ms.currentTiming = this.clampTiming(this.ms.bFloor + 15);
            }

            // Apply pattern override (oscillation/drift prediction)
            this.ms.currentTiming = this._applyPatternOverride(this.ms.currentTiming);

            this.ms.currentTiming = this.clampTiming(this.ms.currentTiming);
            this.ms.oscillatedTiming = null;

            DEBUG && console.log(`   3S_ERROR -> floor=${this.ms.bFloor} | ceil=${this.ms.bCeiling} | timing: ${beforeTiming}->${this.ms.currentTiming}ms`);
            fileLogger.log('AI-3S_ERROR', `${beforeTiming}ms -> ${this.ms.currentTiming}ms | floor=${this.ms.bFloor} | ceil=${this.ms.bCeiling}`, this.wsNumber);
            return this.ms.currentTiming;
        }

        // â"€â"€â"€ KICKED: rival was faster â†' this is a ceiling â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
        if (lastResult === 'KICKED') {
            this.stats.kickedCount++;
            this.lastAdjustmentReason = 'KICKED';
            this.ms.recentKickedCount = 2;
            this.ms.inLeftEarlyRecovery = false;
            this.ms.consecutive3sError = 0;
            this.ms.consecutiveLowLeftEarly = 0;

            // Update ceiling — rival is somewhere below our timing
            if (this.ms.bCeiling === null || this.ms.currentTiming < this.ms.bCeiling) {
                this.ms.bCeiling = this.ms.currentTiming;
            }

            // Track consecutive KICKEDs
            this.ms.consecutiveKicked++;
            this.ms.consecutiveSuccess = 0;

            // Fix 2: Separate floor reset by rival type
            // Erratic (high variance) → full floor reset (ceil-150) — rival is random, need wide search
            // Adaptive (low variance, directional) → DON'T reset floor, just tighten ceiling and median
            //   Resetting floor for adaptive destroys our carefully built boundary
            // 3x consecutive KICKED (non-adaptive) → floor is trapping, reset it
            if (this.ms.consecutiveKicked >= 3 && !this.ms.adaptiveDetected) {
                // 3x KICKED, not adaptive — floor is wrong, reset wide
                var oldFloor = this.ms.bFloor;
                var newFloor = Math.max(this.timingFloor, this.ms.bCeiling - 150);
                this.ms.bFloor = newFloor;
                this.ms.consecutiveKicked = 0;
                this.ms.currentTiming = this.getBoundaryMedian();
                DEBUG && console.log('   3xKICKED: floor reset ' + oldFloor + ' -> ' + this.ms.bFloor + ' | ceil=' + this.ms.bCeiling + ' -> timing=' + this.ms.currentTiming + 'ms');
                fileLogger.log('AI-KICKED', '3xKICKED floor-reset | ' + oldFloor + ' -> ' + this.ms.bFloor + ' | ceil=' + this.ms.bCeiling + ' | timing=' + this.ms.currentTiming + 'ms', this.wsNumber);
            } else if (this.ms.adaptiveDetected) {
                // Adaptive rival — check variance to decide strategy
                var trend = this._getRivalTrend();
                if (trend.variance > 2000) {
                    // High variance = erratic-like adaptive — do the wide floor reset
                    var oldFloor = this.ms.bFloor;
                    var newFloor = Math.max(this.timingFloor, this.ms.bCeiling - 150);
                    this.ms.bFloor = newFloor;
                    this.ms.consecutiveKicked = 0;
                    this.ms.currentTiming = this.getBoundaryMedian();
                    DEBUG && console.log('   ADAPTIVE-ERRATIC: floor reset ' + oldFloor + ' -> ' + this.ms.bFloor);
                    fileLogger.log('AI-KICKED', 'ADAPTIVE-ERRATIC floor-reset | var=' + Math.round(trend.variance) + ' | ' + oldFloor + ' -> ' + this.ms.bFloor + ' | timing=' + this.ms.currentTiming + 'ms', this.wsNumber);
                } else {
                    // Low variance = directional adaptive — preserve floor, just use median
                    // The boundary is still valid, rival just shifted slightly
                    this.ms.consecutiveKicked = 0;
                    this.ms.currentTiming = this.getBoundaryMedian();
                    DEBUG && console.log('   ADAPTIVE-DIRECTIONAL: keeping floor=' + this.ms.bFloor + ' | median=' + this.ms.currentTiming + 'ms');
                    fileLogger.log('AI-KICKED', 'ADAPTIVE-DIRECTIONAL keep-floor | var=' + Math.round(trend.variance) + ' | floor=' + this.ms.bFloor + ' | ceil=' + this.ms.bCeiling + ' | timing=' + this.ms.currentTiming + 'ms', this.wsNumber);
                }
            } else {
                // Normal: binary search median(floor, ceiling)
                this.ms.currentTiming = this.getBoundaryMedian();
            }
            // If stuck at floor (floor >= ceiling), floor was wrong — reset it
            if (this.ms.bFloor !== null && this.ms.currentTiming <= this.ms.bFloor) {
                this.ms.bFloor = null;
                this.ms.currentTiming = this.getBoundaryMedian();
            }

            // Apply pattern override (log only)
            this.ms.currentTiming = this._applyPatternOverride(this.ms.currentTiming);

            this.ms.currentTiming = this.clampTiming(this.ms.currentTiming);
            this.ms.oscillatedTiming = null;

            DEBUG && console.log(`   KICKED -> ceil=${this.ms.bCeiling} | timing: ${beforeTiming}->${this.ms.currentTiming}ms`);
            fileLogger.log('AI-KICKED', `${beforeTiming}ms -> ${this.ms.currentTiming}ms | floor=${this.ms.bFloor} | ceil=${this.ms.bCeiling}`, this.wsNumber);
            return this.ms.currentTiming;
        }

        // Fallback (should not reach here)
        DEBUG && console.log('   Unknown result: ' + lastResult);
        return this.ms.currentTiming;
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
     * 1. KICKED (base: 4.0) - Highest priority â€" we got punished here
     * 2. SUCCESS (base: 3.0) - High priority â€" this timing actually worked
     * 3. 3S_ERROR (base: 2.0) - Medium priority â€" direct measurement of failure
     * 4. LEFT_EARLY (base: 1.5) - Lowest priority â€" ceiling hint only, not a direct measurement
     * 
     * Zone Multiplier (applied to base weights):
     * - High danger zone (>40% kicks): 1.5x weight
     * - Medium danger zone (20-40% kicks): 1.2x weight
     * - Low danger zone (<20% kicks): 0.8x weight (minimum, not zero)
     */
    async refreshRivalData(rivalName, timingType = 'attack') {
        if (!this.supabase || !rivalName) return;

        // Skip DB refresh if boundary is narrow â€" ML is converging, DB would corrupt it
        if (this.ms.bFloor !== null && this.ms.bCeiling !== null) {
            var gap = this.ms.bCeiling - this.ms.bFloor;
            if (gap < 60) {
                fileLogger.log('AI-DB', `SKIP: narrow boundary (gap=${gap}ms, floor=${this.ms.bFloor}, ceil=${this.ms.bCeiling}) â€" ML converging`, this.wsNumber);
                return;
            }
        }

        try {
            DEBUG && console.log(`   ðŸ" Refreshing data for: ${rivalName} (${timingType})`);

            // ðŸš€ USE SAME DATABASE FUNCTION (analyzes ALL records, not just 50)
            // âœ… FIX: Pass correct is_defense based on timingType
            var { data, error } = await this.supabase
                .rpc('get_optimal_timing_for_rival', {
                    p_user_id: this.userId,
                    p_rival_name: rivalName,
                    p_is_defense: timingType === 'defense'
                });

            if (error) {
                console.error(`   âŒ Database function error:`, error);
                return;
            }

            if (!data || data.length === 0 || !data[0].optimal_timing) {
                DEBUG && console.log(`   â„¹ï¸ No new data found`);
                return;
            }

            var result = data[0];
            var dbOptimalTiming = result.optimal_timing;

            DEBUG && console.log(`\n   ðŸ"Š Database Refresh Results:`);
            DEBUG && console.log(`   ðŸŽ¯ Optimal Timing: ${dbOptimalTiming}ms`);
            DEBUG && console.log(`   ðŸ"ˆ Total Records: ${result.record_count}`);
            DEBUG && console.log(`   âœ… SUCCESS: ${result.success_count}`);
            DEBUG && console.log(`   âš ï¸ KICKED: ${result.kicked_count}`);
            DEBUG && console.log(`   â±ï¸ 3S_ERROR: ${result.error_count}`);
            DEBUG && console.log(`   ðŸƒ LEFT_EARLY: ${result.left_early_count}`);
            DEBUG && console.log(`\n   ðŸ—ºï¸ ZONE DANGER ANALYSIS:`);
            DEBUG && console.log(`   SLOW zone: ${result.slow_zone_kicked} KICKED ${result.slow_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.slow_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);
            DEBUG && console.log(`   NORMAL zone: ${result.normal_zone_kicked} KICKED ${result.normal_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.normal_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);
            DEBUG && console.log(`   FAST zone: ${result.fast_zone_kicked} KICKED ${result.fast_zone_kicked >= 8 ? '(HIGH DANGER 1.5x)' : result.fast_zone_kicked >= 4 ? '(MEDIUM DANGER 1.2x)' : '(LOW DANGER 0.8x)'}`);

            // Update cache
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
                fastZoneKicked: result.fast_zone_kicked
            });

            DEBUG && console.log(`   ðŸ"Š Current timing: ${this.ms.currentTiming}ms`);

            // ðŸ"' Clamp DB optimal timing to speed preset bounds BEFORE blending
            // Prevents DB from pulling timing toward a zone the user didn't choose
            var clampedDbTiming = this.clampTiming(dbOptimalTiming);
            if (clampedDbTiming !== dbOptimalTiming) {
                DEBUG && console.log(`   ðŸ"' DB timing ${dbOptimalTiming}ms clamped to ${clampedDbTiming}ms (speed preset: ${this.speedPreset}, bounds: ${this.timingFloor}-${this.timingCeiling})`);
            }

            // ðŸ›¡ï¸ MINIMUM RECORDS CHECK: DB needs at least 3 records to be directionally useful
            // With 1-2 records the result is too noisy; 3+ is enough for a directional hint.
            if (result.record_count < 3) {
                DEBUG && console.log(`   ðŸ›¡ï¸ TOO FEW RECORDS (${result.record_count}) â€" skipping DB blend, var ML learn first`);
                fileLogger.log('AI-DB', `SKIP: too few records (${result.record_count}) for ${rivalName} | dbOptimal=${dbOptimalTiming}ms`, this.wsNumber);
                return { optimalTiming: clampedDbTiming, recordCount: result.record_count };
            }

            // ðŸ" FEW RECORDS (3-4): Use directionally â€" only push in the right direction, tiny nudge
            // e.g. if all 3 records are 3S_ERROR at 1850ms, at least know to start ABOVE 1850ms
            if (result.record_count < 5) {
                var allErrors = result.success_count === 0 && result.kicked_count === 0;
                var allKicked = result.success_count === 0 && result.error_count === 0;
                if (allErrors && clampedDbTiming > this.ms.currentTiming) {
                    // All records are 3S_ERROR â€" rival is above these timings, nudge up slightly
                    var nudge = Math.min(15, clampedDbTiming - this.ms.currentTiming);
                    fileLogger.log('AI-DB', `FEW-RECORDS-UP: ${result.record_count} records all-error at ${dbOptimalTiming}ms â†' nudge +${nudge}ms | rival=${rivalName}`, this.wsNumber);
                    this.ms.currentTiming = this.clampTiming(this.ms.currentTiming + nudge);
                } else if (allKicked && clampedDbTiming < this.ms.currentTiming) {
                    // All records are KICKED â€" rival is below these timings, nudge down slightly
                    var nudge = Math.min(15, this.ms.currentTiming - clampedDbTiming);
                    fileLogger.log('AI-DB', `FEW-RECORDS-DOWN: ${result.record_count} records all-kicked at ${dbOptimalTiming}ms â†' nudge -${nudge}ms | rival=${rivalName}`, this.wsNumber);
                    this.ms.currentTiming = this.clampTiming(this.ms.currentTiming - nudge);
                } else {
                    fileLogger.log('AI-DB', `FEW-RECORDS-SKIP: ${result.record_count} records mixed/wrong-dir for ${rivalName} | dbOptimal=${dbOptimalTiming}ms`, this.wsNumber);
                }
                return { optimalTiming: clampedDbTiming, recordCount: result.record_count };
            }

            // ðŸ›¡ï¸ DB TRUST CONTROL: DB is a gentle background hint only â€" ML always leads.
            // DB can nudge timing by at most 30ms per refresh, and only 20% influence.
            // After any KICKED, DB is fully blocked for 2 rounds so ML can correct freely.
            var timingDiff = Math.abs(clampedDbTiming - this.ms.currentTiming);

            if (this.ms.recentKickedCount >= 1) {
                // Recent KICK(s) â€" ML is actively correcting, DB is stale â€" skip entirely
                DEBUG && console.log(`   ðŸ›¡ï¸ DB TRUST BLOCKED: ${this.ms.recentKickedCount} recent KICKs â€" ML is correcting, keeping ${this.ms.currentTiming}ms`);
                DEBUG && console.log(`   ðŸ›¡ï¸ DB suggested: ${dbOptimalTiming}ms (IGNORED â€" stale success anchor)`);
                fileLogger.log('AI-DB', `BLOCKED: ${this.ms.recentKickedCount} recent kicks â€" keeping ML=${this.ms.currentTiming}ms, DB=${clampedDbTiming}ms ignored | rival=${rivalName}`, this.wsNumber);

            } else {
                // No recent kicks â€" allow a soft nudge only (max 20% DB, capped at 30ms shift)
                if (timingDiff > 15) {
                    // Direction check: use last result to determine ML direction
                    var dbDirection = clampedDbTiming > this.ms.currentTiming ? 1 : -1;
                    var mlDirection = this.lastAdjustmentReason === '3S_ERROR' ? 1   // chasing up
                                      : this.lastAdjustmentReason === 'KICKED' ? -1    // chasing down
                                      : 0; // neutral â€" DB can nudge either way

                    if (mlDirection !== 0 && dbDirection !== mlDirection) {
                        DEBUG && console.log(`   ðŸ›¡ï¸ DB DIRECTION BLOCKED: DB wants ${clampedDbTiming}ms but ML is heading ${mlDirection > 0 ? 'UP' : 'DOWN'} â€" keeping ${this.ms.currentTiming}ms`);
                        fileLogger.log('AI-DB', `DIR-BLOCKED: DB=${clampedDbTiming}ms conflicts with ML direction (${mlDirection > 0 ? 'UP' : 'DOWN'}) â€" keeping ${this.ms.currentTiming}ms | rival=${rivalName}`, this.wsNumber);
                    } else {
                        // Soft nudge: 80% ML, 20% DB, but cap the actual shift at 30ms
                        var blended = Math.round(this.ms.currentTiming * 0.8 + clampedDbTiming * 0.2);
                        var cappedDiff = Math.max(-30, Math.min(30, blended - this.ms.currentTiming));
                        var newTiming = this.ms.currentTiming + cappedDiff;
                        DEBUG && console.log(`   ðŸ"Š DB SOFT NUDGE: ${this.ms.currentTiming}ms â†' ${newTiming}ms (80% ML + 20% DB, capped Â±30ms, diff was ${timingDiff}ms)`);
                        fileLogger.log('AI-DB', `NUDGE: ${this.ms.currentTiming}ms â†' ${newTiming}ms (shift=${cappedDiff}ms, DB=${clampedDbTiming}ms, diff=${timingDiff}ms) | rival=${rivalName} | records=${result.record_count}`, this.wsNumber);
                        this.ms.currentTiming = newTiming;
                    }
                } else {
                    DEBUG && console.log(`   âœ… Small difference (${timingDiff}ms) - Keeping ML timing`);
                    fileLogger.log('AI-DB', `NO-CHANGE: diff=${timingDiff}ms too small â€" keeping ${this.ms.currentTiming}ms | DB=${clampedDbTiming}ms | rival=${rivalName}`, this.wsNumber);
                }
            }

            // Clamp to speed preset bounds after DB blend
            this.ms.currentTiming = this.clampTiming(this.ms.currentTiming);

            return { optimalTiming: clampedDbTiming, recordCount: result.record_count };

        } catch (error) {
            console.error(`   âŒ Error refreshing rival data:`, error);
        }
    }


    /**
     * ðŸŽ² Get timing for actual firing (called from getTiming() in gameLogic.js).
     * This is where jitter + oscillation are ACTUALLY applied to the fire time.
     * 
     * Priority:
     *   1. If oscillatedTiming is set (SUCCESS round) â†' fire from oscillated zone + jitter
     *   2. Otherwise â†' fire from currentTiming + jitter
     * 
     * Internal currentTiming is NEVER modified here â€" ML stays clean.
     * 
     * @param {string} mode - 'attack' or 'defense'
     * @returns {number} - timing with jitter applied
     */
    getTimingWithJitter(mode) {
        // Use mode-specific timing and oscillation state
        const modeState = mode === 'defense' ? this.modeState.defense : this.modeState.attack;
        const modeTiming = modeState.currentTiming;
        const oscillatedTiming = modeState.oscillatedTiming;
        const base = oscillatedTiming || modeTiming;
        if (!base) return Math.round((this.timingFloor + this.timingCeiling) / 2);
        const fired = this.applyJitter(base);
        DEBUG && console.log(`   ðŸŽ² [${mode.toUpperCase()}] getTimingWithJitter: base=${base}ms (${oscillatedTiming ? 'oscillated' : mode}) â†' fired=${fired}ms`);
        return fired;
    }

    /**
     * ðŸ"„ Determine zone oscillation pair based on rival's historical zone data.
     * Uses zone kick counts already loaded from SQL (no new DB call needed).
     *
     * IMPORTANT: Oscillation pair is calculated dynamically based on current speed preset bounds!
     * Not hardcoded to 1825/1925/2020 â€" respects user's SLOW/NORMAL/FAST selection.
     *
     * Rules:
     *   FAST opponent  â†' oscillate FAST â†" NORMAL
     *   NORMAL opponent â†' oscillate NORMAL â†" SLOW
     *   SLOW opponent  â†' oscillate SLOW â†" NORMAL
     *
    /**
     * Apply random jitter to the fired timing value.
     * IMPORTANT: this.currentTiming is NOT modified â€" internal learning stays clean.
     * Only the value that gets sent to ACTION 3 has noise.
     * 
     * @param {number} timing - The clean calculated timing (this.currentTiming)
     * @param {number} range  - Max jitter in ms (default Â±15ms)
     * @returns {number} - timing + random noise, clamped to speed preset bounds
     */
    applyJitter(timing, range = 15) {
        // Jitter removed â€" oscillation and anchor strategies already provide unpredictability.
        // Random noise was wider (Â±15ms) than oscillation range (Â±8-10ms) and caused
        // artificial 3S_ERRORs/KICKs that polluted ML learning history.
        // Use absolute ceiling (2150) so ceiling-escape timings above preset ceiling are not clamped back.
        return Math.max(this.timingFloor, Math.min(2150, timing));
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
     * Set rival name (alias for setCurrentRival)
     */
    async setRivalName(rivalName) {
        return await this.setCurrentRival(rivalName);
    }

    /**
     * Set current rival (called when targeting a player)
     * If the rival is the SAME as the current rival (e.g. WS reconnect mid-fight),
     * ML state is preserved so bFloor / bCeiling / currentTiming
     * keep accumulating correctly across reconnects.
     */
    async setCurrentRival(rivalName) {
        const isSameRival = this.currentRivalName === rivalName;
        this.currentRivalName = rivalName;

        if (isSameRival) {
            // Same rival â€" reconnected mid-fight. Keep all ML state intact.
            DEBUG && console.log(`ðŸŽ¯ [SAME RIVAL] Reconnected to ${rivalName} â€" preserving ML state (atkTiming=${this.modeState.attack.currentTiming}ms, defTiming=${this.modeState.defense.currentTiming}ms)`);
            fileLogger.log('AI-RIVAL', `SAME=${rivalName} â€" preserving state: atkFloor=${this.modeState.attack.bFloor}ms | atkCeil=${this.modeState.attack.bCeiling}ms | defFloor=${this.modeState.defense.bFloor}ms | defCeil=${this.modeState.defense.bCeiling}ms`, this.wsNumber);

            // Ensure initial timing is set (may not have been if first connect failed)
            if (!this.initialTimingSet) {
                await this.initializeTimingFromPing();
            }
            return; // Skip all resets and DB reload
        }

        // Switching rivals â€" save current rival's state before resetting
        // Cap cache at 15 rivals to prevent unbounded memory growth in long sessions
        if (this.rivalStateCache.size >= 15) {
            const oldestKey = this.rivalStateCache.keys().next().value;
            this.rivalStateCache.delete(oldestKey);
        }
        if (this.currentRivalName) {
            this.rivalStateCache.set(this.currentRivalName, {
                modeState: {
                    attack: { ...this.modeState.attack },
                    defense: { ...this.modeState.defense },
                },
                lastTimingType: this.lastTimingType,
            });
            DEBUG && console.log(`ðŸ'¾ Saved ML state for ${this.currentRivalName} (atkTiming=${this.modeState.attack.currentTiming}ms, defTiming=${this.modeState.defense.currentTiming}ms, atkFloor=${this.modeState.attack.bFloor}, atkCeil=${this.modeState.attack.bCeiling})`);
        }

        // Check if we've seen this rival before this session â€" restore cached state
        const cachedState = this.rivalStateCache.get(rivalName);
        if (cachedState) {
            DEBUG && console.log(`ðŸŽ¯ [KNOWN RIVAL] Restoring cached state for ${rivalName} (atkTiming=${cachedState.modeState.attack.currentTiming}ms, defTiming=${cachedState.modeState.defense.currentTiming}ms)`);
            fileLogger.log('AI-RIVAL', `KNOWN=${rivalName} â€" restoring cached state: atkTiming=${cachedState.modeState.attack.currentTiming}ms | defTiming=${cachedState.modeState.defense.currentTiming}ms`, this.wsNumber);
            this.currentRivalName = rivalName;
            this.modeState.attack = { ...cachedState.modeState.attack };
            this.modeState.defense = { ...cachedState.modeState.defense };
            this.lastTimingType = cachedState.lastTimingType;
            this._setActiveMode(this.lastTimingType || 'attack');
            if (!this.initialTimingSet) await this.initializeTimingFromPing();
            return;
        }

        // Truly new rival â€" full reset
        DEBUG && console.log(`ðŸŽ¯ [NEW RIVAL] ${this.currentRivalName || 'none'} â†' ${rivalName}`);
        fileLogger.log('AI-RIVAL', `NEW=${rivalName} â€" resetting all ML state`, this.wsNumber);

        // Ensure initial timing is set from ping
        if (!this.initialTimingSet) {
            await this.initializeTimingFromPing();
        }

        // Reset BOTH mode states independently for new rival
        this.modeState.attack = this._createModeState();
        this.modeState.defense = this._createModeState();
        this.ms = this.modeState[this.activeMode]; // re-point pointer after reset
        this.lastTimingType = null;

        // ðŸ"¥ LOAD DATABASE DATA for each mode independently
        DEBUG && console.log(`   ðŸ" Loading database knowledge for ${rivalName}...`);
        const [attackData, defenseData] = await Promise.all([
            this.refreshRivalData(rivalName, 'attack'),
            this.refreshRivalData(rivalName, 'defense'),
        ]);

        // COLD-START: Use 1890 as default start — where most rivals actually play.
        // Better than blind median(1675,2150)=1913 which wastes rounds on 3S_ERROR.
        // Clamp to preset bounds so FAST preset doesn't start below its floor.
        var coldStart = this.clampTiming(1890);

        // Set attack timing from attack DB records
        if (attackData && attackData.optimalTiming && attackData.recordCount >= 3) {
            var dbOptimal = attackData.optimalTiming;
            this.modeState.attack.currentTiming = dbOptimal > this.timingCeiling
                ? this.timingCeiling : this.clampTiming(dbOptimal);
            fileLogger.log('AI-RIVAL', 'NEW=' + rivalName + ' ATTACK DB=' + dbOptimal + 'ms -> start=' + this.modeState.attack.currentTiming + 'ms (' + attackData.recordCount + ' records)', this.wsNumber);
        } else {
            this.modeState.attack.currentTiming = coldStart;
        }

        // Set defense timing from defense DB records — independent from attack
        if (defenseData && defenseData.optimalTiming && defenseData.recordCount >= 3) {
            var dbOptimal = defenseData.optimalTiming;
            this.modeState.defense.currentTiming = dbOptimal > this.timingCeiling
                ? this.timingCeiling : this.clampTiming(dbOptimal);
            fileLogger.log('AI-RIVAL', 'NEW=' + rivalName + ' DEFENSE DB=' + dbOptimal + 'ms -> start=' + this.modeState.defense.currentTiming + 'ms (' + defenseData.recordCount + ' records)', this.wsNumber);
        } else {
            this.modeState.defense.currentTiming = this.modeState.attack.currentTiming;
        }

        DEBUG && console.log(`   âœ… NEW RIVAL ${rivalName}: attack=${this.modeState.attack.currentTiming}ms | defense=${this.modeState.defense.currentTiming}ms`);
    }

    /**
     * Reset state (called on disconnect/reconnect)
     */
    async resetState() {
        DEBUG && console.log(`ðŸ"„ ML AI: Resetting state`);

        // Clear per-rival state cache â€" fresh session
        this.rivalStateCache = new Map();

        // Reset both mode states â€" fresh session
        this.modeState = {
            attack: this._createModeState(),
            defense: this._createModeState(),
        };
        this.activeMode = 'attack';
        this.ms = this.modeState.attack;
        this.currentRivalName = null;
        this.initialTimingSet = false;
        this.lastTimingType = null;

        // ðŸŽ¯ PATTERN DETECTION: Reset pattern history on reconnect
        this.opponentHistory = [];
        this.opponentPattern = null;

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
