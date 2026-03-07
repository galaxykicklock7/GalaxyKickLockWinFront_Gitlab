const { appState, connectionPool, addLog } = require("../config/appState");

// Initialize connection pool with configured codes
function initializeConnectionPool() {
    connectionPool.ws1.mainCode = appState.config.rc1 || null;
    connectionPool.ws1.altCode = appState.config.rcl1 || null;

    connectionPool.ws2.mainCode = appState.config.rc2 || null;
    connectionPool.ws2.altCode = appState.config.rcl2 || null;

    connectionPool.ws3.mainCode = appState.config.rc3 || null;
    connectionPool.ws3.altCode = appState.config.rcl3 || null;

    connectionPool.ws4.mainCode = appState.config.rc4 || null;
    connectionPool.ws4.altCode = appState.config.rcl4 || null;

    connectionPool.ws5.mainCode = appState.config.rc5 || null;
    connectionPool.ws5.altCode = appState.config.rcl5 || null;

    console.log('🔄 Connection pool initialized.');
}

// Get current code for wsNumber
function getCurrentCode(wsNumber) {
    const wsKey = `ws${wsNumber}`;
    const pool = connectionPool[wsKey];

    if (!pool) return null;

    if (pool.mainCode && pool.altCode) {
        const code = pool.useMain ? pool.mainCode : pool.altCode;
        const codeType = pool.useMain ? 'Primary' : 'Alt';
        console.log(`🔄 WS${wsNumber} using ${codeType} code`);
        return code;
    }

    return pool.mainCode || pool.altCode;
}

// Rotate to next code (primary -> alt or alt -> primary)
// Always rotates when both codes are available — no flag needed
function rotateCode(wsNumber) {
    const wsKey = `ws${wsNumber}`;
    const pool = connectionPool[wsKey];

    if (!pool) return;

    if (pool.mainCode && pool.altCode) {
        pool.useMain = !pool.useMain;
        const newType = pool.useMain ? 'Primary' : 'Alt';
        addLog(wsNumber, `🔄 Rotated to ${newType} code`);
    }
}

// Peek at what the next rotated code will be without actually rotating
// Used by prewarm to prepare the correct code for the next cycle
function peekNextCode(wsNumber) {
    const wsKey = `ws${wsNumber}`;
    const pool = connectionPool[wsKey];
    if (!pool) return null;
    if (pool.mainCode && pool.altCode) {
        // Next will be the opposite of current
        return pool.useMain ? pool.altCode : pool.mainCode;
    }
    return pool.mainCode || pool.altCode;
}

module.exports = {
    initializeConnectionPool,
    getCurrentCode,
    rotateCode,
    peekNextCode
};
