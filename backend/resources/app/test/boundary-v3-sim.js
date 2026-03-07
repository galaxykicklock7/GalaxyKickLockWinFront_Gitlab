/**
 * Boundary ML v3 — Middle ground LEFT_EARLY handling
 *
 * LEFT_EARLY floor logic:
 *   - No floor yet → set floor = rivalLeftAt
 *   - rivalLeftAt >= currentFloor → update floor (tighten up)
 *   - rivalLeftAt < currentFloor → save as pending. If 2 consecutive LEFT_EARLY below floor → reset floor
 *
 * Everything else same as v2:
 *   - Ceiling = min(currentCeiling, ourTiming) on LEFT_EARLY
 *   - 2x 3S_ERROR after LEFT_EARLY → restore ceiling
 *   - SUCCESS → drift -3
 *   - KICKED/SUCCESS → ceiling = timing
 *   - 3S_ERROR → floor = timing
 *   - Preset controls floor only, ceiling always 2150
 */

const PING_BOT = 46, PING_RIVAL = 40;

function simulateRound(botTiming, rivalTiming) {
    const botServer = botTiming + PING_BOT;
    const rivalServer = rivalTiming + PING_RIVAL;
    const serverWindow = 1870 + Math.floor(Math.random() * 20 - 10);

    if (rivalServer < botServer && rivalTiming < botTiming - 30) {
        return { result: 'LEFT_EARLY', rivalLeftAt: rivalTiming + Math.floor(Math.random() * 10 - 5) };
    }
    if (botServer < serverWindow) return { result: '3S_ERROR', rivalLeftAt: null };
    if (botServer <= rivalServer) return { result: 'SUCCESS', rivalLeftAt: null };
    return { result: 'KICKED', rivalLeftAt: null };
}

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
        // Rival that genuinely plays low consistently
        case 'LOW_PLAYER': return () => 1720 + Math.floor(Math.random() * 20);
        // Rival that switches between low and normal
        case 'MIXED_LOW': {
            let phase = 0;
            return () => {
                phase++;
                if (phase % 5 < 2) return 1720 + Math.floor(Math.random() * 20); // 2/5 low
                return 1880 + Math.floor(Math.random() * 20); // 3/5 normal
            };
        }
        default: return () => 1900;
    }
}

// ─── v2 current: always reset floor on LEFT_EARLY ─────────────────────────────

function createV2(presetFloor) {
    let bFloor = null, bCeiling = null;
    const ABS_FLOOR = presetFloor, ABS_CEILING = 2150;
    let consecutive3sError = 0, inLeftEarlyRecovery = false, leftEarlyCeiling = null;

    function clamp(v) { return Math.max(ABS_FLOOR, Math.min(ABS_CEILING, Math.round(v))); }
    function median() {
        const lo = bFloor !== null ? bFloor : ABS_FLOOR;
        const hi = bCeiling !== null ? bCeiling : ABS_CEILING;
        return clamp(Math.round((lo + hi) / 2));
    }

    let timing = median();

    return {
        name: 'v2 (always reset)',
        getTiming() { return timing + Math.floor(Math.random() * 7 - 3); },
        update(result, rivalLeftAt) {
            if (result === 'LEFT_EARLY' && rivalLeftAt) {
                bFloor = rivalLeftAt; // always reset
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                leftEarlyCeiling = bCeiling;
                inLeftEarlyRecovery = true;
                consecutive3sError = 0;
                timing = median();
            } else if (result === '3S_ERROR') {
                if (bFloor === null || timing > bFloor) bFloor = timing;
                if (inLeftEarlyRecovery) {
                    consecutive3sError++;
                    if (consecutive3sError >= 2) {
                        bCeiling = leftEarlyCeiling;
                        inLeftEarlyRecovery = false;
                        consecutive3sError = 0;
                    }
                }
                timing = median();
                if (bFloor !== null && timing <= bFloor) timing = clamp(bFloor + 15);
            } else if (result === 'SUCCESS') {
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = clamp(timing - 3);
                if (bFloor !== null && timing <= bFloor) timing = median();
                inLeftEarlyRecovery = false;
                consecutive3sError = 0;
            } else if (result === 'KICKED') {
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = median();
                if (bFloor !== null && timing <= bFloor) { bFloor = null; timing = median(); }
                inLeftEarlyRecovery = false;
                consecutive3sError = 0;
            }
        }
    };
}

// ─── v3: 2x consecutive LEFT_EARLY below floor → reset ────────────────────────

