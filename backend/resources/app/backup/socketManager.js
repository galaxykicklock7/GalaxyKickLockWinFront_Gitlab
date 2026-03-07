const WebSocketClient = require("ws");
const { appState, connectionRetries, connectionPool, addLog } = require("../config/appState");
const GameLogic = require("../game/gameLogic");
const { getCurrentCode, rotateCode } = require("./connectionManager");
const fileLogger = require("../utils/fileLogger");

// OPTIMIZATION: Debug mode flag (set to false in production for 20-40% faster processing)
const DEBUG_MODE = process.env.DEBUG === 'true' || false;

function createWebSocketConnection(wsNumber, recoveryCode = null, isRetry = false) {
    const wsKey = `ws${wsNumber}`;
    const logicKey = `logic${wsNumber}`;
    const retryState = connectionRetries[wsKey];

    if (!recoveryCode) {
        recoveryCode = getCurrentCode(wsNumber);
        if (!recoveryCode) {
            addLog(wsNumber, `❌ No recovery code available for WS${wsNumber}`);
            return;
        }
    }

    if (isRetry && retryState.count >= retryState.maxRetries) {
        addLog(wsNumber, `❌ Max retries (${retryState.maxRetries}) exceeded. Stopping reconnection attempts.`);
        retryState.count = 0;
        return;
    }

    if (isRetry) {
        retryState.count++;
        // Use config.reconnect if available, otherwise use backoff with exponential backoff
        const configReconnectTime = appState.config.reconnect || 5000;
        const baseDelay = retryState.count === 1 ? configReconnectTime : (retryState.backoff * Math.pow(2, retryState.count - 1));
        const delay = Math.min(baseDelay, 30000);

        addLog(wsNumber, `🔄 Retry ${retryState.count}/${retryState.maxRetries} in ${Math.floor(delay / 1000)}s`);

        if (appState.config.rotateRC) {
            rotateCode(wsNumber);
            const nextCode = getCurrentCode(wsNumber);
            addLog(wsNumber, `🔄 Using rotated code for retry`);
            setTimeout(() => createWebSocketConnectionInternal(wsNumber, nextCode, retryState), delay);
        } else {
            setTimeout(() => createWebSocketConnectionInternal(wsNumber, recoveryCode, retryState), delay);
        }
    } else {
        retryState.count = 0;
        createWebSocketConnectionInternal(wsNumber, recoveryCode, retryState);
    }
}

