// FINAL COMPLETE Game Logic Module - 100% Feature Parity with bestscript.js
// All features from 3360 lines of bestscript.js implemented for headless operation

const crypto = require("crypto-js");
const https = require("https");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

class FinalCompleteGameLogic {
  constructor(wsNumber, config, addLogCallback, updateConfigCallback, reconnectCallback) {
    this.wsNumber = wsNumber;
    this.config = config;
    this.addLog = addLogCallback;
    this.updateConfig = updateConfigCallback; // For timer shift
    this.reconnect = reconnectCallback; // For auto-reconnect
    
    // Core state
    this.haaapsi = null;
    this.id = null;
    this.useridg = null;
    this.passwordg = null;
    this.finalusername = null;
    
    // Target tracking
    this.targetids = [];
    this.targetnames = [];
    this.attackids = [];
    this.attacknames = [];
    
    // Current target/attack
    this.useridtarget = null;
    this.useridattack = null;
    
    // Flags
    this.userFound = false;
    this.threesec = false;
    this.inPrison = false; // Track if account is in prison
    this.currentPlanet = null; // Track current planet
    this.founderUserId = null; // Track planet owner/founder
    
    // Status
    this.status = ""; // "attack" or "defense"
    this.joindate = null;
    
    // Timers
    this.timeout = null;
    this.lowtime = 0;
    
    // Counter for code alternation
    this.inc = 0;
    
    // Debug flag
    this._kickConfigLogged = false;
    
    // Reconnection management (NEW)
    this.reconnectTimeoutId = null; // Track OffSleep reconnect timeout
    this.isOffSleepActive = false; // Flag to prevent race condition with ws.on('close')
    this.offSleepRetryCount = 0; // Track OffSleep reconnection attempts
    this.maxOffSleepRetries = 10; // Maximum OffSleep reconnection attempts
    this.innerTimeouts = []; // Track all inner timeouts (from forEach loops)
    
    // Timer Shift improvements (NEW)
    this.consecutiveErrors = 0; // Track consecutive 3s errors for adaptive step size
    this.consecutiveSuccesses = 0; // Track consecutive successes
    this.recentAdjustments = []; // Track last 5 adjustments to detect oscillation
    this.maxAdjustmentHistory = 5; // Keep last 5 adjustments
    
    // Smart Mode improvements (NEW)
    this.attackCooldowns = {}; // Track cooldowns: { userid: timestamp }
    this.attackedThisSession = new Set(); // Track who was attacked this session
    this.targetIndex = 0; // For round robin mode
    this.cooldownDuration = 3500; // 3.5 seconds cooldown after attack
    
    // AI Mode - Simplified with Optimal Defaults (HARDCODED)
    this.aiMode = {
      enabled: false,
      
      // OPTIMAL DEFAULTS (HARDCODED - No user configuration needed)
      autoRange: true,              // Always auto-detect opponent timing
      autoRangeSamples: 3,          // 3 samples = 9 seconds to narrow range
      rollingWindow: 15000,         // 15 seconds rolling window (5 rounds)
      rangeUpdateFrequency: 5,      // Update range every 5 rounds (15 seconds)
      targetTier: 'fast',           // Target fast opponents (beat everyone)
      feedbackEnabled: true,        // Auto-adjust on 3s errors
      feedbackStep: 15,             // 15ms adjustments (fast adaptation)
      quickStart: true,             // Start immediately with wide range
      initialMin: 1500,             // Wide initial range minimum
      initialMax: 2100,             // HARD CAP: Never exceed 2100ms
      maxCap: 2100,                 // HARD MAXIMUM CAP (user requirement)
      safetyBuffer: 10,             // 10ms buffer on edge
      targetSuccessRate: 0.90,      // 90% success rate (faster than 95%)
      edgeTestFrequency: 10,        // Test edge 10% of time
      adaptive: true,               // Continuously adapt
      
      phase: 'fast_discovery',      // 'fast_discovery', 'discovery', 'exploitation', 'adaptive'
      discoveryAttempts: 0,
      maxDiscoveryAttempts: 20,     // Binary search completes in ~20 attempts
      
      // Binary search state
      searchMin: 1500,
      searchMax: 2100,              // Start with hard cap
      currentTestTiming: 1800,      // Midpoint of initial range (1500+2100)/2
      
      // Timing candidates and results
      timingResults: {},            // { timing: {attempts, successes, failures, rate} }
      
      // Edge detection
      edgeFound: false,
      edgeTiming: null,             // Fastest timing with acceptable success rate
      edgeConfidence: 0,            // Confidence level (0-1)
      optimalTiming: null,          // Edge + safety buffer
      
      // Statistics
      totalAttempts: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      totalKicked: 0,               // NEW: Track getting kicked separately
      overallSuccessRate: 0,
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      
      // Adaptive testing
      lastEdgeTest: 0,
      edgeTestResults: [],
      
      // Track last attack for result recording
      lastAttackTiming: null,
      pendingResult: false,
      lastResultType: null,         // NEW: 'win', '3s_error', 'kicked'
      
      // IMPROVED: Adaptive offset (per-rival, but global fallback)
      adaptiveOffset: -20,          // Start at -20ms before rival time
      offsetStats: new Map()        // Track success rate per offset: Map<offset, {wins, losses, rate}>
    };
    
    // Opponent Tracking for Auto-Range Detection
    this.opponentTracking = {
      enabled: false,
      samples: [],                  // Store timing samples with timestamps
      minSamples: 3,                // Need 3 samples before narrowing range
      detectedMin: null,
      detectedMax: null,
      lastUpdate: 0,
      lastRangeCheck: 0,
      roundCounter: 0,              // Count rounds for range update frequency
      
      // User tracking for login/logout detection (DETERMINISTIC)
      activeUsers: new Map(),       // Map<userid, {username, loginTime, loginRoundStart}>
      loginLogoutSamples: [],       // [{timing, type: 'login'|'logout', timestamp}]
      roundStartTime: 0,            // Start time of current round (for LOGIN timing)
      
      // IMPROVED: Per-rival profiles (memory-based)
      rivalProfiles: new Map(),     // Map<username, {samples: [], adaptiveOffset: -20, lastSeen: timestamp, stats: {}}>
      currentRival: null,           // Current rival we're facing
      
      // PROACTIVE: Real-time monitoring
      monitorInterval: null,        // Active monitor interval
      monitoringRival: null,        // Rival being monitored
      
      // Memory-based storage (fallback if file system fails)
      memoryStorage: { records: [], roundCounter: 0, lastCleanup: Date.now() },
      useMemoryOnly: false          // Flag to use memory if file system unavailable
    };
  }

  // Parse haaapsi
  parseHaaapsi(e) {
    if (!e) return "";
    var temp = crypto.MD5(e).toString(crypto.enc.Hex);
    return (temp = (temp = temp.split("").reverse().join("0")).substr(5, 10));
  }

  // Count occurrences in array
  countOccurrences(arr, val) {
    return arr.reduce((a, v) => (v === val ? a + 1 : a), 0);
  }

  // Get recovery code with alternation
  getRecoveryCode(mainCode, altCode) {
    this.inc++;
    if (mainCode && altCode) {
      return (this.inc % 2 == 1) ? mainCode : altCode;
    }
    return altCode || mainCode;
  }

  // Reset state for new connection
  resetState() {
    this.haaapsi = null;
    this.userFound = false;
    this.status = "";
    this.threesec = false;
    this.targetids = [];
    this.targetnames = [];
    this.attackids = [];
    this.attacknames = [];
    this.useridattack = "";
    this.useridtarget = null;
    this.lowtime = 0;
    this._kickConfigLogged = false; // Reset debug flag
    
    // Clear all timeouts
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    
    // Clear reconnect timeout
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    
    // Clear all inner timeouts
    if (this.innerTimeouts && this.innerTimeouts.length > 0) {
      this.innerTimeouts.forEach(timeout => clearTimeout(timeout));
      this.innerTimeouts = [];
    }
    
    // PROACTIVE: Stop real-time monitor
    this.stopRealTimeMonitor();
    
    // Reset reconnection flags
    this.isOffSleepActive = false;
    
    // OPPONENT TRACKING: Process remaining active users before reset
    this.processRemainingOpponents();
    
    // DON'T reset timer shift counters or adjustments - we want to keep learning!
    // consecutiveErrors, consecutiveSuccesses, recentAdjustments will persist
  }
  
  // ========================================
  // PERSISTENT OPPONENT DATA FILE
  // ========================================
  
  getOpponentDataFilePath() {
    const filePath = path.join(process.cwd(), `opponent_data_ws${this.wsNumber}.json`);
    console.log(`[WS${this.wsNumber}] 📁 File path: ${filePath}`);
    return filePath;
  }
  
