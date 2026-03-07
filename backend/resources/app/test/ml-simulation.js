/**
 * ML Strategy Simulation Test
 *
 * Compares 3 approaches:
 *   1. Current ML (reactive: EMA + binary search + zone awareness)
 *   2. Boundary ML (your approach: LEFT_EARLY/3S_ERROR boundary shrinking)
 *   3. Hybrid ML (boundary + zone memory + momentum + pattern detection)
 *
 * Usage: node test/ml-simulation.js
 */

// ─── Server simulation ──────────────────────────────────────────────────────────
// The server has a 3s cooldown window. The "server open time" is when ACTION 3 can succeed.
// If bot fires before serverOpenTime → 3S_ERROR
// If rival fires before bot → KICKED
// If bot fires after serverOpenTime and before rival → SUCCESS
// If rival leaves before bot fires → LEFT_EARLY (bot sees rival's leave time)

const SERVER_3S_FLOOR = 1675;  // absolute minimum (server never opens before this)
const PING_BOT = 46;           // bot's one-way network latency
const PING_RIVAL = 40;         // rival's one-way network latency

function simulateRound(botTiming, rivalTiming) {
    const botServerTime = botTiming + PING_BOT;
    const rivalServerTime = rivalTiming + PING_RIVAL;

    // Server 3s window opens at a base time (varies slightly per round)
    const serverWindow = 1870 + Math.floor(Math.random() * 20 - 10); // 1860-1880ms

    // FIRST: If rival left before bot fires → bot sees them leave (LEFT_EARLY)
    // This happens regardless of server window — rival's departure is visible
    if (rivalServerTime < botServerTime && rivalTiming < botTiming - 30) {
        const observedLeaveTime = rivalTiming + Math.floor(Math.random() * 10 - 5);
        return { result: 'LEFT_EARLY', rivalLeftAt: observedLeaveTime };
    }

    // SECOND: If bot fires before server window → 3S_ERROR
    if (botServerTime < serverWindow) {
        return { result: '3S_ERROR', rivalLeftAt: null };
    }

    // Both fire after server window — whoever is first wins
    if (botServerTime <= rivalServerTime) {
        return { result: 'SUCCESS', rivalLeftAt: null };
    } else {
        return { result: 'KICKED', rivalLeftAt: null };
    }
}

// ─── Rival patterns ─────────────────────────────────────────────────────────────

function createRival(type) {
    switch (type) {
        case 'STABLE':
            return () => 1895 + Math.floor(Math.random() * 10);

        case 'SLOW':
            return () => 1970 + Math.floor(Math.random() * 10);

        case 'FAST':
            return () => 1825 + Math.floor(Math.random() * 10);

        case 'ERRATIC':
            // Real-world erratic: full range 1675-2150
            // Not uniform — clusters around 1850-1950 with occasional extremes
            return () => {
                const r = Math.random();
                if (r < 0.15) return 1675 + Math.floor(Math.random() * 150);       // 15% very fast (1675-1825)
                if (r < 0.60) return 1825 + Math.floor(Math.random() * 150);       // 45% mid-range (1825-1975)
                if (r < 0.85) return 1975 + Math.floor(Math.random() * 100);       // 25% slow (1975-2075)
                return 2075 + Math.floor(Math.random() * 75);                      // 15% very slow (2075-2150)
            };

        case 'ERRATIC_UNIFORM':
            // Pure uniform 1675-2150 (worst case)
            return () => 1675 + Math.floor(Math.random() * 475);

        case 'ADAPTIVE':
            let adaptiveTiming = 1900;
            let lastResult = null;
            return (roundResult) => {
                if (lastResult === 'lost') adaptiveTiming = Math.max(1750, adaptiveTiming - 15);
                if (lastResult === 'won') adaptiveTiming = Math.min(2050, adaptiveTiming + 10);
                lastResult = roundResult;
                return adaptiveTiming + Math.floor(Math.random() * 10 - 5);
            };

        case 'TRAPPER':
            let trapRound = 0;
            return () => {
                trapRound++;
                if (trapRound % 5 === 0) return 1700;
                return 1895 + Math.floor(Math.random() * 10);
            };

        case 'BOUNDARY_DANCER':
            let dancerToggle = false;
            return () => {
                dancerToggle = !dancerToggle;
                return dancerToggle ? 1850 : 1950;
            };

        case 'MIXED':
            // Erratic for first 30 rounds, then adaptive, then erratic again
            let mixedRound = 0;
            let mixedAdaptive = 1900;
            let mixedLastResult = null;
            return (roundResult) => {
                mixedRound++;
                if (mixedRound <= 30 || mixedRound > 60) {
                    // Erratic phase
                    const r = Math.random();
                    if (r < 0.15) return 1675 + Math.floor(Math.random() * 150);
                    if (r < 0.60) return 1825 + Math.floor(Math.random() * 150);
                    if (r < 0.85) return 1975 + Math.floor(Math.random() * 100);
                    return 2075 + Math.floor(Math.random() * 75);
                } else {
                    // Adaptive phase (rounds 31-60)
                    if (mixedLastResult === 'lost') mixedAdaptive = Math.max(1750, mixedAdaptive - 15);
                    if (mixedLastResult === 'won') mixedAdaptive = Math.min(2050, mixedAdaptive + 10);
                    mixedLastResult = roundResult;
                    return mixedAdaptive + Math.floor(Math.random() * 10 - 5);
                }
            };

        default:
            return () => 1900;
    }
}

