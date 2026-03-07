const https = require("https");
const { parseHaaapsi, countOccurrences } = require("../utils/helpers");
const { getFounderId, setFounderId } = require("../utils/founderMemory");
const fileLogger = require("../utils/fileLogger");
const SimpleAICore = require("../ai/SimpleAICore"); // Simple AI Core for rival data
const { AIChatService } = require("../ai/AIChatService"); // AI Chat service
const DEBUG = process.env.DEBUG === 'true';

class GameLogic {
    constructor(wsNumber, config, addLogCallback, updateConfigCallback, reconnectCallback) {
        this.wsNumber = wsNumber;
        this.config = config;
        this.addLog = addLogCallback;
        this.updateConfig = updateConfigCallback;
        this.reconnect = reconnectCallback;

        // Core state
        this.haaapsi = null;
        this.id = null;
        this.useridg = null;
        this.passwordg = null;
        this.finalusername = null;
        this.botGangName = null; // Track bot's own gang/clan name

        // Metrics tracking
        this.connectionStartTime = Date.now(); // Track when connection started
        this.currentCodeType = 'primary'; // Track which code is being used (primary/alt)
        this.rivalDetectedTime = null; // Track when current target was detected
        this.currentTargetName = null; // Track current target name for metrics
        this.lastTargetName = null; // Last known rival name — survives resets for KICKED tracking
        this.rivalDetectionTimes = {}; // Track detection time per rival (userid -> timestamp)
        this.actionSentTime = null; // Track when ACTION 3 was sent (for accurate metrics)

        // Prison detection
        this.prisonConfirmed = false; // Confirmed via 854 "Release Time" message
        this.escapeInProgress = false; // Track if escape is currently in progress
        this.escapeRetryCount = 0; // Track escape retry attempts
        this.maxEscapeRetries = 3; // Maximum escape retries before giving up

        // Defense tracking (when bot gets kicked)
        this.wasKickedToPrison = false; // Flag to track if bot was kicked (vs manual prison)
        this.mlTimingWhenKicked = null; // ML timing value when bot was kicked
        this.rivalWhoKickedUs = null; // Name of rival who kicked us
        this.defenseMetricRecorded = false; // Flag to prevent duplicate KICKED recordings

        // Auto Interval: Store original starting values for cycling
        // These are captured when auto interval first adjusts a key, and used to cycle back
        this.autoIntervalStartValues = {}; // key -> original value (e.g., "attack1" -> 1940)

        // IMPORTANT: Restore shouldRejoinPlanet from appState (persists across reconnections)
        const { appState } = require("../config/appState");
        const flagKey = `shouldRejoinPlanet${wsNumber}`;
        this.shouldRejoinPlanet = appState.gameState[flagKey] || false;
        DEBUG && console.log(`[WS${wsNumber}] Constructor - Restored shouldRejoinPlanet: ${this.shouldRejoinPlanet}`);


        // Target tracking - Using Sets for faster lookups
        this.targetids = new Set();
        this.targetnames = new Map(); // userid -> username
        this.attackids = new Set();
        this.attacknames = new Map(); // userid -> username
        this.userAppearanceTime = {}; // Track when each user appeared (userid -> timestamp)

        // Current target/attack
        this.useridtarget = null;
        this.useridattack = null;
        this.status = ""; // "attack" or "defense"

        // Flags
        this.userFound = false;
        this.threesec = false;
        this.inPrison = false;
        this.currentPlanet = null;
        this.founderUserId = null; // Will be loaded from file

        // Timers
        this.timeout = null;
        this.innerTimeouts = []; // Track nested timeouts for clean cancellation

        // Counter for code alternation
        this.inc = 0;

        // Reconnection & OffSleep
        this.reconnectTimeoutId = null;
        this.isOffSleepActive = false;
        this.offSleepRetryCount = 0;
        this.maxOffSleepRetries = 10;

        // Timer Shift
        this.consecutiveErrors = 0;
        this.consecutiveSuccesses = 0;
        this.recentAdjustments = [];
        this.maxAdjustmentHistory = 5;

        // Timer Status Indicator
        this.timerStatus = {
            state: 'normal',  // 'success', 'adjusting'
            lastUpdate: Date.now()
        };

        // NEW Smart Mode (IMPRISON only) - Priority-based target selection
        this.primaryTarget = {
            userid: null,
            username: null,
            appearanceTime: null,
            scheduledAttackTime: null
        };
        this.backupTarget = {
            userid: null,
            username: null,
            appearanceTime: null
        };
        this.attackTimeout = null; // Active attack timer for Smart Mode

        // Dad+ Mode (WHOIS retry logic)
        this.whoisPendingRequests = new Map(); // userid -> { retries, timestamp, timeout }
        this.whoisMaxRetries = 3;
        this.whoisTimeout = 5000; // 5 seconds timeout per request

        // AI Core (Ultra-Fast Learning)
        this.aiCore = null;
        this.aiEnabled = false;
        this.aiInitialized = false;

        // AI Chat (Mistral AI)
        this.aiChatEnabled = false; // NEW: AI Chat toggle (separate from AI Core)
        this.aiChatService = null; // Will be initialized when aiChatEnabled is true
        this.aiChatApiKey = process.env.MISTRAL_API_KEY || 'HeT8tNCQBPAvlJwVQRjwoxZKkpS9rQTu'; // Mistral API key from env or fallback

        // Planet users (for chat-based kick commands)
        this.planetUsers = new Map(); // username (lowercase) -> { userid, originalUsername }

        // Ping measurement
        this.currentPing = null; // Current measured ping in ms
        this.lastPingTime = null; // Timestamp of last successful ping measurement
        this.pingHistory = []; // Last 5 ping measurements for averaging
        this.maxPingHistory = 5;
        this.imprisonmentsSincePingMeasurement = 0; // Track imprisonments since last ping measurement
        this.pingMeasurementInterval = 5; // Re-measure ping every 5 imprisonments

        // 850 Response tracking (for 75ms wait logic)
        this.pending850Response = false; // Flag to indicate we're waiting for 850
        this.pending850Result = null; // 'SUCCESS', '3S_ERROR', or null
        this.pending850AlreadyRecorded = false; // Flag to prevent double recording of 3S_ERROR
    }

    // ==================== PING MEASUREMENT ====================

    /**
     * Record a ping measurement
     * @param {number} pingMs - Ping in milliseconds
     */
    recordPing(pingMs) {
        this.currentPing = pingMs;
        this.lastPingTime = Date.now(); // Track when ping was last measured (for reconnect throttle)
        this.pingHistory.push(pingMs);

        // Keep only last 5 measurements
        if (this.pingHistory.length > this.maxPingHistory) {
            this.pingHistory.shift();
        }

        DEBUG && console.log(`[WS${this.wsNumber}] 📡 Ping: ${pingMs}ms (avg: ${this.getAveragePing()}ms)`);
    }

