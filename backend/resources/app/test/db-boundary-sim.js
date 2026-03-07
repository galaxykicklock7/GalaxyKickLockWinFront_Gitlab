/**
 * Simulation: Cold-start Boundary ML vs DB-assisted Boundary ML
 *
 * DB-assisted: stores floor/ceiling per 50ms zone with result counts.
 * On rival encounter, reads zone data to set initial bFloor/bCeiling
 * instead of starting from absolute limits.
 *
 * Usage: node test/db-boundary-sim.js
 */

const PING_BOT = 46, PING_RIVAL = 40;
const ABS_FLOOR = 1675, ABS_CEILING = 1900; // SLOW preset

function clamp(v) { return Math.max(ABS_FLOOR, Math.min(ABS_CEILING, Math.round(v))); }

function simulateRound(botTiming, rivalTiming) {
    const botServer = botTiming + PING_BOT;
    const rivalServer = rivalTiming + PING_RIVAL;
    const serverWindow = 1870 + Math.floor(Math.random() * 20 - 10);

    // LEFT_EARLY first
    if (rivalServer < botServer && rivalTiming < botTiming - 30) {
        return { result: 'LEFT_EARLY', rivalLeftAt: rivalTiming + Math.floor(Math.random() * 10 - 5) };
    }
    if (botServer < serverWindow) return { result: '3S_ERROR', rivalLeftAt: null };
    if (botServer <= rivalServer) return { result: 'SUCCESS', rivalLeftAt: null };
    return { result: 'KICKED', rivalLeftAt: null };
}

// ─── Rival generators ─────────────────────────────────────────────────────────

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

// ─── Boundary ML (cold start — no DB) ────────────────────────────────────────