// ─── Strategy 1: Current ML (reactive EMA + binary search) ──────────────────────

function createCurrentML(preset = 'NORMAL') {
    const floor = 1675;
    const ceiling = 2150;
    const startTiming = preset === 'SLOW' ? 1800 : preset === 'NORMAL' ? 1925 : 2050;

    let timing = startTiming;
    let consecutive3s = 0;
    let ema = null;
    let emaConf = 0;
    let history = [];

    function clamp(t) { return Math.max(floor, Math.min(ceiling, t)); }

    return {
        name: 'Current ML',
        getTiming() { return timing; },
        learn(result, opponentLeftTime) {
            history.push({ timing, result });
            if (history.length > 10) history.shift();

            if (result === 'SUCCESS') {
                consecutive3s = 0;
                timing = clamp(timing - 3);
                if (ema === null) ema = timing;
                else ema = Math.round(0.5 * timing + 0.5 * ema);
                emaConf = Math.min(1, emaConf + 0.08);
                return;
            }

            if (result === 'LEFT_EARLY' && opponentLeftTime) {
                consecutive3s = 0;
                if (opponentLeftTime >= floor) {
                    timing = clamp(opponentLeftTime);
                } else {
                    timing = clamp(Math.round((timing + opponentLeftTime) / 2));
                }
                if (ema === null) ema = opponentLeftTime;
                else ema = Math.round(0.3 * opponentLeftTime + 0.7 * ema);
                return;
            }

            if (result === '3S_ERROR') {
                consecutive3s++;
                if (ema !== null && emaConf >= 0.4) {
                    const gap = ema - timing;
                    if (gap > 5) timing = clamp(timing + Math.round(gap * 0.6));
                    else timing = clamp(timing + 10);
                } else {
                    const step = consecutive3s >= 5 ? 18 : consecutive3s >= 3 ? 14 : 10;
                    timing = clamp(timing + step);
                }
                if (ema === null) ema = timing + 20;
                else ema = Math.round(0.25 * (timing + 20) + 0.75 * ema);
                return;
            }

            if (result === 'KICKED') {
                consecutive3s = 0;
                const errors = history.filter(h => h.result === '3S_ERROR');
                const kicks = history.filter(h => h.result === 'KICKED');
                if (errors.length > 0 && kicks.length > 0) {
                    const maxErr = Math.max(...errors.map(e => e.timing));
                    const minKick = Math.min(...kicks.map(k => k.timing));
                    timing = clamp(maxErr + Math.round((minKick - maxErr) * 0.25));
                } else {
                    timing = clamp(timing - 25);
                }
                if (ema === null) ema = timing - 20;
                else ema = Math.round(0.3 * (timing - 20) + 0.7 * ema);
                emaConf = Math.max(0, emaConf - 0.08);
                return;
            }
        }
    };
}