    /**
     * Get average ping from recent measurements
     * @returns {number|null} - Average ping in ms, or null if no measurements
     */
    getAveragePing() {
        if (this.pingHistory.length === 0) return null;
        const sum = this.pingHistory.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.pingHistory.length);
    }

    /**
     * Get current ping (use average if available, otherwise last measurement)
     * @returns {number|null} - Ping in ms, or null if no measurements
     */
    getCurrentPing() {
        const avg = this.getAveragePing();
        if (avg !== null) return avg;
        return this.currentPing;
    }

    /**
     * Determine server context based on ping
     * @returns {string} - 'FAST', 'NORMAL', or 'SLOW'
     */
    getContextFromPing() {
        // ✅ FIX: context should reflect the user's speed preset (SLOW/NORMAL/FAST)
        // NOT the ping latency — ping is stored separately in ping_ms column
        const preset = this.config.speedPreset;
        if (preset === 'SLOW') return 'SLOW';
        if (preset === 'FAST') return 'FAST';
        return 'NORMAL'; // Default (includes '' and 'NORMAL')
    }

    /**
     * Measure ping using TCP connection to game server
     * More reliable than WebSocket PING
     */
    async measurePing() {
        return new Promise((resolve) => {
            const net = require('net');
            const startTime = Date.now();

            const socket = new net.Socket();
            socket.setTimeout(5000); // 5 second timeout

            socket.connect(6672, 'cs.mobstudio.ru', () => {
                const pingMs = Date.now() - startTime;
                socket.destroy();
                this.recordPing(pingMs);
                resolve(pingMs);
            });

            socket.on('error', (err) => {
                console.error(`[WS${this.wsNumber}] Ping measurement error:`, err.message);
                socket.destroy();
                resolve(null);
            });

            socket.on('timeout', () => {
                console.error(`[WS${this.wsNumber}] Ping measurement timeout`);
                socket.destroy();
                resolve(null);
            });
        });
    }

    /**
     * Ensure ping is measured (measure if not available)
     * Call this before using ping/context
     */
    async ensurePingMeasured() {
        // If we have recent ping data, use it
        if (this.currentPing !== null) {
            return this.currentPing;
        }

        // No ping data - measure now
        DEBUG && console.log(`[WS${this.wsNumber}] No ping data available - measuring now...`);
        const pingMs = await this.measurePing();

        if (pingMs !== null) {
            const context = this.getContextFromPing();
            DEBUG && console.log(`[WS${this.wsNumber}] 📡 Ping measured: ${pingMs}ms, context: ${context}`);

        } else {
            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Ping measurement failed`);
        }

        return pingMs;
    }

    /**
     * Check if ping should be re-measured (every N imprisonments)
     */
    async checkAndRemeasurePing() {
        this.imprisonmentsSincePingMeasurement++;

        // Re-measure every N imprisonments
        if (this.imprisonmentsSincePingMeasurement >= this.pingMeasurementInterval) {
            DEBUG && console.log(`[WS${this.wsNumber}] Re-measuring ping (${this.imprisonmentsSincePingMeasurement} imprisonments since last measurement)`);
            this.imprisonmentsSincePingMeasurement = 0;

            const pingMs = await this.measurePing();
            if (pingMs !== null) {
                const context = this.getContextFromPing();
                DEBUG && console.log(`[WS${this.wsNumber}] 📡 Ping re-measured: ${pingMs}ms, context: ${context}`);
            }
        }
    }

    // ==================== HELPER METHODS ====================

    /**
     * Parse 353 message to extract user IDs - Optimized version
     * @param {string} text - Raw 353 message
     * @returns {Array} - Array of user IDs
     */
    parse353UserIds(text) {
        // Single regex replace instead of multiple split/join operations
        const members = text.replace(/[+@:]/g, '').toLowerCase();
        const membersarr = members.split(" ");
        return membersarr.filter(item => !isNaN(item) && item !== "-" && item.length >= 6);
    }

    /**
     * Add user to target/attack tracking - Using Sets for O(1) lookups
     * @param {string} userid - User ID
     * @param {string} username - Username
     */
    addToTargetTracking(userid, username) {
        if (!this.targetids.has(userid)) {
            this.targetids.add(userid);
            this.targetnames.set(userid, username);
            this.attackids.add(userid);
            this.attacknames.set(userid, username);
            this.userAppearanceTime[userid] = Date.now();

            // Track detection time for THIS specific rival
            this.rivalDetectionTimes[userid] = Date.now();
            DEBUG && console.log(`[WS${this.wsNumber}] 🎯 Rival detected: ${username} (${userid}) at ${this.rivalDetectionTimes[userid]}`);

            return true;
        }
        return false;
    }

    parseHaaapsi(e) { return parseHaaapsi(e); }
    countOccurrences(arr, val) { return countOccurrences(arr, val); }

    // ==================== METRICS TRACKING ====================

    /**
     * Record imprisonment metric to Supabase
     * @param {string} playerName - Name of imprisoned player
     * @param {string} codeUsed - 'primary' or 'alt'
     * @param {boolean} isClanMember - Is the player a clan member
     * @param {number} timestampMs - Time in milliseconds since connection started
     * @param {boolean} isSuccess - True for success, false for 3s error
     * @param {number} timingValue - The actual timing value used (attack or defense ms)
     * @param {string} timingType - 'attack' or 'defense'
     * @param {number} pingMs - Ping in milliseconds (optional, for future use)
     * @param {string} context - Server context: 'FAST', 'NORMAL', or 'SLOW' (optional)
     * @param {string} adjustmentReason - What caused this timing: '3S_ERROR', 'SUCCESS', 'FAILURE', 'STUCK_ESCAPE', 'INIT', 'DB_INIT' (optional)
     * @param {boolean} isDefense - Defense flag: true if bot was kicked, false if bot kicked opponent (optional, default false)
     */
    async recordImprisonmentMetric(playerName, codeUsed, isClanMember, timestampMs, isSuccess = true, timingValue = null, timingType = null, pingMs = null, context = null, adjustmentReason = null, isDefense = false) {
        try {
            DEBUG && console.log(`[WS${this.wsNumber}] 📊 ========== RECORD METRIC START ==========`);
            DEBUG && console.log(`[WS${this.wsNumber}] 📊 Player: ${playerName}`);
            DEBUG && console.log(`[WS${this.wsNumber}] 📊 Metrics Enabled: ${this.config.metricsEnabled}`);
            DEBUG && console.log(`[WS${this.wsNumber}] 📊 AI Enabled: ${this.aiEnabled}`);
            DEBUG && console.log(`[WS${this.wsNumber}] 📊 Input ping: ${pingMs}, context: ${context}`);
            DEBUG && console.log(`[WS${this.wsNumber}] 📊 CALL STACK:`, new Error().stack.split('\n').slice(2, 5).join('\n'));

            // Check if metrics are enabled (auto-enable if AI is enabled)
            if (!this.config.metricsEnabled && !this.aiEnabled) {
                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Metrics disabled - skipping metric recording`);
                return;
            }

            // If AI is enabled but metrics are disabled, auto-enable metrics
            if (this.aiEnabled && !this.config.metricsEnabled) {
                DEBUG && console.log(`[WS${this.wsNumber}] 🔧 Auto-enabling metrics because AI is enabled`);
                this.config.metricsEnabled = true;
            }

            // Get user ID from config (passed from frontend)
            const userId = this.config.userId;

            if (!userId) {
                console.warn(`[WS${this.wsNumber}] ⚠️ No userId in config, skipping metric`);
                return;
            }

            DEBUG && console.log(`[WS${this.wsNumber}] 📊 User ID: ${userId}`);

            // Get adjustment reason from AI if available and not provided
            if (adjustmentReason === null && this.aiEnabled && this.aiCore) {
                adjustmentReason = this.aiCore.getAdjustmentReason();
            }

            // Only use ping/context if AI is enabled
            if (this.aiEnabled) {
                DEBUG && console.log(`[WS${this.wsNumber}] 🧠 AI is enabled - getting ping/context`);

                // Ensure ping is measured before recording
                await this.ensurePingMeasured();

                // Use measured ping if not provided
                if (pingMs === null) {
                    pingMs = this.getCurrentPing();
                    DEBUG && console.log(`[WS${this.wsNumber}] 📡 Got ping from getCurrentPing(): ${pingMs}`);
                }

                // Use context from ping if not provided
                if (context === null) {
                    context = this.getContextFromPing();
                    DEBUG && console.log(`[WS${this.wsNumber}] 🌐 Got context from getContextFromPing(): ${context}`);
                }

                DEBUG && console.log(`[WS${this.wsNumber}] ✅ Final values: ping=${pingMs}ms, context=${context}, reason=${adjustmentReason}`);

                // Check if ping should be re-measured (every N imprisonments)
                await this.checkAndRemeasurePing();
            } else {
                // AI disabled - don't use ping/context
                pingMs = null;
                context = null;
                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ AI disabled - ping/context will be NULL`);
            }

            const axios = require('axios');
            // Use dynamic backend URL from environment or default to localhost
            const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';

            DEBUG && console.log(`[WS${this.wsNumber}] 📤 Sending to API: ${backendUrl}/api/metrics/imprison`);
            DEBUG && console.log(`[WS${this.wsNumber}] 📤 Data:`, {
                userId,
                connectionNumber: this.wsNumber,
                playerName,
                timestampMs,
                isSuccess,
                timingValue,
                timingType,
                pingMs,
                context,
                adjustmentReason,
                isDefense
            });

            await axios.post(`${backendUrl}/api/metrics/imprison`, {
                userId: userId,
                connectionNumber: this.wsNumber,
                timestampMs: timestampMs,
                playerName: playerName,
                codeUsed: codeUsed,
                isClanMember: isClanMember,
                isSuccess: isSuccess,
                timingValue: timingValue,
                timingType: timingType,
                pingMs: pingMs,
                context: context,
                adjustmentReason: adjustmentReason,
                isDefense: isDefense  // NEW: Pass defense flag
            });

            const resultType = isSuccess ? '✅ SUCCESS' : (adjustmentReason === 'LEFT_EARLY' ? '🚪 LEFT_EARLY' : '❌ 3S ERROR');
            const pingInfo = pingMs ? `, ping=${pingMs}ms, context=${context}` : '';
            const reasonInfo = adjustmentReason ? `, reason=${adjustmentReason}` : '';
            DEBUG && console.log(`[WS${this.wsNumber}] ${resultType} Recorded: ${playerName} at ${timestampMs}ms (${timingValue}ms ${timingType}${pingInfo}${reasonInfo})`);
            DEBUG && console.log(`[WS${this.wsNumber}] 📊 ========== RECORD METRIC END ==========`);
        } catch (error) {
            // Don't fail the main operation if metrics fail
            console.error(`[WS${this.wsNumber}] ❌ Failed to record metric:`, error.message);
            console.error(`[WS${this.wsNumber}] ❌ Error stack:`, error.stack);
        }
    }

    /**
     * Record defense metric (when bot gets kicked and escapes)
     * Stores the ML timing value that was active when bot was kicked
     * Uses unified endpoint with isDefense=true
     */
    async recordDefenseMetric() {
        try {
            // ✅ PREVENT DUPLICATE: Check if already recorded for this prison event
            if (this.defenseMetricRecorded) {
                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️  Defense metric already recorded - skipping duplicate`);
                return;
            }

            // Check if metrics are enabled — auto-enable if AI is active (same as recordImprisonmentMetric)
            if (!this.config.metricsEnabled) {
                if (this.aiEnabled) {
                    this.config.metricsEnabled = true;
                    DEBUG && console.log(`[WS${this.wsNumber}] Auto-enabling metrics for defense metric (AI active)`);
                } else {
                    DEBUG && console.log(`[WS${this.wsNumber}] Metrics disabled - skipping defense metric`);
                    return;
                }
            }

            // Check if we have the ML timing when kicked
            if (!this.mlTimingWhenKicked) {
                DEBUG && console.log(`[WS${this.wsNumber}] No ML timing recorded when kicked - skipping defense metric`);
                return;
            }

            // Get user ID from config
            const userId = this.config.userId;
            if (!userId) {
                console.warn(`[WS${this.wsNumber}] No userId in config, skipping defense metric`);
                return;
            }

            // Get ping and context (only if AI enabled)
            let pingMs = null;
            let context = null;
            if (this.aiEnabled) {
                pingMs = this.getCurrentPing();
                context = this.getContextFromPing(); // Returns speed preset (SLOW/NORMAL/FAST)
            }

            // ✅ Use the rival who kicked us (stored when prison detected)
            const rivalName = this.rivalWhoKickedUs || this.lastTargetName || 'rival';

            // NEW: Use unified endpoint with isDefense=true
            const defenseTimingValue = this.getTimingForMetrics('defense');
            await this.recordImprisonmentMetric(
                rivalName,                           // playerName (rival who kicked you)
                'primary',                           // codeUsed
                false,                               // isClanMember
                this.mlTimingWhenKicked,             // timestampMs = measured elapsed action timing
                false,                               // isSuccess (you got kicked = failure)
                defenseTimingValue,                  // timingValue = configured defense timing (intent)
                'defense',                           // timingType
                pingMs,                              // pingMs
                context,                             // context
                'KICKED',                            // adjustmentReason
                true                                 // isDefense = TRUE (NEW)
            );

            DEBUG && console.log(`[WS${this.wsNumber}] 🛡️ Defense metric recorded: Bot used ${this.mlTimingWhenKicked}ms timing against ${rivalName} and got KICKED`);

            // ✅ MARK AS RECORDED to prevent duplicates
            // NOTE: Do NOT reset this flag here — it stays true until next prison event
            // Resetting it immediately was causing duplicate DB inserts
            this.defenseMetricRecorded = true;

            // Clear defense tracking
            this.wasKickedToPrison = false;
            this.mlTimingWhenKicked = null;
            this.rivalWhoKickedUs = null;

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Failed to record defense metric:`, error.message);
        }
    }

    /**
     * Check if user is in bot's gang (clan member)
     * @param {string} username - Username to check
     * @returns {boolean} - True if clan member
     */
    isUserInBotGang(username) {
        // If bot has no gang, all are rivals
        if (!this.botGangName || this.botGangName === "NO_GANG") {
            return false;
        }

        // TODO: Implement gang member detection logic
        // For now, return false (all are rivals)
        // You can enhance this by tracking gang members from 353 messages
        return false;
    }

    // ==================== SAFE WEBSOCKET OPERATIONS ====================

    /**
     * Safely send a WebSocket message with error handling
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} message - Message to send
     * @param {string} context - Context for logging (e.g., "ATTACK", "KICK")
     * @returns {boolean} - True if sent successfully, false otherwise
     */
    safeSend(ws, message, context = "MESSAGE") {
        try {
            if (!ws) {
                console.error(`[WS${this.wsNumber}] ${context} - WebSocket is null`);
                this.addLog(this.wsNumber, `❌ ${context} failed - No connection`);
                return false;
            }

            if (ws.readyState !== ws.OPEN) {
                console.error(`[WS${this.wsNumber}] ${context} - WebSocket not open (state: ${ws.readyState})`);
                this.addLog(this.wsNumber, `❌ ${context} failed - Connection not ready`);
                return false;
            }

            ws.send(message);
            DEBUG && console.log(`[WS${this.wsNumber}] ${context} - Sent: ${message.substring(0, 50)}`);
            return true;

        } catch (error) {
            console.error(`[WS${this.wsNumber}] ${context} - Send error:`, error.message);
            this.addLog(this.wsNumber, `❌ ${context} failed - ${error.message}`);
            return false;
        }
    }

    /**
     * Send WHOIS request with retry logic for Dad+ mode
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} userid - User ID to query
     * @param {number} retryCount - Current retry attempt
     */
    sendWhoisWithRetry(ws, userid, retryCount = 0) {
        try {
            if (!userid || userid === this.useridg || userid === this.founderUserId) {
                return;
            }

            // Check if already pending
            if (this.whoisPendingRequests.has(userid)) {
                const existing = this.whoisPendingRequests.get(userid);
                DEBUG && console.log(`[WS${this.wsNumber}] WHOIS for ${userid} already pending (retry ${existing.retries})`);
                return;
            }

            // Send WHOIS request
            const sent = this.safeSend(ws, `WHOIS ${userid}\r\n`, "WHOIS");

            if (!sent) {
                console.error(`[WS${this.wsNumber}] Failed to send WHOIS for ${userid}`);
                return;
            }

            // Track pending request
            const timeoutId = setTimeout(() => {
                if (this.whoisPendingRequests.has(userid)) {
                    const request = this.whoisPendingRequests.get(userid);
                    DEBUG && console.log(`[WS${this.wsNumber}] WHOIS timeout for ${userid} (retry ${request.retries}/${this.whoisMaxRetries})`);

                    // Remove from pending
                    this.whoisPendingRequests.delete(userid);

                    // Retry if under limit
                    if (request.retries < this.whoisMaxRetries) {
                        DEBUG && console.log(`[WS${this.wsNumber}] Retrying WHOIS for ${userid}...`);
                        setTimeout(() => {
                            this.sendWhoisWithRetry(ws, userid, request.retries + 1);
                        }, 1000); // Wait 1 second before retry
                    } else {
                        console.error(`[WS${this.wsNumber}] WHOIS for ${userid} failed after ${this.whoisMaxRetries} retries`);
                        this.addLog(this.wsNumber, `⚠️ Dad+ check failed for user ${userid}`);
                    }
                }
            }, this.whoisTimeout);

            this.whoisPendingRequests.set(userid, {
                retries: retryCount,
                timestamp: Date.now(),
                timeout: timeoutId
            });

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in sendWhoisWithRetry:`, error);
        }
    }

    /**
     * Mark WHOIS request as completed (call when 860 response received)
     * @param {string} userid - User ID that was queried
     */
    completeWhoisRequest(userid) {
        if (this.whoisPendingRequests.has(userid)) {
            const request = this.whoisPendingRequests.get(userid);
            clearTimeout(request.timeout);
            this.whoisPendingRequests.delete(userid);
            DEBUG && console.log(`[WS${this.wsNumber}] WHOIS completed for ${userid}`);
        }
    }

    /**
     * Save shouldRejoinPlanet flag to appState (persists across reconnections)
     * @param {boolean} value - Value to set
     */
    setShouldRejoinPlanet(value) {
        this.shouldRejoinPlanet = value;
        const { appState } = require("../config/appState");
        const flagKey = `shouldRejoinPlanet${this.wsNumber}`;
        appState.gameState[flagKey] = value;
        DEBUG && console.log(`[WS${this.wsNumber}] setShouldRejoinPlanet: ${value} (saved to appState)`);
    }

    resetState() {
        this.haaapsi = null;
        this.userFound = false;
        this.status = "";
        this.threesec = false;
        this.targetids.clear();
        this.targetnames.clear();
        this.attackids.clear();
        this.attacknames.clear();
        this.useridattack = "";
        this.useridtarget = null;

        // Reset bot gang detection on disconnect
        this.botGangName = null;

        // Reset metrics tracking
        this.rivalDetectedTime = null;
        this.currentTargetName = null;
        this.rivalDetectionTimes = {}; // Clear all detection times on reconnect
        this.actionSentTime = null; // Clear action sent time

        // Reset pending 850 flags — prevents stuck state if connection drops mid-attack
        this.pending850Response = false;
        this.pending850Result = null;
        this.pending850AlreadyRecorded = false;

        // Clear userAppearanceTime fully on reconnect
        this.userAppearanceTime = {};

        // Reset prison detection flags
        this.prisonConfirmed = false;
        this.escapeInProgress = false;
        this.defenseMetricRecorded = false; // Reset defense metric flag on reconnect
        this.escapeRetryCount = 0; // Reset escape retry counter on reconnect
        // Note: Don't reset shouldRejoinPlanet here - it needs to persist until message 999;

        // Reset NEW Smart Mode (IMPRISON only)
        this.primaryTarget = { userid: null, username: null, appearanceTime: null, scheduledAttackTime: null };
        this.backupTarget = { userid: null, username: null, appearanceTime: null };
        if (this.attackTimeout) {
            clearTimeout(this.attackTimeout);
            this.attackTimeout = null;
        }

        if (this.timeout) { clearTimeout(this.timeout); this.timeout = null; }
        if (this.reconnectTimeoutId) { clearTimeout(this.reconnectTimeoutId); this.reconnectTimeoutId = null; }

        // Clear nested timeouts
        if (this.innerTimeouts && this.innerTimeouts.length > 0) {
            this.innerTimeouts.forEach(t => clearTimeout(t));
            this.innerTimeouts = [];
        }

        // Clear pending WHOIS requests
        if (this.whoisPendingRequests && this.whoisPendingRequests.size > 0) {
            this.whoisPendingRequests.forEach((request, userid) => {
                clearTimeout(request.timeout);
            });
            this.whoisPendingRequests.clear();
        }

        // Note: this.founderUserId persists across reconnects (loaded from file)
        // Note: this.currentPing and this.pingHistory persist across reconnects (for AI continuity)

        this.isOffSleepActive = false;
        this.consecutiveErrors = 0;
        this.consecutiveSuccesses = 0;
    }

    // ==================== TIMER SHIFT LOGIC ====================
    getAdaptiveStepSize(baseStep) {
        if (this.consecutiveErrors >= 5) return baseStep * 5;
        if (this.consecutiveErrors >= 3) return baseStep * 3;
        if (this.consecutiveErrors >= 2) return baseStep * 2;
        return baseStep;
    }

    isOscillating() {
        if (this.recentAdjustments.length < 4) return false;
        for (let i = 1; i < this.recentAdjustments.length; i++) {
            const curr = this.recentAdjustments[i];
            const prev = this.recentAdjustments[i - 1];
            if ((curr > 0 && prev > 0) || (curr < 0 && prev < 0)) return false;
        }
        return true;
    }

    trackAdjustment(value) {
        this.recentAdjustments.push(value);
        if (this.recentAdjustments.length > this.maxAdjustmentHistory) this.recentAdjustments.shift();
    }

    getTiming(mode) {
        // If AI is enabled and initialized, use AI timing
        if (this.aiEnabled && this.aiCore && this.aiCore.currentTiming) {
            // Sync speed preset from config if it changed at runtime
            const configPreset = this.config.speedPreset || '';
            if (this.aiCore.speedPreset !== configPreset) {
                this.aiCore.setSpeedPreset(configPreset);
            }
            // 🎲 Use jitter+oscillation method if available (both attack AND defense)
            if (this.aiCore.getTimingWithJitter) {
                const timing = this.aiCore.getTimingWithJitter(mode);
                DEBUG && console.log(`[WS${this.wsNumber}] 🧠 AI timing: ${timing}ms (${mode}, base=${this.aiCore.currentTiming}ms)`);
                fileLogger.log('AI-FIRE', `firing=${timing}ms | base=${this.aiCore.currentTiming}ms | mode=${mode} | preset=${this.aiCore.speedPreset || 'none'} | rival=${this.aiCore.currentRivalName || '?'}`, this.wsNumber);
                return timing;
            }
            DEBUG && console.log(`[WS${this.wsNumber}] 🧠 AI timing: ${this.aiCore.currentTiming}ms (${mode})`);
            fileLogger.aiStatus(this.wsNumber, `AI timing: ${this.aiCore.currentTiming}ms (${mode})`);
            return this.aiCore.currentTiming;
        }

        // Otherwise use manual config timing
        const manualTiming = mode === "defense" ?
            parseInt(this.config[`waiting${this.wsNumber}`] || 1910) :
            parseInt(this.config[`attack${this.wsNumber}`] || 1940);
        DEBUG && console.log(`[WS${this.wsNumber}] 📋 Manual timing: ${manualTiming}ms (${mode}, AI disabled)`);
        return manualTiming;
    }

    /**
     * Get the base timing for metrics/DB recording only — NO jitter, NO AI-FIRE log.
     * Use this wherever getTiming() is called purely to store timingValue in DB.
     */
    getTimingForMetrics(mode) {
        if (this.aiEnabled && this.aiCore && this.aiCore.currentTiming) {
            // Return mode-specific base timing (no jitter, no oscillation, no logging)
            const modeTiming = mode === 'defense'
                ? (this.aiCore.defenseTiming || this.aiCore.currentTiming)
                : (this.aiCore.attackTiming || this.aiCore.currentTiming);
            return modeTiming;
        }
        // Manual mode
        return mode === "defense"
            ? parseInt(this.config[`waiting${this.wsNumber}`] || 1910)
            : parseInt(this.config[`attack${this.wsNumber}`] || 1940);
    }

    /**
     * Initialize AI Core (Simple AI Core)
     */
    async initializeAI(supabaseUrl, supabaseKey) {
        try {
            if (!this.config.userId) {
                throw new Error('Cannot initialize AI: No userId');
            }

            DEBUG && console.log(`[WS${this.wsNumber}] 🧠 Initializing Simple AI Core...`);

            // Measure ping immediately when AI is enabled
            DEBUG && console.log(`[WS${this.wsNumber}] Measuring ping for AI initialization...`);
            await this.ensurePingMeasured();

            // Create Simple AI Core
            this.aiCore = new SimpleAICore(
                this.config.supabase,
                this.config.userId,
                this.wsNumber,
                this.config.connectionNumber
            );

            // Apply speed preset from config (SLOW/NORMAL/FAST bounds)
            if (this.config.speedPreset) {
                this.aiCore.setSpeedPreset(this.config.speedPreset);
            }

            // Get optimal timing
            await this.aiCore.getOptimalTiming('attack');

            this.aiEnabled = true;
            this.aiInitialized = true;

            const ping = this.getCurrentPing();
            const stats = this.aiCore.getStats();
            DEBUG && console.log(`[WS${this.wsNumber}] ✅ Simple AI initialized: ${this.aiCore.currentTiming}ms`);
            DEBUG && console.log(`   Success Rate: ${stats.successRate}%, Ping: ${ping}ms`);


            return true;
        } catch (error) {
            console.error(`[WS${this.wsNumber}] ❌ AI initialization failed:`, error.message);
            this.aiEnabled = false;
            this.aiInitialized = false;
            return false;
        }
    }

    /**
     * Learn from attempt result (AI Core)
     */
    async learnFromResult(result, opponentLeftTime = null) {
        if (!this.aiEnabled || !this.aiCore) {
            return;
        }

        // Guard: never feed LEFT_EARLY with a trap/bait timing to ML
        // A rival leaving at <1775ms is not a real timing signal — it corrupts ML state
        if (result === 'LEFT_EARLY' && opponentLeftTime !== null && opponentLeftTime < 1775) {
            fileLogger.log('AI-LEARN', `BLOCKED LEFT_EARLY: opponentLeftAt=${opponentLeftTime}ms < 1775ms (trap/bait) — ML not updated`, this.wsNumber);
            return;
        }

        try {
            // Determine result type (pass through as-is: SUCCESS, 3S_ERROR, or FAILURE)
            const resultType = result; // Don't map, use actual result

            // ✅ Enhanced logging for LEFT_EARLY
            if (resultType === 'LEFT_EARLY') {
                DEBUG && console.log(`[WS${this.wsNumber}] ========================================`);
                DEBUG && console.log(`[WS${this.wsNumber}] 🧠 AI LEARNING: LEFT_EARLY`);
                DEBUG && console.log(`[WS${this.wsNumber}] 🧠 Opponent left at: ${opponentLeftTime}ms`);
                DEBUG && console.log(`[WS${this.wsNumber}] 🧠 Current timing: ${this.aiCore.currentTiming}ms`);
                DEBUG && console.log(`[WS${this.wsNumber}] ========================================`);
            }

            // Determine timing type (attack or defense)
            // Use primaryTarget.timingMode if available (most accurate),
            // fall back to this.status, then default to 'attack'
            const timingType = (this.primaryTarget && this.primaryTarget.timingMode)
                ? this.primaryTarget.timingMode
                : (this.status === 'attack' || this.status === 'defense')
                    ? this.status
                    : 'attack';


            // Get next timing from AI
            fileLogger.log('AI-LEARN', `feeding result=${resultType} | type=${timingType} | opponentLeftAt=${opponentLeftTime || 'n/a'}ms | currentTiming=${this.aiCore.currentTiming}ms`, this.wsNumber);
            const nextTiming = await this.aiCore.getNextTiming(resultType, timingType, opponentLeftTime);

            // NOTE: getNextTiming() already updates this.aiCore.currentTiming internally
            // No need to update it again here

            // Get stats
            try {
                const stats = this.aiCore.getStats();
                DEBUG && console.log(`[WS${this.wsNumber}] 🧠 AI learned: ${resultType} (${timingType}) → Next: ${nextTiming}ms (Success: ${stats.successRate}%)`);
                fileLogger.log('AI-NEXT', `next=${nextTiming}ms | successRate=${stats.successRate}% | total=${stats.totalAttempts} | success=${stats.successCount} | kicked=${stats.kickedCount} | errors=${stats.errorCount}`, this.wsNumber);

            } catch (statsError) {
                DEBUG && console.log(`[WS${this.wsNumber}] 🧠 AI learned: ${resultType} (${timingType}) → Next: ${nextTiming}ms`);
                fileLogger.log('AI-NEXT', `next=${nextTiming}ms`, this.wsNumber);

            }

        } catch (error) {
            console.error(`[WS${this.wsNumber}] ❌ AI learning error:`, error);
        }
    }

    getTimingLabel(mode) {
        if (this.config.timershift) {
            return mode === "defense" ? "Auto Defense" : "Auto Attack";
        } else {
            return mode === "defense" ? "Defense" : "Attack";
        }
    }

    incrementAttack() { this._adjustTiming(`attack${this.wsNumber}`, true); }
    decrementAttack() { this._adjustTiming(`attack${this.wsNumber}`, false); }
    incrementDefence() { this._adjustTiming(`waiting${this.wsNumber}`, true); }
    decrementDefence() { this._adjustTiming(`waiting${this.wsNumber}`, false); }

    _adjustTiming(key, increment) {
        if (!this.config.timershift) return;
        let value = parseInt(this.config[key] || 1940);
        const baseVal = parseInt(this.config.incrementvalue || 10);
        const decrementVal = parseInt(this.config.decrementvalue || 10);

        // Get min/max bounds for AUTO INTERVAL cycling
        const isAttack = key.startsWith('attack');
        const rawMin = parseInt(isAttack ? this.config.minatk : this.config.mindef);
        const rawMax = parseInt(isAttack ? this.config.maxatk : this.config.maxdef);
        const minBound = (!isNaN(rawMin) && rawMin > 0) ? rawMin : 1500;
        const maxBound = (!isNaN(rawMax) && rawMax > 0) ? rawMax : 2500;

        // ✅ FIX: Capture the ORIGINAL starting value on first adjustment
        // This value is used to cycle back when hitting max/min bounds
        if (this.autoIntervalStartValues[key] === undefined) {
            this.autoIntervalStartValues[key] = value;
            DEBUG && console.log(`[WS${this.wsNumber}] 🔄 AUTO INTERVAL: Captured starting value for ${key}: ${value}ms`);
        }
        const startingPoint = this.autoIntervalStartValues[key];

        // Calculate step size
        let step;
        if (increment) {
            step = this.getAdaptiveStepSize(baseVal);
        } else {
            step = decrementVal; // Use smaller steps for decrement (more conservative)
        }

        // Reduce step size if oscillating
        if (this.isOscillating()) {
            step = Math.max(1, Math.floor(step / 2));

        }

        if (increment) {
            // 3S_ERROR: Increase timing (bot was too fast)
            value += step;
            if (value > maxBound) {
                // AUTO INTERVAL CYCLING: When exceeding max, cycle back to starting point
                value = startingPoint;
                this.config[key] = value;
                this.updateConfig(key, value);


                // Update timer status
                this.timerStatus.state = 'adjusting';
                this.timerStatus.lastUpdate = Date.now();
            } else {
                // Hard clamp — never allow a value outside bounds even if NaN slipped through
                value = Math.min(value, maxBound);
                this.config[key] = value;
                this.updateConfig(key, value);
                this.trackAdjustment(step);


                // Update timer status
                this.timerStatus.state = 'adjusting';
                this.timerStatus.lastUpdate = Date.now();
            }
        } else {
            // SUCCESS: Decrease timing (bot can try faster)
            value -= step;
            if (value < minBound) {
                // AUTO INTERVAL CYCLING: When going below min, cycle back to starting point
                value = startingPoint;
                this.config[key] = value;
                this.updateConfig(key, value);


                // Update timer status
                this.timerStatus.state = 'adjusting';
                this.timerStatus.lastUpdate = Date.now();
            } else {
                // Hard clamp — never allow a value outside bounds even if NaN slipped through
                value = Math.max(value, minBound);
                this.config[key] = value;
                this.updateConfig(key, value);
                this.trackAdjustment(-step);


                // Update timer status
                this.timerStatus.state = 'adjusting';
                this.timerStatus.lastUpdate = Date.now();
            }
        }
    }

    // ==================== NEW SMART MODE LOGIC (IMPRISON ONLY) ====================

    /**
     * Add rival to PRIMARY or BACKUP slot
     * CRITICAL: All operations are SYNCHRONOUS (atomic, no race condition)
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} rival - {userid, username, source}
     * @param {string} source - "353" or "JOIN" (determines which timing to use)
     * @param {number} messageArrivalTime - Exact timestamp when message arrived (for accurate timing)
     */
    async addToSmartModePool(ws, rival, source = "JOIN", messageArrivalTime = Date.now()) {
        // Skip if already in pool (prevent duplicates)
        if (rival.userid === this.primaryTarget.userid) {
            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Skipping duplicate: ${rival.username} already in PRIMARY`);
            return;
        }
        if (rival.userid === this.backupTarget.userid) {
            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Skipping duplicate: ${rival.username} already in BACKUP`);
            return;
        }

        // Add to available slot
        if (!this.primaryTarget.userid) {
            // PRIMARY slot empty - Set as PRIMARY
            // ✅ CRITICAL: Use messageArrivalTime (captured at ws.on('message') start)
            // This ensures we get the TRUE arrival time, not the processing time
            const now = messageArrivalTime;

            // ✅ CRITICAL: Set currentTargetName and rivalDetectedTime IMMEDIATELY
            // This is needed for LEFT_EARLY detection (when rival leaves before ACTION 3)
            this.currentTargetName = rival.username;
            this.lastTargetName = rival.username;
            this.rivalDetectedTime = now;
            DEBUG && console.log(`[WS${this.wsNumber}] 🎯 Tracking PRIMARY: ${rival.username} (detected at ${now}ms)`);

            // 🧠 AI CORE: Set current rival BEFORE getTiming so ML state (consecutive3sErrors,
            // EMA, DB preload) is ready for this rival when timing is computed.
            // SAME-rival calls return immediately, NEW-rival calls await DB preload.
            if (this.aiEnabled && this.aiCore) {
                await this.aiCore.setCurrentRival(rival.username).catch(err => {
                    console.error(`[WS${this.wsNumber}] Failed to set current rival:`, err);
                });
            }

            // ✅ CRITICAL: Use different timing based on source — AFTER rival is set
            // 353 (user list) → "defense" timing (slower, defensive positioning)
            // JOIN (new joiner) → "attack" timing (faster, aggressive targeting)
            const timingMode = source === "353" ? "defense" : "attack";
            const userTiming = this.getTiming(timingMode);

            this.primaryTarget = {
                userid: rival.userid,
                username: rival.username,
                appearanceTime: now,
                scheduledAttackTime: now + userTiming,
                source: source,  // Track source for logging
                timingMode: timingMode  // Track which timing was used
            };

            DEBUG && console.log(`[WS${this.wsNumber}] ✅ PRIMARY: ${rival.username} (${source} → ${timingMode} timing: ${userTiming}ms, arrival: ${now}ms)`);


            // Schedule attack (setTimeout is non-blocking - returns immediately)
            this.scheduleSmartModeAttack(ws, this.primaryTarget, userTiming, timingMode);

            // ✅ PRIMARY is now SET before next rival is processed
        }
        else if (!this.backupTarget.userid) {
            // PRIMARY filled, BACKUP empty - Set as BACKUP
            // ✅ CRITICAL: Use messageArrivalTime for backup as well
            this.backupTarget = {
                userid: rival.userid,
                username: rival.username,
                appearanceTime: messageArrivalTime,
                source: source  // Track source for when promoted to primary
            };

            DEBUG && console.log(`[WS${this.wsNumber}] ✅ BACKUP: ${rival.username} (${source}, waiting, arrival: ${messageArrivalTime}ms)`);


            // ✅ BACKUP is now SET before next rival is processed
        }
        else {
            // Pool full (PRIMARY + BACKUP both filled) - Ignore
            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Pool full - ignoring ${rival.username}`);
        }
    }

    /**
     * Schedule attack for Smart Mode
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} target - {userid, username, appearanceTime, scheduledAttackTime, timingMode}
     * @param {number} waitTime - Time to wait before attack (ms)
     * @param {string} timingMode - "attack" or "defense" (for status tracking)
     */
    scheduleSmartModeAttack(ws, target, waitTime, timingMode = "attack") {
        DEBUG && console.log(`[WS${this.wsNumber}] ⏰ Scheduling attack on ${target.username} in ${waitTime}ms (${timingMode} timing)`);

        // setTimeout is NON-BLOCKING - returns immediately
        // This allows next message to be processed right away
        this.attackTimeout = setTimeout(async () => {
            // CRITICAL: This callback runs in event loop
            // All operations here are SYNCHRONOUS (atomic)

            if (ws.readyState === ws.OPEN) {

                DEBUG && console.log(`[WS${this.wsNumber}] ⚔️ Imprisoning ${target.username}`);
                this.addLog(this.wsNumber, `⚔️ Imprisoning ${target.username}`);

                // Set status for timing mode
                // ✅ CRITICAL: Use the correct timing mode (attack or defense)
                this.status = timingMode;  // "attack" for JOIN, "defense" for 353

                // ✅ NOTE: currentTargetName and rivalDetectedTime are already set when PRIMARY was added
                // Only update if they're not set (shouldn't happen in normal flow)
                if (!this.currentTargetName) {
                    this.currentTargetName = target.username;
                    this.lastTargetName = target.username;
                    this.rivalDetectedTime = target.appearanceTime;
                    DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ currentTargetName was not set - setting now`);
                }

                // ✅ CRITICAL: Store when ACTION 3 was sent (for metrics)
                this.actionSentTime = Date.now();
                DEBUG && console.log(`[WS${this.wsNumber}] 📤 ACTION 3 will be sent now (actionSentTime: ${this.actionSentTime})`);

                // Send ACTION 3
                DEBUG && console.log(`[WS${this.wsNumber}] 📤 Sending ACTION 3 to ${target.userid}`);
                ws.send(`ACTION 3 ${target.userid}\r\n`);
                DEBUG && console.log(`[WS${this.wsNumber}] ✅ ACTION 3 sent successfully`);

                // File logging - Imprison action (use waitTime which is the timing used)
                fileLogger.imprison(this.wsNumber, target.username, waitTime);

                // ✅ Wait 150ms for 850 response before QUIT
                // This allows us to record the metric with actual result (success/3s/failure)
                this.pending850Response = true;
                this.pending850Result = null;
                this.pending850AlreadyRecorded = false; // Reset for this new attack round

                setTimeout(() => {
                    // After 150ms, record metric based on what we received
                    const timestampMs = this.actionSentTime - this.rivalDetectedTime;
                    const codeUsed = this.currentCodeType || 'primary';
                    const isClanMember = this.isUserInBotGang(target.username);
                    const timingType = timingMode;
                    const timingValue = waitTime;

                    let isSuccess = null;
                    let adjustmentReason = 'TIMEOUT';

                    if (this.pending850Result === 'SUCCESS') {
                        isSuccess = true;
                        adjustmentReason = 'SUCCESS'; // Explicit — don't let AI return stale previous reason
                    } else if (this.pending850Result === '3S_ERROR') {
                        isSuccess = false;
                        adjustmentReason = '3S_ERROR'; // Explicit — don't let AI return stale previous reason
                    } else {
                        // No 850 response received — skip recording entirely, 850 will arrive late and record itself
                        DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ No 850 response in 150ms - skipping timeout record, letting late 850 record`);
                        // Don't record here — just fall through to clear flags and send QUIT
                        this.pending850Response = false;
                        this.pending850Result = null;
                        this.pending850AlreadyRecorded = false; // Allow late 850 to record
                        if (ws.readyState === ws.OPEN) {
                            ws.send(`QUIT :ds\r\n`);

                        }
                        this.primaryTarget = { userid: null, username: null, appearanceTime: null, scheduledAttackTime: null };
                        this.backupTarget = { userid: null, username: null, appearanceTime: null };
                        this.attackTimeout = null;
                        return;
                    }

                    // Record metric (only if not already recorded)
                    if (!this.pending850AlreadyRecorded) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 📊 Recording metric after 150ms wait: isSuccess=${isSuccess}`);
                        this.recordImprisonmentMetric(
                            target.username,
                            codeUsed,
                            isClanMember,
                            timestampMs,
                            isSuccess,
                            timingValue,
                            timingType,
                            null,  // ping (will be fetched by method)
                            null,  // context (will be fetched by method)
                            adjustmentReason
                        ).catch(err => {
                            console.error(`[WS${this.wsNumber}] Failed to record metric:`, err);
                        });
                    } else {
                        DEBUG && console.log(`[WS${this.wsNumber}] 📊 Metric already recorded (3S_ERROR) - skipping duplicate`);
                    }

                    // Clear pending flags — mark as recorded so late-arriving 850 won't double-write
                    this.pending850Response = false;
                    this.pending850Result = null;
                    this.pending850AlreadyRecorded = true;  // Keep true — prevents late 850 double-write

                    // Now send QUIT
                    if (ws.readyState === ws.OPEN) {
                        ws.send(`QUIT :ds\r\n`);

                    }

                    // Clear pool (SYNCHRONOUS - will be repopulated on reconnect)
                    this.primaryTarget = { userid: null, username: null, appearanceTime: null, scheduledAttackTime: null };
                    this.backupTarget = { userid: null, username: null, appearanceTime: null };
                    this.attackTimeout = null;
                }, 150);

                // DON'T set shouldRejoinPlanet for IMPRISON - bot should go to Prison first
            }
        }, waitTime);

        // ✅ Function returns immediately (non-blocking)
        // Next JOIN/353 message can be processed right away
    }

    /**
     * Promote BACKUP to PRIMARY when PRIMARY leaves
     * @param {WebSocket} ws - WebSocket connection
     */
    async promoteBackupToPrimary(ws) {
        if (!this.backupTarget.userid) {
            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ No backup available - clearing primary`);
            this.primaryTarget = { userid: null, username: null, appearanceTime: null, scheduledAttackTime: null };
            return;
        }

        DEBUG && console.log(`[WS${this.wsNumber}] ⬆️ Promoting BACKUP ${this.backupTarget.username} to PRIMARY`);
        this.addLog(this.wsNumber, `⬆️ Promoting ${this.backupTarget.username} to PRIMARY`);

        // 🧠 AI CORE: Set current rival BEFORE getTiming so ML state is ready for new primary
        if (this.aiEnabled && this.aiCore) {
            await this.aiCore.setCurrentRival(this.backupTarget.username).catch(err => {
                console.error(`[WS${this.wsNumber}] Failed to set rival on backup promotion:`, err);
            });
        }

        const now = Date.now();

        // ✅ CRITICAL: Use correct timing based on backup's source — AFTER rival is set
        // If backup came from 353 → use "defense" timing
        // If backup came from JOIN → use "attack" timing
        const timingMode = this.backupTarget.source === "353" ? "defense" : "attack";
        const userTiming = this.getTiming(timingMode);

        // Calculate when backup should be attacked
        const backupScheduledTime = this.backupTarget.appearanceTime + userTiming;

        // Calculate wait time from now
        const waitTime = backupScheduledTime - now;
        // ✅ No artificial minimum — if backup's scheduled time is already past (or now),
        // fire immediately (10ms just for async scheduling). Only pad if genuinely future.
        const finalWaitTime = waitTime > 0 ? waitTime : 10;

        DEBUG && console.log(`[WS${this.wsNumber}] 📊 Backup appeared at ${this.backupTarget.appearanceTime}`);
        DEBUG && console.log(`[WS${this.wsNumber}] 📊 Backup source: ${this.backupTarget.source} → ${timingMode} timing (${userTiming}ms)`);
        DEBUG && console.log(`[WS${this.wsNumber}] 📊 Backup should be attacked at ${backupScheduledTime}`);
        DEBUG && console.log(`[WS${this.wsNumber}] 📊 Current time: ${now}`);
        DEBUG && console.log(`[WS${this.wsNumber}] 📊 Wait time: ${waitTime}ms → final: ${finalWaitTime}ms`);

        // Promote backup to primary (SYNCHRONOUS)
        this.primaryTarget = {
            userid: this.backupTarget.userid,
            username: this.backupTarget.username,
            appearanceTime: this.backupTarget.appearanceTime,
            scheduledAttackTime: backupScheduledTime,
            source: this.backupTarget.source,
            timingMode: timingMode
        };

        // Clear backup (SYNCHRONOUS)
        this.backupTarget = { userid: null, username: null, appearanceTime: null };

        // ✅ Pool state updated before next message is processed

        // Schedule attack with adjusted timing (non-blocking)
        this.scheduleSmartModeAttack(ws, this.primaryTarget, finalWaitTime, timingMode);
    }

    // ==================== 353 MESSAGE HANDLERS ====================

    /**
     * Store planet users from 353 message for chat-based kick commands
     * @param {string} text - Full 353 message text
     */
    storePlanetUsers(text) {
        try {
            // Clear previous users
            this.planetUsers.clear();

            // Parse user IDs and usernames from 353 message
            const integers = this.parse353UserIds(text);
            const members = text.replace(/[+@:]/g, '');
            const membersarr = members.toLowerCase().split(" ");

            integers.forEach((userid) => {
                const idx = membersarr.indexOf(userid);
                if (idx > 0) {
                    const username = membersarr[idx - 1];

                    // Store with lowercase key for fuzzy matching
                    this.planetUsers.set(username.toLowerCase(), {
                        userid: userid,
                        originalUsername: username
                    });
                }
            });

            DEBUG && console.log(`[WS${this.wsNumber}] 📋 Stored ${this.planetUsers.size} planet users for chat commands`);
        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error storing planet users:`, error);
        }
    }

    /**
     * Find user by fuzzy matching username
     * @param {string} searchName - Username to search for (can be partial)
     * @returns {Object|null} - {userid, originalUsername} or null if not found
     */
    findUserByName(searchName) {
        const searchLower = searchName.toLowerCase().trim();

        // Exact match first
        if (this.planetUsers.has(searchLower)) {
            return this.planetUsers.get(searchLower);
        }

        // Fuzzy match - find username that contains search string
        for (const [username, userInfo] of this.planetUsers.entries()) {
            if (username.includes(searchLower)) {
                return userInfo;
            }
        }

        // No match found
        return null;
    }

    handle353Message(ws, snippets, text, messageArrivalTime = Date.now()) {
        const planetName = snippets[3];

        DEBUG && console.log(`[WS${this.wsNumber}] 353 message received - Planet: ${planetName}`);

        // Extract bot's own gang name if not already set
        if (!this.botGangName && this.useridg) {
            // Parse the 353 message to find bot's gang
            // Format: "353 1 = PLANET :GANGNAME username userid GANGNAME username userid ..."
            // Or: "353 1 = PLANET :- username userid ..." (no gang)

            DEBUG && console.log(`[WS${this.wsNumber}] 🔍 Detecting bot gang - Bot ID: ${this.useridg}`);
            DEBUG && console.log(`[WS${this.wsNumber}] 🔍 353 message: ${text.substring(0, 300)}...`);

            // Find bot's userid in the message
            const botIdIndex = text.indexOf(this.useridg);

            if (botIdIndex !== -1) {
                DEBUG && console.log(`[WS${this.wsNumber}] 🔍 Bot found at position ${botIdIndex}`);

                // Get text before bot's userid
                const textBeforeBot = text.substring(0, botIdIndex);
                DEBUG && console.log(`[WS${this.wsNumber}] 🔍 Text before bot: ...${textBeforeBot.substring(Math.max(0, textBeforeBot.length - 100))}`);

                // Split by spaces to get tokens
                const tokens = textBeforeBot.trim().split(/\s+/);
                DEBUG && console.log(`[WS${this.wsNumber}] 🔍 Last 5 tokens before bot: ${tokens.slice(-5).join(' ')}`);

                // Work backwards from bot's position
                // Pattern: ... GANGNAME username userid
                // We want to find the token before username (which is before userid)

                // The last token should be the bot's username
                // The token before that should be the gang name (or ":-" if no gang)

                if (tokens.length >= 2) {
                    const botUsername = tokens[tokens.length - 1]; // Last token before userid
                    const gangOrSeparator = tokens[tokens.length - 2]; // Token before username

                    DEBUG && console.log(`[WS${this.wsNumber}] 🔍 Bot username: ${botUsername}`);
                    DEBUG && console.log(`[WS${this.wsNumber}] 🔍 Gang/Separator: ${gangOrSeparator}`);

                    // Check if it's a gang name or separator
                    if (gangOrSeparator === ':-' || gangOrSeparator === ':') {
                        // No gang
                        this.botGangName = "NO_GANG";
                        DEBUG && console.log(`[WS${this.wsNumber}] 🤖 Bot has no gang (separator: ${gangOrSeparator})`);

                    } else if (gangOrSeparator.match(/^[A-Z_][A-Z0-9_]*$/i)) {
                        // Looks like a gang name (alphanumeric + underscore)
                        this.botGangName = gangOrSeparator.toLowerCase();
                        DEBUG && console.log(`[WS${this.wsNumber}] 🤖 Bot's gang detected: ${this.botGangName}`);

                    } else {
                        // Unclear - might be username or something else
                        this.botGangName = "NO_GANG";
                        DEBUG && console.log(`[WS${this.wsNumber}] 🤖 Bot has no gang (unclear token: ${gangOrSeparator})`);

                    }
                } else {
                    // Not enough tokens
                    this.botGangName = "NO_GANG";
                    DEBUG && console.log(`[WS${this.wsNumber}] 🤖 Bot has no gang (not enough tokens)`);
                }
            } else {
                DEBUG && console.log(`[WS${this.wsNumber}] 🔍 Bot NOT found in 353 message`);
                // Bot not in message yet - will detect on next 353
            }
        }

        // Load founder ID from file if planet changed or not loaded yet
        if (planetName && planetName !== this.currentPlanet) {
            const savedFounderId = getFounderId(planetName);
            if (savedFounderId) {
                this.founderUserId = savedFounderId;
                DEBUG && console.log(`[WS${this.wsNumber}] Loaded founder from memory: ${savedFounderId}`);

            } else {
                // New planet without saved founder - clear previous founder
                this.founderUserId = null;
                DEBUG && console.log(`[WS${this.wsNumber}] New planet - waiting for FOUNDER message`);
            }
        }

        DEBUG && console.log(`[WS${this.wsNumber}] Founder ID: ${this.founderUserId || 'NONE'}`);


        // ==================== STORE PLANET USERS (for chat-based kick commands) ====================
        this.storePlanetUsers(text);

        // ==================== PRISON DETECTION VIA 353 MESSAGE ====================
        // Check if planet name contains "Prison" word (case-sensitive, exact match)
        if (planetName) {
            this.currentPlanet = planetName;

            // Check if planet name contains "Prison" (case-sensitive)
            const isPrisonPlanet = planetName.includes("Prison");

            if (isPrisonPlanet) {
                // CONFIRMED: We are in prison
                this.prisonConfirmed = true;
                this.inPrison = true;

                DEBUG && console.log(`[WS${this.wsNumber}] 🔴 PRISON CONFIRMED via 353 - Planet: ${planetName}`);
                this.addLog(this.wsNumber, `🔴 In Prison: ${planetName}`);

                // Trigger auto-release if enabled and not already in progress
                if (this.config.autorelease && !this.escapeInProgress) {
                    // Check escape retry limit
                    if (this.escapeRetryCount >= this.maxEscapeRetries) {
                        DEBUG && console.log(`[WS${this.wsNumber}] ❌ Max escape retries (${this.maxEscapeRetries}) reached - staying in prison`);
                        this.addLog(this.wsNumber, `❌ Escape failed after ${this.maxEscapeRetries} attempts - check recovery codes`);
                        this.addLog(this.wsNumber, `⚠️ Bot will stay in prison until manual intervention`);
                        return; // Give up - don't retry anymore
                    }

                    this.escapeInProgress = true;
                    this.escapeRetryCount++; // Increment retry counter
                    this.addLog(this.wsNumber, `🔓 Prison detected - escape attempt ${this.escapeRetryCount}/${this.maxEscapeRetries}`);
                    DEBUG && console.log(`[WS${this.wsNumber}] Triggering auto-release (attempt ${this.escapeRetryCount}/${this.maxEscapeRetries})...`);

                    // File logging
                    fileLogger.autoRelease(this.wsNumber);

                    setTimeout(async () => {
                        DEBUG && console.log(`[WS${this.wsNumber}] Calling escapeAll()...`);
                        const success = await this.escapeAll();
                        DEBUG && console.log(`[WS${this.wsNumber}] escapeAll() result: ${success}`);

                        if (success) {
                            // Rejoin target planet after escape
                            const targetPlanet = this.config.planet;
                            if (targetPlanet && ws.readyState === ws.OPEN) {
                                setTimeout(() => {
                                    if (ws.readyState === ws.OPEN) {
                                        ws.send(`JOIN ${targetPlanet}\r\n`);
                                        this.addLog(this.wsNumber, `🔄 Rejoining ${targetPlanet}`);

                                        // CRITICAL: Clear flag immediately after JOIN
                                        this.setShouldRejoinPlanet(false);
                                        DEBUG && console.log(`[WS${this.wsNumber}] Cleared shouldRejoinPlanet flag after escape JOIN`);

                                        // Reset retry counter on successful escape
                                        this.escapeRetryCount = 0;
                                        DEBUG && console.log(`[WS${this.wsNumber}] ✅ Escape successful - reset retry counter`);
                                    }
                                }, 2000);  // Reduced from 3000ms to 2000ms
                            }
                        } else {
                            this.escapeInProgress = false; // Allow retry
                            DEBUG && console.log(`[WS${this.wsNumber}] ❌ Escape failed - retry count: ${this.escapeRetryCount}/${this.maxEscapeRetries}`);
                        }
                    }, 500);  // Reduced from 1000ms to 500ms
                } else if (this.escapeInProgress) {
                    DEBUG && console.log(`[WS${this.wsNumber}] Escape already in progress - skipping duplicate attempt`);
                } else {

                    DEBUG && console.log(`[WS${this.wsNumber}] Auto-release is disabled (autorelease=${this.config.autorelease})`);
                }
            } else {
                // Not in prison - clear prison flags
                if (this.prisonConfirmed || this.inPrison) {
                    DEBUG && console.log(`[WS${this.wsNumber}] ✅ Not in prison - Planet: ${planetName}`);

                }
                this.prisonConfirmed = false;
                this.inPrison = false;
                this.escapeInProgress = false;
            }
        }

        // DEBUG: Log current config state
        DEBUG && console.log(`[WS${this.wsNumber}] 353 - Config check:`, {
            modena: this.config.modena,
            kickmode: this.config.kickmode,
            kickall: this.config.kickall,
            kickbybl: this.config.kickbybl,
            dadplus: this.config.dadplus
        });

        // Check N/A mode first - applies to ALL connections
        if (this.config.modena === true) {
            DEBUG && console.log(`[WS${this.wsNumber}] 353 - Routing to BAN mode`);

            // CRITICAL: Skip rival processing if in prison or escaping
            if (this.inPrison || this.prisonConfirmed || this.escapeInProgress) {
                DEBUG && console.log(`[WS${this.wsNumber}] 353 - In prison or escaping - skipping rival processing`);

                return; // Exit early - don't process rivals
            }

            // Check if any BAN sub-mode is enabled
            const banModeEnabled = this.config.kickall || this.config.kickbybl || this.config.dadplus;

            if (banModeEnabled) {
                this.handle353BanMode(ws, snippets, text, messageArrivalTime);
            } else {
                DEBUG && console.log(`[WS${this.wsNumber}] BAN mode enabled but no action modes selected (None) - doing nothing`);

            }
            return; // CRITICAL: Exit early - don't process other modes
        }

        // Check if any kick/imprison mode is enabled
        const kickModeEnabled = this.config.kickall || this.config.kickbybl || this.config.dadplus;
        DEBUG && console.log(`[WS${this.wsNumber}] 353 - kickModeEnabled: ${kickModeEnabled}`);

        if (kickModeEnabled) {
            // CRITICAL: Skip rival processing if in prison or escaping
            if (this.inPrison || this.prisonConfirmed || this.escapeInProgress) {
                DEBUG && console.log(`[WS${this.wsNumber}] 353 - In prison or escaping - skipping rival processing`);

                return; // Exit early - don't process rivals
            }

            // Only run kick/imprison mode handler
            DEBUG && console.log(`[WS${this.wsNumber}] 353 - Routing to Kick/Imprison mode`);
            this.handle353KickMode(ws, snippets, text, messageArrivalTime);
        } else {
            // No modes active - do nothing (removed Normal Attack Mode)
            DEBUG && console.log(`[WS${this.wsNumber}] 353 - No modes active, standing by`);
        }
    }

    // 1. BAN MODE (N/A Mode)
    handle353BanMode(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            const channelName = snippets[3];

            // Skip prison channels
            if (channelName && channelName.slice(0, 6) === "Prison") {

                return;
            }

            // Log current founder ID (from FOUNDER message - the only reliable source)
            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN - Using founder ID for filtering: ${this.founderUserId || 'NONE'}`);

            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Processing user list`);
            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode options - Everyone=${this.config.kickall}, ByBlacklist=${this.config.kickbybl}, Dad+=${this.config.dadplus}`);

            // Parse all user IDs from 353 message - Optimized
            const integers = this.parse353UserIds(text);

            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN - Found ${integers.length} user IDs`);
            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN - Self ID: ${this.useridg}, Founder ID: ${this.founderUserId || 'NONE'}`);

            // CRITICAL FIX: Parse membersarr for username lookup
            const members = text.replace(/[+@:]/g, '');
            const membersarr = members.toLowerCase().split(" ");

            // PERFORMANCE FIX: Use Set for O(1) deduplication instead of array.find()
            const usersToBanSet = new Set();
            const usersToBanMap = new Map(); // userid -> {username, reason}

            // BAN mode uses KICK whitelist (kwhitelist, kgangwhitelist)
            const whitelist = (this.config.kwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
            const gangWhitelist = (this.config.kgangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN - Whitelist users: [${whitelist.join(', ')}]`);
            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN - Whitelist clans: [${gangWhitelist.join(', ')}]`);

            // Helper function to check if user should be skipped (whitelist check)
            const shouldSkipUser = (username, gangName) => {
                // Check username whitelist
                if (whitelist.includes(username.toLowerCase())) {
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN - SKIPPING (whitelist): ${username}`);
                    this.addLog(this.wsNumber, `🛡️ Skipping whitelisted user: ${username}`);
                    return true;
                }

                // Check gang whitelist
                if (gangName && gangWhitelist.includes(gangName.toLowerCase())) {
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN - SKIPPING (gang whitelist): ${username} [${gangName}]`);
                    this.addLog(this.wsNumber, `🛡️ Skipping whitelisted clan member: ${username} [${gangName}]`);
                    return true;
                }

                return false;
            };

            // OPTION 1: Check "Everyone" mode - ban all users
            if (this.config.kickall) {
                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Everyone mode active`);

                integers.forEach((userid) => {
                    // CRITICAL: Check founder FIRST
                    if (userid === this.founderUserId) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - SKIPPING FOUNDER: ${userid}`);
                        this.addLog(this.wsNumber, `👑 Skipping planet owner: ${userid}`);
                        return;
                    }

                    // Skip self
                    if (userid === this.useridg) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping self: ${userid}`);
                        return;
                    }

                    const idx = membersarr.indexOf(userid);
                    if (idx > 0) {
                        const username = membersarr[idx - 1];

                        // Skip if username is also numeric
                        if (!isNaN(username)) return;

                        // Check whitelist (HIGHEST PRIORITY)
                        if (shouldSkipUser(username, null)) return;

                        // PERFORMANCE FIX: Use Set instead of array.find()
                        if (!usersToBanSet.has(userid)) {
                            usersToBanSet.add(userid);
                            usersToBanMap.set(userid, { username, reason: 'everyone' });
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Added user to ban (everyone): ${username} (${userid})`);
                        }
                    }
                });
            }

            // OPTION 2: Check "By Blacklist" mode (only if Everyone is not enabled)
            else if (this.config.kickbybl) {
                const data = text.replaceAll("+", "").toLowerCase();

                // BAN + Blacklist mode: Check ALL blacklists (kick + imprison)
                // Load all four blacklist types
                const kblacklist = (this.config.kblacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                const kgangblacklist = (this.config.kgangblacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                const blacklist = (this.config.blacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                const gangblacklist = (this.config.gangblacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

                // Merge all username blacklists
                const allUserBlacklists = [...kblacklist, ...blacklist];
                // Merge all gang blacklists
                const allGangBlacklists = [...kgangblacklist, ...gangblacklist];

                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Checking ALL blacklists:`);
                DEBUG && console.log(`[WS${this.wsNumber}]   - Kick Blacklist Users: [${kblacklist.join(', ')}]`);
                DEBUG && console.log(`[WS${this.wsNumber}]   - Kick Blacklist Clans: [${kgangblacklist.join(', ')}]`);
                DEBUG && console.log(`[WS${this.wsNumber}]   - Imprison Blacklist Users: [${blacklist.join(', ')}]`);
                DEBUG && console.log(`[WS${this.wsNumber}]   - Imprison Blacklist Clans: [${gangblacklist.join(', ')}]`);
                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Data: ${data.substring(0, 200)}...`);

                // Process ALL username blacklists (kick + imprison)
                allUserBlacklists.forEach((element) => {
                    // Check whitelist first (HIGHEST PRIORITY)
                    if (shouldSkipUser(element, null)) return;

                    if (element && data.includes(element)) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Found username match: ${element}`);
                        const replace = element + " ";
                        const replaced = data.replaceAll(replace, "*");
                        const arr = replaced.split("*");
                        arr.shift();

                        if (arr[0]) {
                            const userid = arr[0].split(" ")[0];
                            if (userid === this.useridg) {
                                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping self: ${userid}`);
                            } else if (userid === this.founderUserId) {
                                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping founder: ${userid}`);
                                this.addLog(this.wsNumber, `👑 Skipping BAN for planet owner: ${element}`);
                            } else if (userid && !usersToBanSet.has(userid)) {
                                usersToBanSet.add(userid);
                                usersToBanMap.set(userid, { username: element, reason: `blacklist: ${element}` });
                                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Found user to ban: ${element} (${userid})`);
                            }
                        }
                    }
                });

                // Process ALL gang blacklists (kick + imprison)
                allGangBlacklists.forEach((element) => {
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Checking gang: "${element}"`);

                    // Skip if this is bot's own gang
                    if (this.botGangName && this.botGangName !== "no_gang" && element === this.botGangName) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping bot's own gang: ${element}`);

                        return;
                    }

                    if (element && data.includes(element)) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Found gang match: ${element}`);
                        const replace = element + " ";
                        const replaced = data.replaceAll(replace, "*");
                        const arr = replaced.split("*");
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Split result: ${arr.length} parts`);
                        arr.shift();

                        for (let i = 0; i < arr.length; i++) {
                            const value = arr[i];
                            const parts = value.split(" ");
                            const userid = parts[1];
                            const username = parts[0];

                            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Gang member: username="${username}", userid="${userid}"`);

                            if (userid === this.useridg) {
                                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping self: ${userid}`);
                            } else if (userid === this.founderUserId) {
                                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping founder: ${userid}`);
                                this.addLog(this.wsNumber, `👑 Skipping BAN for planet owner in gang: ${username}`);
                            } else if (username && userid && !usersToBanSet.has(userid)) {
                                usersToBanSet.add(userid);
                                usersToBanMap.set(userid, { username, reason: `gangblacklist: ${element}` });
                                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Found gang member to ban: ${username} (${userid})`);
                            }
                        }
                    } else {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Gang "${element}" NOT found in data`);
                    }
                });
            }

            // OPTION 3: Dad+ mode - Request user info for all users to check for aura
            // Dad+ runs INDEPENDENTLY of Everyone/Blacklist modes
            if (this.config.dadplus) {
                DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting info for ${integers.length} users`);


                integers.forEach((userid, index) => {
                    if (userid === this.useridg || userid === this.founderUserId) return;

                    // Skip users already marked for ban by Everyone/Blacklist modes
                    // (Dad+ will still check them, but they're already being banned)

                    setTimeout(() => {
                        this.sendWhoisWithRetry(ws, userid);
                    }, index * 100); // Increased from 50ms to 100ms to avoid rate limiting
                });
            }

            // Ban all matched users (convert Set back to array)
            const usersToBan = Array.from(usersToBanSet).map(userid => ({
                userid,
                username: usersToBanMap.get(userid).username,
                reason: usersToBanMap.get(userid).reason
            }));

            if (usersToBan.length > 0) {
                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Banning ${usersToBan.length} user(s)`);
                this.addLog(this.wsNumber, `🚫 Banning ${usersToBan.length} user(s) instantly`);

                // ✅ BAN MODE - INSTANT execution (no timing delay)
                // Set status for 3S error handling
                this.status = "defense";

                // Ban all users INSTANTLY (no delay)
                usersToBan.forEach((user, index) => {
                    const innerTimeout = setTimeout(() => {
                        if (ws.readyState === ws.OPEN) {
                            ws.send(`BAN ${user.userid}\r\n`);
                            this.addLog(this.wsNumber, `🚫 Banning ${user.username} (${user.userid}) - ${user.reason}`);
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - Sent BAN command for ${user.userid}`);
                            fileLogger.ban(this.wsNumber, user.username, user.reason);
                        }
                        // Remove fired timeout from tracking array
                        const idx = this.innerTimeouts.indexOf(innerTimeout);
                        if (idx !== -1) this.innerTimeouts.splice(idx, 1);
                    }, index * 100);

                    this.innerTimeouts.push(innerTimeout);
                });
            } else {
                DEBUG && console.log(`[WS${this.wsNumber}] 353 BAN mode - No users to ban`);
                this.addLog(this.wsNumber, `✅ No users in blacklist found on planet`);
            }

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handle353BanMode:`, error);
        }
    }

    // 2. KICK / IMPRISON MODE
    async handle353KickMode(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            const channelName = snippets[3];

            // Skip prison channels
            if (channelName && channelName.slice(0, 6) === "Prison") {

                return;
            }

            // Log current founder ID (from FOUNDER message - the only reliable source)
            DEBUG && console.log(`[WS${this.wsNumber}] 353 - Using founder ID for filtering: ${this.founderUserId || 'NONE'}`);

            // Determine if we're in Kick or Imprison mode
            const isKickMode = this.config.kickmode === true;
            const actionType = isKickMode ? "Kick" : "Imprison";

            DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Processing user list`);
            DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} mode options - Everyone=${this.config.kickall}, ByBlacklist=${this.config.kickbybl}, Dad+=${this.config.dadplus}`);

            // Parse all user IDs from 353 message - Optimized
            const integers = this.parse353UserIds(text);

            DEBUG && console.log(`[WS${this.wsNumber}] 353 - Found ${integers.length} user IDs: [${integers.join(', ')}]`);
            DEBUG && console.log(`[WS${this.wsNumber}] 353 - Self ID: ${this.useridg}, Founder ID: ${this.founderUserId || 'NONE'}`);

            // CRITICAL FIX: Parse membersarr for username lookup
            const members = text.replace(/[+@:]/g, '');
            const membersarr = members.toLowerCase().split(" ");

            // PERFORMANCE FIX: Use Set for O(1) deduplication instead of array.find()
            const usersToActSet = new Set();
            const usersToActMap = new Map(); // userid -> {username, reason}

            // Get whitelist/blacklist based on mode
            const whitelist = isKickMode
                ? (this.config.kwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s)
                : (this.config.whitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

            const gangWhitelist = isKickMode
                ? (this.config.kgangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s)
                : (this.config.gangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

            DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} - Whitelist users: [${whitelist.join(', ')}]`);
            DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} - Whitelist clans: [${gangWhitelist.join(', ')}]`);

            // Helper function to check if user should be skipped (whitelist check)
            const shouldSkipUser = (username, gangName) => {
                // Check username whitelist
                if (whitelist.includes(username.toLowerCase())) {
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} - SKIPPING (whitelist): ${username}`);
                    this.addLog(this.wsNumber, `🛡️ Skipping whitelisted user: ${username}`);
                    return true;
                }

                // Check gang whitelist
                if (gangName && gangWhitelist.includes(gangName.toLowerCase())) {
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} - SKIPPING (gang whitelist): ${username} [${gangName}]`);
                    this.addLog(this.wsNumber, `🛡️ Skipping whitelisted clan member: ${username} [${gangName}]`);
                    return true;
                }

                return false;
            };

            // OPTION 1: Check "Everyone" mode - kick/imprison all users
            if (this.config.kickall) {
                DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Everyone mode active`);

                integers.forEach((userid) => {
                    // CRITICAL: Check founder FIRST before any processing
                    if (userid === this.founderUserId) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - SKIPPING FOUNDER: ${userid}`);
                        this.addLog(this.wsNumber, `👑 Skipping planet owner: ${userid}`);
                        return; // Skip this user completely
                    }

                    // Skip self
                    if (userid === this.useridg) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Skipping self: ${userid}`);
                        return;
                    }

                    const idx = membersarr.indexOf(userid);
                    if (idx > 0) {
                        const username = membersarr[idx - 1];

                        // Check whitelist (HIGHEST PRIORITY)
                        if (shouldSkipUser(username, null)) return;

                        // PERFORMANCE FIX: Use Set instead of array.find()
                        if (!usersToActSet.has(userid)) {
                            usersToActSet.add(userid);
                            usersToActMap.set(userid, { username, reason: 'everyone' });
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Added user (everyone): ${username} (${userid})`);
                        }
                    }
                });
            }

            // OPTION 2: Check "By Blacklist" mode (only if Everyone is not enabled)
            else if (this.config.kickbybl) {
                const data = text.replaceAll("+", "").toLowerCase();

                if (isKickMode) {
                    // KICK MODE: Use kblacklist and kgangblacklist
                    // PERFORMANCE FIX: Cache split results
                    const kblacklist = (this.config.kblacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                    const kgangblacklist = (this.config.kgangblacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Kick Blacklist Users: [${kblacklist.join(', ')}]`);
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Kick Blacklist Clans: [${kgangblacklist.join(', ')}]`);

                    // Process username blacklist
                    kblacklist.forEach((element) => {
                        // Check whitelist first (HIGHEST PRIORITY)
                        if (shouldSkipUser(element, null)) return;

                        if (element && data.includes(element)) {
                            const replace = element + " ";
                            const replaced = data.replaceAll(replace, "*");
                            const arr = replaced.split("*");
                            arr.shift();

                            if (arr[0]) {
                                const userid = arr[0].split(" ")[0];
                                // Skip self and founder
                                if (userid === this.useridg) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping self: ${userid}`);
                                } else if (userid === this.founderUserId) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping founder: ${userid}`);
                                    this.addLog(this.wsNumber, `👑 Skipping kick for planet owner: ${element}`);
                                } else if (userid && !usersToActSet.has(userid)) {
                                    usersToActSet.add(userid);
                                    usersToActMap.set(userid, { username: element, reason: `kblacklist: ${element}` });
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Found user to kick: ${element} (${userid})`);
                                }
                            }
                        }
                    });

                    // Process gang blacklist
                    kgangblacklist.forEach((element) => {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Checking gang: "${element}"`);

                        // Check gang whitelist first (HIGHEST PRIORITY)
                        if (gangWhitelist.includes(element)) {
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - SKIPPING gang (whitelist): ${element}`);
                            this.addLog(this.wsNumber, `🛡️ Skipping whitelisted clan: ${element}`);
                            return;
                        }

                        // Skip if this is bot's own gang
                        if (this.botGangName && this.botGangName !== "no_gang" && element === this.botGangName) {
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping bot's own gang: ${element}`);

                            return;
                        }

                        if (element && data.includes(element)) {
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Found gang match: ${element}`);
                            const replace = element + " ";
                            const replaced = data.replaceAll(replace, "*");
                            const arr = replaced.split("*");
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Split result: ${arr.length} parts`);
                            arr.shift();

                            for (let i = 0; i < arr.length; i++) {
                                const value = arr[i];
                                const parts = value.split(" ");
                                const userid = parts[1];
                                const username = parts[0];

                                DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Gang member: username="${username}", userid="${userid}"`);

                                // Skip self and founder
                                if (userid === this.useridg) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping self: ${userid}`);
                                } else if (userid === this.founderUserId) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping founder: ${userid}`);
                                    this.addLog(this.wsNumber, `👑 Skipping kick for planet owner in gang: ${username}`);
                                } else if (username && userid && !usersToActSet.has(userid)) {
                                    usersToActSet.add(userid);
                                    usersToActMap.set(userid, { username, reason: `kgangblacklist: ${element}` });
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Found gang member to kick: ${username} (${userid})`);
                                }
                            }
                        } else {
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Gang "${element}" NOT found in data`);
                        }
                    });
                } else {
                    // IMPRISON MODE: Use blacklist and gangblacklist
                    // PERFORMANCE FIX: Cache split results
                    const blacklist = (this.config.blacklist || "").toLowerCase().split("\n").filter(b => b.trim());
                    const gangblacklist = (this.config.gangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
                    // ✅ Load whitelist — whitelist takes HIGHEST PRIORITY over blacklist
                    const imprisonWhitelist = (this.config.whitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                    const imprisonGangWhitelist = (this.config.gangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Blacklist Users: [${blacklist.join(', ')}]`);
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Blacklist Clans: [${gangblacklist.join(', ')}]`);
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Whitelist Users: [${imprisonWhitelist.join(', ')}]`);

                    // Process username blacklist
                    blacklist.forEach((element) => {
                        if (element && data.includes(element)) {
                            const replace = element + " ";
                            const replaced = data.replaceAll(replace, "*");
                            const arr = replaced.split("*");
                            arr.shift();

                            if (arr[0]) {
                                const userid = arr[0].split(" ")[0];
                                // Skip self and founder
                                if (userid === this.useridg) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping self: ${userid}`);
                                } else if (userid === this.founderUserId) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping founder: ${userid}`);
                                    this.addLog(this.wsNumber, `👑 Skipping imprison for planet owner: ${element}`);
                                } else if (imprisonWhitelist.includes(element.toLowerCase())) {
                                    // ✅ WHITELIST CHECK: Skip whitelisted users even if in blacklist
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - SKIPPING whitelisted user: ${element}`);
                                    this.addLog(this.wsNumber, `🛡️ Skipping whitelisted user: ${element}`);
                                } else if (userid && !usersToActSet.has(userid)) {
                                    usersToActSet.add(userid);
                                    usersToActMap.set(userid, { username: element, reason: `blacklist: ${element}` });
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Found user to imprison: ${element} (${userid})`);

                                    // Track detection time for metrics
                                    this.rivalDetectionTimes[userid] = Date.now();
                                    DEBUG && console.log(`[WS${this.wsNumber}] 🎯 Rival detected: ${element} (${userid}) at ${this.rivalDetectionTimes[userid]}`);
                                }
                            }
                        }
                    });

                    // Process gang blacklist
                    gangblacklist.forEach((element) => {
                        DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Checking gang: "${element}"`);

                        // Skip if this is bot's own gang
                        if (this.botGangName && this.botGangName !== "no_gang" && element === this.botGangName) {
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping bot's own gang: ${element}`);

                            return;
                        }

                        if (element && data.includes(element)) {
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Found gang match: ${element}`);
                            const replace = element + " ";
                            const replaced = data.replaceAll(replace, "*");
                            const arr = replaced.split("*");
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Split result: ${arr.length} parts`);
                            arr.shift();

                            for (let i = 0; i < arr.length; i++) {
                                const value = arr[i];
                                const parts = value.split(" ");
                                const userid = parts[1];
                                const username = parts[0];

                                DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Gang member: username="${username}", userid="${userid}"`);

                                // Skip self and founder
                                if (userid === this.useridg) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping self: ${userid}`);
                                } else if (userid === this.founderUserId) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping founder: ${userid}`);
                                    this.addLog(this.wsNumber, `👑 Skipping imprison for planet owner in gang: ${username}`);
                                } else if (imprisonWhitelist.includes(username.toLowerCase()) || imprisonGangWhitelist.includes(element.toLowerCase())) {
                                    // ✅ WHITELIST CHECK: Skip whitelisted users/clans even if in gang blacklist
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - SKIPPING whitelisted gang member: ${username} [${element}]`);
                                    this.addLog(this.wsNumber, `🛡️ Skipping whitelisted gang member: ${username} [${element}]`);
                                } else if (username && userid && !usersToActSet.has(userid)) {
                                    usersToActSet.add(userid);
                                    usersToActMap.set(userid, { username, reason: `gangblacklist: ${element}` });
                                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Found gang member to imprison: ${username} (${userid})`);

                                    // Track detection time for metrics
                                    this.rivalDetectionTimes[userid] = Date.now();
                                    DEBUG && console.log(`[WS${this.wsNumber}] 🎯 Rival detected: ${username} (${userid}) at ${this.rivalDetectionTimes[userid]}`);
                                }
                            }
                        } else {
                            DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Gang "${element}" NOT found in data`);
                        }
                    });
                }
            }

            // OPTION 3: Dad+ mode - Request user info for all users to check for aura (independent of other modes)
            if (this.config.dadplus) {
                DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting info for ${integers.length} users`);


                integers.forEach((userid, index) => {
                    // Skip self and founder
                    if (userid === this.useridg || userid === this.founderUserId) return;

                    setTimeout(() => {
                        this.sendWhoisWithRetry(ws, userid);
                    }, index * 100); // Increased from 50ms to 100ms to avoid rate limiting
                });
            }

            // Execute actions for matched users (convert Set back to array)
            const usersToAct = Array.from(usersToActSet).map(userid => ({
                userid,
                username: usersToActMap.get(userid).username,
                reason: usersToActMap.get(userid).reason
            }));

            if (usersToAct.length > 0) {
                DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Acting on ${usersToAct.length} user(s)`);
                this.addLog(this.wsNumber, `${isKickMode ? '👢' : '⚔️'} Found ${usersToAct.length} user(s) to ${actionType.toLowerCase()}`);

                if (isKickMode) {
                    // ✅ KICK MODE - INSTANT execution (no timing delay)
                    this.addLog(this.wsNumber, `👢 Kicking ${usersToAct.length} user(s) instantly`);

                    // Set status for 3S error handling
                    this.status = "defense";

                    // Kick all users INSTANTLY (no delay)
                    usersToAct.forEach((user, index) => {
                        const innerTimeout = setTimeout(() => {
                            if (ws.readyState === ws.OPEN) {
                                ws.send(`KICK ${user.userid}\r\n`);
                                this.addLog(this.wsNumber, `👢 Kicking ${user.username} (${user.userid}) - ${user.reason}`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 353 Kick mode - Sent KICK command for ${user.userid}`);
                                fileLogger.kick(this.wsNumber, user.username, user.reason);
                            }
                            // Remove fired timeout from tracking array
                            const idx = this.innerTimeouts.indexOf(innerTimeout);
                            if (idx !== -1) this.innerTimeouts.splice(idx, 1);
                        }, index * 100);

                        this.innerTimeouts.push(innerTimeout);
                    });
                } else {
                    // ⚠️ IMPRISON MODE - NEW SMART MODE (pool system)
                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Using NEW Smart Mode (PRIMARY + BACKUP)`);


                    // File logging - Smart Mode activation
                    fileLogger.smartMode(this.wsNumber, 'Pool processing', `${usersToAct.length} rivals from 353`);

                    // CRITICAL: Process each rival SEQUENTIALLY through pool
                    // Must await each call so setCurrentRival completes before getTiming is called
                    for (const user of usersToAct) {
                        await this.addToSmartModePool(ws, {
                            userid: user.userid,
                            username: user.username
                        }, "353", messageArrivalTime);
                    }

                    // Result after loop:
                    // - First rival → PRIMARY (scheduled for attack with DEFENSE timing)
                    // - Second rival → BACKUP (waiting)
                    // - Additional rivals → IGNORED (pool full)

                    DEBUG && console.log(`[WS${this.wsNumber}] 353 Imprison mode - Pool filled: PRIMARY=${this.primaryTarget.username || 'NONE'}, BACKUP=${this.backupTarget.username || 'NONE'}`);
                }
            } else {
                DEBUG && console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - No users to ${actionType.toLowerCase()}`);
                this.addLog(this.wsNumber, `✅ No users in blacklist found on planet`);
            }

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handle353KickMode:`, error);
        }
    }

    // 3. LOW SEC MODE
    // ==================== JOIN HANDLERS ====================

    handleJoinMessage(ws, snippets, text, messageArrivalTime = Date.now()) {
        // DEBUG: Log current config state
        DEBUG && console.log(`[WS${this.wsNumber}] JOIN - Config check:`, {
            modena: this.config.modena,
            lowsecmode: this.config.lowsecmode,
            kickmode: this.config.kickmode,
            kickall: this.config.kickall,
            kickbybl: this.config.kickbybl,
            dadplus: this.config.dadplus
        });
        DEBUG && console.log(`[WS${this.wsNumber}] JOIN - Founder ID: ${this.founderUserId || 'NONE'}`);

        // Founder ID already loaded from file in handle353Message
        // Process immediately - no buffering needed!

        // Check N/A mode first - applies to ALL connections
        if (this.config.modena === true) {
            DEBUG && console.log(`[WS${this.wsNumber}] JOIN - Routing to BAN mode`);

            // CRITICAL: Skip rival processing if in prison or escaping
            if (this.inPrison || this.prisonConfirmed || this.escapeInProgress) {
                DEBUG && console.log(`[WS${this.wsNumber}] JOIN - In prison or escaping - skipping rival processing`);

                return; // Exit early - don't process rivals
            }

            // Check if any BAN sub-mode is enabled
            const banModeEnabled = this.config.kickall || this.config.kickbybl || this.config.dadplus;

            if (banModeEnabled) {
                this.handleJoinBanMode(ws, snippets, text, messageArrivalTime);
            } else {
                DEBUG && console.log(`[WS${this.wsNumber}] BAN mode enabled but no action modes selected (None) - doing nothing`);
            }
            return; // CRITICAL: Exit early - don't process other modes
        }

        // Check Low Sec mode
        if (this.config.lowsecmode) {
            DEBUG && console.log(`[WS${this.wsNumber}] JOIN - Routing to Low Sec mode`);
            this.handleJoinLowSec(ws, snippets, text);
            return;
        }

        // Check if any kick/imprison mode is enabled
        const kickModeEnabled = this.config.kickall || this.config.kickbybl || this.config.dadplus;
        DEBUG && console.log(`[WS${this.wsNumber}] JOIN - kickModeEnabled: ${kickModeEnabled}`);

        if (kickModeEnabled) {
            // CRITICAL: Skip rival processing if in prison or escaping
            if (this.inPrison || this.prisonConfirmed || this.escapeInProgress) {
                DEBUG && console.log(`[WS${this.wsNumber}] JOIN - In prison or escaping - skipping rival processing`);

                return; // Exit early - don't process rivals
            }

            // Kick/Imprison modes handle JOIN messages via handleJoinKickMode
            DEBUG && console.log(`[WS${this.wsNumber}] JOIN - Routing to Kick/Imprison mode`);
            this.handleJoinKickMode(ws, snippets, text, messageArrivalTime);
            return;
        }

        // If kickmode=true but no modes enabled, do nothing
        if (this.config.kickmode) {
            DEBUG && console.log(`[WS${this.wsNumber}] Kick mode enabled but no action modes selected - doing nothing`);
            return;
        }

        // No modes active - do nothing (removed Normal Attack Mode and Defense Mode)
        DEBUG && console.log(`[WS${this.wsNumber}] No modes active - standing by`);
    }

    async handleJoinKickMode(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            // Parse JOIN message format: "JOIN <channel> <username> <userid> ..."
            const parts = text.split(" ");
            let username = "";
            let userid = "";
            let channel = "";

            if (parts.length >= 4) {
                channel = parts[1] ? parts[1].toLowerCase() : "";
                username = parts[2] ? parts[2].toLowerCase().replace('@', '') : "";
                userid = parts[3] || "";
            }

            if (!userid || !username) return;

            // Skip self
            if (userid === this.useridg) return;

            // Skip ONLY planet founder (NOT supervisors)
            if (userid === this.founderUserId) {
                DEBUG && console.log(`[WS${this.wsNumber}] Skipping action for planet founder ${userid}`);
                this.addLog(this.wsNumber, `👑 Skipping planet owner`);
                return;
            }

            // Determine if we're in Kick or Imprison mode
            const isKickMode = this.config.kickmode === true;
            const actionType = isKickMode ? "Kick" : "Imprison";

            // Get whitelist based on mode
            const whitelist = isKickMode
                ? (this.config.kwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s)
                : (this.config.whitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

            const gangWhitelist = isKickMode
                ? (this.config.kgangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s)
                : (this.config.gangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

            // Check whitelist FIRST (HIGHEST PRIORITY)
            if (whitelist.includes(username)) {
                DEBUG && console.log(`[WS${this.wsNumber}] JOIN ${actionType} - SKIPPING (whitelist): ${username}`);
                this.addLog(this.wsNumber, `🛡️ Skipping whitelisted user: ${username}`);

                // File logging
                fileLogger.whitelist(this.wsNumber, username, 'Skipped');
                return;
            }

            // Check gang whitelist
            if (channel && gangWhitelist.includes(channel)) {
                DEBUG && console.log(`[WS${this.wsNumber}] JOIN ${actionType} - SKIPPING (gang whitelist): ${username} [${channel}]`);
                this.addLog(this.wsNumber, `🛡️ Skipping whitelisted clan member: ${username} [${channel}]`);

                // File logging
                fileLogger.whitelist(this.wsNumber, `${username} [${channel}]`, 'Skipped');
                return;
            }

            let shouldAct = false;
            let reason = "";

            // Check "Everyone" mode - kick/imprison everyone
            if (this.config.kickall) {
                shouldAct = true;
                reason = "everyone";
            }

            // Dad+ mode - request user info to check for aura
            if (this.config.dadplus && !shouldAct) {
                DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting user info for ${userid}`);
                this.sendWhoisWithRetry(ws, userid);
            }

            // Check "By Blacklist" mode
            if (!shouldAct && this.config.kickbybl) {
                if (isKickMode) {
                    // KICK MODE: Use kblacklist and kgangblacklist
                    const kblacklist = (this.config.kblacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                    for (const blocked of kblacklist) {
                        if (blocked && username.includes(blocked)) {
                            shouldAct = true;
                            reason = `kblacklist: ${blocked}`;
                            break;
                        }
                    }

                    if (!shouldAct) {
                        const kgangblacklist = (this.config.kgangblacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                        for (const gang of kgangblacklist) {
                            // IMPORTANT: Skip if this gang is bot's own gang
                            if (this.botGangName && this.botGangName !== "no_gang" && gang === this.botGangName) {
                                DEBUG && console.log(`[WS${this.wsNumber}] JOIN Kick - Skipping bot's own gang in blacklist: ${gang}`);

                                continue; // Skip to next gang in blacklist
                            }

                            // Check if user belongs to this blacklisted gang
                            // User's gang is in the channel field
                            if (gang && channel === gang) {
                                DEBUG && console.log(`[WS${this.wsNumber}] JOIN Kick - User ${username} belongs to blacklisted gang: ${gang}`);
                                shouldAct = true;
                                reason = `kgangblacklist: ${gang}`;
                                break;
                            }
                        }
                    }
                } else {
                    // IMPRISON MODE: Use blacklist and gangblacklist
                    const blacklist = (this.config.blacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                    for (const blocked of blacklist) {
                        if (blocked && username.includes(blocked)) {
                            shouldAct = true;
                            reason = `blacklist: ${blocked}`;
                            break;
                        }
                    }

                    if (!shouldAct) {
                        const gangblacklist = (this.config.gangblacklist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
                        for (const gang of gangblacklist) {
                            // IMPORTANT: Skip if this gang is bot's own gang
                            if (this.botGangName && this.botGangName !== "no_gang" && gang === this.botGangName) {
                                DEBUG && console.log(`[WS${this.wsNumber}] JOIN Imprison - Skipping bot's own gang in blacklist: ${gang}`);

                                continue; // Skip to next gang in blacklist
                            }

                            // Check if user belongs to this blacklisted gang
                            // User's gang is in the channel field
                            if (gang && channel === gang) {
                                DEBUG && console.log(`[WS${this.wsNumber}] JOIN Imprison - User ${username} belongs to blacklisted gang: ${gang}`);
                                shouldAct = true;
                                reason = `gangblacklist: ${gang}`;
                                break;
                            }
                        }
                    }
                }
            }

            // Execute action if conditions met
            if (shouldAct) {
                if (isKickMode) {
                    // ✅ KICK MODE - INSTANT execution (no timing delay)
                    this.addLog(this.wsNumber, `👢 Kicking ${username} instantly`);

                    // Set status for 3S error handling
                    this.status = "attack";
                    this.currentTargetName = username;
                    this.lastTargetName = username;
                    this.rivalDetectedTime = Date.now();

                    // Kick INSTANTLY (no delay)
                    if (ws.readyState === ws.OPEN) {
                        this.addLog(this.wsNumber, `👢 Kicking ${username} (${userid}) - Reason: ${reason}`);
                        ws.send(`KICK ${userid}\r\n`);
                        DEBUG && console.log(`[WS${this.wsNumber}] JOIN Kick mode - Sent KICK command for ${userid}`);

                        // File logging
                        fileLogger.kick(this.wsNumber, username, reason);
                    }
                } else {
                    // ⚠️ IMPRISON MODE - NEW SMART MODE (add to pool)
                    DEBUG && console.log(`[WS${this.wsNumber}] JOIN Imprison mode - Adding ${username} to Smart Mode pool`);
                    this.addLog(this.wsNumber, `🎯 Smart Mode: ${username} (${reason})`);

                    // File logging - Smart Mode target added
                    fileLogger.smartMode(this.wsNumber, 'Target added', `${username} (${reason})`);

                    // Must await so setCurrentRival completes before getTiming is called
                    await this.addToSmartModePool(ws, {
                        userid: userid,
                        username: username
                    }, "JOIN", messageArrivalTime);

                    // ✅ Pool state updated before next message arrives
                    DEBUG && console.log(`[WS${this.wsNumber}] JOIN Imprison mode - Pool status: PRIMARY=${this.primaryTarget.username || 'NONE'}, BACKUP=${this.backupTarget.username || 'NONE'}`);
                }
            }

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handleJoinKickMode:`, error);
        }
    }

    handleJoinBanMode(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            DEBUG && console.log(`[WS${this.wsNumber}] BAN mode handler called`);
            DEBUG && console.log(`[WS${this.wsNumber}] BAN mode options - Everyone=${this.config.kickall}, ByBlacklist=${this.config.kickbybl}, Dad+=${this.config.dadplus}`);

            // Parse JOIN message format: "JOIN <channel> <username> <userid> ..."
            const parts = text.split(" ");
            let username = "";
            let userid = "";
            let channel = "";

            if (parts.length >= 4) {
                channel = parts[1] ? parts[1].toLowerCase() : "";
                username = parts[2] ? parts[2].toLowerCase() : "";
                userid = parts[3] || "";
            }

            DEBUG && console.log(`[WS${this.wsNumber}] BAN mode - checking user: ${username} (${userid})`);

            if (!userid || !username) return;

            // Skip self
            if (userid === this.useridg) {
                DEBUG && console.log(`[WS${this.wsNumber}] Skipping self in BAN mode`);
                return;
            }

            // Skip planet founder
            if (userid === this.founderUserId) {
                DEBUG && console.log(`[WS${this.wsNumber}] Skipping BAN for planet founder ${userid}`);
                this.addLog(this.wsNumber, `👑 Skipping BAN for planet owner`);
                return;
            }

            // BAN mode uses KICK whitelist (kwhitelist, kgangwhitelist)
            const whitelist = (this.config.kwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);
            const gangWhitelist = (this.config.kgangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

            // Check whitelist FIRST (HIGHEST PRIORITY)
            if (whitelist.includes(username)) {
                DEBUG && console.log(`[WS${this.wsNumber}] JOIN BAN - SKIPPING (whitelist): ${username}`);
                this.addLog(this.wsNumber, `🛡️ Skipping whitelisted user: ${username}`);

                // File logging
                fileLogger.whitelist(this.wsNumber, username, 'Skipped');
                return;
            }

            // Check gang whitelist
            if (channel && gangWhitelist.includes(channel)) {
                DEBUG && console.log(`[WS${this.wsNumber}] JOIN BAN - SKIPPING (gang whitelist): ${username} [${channel}]`);
                this.addLog(this.wsNumber, `🛡️ Skipping whitelisted clan member: ${username} [${channel}]`);

                // File logging
                fileLogger.whitelist(this.wsNumber, `${username} [${channel}]`, 'Skipped');
                return;
            }

            let shouldBan = false;
            let reason = "";

            // Check "Everyone" mode - ban everyone
            if (this.config.kickall) {
                shouldBan = true;
                reason = "everyone";
                DEBUG && console.log(`[WS${this.wsNumber}] BAN mode - Everyone mode active, banning all users`);
            }

            // Check "By Blacklist" mode - Check ALL blacklists (kick + imprison)
            if (!shouldBan && this.config.kickbybl) {
                // Load all four blacklist types
                const kblacklist = (this.config.kblacklist || "").toLowerCase().split("\n").filter(k => k.trim());
                const kgangblacklist = (this.config.kgangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
                const blacklist = (this.config.blacklist || "").toLowerCase().split("\n").filter(b => b.trim());
                const gangblacklist = (this.config.gangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());

                // Merge all username blacklists
                const allUserBlacklists = [...kblacklist, ...blacklist];
                // Merge all gang blacklists
                const allGangBlacklists = [...kgangblacklist, ...gangblacklist];

                DEBUG && console.log(`[WS${this.wsNumber}] BAN mode - Checking ALL blacklists:`);
                DEBUG && console.log(`[WS${this.wsNumber}]   - Kick Blacklist Users: [${kblacklist.join(', ')}]`);
                DEBUG && console.log(`[WS${this.wsNumber}]   - Kick Blacklist Clans: [${kgangblacklist.join(', ')}]`);
                DEBUG && console.log(`[WS${this.wsNumber}]   - Imprison Blacklist Users: [${blacklist.join(', ')}]`);
                DEBUG && console.log(`[WS${this.wsNumber}]   - Imprison Blacklist Clans: [${gangblacklist.join(', ')}]`);

                // Check ALL username blacklists (kick + imprison)
                for (const blocked of allUserBlacklists) {
                    if (blocked && username.includes(blocked)) {
                        shouldBan = true;
                        reason = `blacklist: ${blocked}`;
                        DEBUG && console.log(`[WS${this.wsNumber}] BAN mode - MATCH in blacklist: ${blocked}`);
                        break;
                    }
                }

                // Check ALL gang blacklists (kick + imprison)
                if (!shouldBan) {
                    for (const gang of allGangBlacklists) {
                        if (gang && username.includes(gang)) {
                            shouldBan = true;
                            reason = `gangblacklist: ${gang}`;
                            DEBUG && console.log(`[WS${this.wsNumber}] BAN mode - MATCH in gangblacklist: ${gang}`);
                            break;
                        }
                    }
                }
            }

            // Dad+ mode - request user info to check for aura
            // Dad+ runs INDEPENDENTLY of Everyone/Blacklist modes
            if (this.config.dadplus) {
                DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting user info for ${userid}`);
                this.sendWhoisWithRetry(ws, userid);
            }

            // Execute BAN if conditions met
            if (shouldBan) {
                // ✅ BAN MODE - INSTANT execution (no timing delay)
                this.addLog(this.wsNumber, `🚫 Banning ${username} instantly`);

                // Set status for 3S error handling
                this.status = "attack";
                this.currentTargetName = username;
                this.lastTargetName = username;
                this.rivalDetectedTime = Date.now();

                // Ban INSTANTLY (no delay)
                if (ws.readyState === ws.OPEN) {
                    DEBUG && console.log(`[WS${this.wsNumber}] BAN mode - Sending BAN command for ${userid}`);
                    this.addLog(this.wsNumber, `🚫 Banning ${username} (${userid}) - Reason: ${reason}`);
                    ws.send(`BAN ${userid}\r\n`);

                    // File logging
                    fileLogger.ban(this.wsNumber, username, reason);
                }
            } else {
                DEBUG && console.log(`[WS${this.wsNumber}] BAN mode - No conditions met, not banning ${username}`);
            }

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handleJoinBanMode:`, error);
        }
    }

    // ==================== HELPER METHODS ====================

    async startAttackSequence(ws, userid, name, mode, label) {
        DEBUG && console.log(`[WS${this.wsNumber}] startAttackSequence called - userid=${userid}, name=${name}, mode=${mode}, label=${label}`);
        DEBUG && console.log(`[WS${this.wsNumber}] Config: modena=${this.config.modena}, kickmode=${this.config.kickmode}`);

        this.userFound = true;
        this.useridattack = userid;
        this.useridtarget = userid;
        this.status = mode;

        // 🧠 AI CORE: Set rival name for hybrid learning (MUST AWAIT!)
        if (this.aiEnabled && this.aiCore && this.aiCore.setRivalName) {
            await this.aiCore.setRivalName(name);
        }

        const timing = this.getTiming(mode);
        const timingSource = (this.aiEnabled && this.aiCore) ? 'AI-CORE' : 'MANUAL';
        DEBUG && console.log(`[WS${this.wsNumber}] [${timingSource}] Timing: ${timing}ms (mode: ${mode}, aiEnabled: ${this.aiEnabled})`);


        // Log to file
        if (this.aiEnabled && this.aiCore) {
            fileLogger.aiStatus(this.wsNumber, `Using AI timing: ${timing}ms (${mode})`);
        }

        this.timeout = setTimeout(async () => {
            if (this.useridattack === this.founderUserId) return;
            if (ws.readyState === ws.OPEN) {

                if (this.config.modena) {
                    DEBUG && console.log(`[WS${this.wsNumber}] Sending BAN command (modena=true)`);
                    ws.send(`BAN ${userid}\r\n`);
                } else if (this.config.kickmode) {
                    DEBUG && console.log(`[WS${this.wsNumber}] Sending KICK command (kickmode=true)`);
                    ws.send(`KICK ${userid}\r\n`);
                } else {
                    DEBUG && console.log(`[WS${this.wsNumber}] Sending ACTION 3 command (imprison)`);
                    // Set current target for metrics BEFORE sending so actionSentTime is accurate
                    this.currentTargetName = name;
                    this.lastTargetName = name;
                    this.rivalDetectedTime = this.rivalDetectionTimes[userid] || Date.now();
                    this.actionSentTime = Date.now();
                    ws.send(`ACTION 3 ${userid}\r\n`);
                    this.markTargetAttacked(userid);
                    DEBUG && console.log(`[WS${this.wsNumber}] 🎯 Attacking: ${name} (detected at ${this.rivalDetectedTime}, actionSentTime: ${this.actionSentTime})`);
                }
                this.addLog(this.wsNumber, `💥 Attacked ${name}`);
                if (this.config.autorelease || this.config.exitting) {
                    // Set flag to rejoin target planet on next reconnect
                    // EXCEPT for IMPRISON mode - it should go to Prison first, then escape
                    if (this.config.kickmode || this.config.modena) {
                        // KICK or BAN mode - directly rejoin target planet
                        this.setShouldRejoinPlanet(true);
                    }
                    // For IMPRISON mode (default), don't set flag - bot will go to Prison first

                    ws.send("QUIT :ds\r\n");
                    if (this.config.sleeping && this.config.connected) this.OffSleep(ws);
                }
            }
        }, timing);
    }

    // Reused normal startAttack for normal finding
    async startAttack(ws) {
        if (this.targetids.size === 0) return;
        let target;
        if (this.config.smart) target = this.selectSmartTarget();
        else {
            const targetArray = Array.from(this.targetids);
            const rand = Math.floor(Math.random() * targetArray.length);
            const targetId = targetArray[rand];
            target = { id: targetId, name: this.targetnames.get(targetId) };
        }
        if (!target) return;
        await this.startAttackSequence(ws, target.id, target.name, "attack", "StartAttack");
    }

    // ==================== OTHER HANDLERS ====================

    handle860Message(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            // Check if Dad+ mode is enabled
            if (!this.config.dadplus) return;

            // Parse batch 860 response - can contain multiple users
            // Format: 860 userid1 data1 userid2 data2 userid3 data3 ...

            DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Processing 860 message`);

            // Get whitelist based on current mode
            const isKickMode = this.config.kickmode === true;
            const isBanMode = this.config.modena === true;

            // Dad+ uses the whitelist of the current mode
            // BAN mode uses KICK whitelist
            // KICK mode uses KICK whitelist
            // IMPRISON mode uses IMPRISON whitelist
            const whitelist = (isKickMode || isBanMode)
                ? (this.config.kwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s)
                : (this.config.whitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

            const gangWhitelist = (isKickMode || isBanMode)
                ? (this.config.kgangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s)
                : (this.config.gangwhitelist || "").toLowerCase().split(/[\n,]/).map(s => s.trim()).filter(s => s);

            DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Whitelist users: [${whitelist.join(', ')}]`);
            DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Whitelist clans: [${gangWhitelist.join(', ')}]`);

            // Split by whitespace to find user IDs
            const parts = text.split(/\s+/);
            const processedUsers = [];

            // Find all numeric user IDs (length >= 6) and mark WHOIS as complete
            for (let i = 1; i < parts.length; i++) {
                const part = parts[i];
                // Check if this is a user ID (numeric, length >= 6)
                if (!isNaN(part) && part.length >= 6) {
                    processedUsers.push(part);
                    this.completeWhoisRequest(part); // Mark WHOIS as complete
                }
            }

            DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Marked ${processedUsers.length} WHOIS requests as complete`);

            // Check if message contains "aura" (special effect/status)
            const textLower = text.toLowerCase();
            if (!textLower.includes("aura")) {
                DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - No aura found in 860 response`);
                return;
            }

            // Find all userids that have "aura" in their data
            const usersWithAura = [];

            for (let i = 1; i < parts.length; i++) {
                const part = parts[i];
                // Check if this is a user ID (numeric, length >= 6)
                if (!isNaN(part) && part.length >= 6) {
                    // Check if the next few parts contain "aura"
                    let hasAura = false;
                    for (let j = i + 1; j < Math.min(i + 5, parts.length); j++) {
                        if (parts[j].toLowerCase().includes("aura")) {
                            hasAura = true;
                            break;
                        }
                    }
                    if (hasAura) {
                        usersWithAura.push(part);
                    }
                }
            }

            DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Found ${usersWithAura.length} user(s) with aura: [${usersWithAura.join(', ')}]`);

            // Process each user with aura
            usersWithAura.forEach((userid, index) => {
                DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Checking user with aura: ${userid}`);

                // Skip self
                if (userid === this.useridg) {
                    DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Skipping self: ${userid}`);
                    return;
                }

                // Skip founder
                if (userid === this.founderUserId) {
                    DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - Skipping founder: ${userid}`);
                    this.addLog(this.wsNumber, `👑 Skipping Dad+ action for planet owner`);
                    return;
                }

                // Check whitelist (HIGHEST PRIORITY)
                // Note: We only have userid here, not username or gang
                // Whitelist check will be done by userid if we can map it
                // For now, we'll skip whitelist check in Dad+ mode since we don't have username/gang info
                // The whitelist check happens earlier in JOIN/353 handlers before WHOIS is sent

                // Stagger actions to avoid flooding
                setTimeout(async () => {
                    // Check which mode we're in
                    if (this.config.modena === true) {
                        // N/A mode - BAN user with aura (applies to ALL connections)
                        DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - BAN user with aura: ${userid}`);
                        this.addLog(this.wsNumber, `🚫 Dad+ Banning user with aura: ${userid}`);
                        this.safeSend(ws, `BAN ${userid}\r\n`, "DAD+ BAN");

                        // File logging
                        fileLogger.ban(this.wsNumber, `User_${userid}`, 'Dad+ aura detected');
                    } else if (this.config.kickmode === true) {
                        // Kick mode
                        DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - KICK user with aura: ${userid}`);
                        this.addLog(this.wsNumber, `👢 Dad+ Kicking user with aura: ${userid}`);
                        this.safeSend(ws, `KICK ${userid}\r\n`, "DAD+ KICK");

                        // File logging
                        fileLogger.kick(this.wsNumber, `User_${userid}`, 'Dad+ aura detected');
                    } else {
                        // Imprison mode or Normal Attack mode
                        DEBUG && console.log(`[WS${this.wsNumber}] Dad+ mode - IMPRISON user with aura: ${userid}`);
                        this.addLog(this.wsNumber, `⚔️ Dad+ Imprisoning user with aura: ${userid}`);
                        if (this.safeSend(ws, `ACTION 3 ${userid}\r\n`, "DAD+ IMPRISON")) {
                            this.markTargetAttacked(userid);

                            // File logging
                            fileLogger.imprison(this.wsNumber, `User_${userid}`, 'Dad+ aura detected');

                            // Set current target for metrics
                            this.currentTargetName = `User_${userid}`;
                            this.lastTargetName = `User_${userid}`;
                            this.rivalDetectedTime = this.rivalDetectionTimes[userid] || Date.now();
                            DEBUG && console.log(`[WS${this.wsNumber}] 🎯 Attacking: User_${userid} (detected at ${this.rivalDetectedTime})`);
                        }
                    }
                }, index * 100); // Stagger by 100ms
            });
        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handle860Message:`, error);
            this.addLog(this.wsNumber, `❌ Dad+ error: ${error.message}`);
        }
    }

    handle471Message(ws, snippets, text, messageArrivalTime = Date.now()) {
        this.addLog(this.wsNumber, `⚠️ Error 471: Channel issue`);
    }

    // ==================== 854 MESSAGE HANDLER ====================

    /**
     * Handle 854 messages - No longer used for prison detection
     */
    handle854Message(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            DEBUG && console.log(`[WS${this.wsNumber}] 854 message received:`, text.substring(0, 200));
            // 854 messages are now ignored for prison detection
        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handle854Message:`, error);
        }
    }

    // ==================== 332 MESSAGE HANDLER (PRISON DETECTION) ====================

    /**
     * Handle 332 messages - PRIMARY prison detection method
     * Format: "332 0 :Never share ur recovery code, registered email & mobile number!"
     * This message appears when in prison
     */
    handle332Message(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            DEBUG && console.log(`[WS${this.wsNumber}] 332 message received:`, text.substring(0, 200));

            // Check for "recovery" keyword in the message (prison indicator)
            const messageText = text.toLowerCase();
            const hasPrisonWarning = messageText.includes('recovery');

            if (hasPrisonWarning) {
                // CONFIRMED: We are in prison
                this.prisonConfirmed = true;
                this.inPrison = true;
                this.currentPlanet = "Prison";

                // Record KICKED data (for defense tracking and anti-baiting)
                DEBUG && console.log(`[WS${this.wsNumber}] 🔍 KICKED tracking check:`);
                DEBUG && console.log(`[WS${this.wsNumber}]    aiEnabled: ${this.aiEnabled}`);
                DEBUG && console.log(`[WS${this.wsNumber}]    aiCore exists: ${!!this.aiCore}`);
                DEBUG && console.log(`[WS${this.wsNumber}]    actionSentTime: ${this.actionSentTime}`);
                DEBUG && console.log(`[WS${this.wsNumber}]    rivalDetectedTime: ${this.rivalDetectedTime}`);
                DEBUG && console.log(`[WS${this.wsNumber}]    currentTargetName: ${this.currentTargetName}`);
                DEBUG && console.log(`[WS${this.wsNumber}]    mlTimingWhenKicked: ${this.mlTimingWhenKicked}`);

                // ✅ FIX: Reset duplicate guard for this NEW prison event
                this.defenseMetricRecorded = false;

                // ✅ CRITICAL: Track KICKED if we sent ACTION 3 to a rival
                if (this.actionSentTime && this.rivalDetectedTime && this.currentTargetName && !this.mlTimingWhenKicked) {
                    // Calculate the ACTION 3 timing we used against this rival
                    const action3Timing = this.actionSentTime - this.rivalDetectedTime;

                    this.mlTimingWhenKicked = action3Timing;
                    this.rivalWhoKickedUs = this.currentTargetName;
                    this.wasKickedToPrison = true;

                    DEBUG && console.log(`[WS${this.wsNumber}] ✅ KICKED by rival: ${this.rivalWhoKickedUs}`);
                    DEBUG && console.log(`[WS${this.wsNumber}] ✅ ACTION 3 timing used: ${this.mlTimingWhenKicked}ms`);

                    // 🧠 AI CORE: Learn from KICKED — pass the timing we used so ML can adjust downward
                    if (this.aiEnabled && this.aiCore) {
                        this.learnFromResult('KICKED', action3Timing).catch(err => {
                            console.error(`[WS${this.wsNumber}] Failed to learn from KICKED:`, err);
                        });
                    }

                    // ✅ RECORD DEFENSE METRIC IMMEDIATELY (don't wait for escape)
                    DEBUG && console.log(`[WS${this.wsNumber}] 📊 Recording defense metric immediately...`);
                    this.recordDefenseMetric().catch(err => {
                        console.error(`[WS${this.wsNumber}] Failed to record defense metric:`, err);
                    });
                } else if (this.aiEnabled && this.aiCore && this.aiCore.currentTiming && !this.mlTimingWhenKicked) {
                    // Fallback: If no ACTION 3 was sent, use current AI timing
                    this.mlTimingWhenKicked = this.aiCore.currentTiming;
                    this.rivalWhoKickedUs = this.lastTargetName || this.currentTargetName || 'rival';
                    this.wasKickedToPrison = true;
                    DEBUG && console.log(`[WS${this.wsNumber}] ✅ ML timing when kicked (fallback): ${this.mlTimingWhenKicked}ms`);

                    // 🧠 AI CORE: Learn from KICKED fallback
                    if (this.aiEnabled && this.aiCore) {
                        this.learnFromResult('KICKED', this.mlTimingWhenKicked).catch(err => {
                            console.error(`[WS${this.wsNumber}] Failed to learn from KICKED (fallback):`, err);
                        });
                    }

                    // ✅ RECORD DEFENSE METRIC IMMEDIATELY (don't wait for escape)
                    DEBUG && console.log(`[WS${this.wsNumber}] 📊 Recording defense metric immediately...`);
                    this.recordDefenseMetric().catch(err => {
                        console.error(`[WS${this.wsNumber}] Failed to record defense metric:`, err);
                    });
                } else {
                    DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Cannot track KICKED - conditions not met`);
                    if (!this.aiEnabled) DEBUG && console.log(`[WS${this.wsNumber}]    → AI not enabled`);
                    if (!this.aiCore) DEBUG && console.log(`[WS${this.wsNumber}]    → AI Core not initialized`);
                    if (!this.actionSentTime) DEBUG && console.log(`[WS${this.wsNumber}]    → No ACTION 3 sent`);
                    if (!this.rivalDetectedTime) DEBUG && console.log(`[WS${this.wsNumber}]    → No rival detected time`);
                    if (!this.currentTargetName) DEBUG && console.log(`[WS${this.wsNumber}]    → No current target name`);
                    if (this.mlTimingWhenKicked) DEBUG && console.log(`[WS${this.wsNumber}]    → Already recorded (${this.mlTimingWhenKicked}ms)`);
                }

                DEBUG && console.log(`[WS${this.wsNumber}] 🔴 PRISON CONFIRMED via 332 "recovery" keyword`);
                this.addLog(this.wsNumber, `🔴 Prison detected (332 message)`);

                // Trigger auto-release if enabled and not already in progress
                if (this.config.autorelease && !this.escapeInProgress) {
                    // Check escape retry limit
                    if (this.escapeRetryCount >= this.maxEscapeRetries) {
                        DEBUG && console.log(`[WS${this.wsNumber}] ❌ Max escape retries (${this.maxEscapeRetries}) reached - staying in prison`);
                        this.addLog(this.wsNumber, `❌ Escape failed after ${this.maxEscapeRetries} attempts - check recovery codes`);
                        this.addLog(this.wsNumber, `⚠️ Bot will stay in prison until manual intervention`);
                        return; // Give up - don't retry anymore
                    }

                    this.escapeInProgress = true;
                    this.escapeRetryCount++; // Increment retry counter
                    this.addLog(this.wsNumber, `🔓 Prison detected - escape attempt ${this.escapeRetryCount}/${this.maxEscapeRetries}`);
                    DEBUG && console.log(`[WS${this.wsNumber}] Triggering auto-release (attempt ${this.escapeRetryCount}/${this.maxEscapeRetries})...`);

                    // File logging
                    fileLogger.autoRelease(this.wsNumber);

                    setTimeout(async () => {
                        DEBUG && console.log(`[WS${this.wsNumber}] Executing escape attempt...`);
                        const success = await this.escapeAll();

                        if (success) {
                            DEBUG && console.log(`[WS${this.wsNumber}] ✅ Escape successful - rejoining target planet`);

                            // Wait a bit to ensure escape is processed
                            setTimeout(() => {
                                // Verify we're actually out of prison before rejoining
                                if (!this.prisonConfirmed && ws.readyState === ws.OPEN) {
                                    const targetPlanet = this.config.planet;
                                    if (targetPlanet) {
                                        DEBUG && console.log(`[WS${this.wsNumber}] Rejoining ${targetPlanet} after confirmed escape`);
                                        ws.send(`JOIN ${targetPlanet}\r\n`);
                                        this.addLog(this.wsNumber, `🔄 Rejoining ${targetPlanet}`);

                                        // CRITICAL: Clear flag immediately after JOIN
                                        this.setShouldRejoinPlanet(false);
                                        DEBUG && console.log(`[WS${this.wsNumber}] Cleared shouldRejoinPlanet flag after escape JOIN`);

                                        // Reset retry counter on successful escape
                                        this.escapeRetryCount = 0;
                                        DEBUG && console.log(`[WS${this.wsNumber}] ✅ Escape successful - reset retry counter`);

                                        // ✅ FIX: Defense metric already recorded in 332 handler
                                        // Removed duplicate recordDefenseMetric() call that caused double DB inserts
                                        DEBUG && console.log(`[WS${this.wsNumber}] ℹ️ Defense metric already recorded in 332 handler (defenseMetricRecorded=${this.defenseMetricRecorded})`);
                                    }
                                } else if (this.prisonConfirmed) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Still in prison after escape - will retry`);
                                    this.addLog(this.wsNumber, `⚠️ Still in prison - retrying...`);
                                    this.escapeInProgress = false; // Allow retry
                                } else {
                                    DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ WebSocket closed - cannot rejoin`);
                                }
                            }, 2000);  // Reduced from 3000ms to 2000ms
                        } else {
                            DEBUG && console.log(`[WS${this.wsNumber}] ❌ Escape failed - will retry on next check`);
                            DEBUG && console.log(`[WS${this.wsNumber}] Retry count: ${this.escapeRetryCount}/${this.maxEscapeRetries}`);
                            this.escapeInProgress = false; // Allow retry
                        }
                    }, 500);  // Reduced from 1000ms to 500ms
                } else if (this.escapeInProgress) {
                    DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Escape already in progress - skipping duplicate 332 attempt`);
                } else {
                    DEBUG && console.log(`[WS${this.wsNumber}] Auto-release disabled - staying in prison`);
                }
            }
        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handle332Message:`, error);
        }
    }

    handleFounderMessage(ws, snippets, text, messageArrivalTime = Date.now()) {
        // FOUNDER message format: "FOUNDER 14358744 cr/21"
        // Extract the founder's user ID
        if (snippets.length >= 2) {
            const founderId = snippets[1];

            // Update founder ID (this is the authoritative source)
            const previousFounderId = this.founderUserId;
            this.founderUserId = founderId;
            DEBUG && console.log(`[WS${this.wsNumber}] FOUNDER detected: ${founderId}`);


            // CRITICAL: Save founder ID to file for persistence across reconnects
            if (this.currentPlanet && founderId) {
                setFounderId(this.currentPlanet, founderId);
                DEBUG && console.log(`[WS${this.wsNumber}] Saved founder to file: ${this.currentPlanet} → ${founderId}`);
            }

            // CRITICAL: If we had wrong founder ID before, log it
            if (previousFounderId && previousFounderId !== founderId) {
                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Founder ID corrected: ${previousFounderId} → ${founderId}`);

            }

            // CRITICAL: Remove founder from all target/attack lists if already added
            if (this.targetids.has(founderId)) {
                this.targetids.delete(founderId);
                this.targetnames.delete(founderId);
                DEBUG && console.log(`[WS${this.wsNumber}] Removed founder from target list`);
            }

            if (this.attackids.has(founderId)) {
                this.attackids.delete(founderId);
                this.attacknames.delete(founderId);
                DEBUG && console.log(`[WS${this.wsNumber}] Removed founder from attack list`);
            }

            // CRITICAL: Cancel ANY scheduled attack if target is founder
            // This handles the case where attack was scheduled before FOUNDER message arrived
            if (this.useridattack === founderId || this.useridtarget === founderId) {
                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ CANCELLING scheduled attack on founder!`);
                this.addLog(this.wsNumber, `🛑 Cancelled attack - target is planet owner`);

                // Clear the timeout to prevent attack
                if (this.timeout) {
                    clearTimeout(this.timeout);
                    this.timeout = null;
                    DEBUG && console.log(`[WS${this.wsNumber}] Cleared attack timeout for founder`);
                }

                // Clear all nested timeouts (for kick/imprison modes)
                if (this.innerTimeouts && this.innerTimeouts.length > 0) {
                    const count = this.innerTimeouts.length;
                    this.innerTimeouts.forEach(t => clearTimeout(t));
                    this.innerTimeouts = [];
                    DEBUG && console.log(`[WS${this.wsNumber}] Cleared ${count} nested timeouts`);
                }

                // Reset attack state
                this.userFound = false;
                this.useridattack = null;
                this.useridtarget = null;
            }
        }
    }

    handle900Message(ws, snippets, text, messageArrivalTime = Date.now()) {
        const planetInfo = snippets.slice(1).join(" ");
        const planet = snippets[1];

        this.currentPlanet = planet;


        DEBUG && console.log(`[WS${this.wsNumber}] 900 message - Planet: ${planet}`);

        // 900 messages no longer trigger prison detection
        // Prison detection is now handled by 332 and 353 messages only
    }

    // ==================== HELPER METHODS FOR USER DEPARTURE ====================

    /**
     * Remove user from all tracking arrays and clean up
     * @param {string} userid - User ID to remove
     */
    removeUserFromTracking(userid) {
        // Remove from Sets/Maps - O(1) operation
        this.targetids.delete(userid);
        this.targetnames.delete(userid);
        this.attackids.delete(userid);
        this.attacknames.delete(userid);

        // Clean up appearance time
        delete this.userAppearanceTime[userid];

        // Clean up detection time for metrics
        delete this.rivalDetectionTimes[userid];
        DEBUG && console.log(`[WS${this.wsNumber}] 🗑️ Removed rival ${userid} from tracking (including detection time)`);
    }

    /**
     * Handle smart mode target switching when current target leaves
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} userid - User ID that left
     */
    handleSmartTargetSwitch(ws, userid) {
        if (!this.config.smart || userid !== this.useridattack || this.attackids.size === 0) {
            return false;
        }

        const newTarget = this.selectSmartTarget();
        if (!newTarget) {
            return false;
        }

        this.useridattack = newTarget.id;
        this.userFound = true;
        this.addLog(this.wsNumber, `🎯 Smart Switch: ${newTarget.name}`);

        // Calculate elapsed time since new target appeared
        const appearanceTime = this.userAppearanceTime[newTarget.id] || Date.now();
        const elapsedTime = Date.now() - appearanceTime;
        const fullTiming = this.getTiming("attack");
        const remainingTime = Math.max(100, fullTiming - elapsedTime);



        // Clear old timeout and set new one with adjusted timing
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.timeout = setTimeout(async () => {
            if (this.useridattack === this.founderUserId) {
                this.addLog(this.wsNumber, `👑 Cancelled attack - target is planet owner`);
                this.userFound = false;
                return;
            }

            if (ws.readyState === ws.OPEN) {
                ws.send(`ACTION 3 ${this.useridattack}\r\n`);
                this.markTargetAttacked(this.useridattack);
                this.addLog(this.wsNumber, `⚔️ Attacked ${newTarget.name}!`);

                // Set current target for metrics
                this.currentTargetName = newTarget.name;
                this.lastTargetName = newTarget.name;
                this.rivalDetectedTime = this.rivalDetectionTimes[this.useridattack] || Date.now();
                DEBUG && console.log(`[WS${this.wsNumber}] 🎯 Attacking: ${newTarget.name} (detected at ${this.rivalDetectedTime})`);

                if (this.config.sleeping && this.config.connected) {
                    // DON'T set shouldRejoinPlanet for IMPRISON - bot should go to Prison first
                    // After escape, shouldRejoinPlanet will be set by escape success
                    ws.send("QUIT :ds\r\n");

                    return this.OffSleep(ws);
                }

                if (this.config.autorelease || this.config.exitting) {
                    // DON'T set shouldRejoinPlanet for IMPRISON - bot should go to Prison first
                    // After escape, shouldRejoinPlanet will be set by escape success
                    ws.send("QUIT :ds\r\n");

                }
            }
        }, remainingTime);

        return true;
    }

    /**
     * Handle when current target leaves (PART or SLEEP)
     * @param {string} userid - User ID that left
     */
    handleCurrentTargetDeparture(userid) {
        if (userid !== this.useridtarget) {
            return false;
        }

        this.userFound = false;
        this.useridtarget = null;
        this.useridattack = null;

        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }

        return true;
    }

    // ==================== PART/SLEEP MESSAGE HANDLERS ====================

    async handlePartMessage(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            const userid = snippets[1] ? snippets[1].replace(/(\r\n|\n|\r)/gm, "") : "";

            // CRITICAL: Check NEW Smart Mode pool first (IMPRISON mode)
            if (this.config.imprisonmode) {
                // If PRIMARY left
                if (userid === this.primaryTarget.userid) {
                    DEBUG && console.log(`[WS${this.wsNumber}] ❌ PRIMARY ${this.primaryTarget.username} left`);
                    this.addLog(this.wsNumber, `❌ PRIMARY left: ${this.primaryTarget.username}`);

                    // 🧠 AI CORE: Check if rival left BEFORE we sent ACTION 3 (TRUE early leave)
                    // If actionSentTime is NOT set, rival left early (before we could send ACTION 3)
                    if (!this.actionSentTime && this.currentTargetName === this.primaryTarget.username) {
                        // ✅ CRITICAL: Calculate rival's ACTUAL leaving time (when PART message received)
                        const rivalActualLeaveTime = Date.now() - this.rivalDetectedTime;

                        DEBUG && console.log(`[WS${this.wsNumber}] ========================================`);
                        DEBUG && console.log(`[WS${this.wsNumber}] 🚪 LEFT_EARLY DETECTED!`);
                        DEBUG && console.log(`[WS${this.wsNumber}] 🚪 Rival: ${this.primaryTarget.username}`);
                        DEBUG && console.log(`[WS${this.wsNumber}] 🚪 Left at: ${rivalActualLeaveTime}ms (before ACTION 3)`);
                        DEBUG && console.log(`[WS${this.wsNumber}] ========================================`);

                        this.addLog(this.wsNumber, `🚪 LEFT_EARLY: ${this.primaryTarget.username} left at ${rivalActualLeaveTime}ms`);

                        // Learn from early leave — skip if timing is below absolute minimum (trap/bait)
                        // A rival leaving at <1775ms is a trap, not a real timing signal
                        if (rivalActualLeaveTime >= 1775) {
                            this.learnFromResult('LEFT_EARLY', rivalActualLeaveTime).catch(err => {
                                console.error(`[WS${this.wsNumber}] Failed to learn from early leave:`, err);
                            });
                        } else {
                            fileLogger.log('AI-LEARN', `SKIP LEFT_EARLY: opponentLeftAt=${rivalActualLeaveTime}ms < 1775ms (trap/bait) — not feeding ML`, this.wsNumber);
                        }

                        // ✅ Record metric immediately with ACTUAL rival leaving time as timestamp_value
                        if (this.rivalDetectedTime) {
                            const pingMs = this.getCurrentPing();
                            const context = this.getContextFromPing();

                            // ✅ CRITICAL: Check if rival timing is above ABSOLUTE minimum (1775ms)
                            // Rival can be in ANY zone (SLOW/NORMAL/FAST) regardless of our ping
                            const absoluteMinimum = 1775;  // SLOW zone minimum (lowest valid timing)

                            // Skip recording if rival timing is below absolute minimum (trap/bait)
                            if (rivalActualLeaveTime < absoluteMinimum) {
                                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ SKIPPING DB RECORD: Rival left at ${rivalActualLeaveTime}ms < ${absoluteMinimum}ms (absolute minimum)`);
                                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ This is TRAP/BAIT timing - not storing to database`);
                            } else {
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊 Preparing to record LEFT_EARLY to database...`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊 Metrics enabled: ${this.config.metricsEnabled}`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊 AI enabled: ${this.aiEnabled}`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊 User ID: ${this.config.userId}`);

                                const codeUsed = this.currentCodeType || 'primary';
                                const isClanMember = this.isUserInBotGang(this.currentTargetName);
                                const timingType = this.status || 'attack';
                                const timingValue = this.getTimingForMetrics(timingType);

                                DEBUG && console.log(`[WS${this.wsNumber}] 📊 LEFT_EARLY DB Data:`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Player: ${this.currentTargetName}`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Code: ${codeUsed}`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Rival left at: ${rivalActualLeaveTime}ms (will be stored in timestamp_value)`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Connection time: ${Date.now() - this.connectionStartTime}ms (will be stored in timestamp_ms)`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Timing Type: ${timingType}`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Ping: ${pingMs}ms, Context: ${context}`);
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Adjustment Reason: LEFT_EARLY`);

                                this.recordImprisonmentMetric(
                                    this.currentTargetName,
                                    codeUsed,
                                    isClanMember,
                                    this.actionSentTime && this.rivalDetectedTime ? this.actionSentTime - this.rivalDetectedTime : rivalActualLeaveTime,  // timestampMs = actual action timing
                                    false,  // isSuccess = FALSE (rival escaped early)
                                    rivalActualLeaveTime,  // ✅ timingValue = rival's actual leaving time (stored in timestamp_value)
                                    timingType,
                                    pingMs,
                                    context,
                                    'LEFT_EARLY',  // adjustmentReason
                                    false  // isDefense = false (not a kick)
                                ).then(() => {
                                    DEBUG && console.log(`[WS${this.wsNumber}] ✅ LEFT_EARLY metric recorded successfully to database`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] ✅ Rival left time ${rivalActualLeaveTime}ms stored in timestamp_value column`);
                                }).catch(err => {
                                    console.error(`[WS${this.wsNumber}] ❌ Failed to record left early metric:`, err);
                                    console.error(`[WS${this.wsNumber}] ❌ Error details:`, err.message);
                                    console.error(`[WS${this.wsNumber}] ❌ Error stack:`, err.stack);
                                });
                            }
                        } else {
                            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Cannot record LEFT_EARLY - rivalDetectedTime is null`);
                        }

                        // Reset tracking
                        this.rivalDetectedTime = null;
                        this.currentTargetName = null;
                        this.actionSentTime = null;
                    }
                    // If rival left AFTER we sent ACTION 3, wait for 850 response to determine result
                    else if (this.actionSentTime && this.currentTargetName === this.primaryTarget.username) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 📊 Rival left AFTER ACTION 3 sent - waiting for 850 response (not LEFT_EARLY)`);

                        // If we're in pending mode, let the 850 handler determine the result
                        if (this.pending850Response) {
                            DEBUG && console.log(`[WS${this.wsNumber}] 📊 In pending mode - 850 response will determine result`);
                            // Don't set pending850Result here - let 850 response handle it
                        }
                        // If not in pending mode, this is unusual but handle it
                        else {
                            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Not in pending mode but rival left after ACTION 3`);
                        }
                    }

                    // Cancel current attack (SYNCHRONOUS)
                    if (this.attackTimeout) {
                        clearTimeout(this.attackTimeout);
                        this.attackTimeout = null;
                    }

                    // ✅ CRITICAL: Only promote BACKUP if ACTION 3 was NOT sent yet
                    // If ACTION 3 already sent, we wait for 850 response and ignore BACKUP
                    if (!this.actionSentTime) {
                        DEBUG && console.log(`[WS${this.wsNumber}] ⬆️ ACTION 3 not sent yet - promoting BACKUP to PRIMARY`);
                        await this.promoteBackupToPrimary(ws);
                    } else {
                        DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ ACTION 3 already sent - ignoring BACKUP, waiting for 850 response`);
                        // Clear PRIMARY (no promotion)
                        this.primaryTarget = { userid: null, username: null, appearanceTime: null, scheduledAttackTime: null };
                    }
                    return; // Exit early - Smart Mode handled
                }

                // If BACKUP left
                else if (userid === this.backupTarget.userid) {
                    DEBUG && console.log(`[WS${this.wsNumber}] ❌ BACKUP ${this.backupTarget.username} left`);
                    this.addLog(this.wsNumber, `❌ BACKUP left: ${this.backupTarget.username}`);

                    // Check if ACTION 3 was already sent
                    if (this.actionSentTime) {
                        // ACTION 3 already sent - ignore BACKUP leaving, wait for 850
                        DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ ACTION 3 already sent - ignoring BACKUP leaving, waiting for 850`);
                        this.backupTarget = { userid: null, username: null, appearanceTime: null };
                        return;
                    }

                    // ACTION 3 not sent yet - record LEFT_EARLY for BACKUP
                    if (this.backupTarget.appearanceTime) {
                        const backupActualLeaveTime = Date.now() - this.backupTarget.appearanceTime;

                        DEBUG && console.log(`[WS${this.wsNumber}] 🚪 LEFT_EARLY (BACKUP): ${this.backupTarget.username} left at ${backupActualLeaveTime}ms`);
                        this.addLog(this.wsNumber, `🚪 LEFT_EARLY (BACKUP): ${this.backupTarget.username} left at ${backupActualLeaveTime}ms`);

                        // Learn from backup early leave — skip trap/bait timings
                        if (backupActualLeaveTime < 1775) {
                            fileLogger.log('AI-LEARN', `SKIP BACKUP LEFT_EARLY: opponentLeftAt=${backupActualLeaveTime}ms < 1775ms (trap/bait)`, this.wsNumber);
                        }
                        if (backupActualLeaveTime >= 1775) this.learnFromResult('LEFT_EARLY', backupActualLeaveTime).catch(err => {
                            console.error(`[WS${this.wsNumber}] Failed to learn from backup early leave:`, err);
                        });

                        // ✅ CRITICAL: Check if rival timing is above ABSOLUTE minimum (1775ms)
                        const absoluteMinimum = 1775;  // SLOW zone minimum (lowest valid timing)

                        // Skip recording if rival timing is below absolute minimum (trap/bait)
                        if (backupActualLeaveTime < absoluteMinimum) {
                            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ SKIPPING DB RECORD: BACKUP left at ${backupActualLeaveTime}ms < ${absoluteMinimum}ms (absolute minimum)`);
                            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ This is TRAP/BAIT timing - not storing to database`);
                        } else {
                            // Record metric
                            const codeUsed = this.currentCodeType || 'primary';
                            const isClanMember = this.isUserInBotGang(this.backupTarget.username);
                            const timingType = this.backupTarget.source === "353" ? "defense" : "attack";
                            const timingValue = this.getTimingForMetrics(timingType);
                            const pingMs = this.getCurrentPing();
                            const context = this.getContextFromPing();

                            this.recordImprisonmentMetric(
                                this.backupTarget.username,
                                codeUsed,
                                isClanMember,
                                backupActualLeaveTime,  // timestampMs = backup's own leave time
                                false,
                                backupActualLeaveTime,
                                timingType,
                                pingMs,
                                context,
                                'LEFT_EARLY',
                                false
                            ).catch(err => {
                                console.error(`[WS${this.wsNumber}] Failed to record backup left early:`, err);
                            });
                        }
                    }

                    // Clear BACKUP
                    this.backupTarget = { userid: null, username: null, appearanceTime: null };

                    // Check if PRIMARY is still there
                    if (!this.primaryTarget.userid) {
                        // Both PRIMARY and BACKUP gone - SAFETY ESCAPE
                        DEBUG && console.log(`[WS${this.wsNumber}] 🛡️ SAFETY ESCAPE: Both PRIMARY and BACKUP left - reconnecting`);
                        this.addLog(this.wsNumber, `🛡️ SAFETY ESCAPE: Reconnecting for fresh start`);

                        // Cancel any pending attack
                        if (this.attackTimeout) {
                            clearTimeout(this.attackTimeout);
                            this.attackTimeout = null;
                        }

                        // Send QUIT
                        if (ws.readyState === ws.OPEN) {
                            ws.send(`QUIT :safety escape\r\n`);
                        }

                        // Trigger reconnect
                        this.setShouldRejoinPlanet(true);
                    } else {
                        // PRIMARY still there - continue with PRIMARY
                        DEBUG && console.log(`[WS${this.wsNumber}] ✅ PRIMARY still present - continuing with PRIMARY attack`);
                    }

                    return;
                }
            }

            // Handle if this is our current target (old mode)
            if (this.handleCurrentTargetDeparture(userid)) {

            }

            // Remove from tracking arrays
            this.removeUserFromTracking(userid);

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handlePart:`, error);
        }
    }

    async handleSleepMessage(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            const userid = snippets[1] ? snippets[1].replace(/(\r\n|\n|\r)/gm, "") : "";

            // Check if sleeping user is the planet founder
            const isFounder = (userid === this.founderUserId);

            // CRITICAL: Check NEW Smart Mode pool first (IMPRISON mode)
            if (this.config.imprisonmode) {
                // If PRIMARY sleeping
                if (userid === this.primaryTarget.userid) {
                    if (isFounder) {
                        DEBUG && console.log(`[WS${this.wsNumber}] 👑 PRIMARY (planet owner) sleeping - staying on planet`);
                        this.addLog(this.wsNumber, `👑 Planet owner sleeping - waiting for other rivals`);
                        // Clear PRIMARY but stay on planet
                        if (this.attackTimeout) {
                            clearTimeout(this.attackTimeout);
                            this.attackTimeout = null;
                        }
                        this.primaryTarget = { userid: null, username: null, appearanceTime: null, scheduledAttackTime: null };
                        // Promote backup if available
                        if (this.backupTarget.userid) {
                            await this.promoteBackupToPrimary(ws);
                        }
                        return;
                    } else {
                        DEBUG && console.log(`[WS${this.wsNumber}] ❌ PRIMARY ${this.primaryTarget.username} sleeping`);
                        this.addLog(this.wsNumber, `💤 PRIMARY sleeping: ${this.primaryTarget.username}`);

                        // 🧠 AI CORE: Check if rival slept BEFORE we sent ACTION 3 (treat as LEFT_EARLY)
                        // If actionSentTime is NOT set, rival slept early (before we could send ACTION 3)
                        if (!this.actionSentTime && this.currentTargetName === this.primaryTarget.username) {
                            // ✅ CRITICAL: Calculate rival's ACTUAL sleep time (when SLEEP message received)
                            const rivalActualSleepTime = Date.now() - this.rivalDetectedTime;

                            DEBUG && console.log(`[WS${this.wsNumber}] ========================================`);
                            DEBUG && console.log(`[WS${this.wsNumber}] 💤 LEFT_EARLY (SLEEP) DETECTED!`);
                            DEBUG && console.log(`[WS${this.wsNumber}] 💤 Rival: ${this.primaryTarget.username}`);
                            DEBUG && console.log(`[WS${this.wsNumber}] 💤 Slept at: ${rivalActualSleepTime}ms (before ACTION 3)`);
                            DEBUG && console.log(`[WS${this.wsNumber}] ========================================`);

                            this.addLog(this.wsNumber, `💤 LEFT_EARLY (SLEEP): ${this.primaryTarget.username} slept at ${rivalActualSleepTime}ms`);

                            // Learn from early sleep — skip trap/bait timings
                            if (rivalActualSleepTime >= 1775) {
                                this.learnFromResult('LEFT_EARLY', rivalActualSleepTime).catch(err => {
                                    console.error(`[WS${this.wsNumber}] Failed to learn from early sleep:`, err);
                                });
                            } else {
                                fileLogger.log('AI-LEARN', `SKIP SLEEP LEFT_EARLY: opponentLeftAt=${rivalActualSleepTime}ms < 1775ms (trap/bait)`, this.wsNumber);
                            }

                            // ✅ CRITICAL: Check if rival timing is above ABSOLUTE minimum (1775ms)
                            const absoluteMinimum = 1775;  // SLOW zone minimum (lowest valid timing)

                            // ✅ Record metric immediately with ACTUAL rival sleep time as timestamp_value
                            if (this.rivalDetectedTime) {
                                // Skip recording if rival timing is below absolute minimum (trap/bait)
                                if (rivalActualSleepTime < absoluteMinimum) {
                                    DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ SKIPPING DB RECORD: Rival slept at ${rivalActualSleepTime}ms < ${absoluteMinimum}ms (absolute minimum)`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ This is TRAP/BAIT timing - not storing to database`);
                                } else {
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊 Preparing to record LEFT_EARLY (SLEEP) to database...`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊 Metrics enabled: ${this.config.metricsEnabled}`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊 AI enabled: ${this.aiEnabled}`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊 User ID: ${this.config.userId}`);

                                    const codeUsed = this.currentCodeType || 'primary';
                                    const isClanMember = this.isUserInBotGang(this.currentTargetName);
                                    const timingType = this.status || 'attack';
                                    const timingValue = this.getTimingForMetrics(timingType);
                                    const pingMs = this.getCurrentPing();
                                    const context = this.getContextFromPing();

                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊 LEFT_EARLY (SLEEP) DB Data:`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Player: ${this.currentTargetName}`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Code: ${codeUsed}`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Rival slept at: ${rivalActualSleepTime}ms (will be stored in timestamp_value)`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Connection time: ${Date.now() - this.connectionStartTime}ms (will be stored in timestamp_ms)`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Timing Type: ${timingType}`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Ping: ${pingMs}ms, Context: ${context}`);
                                    DEBUG && console.log(`[WS${this.wsNumber}] 📊   - Adjustment Reason: LEFT_EARLY`);

                                    this.recordImprisonmentMetric(
                                        this.currentTargetName,
                                        codeUsed,
                                        isClanMember,
                                        this.actionSentTime && this.rivalDetectedTime ? this.actionSentTime - this.rivalDetectedTime : rivalActualSleepTime,  // timestampMs = actual action timing
                                        false,  // isSuccess = FALSE (rival escaped by sleeping)
                                        rivalActualSleepTime,  // ✅ timingValue = rival's actual sleep time (stored in timestamp_value)
                                        timingType,
                                        pingMs,
                                        context,
                                        'LEFT_EARLY',  // adjustmentReason (same as PART)
                                        false  // isDefense = false (not a kick)
                                    ).then(() => {
                                        DEBUG && console.log(`[WS${this.wsNumber}] ✅ LEFT_EARLY (SLEEP) metric recorded successfully to database`);
                                        DEBUG && console.log(`[WS${this.wsNumber}] ✅ Rival sleep time ${rivalActualSleepTime}ms stored in timestamp_value column`);
                                    }).catch(err => {
                                        console.error(`[WS${this.wsNumber}] ❌ Failed to record left early (sleep) metric:`, err);
                                        console.error(`[WS${this.wsNumber}] ❌ Error details:`, err.message);
                                        console.error(`[WS${this.wsNumber}] ❌ Error stack:`, err.stack);
                                    });
                                }
                            } else {
                                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Cannot record LEFT_EARLY (SLEEP) - rivalDetectedTime is null`);
                            }

                            // Reset tracking
                            this.rivalDetectedTime = null;
                            this.currentTargetName = null;
                            this.actionSentTime = null;
                        }
                        // If rival slept AFTER we sent ACTION 3, wait for 850 response to determine result
                        else if (this.actionSentTime && this.currentTargetName === this.primaryTarget.username) {
                            DEBUG && console.log(`[WS${this.wsNumber}] 📊 Rival slept AFTER ACTION 3 sent - waiting for 850 response (not LEFT_EARLY)`);

                            // If we're in pending mode, let the 850 handler determine the result
                            if (this.pending850Response) {
                                DEBUG && console.log(`[WS${this.wsNumber}] 📊 In pending mode - 850 response will determine result`);
                                // Don't set pending850Result here - let 850 response handle it
                            }
                            // If not in pending mode, this is unusual but handle it
                            else {
                                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Not in pending mode but rival slept after ACTION 3`);
                            }
                        }

                        // Cancel current attack (SYNCHRONOUS)
                        if (this.attackTimeout) {
                            clearTimeout(this.attackTimeout);
                            this.attackTimeout = null;
                        }

                        // ✅ CRITICAL: Only promote BACKUP if ACTION 3 was NOT sent yet
                        // If ACTION 3 already sent, we wait for 850 response and ignore BACKUP
                        if (!this.actionSentTime) {
                            DEBUG && console.log(`[WS${this.wsNumber}] ⬆️ ACTION 3 not sent yet - promoting BACKUP to PRIMARY`);
                            await this.promoteBackupToPrimary(ws);
                        } else {
                            DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ ACTION 3 already sent - ignoring BACKUP, waiting for 850 response`);
                            // Clear PRIMARY (no promotion)
                            this.primaryTarget = { userid: null, username: null, appearanceTime: null, scheduledAttackTime: null };
                        }
                        return; // Exit early - Smart Mode handled
                    }
                }

                // If BACKUP sleeping
                else if (userid === this.backupTarget.userid) {
                    DEBUG && console.log(`[WS${this.wsNumber}] ❌ BACKUP ${this.backupTarget.username} sleeping`);
                    this.addLog(this.wsNumber, `💤 BACKUP sleeping: ${this.backupTarget.username}`);

                    // Check if ACTION 3 was already sent
                    if (this.actionSentTime) {
                        // ACTION 3 already sent - ignore BACKUP sleeping, wait for 850
                        DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ ACTION 3 already sent - ignoring BACKUP sleeping, waiting for 850`);
                        this.backupTarget = { userid: null, username: null, appearanceTime: null };
                        return;
                    }

                    // ACTION 3 not sent yet - record LEFT_EARLY for BACKUP
                    if (this.backupTarget.appearanceTime) {
                        const backupActualSleepTime = Date.now() - this.backupTarget.appearanceTime;

                        DEBUG && console.log(`[WS${this.wsNumber}] 💤 LEFT_EARLY (BACKUP SLEEP): ${this.backupTarget.username} slept at ${backupActualSleepTime}ms`);
                        this.addLog(this.wsNumber, `💤 LEFT_EARLY (BACKUP): ${this.backupTarget.username} slept at ${backupActualSleepTime}ms`);

                        // Learn from backup early sleep
                        this.learnFromResult('LEFT_EARLY', backupActualSleepTime).catch(err => {
                            console.error(`[WS${this.wsNumber}] Failed to learn from backup early sleep:`, err);
                        });

                        // Record metric
                        const codeUsed = this.currentCodeType || 'primary';
                        const isClanMember = this.isUserInBotGang(this.backupTarget.username);
                        const timingType = this.backupTarget.source === "353" ? "defense" : "attack";
                        const timingValue = this.getTimingForMetrics(timingType);
                        const pingMs = this.getCurrentPing();
                        const context = this.getContextFromPing();

                        this.recordImprisonmentMetric(
                            this.backupTarget.username,
                            codeUsed,
                            isClanMember,
                            backupActualSleepTime,  // timestampMs = backup's own sleep time
                            false,
                            backupActualSleepTime,
                            timingType,
                            pingMs,
                            context,
                            'LEFT_EARLY',
                            false
                        ).catch(err => {
                            console.error(`[WS${this.wsNumber}] Failed to record backup sleep early:`, err);
                        });
                    }

                    // Clear BACKUP
                    this.backupTarget = { userid: null, username: null, appearanceTime: null };

                    // Check if PRIMARY is still there
                    if (!this.primaryTarget.userid) {
                        // Both PRIMARY and BACKUP gone - SAFETY ESCAPE
                        DEBUG && console.log(`[WS${this.wsNumber}] 🛡️ SAFETY ESCAPE: Both PRIMARY and BACKUP unavailable - reconnecting`);
                        this.addLog(this.wsNumber, `🛡️ SAFETY ESCAPE: Reconnecting for fresh start`);

                        // Cancel any pending attack
                        if (this.attackTimeout) {
                            clearTimeout(this.attackTimeout);
                            this.attackTimeout = null;
                        }

                        // Send QUIT
                        if (ws.readyState === ws.OPEN) {
                            ws.send(`QUIT :safety escape\r\n`);
                        }

                        // Trigger reconnect
                        this.setShouldRejoinPlanet(true);
                    } else {
                        // PRIMARY still there - continue with PRIMARY
                        DEBUG && console.log(`[WS${this.wsNumber}] ✅ PRIMARY still present - continuing with PRIMARY attack`);
                    }

                    return;
                }
            }

            // Handle if this is our current target (old mode)
            if (this.handleCurrentTargetDeparture(userid)) {
                if (isFounder) {
                    this.addLog(this.wsNumber, `👑 Planet owner sleeping: ${userid} - staying on planet`);
                    // Stay on planet and wait for other rivals

                    return;
                } else {
                    this.addLog(this.wsNumber, `💤 Target sleeping: ${userid}`);

                    // For non-founder targets, quit if configured
                    if (this.config.sleeping || this.config.exitting) {
                        setTimeout(() => {
                            if (ws.readyState === ws.OPEN) {
                                // Set flag to rejoin target planet on next reconnect
                                this.setShouldRejoinPlanet(true);
                                ws.send("QUIT :ds\r\n");
                                this.addLog(this.wsNumber, `🚪 QUIT (target sleeping)`);

                                if (this.config.sleeping && this.config.connected) {
                                    this.OffSleep(ws);
                                }
                            }
                        }, 100);
                    }
                }
            }

            // Remove from tracking arrays
            this.removeUserFromTracking(userid);

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handleSleep:`, error);
        }
    }

    // ==================== 850 MESSAGE HANDLER ====================

    async handle850Message(ws, snippets, text, messageArrivalTime = Date.now()) {
        // ✅ FILE LOG: Always log entry so we can confirm handle850Message is being called
        fileLogger.log('850-MSG', `handle850Message called — text: ${text.substring(0, 150)}`, this.wsNumber);
        DEBUG && console.log(`[WS${this.wsNumber}] 🔔 handle850Message CALLED`);
        DEBUG && console.log(`[WS${this.wsNumber}] 🔔 Message text: ${text.substring(0, 200)}`);
        DEBUG && console.log(`[WS${this.wsNumber}] 🔔 Snippets:`, snippets);
        DEBUG && console.log(`[WS${this.wsNumber}] 🔔 Snippets[6]: "${snippets[6]}"`);

        try {
            if (snippets[1] === ":<div") {
                DEBUG && console.log(`[WS${this.wsNumber}] 🔔 Skipping div message`);
                return;
            }

            const messageText = text.toLowerCase();
            let is3SecondError = false;
            let isSuccess = false;

            DEBUG && console.log(`[WS${this.wsNumber}] 🔔 Checking for 3S error or success...`);
            // ✅ FILE LOG: Log what keywords we're checking
            fileLogger.log('850-CHECK', `text contains: 3s=${messageText.includes('imprison only in 3s') || messageText.includes('3s after you appear') || messageText.includes("can't imprison more often than once in 3s")} success=${messageText.includes('allows you to imprison') || messageText.includes('imprisoned for')}`, this.wsNumber);

            // Check for 3S ERROR - use text matching (more reliable)
            if (messageText.includes('imprison only in 3s') ||
                messageText.includes('3s after you appear') ||
                messageText.includes("can't imprison more often than once in 3s")) {
                is3SecondError = true;
                DEBUG && console.log(`[WS${this.wsNumber}] ✅ 3S ERROR detected via text match`);
            }

            // Check for SUCCESS - use text matching
            if (messageText.includes('allows you to imprison') ||
                messageText.includes('imprisoned for')) {
                isSuccess = true;
                DEBUG && console.log(`[WS${this.wsNumber}] ✅ SUCCESS detected via text match`);
            }

            // Handle 3-second error (TOO SLOW!)
            if (is3SecondError) {
                this.threesec = true;
                this.consecutiveErrors++;  // Track for adaptive step size
                this.consecutiveSuccesses = 0;  // Reset success counter
                this.addLog(this.wsNumber, `❌ 3-second error - Too slow!`);

                // Set result so 150ms timeout knows what arrived
                this.pending850Result = '3S_ERROR';

                // Skip ONLY if 150ms timeout already fired AND already recorded something
                if (!this.pending850Response && this.pending850AlreadyRecorded) {
                    DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Late 850 (3S_ERROR) — already recorded by timeout, skipping`);
                    return;
                }

                // Mark as recorded so 150ms timeout won't double-write
                this.pending850AlreadyRecorded = true;

                // ✅ Record 3S_ERROR to database
                DEBUG && console.log(`[WS${this.wsNumber}] 📊 Recording metric: 3S_ERROR`);
                if (this.rivalDetectedTime && this.currentTargetName && this.actionSentTime) {
                    const timestampMs = this.actionSentTime - this.rivalDetectedTime;
                    fileLogger.imprisonResult(this.wsNumber, '3S_ERROR', this.currentTargetName, timestampMs);
                    const codeUsed = this.currentCodeType || 'primary';
                    const isClanMember = this.isUserInBotGang(this.currentTargetName);
                    const timingType = this.status || 'attack';
                    const timingValue = this.getTimingForMetrics(timingType);
                    const pingMs = this.getCurrentPing();
                    const context = this.getContextFromPing();

                    this.recordImprisonmentMetric(
                        this.currentTargetName,
                        codeUsed,
                        isClanMember,
                        timestampMs,
                        false,  // isSuccess = false
                        timingValue,
                        timingType,
                        pingMs,
                        context,
                        '3S_ERROR',
                        false  // isDefense = false
                    ).catch(err => {
                        console.error(`[WS${this.wsNumber}] Failed to record 3S_ERROR:`, err);
                    });

                    // 🧠 AI CORE: Learn from 3S_ERROR only when state is valid
                    await this.learnFromResult('3S_ERROR');

                    // ✅ Clear tracking to prevent LEFT_EARLY from triggering
                    this.rivalDetectedTime = null;
                    this.currentTargetName = null;
                    this.actionSentTime = null;
                }

                // Timer Shift: Only adjust relevant timing based on status
                DEBUG && console.log(`[WS${this.wsNumber}] 3S ERROR - AI Status: aiEnabled=${this.aiEnabled}, timershift=${this.config.timershift}`);
                if (this.config.timershift && !this.aiEnabled) {
                    const oldValue = this.status === "attack"
                        ? parseInt(this.config[`attack${this.wsNumber}`] || 1940)
                        : parseInt(this.config[`waiting${this.wsNumber}`] || 1910);

                    if (this.status === "attack") {
                        this.incrementAttack();

                        const newValue = parseInt(this.config[`attack${this.wsNumber}`] || 1940);
                        fileLogger.autoInterval(this.wsNumber, oldValue, newValue, '3s error');
                    } else if (this.status === "defense") {
                        this.incrementDefence();

                        const newValue = parseInt(this.config[`waiting${this.wsNumber}`] || 1910);
                        fileLogger.autoInterval(this.wsNumber, oldValue, newValue, '3s error');
                    } else {
                        this.incrementAttack();

                        const newValue = parseInt(this.config[`attack${this.wsNumber}`] || 1940);
                        fileLogger.autoInterval(this.wsNumber, oldValue, newValue, '3s error');
                    }
                }
            }

            // Handle success event (we actually imprisoned someone!)
            if (isSuccess) {
                this.consecutiveErrors = 0;  // Reset error counter
                this.consecutiveSuccesses++;  // Track successes
                this.addLog(this.wsNumber, `✅ Success - Imprisoned target!`);

                // Set result so 150ms timeout knows what arrived
                this.pending850Result = 'SUCCESS';

                console.log(`[WS${this.wsNumber}] 🔍 SUCCESS CHECK: pending850Response=${this.pending850Response}, pending850AlreadyRecorded=${this.pending850AlreadyRecorded}`);

                // Skip ONLY if 150ms timeout already fired AND already recorded something
                if (!this.pending850Response && this.pending850AlreadyRecorded) {
                    console.log(`[WS${this.wsNumber}] ⚠️ Late 850 (SUCCESS) — already recorded by timeout, skipping`);
                    return;
                }

                // Mark as recorded so 150ms timeout won't double-write
                this.pending850AlreadyRecorded = true;

                // Update timer status to success
                this.timerStatus.state = 'success';
                this.timerStatus.lastUpdate = Date.now();

                // ✅ Record SUCCESS to database
                console.log(`[WS${this.wsNumber}] 📊 SUCCESS RECORD: rivalDetectedTime=${this.rivalDetectedTime}, currentTargetName=${this.currentTargetName}, actionSentTime=${this.actionSentTime}`);
                if (this.rivalDetectedTime && this.currentTargetName && this.actionSentTime) {
                    const timestampMs = this.actionSentTime - this.rivalDetectedTime;
                    fileLogger.imprisonResult(this.wsNumber, 'SUCCESS', this.currentTargetName, timestampMs);
                    const codeUsed = this.currentCodeType || 'primary';
                    const isClanMember = this.isUserInBotGang(this.currentTargetName);
                    const timingType = this.status || 'attack';
                    const timingValue = this.getTimingForMetrics(timingType);
                    const pingMs = this.getCurrentPing();
                    const context = this.getContextFromPing();

                    this.recordImprisonmentMetric(
                        this.currentTargetName,
                        codeUsed,
                        isClanMember,
                        timestampMs,
                        true,  // isSuccess = true
                        timingValue,
                        timingType,
                        pingMs,
                        context,
                        'SUCCESS',
                        false  // isDefense = false
                    ).catch(err => {
                        console.error(`[WS${this.wsNumber}] Failed to record SUCCESS:`, err);
                    });

                    // 🧠 AI CORE: Learn from SUCCESS only when state is valid
                    await this.learnFromResult('SUCCESS');

                    // ✅ Clear tracking to prevent LEFT_EARLY from triggering
                    this.rivalDetectedTime = null;
                    this.currentTargetName = null;
                    this.actionSentTime = null;
                } else {
                    console.log(`[WS${this.wsNumber}] ⚠️ SUCCESS SKIPPED DB — null fields: rivalDetectedTime=${this.rivalDetectedTime}, currentTargetName=${this.currentTargetName}, actionSentTime=${this.actionSentTime}`);
                    fileLogger.imprisonResult(this.wsNumber, 'SUCCESS-SKIPPED(null-fields)', 'unknown', 0);
                }

                // Timer Shift: Only adjust relevant timing based on status
                DEBUG && console.log(`[WS${this.wsNumber}] SUCCESS - AI Status: aiEnabled=${this.aiEnabled}, timershift=${this.config.timershift}`);
                if (this.config.timershift && !this.aiEnabled) {
                    const oldValue = this.status === "attack"
                        ? parseInt(this.config[`attack${this.wsNumber}`] || 1940)
                        : parseInt(this.config[`waiting${this.wsNumber}`] || 1910);

                    if (this.status === "attack") {
                        this.decrementAttack();

                        const newValue = parseInt(this.config[`attack${this.wsNumber}`] || 1940);
                        fileLogger.autoInterval(this.wsNumber, oldValue, newValue, 'success');
                    } else if (this.status === "defense") {
                        this.decrementDefence();

                        const newValue = parseInt(this.config[`waiting${this.wsNumber}`] || 1910);
                        fileLogger.autoInterval(this.wsNumber, oldValue, newValue, 'success');
                    } else {
                        this.decrementAttack();

                        const newValue = parseInt(this.config[`attack${this.wsNumber}`] || 1940);
                        fileLogger.autoInterval(this.wsNumber, oldValue, newValue, 'success');
                    }
                }
            }

            const statusText = snippets.slice(1).join(" ").substring(0, 80);
            if (statusText) {

            }
        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handle850Message:`, error);
        }
    }
    handle452Message(ws, snippets, text, messageArrivalTime = Date.now()) {

    }

    // ==================== ESCAPE LOGIC ====================
    async escapeAll() {
        // Check prison status using the reliable 854 check
        if (!this.prisonConfirmed && !this.inPrison) {
            DEBUG && console.log(`[WS${this.wsNumber}] Not in prison (prisonConfirmed=${this.prisonConfirmed}, inPrison=${this.inPrison}), skipping escape`);

            return false;
        }

        DEBUG && console.log(`[WS${this.wsNumber}] 🔓 Starting escape attempt...`);
        this.addLog(this.wsNumber, `🔓 Attempting escape...`);

        const fns = [];
        for (let i = 1; i <= 5; i++) {
            if (this.config[`rc${i}`]) fns.push(this.escapeWithCode(this.config[`rc${i}`], `RC${i}`));
            if (this.config[`rcl${i}`]) fns.push(this.escapeWithCode(this.config[`rcl${i}`], `RCL${i}`));
        }

        if (fns.length === 0) {
            DEBUG && console.log(`[WS${this.wsNumber}] ❌ No recovery codes configured`);
            this.addLog(this.wsNumber, `❌ No recovery codes configured`);
            return false;
        }

        DEBUG && console.log(`[WS${this.wsNumber}] Trying ${fns.length} recovery code(s)...`);

        const results = await Promise.all(fns);
        const success = results.some(r => r === true);

        if (success) {
            DEBUG && console.log(`[WS${this.wsNumber}] ✅ Escape API call successful!`);
            this.addLog(this.wsNumber, `✅ Escape successful!`);

            // Set flag to rejoin target planet on next reconnect
            this.setShouldRejoinPlanet(true);

            // Clear prison flags (will be re-confirmed by 854 if still in prison)
            this.prisonConfirmed = false;
            this.inPrison = false;
            this.currentPlanet = null;
        } else {
            DEBUG && console.log(`[WS${this.wsNumber}] ❌ All escape attempts failed`);
            this.addLog(this.wsNumber, `❌ Escape failed - check recovery codes`);
        }

        return success;
    }

    async escapeWithCode(recoveryCode, label) {
        if (!recoveryCode || recoveryCode === '') {
            return false;
        }

        if (!this.useridg || !this.passwordg) {
            DEBUG && console.log(`[WS${this.wsNumber}] No credentials for escape`);
            return false;
        }

        const userID = this.useridg;
        const password = this.passwordg;

        DEBUG && console.log(`[WS${this.wsNumber}] Escape attempt: userID=${userID}, label=${label}`);

        // ✅ RECORD KICKED DATA WHEN ESCAPE IS ATTEMPTED
        // This handles cases where prison was detected via escape attempt (not 332 message)
        if (this.aiEnabled && this.aiCore) {
            // Check if we already tracked KICKED (via 332 message)
            if (!this.mlTimingWhenKicked) {
                // Not tracked yet - track now
                if (this.actionSentTime && this.rivalDetectedTime && this.currentTargetName) {
                    // We sent ACTION 3 to a rival - use that timing
                    const action3Timing = this.actionSentTime - this.rivalDetectedTime;
                    this.mlTimingWhenKicked = action3Timing;
                    this.rivalWhoKickedUs = this.currentTargetName;
                    this.wasKickedToPrison = true;
                    DEBUG && console.log(`[WS${this.wsNumber}] 🛡️ KICKED by rival: ${this.rivalWhoKickedUs} (captured at escape attempt)`);
                    DEBUG && console.log(`[WS${this.wsNumber}] 🛡️ ACTION 3 timing used: ${this.mlTimingWhenKicked}ms`);

                } else if (this.aiCore.currentTiming) {
                    // Fallback: Use current AI timing
                    this.mlTimingWhenKicked = this.aiCore.currentTiming;
                    this.rivalWhoKickedUs = this.lastTargetName || this.currentTargetName || 'rival';
                    this.wasKickedToPrison = true;
                    DEBUG && console.log(`[WS${this.wsNumber}] 🛡️ ML timing when kicked (fallback): ${this.mlTimingWhenKicked}ms`);
                }
            }

            // ✅ FIX: Only record if not already recorded (332 handler may have done it)
            if (this.wasKickedToPrison && this.mlTimingWhenKicked && !this.defenseMetricRecorded) {
                DEBUG && console.log(`[WS${this.wsNumber}] 📊 Recording defense metric at escape attempt (not recorded by 332)...`);
                this.recordDefenseMetric().catch(err => {
                    console.error(`[WS${this.wsNumber}] Failed to record defense metric:`, err);
                });
            } else if (this.defenseMetricRecorded) {
                DEBUG && console.log(`[WS${this.wsNumber}] ℹ️ Defense metric already recorded by 332 handler - skipping`);
            }
        };

        const boundary = '----WebKitFormBoundarylRahhWQJyn2QX0gB';
        const formData = [
            `--${boundary}`,
            'Content-Disposition: form-data; name="a"',
            '',
            'jail_free',
            `--${boundary}`,
            'Content-Disposition: form-data; name="type"',
            '',
            'escapeItemDiamond',
            `--${boundary}`,
            'Content-Disposition: form-data; name="usercur"',
            '',
            userID,
            `--${boundary}`,
            'Content-Disposition: form-data; name="ajax"',
            '',
            '1',
            `--${boundary}--`
        ].join('\r\n');

        const url = `https://galaxy.mobstudio.ru/services/?&userID=${userID}&password=${password}&query_rand=${Math.random()}`;
        const parsedUrl = new URL(url);

        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(formData),
                'Accept': '*/*',
                'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
                'Priority': 'u=1, i',
                'Sec-CH-UA': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
                'Sec-CH-UA-Mobile': '?0',
                'Sec-CH-UA-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'X-Galaxy-Client-Ver': '9.5',
                'X-Galaxy-Kbv': '352',
                'X-Galaxy-Lng': 'en',
                'X-Galaxy-Model': 'chrome 137.0.0.0',
                'X-Galaxy-Orientation': 'portrait',
                'X-Galaxy-Os-Ver': '1',
                'X-Galaxy-Platform': 'web',
                'X-Galaxy-Scr-Dpi': '1',
                'X-Galaxy-Scr-H': '675',
                'X-Galaxy-Scr-W': '700',
                'X-Galaxy-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
            }
        };

        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    const responsePreview = data ? data.substring(0, 200).replace(/\s+/g, ' ') : 'empty';
                    DEBUG && console.log(`[WS${this.wsNumber}] ${label} escape response:`, responsePreview);

                    if (!data || data.length === 0) {
                        this.addLog(this.wsNumber, `⚠️ Empty response from escape API`);
                        resolve(false);
                    } else if (data.includes("Wrong escape type")) {
                        this.addLog(this.wsNumber, `⚠️ Wrong escape type (no diamond or not in prison)`);
                        resolve(false);
                    } else if (data.includes("not in prison") || data.includes("not imprisoned")) {

                        resolve(false);
                    } else if (data.includes("error") || data.includes("Error") || data.includes('"success":false')) {
                        DEBUG && console.log(`[WS${this.wsNumber}] ${label}: Escape failed - API error`);
                        this.addLog(this.wsNumber, `❌ ${label} failed`);
                        resolve(false);
                    } else if (data.includes('"freeResult":{"success":true}') || data.includes('"success":true') || data.includes("escaped") || data.includes("free")) {
                        DEBUG && console.log(`[WS${this.wsNumber}] ${label}: Escape successful!`);
                        this.addLog(this.wsNumber, `✅ ${label} escape successful!`);
                        resolve(true);
                    } else {
                        DEBUG && console.log(`[WS${this.wsNumber}] ${label}: Unknown response`);
                        this.addLog(this.wsNumber, `❓ ${label} unknown response`);
                        resolve(false);
                    }
                });
                res.on('error', (error) => {
                    this.addLog(this.wsNumber, `❌ Escape error: ${error.message}`);
                    resolve(false);
                });
            });

            req.on('error', (error) => {
                console.error(`[WS${this.wsNumber}] Escape error (${label}):`, error);
                this.addLog(this.wsNumber, `❌ ${label} error: ${error.message}`);
                resolve(false);
            });

            req.write(formData);
            req.end();
        });
    }

    OffSleep(ws) {
        try {
            DEBUG && console.log(`[WS${this.wsNumber}] ⏰ OffSleep called - config.connected=${this.config.connected}, retryCount=${this.offSleepRetryCount}, isActive=${this.isOffSleepActive}`);


            // RACE CONDITION FIX: Prevent multiple simultaneous reconnect attempts
            if (this.isOffSleepActive) {
                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ OffSleep already active - skipping duplicate call`);

                return;
            }

            // RACE CONDITION FIX: Clear any existing timeout before creating new one
            if (this.reconnectTimeoutId) {
                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ Clearing existing reconnect timeout: ${this.reconnectTimeoutId}`);
                clearTimeout(this.reconnectTimeoutId);
                this.reconnectTimeoutId = null;
            }

            // Check maximum retry limit
            if (this.offSleepRetryCount >= this.maxOffSleepRetries) {
                DEBUG && console.log(`[WS${this.wsNumber}] ❌ Max OffSleep retries (${this.maxOffSleepRetries}) reached - stopping reconnection`);
                this.addLog(this.wsNumber, `❌ Max retries (${this.maxOffSleepRetries}) reached - stopping`);
                this.isOffSleepActive = false;
                this.offSleepRetryCount = 0;
                return;
            }

            // Set flag to prevent race condition
            this.isOffSleepActive = true;

            // CONNECTION STATE FIX: Check if WebSocket is actually closed
            if (ws && ws.readyState !== ws.CLOSED && ws.readyState !== ws.CLOSING) {
                DEBUG && console.log(`[WS${this.wsNumber}] ⚠️ WebSocket not fully closed yet (state: ${ws.readyState}), waiting...`);

            }

            // EXPONENTIAL BACKOFF: Calculate reconnect time with backoff
            const baseReconnectTime = parseInt(this.config.reconnect || 5000);
            const backoffMultiplier = Math.pow(1.5, this.offSleepRetryCount); // 1.5x per retry
            const maxBackoff = 60000; // Max 60 seconds
            const backoffTime = Math.min(baseReconnectTime * backoffMultiplier, maxBackoff);

            // Add jitter (±20%) to prevent thundering herd
            const jitterRange = backoffTime * 0.2;
            const jitter = (Math.random() * jitterRange * 2) - jitterRange;
            const reconnectTime = Math.max(100, Math.floor(backoffTime + jitter)); // Min 100ms

            DEBUG && console.log(`[WS${this.wsNumber}] Reconnect timing: base=${baseReconnectTime}ms, backoff=${Math.floor(backoffTime)}ms, jitter=${Math.floor(jitter)}ms, final=${reconnectTime}ms`);
            this.addLog(this.wsNumber, `⏱️ Reconnect in ${Math.floor(reconnectTime / 1000)}s (retry ${this.offSleepRetryCount + 1}/${this.maxOffSleepRetries})`);

            // Increment retry count
            this.offSleepRetryCount++;

            const timeoutId = setTimeout(() => {
                // Double-check if user disconnected before reconnecting
                DEBUG && console.log(`[WS${this.wsNumber}] Reconnect timeout fired - checking connected=${this.config.connected}`);


                if (!this.config.connected && typeof this.config.connected !== 'undefined') {
                    DEBUG && console.log(`[WS${this.wsNumber}] ❌ User disconnected - skipping auto-reconnect`);

                    this.isOffSleepActive = false;
                    this.offSleepRetryCount = 0;
                    this.reconnectTimeoutId = null;
                    return;
                }

                DEBUG && console.log(`[WS${this.wsNumber}] ✅ Proceeding with auto-reconnect`);


                // Clear the stored timeout ID before reconnecting
                this.reconnectTimeoutId = null;

                // Reset OffSleep flag before reconnecting
                this.isOffSleepActive = false;

                // reconnectCallback will also check if user disconnected
                if (this.reconnect) {
                    DEBUG && console.log(`[WS${this.wsNumber}] 🔄 Calling reconnect callback for WS${this.wsNumber}`);
                    this.reconnect(this.wsNumber);
                } else {
                    console.error(`[WS${this.wsNumber}] ❌ ERROR: reconnect callback is not defined!`);

                    this.isOffSleepActive = false;
                    this.offSleepRetryCount = 0;
                }
            }, reconnectTime);

            // Store timeout ID so it can be cleared if needed
            this.reconnectTimeoutId = timeoutId;
            DEBUG && console.log(`[WS${this.wsNumber}] Stored reconnectTimeoutId=${timeoutId}`);


        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in OffSleep:`, error);
            this.isOffSleepActive = false;
            this.offSleepRetryCount = 0;
            this.reconnectTimeoutId = null;
        }
    }

    // ==================== PRIVMSG HANDLER (AI CHAT) ====================

    /**
     * Handle PRIVMSG (private messages from users)
     * Format: PRIVMSG <senderUserId> 1 <botUserId> :<senderUsername>, <message>
     * Example: PRIVMSG 80719261 1 55061863 :Heart}{breaker, wah
     * 
     * Response Format: PRIVMSG 0 0 :<response>
     * Example: PRIVMSG 0 0 :hi
     */
    async handlePrivmsgMessage(ws, snippets, text, messageArrivalTime = Date.now()) {
        try {
            DEBUG && console.log(`[WS${this.wsNumber}] 💬 PRIVMSG received: ${text}`);

            // Check if AI Chat is enabled
            if (!this.aiChatEnabled) {
                DEBUG && console.log(`[WS${this.wsNumber}] AI Chat disabled - ignoring PRIVMSG`);
                return;
            }

            // Parse message format: PRIVMSG <senderUserId> 1 <botUserId> :<senderUsername>, <message>
            // Example: PRIVMSG 80719261 1 55061863 :Heart}{breaker, wah
            if (snippets.length < 4) {
                console.warn(`[WS${this.wsNumber}] Invalid PRIVMSG format:`, text);
                return;
            }

            const senderUserId = snippets[1];
            const botUserId = snippets[3];

            // Verify this message is for our bot
            if (botUserId !== this.useridg) {
                DEBUG && console.log(`[WS${this.wsNumber}] PRIVMSG not for this bot (expected: ${this.useridg}, got: ${botUserId})`);
                return;
            }

            // Extract message content after the colon
            const colonIndex = text.indexOf(':');
            if (colonIndex === -1) {
                console.warn(`[WS${this.wsNumber}] No message content in PRIVMSG`);
                return;
            }

            const fullMessage = text.substring(colonIndex + 1).trim();

            // Parse sender username and actual message
            // Format: <senderUsername>, <message>
            const commaIndex = fullMessage.indexOf(',');
            if (commaIndex === -1) {
                console.warn(`[WS${this.wsNumber}] Could not parse username and message:`, fullMessage);
                return;
            }

            const senderUsername = fullMessage.substring(0, commaIndex).trim();
            const userMessage = fullMessage.substring(commaIndex + 1).trim();

            DEBUG && console.log(`[WS${this.wsNumber}] 💬 Sender: ${senderUsername} (ID: ${senderUserId})`);
            DEBUG && console.log(`[WS${this.wsNumber}] 💬 Message: "${userMessage}"`);
            DEBUG && console.log(`[WS${this.wsNumber}] 💬 Bot ID: ${this.useridg}`);

            // ==================== CHECK FOR KICK COMMAND ====================
            // Pattern: "kick [username]" or "imprison [username]"
            const kickMatch = userMessage.match(/^(kick|imprison)\s+(.+)$/i);

            if (kickMatch) {
                const targetName = kickMatch[2].trim();
                DEBUG && console.log(`[WS${this.wsNumber}] 🎯 Kick command detected - Target: ${targetName}`);

                // Find user on planet
                const targetUser = this.findUserByName(targetName);

                if (!targetUser) {
                    // User not found on planet
                    const notFoundResponse = `${targetName} is not on this planet right now.`;
                    DEBUG && console.log(`[WS${this.wsNumber}] ❌ Target not found: ${targetName}`);

                    // Send response
                    const responseMessage = `PRIVMSG 0 0 :${notFoundResponse}\r\n`;
                    this.safeSend(ws, responseMessage, "AI_CHAT");
                    this.addLog(this.wsNumber, `💬 AI: ${senderUsername} → "${notFoundResponse}"`);
                    return;
                }

                // User found - execute kick
                DEBUG && console.log(`[WS${this.wsNumber}] ✅ Target found: ${targetUser.originalUsername} (ID: ${targetUser.userid})`);

                // Send ACTION 3 immediately
                const action3Message = `ACTION 3 ${targetUser.userid}\r\n`;
                const sent = this.safeSend(ws, action3Message, "CHAT_KICK");

                if (sent) {
                    DEBUG && console.log(`[WS${this.wsNumber}] ⚔️ Sent ACTION 3 to ${targetUser.originalUsername} (requested by ${senderUsername})`);
                    this.addLog(this.wsNumber, `⚔️ Chat kick: ${targetUser.originalUsername} (by ${senderUsername})`);

                    // Send confirmation response
                    const confirmResponse = `Kicking ${targetUser.originalUsername} now!`;
                    const responseMessage = `PRIVMSG 0 0 :${confirmResponse}\r\n`;

                    // Small delay before response (human-like)
                    setTimeout(() => {
                        this.safeSend(ws, responseMessage, "AI_CHAT");
                    }, 500);
                } else {
                    console.error(`[WS${this.wsNumber}] ❌ Failed to send ACTION 3`);

                    // Send error response
                    const errorResponse = `Failed to kick ${targetUser.originalUsername}. Connection issue.`;
                    const responseMessage = `PRIVMSG 0 0 :${errorResponse}\r\n`;
                    this.safeSend(ws, responseMessage, "AI_CHAT");
                }

                return; // Don't process as normal chat
            }

            // ==================== NORMAL AI CHAT RESPONSE ====================

            // Initialize AI Chat service if not already done
            if (!this.aiChatService) {
                const { AIChatService } = require("../ai/AIChatService");
                this.aiChatService = new AIChatService(this.aiChatApiKey);
                DEBUG && console.log(`[WS${this.wsNumber}] 🤖 AI Chat service initialized`);
            }

            // Generate AI response
            DEBUG && console.log(`[WS${this.wsNumber}] 🤖 Generating AI response...`);
            const aiResponse = await this.aiChatService.generateResponse(
                senderUserId,
                senderUsername,
                userMessage,
                this.finalusername  // Use our bot's actual username
            );

            // ✅ Check if response is null (empty message was ignored)
            if (aiResponse === null) {
                DEBUG && console.log(`[WS${this.wsNumber}] ⏭️ Empty message ignored, no response needed`);
                return;
            }

            DEBUG && console.log(`[WS${this.wsNumber}] 🤖 AI Response: "${aiResponse}"`);

            // ✅ REMOVED: Human-like delay is now handled inside AIChatService
            // The service queues messages and processes them with proper delays

            // Send response back in chat
            // Format: PRIVMSG 0 0 :<response>
            const responseMessage = `PRIVMSG 0 0 :${aiResponse}\r\n`;

            DEBUG && console.log(`[WS${this.wsNumber}] 📤 Sending response: ${responseMessage.trim()}`);

            const sent = this.safeSend(ws, responseMessage, "AI_CHAT");

            if (sent) {
                DEBUG && console.log(`[WS${this.wsNumber}] ✅ AI Chat response sent`);
                this.addLog(this.wsNumber, `💬 AI: ${senderUsername} asked "${userMessage}" → "${aiResponse}"`);
            } else {
                console.error(`[WS${this.wsNumber}] ❌ Failed to send AI Chat response`);
            }

        } catch (error) {
            console.error(`[WS${this.wsNumber}] Error in handlePrivmsgMessage:`, error);
            this.addLog(this.wsNumber, `❌ AI Chat error: ${error.message}`);
        }
    }

    destroy() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
        }
        if (this.innerTimeouts && this.innerTimeouts.length > 0) {
            this.innerTimeouts.forEach(t => clearTimeout(t));
            this.innerTimeouts = [];
        }
        this.resetState();
    }

    getState() {
        return {
            wsNumber: this.wsNumber,
            id: this.id,
            username: this.finalusername,
            targetids: Array.from(this.targetids),
            targetnames: Array.from(this.targetnames.entries()),
            attackids: Array.from(this.attackids),
            attacknames: Array.from(this.attacknames.entries()),
            useridtarget: this.useridtarget,
            useridattack: this.useridattack,
            userFound: this.userFound,
            status: this.status,
            threesec: this.threesec,
            targetCount: this.targetids.size,
            attackCount: this.attackids.size,
            currentAttackTiming: this.config[`attack${this.wsNumber}`],
            currentWaitingTiming: this.config[`waiting${this.wsNumber}`]
        };
    }
}

module.exports = GameLogic;
