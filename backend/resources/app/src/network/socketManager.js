const WebSocketClient = require("ws");
const tls = require("tls");
const { appState, connectionRetries, connectionPool, addLog } = require("../config/appState");
const GameLogic = require("../game/gameLogic");
const { getCurrentCode, rotateCode } = require("./connectionManager");
const fileLogger = require("../utils/fileLogger");

// OPTIMIZATION: Debug mode flag (set to false in production for 20-40% faster processing)
const DEBUG_MODE = process.env.DEBUG === 'true' || false;

// ─── TLS Session Cache ──────────────────────────────────────────────────────
// Reuse TLS sessions across reconnects to skip the full TLS handshake.
// Saves ~50-150ms per reconnect on the same server.
const tlsSessionCache = {};

function _getTlsOptions() {
    const host = 'cs.mobstudio.ru';
    const opts = {};
    if (tlsSessionCache[host]) {
        opts.session = tlsSessionCache[host];
    }
    return { host, opts };
}

function _saveTlsSession(socket) {
    if (!socket) return;
    const host = 'cs.mobstudio.ru';
    socket.on('session', (session) => {
        tlsSessionCache[host] = session;
        DEBUG_MODE && console.log(`[TLS] Session cached for ${host}`);
    });
}

// ─── Main connection function ────────────────────────────────────────────────