// ─── Strategy 2: Boundary ML (your approach — true binary search) ───────────────
//
// Core idea: every result gives us a boundary edge. Binary search between edges.
//   LEFT_EARLY @X  → floor = X (rival was there before us)
//   3S_ERROR @X    → floor = X (we were too early, need to go higher)
//   KICKED @X      → ceiling = X (rival beat us, they're below X)
//   SUCCESS @X     → ceiling = X (we succeeded, rival is at or above X)
//
// When we only have one edge, use median(edge, absolute_limit) as the other.
// Every round halves the search space.

function createBoundaryML(preset = 'NORMAL') {
    const absFloor = 1675;
    const absCeiling = 2150;
    const startTiming = preset === 'SLOW' ? 1800 : preset === 'NORMAL' ? 1925 : 2050;

    let timing = startTiming;
    let bFloor = null;    // lowest known "too early" point
    let bCeiling = null;  // highest known "rival is below here" point

    function clamp(t) { return Math.max(absFloor, Math.min(absCeiling, Math.round(t))); }

    function median() {
        const lo = bFloor !== null ? bFloor : absFloor;
        const hi = bCeiling !== null ? bCeiling : absCeiling;
        return clamp((lo + hi) / 2);
    }

    return {
        name: 'Boundary ML',
        getTiming() { return timing; },
        learn(result, opponentLeftTime) {

            if (result === '3S_ERROR') {
                // We were too early → this is a floor (need to go higher)
                if (bFloor === null || timing > bFloor) {
                    bFloor = timing;
                }
                // Binary search: go to median of floor..ceiling
                timing = median();
                // If median equals floor (stuck), force step up
                if (bFloor !== null && timing <= bFloor) {
                    timing = clamp(bFloor + 15);
                }
                return;
            }

            if (result === 'LEFT_EARLY' && opponentLeftTime) {
                // Rival left before us — they were at opponentLeftTime
                // This is a floor: rival timing is around here
                if (bFloor === null || opponentLeftTime > bFloor) {
                    bFloor = opponentLeftTime;
                }
                // We don't know ceiling yet? Use median(floor, absCeiling)
                // We do know ceiling? Use median(floor, ceiling)
                timing = median();
                // If median is at or below floor, step above
                if (timing <= bFloor) {
                    timing = clamp(bFloor + 15);
                }
                return;
            }

            if (result === 'SUCCESS') {
                // We beat the rival — rival was at or above our timing
                // This is a ceiling: we don't need to go higher than here
                if (bCeiling === null || timing < bCeiling) {
                    bCeiling = timing;
                }
                // Drift down slightly to stay aggressive
                timing = clamp(timing - 3);
                // But don't go below floor
                if (bFloor !== null && timing <= bFloor) {
                    timing = median();
                }
                return;
            }

            if (result === 'KICKED') {
                // Rival was faster — they're below our timing
                // This is a ceiling: rival is somewhere below here
                if (bCeiling === null || timing < bCeiling) {
                    bCeiling = timing;
                }
                // Binary search down
                timing = median();
                // If stuck at floor, the floor might be wrong for this rival
                // Reset floor and search fresh from lower
                if (bFloor !== null && timing <= bFloor) {
                    bFloor = null;
                    timing = median();
                }
                return;
            }
        }
    };
}

// ─── Strategy 3: Hybrid ML (binary search + auto-switch to adaptive) ────────────
//
// Simple rule for mode switching:
//   - Boundary WIDE (floor & ceiling > 30ms apart) → binary search
//   - Boundary NARROW (<= 30ms) → adaptive counter-cycle (rival is moving)
//
// Binary search: same as Strategy 2 — median(floor, ceiling), every result narrows
// Adaptive counter-cycle:
//   - After SUCCESS → go faster (rival will speed up after losing)
//   - After KICKED → go slightly slower (rival will slow down after winning)
//   - Uses EMA of recent success timings as anchor

