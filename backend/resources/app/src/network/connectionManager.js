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

// Get current code for wsNumber (rotates between main and alternate)
function getCurrentCode(wsNumber) {

    const wsKey = `ws${wsNumber}`;
    const pool = connectionPool[wsKey];

    if (!pool) return null;

    if (!appState.config.rotateRC) {
        addLog(wsNumber, `📍 Using main code (rotation disabled)`);
        return pool.mainCode || pool.altCode;
    }

    if (pool.mainCode && pool.altCode) {
        const code = pool.useMain ? pool.mainCode : pool.altCode;
        const codeType = pool.useMain ? 'Main' : 'Alt';
        console.log(`🔄 WS${wsNumber} using ${codeType} code`);
        addLog(wsNumber, `🔄 Using ${codeType} code (rotation enabled)`);
        return code;
    }

    addLog(wsNumber, `📍 Using single code (no alternate available)`);
    return pool.mainCode || pool.altCode;
}

// Rotate to next code (main -> alt or alt -> main)
function rotateCode(wsNumber) {
    if (!appState.config.rotateRC) {
        return;
    }

    const wsKey = `ws${wsNumber}`;
    const pool = connectionPool[wsKey];

    if (!pool) return;

    if (pool.mainCode && pool.altCode) {
        pool.useMain = !pool.useMain;
        const newType = pool.useMain ? 'Main' : 'Alt';
        addLog(wsNumber, `🔄 Rotated to ${newType} code for next connection`);
    }
}

module.exports = {
    initializeConnectionPool,
    getCurrentCode,
    rotateCode
};