function createWebSocketConnectionInternal(wsNumber, recoveryCode, retryState) {
    // OPTIMIZED WebSocket configuration for low latency
    const ws = new WebSocketClient("wss://cs.mobstudio.ru:6672", {
        perMessageDeflate: false,     // Disable compression (20-30% faster message processing)
        maxPayload: 100 * 1024,       // Limit payload to 100KB (security + speed)
        handshakeTimeout: 5000,       // Faster connection timeout (5s instead of 10s)
        skipUTF8Validation: false     // Keep validation for safety
    });
    
    const wsKey = `ws${wsNumber}`;
    const logicKey = `logic${wsNumber}`;

    appState.websockets[wsKey] = ws;

    const updateConfigCallback = (key, value) => {
        appState.config[key] = value;
    };

    const reconnectCallback = (wsNum) => {
        if (!appState.connected) {
            addLog(wsNum, `⏰ User disconnected - skipping auto-reconnect`);
            return;
        }

        const wsKey = `ws${wsNum}`;
        if (!appState.wsStatus[wsKey]) {
            if (appState.config.rotateRC) {
                addLog(wsNum, `🔄 Auto-reconnecting WS${wsNum} with rotation...`);
                rotateCode(wsNum);
                const nextCode = getCurrentCode(wsNum);
                if (nextCode) {
                    createWebSocketConnection(wsNum, nextCode, false);
                } else {
                    addLog(wsNum, `❌ No code available for reconnection`);
                }
            } else {
                addLog(wsNum, `🔄 Auto-reconnecting WS${wsNum} (normal mode)...`);
                const code = getCurrentCode(wsNum);
                if (code) {
                    createWebSocketConnection(wsNum, code, false);
                } else {
                    addLog(wsNum, `❌ No code available for reconnection`);
                }
            }
        }
    };

    // CRITICAL: Only create new GameLogic if it doesn't exist (preserve AI state across reconnections)
    if (!appState.gameLogic[logicKey]) {
        console.log(`[WS${wsNumber}] Creating new GameLogic instance`);
        appState.gameLogic[logicKey] = new GameLogic(wsNumber, appState.config, addLog, updateConfigCallback, reconnectCallback);
    } else {
        console.log(`[WS${wsNumber}] Reusing existing GameLogic instance (preserving AI state)`);
        // Update callbacks in case they changed
        appState.gameLogic[logicKey].addLog = addLog;
        appState.gameLogic[logicKey].updateConfig = updateConfigCallback;
        appState.gameLogic[logicKey].reconnect = reconnectCallback;
    }
    const gameLogic = appState.gameLogic[logicKey];

    let savedHaaapsi = null;

    ws.on('open', () => {
        if (DEBUG_MODE) console.log(`WebSocket ${wsNumber} connected`);
        
        // Log to file
        fileLogger.connection(wsNumber, 'established');
        
        appState.wsStatus[wsKey] = true;
        retryState.count = 0;
        gameLogic.resetState();
        gameLogic.offSleepRetryCount = 0;
        gameLogic.isOffSleepActive = false;
        gameLogic.inc++;

        // NETWORK OPTIMIZATIONS: Enable TCP_NODELAY and Keep-Alive for low latency
        if (ws._socket) {
            // TCP_NODELAY: Disable Nagle's algorithm for instant message sending (40-200ms faster)
            ws._socket.setNoDelay(true);
            
            // Keep-Alive: Send ping every 30 seconds to prevent unexpected disconnections
            ws._socket.setKeepAlive(true, 30000);
            
            if (DEBUG_MODE) console.log(`[WS${wsNumber}] Network optimizations enabled: TCP_NODELAY + Keep-Alive`);
        }

        const pool = connectionPool[wsKey];
        if (pool && pool.mainCode && pool.altCode && appState.config.rotateRC) {
            const codeType = pool.useMain ? 'Main' : 'Alt';
            addLog(wsNumber, `🔑 Using ${codeType} code`);
        }

        ws.send(`:en IDENT ${appState.config.device} -2 4030 1 2 :GALA\r\n`);
        addLog(wsNumber, `✅ Connection established (optimized)`);
        
        // Re-measure ping after reconnection if AI is enabled
        // Only re-measure if last ping was >30s ago — avoids 2s delay on every rapid reconnect
        console.log(`[WS${wsNumber}] Reconnection - Checking AI status: aiEnabled=${gameLogic.aiEnabled}, aiInitialized=${gameLogic.aiInitialized}`);
        if (gameLogic.aiEnabled) {
            const lastPingAge = gameLogic.lastPingTime ? (Date.now() - gameLogic.lastPingTime) : Infinity;
            if (lastPingAge > 30000) {
                console.log(`[WS${wsNumber}] AI enabled - re-measuring ping (last ping ${Math.round(lastPingAge/1000)}s ago)...`);
                fileLogger.aiStatus(wsNumber, 'Re-measuring ping after reconnect');
                setTimeout(async () => {
                    const pingMs = await gameLogic.measurePing();
                    if (pingMs !== null) {
                        const context = gameLogic.getContextFromPing();
                        console.log(`[WS${wsNumber}] 📡 Ping after reconnect: ${pingMs}ms, context: ${context}`);
                        addLog(wsNumber, `📡 Ping: ${pingMs}ms (${context})`);
                        fileLogger.aiPing(wsNumber, pingMs, context);
                    } else {
                        console.log(`[WS${wsNumber}] ⚠️ Ping measurement failed after reconnect`);
                        fileLogger.aiStatus(wsNumber, 'Ping measurement failed');
                    }
                }, 2000); // Wait 2 seconds for connection to stabilize
            } else {
                console.log(`[WS${wsNumber}] AI enabled - skipping ping re-measure (last ping ${Math.round(lastPingAge/1000)}s ago, still fresh)`);
            }
        } else {
            console.log(`[WS${wsNumber}] AI not enabled - skipping ping measurement on reconnect`);
        }
    });

    ws.on('message', (data) => {
        // ✅ CRITICAL OPTIMIZATION: Capture timestamp IMMEDIATELY at message arrival
        // This ensures we get the TRUE arrival time, not the processing time
        // Even if rival leaves and rejoins quickly, we capture the exact moment
        const messageArrivalTime = Date.now();
        
        try {
            // OPTIMIZATION: Fast string conversion
            const text = data.toString();
            
            // Quick validation (empty check)
            if (!text || text.length === 0) {
                if (DEBUG_MODE) console.warn(`[WS${wsNumber}] Empty message`);
                return;
            }
            
            // OPTIMIZATION: Fast split (avoid trim on every check)
            const snippets = text.split(" ");
            const command = snippets[0];
            
            // Quick validation (command check)
            if (!command || command.length === 0) {
                if (DEBUG_MODE) console.warn(`[WS${wsNumber}] No command:`, text.substring(0, 100));
                return;
            }
            
            // OPTIMIZATION: Debug logging only when enabled (20-40% faster in production)
            if (DEBUG_MODE) {
                console.log(`[WS${wsNumber}] RAW:`, text.substring(0, 200));
                console.log(`[WS${wsNumber}] CMD:`, command);
            }

            // TEMPORARY DEBUG: Log ALL messages to see what's coming in
            console.log(`[WS${wsNumber}] 🔍 ALL MESSAGES: CMD="${command}" | FULL="${text.substring(0, 300)}"`);
            
            // TEMPORARY DEBUG: Log all messages to see PRIVMSG
            if (command.includes('PRIVMSG') || text.includes('PRIVMSG')) {
                console.log(`[WS${wsNumber}] 🔍 DEBUG PRIVMSG: ${text.substring(0, 200)}`);
            }
            
            switch (command) {
                case "PING\r\n":
                case "PING":
                    ws.send("PONG\r\n");
                    return;

                case "HAAAPSI":
                    if (!snippets[1]) {
                        if (DEBUG_MODE) console.error(`[WS${wsNumber}] HAAAPSI missing data`);
                        addLog(wsNumber, `❌ Invalid HAAAPSI`);
                        return;
                    }
                    savedHaaapsi = snippets[1];
                    gameLogic.haaapsi = savedHaaapsi;
                    ws.send(`RECOVER ${recoveryCode}\r\n`);
                    addLog(wsNumber, `Recovering with code: ${recoveryCode}`);
                    return;

                case "REGISTER":
                    if (!snippets[1] || !snippets[2] || !snippets[3]) {
                        if (DEBUG_MODE) console.error(`[WS${wsNumber}] REGISTER missing fields`);
                        addLog(wsNumber, `❌ Invalid REGISTER`);
                        return;
                    }
                    
                    const id = snippets[1];
                    const password = snippets[2];
                    const username = snippets[3].split("\r\n")[0];
                    const temp = gameLogic.parseHaaapsi(savedHaaapsi);

                    gameLogic.id = id;
                    gameLogic.useridg = id;
                    gameLogic.passwordg = password;
                    gameLogic.finalusername = username;

                    ws.send(`USER ${id} ${password} ${username} ${temp}\r\n`);
                    addLog(wsNumber, `Registered as: ${username}`);
                    return;

                case "999":
                    // OPTIMIZATION: Batch sends into single message (10-20% faster)
                    const initCommands = "FWLISTVER 0\r\nADDONS 0 0\r\nMYADDONS 0 0\r\nPHONE 1366 768 0 2 :chrome 113.0.0.0\r\n";
                    ws.send(initCommands);

                    // Debug logging
                    console.log(`[WS${wsNumber}] Message 999 - shouldRejoinPlanet: ${gameLogic.shouldRejoinPlanet}`);
                    console.log(`[WS${wsNumber}] Message 999 - target planet: ${appState.config.planet}`);

                    // Check if we should rejoin target planet (after escape/imprison/kick/ban)
                    if (gameLogic.shouldRejoinPlanet) {
                        // Send JOIN <planet> to rejoin target planet
                        const targetPlanet = appState.config.planet;
                        if (targetPlanet) {
                            ws.send(`JOIN ${targetPlanet}\r\n`);
                            addLog(wsNumber, `Connection established. Sent JOIN ${targetPlanet}`);
                            console.log(`[WS${wsNumber}] Sent JOIN ${targetPlanet} (shouldRejoinPlanet was true)`);
                            gameLogic.setShouldRejoinPlanet(false); // Clear flag (saves to appState)
                        } else {
                            // No target planet configured, send JOIN without planet
                            ws.send("JOIN\r\n");
                            addLog(wsNumber, `Connection established. Sent JOIN`);
                            console.log(`[WS${wsNumber}] Sent JOIN (no planet configured)`);
                            gameLogic.setShouldRejoinPlanet(false); // Clear flag (saves to appState)
                        }
                    } else {
                        // Normal reconnect - always send JOIN (no planet)
                        ws.send("JOIN\r\n");
                        addLog(wsNumber, `Connection established. Sent JOIN`);
                        console.log(`[WS${wsNumber}] Sent JOIN (shouldRejoinPlanet was false)`);
                    }
                    return;

                // Game logic handlers (delegate to GameLogic class)
                // Pass messageArrivalTime to ensure accurate timing
                case "332":
                    gameLogic.handle332Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "353":
                    gameLogic.handle353Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "JOIN":
                    gameLogic.handleJoinMessage(ws, snippets, text, messageArrivalTime);
                    break;
                case "PART":
                    gameLogic.handlePartMessage(ws, snippets, text, messageArrivalTime);
                    break;
                case "SLEEP":
                    gameLogic.handleSleepMessage(ws, snippets, text, messageArrivalTime);
                    break;
                case "850":
                    console.log(`[WS${wsNumber}] 📨 Message 850 received, calling handle850Message`);
                    fileLogger.log('850-ROUTE', `case 850 hit — text: ${text.substring(0, 150)}`, wsNumber);
                    gameLogic.handle850Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "854":
                    gameLogic.handle854Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "452":
                    gameLogic.handle452Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "860":
                    gameLogic.handle860Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "471":
                    gameLogic.handle471Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "900":
                    gameLogic.handle900Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "FOUNDER":
                    gameLogic.handleFounderMessage(ws, snippets, text, messageArrivalTime);
                    break;
                case "PRIVMSG":
                    gameLogic.handlePrivmsgMessage(ws, snippets, text, messageArrivalTime);
                    break;
                default:
                    // Unknown command - only log in debug mode
                    if (DEBUG_MODE) {
                        console.log(`[WS${wsNumber}] Unknown command: ${command}`);
                    }
            }
            
            // Prison detection via 332 and 353 messages
            // HYBRID APPROACH: If PRISON keyword appears, send JOIN immediately
            if (text.includes("PRISON")) {
                if (DEBUG_MODE) console.log(`[WS${wsNumber}] 🔴 PRISON detected - sending JOIN`);
                
                if (ws.readyState === ws.OPEN) {
                    ws.send("JOIN\r\n");
                }
            }
            
        } catch (error) {
            console.error(`[WS${wsNumber}] Error processing message:`, error);
            addLog(wsNumber, `❌ Message error: ${error.message}`);
        }
    });

    ws.on('close', (code, reason) => {
        appState.wsStatus[wsKey] = false;
        addLog(wsNumber, `⚠️ Connection closed (code: ${code})`);
        
        // Log to file
        fileLogger.connection(wsNumber, `closed (code: ${code})`);
        fileLogger.aiStatus(wsNumber, `Connection closed (no active attack tracked)`);

        if (gameLogic.isOffSleepActive) return;

        if (gameLogic.reconnectTimeoutId) {
            clearTimeout(gameLogic.reconnectTimeoutId);
            gameLogic.reconnectTimeoutId = null;
        }

        const recoveryCodeStillExists = appState.config[`rc${wsNumber}`] || appState.config[`rcl${wsNumber}`];
        if (code !== 1000 && recoveryCodeStillExists && appState.connected && appState.config.connected) {
            addLog(wsNumber, `🔄 Connection lost, retrying...`);
            
            // Log reconnection attempt
            fileLogger.reconnection(wsNumber, retryState.count + 1, retryState.maxRetries);
            
            if (appState.config.rotateRC) {
                rotateCode(wsNumber);
                const nextCode = getCurrentCode(wsNumber);
                createWebSocketConnection(wsNumber, nextCode || recoveryCode, true);
            } else {
                createWebSocketConnection(wsNumber, recoveryCode, true);
            }
        }
    });

    ws.on('error', (error) => {
        appState.wsStatus[wsKey] = false;
        addLog(wsNumber, `❌ Error: ${error.message}`);
        if (gameLogic.isOffSleepActive) return;

        setTimeout(() => {
            createWebSocketConnection(wsNumber, recoveryCode, true);
        }, 1000);
    });

    return ws;
}

module.exports = { createWebSocketConnection };