function createHybridML(preset = 'NORMAL') {
    const absFloor = 1675;
    const absCeiling = 2150;
    const startTiming = preset === 'SLOW' ? 1800 : preset === 'NORMAL' ? 1925 : 2050;

    let timing = startTiming;

    // ── Boundary state ──
    let bFloor = null;
    let bCeiling = null;

    // ── Adaptive state ──
    let ema = null;
    let lastSuccessTiming = null;

    function clamp(t) { return Math.max(absFloor, Math.min(absCeiling, Math.round(t))); }

    function median() {
        const lo = bFloor !== null ? bFloor : absFloor;
        const hi = bCeiling !== null ? bCeiling : absCeiling;
        return clamp((lo + hi) / 2);
    }

    function boundaryWidth() {
        const lo = bFloor !== null ? bFloor : absFloor;
        const hi = bCeiling !== null ? bCeiling : absCeiling;
        return hi - lo;
    }

    // Track recent results to detect oscillation (SUCCESS/KICKED alternating)
    let recentResults = []; // last 6 results
    let aggressiveRoundsLeft = 0; // stay in aggressive mode for N rounds after detection

    function isOscillating() {
        if (recentResults.length < 4) return false;
        let flips = 0;
        for (let i = 1; i < recentResults.length; i++) {
            const prev = recentResults[i - 1];
            const curr = recentResults[i];
            if ((prev === 'SUCCESS' && curr === 'KICKED') || (prev === 'KICKED' && curr === 'SUCCESS')) {
                flips++;
            }
        }
        return flips >= 2;
    }

    function shouldBeAggressive() {
        // Either currently oscillating with narrow boundary, or still in cooldown
        if (aggressiveRoundsLeft > 0) return true;
        return bFloor !== null && bCeiling !== null && boundaryWidth() <= 30 && isOscillating();
    }

    return {
        name: 'Hybrid ML',
        getTiming() { return timing; },
        learn(result, opponentLeftTime) {

            // Track results
            recentResults.push(result);
            if (recentResults.length > 6) recentResults.shift();

            // Update EMA on success
            if (result === 'SUCCESS') {
                lastSuccessTiming = timing;
                if (ema === null) ema = timing;
                else ema = Math.round(0.4 * timing + 0.6 * ema);
            }

            // ── Boundary narrow AND oscillating → Current ML style (aggressive jumps) ──
            // Binary search is predictable → adaptive rival reads it.
            // Current ML's -25ms random jumps break the mirror.
            if (shouldBeAggressive()) {
                // Clear boundaries + stay aggressive for 8 rounds (like Current ML)
                if (aggressiveRoundsLeft <= 0) aggressiveRoundsLeft = 8;
                aggressiveRoundsLeft--;
                bFloor = null;
                bCeiling = null;
                // Binary search will use the existing edges next round

                if (result === 'SUCCESS') {
                    // Small drift — stay aggressive
                    timing = clamp(timing - 3);
                    return;
                }

                if (result === 'KICKED') {
                    // Big unpredictable jump down — this is what makes Current ML work
                    timing = clamp(timing - 25);
                    return;
                }

                if (result === '3S_ERROR') {
                    // EMA-guided recovery or fixed step
                    if (ema !== null) {
                        const gap = ema - timing;
                        if (gap > 5) {
                            timing = clamp(timing + Math.round(gap * 0.6));
                        } else {
                            timing = clamp(timing + 10);
                        }
                    } else {
                        timing = clamp(timing + 15);
                    }
                    return;
                }

                if (result === 'LEFT_EARLY' && opponentLeftTime) {
                    if (ema === null) ema = opponentLeftTime;
                    else ema = Math.round(0.3 * opponentLeftTime + 0.7 * ema);
                    // Follow but don't chase too low
                    if (opponentLeftTime >= absFloor) {
                        timing = clamp(opponentLeftTime);
                    }
                    return;
                }
                return;
            }

            // ── Boundary is wide → binary search ──

            if (result === '3S_ERROR') {
                if (bFloor === null || timing > bFloor) bFloor = timing;
                timing = median();
                if (bFloor !== null && timing <= bFloor) timing = clamp(bFloor + 15);
                return;
            }

            if (result === 'LEFT_EARLY' && opponentLeftTime) {
                if (bFloor === null || opponentLeftTime > bFloor) bFloor = opponentLeftTime;
                timing = median();
                if (timing <= bFloor) timing = clamp(bFloor + 15);
                return;
            }

            if (result === 'SUCCESS') {
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = clamp(timing - 3);
                if (bFloor !== null && timing <= bFloor) timing = median();
                return;
            }

            if (result === 'KICKED') {
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = median();
                if (bFloor !== null && timing <= bFloor) {
                    bFloor = null;
                    timing = median();
                }
                return;
            }
        }
    };
}