function createV3(presetFloor) {
    let bFloor = null, bCeiling = null;
    const ABS_FLOOR = presetFloor, ABS_CEILING = 2150;
    let consecutive3sError = 0, inLeftEarlyRecovery = false, leftEarlyCeiling = null;
    let consecutiveLowLeftEarly = 0; // tracks LEFT_EARLY below current floor
    let pendingLowFloor = null; // saved low rivalLeftAt

    function clamp(v) { return Math.max(ABS_FLOOR, Math.min(ABS_CEILING, Math.round(v))); }
    function median() {
        const lo = bFloor !== null ? bFloor : ABS_FLOOR;
        const hi = bCeiling !== null ? bCeiling : ABS_CEILING;
        return clamp(Math.round((lo + hi) / 2));
    }

    let timing = median();

    return {
        name: 'v3 (2x low LEFT_EARLY)',
        getTiming() { return timing + Math.floor(Math.random() * 7 - 3); },
        update(result, rivalLeftAt) {
            if (result === 'LEFT_EARLY' && rivalLeftAt) {
                // Ceiling always tightens
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;

                if (bFloor === null || rivalLeftAt >= bFloor) {
                    // rivalLeftAt is above or equal to floor → normal update
                    bFloor = rivalLeftAt;
                    consecutiveLowLeftEarly = 0;
                    pendingLowFloor = null;
                } else {
                    // rivalLeftAt is BELOW current floor → outlier or genuine low rival
                    consecutiveLowLeftEarly++;
                    pendingLowFloor = rivalLeftAt;
                    if (consecutiveLowLeftEarly >= 2) {
                        // 2 consecutive LEFT_EARLY below floor → rival genuinely low, reset
                        bFloor = pendingLowFloor;
                        consecutiveLowLeftEarly = 0;
                        pendingLowFloor = null;
                    }
                    // Don't update floor yet on first low LEFT_EARLY
                }

                leftEarlyCeiling = bCeiling;
                inLeftEarlyRecovery = true;
                consecutive3sError = 0;
                timing = median();

            } else if (result === '3S_ERROR') {
                if (bFloor === null || timing > bFloor) bFloor = timing;
                consecutiveLowLeftEarly = 0; // reset low LEFT_EARLY counter on non-LEFT_EARLY
                if (inLeftEarlyRecovery) {
                    consecutive3sError++;
                    if (consecutive3sError >= 2) {
                        bCeiling = leftEarlyCeiling;
                        inLeftEarlyRecovery = false;
                        consecutive3sError = 0;
                    }
                }
                timing = median();
                if (bFloor !== null && timing <= bFloor) timing = clamp(bFloor + 15);
            } else if (result === 'SUCCESS') {
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = clamp(timing - 3);
                if (bFloor !== null && timing <= bFloor) timing = median();
                inLeftEarlyRecovery = false;
                consecutive3sError = 0;
                consecutiveLowLeftEarly = 0;
            } else if (result === 'KICKED') {
                if (bCeiling === null || timing < bCeiling) bCeiling = timing;
                timing = median();
                if (bFloor !== null && timing <= bFloor) { bFloor = null; timing = median(); }
                inLeftEarlyRecovery = false;
                consecutive3sError = 0;
                consecutiveLowLeftEarly = 0;
            }
        }
    };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

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

    const total = rounds * runs;
    const avg = {};
    for (const k of Object.keys(totals)) {
        avg[k] = { count: (totals[k] / runs).toFixed(1), pct: ((totals[k] / total) * 100).toFixed(1) };
    }
    return avg;
}

function main() {
    const ROUNDS = 50;
    const RUNS = 40;
    const rivals = ['STABLE', 'SLOW', 'FAST', 'ERRATIC', 'ADAPTIVE', 'LOW_PLAYER', 'MIXED_LOW'];

    console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
    console.log('  v2 (always reset floor) vs v3 (2x consecutive low LEFT_EARLY to reset)');
    console.log(`  SLOW preset (floor=1675, ceiling=2150) | ${ROUNDS} rounds | ${RUNS} runs avg`);
    console.log('═══════════════════════════════════════════════════════════════════════════════════════════\n');

    const pctFmt = (r) => `S:${r.SUCCESS.pct.padStart(5)}% K:${r.KICKED.pct.padStart(5)}% E:${r['3S_ERROR'].pct.padStart(5)}% L:${r.LEFT_EARLY.pct.padStart(5)}%`;

    for (const rival of rivals) {
        const v2 = runTest(() => createV2(1675), rival, ROUNDS, RUNS);
        const v3 = runTest(() => createV3(1675), rival, ROUNDS, RUNS);

        const diff = (parseFloat(v3.SUCCESS.pct) - parseFloat(v2.SUCCESS.pct)).toFixed(1);
        const marker = diff > 1 ? ' ✅' : diff < -1 ? ' ❌' : '';

        console.log(`  vs ${rival.padEnd(12)}`);
        console.log(`    v2: ${pctFmt(v2)}`);
        console.log(`    v3: ${pctFmt(v3)}  SUCCESS diff: ${diff > 0 ? '+' : ''}${diff}${marker}`);
        console.log();
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
}

main();
