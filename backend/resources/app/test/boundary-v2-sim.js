/**
 * Boundary ML v2 Simulation
 *
 * Rules:
 *   3S_ERROR  → floor = timing, next = median(floor, ceiling)
 *   LEFT_EARLY → floor = rivalLeftAt, ceiling = ourTiming, next = median(floor, ceiling)
 *              → if 2 consecutive 3S_ERROR after LEFT_EARLY: floor = last 3S_ERROR, ceiling = LEFT_EARLY ceiling (kept), next = median
 *   SUCCESS   → ceiling = timing, next = median(floor, ceiling)
 *   KICKED    → ceiling = timing, next = median(floor, ceiling)
 *
 * Preset controls floor only. Ceiling always 2150.
 *   SLOW: floor=1675  NORMAL: floor=1850  FAST: floor=1950
 */

const PING_BOT = 46, PING_RIVAL = 40;

function simulateRound(botTiming, rivalTiming) {
    const botServer = botTiming + PING_BOT;
    const rivalServer = rivalTiming + PING_RIVAL;
    const serverWindow = 1870 + Math.floor(Math.random() * 20 - 10);

    // LEFT_EARLY: rival left before us
    if (rivalServer < botServer && rivalTiming < botTiming - 30) {
        return { result: 'LEFT_EARLY', rivalLeftAt: rivalTiming + Math.floor(Math.random() * 10 - 5) };
    }
    if (botServer < serverWindow) return { result: '3S_ERROR', rivalLeftAt: null };
    if (botServer <= rivalServer) return { result: 'SUCCESS', rivalLeftAt: null };
    return { result: 'KICKED', rivalLeftAt: null };
}

// ─── Rivals ───────────────────────────────────────────────────────────────────

function createRival(type) {
    switch (type) {
        case 'STABLE': return () => 1895 + Math.floor(Math.random() * 10);
        case 'SLOW': return () => 1970 + Math.floor(Math.random() * 10);
        case 'FAST': return () => 1825 + Math.floor(Math.random() * 10);
        case 'ERRATIC': return () => {
            const r = Math.random();
            if (r < 0.15) return 1675 + Math.floor(Math.random() * 150);
            if (r < 0.60) return 1825 + Math.floor(Math.random() * 150);
            if (r < 0.85) return 1975 + Math.floor(Math.random() * 100);
            return 2075 + Math.floor(Math.random() * 75);
        };
        case 'ADAPTIVE': {
            let at = 1900, lr = null;
            return (rr) => {
                if (lr === 'lost') at = Math.max(1750, at - 15);
                if (lr === 'won') at = Math.min(2050, at + 10);
                lr = rr;
                return at + Math.floor(Math.random() * 10 - 5);
            };
        }
        default: return () => 1900;
    }
}

// ─── Boundary ML v1 (current) ─────────────────────────────────────────────────

function createBoundaryV1(presetFloor = 1675) {
    let bFloor = null, bCeiling = null;
    const ABS_FLOOR = presetFloor, ABS_CEILING = 2150;

    function clamp(v) { return Math.max(ABS_FLOOR, Math.min(ABS_CEILING, Math.round(v))); }
    function median() {
        const lo = bFloor !== null ? bFloor : ABS_FLOOR;
        const hi = bCeiling !== null ? bCeiling : ABS_CEILING;
        return clamp(Math.round((lo + hi) / 2));
    }

    let timing = median();

    return {
        name: 'v1 (current)',
        getTiming() { return timing + Math.floor(Math.random() * 7 - 3); },
        update(result, rivalLeftAt) {
            if (result === 'LEFT_EARLY' && rivalLeftAt) {
                if (bFloor === null || rivalLeftAt > bFloor) bFloor = rivalLeftAt;
                timing = median();
                if (bFloor !== null && timing <= bFloor) timing = clamp(bFloor + 15);
            } else if (result === 'SUCCESS') {
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = clamp(timing - 3);
                if (bFloor !== null && timing <= bFloor) timing = median();
            } else if (result === '3S_ERROR') {
                if (bFloor === null || timing > bFloor) bFloor = timing;
                timing = median();
                if (bFloor !== null && timing <= bFloor) timing = clamp(bFloor + 15);
            } else if (result === 'KICKED') {
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = median();
                if (bFloor !== null && timing <= bFloor) { bFloor = null; timing = median(); }
            }
        }
    };
}

// ─── Boundary ML v2 (new formula) ─────────────────────────────────────────────

