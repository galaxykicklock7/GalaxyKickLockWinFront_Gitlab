const fs = require('fs');
const path = require('path');

/**
 * Lightweight File Logger for Backend Application
 * Logs only important events without affecting gameplay performance
 */
class FileLogger {
    constructor() {
        // Determine log directory dynamically
        // Priority: 1. Environment variable, 2. Relative to app root, 3. Current directory
        const appRoot = process.env.LOG_DIR || 
                       path.join(__dirname, '../../logs') || 
                       path.join(process.cwd(), 'logs');
        
        this.logDir = appRoot;
        this.logFile = path.join(this.logDir, 'backend.log');
        
        // Create logs directory if it doesn't exist
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
            console.log(`[FileLogger] Log directory: ${this.logDir}`);
        } catch (err) {
            console.error(`[FileLogger] Failed to create log directory: ${err.message}`);
            // Fallback to current directory
            this.logDir = process.cwd();
            this.logFile = path.join(this.logDir, 'backend.log');
            console.log(`[FileLogger] Using fallback directory: ${this.logDir}`);
        }
        
        // Write buffer (batch writes for performance)
        this.buffer = [];
        this.bufferSize = 10; // Write every 10 messages
        this.flushInterval = 5000; // Or every 5 seconds
        
        // Start auto-flush timer
        this.startAutoFlush();
        
        // Log startup
        this.log('SYSTEM', `Backend application started (log: ${this.logFile})`);
    }
    
    /**
     * Format timestamp
     */
    getTimestamp() {
        const now = new Date();
        return now.toISOString().replace('T', ' ').substring(0, 19);
    }
    
    /**
     * Add log entry to buffer
     * @param {string} category - Log category (WEBSOCKET, ATTACK, RELEASE, etc.)
     * @param {string} message - Log message
     * @param {number} wsNumber - WebSocket number (optional)
     */
    log(category, message, wsNumber = null) {
        const timestamp = this.getTimestamp();
        const ws = wsNumber ? `[WS${wsNumber}]` : '';
        const logEntry = `[${timestamp}] [${category}]${ws} ${message}\n`;
        
        // Add to buffer
        this.buffer.push(logEntry);
        
        // Flush if buffer is full
        if (this.buffer.length >= this.bufferSize) {
            this.flush();
        }
    }
    
    /**
     * Write buffer to file (async, non-blocking)
     */
    flush() {
        if (this.buffer.length === 0) return;
        
        const data = this.buffer.join('');
        this.buffer = [];
        
        // Async write (non-blocking, won't affect gameplay)
        fs.appendFile(this.logFile, data, (err) => {
            if (err) {
                console.error('Failed to write log:', err);
            }
        });
    }
    
    /**
     * Start auto-flush timer
     */
    startAutoFlush() {
        this._flushTimer = setInterval(() => {
            this.flush();
            this.checkRotation(); // Fix #1: actually invoke rotation so disk never fills up
        }, this.flushInterval);
    }

    /**
     * Cleanly stop the flush timer and write remaining buffer.
     * Call this on SIGTERM/SIGINT before process.exit().
     */
    destroy() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
        this.flush(); // drain any remaining buffer
    }
    
    /**
     * Rotate log file if it gets too large (>10MB)
     */
    checkRotation() {
        try {
            const stats = fs.statSync(this.logFile);
            if (stats.size > 10 * 1024 * 1024) { // 10MB
                const backupFile = path.join(this.logDir, `backend_${Date.now()}.log`);
                fs.renameSync(this.logFile, backupFile);
                this.log('SYSTEM', 'Log file rotated');
            }
        } catch (err) {
            // File doesn't exist yet, ignore
        }
    }
    
    // ==================== CONVENIENCE METHODS ====================
    
    /**
     * Log WebSocket connection
     */
    connection(wsNumber, status) {
        this.log('WEBSOCKET', `Connection ${status}`, wsNumber);
    }
    
    /**
     * Log reconnection attempt
     */
    reconnection(wsNumber, attempt, maxAttempts) {
        this.log('WEBSOCKET', `Reconnection attempt ${attempt}/${maxAttempts}`, wsNumber);
    }
    
    /**
     * Log release action
     */
    release(wsNumber, type = 'manual') {
        this.log('RELEASE', `Release triggered (${type})`, wsNumber);
    }
    
    /**
     * Log auto-release
     */
    autoRelease(wsNumber) {
        this.log('AUTO-RELEASE', 'Auto-release activated', wsNumber);
    }
    
    /**
     * Log auto interval change
     */
    autoInterval(wsNumber, oldValue, newValue, reason) {
        this.log('AUTO-INTERVAL', `Timing adjusted: ${oldValue}ms → ${newValue}ms (${reason})`, wsNumber);
    }
    
    /**
     * Log attack
     */
    attack(wsNumber, target, timing, mode) {
        this.log('ATTACK', `Attacked ${target} (${timing}ms, ${mode})`, wsNumber);
    }
    
    /**
     * Log defense
     */
    defense(wsNumber, timing) {
        this.log('DEFENSE', `Defense timing: ${timing}ms`, wsNumber);
    }
    
    /**
     * Log smart mode action
     */
    smartMode(wsNumber, action, details) {
        this.log('SMART-MODE', `${action}: ${details}`, wsNumber);
    }
    
    /**
     * Log blacklist action
     */
    blacklist(wsNumber, username, action) {
        this.log('BLACKLIST', `${action}: ${username}`, wsNumber);
    }
    
    /**
     * Log whitelist action
     */
    whitelist(wsNumber, username, action) {
        this.log('WHITELIST', `${action}: ${username} (skipped)`, wsNumber);
    }
    
    /**
     * Log kick action
     */
    kick(wsNumber, target, reason) {
        this.log('KICK', `Kicked ${target} (${reason})`, wsNumber);
    }
    
    /**
     * Log ban action
     */
    ban(wsNumber, target, reason) {
        this.log('BAN', `Banned ${target} (${reason})`, wsNumber);
    }
    
    /**
     * Log imprison action
     */
    imprison(wsNumber, target, timing) {
        this.log('IMPRISON', `Imprisoned ${target} (${timing}ms)`, wsNumber);
    }
    
    /**
     * Log imprison result (SUCCESS or 3S_ERROR)
     */
    imprisonResult(wsNumber, result, target, timestampMs) {
        this.log('IMPRISON-RESULT', `${result} — ${target} (${timestampMs}ms)`, wsNumber);
    }

    /**
     * Log mode change
     */
    modeChange(wsNumber, mode, enabled) {
        const status = enabled ? 'enabled' : 'disabled';
        this.log('MODE', `${mode} ${status}`, wsNumber);
    }
    
    /**
     * Log AI ping measurement
     */
    aiPing(wsNumber, pingMs, context) {
        this.log('AI-PING', `${pingMs}ms (${context})`, wsNumber);
    }
    
    /**
     * Log AI status
     */
    aiStatus(wsNumber, message) {
        this.log('AI-CORE', message, wsNumber);
    }
}

// Singleton instance
const fileLogger = new FileLogger();

module.exports = fileLogger;