// ─── Run simulation ─────────────────────────────────────────────────────────────

function runSimulation(strategyFactory, rivalType, rounds = 50, preset = 'NORMAL') {
    const strategy = strategyFactory(preset);
    const rivalGen = createRival(rivalType);

    let results = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };
    let log = [];
    let rivalLastResult = null;

    for (let i = 0; i < rounds; i++) {
        const botTiming = strategy.getTiming();
        const rivalTiming = typeof rivalGen === 'function'
            ? (rivalGen.length > 0 ? rivalGen(rivalLastResult) : rivalGen())
            : rivalGen();

        const { result, rivalLeftAt } = simulateRound(botTiming, rivalTiming);
        results[result]++;

        if (result === 'SUCCESS') rivalLastResult = 'lost';
        else if (result === 'KICKED') rivalLastResult = 'won';
        else rivalLastResult = null;

        log.push({ round: i + 1, botTiming, rivalTiming, result, rivalLeftAt });

        strategy.learn(result, rivalLeftAt);
    }

    return { strategy: strategy.name, rival: rivalType, rounds, results, log, preset };
}

// ─── Print results ──────────────────────────────────────────────────────────────

function printResults(sim) {
    const r = sim.results;
    const total = sim.rounds;
    const successRate = ((r.SUCCESS / total) * 100).toFixed(1);
    const kickedRate = ((r.KICKED / total) * 100).toFixed(1);
    const errorRate = ((r['3S_ERROR'] / total) * 100).toFixed(1);
    const leftEarlyRate = ((r.LEFT_EARLY / total) * 100).toFixed(1);

    console.log(`  ${sim.strategy.padEnd(15)} | SUCCESS: ${String(r.SUCCESS).padStart(3)} (${successRate.padStart(5)}%) | KICKED: ${String(r.KICKED).padStart(3)} (${kickedRate.padStart(5)}%) | 3S_ERR: ${String(r['3S_ERROR']).padStart(3)} (${errorRate.padStart(5)}%) | LEFT: ${String(r.LEFT_EARLY).padStart(3)} (${leftEarlyRate.padStart(5)}%)`);
}

function printDetailedLog(sim, maxRounds = 25) {
    console.log(`\n  Round | Bot     | Rival   | Result`);
    console.log(`  ------+---------+---------+----------`);
    const showRounds = sim.log.slice(0, maxRounds);
    for (const entry of showRounds) {
        const leftInfo = entry.rivalLeftAt ? ` (saw @${entry.rivalLeftAt})` : '';
        console.log(`  ${String(entry.round).padStart(5)} | ${String(entry.botTiming).padStart(5)}ms | ${String(entry.rivalTiming).padStart(5)}ms | ${entry.result}${leftInfo}`);
    }
    if (sim.rounds > maxRounds) console.log(`  ... (${sim.rounds - maxRounds} more rounds)`);
}

// ─── Main ────────────────────────────────────────────────────────────────────────

const ROUNDS = 100;
const PRESET = 'NORMAL';
const RUNS_PER_TEST = 20;