function createBoundaryV2(presetFloor = 1675) {
    let bFloor = null, bCeiling = null;
    const ABS_FLOOR = presetFloor, ABS_CEILING = 2150;

    let consecutive3sError = 0;
    let inLeftEarlyRecovery = false;
    let leftEarlyCeiling = null; // preserved ceiling from LEFT_EARLY

    function clamp(v) { return Math.max(ABS_FLOOR, Math.min(ABS_CEILING, Math.round(v))); }
    function median() {
        const lo = bFloor !== null ? bFloor : ABS_FLOOR;
        const hi = bCeiling !== null ? bCeiling : ABS_CEILING;
        return clamp(Math.round((lo + hi) / 2));
    }

    let timing = median();

    return {
        name: 'v2 (new formula)',
        getTiming() { return timing + Math.floor(Math.random() * 7 - 3); },
        update(result, rivalLeftAt) {
            if (result === 'LEFT_EARLY' && rivalLeftAt) {
                // floor = max(currentFloor, rivalLeftAt) — don't drag floor down
                if (bFloor === null || rivalLeftAt > bFloor) bFloor = rivalLeftAt;
                // ceiling = min(currentCeiling, ourTiming) — don't widen ceiling
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                leftEarlyCeiling = bCeiling; // save for 2x 3S_ERROR trigger
                inLeftEarlyRecovery = true;
                consecutive3sError = 0;
                timing = median();

            } else if (result === '3S_ERROR') {
                // Update floor
                if (bFloor === null || timing > bFloor) bFloor = timing;

                if (inLeftEarlyRecovery) {
                    consecutive3sError++;
                    if (consecutive3sError >= 2) {
                        // TRIGGER: 2 consecutive 3S_ERROR after LEFT_EARLY
                        // floor = last 3S_ERROR (already set above)
                        // ceiling = LEFT_EARLY ceiling (preserved)
                        bCeiling = leftEarlyCeiling;
                        inLeftEarlyRecovery = false;
                        consecutive3sError = 0;
                    }
                }

                timing = median();
                if (bFloor !== null && timing <= bFloor) timing = clamp(bFloor + 15);

            } else if (result === 'SUCCESS') {
                // ceiling = timing (rival is at or above us)
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                // Stay near sweet spot — drift down slightly, don't jump to median
                timing = clamp(timing - 3);
                if (bFloor !== null && timing <= bFloor) timing = median();
                inLeftEarlyRecovery = false;
                consecutive3sError = 0;

            } else if (result === 'KICKED') {
                // ceiling = timing (rival is here, faster than us)
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = median();
                if (bFloor !== null && timing <= bFloor) { bFloor = null; timing = median(); }
                inLeftEarlyRecovery = false;
                consecutive3sError = 0;
            }
        }
    };
}

// ─── Run simulation ──────────────────────────────────────────────────────────

function runTest(mlFactory, rivalType, rounds, runs) {
    let totals = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };

    for (let run = 0; run < runs; run++) {
        const ml = mlFactory();
        const rivalGen = createRival(rivalType);
        let rivalLastResult = null;

        for (let i = 0; i < rounds; i++) {
            const botTiming = ml.getTiming();
            const rivalTiming = rivalGen(rivalLastResult);
            const { result, rivalLeftAt } = simulateRound(botTiming, rivalTiming);
            totals[result]++;

            if (result === 'SUCCESS') rivalLastResult = 'lost';
            else if (result === 'KICKED') rivalLastResult = 'won';
            else rivalLastResult = null;

            ml.update(result, rivalLeftAt);
        }
    }

    // Average per run
    const avg = {};
    for (const k of Object.keys(totals)) avg[k] = (totals[k] / runs).toFixed(1);
    return avg;
}

// ─── Detailed trace (single run, show each attempt) ──────────────────────────

function runTrace(mlFactory, rivalType, rounds) {
    const ml = mlFactory();
    const rivalGen = createRival(rivalType);
    let rivalLastResult = null;
    let results = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };

    for (let i = 0; i < rounds; i++) {
        const botTiming = ml.getTiming();
        const rivalTiming = rivalGen(rivalLastResult);
        const { result, rivalLeftAt } = simulateRound(botTiming, rivalTiming);
        results[result]++;

        const rlAt = rivalLeftAt ? ` rivalAt=${rivalLeftAt}` : '';
        console.log(`    #${String(i+1).padStart(2)} fire ${botTiming} (rival ${rivalTiming}) → ${result.padEnd(10)}${rlAt}`);

        if (result === 'SUCCESS') rivalLastResult = 'lost';
        else if (result === 'KICKED') rivalLastResult = 'won';
        else rivalLastResult = null;

        ml.update(result, rivalLeftAt);
    }
    return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
    const ROUNDS = 50;
    const RUNS = 30;
    const rivals = ['STABLE', 'SLOW', 'FAST', 'ERRATIC', 'ADAPTIVE'];

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('  BOUNDARY ML v1 vs v2 COMPARISON');
    console.log(`  SLOW preset (floor=1675, ceiling=2150) | ${ROUNDS} rounds | ${RUNS} runs avg`);
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    for (const rival of rivals) {
        const v1 = runTest(() => createBoundaryV1(1675), rival, ROUNDS, RUNS);
        const v2 = runTest(() => createBoundaryV2(1675), rival, ROUNDS, RUNS);

        const diff = (parseFloat(v2.SUCCESS) - parseFloat(v1.SUCCESS)).toFixed(1);
        const marker = diff > 0.5 ? ' ✅' : diff < -0.5 ? ' ❌' : '';

        console.log(`  vs ${rival.padEnd(12)}`);
        console.log(`    v1: SUCCESS ${v1.SUCCESS.padStart(5)} | KICKED ${v1.KICKED.padStart(5)} | 3S_ERR ${v1['3S_ERROR'].padStart(5)} | LEFT ${v1.LEFT_EARLY.padStart(5)}`);
        console.log(`    v2: SUCCESS ${v2.SUCCESS.padStart(5)} | KICKED ${v2.KICKED.padStart(5)} | 3S_ERR ${v2['3S_ERROR'].padStart(5)} | LEFT ${v2.LEFT_EARLY.padStart(5)}  diff: ${diff > 0 ? '+' : ''}${diff}${marker}`);
        console.log();
    }

    // Detailed trace: ERRATIC with v2
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('  DETAILED TRACE — v2 vs ERRATIC (25 rounds, single run)');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const traceResults = runTrace(() => createBoundaryV2(1675), 'ERRATIC', 25);
    console.log(`\n    TOTAL: SUCCESS=${traceResults.SUCCESS} KICKED=${traceResults.KICKED} 3S_ERR=${traceResults['3S_ERROR']} LEFT=${traceResults.LEFT_EARLY}`);

    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
}

main();
