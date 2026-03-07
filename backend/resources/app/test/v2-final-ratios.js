/**
 * Boundary ML v2 — Final ratios for all presets
 * Preset controls FLOOR only. No ceiling cap — always 2150.
 *   SLOW: floor=1675, ceiling=2150 (can reach normal + fast zone)
 *   NORMAL: floor=1850, ceiling=2150 (can reach fast zone)
 *   FAST: floor=1950, ceiling=2150 (fast zone only)
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
        default: return () => 1900;
    }
}

function createBoundaryV2(presetFloor) {
    let bFloor = null, bCeiling = null;
    const ABS_FLOOR = presetFloor, ABS_CEILING = 2150; // always 2150

    let consecutive3sError = 0;
    let inLeftEarlyRecovery = false;
    let leftEarlyCeiling = null;

    function clamp(v) { return Math.max(ABS_FLOOR, Math.min(ABS_CEILING, Math.round(v))); }
    function median() {
        const lo = bFloor !== null ? bFloor : ABS_FLOOR;
        const hi = bCeiling !== null ? bCeiling : ABS_CEILING;
        return clamp(Math.round((lo + hi) / 2));
    }

    let timing = median();

    return {
        getTiming() { return timing + Math.floor(Math.random() * 7 - 3); },
        update(result, rivalLeftAt) {
            if (result === 'LEFT_EARLY' && rivalLeftAt) {
                if (bFloor === null || rivalLeftAt > bFloor) bFloor = rivalLeftAt;
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

function runTest(presetFloor, rivalType, rounds, runs) {
    let totals = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };

    for (let run = 0; run < runs; run++) {
        const ml = createBoundaryV2(presetFloor);
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

    const avg = {};
    const total = rounds * runs;
    for (const k of Object.keys(totals)) {
        avg[k] = { count: (totals[k] / runs).toFixed(1), pct: ((totals[k] / total) * 100).toFixed(1) };
    }
    return avg;
}

function main() {
    const ROUNDS = 50;
    const RUNS = 40;
    const rivals = ['STABLE', 'SLOW', 'FAST', 'ERRATIC', 'ADAPTIVE'];
    const presets = [
        { name: 'SLOW', floor: 1675 },
        { name: 'NORMAL', floor: 1850 },
        { name: 'FAST', floor: 1950 },
    ];

    console.log('═══════════════════════════════════════════════════════════════════════════════════════');
    console.log('  BOUNDARY ML v2 — ALL PRESETS — ALL RATIOS');
    console.log(`  Ceiling always 2150 | ${ROUNDS} rounds | ${RUNS} runs avg`);
    console.log('  Preset controls FLOOR only: SLOW=1675, NORMAL=1850, FAST=1950');
    console.log('═══════════════════════════════════════════════════════════════════════════════════════\n');

    for (const preset of presets) {
        console.log(`  ┌─── ${preset.name} PRESET (floor=${preset.floor}, ceiling=2150) ───────────────────────────────────┐`);
        console.log(`  │  Rival        │ SUCCESS       │ KICKED        │ 3S_ERROR      │ LEFT_EARLY    │`);
        console.log(`  ├───────────────┼───────────────┼───────────────┼───────────────┼───────────────┤`);

        for (const rival of rivals) {
            const r = runTest(preset.floor, rival, ROUNDS, RUNS);
            console.log(`  │  ${rival.padEnd(12)} │ ${r.SUCCESS.count.padStart(5)}  ${(r.SUCCESS.pct + '%').padStart(6)} │ ${r.KICKED.count.padStart(5)}  ${(r.KICKED.pct + '%').padStart(6)} │ ${r['3S_ERROR'].count.padStart(5)}  ${(r['3S_ERROR'].pct + '%').padStart(6)} │ ${r.LEFT_EARLY.count.padStart(5)}  ${(r.LEFT_EARLY.pct + '%').padStart(6)} │`);
        }

        console.log(`  └───────────────┴───────────────┴───────────────┴───────────────┴───────────────┘\n`);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════════════');
}

main();