function createWebSocketConnection(wsNumber, recoveryCode = null, isRetry = false) {
    const wsKey = `ws${wsNumber}`;
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
        // Reconnect delay: use config.reconnect as base, 1.5x multiplier per retry, cap at 30s
        const configReconnectTime = appState.config.reconnect || 5000;
        const baseDelay = retryState.count === 1
            ? configReconnectTime
            : Math.round(configReconnectTime * Math.pow(1.5, retryState.count - 1));
        const delay = Math.min(baseDelay, 30000);

        addLog(wsNumber, `🔄 Retry ${retryState.count}/${retryState.maxRetries} in ${Math.floor(delay / 1000)}s`);
        fileLogger.reconnection(wsNumber, retryState.count, retryState.maxRetries);

        // Auto-rotate RC if both primary and alt codes exist
        const retryPool = connectionPool[wsKey];
        if (retryPool && retryPool.mainCode && retryPool.altCode) {
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
    const wsKey = `ws${wsNumber}`;
    const logicKey = `logic${wsNumber}`;

    // TLS session reuse options
    const { opts: tlsOpts } = _getTlsOptions();

    // OPTIMIZED WebSocket configuration for low latency
    const ws = new WebSocketClient("wss://cs.mobstudio.ru:6672", {
        perMessageDeflate: false,     // Disable compression (20-30% faster message processing)
        maxPayload: 100 * 1024,       // Limit payload to 100KB (security + speed)
        handshakeTimeout: 5000,       // Faster connection timeout (5s instead of 10s)
        skipUTF8Validation: false,    // Keep validation for safety
        ...tlsOpts,                   // Reuse TLS session if available
    });

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
            // Auto-rotate RC if both primary and alt codes exist
            const pool = connectionPool[wsKey];
            const hasBothCodes = pool && pool.mainCode && pool.altCode;
            if (hasBothCodes) {
                addLog(wsNum, `🔄 Auto-reconnecting WS${wsNum} with rotation...`);
                rotateCode(wsNum);
                const nextCode = getCurrentCode(wsNum);
                if (nextCode) {
                    createWebSocketConnection(wsNum, nextCode, false);
                } else {
                    addLog(wsNum, `❌ No code available for reconnection`);
                }
            } else {
                addLog(wsNum, `🔄 Auto-reconnecting WS${wsNum}...`);
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

            // Cache TLS session for faster reconnects
            _saveTlsSession(ws._socket);

            if (DEBUG_MODE) console.log(`[WS${wsNumber}] Network optimizations enabled: TCP_NODELAY + Keep-Alive + TLS cache`);
        }

        const pool = connectionPool[wsKey];
        if (pool && pool.mainCode && pool.altCode && appState.config.rotateRC) {
            const codeType = pool.useMain ? 'Main' : 'Alt';
            addLog(wsNumber, `🔑 Using ${codeType} code`);
        }

        ws.send(`:en IDENT ${appState.config.device} -2 4030 1 2 :GALA\r\n`);
        addLog(wsNumber, `✅ Connection established`);

        // Re-measure ping after reconnection if AI is enabled
        // Only re-measure if last ping was >30s ago — avoids 2s delay on every rapid reconnect
        if (DEBUG_MODE) console.log(`[WS${wsNumber}] Reconnection - AI: aiEnabled=${gameLogic.aiEnabled}`);
        if (gameLogic.aiEnabled) {
            const lastPingAge = gameLogic.lastPingTime ? (Date.now() - gameLogic.lastPingTime) : Infinity;
            if (lastPingAge > 30000) {
                fileLogger.aiStatus(wsNumber, 'Re-measuring ping after reconnect');
                setTimeout(async () => {
                    const pingMs = await gameLogic.measurePing();
                    if (pingMs !== null) {
                        const context = gameLogic.getContextFromPing();
                        addLog(wsNumber, `📡 Ping: ${pingMs}ms (${context})`);
                        fileLogger.aiPing(wsNumber, pingMs, context);
                    } else {
                        fileLogger.aiStatus(wsNumber, 'Ping measurement failed');
                    }
                }, 2000);
            }
        }
    });

    ws.on('message', (data) => {
        // ✅ CRITICAL OPTIMIZATION: Capture timestamp IMMEDIATELY at message arrival
        const messageArrivalTime = Date.now();

        try {
            // OPTIMIZATION: Fast string conversion
            const text = data.toString();

            // Quick validation (empty check)
            if (!text || text.length === 0) {
                if (DEBUG_MODE) console.warn(`[WS${wsNumber}] Empty message`);
                return;
            }

            // FAST PATH: Handle PING before any parsing (most frequent message)
            if (text[0] === 'P' && (text === 'PING\r\n' || text === 'PING' || text.startsWith('PING '))) {
                ws.send("PONG\r\n");
                return;
            }

            // Extract command and split for handlers
            const snippets = text.split(" ");
            const command = snippets[0];

            // Quick validation (command check)
            if (!command || command.length === 0) {
                if (DEBUG_MODE) console.warn(`[WS${wsNumber}] No command:`, text.substring(0, 100));
                return;
            }

            // OPTIMIZATION: Debug logging only when enabled
            if (DEBUG_MODE) {
                console.log(`[WS${wsNumber}] CMD="${command}" | FULL="${text.substring(0, 300)}"`);
            }

            switch (command) {

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
                    console.log(`[WS${wsNumber}] Message 999 - shouldRejoinPlanet: ${gameLogic.shouldRejoinPlanet}, inPrison: ${gameLogic.inPrison}, planet: ${appState.config.planet}`);

                    // JOIN logic:
                    // 1. shouldRejoinPlanet=true → escape succeeded, go directly to target (overrides inPrison)
                    // 2. inPrison=true (and not shouldRejoin) → bare JOIN (still in prison, need escape first)
                    // 3. config.planet set → JOIN target_planet with 5s fallback bare JOIN
                    //    (handles fresh restart where bot might be in prison but we don't know)
                    // 4. fallback → bare JOIN (no planet configured)
                    if (gameLogic.shouldRejoinPlanet) {
                        // Escape succeeded — go directly to target planet
                        const targetPlanet = appState.config.planet;
                        if (targetPlanet) {
                            gameLogic.sendJoinWithRetry(ws, targetPlanet);
                            addLog(wsNumber, `Connection established. Sent JOIN ${targetPlanet} (post-escape)`);
                            console.log(`[WS${wsNumber}] Sent JOIN ${targetPlanet} (shouldRejoinPlanet=true)`);
                        } else {
                            gameLogic.sendJoinWithRetry(ws, null);
                            addLog(wsNumber, `Connection established. Sent JOIN`);
                            console.log(`[WS${wsNumber}] Sent bare JOIN (shouldRejoinPlanet but no planet configured)`);
                        }
                        gameLogic.setShouldRejoinPlanet(false);
                        gameLogic.setInPrison(false);
                    } else if (gameLogic.inPrison) {
                        // Bot is in prison — must send bare JOIN to enter prison first
                        gameLogic.sendJoinWithRetry(ws, null);
                        addLog(wsNumber, `Connection established. Sent JOIN (in prison)`);
                        console.log(`[WS${wsNumber}] Sent bare JOIN (inPrison=true — entering prison for escape)`);
                    } else {
                        const targetPlanet = appState.config.planet;
                        if (targetPlanet) {
                            gameLogic.sendJoinWithRetry(ws, targetPlanet);
                            addLog(wsNumber, `Connection established. Sent JOIN ${targetPlanet}`);
                            console.log(`[WS${wsNumber}] Sent JOIN ${targetPlanet} (normal connect)`);

                            // Fallback: if server ignores JOIN target (bot needs to enter prison first),
                            // no 353 will arrive. After 1s, send bare JOIN to enter prison.
                            gameLogic._joinFallbackTimer = setTimeout(() => {
                                if (!gameLogic.currentPlanet && ws && ws.readyState === ws.OPEN) {
                                    console.log(`[WS${wsNumber}] ⚠️ No 353 after 1s — bot may be in prison. Sending bare JOIN`);
                                    addLog(wsNumber, `⚠️ No response — sending bare JOIN`);
                                    gameLogic.setInPrison(true);
                                    gameLogic.sendJoinWithRetry(ws, null);
                                }
                                gameLogic._joinFallbackTimer = null;
                            }, 1000);
                        } else {
                            gameLogic.sendJoinWithRetry(ws, null);
                            addLog(wsNumber, `Connection established. Sent JOIN`);
                            console.log(`[WS${wsNumber}] Sent bare JOIN (no planet configured)`);
                        }
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
                    if (DEBUG_MODE) console.log(`[WS${wsNumber}] 📨 Message 850 received`);
                    fileLogger.log('850-ROUTE', `case 850 hit`, wsNumber);
                    gameLogic.handle850Message(ws, snippets, text, messageArrivalTime);
                    break;
                case "854":
                    gameLogic.handle854Message(ws, snippets, text, messageArrivalTime);
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

            // 403: ":403 :no such channel" — rejoin planet
            if (command === ':403') {
                const planet = appState.config.planet;
                if (planet && ws.readyState === ws.OPEN) {
                    addLog(wsNumber, `403 no such channel — rejoining ${planet}`);
                    ws.send(`JOIN ${planet}\r\n`);
                }
            }

            // KICK: pattern ":USERNAME KICK <ourid> 0 -1 -1 -1"
            // Our kick: ":USERNAME KICK <ourid> 0 -1 -1 -1" (7 words)
            // Other's kick: ":USERNAME KICK <id> 0 -1 -1 -1 :Prison for 4d 19h 9min" (12+ words)
            // Check snippets.length <= 7 to avoid false-triggering on other people's kicks
            if (snippets[1] === 'KICK' && snippets[3] === '0' && snippets[4] === '-1' && snippets.length <= 7 && !gameLogic.inPrison && !gameLogic.prisonConfirmed) {
                const planet = appState.config.planet;
                if (planet && ws.readyState === ws.OPEN) {
                    addLog(wsNumber, `KICK received — rejoining ${planet}`);
                    ws.send(`JOIN ${planet}\r\n`);
                }
            }

            // Prison detection via 332 and 353 messages
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
        // Reconnect on ALL close codes (including 1000 from sendQuit after imprison/kick/ban)
        // The bot needs to reconnect to: go to prison → escape → rejoin → find next target
        // Only skip reconnect if user disconnected or OffSleep is active
        if (recoveryCodeStillExists && appState.connected && appState.config.connected) {
            // Code 1000 = normal quit (after imprison/kick/ban) → fresh cycle, not a retry
            // Other codes = abnormal close → retry with backoff
            const isNormalQuit = (code === 1000);

            if (isNormalQuit) {
                addLog(wsNumber, `🔄 Reconnecting for next cycle...`);
            } else {
                addLog(wsNumber, `🔄 Connection lost, retrying...`);
                fileLogger.reconnection(wsNumber, retryState.count + 1, retryState.maxRetries);
            }

            // Auto-rotate RC if both primary and alt codes exist for this connection
            const pool = connectionPool[wsKey];
            const hasBothCodes = pool && pool.mainCode && pool.altCode;
            if (hasBothCodes) {
                rotateCode(wsNumber);
                const nextCode = getCurrentCode(wsNumber);
                createWebSocketConnection(wsNumber, nextCode || recoveryCode, !isNormalQuit);
            } else {
                createWebSocketConnection(wsNumber, recoveryCode, !isNormalQuit);
            }
        }
    });

    ws.on('error', (error) => {
        appState.wsStatus[wsKey] = false;
        addLog(wsNumber, `❌ Error: ${error.message}`);
        if (gameLogic.isOffSleepActive) return;

        // Only reconnect if user is still connected (not manually disconnected)
        if (appState.connected && appState.config.connected) {
            setTimeout(() => {
                if (appState.connected && appState.config.connected) {
                    createWebSocketConnection(wsNumber, recoveryCode, true);
                }
            }, 1000);
        }
    });

    return ws;
}

module.exports = { createWebSocketConnection };