const rivalTypes = ['STABLE', 'SLOW', 'FAST', 'ERRATIC', 'ERRATIC_UNIFORM', 'ADAPTIVE', 'TRAPPER', 'BOUNDARY_DANCER', 'MIXED'];
const strategies = [createCurrentML, createBoundaryML, createHybridML];

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('  ML STRATEGY SIMULATION');
console.log(`  Preset: ${PRESET} | Rounds per test: ${ROUNDS} | Averaged over ${RUNS_PER_TEST} runs`);
console.log(`  Bot ping: ${PING_BOT}ms | Rival ping: ${PING_RIVAL}ms`);
console.log(`  ERRATIC range: 1675-2150 (realistic distribution)`);
console.log(`  ERRATIC_UNIFORM range: 1675-2150 (pure uniform)`);
console.log('═══════════════════════════════════════════════════════════════════════\n');

for (const rivalType of rivalTypes) {
    console.log(`\n── vs ${rivalType} rival ${'─'.repeat(55 - rivalType.length)}`);

    for (const stratFactory of strategies) {
        let totals = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };
        let lastSim = null;

        for (let run = 0; run < RUNS_PER_TEST; run++) {
            const sim = runSimulation(stratFactory, rivalType, ROUNDS, PRESET);
            for (const key of Object.keys(totals)) totals[key] += sim.results[key];
            lastSim = sim;
        }

        const avgSim = {
            strategy: lastSim.strategy,
            rival: rivalType,
            rounds: ROUNDS,
            results: {},
            log: lastSim.log,
            preset: PRESET
        };
        for (const key of Object.keys(totals)) {
            avgSim.results[key] = Math.round(totals[key] / RUNS_PER_TEST);
        }

        printResults(avgSim);
    }
}

// ─── Detailed ERRATIC logs ──────────────────────────────────────────────────────

console.log('\n\n═══════════════════════════════════════════════════════════════════════');
console.log('  DETAILED ROUND-BY-ROUND: vs ERRATIC rival (first 40 rounds)');
console.log('═══════════════════════════════════════════════════════════════════════');

for (const stratFactory of strategies) {
    const sim = runSimulation(stratFactory, 'ERRATIC', 40, PRESET);
    console.log(`\n  ▸ ${sim.strategy}`);
    printDetailedLog(sim, 40);
    console.log(`  Results: SUCCESS=${sim.results.SUCCESS} KICKED=${sim.results.KICKED} 3S_ERR=${sim.results['3S_ERROR']} LEFT=${sim.results.LEFT_EARLY}`);
}

console.log('\n\n═══════════════════════════════════════════════════════════════════════');
console.log('  DETAILED ROUND-BY-ROUND: vs ADAPTIVE rival (first 40 rounds)');
console.log('═══════════════════════════════════════════════════════════════════════');

for (const stratFactory of strategies) {
    const sim = runSimulation(stratFactory, 'ADAPTIVE', 40, PRESET);
    console.log(`\n  ▸ ${sim.strategy}`);
    printDetailedLog(sim, 40);
    console.log(`  Results: SUCCESS=${sim.results.SUCCESS} KICKED=${sim.results.KICKED} 3S_ERR=${sim.results['3S_ERROR']} LEFT=${sim.results.LEFT_EARLY}`);
}

console.log('\n\n═══════════════════════════════════════════════════════════════════════');
console.log('  DETAILED ROUND-BY-ROUND: vs MIXED rival (first 60 rounds)');
console.log('═══════════════════════════════════════════════════════════════════════');

for (const stratFactory of strategies) {
    const sim = runSimulation(stratFactory, 'MIXED', 60, PRESET);
    console.log(`\n  ▸ ${sim.strategy}`);
    printDetailedLog(sim, 60);
    console.log(`  Results: SUCCESS=${sim.results.SUCCESS} KICKED=${sim.results.KICKED} 3S_ERR=${sim.results['3S_ERROR']} LEFT=${sim.results.LEFT_EARLY}`);
}