function createColdBoundaryML() {
    let bFloor = null, bCeiling = null;

    function median() {
        const lo = bFloor !== null ? bFloor : ABS_FLOOR;
        const hi = bCeiling !== null ? bCeiling : ABS_CEILING;
        return clamp(Math.round((lo + hi) / 2));
    }

    let timing = median();

    return {
        getTiming() { return timing + Math.floor(Math.random() * 7 - 3); },
        getFloor() { return bFloor; },
        getCeiling() { return bCeiling; },
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

// ─── Simulated DB: stores zone results ────────────────────────────────────────

function createZoneDB() {
    // Zones: 50ms buckets from 1675 to 2150
    // Each zone stores: { success: N, kicked: N, error3s: N, leftEarly: N }
    const zones = {};

    function getZoneKey(timing) {
        const bucket = Math.floor(timing / 50) * 50;
        return bucket;
    }

    return {
        store(timing, result) {
            const key = getZoneKey(timing);
            if (!zones[key]) zones[key] = { success: 0, kicked: 0, error3s: 0, leftEarly: 0, total: 0 };
            zones[key].total++;
            if (result === 'SUCCESS') zones[key].success++;
            else if (result === 'KICKED') zones[key].kicked++;
            else if (result === '3S_ERROR') zones[key].error3s++;
            else if (result === 'LEFT_EARLY') zones[key].leftEarly++;
        },

        // Derive initial floor/ceiling from stored zone data
        getBoundaryHint() {
            const keys = Object.keys(zones).map(Number).sort((a, b) => a - b);
            if (keys.length === 0) return { floor: null, ceiling: null, startTiming: null };

            // Floor hint: highest zone where we got 3S_ERROR or LEFT_EARLY predominantly
            // Ceiling hint: lowest zone where we got SUCCESS predominantly
            let floorHint = null;
            let ceilingHint = null;
            let bestSuccessZone = null;
            let bestSuccessRate = 0;

            for (const key of keys) {
                const z = zones[key];
                if (z.total < 2) continue; // need at least 2 records

                const successRate = z.success / z.total;
                const errorRate = (z.error3s + z.leftEarly) / z.total;
                const kickedRate = z.kicked / z.total;

                // Zone is mostly errors/leftEarly → this is below rival, floor hint
                if (errorRate > 0.5 && z.error3s + z.leftEarly >= 2) {
                    if (floorHint === null || key > floorHint) floorHint = key;
                }

                // Zone has good success → ceiling hint (rival is at or above here)
                if (successRate > 0.4 && z.success >= 2) {
                    if (bestSuccessZone === null || successRate > bestSuccessRate) {
                        bestSuccessZone = key;
                        bestSuccessRate = successRate;
                    }
                    // Ceiling = top of this success zone
                    if (ceilingHint === null || key + 50 < ceilingHint) {
                        ceilingHint = key + 50;
                    }
                }

                // Zone is mostly kicked → rival is faster here, this is above rival
                if (kickedRate > 0.5 && z.kicked >= 2) {
                    if (ceilingHint === null || key < ceilingHint) ceilingHint = key;
                }
            }

            // Start timing: center of best success zone if available
            const startTiming = bestSuccessZone !== null ? bestSuccessZone + 25 : null;

            return { floor: floorHint, ceiling: ceilingHint, startTiming };
        },

        dump() {
            const keys = Object.keys(zones).map(Number).sort((a, b) => a - b);
            for (const k of keys) {
                const z = zones[k];
                console.log(`      ${k}-${k+50}: S=${z.success} K=${z.kicked} E=${z.error3s} L=${z.leftEarly}`);
            }
        }
    };
}

// ─── DB-assisted Boundary ML ──────────────────────────────────────────────────

function createDBBoundaryML(dbHint) {
    // Start with DB hints if available
    let bFloor = dbHint.floor;
    let bCeiling = dbHint.ceiling;

    function median() {
        const lo = bFloor !== null ? bFloor : ABS_FLOOR;
        const hi = bCeiling !== null ? bCeiling : ABS_CEILING;
        return clamp(Math.round((lo + hi) / 2));
    }

    // If DB gives us a good start timing, use it; otherwise median
    let timing = dbHint.startTiming ? clamp(dbHint.startTiming) : median();

    return {
        getTiming() { return timing + Math.floor(Math.random() * 7 - 3); },
        getFloor() { return bFloor; },
        getCeiling() { return bCeiling; },
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

// ─── Run simulation ──────────────────────────────────────────────────────────

function runEncounter(ml, rivalGen, rounds, zoneDB = null) {
    let results = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };
    let rivalLastResult = null;

    for (let i = 0; i < rounds; i++) {
        const botTiming = ml.getTiming();
        const rivalTiming = rivalGen(rivalLastResult);
        const { result, rivalLeftAt } = simulateRound(botTiming, rivalTiming);
        results[result]++;

        if (result === 'SUCCESS') rivalLastResult = 'lost';
        else if (result === 'KICKED') rivalLastResult = 'won';
        else rivalLastResult = null;

        ml.update(result, rivalLeftAt);
        if (zoneDB) zoneDB.store(botTiming, result);
    }
    return results;
}

function main() {
    const ROUNDS = 30; // short encounter (realistic)
    const ENCOUNTERS = 5; // face same rival 5 times
    const RUNS = 20; // average over 20 runs

    const rivals = ['STABLE', 'FAST', 'ERRATIC', 'ADAPTIVE'];

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('  DB-ASSISTED BOUNDARY ML SIMULATION');
    console.log(`  SLOW preset (${ABS_FLOOR}-${ABS_CEILING}) | ${ROUNDS} rounds/encounter | ${ENCOUNTERS} encounters | ${RUNS} runs`);
    console.log('  Scenario: You face the SAME rival 5 times.');
    console.log('  Cold = reset boundaries each time. DB = boundaries from prior encounters.');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    for (const rivalType of rivals) {
        console.log(`  ── vs ${rivalType} ──────────────────────────────────────────────────────`);

        let coldTotals = [];
        let dbTotals = [];

        for (let run = 0; run < RUNS; run++) {
            // Cold: each encounter starts fresh
            let coldPerEncounter = [];
            for (let enc = 0; enc < ENCOUNTERS; enc++) {
                const ml = createColdBoundaryML();
                const rivalGen = createRival(rivalType);
                const r = runEncounter(ml, rivalGen, ROUNDS);
                coldPerEncounter.push(r.SUCCESS);
            }
            coldTotals.push(coldPerEncounter);

            // DB-assisted: accumulate zone data across encounters
            let dbPerEncounter = [];
            const zoneDB = createZoneDB();
            for (let enc = 0; enc < ENCOUNTERS; enc++) {
                const hint = zoneDB.getBoundaryHint();
                const ml = createDBBoundaryML(hint);
                const rivalGen = createRival(rivalType);
                const r = runEncounter(ml, rivalGen, ROUNDS, zoneDB);
                dbPerEncounter.push(r.SUCCESS);
            }
            dbTotals.push(dbPerEncounter);
        }

        // Average per encounter
        for (let enc = 0; enc < ENCOUNTERS; enc++) {
            const coldAvg = (coldTotals.reduce((s, r) => s + r[enc], 0) / RUNS).toFixed(1);
            const dbAvg = (dbTotals.reduce((s, r) => s + r[enc], 0) / RUNS).toFixed(1);
            const diff = (dbAvg - coldAvg).toFixed(1);
            const marker = diff > 0.5 ? ' ✅' : diff < -0.5 ? ' ❌' : '';
            console.log(`    Encounter ${enc + 1}: Cold ${coldAvg.padStart(5)}/${ROUNDS} SUCCESS | DB ${dbAvg.padStart(5)}/${ROUNDS} SUCCESS | diff: ${diff > 0 ? '+' : ''}${diff}${marker}`);
        }

        // Grand total
        const coldTotal = coldTotals.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0) / RUNS;
        const dbTotal = dbTotals.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0) / RUNS;
        console.log(`    TOTAL (${ENCOUNTERS} encounters): Cold ${coldTotal.toFixed(1)}/${ROUNDS * ENCOUNTERS} | DB ${dbTotal.toFixed(1)}/${ROUNDS * ENCOUNTERS} | diff: ${(dbTotal - coldTotal) > 0 ? '+' : ''}${(dbTotal - coldTotal).toFixed(1)}`);
        console.log();
    }

    // Show a sample DB zone dump for STABLE
    console.log('  ── Sample DB Zone Data (STABLE, 1 run, 5 encounters) ──────');
    const zoneDB = createZoneDB();
    for (let enc = 0; enc < 5; enc++) {
        const hint = zoneDB.getBoundaryHint();
        const ml = createDBBoundaryML(hint);
        const rivalGen = createRival('STABLE');
        runEncounter(ml, rivalGen, 30, zoneDB);
    }
    console.log(`    Hint: floor=${zoneDB.getBoundaryHint().floor}, ceiling=${zoneDB.getBoundaryHint().ceiling}, start=${zoneDB.getBoundaryHint().startTiming}`);
    zoneDB.dump();

    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
}

main();
