const appState = {
    connected: false,
    websockets: {
        ws1: null,
        ws2: null,
        ws3: null,
        ws4: null,
        ws5: null
    },
    wsStatus: {
        ws1: false,
        ws2: false,
        ws3: false,
        ws4: false,
        ws5: false
    },
    gameLogic: {
        logic1: null,
        logic2: null,
        logic3: null,
        logic4: null,
        logic5: null
    },
    config: {
        connected: false,
        rc1: "",
        rc2: "",
        rc3: "",
        rc4: "",
        rc5: "",
        rcl1: "",
        rcl2: "",
        rcl3: "",
        rcl4: "",
        rcl5: "",
        planet: "",
        device: "312",
        autorelease: false,
        smart: false,
        lowsecmode: false,
        exitting: true,
        sleeping: false,
        kickmode: true,
        imprisonmode: false,
        kickrc: "",
        blacklist: "",
        gangblacklist: "",
        kblacklist: "",
        kgangblacklist: "",
        attack1: 1940,
        attack2: 1940,
        attack3: 1940,
        attack4: 1940,
        attack5: 1940,
        waiting1: 1910,
        waiting2: 1910,
        waiting3: 1910,
        waiting4: 1910,
        waiting5: 1910,
        timershift: false,
        incrementvalue: 10,
        decrementvalue: 10,
        minatk: 1000,
        maxatk: 3000,
        mindef: 1000,
        maxdef: 3000,
        modena: false,
        kickbybl: false,
        dadplus: false,
        kickall: false,
        reconnect: 5000,
        rotateRC: false,
        roundRobin: false,
        // AI Mode REMOVED
    },
    logs: {
        log1: [],
        log2: [],
        log3: [],
        log4: [],
        log5: []
    },
    gameState: {
        targetids1: [],
        targetids2: [],
        targetids3: [],
        targetids4: [],
        targetnames1: [],
        targetnames2: [],
        targetnames3: [],
        targetnames4: [],
        attackids1: [],
        attackids2: [],
        attackids3: [],
        attackids4: [],
        attacknames1: [],
        attacknames2: [],
        attacknames3: [],
        attacknames4: [],
        useridtarget1: null,
        useridtarget2: null,
        useridtarget3: null,
        useridtarget4: null,
        userFound1: false,
        userFound2: false,
        userFound3: false,
        userFound4: false,
        status1: "",
        status2: "",
        status3: "",
        status4: "",
        threesec1: false,
        threesec2: false,
        threesec3: false,
        threesec4: false,
        timeout1: null,
        timeout2: null,
        timeout3: null,
        timeout4: null,
        inc1: 0,
        inc2: 0,
        inc3: 0,
        inc4: 0,
        lowtime: 0
    }
};

const connectionRetries = {
    ws1: { count: 0, maxRetries: 5, backoff: 1000 },
    ws2: { count: 0, maxRetries: 5, backoff: 1000 },
    ws3: { count: 0, maxRetries: 5, backoff: 1000 },
    ws4: { count: 0, maxRetries: 5, backoff: 1000 },
    ws5: { count: 0, maxRetries: 5, backoff: 1000 }
};

const connectionPool = {
    ws1: { useMain: true, mainCode: null, altCode: null },
    ws2: { useMain: true, mainCode: null, altCode: null },
    ws3: { useMain: true, mainCode: null, altCode: null },
    ws4: { useMain: true, mainCode: null, altCode: null },
    ws5: { useMain: true, mainCode: null, altCode: null }
};

// Function to add log entry (moved from main.js to be accessible)
function addLog(wsNumber, message) {
    const logKey = `log${wsNumber}`;
    if (appState.logs[logKey]) {
        appState.logs[logKey].push({
            timestamp: new Date().toISOString(),
            message: message
        });
        // Keep only last 100 log entries
        if (appState.logs[logKey].length > 100) {
            appState.logs[logKey].shift();
        }
    }
    console.log(`[LOG${wsNumber}] ${message}`);
}

module.exports = {
    appState,
    connectionRetries,
    connectionPool,
    addLog
};