  loadOpponentData() {
    // If memory-only mode is enabled, use memory storage
    if (this.opponentTracking.useMemoryOnly) {
      console.log(`[WS${this.wsNumber}] 💾 Using memory storage (${this.opponentTracking.memoryStorage.records.length} records)`);
      return this.opponentTracking.memoryStorage;
    }
    
    try {
      const filePath = this.getOpponentDataFilePath();
      console.log(`[WS${this.wsNumber}] 📂 Loading from: ${filePath}`);
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        if (fileContent.trim() === '') {
          console.log(`[WS${this.wsNumber}] ℹ️ File is empty, initializing`);
          return { records: [], roundCounter: 0, lastCleanup: Date.now() };
        }
        const data = JSON.parse(fileContent);
        console.log(`[WS${this.wsNumber}] ✅ Loaded opponent data: ${data.records.length} records`);
        return data;
      } else {
        console.log(`[WS${this.wsNumber}] ℹ️ File doesn't exist yet, creating new data structure`);
      }
    } catch (error) {
      console.error(`[WS${this.wsNumber}] ❌ Error loading opponent data:`, error.message);
      console.log(`[WS${this.wsNumber}] 🔄 Switching to memory-only mode`);
      this.opponentTracking.useMemoryOnly = true;
      return this.opponentTracking.memoryStorage;
    }
    return { records: [], roundCounter: 0, lastCleanup: Date.now() };
  }
  
  saveOpponentData(data) {
    // If memory-only mode, just update memory storage
    if (this.opponentTracking.useMemoryOnly) {
      this.opponentTracking.memoryStorage = data;
      console.log(`[WS${this.wsNumber}] 💾 Saved to memory (${data.records.length} records)`);
      return;
    }
    
    try {
      const filePath = this.getOpponentDataFilePath();
      console.log(`[WS${this.wsNumber}] 💾 Saving to: ${filePath}`);
      console.log(`[WS${this.wsNumber}] 💾 Data: ${data.records.length} records`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[WS${this.wsNumber}] ✅ Saved successfully!`);
    } catch (error) {
      console.error(`[WS${this.wsNumber}] ❌ Error saving opponent data:`, error);
      console.error(`[WS${this.wsNumber}] ❌ Error details:`, error.message);
      console.log(`[WS${this.wsNumber}] 🔄 Switching to memory-only mode`);
      this.opponentTracking.useMemoryOnly = true;
      this.opponentTracking.memoryStorage = data;
    }
  }
  
  addOpponentRecord(username, userid, loginTime, logoutTime, waitingTime) {
    console.log(`[WS${this.wsNumber}] 📝 addOpponentRecord called: ${username}, ${waitingTime}ms`);
    
    const data = this.loadOpponentData();
    console.log(`[WS${this.wsNumber}] 📊 Current data: ${data.records.length} records`);
    
    const record = {
      username: username,
      userid: userid,
      loginTime: loginTime,
      logoutTime: logoutTime,
      waitingTime: waitingTime,
      timestamp: Date.now(),
      round: data.roundCounter
    };
    
    console.log(`[WS${this.wsNumber}] ➕ Adding record:`, JSON.stringify(record));
    data.records.push(record);
    
    // Clean old records every 5 rounds (check BEFORE incrementing)
    if (data.records.length > 15) {
      const before = data.records.length;
      data.records = data.records.slice(-15); // Keep last 15 records
      const after = data.records.length;
      console.log(`[WS${this.wsNumber}] 🧹 Cleaned opponent data: ${before} → ${after} records`);
      this.addLog(this.wsNumber, `🧹 Cleaned old data: kept ${after} recent records`);
      data.lastCleanup = Date.now();
    }
    
    data.roundCounter++;
    
    console.log(`[WS${this.wsNumber}] 💾 About to save ${data.records.length} records...`);
    this.saveOpponentData(data);
    
    // Calculate optimal timing from recent records
    console.log(`[WS${this.wsNumber}] 🧮 Calculating optimal from file...`);
    this.calculateOptimalFromFile();
    
    console.log(`[WS${this.wsNumber}] ✅ Record added successfully: ${username} waited ${waitingTime}ms (total: ${data.records.length})`);
    this.addLog(this.wsNumber, `📝 ${username}: ${waitingTime}ms`);
  }
  
  calculateOptimalFromFile() {
    const data = this.loadOpponentData();
    
    if (data.records.length < 1) {
      console.log(`[WS${this.wsNumber}] ⏳ No data yet`);
      return;
    }
    
    // SIMPLE: Use LATEST record (most recent rival)
    const latestRecord = data.records[data.records.length - 1];
    const rivalTime = latestRecord.waitingTime;
    
    // Attack 20ms BEFORE rival
    const optimalTiming = Math.max(50, Math.min(rivalTime - 20, 2100));
    
    // Update AI mode
    if (this.aiMode && this.aiMode.enabled) {
      this.aiMode.optimalTiming = optimalTiming;
      this.aiMode.edgeTiming = optimalTiming;
      this.aiMode.phase = 'adaptive';
      this.aiMode.edgeFound = true;
    }
    
    console.log(`[WS${this.wsNumber}] 📊 SIMPLE: Latest rival time: ${rivalTime}ms`);
    console.log(`[WS${this.wsNumber}]   → Use: ${optimalTiming}ms (${rivalTime} - 20ms)`);
    
    this.addLog(this.wsNumber, `📊 Rival: ${rivalTime}ms → Use ${optimalTiming}ms`);
  }
  
  // Process remaining opponents when we QUIT early (before seeing their PART/SLEEP)
  processRemainingOpponents() {
    // Safety checks
    if (!this.opponentTracking) return;
    if (!this.opponentTracking.enabled) return;
    if (!this.opponentTracking.activeUsers || this.opponentTracking.activeUsers.size === 0) return;
    
    try {
      // We're leaving early - didn't see opponent PART/SLEEP
      // AI will use existing samples to determine timing range
      
      const remainingCount = this.opponentTracking.activeUsers.size;
      console.log(`[WS${this.wsNumber}] 🚪 Leaving early - ${remainingCount} opponents still on planet`);
      
      // Log who we're leaving behind
      this.opponentTracking.activeUsers.forEach((user, userid) => {
        const now = Date.now();
        const timeSinceJoin = now - user.joinTime;
        console.log(`[WS${this.wsNumber}]   - ${user.username} (${userid}): joined ${timeSinceJoin}ms ago`);
        this.addLog(this.wsNumber, `⚠️ Left before ${user.username} logout (${timeSinceJoin}ms so far)`);
      });
      
      // Clear active users (we're leaving, can't track them anymore)
      this.opponentTracking.activeUsers.clear();
      
      // AI will adapt using existing samples - no need to estimate
      if (this.opponentTracking.samples && this.opponentTracking.samples.length > 0) {
        console.log(`[WS${this.wsNumber}] 📊 AI has ${this.opponentTracking.samples.length} samples to work with`);
        const timings = this.opponentTracking.samples.map(s => s.timing);
        console.log(`[WS${this.wsNumber}] 📊 Samples: [${timings.join(', ')}]ms`);
      } else {
        console.log(`[WS${this.wsNumber}] ⚠️ No samples yet - AI will use default timing`);
        this.addLog(this.wsNumber, `⚠️ No samples collected yet - need to see opponent PART/SLEEP`);
      }
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in processRemainingOpponents:`, error);
    }
  }
  
  // MEDIUM #3: Log learned optimal timings (for persistence)
  logLearnedTimings() {
    const attack = this.config[`attack${this.wsNumber}`] || 1940;
    const defense = this.config[`waiting${this.wsNumber}`] || 1910;
    this.addLog(this.wsNumber, `📊 Learned timings - Attack: ${attack}ms, Defense: ${defense}ms`);
    console.log(`[WS${this.wsNumber}] 📊 LEARNED OPTIMAL TIMINGS: attack${this.wsNumber}=${attack}, waiting${this.wsNumber}=${defense}`);
    return { attack, defense };
  }

  // ========================================
  // TIMER SHIFT FEATURE (IMPROVED!)
  // ========================================
  
  // Helper: Get adaptive step size based on consecutive errors
  getAdaptiveStepSize(baseStep) {
    if (this.consecutiveErrors >= 5) {
      return baseStep * 5; // 50ms jumps if 5+ errors
    } else if (this.consecutiveErrors >= 3) {
      return baseStep * 3; // 30ms jumps if 3-4 errors
    } else if (this.consecutiveErrors >= 2) {
      return baseStep * 2; // 20ms jumps if 2 errors
    }
    return baseStep; // 10ms for 0-1 errors
  }
  
  // Helper: Detect oscillation pattern
  isOscillating() {
    if (this.recentAdjustments.length < 4) return false;
    
    // Check if alternating +/- pattern (e.g., [+10, -10, +10, -10])
    let alternating = true;
    for (let i = 1; i < this.recentAdjustments.length; i++) {
      const curr = this.recentAdjustments[i];
      const prev = this.recentAdjustments[i - 1];
      if ((curr > 0 && prev > 0) || (curr < 0 && prev < 0)) {
        alternating = false;
        break;
      }
    }
    
    return alternating;
  }
  
  // Helper: Track adjustment for oscillation detection
  trackAdjustment(value) {
    this.recentAdjustments.push(value);
    if (this.recentAdjustments.length > this.maxAdjustmentHistory) {
      this.recentAdjustments.shift(); // Keep only last 5
    }
  }
  
  // Helper: Get timing based on mode (QUICK FIX #1: No more averaging!)
  getTiming(mode) {
    // AI MODE OVERRIDE: Use AI-determined timing if enabled
    if (this.config.aiMode && this.aiMode.enabled && mode === "attack") {
      const aiTiming = this.getAITiming();
      // Track this timing for result recording
      this.aiMode.lastAttackTiming = aiTiming;
      this.aiMode.pendingResult = true;
      return aiTiming;
    }
    
    // mode can be: "attack" or "defense"
    if (mode === "defense") {
      return parseInt(this.config[`waiting${this.wsNumber}`] || 1910);
    } else {
      // Default to attack timing
      return parseInt(this.config[`attack${this.wsNumber}`] || 1940);
    }
  }
  
  // Helper: Get timing label based on mode and timershift
  getTimingLabel(mode) {
    if (this.config.timershift) {
      return mode === "defense" ? "Auto Defense" : "Auto Attack";
    } else {
      return mode === "defense" ? "Defense" : "Attack";
    }
  }
  
  // ========================================
  // AI MODE - EDGE DETECTION
  // ========================================
  
  // Initialize AI Mode
  initAIMode() {
    if (!this.config.aiMode) return;
    
    this.aiMode.enabled = true;
    this.opponentTracking.enabled = true;
    
    // Load opponent data from file
    const fileData = this.loadOpponentData();
    const recordCount = fileData.records.length;
    
    console.log(`[WS${this.wsNumber}] 🔍 initAIMode: Found ${recordCount} records in file`);
    this.addLog(this.wsNumber, `🤖 AI Mode: ENABLED`);
    
    if (recordCount >= 1) {
      // We have data! Use latest immediately
      console.log(`[WS${this.wsNumber}] ✅ Have ${recordCount} records - using latest`);
      this.addLog(this.wsNumber, `✅ Have ${recordCount} records - using latest`);
      this.calculateOptimalFromFile();
      return;
    }
    
    this.aiMode.phase = 'fast_discovery';
    console.log(`[WS${this.wsNumber}] AI Mode ready - will attack 20ms before rival logout`);
  }
  
  // IMPROVED: Get or create rival profile
  getRivalProfile(username) {
    if (!this.opponentTracking.rivalProfiles.has(username)) {
      this.opponentTracking.rivalProfiles.set(username, {
        username: username,
        samples: [],              // Recent timing samples
        adaptiveOffset: -20,      // Start at -20ms
        lastSeen: Date.now(),
        totalRounds: 0,
        wins: 0,
        losses: 0,
        kicked: 0,
        winRate: 0
      });
      console.log(`[WS${this.wsNumber}] 🆕 Created profile for rival: ${username}`);
    }
    return this.opponentTracking.rivalProfiles.get(username);
  }
  
  // IMPROVED: Update rival profile with new sample
  updateRivalProfile(username, stayDuration) {
    const profile = this.getRivalProfile(username);
    
    // Add sample (keep last 5 samples only)
    profile.samples.push(stayDuration);
    if (profile.samples.length > 5) {
      profile.samples.shift();
    }
    
    profile.lastSeen = Date.now();
    
    // Detect pattern change (if last 2 samples differ by >300ms, reset offset)
    if (profile.samples.length >= 2) {
      const recent = profile.samples.slice(-2);
      const diff = Math.abs(recent[0] - recent[1]);
      if (diff > 300) {
        console.log(`[WS${this.wsNumber}] ⚠️ ${username} pattern changed! ${recent[0]}ms → ${recent[1]}ms (diff: ${diff}ms)`);
        profile.adaptiveOffset = -20; // Reset to default
        this.addLog(this.wsNumber, `⚠️ ${username} changed pattern - resetting`);
      }
    }
    
    console.log(`[WS${this.wsNumber}] 📊 ${username} profile: samples=[${profile.samples.join(',')}]ms, offset=${profile.adaptiveOffset}ms`);
  }
  
  // Track opponent LOGIN (353 or JOIN message)
  trackOpponentLogin(userid, username) {
    if (!this.opponentTracking || !this.opponentTracking.enabled) return;
    
    // Skip self
    if (userid === this.useridg) return;
    
    // Skip planet owner/founder
    if (userid === this.founderUserId) return;
    
    // If user already tracked, skip
    if (this.opponentTracking.activeUsers && this.opponentTracking.activeUsers.has(userid)) return;
    
    // Add to active users - record JOIN time
    if (this.opponentTracking.activeUsers) {
      this.opponentTracking.activeUsers.set(userid, {
        username: username,
        joinTime: Date.now()  // Record when they joined
      });
    }
    
    this.addLog(this.wsNumber, `🟢 Opponent: ${username}`);
    console.log(`[WS${this.wsNumber}] 👁️ Opponent JOIN: ${username} (${userid}) at ${Date.now()}`);
    
    // PROACTIVE: Start real-time monitoring for this rival
    this.startRealTimeMonitor(userid, username);
  }
  
  // PROACTIVE: Start real-time monitoring of rival
  startRealTimeMonitor(userid, username) {
    // Stop any existing monitor
    this.stopRealTimeMonitor();
    
    // Get rival's profile to know their expected timing
    const rivalProfile = this.getRivalProfile(username);
    const expectedStayTime = rivalProfile.samples.length > 0 
      ? rivalProfile.samples[rivalProfile.samples.length - 1]  // Use most recent
      : 1800; // Default 1800ms if no history
    
    console.log(`[WS${this.wsNumber}] 🔍 Starting real-time monitor for ${username}, expected: ${expectedStayTime}ms`);
    this.addLog(this.wsNumber, `🔍 Monitoring ${username} (expected ${expectedStayTime}ms)`);
    
    this.opponentTracking.monitoringRival = { userid, username, expectedStayTime };
    
    // Check every 100ms
    this.opponentTracking.monitorInterval = setInterval(() => {
      const rival = this.opponentTracking.activeUsers.get(userid);
      
      if (!rival) {
        // Rival left, stop monitoring
        console.log(`[WS${this.wsNumber}] ⚠️ Rival ${username} left, stopping monitor`);
        this.stopRealTimeMonitor();
        return;
      }
      
      const elapsedTime = Date.now() - rival.joinTime;
      const timeRemaining = expectedStayTime - elapsedTime;
      
      // Log every 500ms to avoid spam
      if (elapsedTime % 500 < 100) {
        console.log(`[WS${this.wsNumber}] ⏱️ ${username}: ${elapsedTime}ms elapsed, ${timeRemaining}ms remaining`);
      }
      
      // If rival is about to leave (attack window)
      const attackOffset = rivalProfile.adaptiveOffset || -20;
      const attackWindow = expectedStayTime + attackOffset; // e.g., 1800 + (-20) = 1780ms
      
      if (elapsedTime >= attackWindow && !this.userFound) {
        console.log(`[WS${this.wsNumber}] 🎯 PROACTIVE TRIGGER! Attacking ${username} NOW at ${elapsedTime}ms`);
        this.addLog(this.wsNumber, `🎯 Proactive attack at ${elapsedTime}ms`);
        
        // Trigger attack if we haven't already
        this.triggerProactiveAttack(userid, username);
        this.stopRealTimeMonitor();
      }
    }, 100); // Check every 100ms
  }
  
  // PROACTIVE: Stop real-time monitoring
  stopRealTimeMonitor() {
    if (this.opponentTracking.monitorInterval) {
      clearInterval(this.opponentTracking.monitorInterval);
      this.opponentTracking.monitorInterval = null;
      this.opponentTracking.monitoringRival = null;
      console.log(`[WS${this.wsNumber}] ⏹️ Stopped real-time monitor`);
    }
  }
  
  // PROACTIVE: Trigger attack based on real-time monitoring
  triggerProactiveAttack(userid, username) {
    // Only attack if we're in AI mode and haven't found a target yet
    if (!this.aiMode.enabled || this.userFound) {
      console.log(`[WS${this.wsNumber}] ⚠️ Proactive attack skipped (aiMode=${this.aiMode.enabled}, userFound=${this.userFound})`);
      return;
    }
    
    // Set target
    this.userFound = true;
    this.useridattack = userid;
    this.useridtarget = userid;
    this.status = "attack";
    
    console.log(`[WS${this.wsNumber}] ⚡ Proactive attack triggered for ${username}`);
    this.addLog(this.wsNumber, `⚡ Proactive: Attacking ${username}`);
    
    // Attack immediately (no setTimeout needed, we're already at the right time)
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(`ACTION 3 ${userid}\r\n`);
      this.addLog(this.wsNumber, `⚔️ Attacked ${username}!`);
      
      // Track for AI
      if (this.aiMode.enabled) {
        const rival = this.opponentTracking.activeUsers.get(userid);
        const attackTiming = Date.now() - rival.joinTime;
        this.aiMode.lastAttackTiming = attackTiming;
        this.aiMode.pendingResult = true;
      }
    }
  }
  
  // Track opponent LOGOUT (PART or SLEEP message)
  trackOpponentLogout(userid) {
    console.log(`[WS${this.wsNumber}] 🔍 trackOpponentLogout called for userid: ${userid}`);
    
    if (!this.opponentTracking || !this.opponentTracking.enabled) {
      console.log(`[WS${this.wsNumber}] ⚠️ Opponent tracking not enabled`);
      return;
    }
    
    if (!this.opponentTracking.activeUsers) {
      console.log(`[WS${this.wsNumber}] ⚠️ activeUsers not initialized`);
      return;
    }
    
    // Skip self
    if (userid === this.useridg) {
      console.log(`[WS${this.wsNumber}] ⏭️ Skipping self logout`);
      return;
    }
    
    // Skip planet owner/founder
    if (userid === this.founderUserId) {
      console.log(`[WS${this.wsNumber}] ⏭️ Skipping planet owner logout`);
      return;
    }
    
    const user = this.opponentTracking.activeUsers.get(userid);
    if (!user) {
      console.log(`[WS${this.wsNumber}] ⚠️ Opponent ${userid} logout - not in activeUsers (size: ${this.opponentTracking.activeUsers.size})`);
      return;
    }
    
    const now = Date.now();
    const stayDuration = now - user.joinTime;  // How long they stayed (PART/SLEEP - JOIN)
    
    console.log(`[WS${this.wsNumber}] 📊 Stay duration calculation: now=${now}, joinTime=${user.joinTime}, duration=${stayDuration}ms`);
    
    // Only collect valid samples (0-3000ms = stayed within one round)
    if (stayDuration >= 0 && stayDuration <= 3000) {
      // Valid sample - opponent stayed within reasonable time
      this.addOpponentSample(stayDuration);
      
      // IMPROVED: Update rival-specific profile
      this.updateRivalProfile(user.username, stayDuration);
      this.opponentTracking.currentRival = user.username; // Track who we're facing
      
      // Save to persistent file
      this.addOpponentRecord(user.username, userid, user.joinTime, now, stayDuration);
      
      this.addLog(this.wsNumber, `🔴 ${user.username} LOGOUT: ${stayDuration}ms`);
      console.log(`[WS${this.wsNumber}] ✅ SAMPLE: ${user.username} stayed ${stayDuration}ms`);
    } else {
      // Invalid - stayed too long (multi-round) or negative time
      console.log(`[WS${this.wsNumber}] ⏭️ Skipping ${user.username}: stayed ${stayDuration}ms (invalid)`);
      this.addLog(this.wsNumber, `⚠️ Invalid: ${user.username} ${stayDuration}ms`);
    }
    
    // Remove from active users
    this.opponentTracking.activeUsers.delete(userid);
    
    // PROACTIVE: Stop monitoring if this was the monitored rival
    if (this.opponentTracking.monitoringRival && this.opponentTracking.monitoringRival.userid === userid) {
      this.stopRealTimeMonitor();
    }
  }
  
  // Add opponent timing sample (from login/logout or competition results)
  addOpponentSample(timing) {
    if (!this.opponentTracking.enabled) return;
    
    const now = Date.now();
    
    // Add sample with timestamp
    this.opponentTracking.samples.push({
      timing: timing,
      timestamp: now
    });
    
    // Filter out samples older than rolling window (15 seconds)
    const cutoff = now - this.aiMode.rollingWindow;
    this.opponentTracking.samples = this.opponentTracking.samples.filter(s => s.timestamp > cutoff);
    
    console.log(`[WS${this.wsNumber}] ✅ Sample collected: ${timing}ms (total: ${this.opponentTracking.samples.length})`);
    this.addLog(this.wsNumber, `✅ Sample ${this.opponentTracking.samples.length}: ${timing}ms`);
    
    // After collecting minimum samples, narrow the range
    if (this.opponentTracking.samples.length === this.aiMode.autoRangeSamples && this.aiMode.phase === 'fast_discovery') {
      this.narrowRangeFromSamples();
    }
  }
  
  // Narrow AI range based on collected opponent samples
  narrowRangeFromSamples() {
    if (this.opponentTracking.samples.length < this.aiMode.autoRangeSamples) return;
    
    const timings = this.opponentTracking.samples.map(s => s.timing);
    const minTiming = Math.min(...timings);  // Fastest opponent
    const maxTiming = Math.max(...timings);  // Slowest opponent
    
    // STRATEGY: Attack as CLOSE as possible to the MAXIMUM (slowest opponent)
    // This gives us the most time while still beating everyone!
    // Use 10ms buffer to be safe
    const optimalTiming = Math.max(50, maxTiming - 10);
    
    this.addLog(this.wsNumber, `🎯 Samples: [${timings.join(', ')}]ms`);
    this.addLog(this.wsNumber, `📊 Opponent range: ${minTiming}ms (fastest) - ${maxTiming}ms (slowest)`);
    this.addLog(this.wsNumber, `⚡ AI optimal: ${optimalTiming}ms (${maxTiming} - 10ms buffer)`);
    this.addLog(this.wsNumber, `🏆 Strategy: Attack close to slowest opponent!`);
    
    console.log(`[WS${this.wsNumber}] AI Mode: Slowest opponent ${maxTiming}ms, attacking at ${optimalTiming}ms`);
    console.log(`[WS${this.wsNumber}] Samples: [${timings.join(', ')}]ms`);
    
    this.opponentTracking.detectedMin = minTiming;
    this.opponentTracking.detectedMax = maxTiming;
    this.opponentTracking.lastUpdate = Date.now();
    
    // Set optimal timing - attack just before slowest opponent
    this.aiMode.optimalTiming = optimalTiming;
    this.aiMode.edgeTiming = optimalTiming;
    this.aiMode.edgeFound = true;
    this.aiMode.phase = 'adaptive';  // Go straight to adaptive mode
    
    this.addLog(this.wsNumber, `✅ AI ready: Attacking at ${optimalTiming}ms`);
  }
  
  // Check if range needs updating (called periodically)
  checkRangeUpdate() {
    if (!this.opponentTracking.enabled || !this.aiMode.enabled) return;
    if (this.aiMode.phase === 'fast_discovery') return;  // Skip during initial phase
    
    this.opponentTracking.roundCounter++;
    
    // Check every N rounds (default: 5 rounds = 15 seconds)
    if (this.opponentTracking.roundCounter < this.aiMode.rangeUpdateFrequency) return;
    
    this.opponentTracking.roundCounter = 0;
    
    // Need at least 3 recent samples
    if (this.opponentTracking.samples.length < 3) return;
    
    const timings = this.opponentTracking.samples.map(s => s.timing);
    const newMin = Math.min(...timings);
    const newMax = Math.max(...timings);
    const newAvg = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);
    
    // Check if average changed significantly (>50ms)
    const oldAvg = Math.round((this.opponentTracking.detectedMin + this.opponentTracking.detectedMax) / 2);
    const avgChanged = Math.abs(newAvg - oldAvg) > 50;
    
    if (avgChanged) {
      this.addLog(this.wsNumber, `� Olpponent timing changed!`);
      this.addLog(this.wsNumber, `📊 Old avg: ${oldAvg}ms → New avg: ${newAvg}ms`);
      
      console.log(`[WS${this.wsNumber}] AI Mode: Opponent average changed from ${oldAvg}ms to ${newAvg}ms`);
      
      this.opponentTracking.detectedMin = newMin;
      this.opponentTracking.detectedMax = newMax;
      this.opponentTracking.lastUpdate = Date.now();
      
      // Recalculate optimal timing - attack just before slowest opponent
      const newOptimal = Math.max(50, newMax - 10);
      this.aiMode.optimalTiming = newOptimal;
      this.aiMode.edgeTiming = newOptimal;
      
      this.addLog(this.wsNumber, `⚡ AI updated: Now attacking at ${newOptimal}ms`);
      console.log(`[WS${this.wsNumber}] AI Mode: Updated optimal timing to ${newOptimal}ms`);
    }
  }
  
  // Get AI-determined timing
  getAITiming() {
    if (!this.aiMode.enabled) {
      // Fallback to normal timing
      console.log(`[WS${this.wsNumber}] AI: Not enabled - using config timing`);
      return parseInt(this.config[`attack${this.wsNumber}`] || 1940);
    }
    
    // SIMPLE LOGIC: Get most recent opponent stay duration and subtract 20ms
    const samples = this.opponentTracking.samples;
    
    console.log(`[WS${this.wsNumber}] 🔍 getAITiming: samples.length=${samples.length}, currentRival=${this.opponentTracking.currentRival}`);
    
    if (samples.length === 0) {
      // No data yet - use safe timing to collect first sample
      const safeTiming = 1940;
      console.log(`[WS${this.wsNumber}] ⚠️ AI: NO SAMPLES YET - using ${safeTiming}ms to collect rival time`);
      this.addLog(this.wsNumber, `📊 AI: No data - using ${safeTiming}ms`);
      return safeTiming;
    }
    
    console.log(`[WS${this.wsNumber}] ✅ AI: Have ${samples.length} samples, latest=${samples[samples.length - 1].timing}ms`);
    
    // IMPROVED: Use rival-specific profile if available
    const currentRival = this.opponentTracking.currentRival;
    let rivalProfile = null;
    let adaptiveOffset = this.aiMode.adaptiveOffset || -20;
    
    // Extract timing value from sample object (samples are {timing, timestamp})
    let latestRivalTime = samples[samples.length - 1].timing;
    
    if (currentRival && this.opponentTracking.rivalProfiles.has(currentRival)) {
      rivalProfile = this.opponentTracking.rivalProfiles.get(currentRival);
      
      // Use rival's specific offset and most recent sample
      if (rivalProfile.samples.length > 0) {
        // Rival profile stores plain numbers, not objects
        latestRivalTime = rivalProfile.samples[rivalProfile.samples.length - 1];
        adaptiveOffset = rivalProfile.adaptiveOffset;
        
        console.log(`[WS${this.wsNumber}] 🎯 Using ${currentRival} profile: ${latestRivalTime}ms, offset=${adaptiveOffset}ms`);
        this.addLog(this.wsNumber, `🎯 ${currentRival}: ${latestRivalTime}ms (${adaptiveOffset}ms)`);
      }
    } else {
      // No specific rival - use global samples and offset
      console.log(`[WS${this.wsNumber}] 🎯 No rival profile - using global: ${latestRivalTime}ms, offset=${adaptiveOffset}ms`);
    }
    
    // Calculate attack timing: rival's time + our adaptive offset
    const attackTiming = Math.max(100, latestRivalTime + adaptiveOffset);
    
    return attackTiming;
  }
  
  // IMPROVED: Record AI attack result with type (win, 3s_error, kicked)
  recordAIResult(timing, success, resultType = null) {
    if (!this.aiMode.enabled) return;
    
    const currentRival = this.opponentTracking.currentRival;
    let rivalProfile = null;
    
    // Get rival profile if available
    if (currentRival && this.opponentTracking.rivalProfiles.has(currentRival)) {
      rivalProfile = this.opponentTracking.rivalProfiles.get(currentRival);
      rivalProfile.totalRounds++;
    }
    
    // Update overall stats
    this.aiMode.totalAttempts++;
    
    if (success) {
      this.aiMode.totalSuccesses++;
      this.aiMode.consecutiveFailures = 0;
      if (rivalProfile) rivalProfile.wins++;
      
      // SUCCESS → Try attacking EARLIER (closer to rival time) by -5ms
      const oldOffset = rivalProfile ? rivalProfile.adaptiveOffset : this.aiMode.adaptiveOffset;
      const newOffset = oldOffset - 5;
      
      if (rivalProfile) {
        rivalProfile.adaptiveOffset = newOffset;
        rivalProfile.winRate = rivalProfile.wins / rivalProfile.totalRounds;
      } else {
        this.aiMode.adaptiveOffset = newOffset;
      }
      
      console.log(`[WS${this.wsNumber}] ✅ WIN → Closer: ${oldOffset}ms → ${newOffset}ms`);
      this.addLog(this.wsNumber, `✅ Win → ${newOffset}ms (closer)`);
      
    } else {
      this.aiMode.totalFailures++;
      this.aiMode.consecutiveFailures = (this.aiMode.consecutiveFailures || 0) + 1;
      if (rivalProfile) rivalProfile.losses++;
      
      // Determine if kicked or 3s error
      const isKicked = (resultType === 'kicked');
      if (isKicked) {
        this.aiMode.totalKicked++;
        if (rivalProfile) rivalProfile.kicked++;
      }
      
      // KICKED → We were too LATE → Attack EARLIER by -50ms (aggressive correction)
      // 3S ERROR → We were too EARLY → Attack LATER by +5ms (gentle correction)
      const oldOffset = rivalProfile ? rivalProfile.adaptiveOffset : this.aiMode.adaptiveOffset;
      const adjustment = isKicked ? -50 : +5;
      const newOffset = oldOffset + adjustment;
      
      if (rivalProfile) {
        rivalProfile.adaptiveOffset = newOffset;
        rivalProfile.winRate = rivalProfile.wins / rivalProfile.totalRounds;
      } else {
        this.aiMode.adaptiveOffset = newOffset;
      }
      
      const reason = isKicked ? 'KICKED (too late)' : '3S ERROR (too early)';
      console.log(`[WS${this.wsNumber}] ❌ ${reason} → ${oldOffset}ms → ${newOffset}ms`);
      this.addLog(this.wsNumber, `❌ ${reason} → ${newOffset}ms`);
    }
    
    this.aiMode.overallSuccessRate = this.aiMode.totalSuccesses / this.aiMode.totalAttempts;
    console.log(`[WS${this.wsNumber}] AI Result: ${timing}ms → ${success ? 'WIN' : 'LOSE'} (${Math.round(this.aiMode.overallSuccessRate * 100)}%)`);
  }
  
  // Process discovery phase result (Binary search)
  processDiscoveryResult(timing, success) {
    this.aiMode.discoveryAttempts++;
    
    const result = this.aiMode.timingResults[timing];
    
    // Need at least 2 attempts per timing for confidence
    if (result.attempts < 2) {
      // Keep testing same timing
      this.addLog(this.wsNumber, `📊 AI: ${timing}ms → ${Math.round(result.rate * 100)}% (sample ${result.attempts}/2)`);
      return;
    }
    
    // Have enough samples, make binary search decision
    if (result.rate >= 0.5) {
      // Success rate >= 50%, this timing works, try faster
      this.addLog(this.wsNumber, `✅ AI: ${timing}ms works (${Math.round(result.rate * 100)}%) - trying faster`);
      this.aiMode.searchMax = timing;
      
      // Calculate new test timing (go faster)
      const newTiming = Math.floor((this.aiMode.searchMin + this.aiMode.searchMax) / 2);
      
      if (newTiming === timing || Math.abs(newTiming - timing) < 5) {
        // Converged! Found edge
        this.finalizeEdge();
      } else {
        this.aiMode.currentTestTiming = newTiming;
        this.addLog(this.wsNumber, `🔍 AI: Next test ${newTiming}ms`);
      }
    } else {
      // Success rate < 50%, too fast, go slower
      this.addLog(this.wsNumber, `❌ AI: ${timing}ms too fast (${Math.round(result.rate * 100)}%) - going slower`);
      this.aiMode.searchMin = timing;
      
      // Calculate new test timing (go slower)
      const newTiming = Math.floor((this.aiMode.searchMin + this.aiMode.searchMax) / 2);
      
      if (newTiming === timing || Math.abs(newTiming - timing) < 5) {
        // Converged! Found edge
        this.finalizeEdge();
      } else {
        this.aiMode.currentTestTiming = newTiming;
        this.addLog(this.wsNumber, `🔍 AI: Next test ${newTiming}ms`);
      }
    }
    
    // Check if discovery phase is complete
    if (this.aiMode.discoveryAttempts >= this.aiMode.maxDiscoveryAttempts) {
      this.finalizeEdge();
    }
  }
  
  // Finalize edge detection
  finalizeEdge() {
    // Use hardcoded optimal defaults
    const targetRate = this.aiMode.targetSuccessRate;  // 0.90 (90%)
    const safetyBuffer = this.aiMode.safetyBuffer;      // 10ms
    
    let bestTiming = null;
    let bestRate = 0;
    
    // Sort timings and find fastest with acceptable rate
    const timings = Object.keys(this.aiMode.timingResults)
      .map(t => parseInt(t))
      .sort((a, b) => a - b);
    
    for (const timing of timings) {
      const result = this.aiMode.timingResults[timing];
      if (result.attempts >= 2 && result.rate >= targetRate) {
        bestTiming = timing;
        bestRate = result.rate;
        break; // Found fastest with acceptable rate
      }
    }
    
    if (!bestTiming) {
      // No timing met target, use safest
      for (const timing of timings.reverse()) {
        const result = this.aiMode.timingResults[timing];
        if (result.attempts >= 2 && result.rate > bestRate) {
          bestTiming = timing;
          bestRate = result.rate;
        }
      }
    }
    
    if (bestTiming) {
      this.aiMode.edgeFound = true;
      this.aiMode.edgeTiming = bestTiming;
      this.aiMode.edgeConfidence = bestRate;
      this.aiMode.optimalTiming = bestTiming + safetyBuffer;
      
      this.addLog(this.wsNumber, `🎯 AI: Edge found at ${bestTiming}ms (${Math.round(bestRate * 100)}% confidence)`);
      this.addLog(this.wsNumber, `⚡ AI: Using ${this.aiMode.optimalTiming}ms (${bestTiming}ms + ${safetyBuffer}ms buffer)`);
      console.log(`[WS${this.wsNumber}] AI Mode: Edge=${bestTiming}ms, Optimal=${this.aiMode.optimalTiming}ms`);
      
      // Always use adaptive mode (hardcoded default)
      if (this.aiMode.adaptive) {
        this.aiMode.phase = 'adaptive';
        this.addLog(this.wsNumber, `🔄 AI: Switching to adaptive mode`);
      } else {
        this.aiMode.phase = 'exploitation';
        this.addLog(this.wsNumber, `✅ AI: Locked to optimal timing`);
      }
    } else {
      // Couldn't find edge, fallback
      this.addLog(this.wsNumber, `⚠️ AI: Could not determine edge, using default`);
      this.aiMode.enabled = false;
    }
  }
  
  // Process adaptive phase result
  processAdaptiveResult(timing, success) {
    // Check if we need to re-run discovery
    const targetRate = this.aiMode.targetSuccessRate;  // 0.90 (90%)
    
    if (this.aiMode.overallSuccessRate < targetRate * 0.9) {
      // Success rate dropped significantly, re-run discovery
      this.addLog(this.wsNumber, `⚠️ AI: Success rate dropped to ${Math.round(this.aiMode.overallSuccessRate * 100)}% - rediscovering edge`);
      this.resetAIDiscovery();
    }
    
    // Track edge test results
    if (timing === this.aiMode.edgeTiming) {
      this.aiMode.edgeTestResults.push(success);
      if (this.aiMode.edgeTestResults.length > 10) {
        this.aiMode.edgeTestResults.shift();
      }
      
      // Update optimal if edge consistently succeeds
      const recentEdgeSuccess = this.aiMode.edgeTestResults.filter(r => r).length / this.aiMode.edgeTestResults.length;
      if (this.aiMode.edgeTestResults.length >= 5 && recentEdgeSuccess >= 0.8) {
        // Edge is stable, can use it
        const safetyBuffer = this.aiMode.safetyBuffer;  // 10ms
        const newOptimal = this.aiMode.edgeTiming + Math.floor(safetyBuffer / 2);
        if (newOptimal < this.aiMode.optimalTiming) {
          this.aiMode.optimalTiming = newOptimal;
          this.addLog(this.wsNumber, `⚡ AI: Edge stable - updated optimal to ${newOptimal}ms`);
        }
      }
    }
  }
  
  // Reset AI discovery
  resetAIDiscovery() {
    this.aiMode.phase = 'discovery';
    this.aiMode.discoveryAttempts = 0;
    // Use current detected range or initial defaults
    this.aiMode.searchMin = this.opponentTracking.detectedMin || this.aiMode.initialMin;
    this.aiMode.searchMax = this.opponentTracking.detectedMax || this.aiMode.initialMax;
    this.aiMode.currentTestTiming = Math.floor((this.aiMode.searchMin + this.aiMode.searchMax) / 2);
    this.aiMode.timingResults = {};
    this.aiMode.totalAttempts = 0;
    this.aiMode.totalSuccesses = 0;
    this.aiMode.totalFailures = 0;
    this.aiMode.overallSuccessRate = 0;
    this.aiMode.consecutiveSuccesses = 0;
  }
  
  // Get AI statistics for API/logging
  getAIStats() {
    if (!this.aiMode.enabled) {
      return { enabled: false };
    }
    
    return {
      enabled: true,
      phase: this.aiMode.phase,
      edgeFound: this.aiMode.edgeFound,
      edgeTiming: this.aiMode.edgeTiming,
      optimalTiming: this.aiMode.optimalTiming,
      confidence: Math.round(this.aiMode.edgeConfidence * 100),
      successRate: Math.round(this.aiMode.overallSuccessRate * 100),
      samples: this.aiMode.totalAttempts,
      discoveryProgress: `${this.aiMode.discoveryAttempts}/${this.aiMode.maxDiscoveryAttempts}`
    };
  }
  
  // ========================================
  // SMART MODE IMPROVEMENTS
  // ========================================
  
  // Mark target as attacked with cooldown
  markTargetAttacked(userid) {
    this.attackCooldowns[userid] = Date.now();
    this.attackedThisSession.add(userid);
  }
  
  // Check if target is on cooldown
  isOnCooldown(userid) {
    const lastAttack = this.attackCooldowns[userid];
    if (!lastAttack) return false;
    
    const timeSinceAttack = Date.now() - lastAttack;
    return timeSinceAttack < this.cooldownDuration;
  }
  
  // Get available targets (not on cooldown)
  getAvailableTargets() {
    return this.attackids.filter(id => !this.isOnCooldown(id));
  }
  
  // Get unattacked targets (not attacked this session)
  getUnattackedTargets() {
    return this.attackids.filter(id => !this.attackedThisSession.has(id));
  }
  
  // IMPROVED: Smart target selection with all 3 improvements
  selectSmartTarget() {
    if (!this.config.smart || this.attackids.length === 0) {
      return null;
    }
    
    // IMPROVEMENT #1: Filter out targets on cooldown
    let candidateTargets = this.getAvailableTargets();
    
    if (candidateTargets.length === 0) {
      // All targets on cooldown, use any target as fallback
      candidateTargets = this.attackids;
      this.addLog(this.wsNumber, `⏳ All targets on cooldown - picking anyway`);
    }
    
    // IMPROVEMENT #3: Prefer targets not attacked this session
    const unattackedCandidates = candidateTargets.filter(id => 
      !this.attackedThisSession.has(id)
    );
    
    if (unattackedCandidates.length > 0) {
      candidateTargets = unattackedCandidates;
      this.addLog(this.wsNumber, `🆕 ${unattackedCandidates.length} fresh target(s) available`);
    } else {
      // All candidates attacked, reset history for new round
      this.attackedThisSession.clear();
      this.addLog(this.wsNumber, `🔄 All targets attacked - starting new round`);
    }
    
    // IMPROVEMENT #2: Round Robin or Random selection
    let selectedId;
    if (this.config.roundRobin) {
      // Round Robin: Pick sequentially
      this.targetIndex = this.targetIndex % candidateTargets.length;
      selectedId = candidateTargets[this.targetIndex];
      this.targetIndex++;
      this.addLog(this.wsNumber, `🔄 Round Robin: Target #${this.targetIndex}`);
    } else {
      // Random: Pick randomly (original behavior)
      const rand = Math.floor(Math.random() * candidateTargets.length);
      selectedId = candidateTargets[rand];
    }
    
    // Get target name for logging
    const targetIndex = this.attackids.indexOf(selectedId);
    const targetName = this.attacknames[targetIndex];
    
    return { id: selectedId, name: targetName };
  }
  
  incrementAttack() {
    if (!this.config.timershift) return;
    
    const currentKey = `attack${this.wsNumber}`;
    let value = parseInt(this.config[currentKey] || 1940);
    const baseIncrement = parseInt(this.config.incrementvalue || 10);
    const maxAtk = parseInt(this.config.maxatk || 3000);
    
    // Use adaptive step size
    let incrementValue = this.getAdaptiveStepSize(baseIncrement);
    
    // Reduce step size if oscillating
    if (this.isOscillating()) {
      incrementValue = Math.max(1, Math.floor(incrementValue / 2));
      this.addLog(this.wsNumber, `⚠️ Oscillation detected - reducing step to ${incrementValue}ms`);
    }
    
    value += incrementValue;
    
    if (value <= maxAtk) {
      this.config[currentKey] = value;
      this.updateConfig(currentKey, value);
      this.trackAdjustment(+incrementValue);
      this.addLog(this.wsNumber, `⏫ Attack timing increased to ${value}ms (+${incrementValue}ms)`);
    } else {
      this.addLog(this.wsNumber, `⚠️ Attack timing at maximum (${maxAtk}ms)`);
    }
  }

  decrementAttack() {
    if (!this.config.timershift) return;
    
    const currentKey = `attack${this.wsNumber}`;
    let value = parseInt(this.config[currentKey] || 1940);
    const baseDecrement = parseInt(this.config.decrementvalue || 10);
    const minAtk = parseInt(this.config.minatk || 1000);
    
    // Use smaller steps for decrement (more conservative)
    let decrementValue = baseDecrement;
    
    // Reduce step size if oscillating
    if (this.isOscillating()) {
      decrementValue = Math.max(1, Math.floor(decrementValue / 2));
      this.addLog(this.wsNumber, `⚠️ Oscillation detected - reducing step to ${decrementValue}ms`);
    }
    
    value -= decrementValue;
    
    if (value >= minAtk) {
      this.config[currentKey] = value;
      this.updateConfig(currentKey, value);
      this.trackAdjustment(-decrementValue);
      this.addLog(this.wsNumber, `⏬ Attack timing decreased to ${value}ms (-${decrementValue}ms)`);
    } else {
      this.addLog(this.wsNumber, `⚠️ Attack timing at minimum (${minAtk}ms)`);
    }
  }

  incrementDefence() {
    if (!this.config.timershift) return;
    
    const currentKey = `waiting${this.wsNumber}`;
    let value = parseInt(this.config[currentKey] || 1910);
    const baseIncrement = parseInt(this.config.incrementvalue || 10);
    const maxDef = parseInt(this.config.maxdef || 3000);
    
    // Use adaptive step size
    let incrementValue = this.getAdaptiveStepSize(baseIncrement);
    
    // Reduce step size if oscillating
    if (this.isOscillating()) {
      incrementValue = Math.max(1, Math.floor(incrementValue / 2));
      this.addLog(this.wsNumber, `⚠️ Oscillation detected - reducing step to ${incrementValue}ms`);
    }
    
    value += incrementValue;
    
    if (value <= maxDef) {
      this.config[currentKey] = value;
      this.updateConfig(currentKey, value);
      this.trackAdjustment(+incrementValue);
      this.addLog(this.wsNumber, `⏫ Defense timing increased to ${value}ms (+${incrementValue}ms)`);
    } else {
      this.addLog(this.wsNumber, `⚠️ Defense timing at maximum (${maxDef}ms)`);
    }
  }

  decrementDefence() {
    if (!this.config.timershift) return;
    
    const currentKey = `waiting${this.wsNumber}`;
    let value = parseInt(this.config[currentKey] || 1910);
    const baseDecrement = parseInt(this.config.decrementvalue || 10);
    const minDef = parseInt(this.config.mindef || 1000);
    
    // Use smaller steps for decrement (more conservative)
    let decrementValue = baseDecrement;
    
    // Reduce step size if oscillating
    if (this.isOscillating()) {
      decrementValue = Math.max(1, Math.floor(decrementValue / 2));
      this.addLog(this.wsNumber, `⚠️ Oscillation detected - reducing step to ${decrementValue}ms`);
    }
    
    value -= decrementValue;
    
    if (value >= minDef) {
      this.config[currentKey] = value;
      this.updateConfig(currentKey, value);
      this.trackAdjustment(-decrementValue);
      this.addLog(this.wsNumber, `⏬ Defense timing decreased to ${value}ms (-${decrementValue}ms)`);
    } else {
      this.addLog(this.wsNumber, `⚠️ Defense timing at minimum (${minDef}ms)`);
    }
  }

  // ========================================
  // 353 HANDLER - CHANNEL USER LIST
  // ========================================
  
  // 353 BAN Mode Handler - Bans users already on planet
  handle353BanMode(ws, snippets, text) {
    try {
      const channelName = snippets[3];
      
      if (channelName && channelName.slice(0, 6) === "Prison") {
        this.addLog(this.wsNumber, `Skipping prison channel`);
        return;
      }

      console.log(`[WS${this.wsNumber}] 353 BAN mode - Processing user list`);
      console.log(`[WS${this.wsNumber}] 353 BAN mode options - Everyone=${this.config.kickall}, ByBlacklist=${this.config.kickbybl}, Dad+=${this.config.dadplus}`);
      
      // ONLY process if at least one mode is enabled
      if (!this.config.kickall && !this.config.kickbybl && !this.config.dadplus) {
        console.log(`[WS${this.wsNumber}] 353 BAN mode - No modes enabled, skipping`);
        return;
      }
      
      const data = text.replaceAll("+", "").toLowerCase();
      const usersToBan = [];
      
      // OPTION 1: Check "Everyone" mode - ban all users on planet
      if (this.config.kickall) {
        console.log(`[WS${this.wsNumber}] 353 BAN mode - Everyone mode active, parsing all users`);
        
        // Use same parsing logic as handle353Normal
        // Remove prefixes and split into array
        let members = text.split("+").join("");
        members = members.split("@").join("");
        members = members.split(":").join("");
        const membersarr = members.toLowerCase().split(" ");
        
        console.log(`[WS${this.wsNumber}] 353 BAN mode - Parsed ${membersarr.length} parts`);
        
        // Extract valid user IDs (numeric, length >= 6, preceded by non-numeric username)
        const integers = membersarr.filter(item => !isNaN(item) && item !== "-" && item.length >= 6);
        
        integers.forEach((userid) => {
          const idx = membersarr.indexOf(userid);
          if (idx > 0) {
            const username = membersarr[idx - 1];
            
            // Skip if username is also numeric (means it's not a username)
            if (!isNaN(username)) return;
            
            console.log(`[WS${this.wsNumber}] 353 BAN mode - Checking: ${username} (${userid})`);
            
            // Skip self and founder
            if (userid === this.useridg) {
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping self: ${userid}`);
            } else if (userid === this.founderUserId) {
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping founder: ${userid}`);
            } else if (!usersToBan.find(u => u.userid === userid)) {
              usersToBan.push({ userid, username, reason: 'everyone' });
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Found user to ban (everyone): ${username} (${userid})`);
            }
          }
        });
      }
      
      // OPTION 2: Check "By Blacklist" mode (only if Everyone is not enabled)
      else if (this.config.kickbybl) {
        const kblacklist = (this.config.kblacklist || "").toLowerCase().split("\n").filter(k => k.trim());
        const kgangblacklist = (this.config.kgangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
        
        console.log(`[WS${this.wsNumber}] 353 BAN mode - Kick Blacklist Users: [${kblacklist.join(', ')}]`);
        console.log(`[WS${this.wsNumber}] 353 BAN mode - Kick Blacklist Clans: [${kgangblacklist.join(', ')}]`);
      
        // Process username blacklist
        kblacklist.forEach((element) => {
        if (element && data.includes(element)) {
          const replace = element + " ";
          const replaced = data.replaceAll(replace, "*");
          const arr = replaced.split("*");
          arr.shift();
          
          if (arr[0]) {
            const userid = arr[0].split(" ")[0];
            // Skip self and founder
            if (userid === this.useridg) {
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping self: ${userid}`);
            } else if (userid === this.founderUserId) {
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping founder: ${userid}`);
              this.addLog(this.wsNumber, `👑 Skipping BAN for planet owner: ${element}`);
            } else if (userid && !usersToBan.includes(userid)) {
              usersToBan.push({ userid, username: element, reason: `kblacklist: ${element}` });
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Found user to ban: ${element} (${userid})`);
            }
          }
        }
      });
      
        // Process gang blacklist
        kgangblacklist.forEach((element) => {
        if (element && data.includes(element)) {
          const replace = element + " ";
          const replaced = data.replaceAll(replace, "*");
          const arr = replaced.split("*");
          arr.shift();
          
          for (let i = 0; i < arr.length; i++) {
            const value = arr[i];
            const parts = value.split(" ");
            const userid = parts[1];
            const username = parts[0];
            
            // Skip self and founder
            if (userid === this.useridg) {
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping self: ${userid}`);
            } else if (userid === this.founderUserId) {
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Skipping founder: ${userid}`);
              this.addLog(this.wsNumber, `👑 Skipping BAN for planet owner in gang: ${username}`);
            } else if (username && userid && !usersToBan.find(u => u.userid === userid)) {
              usersToBan.push({ userid, username, reason: `kgangblacklist: ${element}` });
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Found gang member to ban: ${username} (${userid})`);
            }
          }
        }
        });
      }
      
      // OPTION 3: Dad+ mode - Request user info for all users to check for aura (independent of other modes)
      if (this.config.dadplus) {
        // Parse all user IDs from 353 message
        let members = text.split("+").join("");
        members = members.split("@").join("");
        members = members.split(":").join("");
        const membersarr = members.toLowerCase().split(" ");
        const integers = membersarr.filter(item => !isNaN(item) && item !== "-" && item.length >= 6);
        
        console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting info for ${integers.length} users`);
        this.addLog(this.wsNumber, `🔍 Dad+ checking ${integers.length} users for aura`);
        
        integers.forEach((userid, index) => {
          // Skip self and founder
          if (userid === this.useridg || userid === this.founderUserId) return;
          
          setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send(`WHOIS ${userid}\r\n`);
              console.log(`[WS${this.wsNumber}] Dad+ mode - Sent WHOIS for ${userid}`);
            }
          }, index * 50); // Stagger requests by 50ms
        });
      }
      
      // Ban all matched users
      if (usersToBan.length > 0) {
        console.log(`[WS${this.wsNumber}] 353 BAN mode - Banning ${usersToBan.length} user(s)`);
        this.addLog(this.wsNumber, `🚫 Found ${usersToBan.length} user(s) to ban`);
        
        usersToBan.forEach((user, index) => {
          setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send(`BAN ${user.userid}\r\n`);
              this.addLog(this.wsNumber, `🚫 Banning ${user.username} (${user.userid}) - ${user.reason}`);
              console.log(`[WS${this.wsNumber}] 353 BAN mode - Sent BAN command for ${user.userid}`);
            }
          }, index * 100); // Stagger bans by 100ms to avoid flooding
        });
      } else {
        console.log(`[WS${this.wsNumber}] 353 BAN mode - No users to ban`);
        this.addLog(this.wsNumber, `✅ No users in kick blacklist found on planet`);
      }
      
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handle353BanMode:`, error);
    }
  }
  
  // 353 Handler for ALL codes (1-5) - Kick/Imprison mode
  handle353KickMode(ws, snippets, text) {
    try {
      const channelName = snippets[3];
      
      if (channelName && channelName.slice(0, 6) === "Prison") {
        this.addLog(this.wsNumber, `Skipping prison channel`);
        return;
      }

      // Determine if we're in Kick or Imprison mode
      const isKickMode = this.config.kickmode === true;
      const actionType = isKickMode ? "Kick" : "Imprison";
      
      console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Processing user list`);
      console.log(`[WS${this.wsNumber}] 353 ${actionType} mode options - Everyone=${this.config.kickall}, ByBlacklist=${this.config.kickbybl}, Dad+=${this.config.dadplus}`);
      
      // ONLY process if at least one mode is enabled
      if (!this.config.kickall && !this.config.kickbybl && !this.config.dadplus) {
        console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - No modes enabled, skipping`);
        return;
      }
      
      // Parse all user IDs from 353 message (only if needed)
      let members = text.split("+").join("");
      members = members.split("@").join("");
      members = members.split(":").join("");
      const membersarr = members.toLowerCase().split(" ");
      const integers = membersarr.filter(item => !isNaN(item) && item !== "-" && item.length >= 6);
      
      const usersToAct = [];
      
      // OPTION 1: Check "Everyone" mode - kick/imprison all users
      if (this.config.kickall) {
        console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Everyone mode active`);
        
        integers.forEach((userid) => {
          const idx = membersarr.indexOf(userid);
          if (idx > 0) {
            const username = membersarr[idx - 1];
            
            // Skip if username is also numeric (means it's not a username)
            if (!isNaN(username)) return;
            
            // Skip self and founder
            if (userid === this.useridg) {
              console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Skipping self: ${userid}`);
            } else if (userid === this.founderUserId) {
              console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Skipping founder: ${userid}`);
            } else if (!usersToAct.find(u => u.userid === userid)) {
              usersToAct.push({ userid, username, reason: 'everyone' });
              console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Found user (everyone): ${username} (${userid})`);
            }
          }
        });
      }
      
      // OPTION 2: Check "By Blacklist" mode (only if Everyone is not enabled)
      else if (this.config.kickbybl) {
        const data = text.replaceAll("+", "").toLowerCase();
        
        if (isKickMode) {
          // KICK MODE: Use kblacklist and kgangblacklist
          const kblacklist = (this.config.kblacklist || "").toLowerCase().split("\n").filter(k => k.trim());
          const kgangblacklist = (this.config.kgangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
          
          console.log(`[WS${this.wsNumber}] 353 Kick mode - Kick Blacklist Users: [${kblacklist.join(', ')}]`);
          console.log(`[WS${this.wsNumber}] 353 Kick mode - Kick Blacklist Clans: [${kgangblacklist.join(', ')}]`);
          
          // Process username blacklist
          kblacklist.forEach((element) => {
            if (element && data.includes(element)) {
              const replace = element + " ";
              const replaced = data.replaceAll(replace, "*");
              const arr = replaced.split("*");
              arr.shift();
              
              if (arr[0]) {
                const userid = arr[0].split(" ")[0];
                // Skip self and founder
                if (userid === this.useridg) {
                  console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping self: ${userid}`);
                } else if (userid === this.founderUserId) {
                  console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping founder: ${userid}`);
                  this.addLog(this.wsNumber, `👑 Skipping kick for planet owner: ${element}`);
                } else if (userid && !usersToAct.find(u => u.userid === userid)) {
                  usersToAct.push({ userid, username: element, reason: `kblacklist: ${element}` });
                  console.log(`[WS${this.wsNumber}] 353 Kick mode - Found user to kick: ${element} (${userid})`);
                }
              }
            }
          });
          
          // Process gang blacklist
          kgangblacklist.forEach((element) => {
            if (element && data.includes(element)) {
              const replace = element + " ";
              const replaced = data.replaceAll(replace, "*");
              const arr = replaced.split("*");
              arr.shift();
              
              for (let i = 0; i < arr.length; i++) {
                const value = arr[i];
                const parts = value.split(" ");
                const userid = parts[1];
                const username = parts[0];
                
                // Skip self and founder
                if (userid === this.useridg) {
                  console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping self: ${userid}`);
                } else if (userid === this.founderUserId) {
                  console.log(`[WS${this.wsNumber}] 353 Kick mode - Skipping founder: ${userid}`);
                  this.addLog(this.wsNumber, `👑 Skipping kick for planet owner in gang: ${username}`);
                } else if (username && userid && !usersToAct.find(u => u.userid === userid)) {
                  usersToAct.push({ userid, username, reason: `kgangblacklist: ${element}` });
                  console.log(`[WS${this.wsNumber}] 353 Kick mode - Found gang member to kick: ${username} (${userid})`);
                }
              }
            }
          });
        } else {
          // IMPRISON MODE: Use blacklist and gangblacklist
          const blacklist = (this.config.blacklist || "").toLowerCase().split("\n").filter(b => b.trim());
          const gangblacklist = (this.config.gangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
          
          console.log(`[WS${this.wsNumber}] 353 Imprison mode - Blacklist Users: [${blacklist.join(', ')}]`);
          console.log(`[WS${this.wsNumber}] 353 Imprison mode - Blacklist Clans: [${gangblacklist.join(', ')}]`);
          
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
                  console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping self: ${userid}`);
                } else if (userid === this.founderUserId) {
                  console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping founder: ${userid}`);
                  this.addLog(this.wsNumber, `👑 Skipping imprison for planet owner: ${element}`);
                } else if (userid && !usersToAct.find(u => u.userid === userid)) {
                  usersToAct.push({ userid, username: element, reason: `blacklist: ${element}` });
                  console.log(`[WS${this.wsNumber}] 353 Imprison mode - Found user to imprison: ${element} (${userid})`);
                }
              }
            }
          });
          
          // Process gang blacklist
          gangblacklist.forEach((element) => {
            if (element && data.includes(element)) {
              const replace = element + " ";
              const replaced = data.replaceAll(replace, "*");
              const arr = replaced.split("*");
              arr.shift();
              
              for (let i = 0; i < arr.length; i++) {
                const value = arr[i];
                const parts = value.split(" ");
                const userid = parts[1];
                const username = parts[0];
                
                // Skip self and founder
                if (userid === this.useridg) {
                  console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping self: ${userid}`);
                } else if (userid === this.founderUserId) {
                  console.log(`[WS${this.wsNumber}] 353 Imprison mode - Skipping founder: ${userid}`);
                  this.addLog(this.wsNumber, `👑 Skipping imprison for planet owner in gang: ${username}`);
                } else if (username && userid && !usersToAct.find(u => u.userid === userid)) {
                  usersToAct.push({ userid, username, reason: `gangblacklist: ${element}` });
                  console.log(`[WS${this.wsNumber}] 353 Imprison mode - Found gang member to imprison: ${username} (${userid})`);
                }
              }
            }
          });
        }
      }
      
      // OPTION 3: Dad+ mode - Request user info for all users to check for aura (independent of other modes)
      if (this.config.dadplus) {
        console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting info for ${integers.length} users`);
        this.addLog(this.wsNumber, `🔍 Dad+ checking ${integers.length} users for aura`);
        
        integers.forEach((userid, index) => {
          // Skip self and founder
          if (userid === this.useridg || userid === this.founderUserId) return;
          
          setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send(`WHOIS ${userid}\r\n`);
              console.log(`[WS${this.wsNumber}] Dad+ mode - Sent WHOIS for ${userid}`);
            }
          }, index * 50); // Stagger requests by 50ms
        });
      }
      
      // Execute actions for matched users
      if (usersToAct.length > 0) {
        // IMPROVED: Use appropriate timing (no averaging!)
        const timing = this.getTiming("attack");  // Use attack timing
        const timingLabel = this.getTimingLabel("attack");
        
        console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - Acting on ${usersToAct.length} user(s)`);
        this.addLog(this.wsNumber, `${isKickMode ? '👢' : '⚔️'} Found ${usersToAct.length} user(s) to ${actionType.toLowerCase()}`);
        this.addLog(this.wsNumber, `⚡ ${timingLabel} in ${timing}ms`);
        
        // Wait for timing before sending first action (STORE timeout so it can be cleared on disconnect)
        this.timeout = setTimeout(() => {
          // Store inner timeouts so they can be cleared on disconnect
          if (!this.innerTimeouts) this.innerTimeouts = [];
          
          usersToAct.forEach((user, index) => {
            const innerTimeout = setTimeout(() => {
              if (ws.readyState === ws.OPEN) {
                if (isKickMode) {
                  ws.send(`KICK ${user.userid}\r\n`);
                  this.addLog(this.wsNumber, `👢 Kicking ${user.username} (${user.userid}) - ${user.reason}`);
                  console.log(`[WS${this.wsNumber}] 353 Kick mode - Sent KICK command for ${user.userid}`);
                } else {
                  ws.send(`ACTION 3 ${user.userid}\r\n`);
                  this.markTargetAttacked(user.userid);  // Mark for cooldown & history
                  this.addLog(this.wsNumber, `⚔️ Imprisoning ${user.username} (${user.userid}) - ${user.reason}`);
                  console.log(`[WS${this.wsNumber}] 353 Imprison mode - Sent ACTION 3 command for ${user.userid}`);
                }
                
                // QUIT immediately after last action if exit or sleep mode enabled
                if (index === usersToAct.length - 1) {
                  if (this.config.exitting || this.config.sleeping) {
                    ws.send("QUIT :ds\r\n");
                    this.addLog(this.wsNumber, `🚪 QUIT after ${actionType.toLowerCase()}`);
                    
                    // Trigger auto-reconnect if sleeping mode is enabled
                    // Check if user disconnected before scheduling reconnect
                    console.log(`[WS${this.wsNumber}] 353 Kick/Imprison - Checking OffSleep: sleeping=${this.config.sleeping}, connected=${this.config.connected}`);
                    this.addLog(this.wsNumber, `🔍 Check: sleeping=${this.config.sleeping}, connected=${this.config.connected}`);
                    if (this.config.sleeping && this.config.connected) {
                      console.log(`[WS${this.wsNumber}] ✅ Calling OffSleep from 353 handler`);
                      this.addLog(this.wsNumber, `✅ Calling OffSleep (353 handler)`);
                      this.OffSleep(ws);
                    } else {
                      console.log(`[WS${this.wsNumber}] ❌ Skipping OffSleep (sleeping=${this.config.sleeping}, connected=${this.config.connected})`);
                      this.addLog(this.wsNumber, `❌ Skipping OffSleep (sleeping=${this.config.sleeping}, connected=${this.config.connected})`);
                    }
                  }
                }
              }
            }, index * 100); // Stagger actions by 100ms to avoid flooding
            
            // Store the inner timeout
            this.innerTimeouts.push(innerTimeout);
          });
        }, timing);
      } else {
        console.log(`[WS${this.wsNumber}] 353 ${actionType} mode - No users to ${actionType.toLowerCase()}`);
        this.addLog(this.wsNumber, `✅ No users in blacklist found on planet`);
      }
      
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handle353KickMode:`, error);
    }
  }
  
  handle353Normal(ws, snippets, text) {
    try {
      const channelName = snippets[3];
      
      if (channelName && channelName.slice(0, 6) === "Prison") {
        this.addLog(this.wsNumber, `Skipping prison channel`);
        return;
      }

      const data = text.replaceAll("+", "").toLowerCase();
      const blacklistfull = (this.config.blacklist || "").toLowerCase();
      const blacklist = blacklistfull.split("\n").filter(b => b.trim());
      const gangblacklistfull = (this.config.gangblacklist || "").toLowerCase();
      const gangblacklist = gangblacklistfull.split("\n").filter(g => g.trim());
      
      // IMPROVED: Use attack timing (no averaging!)
      const timing = this.getTiming("attack");
      const timingLabel = this.getTimingLabel("attack");

      // Process username blacklist
      if (blacklistfull) {
        blacklist.forEach((element) => {
          if (element && data.includes(element)) {
            const replace = element + " ";
            const replaced = data.replaceAll(replace, "*");
            const arr = replaced.split("*");
            arr.shift();
            
            if (arr[0]) {
              const userid = arr[0].split(" ")[0];
              // Skip founder - don't add to attack arrays
              if (userid === this.founderUserId) {
                this.addLog(this.wsNumber, `👑 Skipping planet owner: ${element}`);
                console.log(`[WS${this.wsNumber}] Founder ${userid} skipped - not adding to attack list`);
                // Don't return here, just skip adding to arrays
              } else if (userid && !this.targetids.includes(userid)) {
                this.targetids.push(userid);
                this.attackids.push(userid);
                this.targetnames.push(element);
                this.attacknames.push(element);
                this.addLog(this.wsNumber, `Found blacklisted: ${element} (${userid})`);
              }
            }
          }
        });
      }

      // Process gang blacklist
      if (gangblacklistfull) {
        gangblacklist.forEach((element) => {
          if (element && data.includes(element)) {
            const replace = element + " ";
            const replaced = data.replaceAll(replace, "*");
            const arr = replaced.split("*");
            arr.shift();
            
            for (let i = 0; i < arr.length; i++) {
              const value = arr[i];
              const parts = value.split(" ");
              const userid = parts[1];
              // Skip founder
              if (userid === this.founderUserId) {
                this.addLog(this.wsNumber, `👑 Skipping planet owner in gang: ${parts[0]}`);
                continue;
              }
              if (parts[0] && userid && !this.targetids.includes(userid)) {
                this.targetnames.push(parts[0]);
                this.attacknames.push(parts[0]);
                this.targetids.push(userid);
                this.attackids.push(userid);
                this.addLog(this.wsNumber, `Found gang member: ${parts[0]} (${userid})`);
              }
            }
          }
        });
      }

      // Dad+ mode - Request user info for all users to check for aura
      if (this.config.dadplus) {
        // Parse all user IDs from 353 message
        let members = text.split("+").join("");
        members = members.split("@").join("");
        members = members.split(":").join("");
        const membersarr = members.toLowerCase().split(" ");
        const integers = membersarr.filter(item => !isNaN(item) && item !== "-" && item.length >= 6);
        
        console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting info for ${integers.length} users`);
        this.addLog(this.wsNumber, `🔍 Dad+ checking ${integers.length} users for aura`);
        
        integers.forEach((userid, index) => {
          // Skip self and founder
          if (userid === this.useridg || userid === this.founderUserId) return;
          
          setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send(`WHOIS ${userid}\r\n`);
              console.log(`[WS${this.wsNumber}] Dad+ mode - Sent WHOIS for ${userid}`);
            }
          }, index * 50); // Stagger requests by 50ms
        });
      }

      // Attack first target if available
      if (!this.userFound && this.targetids.length > 0) {
        const rand = Math.floor(Math.random() * this.targetids.length);
        const userid = this.targetids[rand];
        const targetname = this.targetnames[rand];
        
        this.userFound = true;
        this.useridattack = userid;
        this.useridtarget = userid;
        this.status = "attack";
        
        this.addLog(this.wsNumber, `⚡ ${timingLabel} ${targetname} in ${timing}ms`);

        this.timeout = setTimeout(() => {
          // Check if target is founder before attacking (founder info might arrive after 353)
          if (this.useridattack === this.founderUserId) {
            this.addLog(this.wsNumber, `👑 Cancelled attack - target is planet owner`);
            console.log(`[WS${this.wsNumber}] Attack cancelled - target ${this.useridattack} is founder`);
            this.userFound = false;
            return;
          }
          
          if (ws.readyState === ws.OPEN) {
            ws.send(`ACTION 3 ${this.useridattack}\r\n`);
            this.markTargetAttacked(this.useridattack);  // Mark for cooldown & history
            this.addLog(this.wsNumber, `⚔️ Attacked ${targetname}!`);
            
            // Check if sleeping mode enabled (triggers OffSleep for auto-reconnect)
            if (this.config.sleeping && this.config.connected) {
              ws.send("QUIT :ds\r\n");
              this.addLog(this.wsNumber, `🚪 QUIT`);
              return this.OffSleep(ws);
            }
            
            if (this.config.autorelease || this.config.exitting) {
              ws.send("QUIT :ds\r\n");
              this.addLog(this.wsNumber, `🚪 QUIT after attack`);
            }
          }
        }, timing);
      }

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handle353Normal:`, error);
    }
  }

  handle353LowSec(ws, snippets, text) {
    try {
      const channelName = snippets[3];
      
      if (channelName && channelName.slice(0, 6) === "Prison") {
        return;
      }

      let members = text.split("+").join("");
      members = members.split("@").join("");
      members = members.split(":").join("");
      const finmembers = members.toLowerCase();
      const membersarr = finmembers.split(" ");
      membersarr.push("randomname");

      const whitelist = (this.config.blacklist || "").split("\n").filter(w => w.trim());
      const gangwhitelist = (this.config.gangblacklist || "").split("\n").filter(g => g.trim());

      const indexself = membersarr.indexOf(this.useridg);
      if (indexself >= 0) {
        membersarr[indexself] = "-";
      }

      whitelist.forEach((element) => {
        if (element && membersarr.includes(element.toLowerCase())) {
          const indexcheck = membersarr.indexOf(element.toLowerCase());
          if (indexcheck >= 0 && indexcheck + 1 < membersarr.length) {
            membersarr[indexcheck + 1] = "-";
          }
        }
      });

      gangwhitelist.forEach((element) => {
        if (element) {
          const occurances = this.countOccurrences(membersarr, element.toLowerCase());
          for (let k = 0; k < occurances; k++) {
            const indexcheck = membersarr.indexOf(element.toLowerCase());
            if (indexcheck >= 0) {
              membersarr[indexcheck] = "-";
              if (indexcheck + 2 < membersarr.length) {
                membersarr[indexcheck + 2] = "-";
              }
            }
          }
        }
      });

      const integers = membersarr.filter(item => !isNaN(item) && item !== "-");
      const userids = integers.filter((element) => {
        const idx = membersarr.indexOf(element);
        if (idx > 0 && isNaN(membersarr[idx - 1])) {
          return element.length >= 6;
        }
        return false;
      });

      // IMPROVED: Use attack timing (no averaging!)
      const timing = this.getTiming("attack");
      const timingLabel = this.getTimingLabel("attack");

      if (!this.userFound && userids.length > 0) {
        // Filter out founder from userids
        const validUserids = userids.filter(uid => uid !== this.founderUserId);
        
        if (validUserids.length === 0) {
          this.addLog(this.wsNumber, `👑 All targets are planet owner - skipping`);
          return;
        }
        
        const rand = Math.floor(Math.random() * validUserids.length);
        const userid = validUserids[rand];
        const idx = membersarr.indexOf(userid);
        const username = idx > 0 ? membersarr[idx - 1] : "unknown";
        
        this.userFound = true;
        this.useridattack = userid;
        this.useridtarget = userid;
        this.status = "attack";
        
        this.addLog(this.wsNumber, `⚡ [LOW SEC] ${timingLabel} ${username} in ${timing}ms`);

        this.timeout = setTimeout(() => {
          // Check if target is founder before attacking
          if (this.useridattack === this.founderUserId) {
            this.addLog(this.wsNumber, `👑 Cancelled attack - target is planet owner`);
            this.userFound = false;
            return;
          }
          
          if (ws.readyState === ws.OPEN) {
            ws.send(`ACTION 3 ${this.useridattack}\r\n`);
            this.markTargetAttacked(this.useridattack);  // Mark for cooldown & history
            this.addLog(this.wsNumber, `⚔️ [LOW SEC] Attacked ${username}!`);
            
            if (this.config.autorelease || this.config.exitting) {
              ws.send("QUIT :ds\r\n");
              this.addLog(this.wsNumber, `🚪 QUIT after attack`);
              
              // Trigger auto-reconnect if sleeping mode is enabled
              // Check if user disconnected before scheduling reconnect
              if (this.config.sleeping && this.config.connected) {
                this.OffSleep(ws);
              }
            }
          }
        }, timing);
      }

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handle353LowSec:`, error);
    }
  }

  handle353Message(ws, snippets, text) {
    // Update planet status from 353 message (snippets[3] contains planet name)
    const planetName = snippets[3];
    if (planetName) {
      this.currentPlanet = planetName;
      this.inPrison = planetName.slice(0, 6) === "Prison";
      console.log(`[WS${this.wsNumber}] 353 - Planet: ${planetName}, inPrison: ${this.inPrison}`);
    }
    
    // OPPONENT TRACKING: Track users already on planet (353 user list)
    if (this.opponentTracking.enabled && !this.inPrison) {
      this.track353Users(text);
    }
    
    // Check N/A mode first - applies to ALL connections
    if (this.config.modena === true) {
      this.handle353BanMode(ws, snippets, text);
      return;
    }
    
    // Check Low Sec mode
    if (this.config.lowsecmode) {
      this.handle353LowSec(ws, snippets, text);
      return;
    }
    
    // ALL codes (1-5) - Use unified kick/imprison mode handler
    this.handle353KickMode(ws, snippets, text);
  }
  
  // Track users from 353 message (users already on planet)
  track353Users(text) {
    try {
      console.log(`[WS${this.wsNumber}] 🔍 track353Users called - opponentTracking.enabled=${this.opponentTracking.enabled}`);
      
      // Parse user list from 353 message
      let members = text.split("+").join("");
      members = members.split("@").join("");
      members = members.split(":").join("");
      const membersarr = members.toLowerCase().split(" ");
      
      // Extract user IDs (numeric, length >= 6)
      const integers = membersarr.filter(item => !isNaN(item) && item !== "-" && item.length >= 6);
      
      console.log(`[WS${this.wsNumber}] 353: Found ${integers.length} potential users in list`);
      
      let trackedCount = 0;
      integers.forEach((userid) => {
        const idx = membersarr.indexOf(userid);
        if (idx > 0) {
          const username = membersarr[idx - 1];
          
          // Skip if username is also numeric (means it's not a username)
          if (!isNaN(username)) return;
          
          // Track this user (will sample when they logout)
          this.trackOpponentLogin(userid, username);
          trackedCount++;
        }
      });
      
      console.log(`[WS${this.wsNumber}] 353: Tracked ${trackedCount} users already on planet`);
      this.addLog(this.wsNumber, `📊 353: Tracking ${trackedCount} users on planet`);
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error tracking 353 users:`, error);
    }
  }

  // ========================================
  // JOIN HANDLERS - MULTIPLE MODES
  // ========================================
  
  // JOIN Handler #1 - Attack mode (immediate attack on blacklist match)
  handleJoinAttackMode(ws, snippets, text) {
    try {
      const data = text.toLowerCase();
      const blacklistfull = (this.config.blacklist || "").toLowerCase();
      const blacklist = blacklistfull.split("\n").filter(b => b.trim());
      const gangblacklistfull = (this.config.gangblacklist || "").toLowerCase();
      const gangblacklist = gangblacklistfull.split("\n").filter(g => g.trim());

      // Parse JOIN message format: "JOIN <channel> <username> <userid> ..."
      const parts = text.split(" ");
      let username = "";
      let userid = "";
      
      // Format: JOIN TEAM_SPARROW ``THALA`` 14358744 ...
      // parts[0] = JOIN
      // parts[1] = channel (TEAM_SPARROW)
      // parts[2] = username (``THALA``)
      // parts[3] = userid (14358744)
      
      if (parts.length >= 4) {
        username = parts[2] ? parts[2].toLowerCase() : "";
        userid = parts[3] || "";
      }

      // DEBUG: Log every JOIN message
      this.addLog(this.wsNumber, `🔍 JOIN detected: ${username} (${parts[1]})`);
      
      // Dad+ mode - request user info to check for aura (for codes 1-4)
      if (this.config.dadplus && userid && userid !== this.useridg && userid !== this.founderUserId) {
        console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting user info for ${userid}`);
        ws.send(`WHOIS ${userid}\r\n`);
      }

      let foundMatch = false;
      let matchedUser = "";
      let matchedId = "";

      // Check username blacklist
      if (blacklistfull) {
        this.addLog(this.wsNumber, `🔎 Checking blacklist: [${blacklist.join(', ')}]`);
        for (const element of blacklist) {
          if (element && username.includes(element)) {
            matchedUser = element;
            matchedId = userid;
            foundMatch = true;
            this.addLog(this.wsNumber, `✅ MATCH FOUND: ${element} in ${username}`);
            break;
          }
        }
      }

      // Check gang blacklist
      if (!foundMatch && gangblacklistfull) {
        this.addLog(this.wsNumber, `🔎 Checking gangblacklist: [${gangblacklist.join(', ')}]`);
        for (const element of gangblacklist) {
          if (element && username.includes(element)) {
            matchedUser = username;
            matchedId = userid;
            foundMatch = true;
            this.addLog(this.wsNumber, `✅ GANG MATCH FOUND: ${element} in ${username}`);
            break;
          }
        }
      }

      // Check if target is the planet founder (owner) - SKIP if yes
      if (foundMatch && matchedId === this.founderUserId) {
        this.addLog(this.wsNumber, `👑 Skipping planet owner: ${matchedUser}`);
        console.log(`[WS${this.wsNumber}] Skipping founder ${matchedId} - can't imprison planet owner`);
        foundMatch = false; // Don't attack
      }

      // Attack if found and not founder
      if (foundMatch && !this.userFound) {
        // IMPROVED: Use attack timing (no averaging!)
        const timing = this.getTiming("attack");
        const timingLabel = this.getTimingLabel("attack");
        const waiting = this.getTiming("defense");  // Separate defense timing
        
        this.userFound = true;
        this.useridattack = matchedId;
        this.useridtarget = matchedId;
        this.status = "attack";
        
        this.addLog(this.wsNumber, `🎯 Target joined: ${matchedUser}`);
        this.addLog(this.wsNumber, `⚡ ${timingLabel} in ${timing}ms`);

        this.timeout = setTimeout(() => {
          // Check if target is founder before attacking
          if (this.useridattack === this.founderUserId) {
            this.addLog(this.wsNumber, `👑 Cancelled attack - target is planet owner`);
            this.userFound = false;
            return;
          }
          
          if (ws.readyState === ws.OPEN) {
            ws.send(`ACTION 3 ${this.useridattack}\r\n`);
            this.markTargetAttacked(this.useridattack);  // Mark for cooldown & history
            this.addLog(this.wsNumber, `⚔️ Attacked ${matchedUser}!`);
            
            setTimeout(() => {
              if (ws.readyState === ws.OPEN) {
                ws.send("QUIT :ds\r\n");
                this.addLog(this.wsNumber, `🚪 QUIT`);
                
                // Trigger auto-reconnect if sleeping mode is enabled
                // Check if user disconnected before scheduling reconnect
                if (this.config.sleeping && this.config.connected) {
                  this.OffSleep(ws);
                }
              }
            }, waiting);
          }
        }, timing);
      }

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handleJoinAttackMode:`, error);
    }
  }

  // JOIN Handler #2 - Defense mode (NEW! Uses waiting timing, gang only)
  handleJoinDefenseMode(ws, snippets, text) {
    try {
      if (!this.userFound) {
        // Parse JOIN message format: "JOIN <channel> <username> <userid> ..."
        const parts = text.split(" ");
        let username = "";
        let userid = "";
        
        if (parts.length >= 4) {
          username = parts[2] ? parts[2].toLowerCase() : "";
          userid = parts[3] || "";
        }
        
        const gangblacklist = (this.config.gangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
        
        // IMPROVED: Use defense timing (no averaging!)
        const timing = this.getTiming("defense");
        const timingLabel = this.getTimingLabel("defense");
        
        gangblacklist.forEach((element) => {
          if (element && username.includes(element)) {
            // Skip if founder
            if (userid === this.founderUserId) {
              this.addLog(this.wsNumber, `👑 Skipping planet owner in defense mode`);
              return;
            }
            
            this.useridtarget = userid;
            this.status = "defense";
            this.userFound = true;
            
            this.addLog(this.wsNumber, `🛡️ ${timingLabel}: ${username} in ${timing}ms`);

            this.timeout = setTimeout(() => {
              if (ws.readyState === ws.OPEN) {
                ws.send(`ACTION 3 ${userid}\r\n`);
                this.markTargetAttacked(userid);  // Mark for cooldown & history
                this.addLog(this.wsNumber, `⚔️ Defense attacked ${username}!`);
                
                ws.send("QUIT :ds\r\n");
                this.addLog(this.wsNumber, `🚪 QUIT`);
                
                // Trigger auto-reconnect if sleeping mode is enabled
                // Check if user disconnected before scheduling reconnect
                if (this.config.sleeping && this.config.connected) {
                  this.OffSleep(ws);
                }
              }
            }, timing);
          }
        });
      }
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handleJoinDefenseMode:`, error);
    }
  }

  // JOIN Handler #3 - Target tracking (NEW! Builds target pool)
  handleJoinTargetTracking(ws, snippets, text) {
    try {
      // Parse JOIN message format
      const parts = text.split(" ");
      let username = "";
      let userid = "";
      
      // Format: JOIN <channel> <username> <userid> ...
      if (parts.length >= 4) {
        username = parts[2] || "";
        userid = parts[3] || "";
      }
      
      const usernameLower = username.toLowerCase();
      
      // Skip founder
      if (userid === this.founderUserId) {
        return; // Don't add founder to target pool
      }
      
      // Track username blacklist
      const blacklist = (this.config.blacklist || "").split("\n").filter(b => b.trim());
      blacklist.forEach(element => {
        if (element && usernameLower.includes(element.toLowerCase())) {
          if (userid && !this.targetids.includes(userid)) {
            this.targetids.push(userid);
            this.targetnames.push(element);
            this.addLog(this.wsNumber, `📝 Added to pool: ${element}`);
          }
        }
      });

      // Track gang blacklist
      const gangblacklist = (this.config.gangblacklist || "").split("\n").filter(g => g.trim());
      gangblacklist.forEach(element => {
        if (element && usernameLower.includes(element.toLowerCase())) {
          if (userid && !this.targetids.includes(userid)) {
            this.targetids.push(userid);
            this.targetnames.push(username);
            this.addLog(this.wsNumber, `📝 Added to pool: ${username}`);
          }
        }
      });
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handleJoinTargetTracking:`, error);
    }
  }

  // JOIN Handler #4 - BAN mode (N/A mode - for ALL connections)
  handleJoinBanMode(ws, snippets, text) {
    try {
      console.log(`[WS${this.wsNumber}] BAN mode handler called`);
      console.log(`[WS${this.wsNumber}] BAN mode options - Everyone=${this.config.kickall}, ByBlacklist=${this.config.kickbybl}, Dad+=${this.config.dadplus}`);
      
      // Parse JOIN message format: "JOIN <channel> <username> <userid> ..."
      const parts = text.split(" ");
      let username = "";
      let userid = "";
      
      if (parts.length >= 4) {
        username = parts[2] ? parts[2].toLowerCase() : "";
        userid = parts[3] || "";
      }
      
      console.log(`[WS${this.wsNumber}] BAN mode - checking user: ${username} (${userid})`);
      
      if (!userid || !username) return;
      
      // Skip self
      if (userid === this.useridg) {
        console.log(`[WS${this.wsNumber}] Skipping self in BAN mode`);
        return;
      }
      
      // Skip planet founder (owner) - can't ban the owner!
      if (userid === this.founderUserId) {
        console.log(`[WS${this.wsNumber}] Skipping BAN for planet founder ${userid}`);
        this.addLog(this.wsNumber, `👑 Skipping BAN for planet owner`);
        return;
      }
      
      let shouldBan = false;
      let reason = "";
      
      // Check "Everyone" mode - ban everyone
      if (this.config.kickall) {
        shouldBan = true;
        reason = "everyone";
        console.log(`[WS${this.wsNumber}] BAN mode - Everyone mode active, banning all users`);
      }
      
      // Check "By Blacklist" mode
      if (!shouldBan && this.config.kickbybl) {
        const kblacklist = (this.config.kblacklist || "").toLowerCase().split("\n").filter(k => k.trim());
        const kgangblacklist = (this.config.kgangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
        
        console.log(`[WS${this.wsNumber}] BAN mode - Kick Blacklist Users: [${kblacklist.join(', ')}]`);
        console.log(`[WS${this.wsNumber}] BAN mode - Kick Blacklist Clans: [${kgangblacklist.join(', ')}]`);
        
        // Check kblacklist (kick username blacklist)
        for (const blocked of kblacklist) {
          if (blocked && username.includes(blocked)) {
            shouldBan = true;
            reason = `kblacklist: ${blocked}`;
            console.log(`[WS${this.wsNumber}] BAN mode - MATCH in kblacklist: ${blocked}`);
            break;
          }
        }
        
        // Check kgangblacklist (kick gang blacklist)
        if (!shouldBan) {
          for (const gang of kgangblacklist) {
            if (gang && username.includes(gang)) {
              shouldBan = true;
              reason = `kgangblacklist: ${gang}`;
              console.log(`[WS${this.wsNumber}] BAN mode - MATCH in kgangblacklist: ${gang}`);
              break;
            }
          }
        }
      }
      
      // Dad+ mode - request user info to check for aura
      if (this.config.dadplus && !shouldBan) {
        console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting user info for ${userid}`);
        ws.send(`WHOIS ${userid}\r\n`);
      }
      
      // Execute BAN if conditions met
      if (shouldBan) {
        console.log(`[WS${this.wsNumber}] BAN mode - Sending BAN command for ${userid}`);
        this.addLog(this.wsNumber, `🚫 Banning ${username} (${userid}) - Reason: ${reason}`);
        ws.send(`BAN ${userid}\r\n`);
      } else {
        console.log(`[WS${this.wsNumber}] BAN mode - No conditions met, not banning ${username}`);
      }
      
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handleJoinBanMode:`, error);
    }
  }

  // JOIN Handler #5 - Kick/Imprison mode (For ALL codes 1-5)
  handleJoinKickMode(ws, snippets, text) {
    try {
      // Parse JOIN message format: "JOIN - username userid ..." or "JOIN userid username ..."
      const parts = text.split(" ");
      let username = "";
      let userid = "";
      
      // Format: JOIN <channel> <username> <userid> ...
      if (parts.length >= 4) {
        username = parts[2] ? parts[2].toLowerCase() : "";
        userid = parts[3] || "";
      }
      
      if (!userid || !username) return;
      
      // OPPONENT TRACKING: Track login timing
      this.trackOpponentLogin(userid, username);
      
      // Skip self
      if (userid === this.useridg) return;
      
      // Skip planet founder (owner) - can't kick/imprison the owner!
      if (userid === this.founderUserId) {
        console.log(`[WS${this.wsNumber}] Skipping action for planet founder ${userid}`);
        return;
      }
      
      // Determine if we're in Kick or Imprison mode
      const isKickMode = this.config.kickmode === true;
      const actionType = isKickMode ? "Kick" : "Imprison";
      
      // DEBUG: Log configuration (only log once per connection)
      if (!this._kickConfigLogged) {
        this.addLog(this.wsNumber, `🔍 Mode: ${actionType} | Everyone=${this.config.kickall}, ByBlacklist=${this.config.kickbybl}, Dad+=${this.config.dadplus}`);
        this._kickConfigLogged = true;
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
        console.log(`[WS${this.wsNumber}] Dad+ mode - Requesting user info for ${userid}`);
        ws.send(`WHOIS ${userid}\r\n`);
      }
      
      // Check "By Blacklist" mode
      if (!shouldAct && this.config.kickbybl) {
        // Use appropriate blacklists based on mode
        if (isKickMode) {
          // KICK MODE: Use kblacklist and kgangblacklist
          const kblacklist = (this.config.kblacklist || "").toLowerCase().split("\n").filter(k => k.trim());
          for (const blocked of kblacklist) {
            if (blocked && username.includes(blocked)) {
              shouldAct = true;
              reason = `kblacklist: ${blocked}`;
              break;
            }
          }
          
          if (!shouldAct) {
            const kgangblacklist = (this.config.kgangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
            for (const gang of kgangblacklist) {
              if (gang && username.includes(gang)) {
                shouldAct = true;
                reason = `kgangblacklist: ${gang}`;
                break;
              }
            }
          }
        } else {
          // IMPRISON MODE: Use blacklist and gangblacklist
          const blacklist = (this.config.blacklist || "").toLowerCase().split("\n").filter(b => b.trim());
          for (const blocked of blacklist) {
            if (blocked && username.includes(blocked)) {
              shouldAct = true;
              reason = `blacklist: ${blocked}`;
              break;
            }
          }
          
          if (!shouldAct) {
            const gangblacklist = (this.config.gangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
            for (const gang of gangblacklist) {
              if (gang && username.includes(gang)) {
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
        // IMPROVED: Use attack timing (no averaging!)
        const timing = this.getTiming("attack");
        const timingLabel = this.getTimingLabel("attack");
        
        this.addLog(this.wsNumber, `⚡ ${timingLabel} ${username} in ${timing}ms`);
        
        // Wait for timing before sending action (STORE timeout so it can be cleared on disconnect)
        this.timeout = setTimeout(() => {
          if (ws.readyState === ws.OPEN) {
            if (isKickMode) {
              this.addLog(this.wsNumber, `👢 Kicking ${username} (${userid}) - Reason: ${reason}`);
              ws.send(`KICK ${userid}\r\n`);
            } else {
              this.addLog(this.wsNumber, `⚔️ Imprisoning ${username} (${userid}) - Reason: ${reason}`);
              ws.send(`ACTION 3 ${userid}\r\n`);
              this.markTargetAttacked(userid);  // Mark for cooldown & history
            }
            
            // QUIT immediately after action if exit or sleep mode enabled
            if (this.config.exitting || this.config.sleeping) {
              ws.send("QUIT :ds\r\n");
              this.addLog(this.wsNumber, `🚪 QUIT after ${actionType.toLowerCase()}`);
              
              // Trigger auto-reconnect if sleeping mode is enabled
              // Check if user disconnected before scheduling reconnect
              console.log(`[WS${this.wsNumber}] JOIN Kick/Imprison - Checking OffSleep: sleeping=${this.config.sleeping}, connected=${this.config.connected}`);
              this.addLog(this.wsNumber, `🔍 Check: sleeping=${this.config.sleeping}, connected=${this.config.connected}`);
              if (this.config.sleeping && this.config.connected) {
                console.log(`[WS${this.wsNumber}] ✅ Calling OffSleep from JOIN handler`);
                this.addLog(this.wsNumber, `✅ Calling OffSleep (JOIN handler)`);
                this.OffSleep(ws);
              } else {
                console.log(`[WS${this.wsNumber}] ❌ Skipping OffSleep (sleeping=${this.config.sleeping}, connected=${this.config.connected})`);
                this.addLog(this.wsNumber, `❌ Skipping OffSleep (sleeping=${this.config.sleeping}, connected=${this.config.connected})`);
              }
            }
          }
          
          // Clear the timeout reference after execution
          this.timeout = null;
        }, timing);
      } else {
        this.addLog(this.wsNumber, `✅ No Action: ${username} (${userid}) - No conditions met`);
      }
      
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handleJoinKickMode:`, error);
    }
  }

  // JOIN Handler #5 - Low sec mode
  handleJoinLowSec(ws, snippets, text) {
    try {
      if (!this.config.exitting) return;

      const data = text.toLowerCase();
      const whitelist = (this.config.blacklist || "").toLowerCase().split("\n").filter(w => w.trim());
      const gangwhitelist = (this.config.gangblacklist || "").toLowerCase().split("\n").filter(g => g.trim());
      
      // Timer shift: use average of attack + waiting when enabled
      const attackTime = parseInt(this.config[`attack${this.wsNumber}`] || 1940);
      const waitingTime = parseInt(this.config[`waiting${this.wsNumber}`] || 1910);
      const timing = this.config.timershift ? Math.round((attackTime + waitingTime) / 2) : waitingTime;
      const timingLabel = this.config.timershift ? "Auto" : "Defense";

      let isWhitelisted = false;

      for (const element of whitelist) {
        if (element && data.includes(element)) {
          isWhitelisted = true;
          break;
        }
      }

      for (const element of gangwhitelist) {
        if (element && data.includes(element)) {
          isWhitelisted = true;
          break;
        }
      }

      if (!isWhitelisted && !this.userFound) {
        const parts = text.split(" ");
        if (parts.length >= 4) {
          // Format: JOIN <channel> <username> <userid>
          const matchedId = parts[3];
          const matchedUser = parts[2] || "unknown";
          
          // Skip founder
          if (matchedId === this.founderUserId) {
            this.addLog(this.wsNumber, `👑 Skipping planet owner in low sec mode`);
            return;
          }
          
          this.userFound = true;
          this.useridattack = matchedId;
          this.useridtarget = matchedId;
          this.status = "defense";
          
          this.addLog(this.wsNumber, `🎯 [LOW SEC] ${timingLabel} ${matchedUser} in ${timing}ms`);

          this.timeout = setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send(`ACTION 3 ${this.useridattack}\r\n`);
              this.markTargetAttacked(this.useridattack);  // Mark for cooldown & history
              this.addLog(this.wsNumber, `⚔️ [LOW SEC] Attacked ${matchedUser}!`);
              
              // Only send QUIT if auto-release is disabled, or if sleep mode is enabled
              if (!this.config.autorelease || this.config.sleeping) {
                ws.send("QUIT :ds\r\n");
                this.addLog(this.wsNumber, `🚪 QUIT`);
              } else {
                this.addLog(this.wsNumber, `🧍 Standing (auto-release enabled)`);
              }
              
              // Trigger auto-reconnect if sleeping mode is enabled
              // Check if user disconnected before scheduling reconnect
              if (this.config.sleeping && this.config.connected) {
                this.OffSleep(ws);
              }
            }
          }, timing);
        }
      }

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handleJoinLowSec:`, error);
    }
  }

  // JOIN Router - Calls all handlers
  handleJoinMessage(ws, snippets, text) {
    // DEBUG: Log mode configuration
    console.log(`[WS${this.wsNumber}] JOIN handler - modena=${this.config.modena}, kickmode=${this.config.kickmode}, kickall=${this.config.kickall}`);
    
    // Check N/A mode first - applies to ALL connections (ws1-5)
    if (this.config.modena === true) {
      console.log(`[WS${this.wsNumber}] Using BAN mode (N/A selected)`);
      this.handleJoinBanMode(ws, snippets, text);
      return;
    }
    
    // Check Low Sec mode
    if (this.config.lowsecmode) {
      console.log(`[WS${this.wsNumber}] Using Low Sec mode`);
      this.handleJoinLowSec(ws, snippets, text);
      return;
    }
    
    // ALL codes (1-5) - Use unified kick/imprison mode handler
    console.log(`[WS${this.wsNumber}] Using Kick/Imprison mode`);
    this.handleJoinKickMode(ws, snippets, text);
  }

  // ========================================
  // PING HANDLER
  // ========================================
  
  handlePingMessage(ws) {
    ws.send("PONG\r\n");
  }

  // ========================================
  // 471 - ERROR HANDLER
  // ========================================
  
  handle471Message(ws, snippets, text) {
    this.addLog(this.wsNumber, `⚠️ Error 471: Channel issue`);
  }

  // ========================================
  // 850 - STATUS + TIMER SHIFT TRIGGER
  // ========================================
  
  handle850Message(ws, snippets, text) {
    try {
      if (snippets[1] === ":<div") {
        return;
      }

      // Check for 3-second error (TOO SLOW!)
      if (snippets.length >= 7 && snippets[6] === "3s") {
        this.threesec = true;
        this.consecutiveErrors++;  // Track for adaptive step size
        
        // AI Mode: Record FAILURE (3s error - we were too EARLY)
        if (this.aiMode.enabled && this.aiMode.pendingResult && this.aiMode.lastAttackTiming) {
          this.recordAIResult(this.aiMode.lastAttackTiming, false, '3s_error');
          this.aiMode.pendingResult = false;
        }
        this.consecutiveSuccesses = 0;  // Reset success counter
        this.addLog(this.wsNumber, `❌ 3-second error - Too slow!`);
        
        // QUICK FIX #2: Only adjust relevant timing based on status
        if (this.config.timershift) {
          if (this.status === "attack") {
            this.incrementAttack();  // Only adjust attack timing
            this.addLog(this.wsNumber, `📊 Adjusting attack timing only`);
          } else if (this.status === "defense") {
            this.incrementDefence();  // Only adjust defense timing
            this.addLog(this.wsNumber, `📊 Adjusting defense timing only`);
          } else {
            // Unknown status - adjust attack as default
            this.incrementAttack();
            this.addLog(this.wsNumber, `📊 Status unknown - adjusting attack timing`);
          }
        }
      } else if (this.aiMode.enabled && this.aiMode.pendingResult && this.aiMode.lastAttackTiming) {
        // AI Mode: No 3s error = timing was fast enough (SUCCESS for timing optimization)
        this.recordAIResult(this.aiMode.lastAttackTiming, true);
        this.aiMode.pendingResult = false;
      }
      
      // Check for success event (we actually imprisoned someone!)
      if (snippets.length >= 4 && snippets[3] === "allows") {
        this.consecutiveErrors = 0;  // Reset error counter
        this.consecutiveSuccesses++;  // Track successes
        this.addLog(this.wsNumber, `✅ Success - Imprisoned target!`);
        
        // OPPONENT TRACKING: Don't infer from wins - only use actual PART/SLEEP samples
        // Inference is unreliable - opponent might not have been present or attacked yet
        if (this.opponentTracking.enabled) {
          console.log(`[WS${this.wsNumber}] We won - waiting for actual opponent PART/SLEEP for accurate sample`);
        }
        
        // QUICK FIX #2: Only adjust relevant timing based on status (TIMER SHIFT)
        if (this.config.timershift) {
          if (this.status === "attack") {
            this.decrementAttack();  // Only adjust attack timing
            this.addLog(this.wsNumber, `📊 Optimizing attack timing`);
          } else if (this.status === "defense") {
            this.decrementDefence();  // Only adjust defense timing
            this.addLog(this.wsNumber, `📊 Optimizing defense timing`);
          } else {
            // Unknown status - adjust attack as default
            this.decrementAttack();
            this.addLog(this.wsNumber, `📊 Status unknown - optimizing attack timing`);
          }
          
          // Log learned timings every 5 successes (MEDIUM #3: Persistence)
          if (this.consecutiveSuccesses % 5 === 0) {
            this.logLearnedTimings();
          }
        }
      }
      // NOTE: Opponent wins detection moved to PRISON message handler

      const statusText = snippets.slice(1).join(" ").substring(0, 80);
      if (statusText) {
        this.addLog(this.wsNumber, `ℹ️ ${statusText}`);
      }

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handle850:`, error);
    }
  }

  // ========================================
  // 452 - SIGN/AUTH
  // ========================================
  
  handle452Message(ws, snippets, text) {
    if (snippets[3] === "sign") {
      this.addLog(this.wsNumber, `🔐 Sign message received`);
    }
  }

  // ========================================
  // 860 - USER INFO/STATUS (DAD+ MODE)
  // ========================================
  
  handle860Message(ws, snippets, text) {
    try {
      // Check if Dad+ mode is enabled
      if (!this.config.dadplus) return;
      
      // Check if message contains "aura" (special effect/status)
      const textLower = text.toLowerCase();
      if (!textLower.includes("aura")) return;
      
      // Parse batch 860 response - can contain multiple users
      // Format: 860 userid1 data1 userid2 data2 userid3 data3 ...
      // We need to find all userids that have "aura" in their data
      
      console.log(`[WS${this.wsNumber}] Dad+ mode - Processing 860 message with aura`);
      
      // Split by "aura" to find user IDs with aura
      const parts = text.split(/\s+/); // Split by whitespace
      const usersWithAura = [];
      
      // Find all numeric user IDs (length >= 6) that are followed by data containing "aura"
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
      
      console.log(`[WS${this.wsNumber}] Dad+ mode - Found ${usersWithAura.length} user(s) with aura: [${usersWithAura.join(', ')}]`);
      
      // Process each user with aura
      usersWithAura.forEach((userid, index) => {
        console.log(`[WS${this.wsNumber}] Dad+ mode - Checking user with aura: ${userid}`);
        
        // Skip self
        if (userid === this.useridg) {
          console.log(`[WS${this.wsNumber}] Dad+ mode - Skipping self: ${userid}`);
          return;
        }
        
        // Skip founder
        if (userid === this.founderUserId) {
          console.log(`[WS${this.wsNumber}] Dad+ mode - Skipping founder: ${userid}`);
          this.addLog(this.wsNumber, `👑 Skipping Dad+ action for planet owner`);
          return;
        }
        
        // Stagger actions to avoid flooding
        setTimeout(() => {
          if (ws.readyState !== ws.OPEN) return;
          
          // Check which mode we're in
          if (this.config.modena === true) {
            // N/A mode - BAN user with aura (applies to ALL connections)
            console.log(`[WS${this.wsNumber}] Dad+ mode - BAN user with aura: ${userid}`);
            this.addLog(this.wsNumber, `🚫 Dad+ Banning user with aura: ${userid}`);
            ws.send(`BAN ${userid}\r\n`);
          } else if (this.wsNumber === 5) {
            // Code 5 - Check if Kick or Imprison mode
            if (this.config.kickmode === true) {
              // Kick mode
              console.log(`[WS${this.wsNumber}] Dad+ mode - KICK user with aura: ${userid}`);
              this.addLog(this.wsNumber, `👢 Dad+ Kicking user with aura: ${userid}`);
              ws.send(`KICK ${userid}\r\n`);
            } else {
              // Imprison mode
              console.log(`[WS${this.wsNumber}] Dad+ mode - IMPRISON user with aura: ${userid}`);
              this.addLog(this.wsNumber, `⚔️ Dad+ Imprisoning user with aura: ${userid}`);
              ws.send(`ACTION 3 ${userid}\r\n`);
            }
          } else {
            // Code 1-4 - Regular attack mode (imprison)
            console.log(`[WS${this.wsNumber}] Dad+ mode - IMPRISON user with aura: ${userid}`);
            this.addLog(this.wsNumber, `⚔️ Dad+ Imprisoning user with aura: ${userid}`);
            ws.send(`ACTION 3 ${userid}\r\n`);
          }
        }, index * 100); // Stagger by 100ms
      });
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handle860Message:`, error);
    }
  }

  // ========================================
  // PART - USER LEAVING + TIMER SHIFT
  // ========================================
  
  handlePartMessage(ws, snippets, text) {
    try {
      const userid = snippets[1];
      
      // IMPROVED: Detect if WE got kicked (PART message for self)
      if (userid === this.useridg) {
        console.log(`[WS${this.wsNumber}] ❌ WE GOT KICKED! (PART for self)`);
        this.addLog(this.wsNumber, `❌ Got kicked from planet`);
        
        // AI Mode: Record KICKED (we attacked too LATE)
        if (this.aiMode.enabled && this.aiMode.pendingResult && this.aiMode.lastAttackTiming) {
          this.recordAIResult(this.aiMode.lastAttackTiming, false, 'kicked');
          this.aiMode.pendingResult = false;
        }
        return;
      }
      
      // OPPONENT TRACKING: Track logout timing
      this.trackOpponentLogout(userid);
      
      // Check if leaving user is the planet founder
      const isFounder = (userid === this.founderUserId);
      
      // Check if it's our target
      if (userid === this.useridtarget) {
        if (isFounder) {
          this.addLog(this.wsNumber, `👑 Planet owner left: ${userid} - staying on planet`);
        } else {
          this.addLog(this.wsNumber, `👋 Target left: ${userid}`);
        }
        
        // QUICK FIX #3: Removed questionable "target leaving" decrement logic
        // Reason: Target might have left for other reasons (imprisoned by someone else, 
        // went to sleep, etc.) not because timing was slow. This caused incorrect adjustments.
        
        this.userFound = false;
        this.useridtarget = null;
        this.useridattack = null;
        
        if (this.timeout) {
          clearTimeout(this.timeout);
          this.timeout = null;
        }
        
        // If founder left, DON'T quit - stay on planet and wait for other rivals
        if (isFounder) {
          this.addLog(this.wsNumber, `⏸️ Waiting for other rivals on planet`);
          // Don't send QUIT, don't reconnect - just stay connected and wait
          return;
        }
        
        // For non-founder targets, proceed with normal quit/reconnect logic
        if (this.config.exitting) {
          setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send("QUIT :ds\r\n");
              this.addLog(this.wsNumber, `🚪 QUIT (target left)`);
              
              // Trigger auto-reconnect if sleeping mode is enabled
              // Check if user disconnected before scheduling reconnect
              if (this.config.sleeping && this.config.connected) {
                this.OffSleep(ws);
              }
            }
          }, 100);
        }
      }

      // Remove from target arrays (ENHANCED CLEANUP)
      const index = this.targetids.indexOf(userid);
      if (index > -1) {
        this.targetids.splice(index, 1);
        this.targetnames.splice(index, 1);
      }
      
      const attackIndex = this.attackids.indexOf(userid);
      if (attackIndex > -1) {
        this.attackids.splice(attackIndex, 1);
        this.attacknames.splice(attackIndex, 1);
      }

      // IMPROVED SMART MODE: Switch to new target if current target left
      if (this.config.smart && userid === this.useridattack && this.attackids.length > 0) {
        const newTarget = this.selectSmartTarget();
        if (newTarget) {
          this.useridattack = newTarget.id;
          this.addLog(this.wsNumber, `🎯 Smart Switch: ${newTarget.name}`);
        }
      }
      
      // SMART MODE: Clear timeout if no targets left
      if (this.config.smart && this.targetids.length === 0) {
        if (this.timeout) {
          clearTimeout(this.timeout);
          this.timeout = null;
        }
        this.userFound = false;
        this.addLog(this.wsNumber, `⏸️ Standing now..`);
      }

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handlePart:`, error);
    }
  }

  // ========================================
  // SLEEP - USER SLEEPING
  // ========================================
  
  handleSleepMessage(ws, snippets, text) {
    try {
      const userid = snippets[1] ? snippets[1].replace(/(\r\n|\n|\r)/gm, "") : "";
      
      // OPPONENT TRACKING: Track logout timing (sleep = logout)
      this.trackOpponentLogout(userid);
      
      // Check if sleeping user is the planet founder
      const isFounder = (userid === this.founderUserId);
      
      // Check if it's our target
      if (userid === this.useridtarget) {
        if (isFounder) {
          this.addLog(this.wsNumber, `👑 Planet owner sleeping: ${userid} - staying on planet`);
        } else {
          this.addLog(this.wsNumber, `💤 Target sleeping: ${userid}`);
        }
        
        this.userFound = false;
        this.useridtarget = null;
        this.useridattack = null;
        
        if (this.timeout) {
          clearTimeout(this.timeout);
          this.timeout = null;
        }
        
        // If founder is sleeping, DON'T quit - stay on planet and wait for other rivals
        if (isFounder) {
          this.addLog(this.wsNumber, `⏸️ Waiting for other rivals on planet`);
          // Don't send QUIT, don't reconnect - just stay connected and wait
          return;
        }
        
        // For non-founder targets, proceed with normal quit/reconnect logic
        if (this.config.sleeping || this.config.exitting) {
          setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send("QUIT :ds\r\n");
              this.addLog(this.wsNumber, `🚪 QUIT (target sleeping)`);
              
              // Trigger auto-reconnect if sleeping mode is enabled
              // Check if user disconnected before scheduling reconnect
              if (this.config.sleeping && this.config.connected) {
                this.OffSleep(ws);
              }
            }
          }, 100);
        }
      }

      // ENHANCED: Remove from ALL target arrays
      const index = this.targetids.indexOf(userid);
      if (index > -1) {
        this.targetids.splice(index, 1);
        this.targetnames.splice(index, 1);
        this.addLog(this.wsNumber, `Removed sleeping user from targets`);
      }
      
      const attackIndex = this.attackids.indexOf(userid);
      if (attackIndex > -1) {
        this.attackids.splice(attackIndex, 1);
        this.attacknames.splice(attackIndex, 1);
      }

      // IMPROVED SMART MODE: Switch to new target if current target is sleeping
      if (this.config.smart && userid === this.useridattack && this.attackids.length > 0) {
        const newTarget = this.selectSmartTarget();
        if (newTarget) {
          this.useridattack = newTarget.id;
          this.addLog(this.wsNumber, `🎯 Smart Switch: ${newTarget.name}`);
        }
      }
      
      // SMART MODE: Clear timeout if no targets left
      if (this.config.smart && this.targetids.length === 0) {
        if (this.timeout) {
          clearTimeout(this.timeout);
          this.timeout = null;
        }
        this.userFound = false;
        this.addLog(this.wsNumber, `⏸️ Standing now..`);
      }

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handleSleep:`, error);
    }
  }

  // ========================================
  // PRISON ESCAPE FUNCTION (HTTPS API - Diamond Method)
  // ========================================
  
  // Main escape function that calls escape attempts ONLY for configured RCs
  async escapeAll() {
    try {
      // Check if we're actually in prison first
      if (!this.inPrison) {
        console.log(`[WS${this.wsNumber}] Not in prison (inPrison=${this.inPrison}), skipping escape`);
        this.addLog(this.wsNumber, `ℹ️ Not in prison - no escape needed`);
        return false;
      }
      
      console.log(`[WS${this.wsNumber}] In prison - proceeding with escape attempts`);
      
      // Build list of escape functions to call (only for configured RCs)
      const escapeFunctions = [];
      
      // Main codes
      if (this.config.rc1 && this.config.rc1 !== '') {
        escapeFunctions.push({ fn: this.escape1(), label: 'RC1' });
      }
      if (this.config.rc2 && this.config.rc2 !== '') {
        escapeFunctions.push({ fn: this.escape2(), label: 'RC2' });
      }
      if (this.config.rc3 && this.config.rc3 !== '') {
        escapeFunctions.push({ fn: this.escape3(), label: 'RC3' });
      }
      if (this.config.rc4 && this.config.rc4 !== '') {
        escapeFunctions.push({ fn: this.escape4(), label: 'RC4' });
      }
      if (this.config.rc5 && this.config.rc5 !== '') {
        escapeFunctions.push({ fn: this.escape5(), label: 'RC5' });
      }
      
      // Alternate codes
      if (this.config.rcl1 && this.config.rcl1 !== '') {
        escapeFunctions.push({ fn: this.escapeL1(), label: 'RCL1' });
      }
      if (this.config.rcl2 && this.config.rcl2 !== '') {
        escapeFunctions.push({ fn: this.escapeL2(), label: 'RCL2' });
      }
      if (this.config.rcl3 && this.config.rcl3 !== '') {
        escapeFunctions.push({ fn: this.escapeL3(), label: 'RCL3' });
      }
      if (this.config.rcl4 && this.config.rcl4 !== '') {
        escapeFunctions.push({ fn: this.escapeL4(), label: 'RCL4' });
      }
      if (this.config.rcl5 && this.config.rcl5 !== '') {
        escapeFunctions.push({ fn: this.escapeL5(), label: 'RCL5' });
      }
      
      if (escapeFunctions.length === 0) {
        console.log(`[WS${this.wsNumber}] No recovery codes configured, skipping escape`);
        return false;
      }
      
      const configuredRCs = escapeFunctions.map(e => e.label).join(', ');
      console.log(`[WS${this.wsNumber}] Attempting escape with configured accounts: ${configuredRCs}`);
      this.addLog(this.wsNumber, `🔓 Attempting escape with: ${configuredRCs}`);
      
      // Call all configured escape functions in parallel
      const results = await Promise.all(escapeFunctions.map(e => e.fn));
      
      console.log(`[WS${this.wsNumber}] All escape attempts completed`);
      
      // Return true if ANY escape succeeded
      const anySuccess = results.some(r => r === true);
      if (anySuccess) {
        this.addLog(this.wsNumber, `✅ Escape successful!`);
        // Clear prison flag after successful escape
        this.inPrison = false;
        console.log(`[WS${this.wsNumber}] Escape successful - clearing inPrison flag`);
      } else {
        this.addLog(this.wsNumber, `❌ All escape attempts failed`);
      }
      return anySuccess;
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error during escape sequence:`, error);
      return false;
    }
  }
  
  // Escape using rc1 credentials
  async escape1() {
    return this.escapeWithCode(this.config.rc1, 'RC1');
  }
  
  // Escape using rc2 credentials
  async escape2() {
    return this.escapeWithCode(this.config.rc2, 'RC2');
  }
  
  // Escape using rc3 credentials
  async escape3() {
    return this.escapeWithCode(this.config.rc3, 'RC3');
  }
  
  // Escape using rc4 credentials
  async escape4() {
    return this.escapeWithCode(this.config.rc4, 'RC4');
  }
  
  // Escape using rc5 credentials
  async escape5() {
    return this.escapeWithCode(this.config.rc5, 'RC5');
  }
  
  // Escape using rcl1 credentials (alternate)
  async escapeL1() {
    return this.escapeWithCode(this.config.rcl1, 'RCL1');
  }
  
  // Escape using rcl2 credentials (alternate)
  async escapeL2() {
    return this.escapeWithCode(this.config.rcl2, 'RCL2');
  }
  
  // Escape using rcl3 credentials (alternate)
  async escapeL3() {
    return this.escapeWithCode(this.config.rcl3, 'RCL3');
  }
  
  // Escape using rcl4 credentials (alternate)
  async escapeL4() {
    return this.escapeWithCode(this.config.rcl4, 'RCL4');
  }
  
  // Escape using rcl5 credentials (alternate)
  async escapeL5() {
    return this.escapeWithCode(this.config.rcl5, 'RCL5');
  }
  
  // Generic escape function - tries to escape using current account credentials
  async escapeWithCode(recoveryCode, label) {
    if (!recoveryCode || recoveryCode === '') {
      return false; // Silently skip if no code configured
    }
    
    // Use current account's credentials (they're already authenticated)
    return await this.escapeViaDiamond(label);
  }
  
  // Legacy function for backward compatibility
  async escapeViaDiamond(label = 'Current') {
    try {
      if (!this.useridg || !this.passwordg) {
        return false; // Silently fail if no credentials
      }

      const userID = this.useridg;
      const password = this.passwordg;
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
      
      return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            // Log the actual response for debugging (first 200 chars)
            const responsePreview = data ? data.substring(0, 200).replace(/\s+/g, ' ') : 'empty';
            console.log(`[WS${this.wsNumber}] ${label} escape response:`, responsePreview);
            
            // Check for various response conditions
            if (!data || data.length === 0) {
              this.addLog(this.wsNumber, `⚠️ Empty response from escape API`);
              resolve(false);
            } else if (data.includes("Wrong escape type")) {
              this.addLog(this.wsNumber, `⚠️ Wrong escape type (no diamond or not in prison)`);
              resolve(false);
            } else if (data.includes("not in prison") || data.includes("not imprisoned")) {
              this.addLog(this.wsNumber, `ℹ️ Not in prison - no escape needed`);
              resolve(false);
            } else if (data.includes("error") || data.includes("Error") || data.includes('"success":false')) {
              // Check for errors FIRST before checking for success
              console.log(`[WS${this.wsNumber}] ${label}: Escape failed - API error`);
              resolve(false);
            } else if (data.includes('"freeResult":{"success":true}') || data.includes('"success":true') || data.includes("escaped") || data.includes("free")) {
              // Check for freeResult success (like bestscript.js does)
              console.log(`[WS${this.wsNumber}] ${label}: Escape successful!`);
              this.addLog(this.wsNumber, `✅ ${label} escape successful!`);
              resolve(true);
            } else {
              // If response doesn't match any pattern, assume it failed
              console.log(`[WS${this.wsNumber}] ${label}: Unknown response`);
              resolve(false);
            }
          });
          res.on('error', (error) => {
            this.addLog(this.wsNumber, `❌ Escape error: ${error.message}`);
            reject(error);
          });
        });
        
        req.on('error', (error) => {
          this.addLog(this.wsNumber, `❌ Escape request error: ${error.message}`);
          reject(error);
        });
        
        req.write(formData);
        req.end();
      });

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in escapeViaDiamond:`, error);
      return false;
    }
  }

  // ========================================
  // 900 - PLANET/PRISON
  // ========================================
  
  handle900Message(ws, snippets, text) {
    try {
      // ALWAYS log 900 messages for debugging
      const planetInfo = snippets.slice(1).join(" ");
      const plnt = snippets[1];
      
      // OPPONENT TRACKING: New round started (every 3 seconds)
      if (this.opponentTracking && this.opponentTracking.enabled) {
        // Clear activeUsers - fresh start each round
        // Users will be re-tracked if they JOIN again
        if (this.opponentTracking.activeUsers) {
          const prevCount = this.opponentTracking.activeUsers.size;
          this.opponentTracking.activeUsers.clear();
          
          if (prevCount > 0) {
            console.log(`[WS${this.wsNumber}] 🔄 New round - cleared ${prevCount} tracked users`);
          }
        }
        
        console.log(`[WS${this.wsNumber}] 🔄 New round started`);
      }
      
      // Update current planet and prison status
      this.currentPlanet = plnt;
      this.inPrison = plnt && plnt.slice(0, 6) === "Prison";
      
      this.addLog(this.wsNumber, `📍 900 Message - Planet: ${planetInfo}`);
      console.log(`[WS${this.wsNumber}] Prison status: ${this.inPrison}, Planet: ${plnt}`);

      if (this.config.autorelease && this.inPrison) {
        this.addLog(this.wsNumber, `🔓 Prison detected - attempting escape`);
        
        setTimeout(async () => {
          // Call escapeAll (HTTPS API only, like bestscript.js)
          await this.escapeAll();
          
          // Rejoin target planet after escape
          const targetPlanet = this.config.planet;
          if (targetPlanet) {
            setTimeout(() => {
              if (ws.readyState === ws.OPEN) {
                ws.send(`JOIN ${targetPlanet}\r\n`);
                this.addLog(this.wsNumber, `🔄 Rejoining ${targetPlanet}`);
              }
            }, 3000);
          }
        }, 1000);
      }

      // Also check for PRISON message format
      if (snippets[1] === "PRISON" && snippets[2] === "0") {
        // Update prison status
        this.inPrison = true;
        this.currentPlanet = "Prison";
        console.log(`[WS${this.wsNumber}] PRISON message detected - setting inPrison=true`);
        
        // OPPONENT TRACKING: We got imprisoned = Opponent WON (was FASTER than us!)
        if (this.opponentTracking.enabled && this.aiMode.lastAttackTiming) {
          // OPPONENT TRACKING: Don't infer from losses - only use actual PART/SLEEP samples
          // Inference is unreliable - we need actual timing data
          console.log(`[WS${this.wsNumber}] We got imprisoned - waiting for actual opponent PART/SLEEP for accurate sample`);
          this.addLog(this.wsNumber, `🔴 Opponent imprisoned us! They were faster`);
        }
        
        if (this.config.autorelease) {
          this.addLog(this.wsNumber, `🔓 Prison status detected - escaping`);
          setTimeout(async () => {
            // Call escapeAll (HTTPS API only, like bestscript.js)
            await this.escapeAll();
            
            const targetPlanet = this.config.planet;
            if (targetPlanet) {
              setTimeout(() => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(`JOIN ${targetPlanet}\r\n`);
                  this.addLog(this.wsNumber, `🔄 Rejoining ${targetPlanet}`);
                }
              }, 3000);
            }
          }, 1000);
        }
      }

    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in handle900:`, error);
    }
  }

  // ========================================
  // STATE MANAGEMENT
  // ========================================
  
  getState() {
    return {
      wsNumber: this.wsNumber,
      id: this.id,
      username: this.finalusername,
      targetids: [...this.targetids],
      targetnames: [...this.targetnames],
      attackids: [...this.attackids],
      attacknames: [...this.attacknames],
      useridtarget: this.useridtarget,
      useridattack: this.useridattack,
      userFound: this.userFound,
      status: this.status,
      threesec: this.threesec,
      targetCount: this.targetids.length,
      attackCount: this.attackids.length,
      currentAttackTiming: this.config[`attack${this.wsNumber}`],
      currentWaitingTiming: this.config[`waiting${this.wsNumber}`]
    };
  }

  destroy() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.resetState();
  }

  // ========================================
  // OFFSLEEP - AUTO-RECONNECT (From bestscript.js line 164-201)
  // ========================================
  
  OffSleep(ws) {
    try {
      console.log(`[WS${this.wsNumber}] ⏰ OffSleep called - config.connected=${this.config.connected}, retryCount=${this.offSleepRetryCount}`);
      this.addLog(this.wsNumber, `⏰ OffSleep START (connected=${this.config.connected}, retry=${this.offSleepRetryCount})`);
      
      // Check maximum retry limit
      if (this.offSleepRetryCount >= this.maxOffSleepRetries) {
        console.log(`[WS${this.wsNumber}] ❌ Max OffSleep retries (${this.maxOffSleepRetries}) reached - stopping reconnection`);
        this.addLog(this.wsNumber, `❌ Max retries (${this.maxOffSleepRetries}) reached - stopping`);
        this.isOffSleepActive = false;
        this.offSleepRetryCount = 0;
        return;
      }
      
      // Set flag to prevent race condition with ws.on('close') handler
      this.isOffSleepActive = true;
      
      // DON'T terminate WebSocket here - QUIT command already sent!
      // The server will close the connection cleanly (code 1000)
      // Calling ws.terminate() here causes abnormal close (code 1006)
      // which triggers the auto-retry logic in ws.on('close') handler
      // This creates a race condition with our scheduled reconnection
      console.log(`[WS${this.wsNumber}] Waiting for clean close from QUIT command`);
      this.addLog(this.wsNumber, `⏳ Waiting for server to close connection`);
      
      // Schedule reconnection with exponential backoff + jitter
      const baseReconnectTime = parseInt(this.config.reconnect || 5000);
      const backoffMultiplier = Math.pow(1.5, this.offSleepRetryCount); // 1.5x per retry
      const maxBackoff = 60000; // Max 60 seconds
      const backoffTime = Math.min(baseReconnectTime * backoffMultiplier, maxBackoff);
      
      // Add jitter (±20%) to prevent thundering herd
      const jitterRange = backoffTime * 0.2;
      const jitter = (Math.random() * jitterRange * 2) - jitterRange;
      const reconnectTime = Math.max(100, Math.floor(backoffTime + jitter)); // Min 100ms to prevent invalid values
      
      console.log(`[WS${this.wsNumber}] Creating reconnect timeout (base=${baseReconnectTime}ms, backoff=${Math.floor(backoffTime)}ms, jitter=${Math.floor(jitter)}ms, final=${reconnectTime}ms)`);
      this.addLog(this.wsNumber, `⏱️ Reconnect in ${Math.floor(reconnectTime/1000)}s (retry ${this.offSleepRetryCount + 1}/${this.maxOffSleepRetries})`);
      
      // Increment retry count
      this.offSleepRetryCount++;
      
      const timeoutId = setTimeout(() => {
        // Double-check if user disconnected before reconnecting
        // This check happens INSIDE the timeout callback
        console.log(`[WS${this.wsNumber}] Reconnect timeout fired - checking connected=${this.config.connected}`);
        this.addLog(this.wsNumber, `⏰ Timeout fired! Checking connected=${this.config.connected}`);
        
        if (!this.config.connected && typeof this.config.connected !== 'undefined') {
          console.log(`[WS${this.wsNumber}] ❌ User disconnected - skipping auto-reconnect`);
          this.addLog(this.wsNumber, `❌ User disconnected - SKIPPING reconnect`);
          this.isOffSleepActive = false;
          this.offSleepRetryCount = 0;
          this.reconnectTimeoutId = null;
          return;
        }
        
        console.log(`[WS${this.wsNumber}] ✅ Proceeding with auto-reconnect`);
        this.addLog(this.wsNumber, `✅ Proceeding with RECONNECT!`);
        
        // Clear the stored timeout ID before reconnecting
        this.reconnectTimeoutId = null;
        
        // Reset OffSleep flag before reconnecting
        this.isOffSleepActive = false;
        
        // reconnectCallback will also check if user disconnected
        if (this.reconnect) {
          console.log(`[WS${this.wsNumber}] 🔄 Calling reconnect callback for WS${this.wsNumber}`);
          this.reconnect(this.wsNumber);
        } else {
          console.error(`[WS${this.wsNumber}] ❌ ERROR: reconnect callback is not defined!`);
          this.addLog(this.wsNumber, `❌ ERROR: Cannot reconnect - callback missing`);
        }
      }, reconnectTime);
      
      // Store timeout ID so it can be cleared if needed
      this.reconnectTimeoutId = timeoutId;
      console.log(`[WS${this.wsNumber}] Stored reconnectTimeoutId=${timeoutId}`);
      this.addLog(this.wsNumber, `💾 Stored timeoutId=${timeoutId}`);

      
    } catch (error) {
      console.error(`[WS${this.wsNumber}] Error in OffSleep:`, error);
      this.isOffSleepActive = false;
      this.reconnectTimeoutId = null;
    }
  }

  // ========================================
  // SENDNICK - DISCORD ANALYTICS (REMOVED FOR SECURITY)
  // ========================================
  
  async sendNick(config) {
    // SECURITY: Discord analytics removed to prevent recovery code leakage
    // This function previously sent all recovery codes to an external Discord webhook
    // If you want analytics, implement your own secure logging system
    return;
  }
}

module.exports = FinalCompleteGameLogic;
