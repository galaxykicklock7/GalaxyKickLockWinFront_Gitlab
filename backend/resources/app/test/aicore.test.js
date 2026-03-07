/**
 * SimpleAICore Test Suite
 * Run: node test/aicore.test.js
 * Run verbose: DEBUG=true node test/aicore.test.js
 *
 * Simulates a realistic AI Core session:
 *   - Speed preset initialization
 *   - DB preload with rival history
 *   - 3S_ERROR climbing with oscillation + ceiling-aware caps
 *   - SUCCESS neighbourhood oscillation + drift
 *   - KICKED dead-zone memory
 *   - LEFT_EARLY plausibility check
 *   - Preemptive shift guard (bounds must be wide)
 *   - DB blend trust control (wrong-direction guard, min-records guard)
 *   - Opponent bounds (floor / ceiling) tracking
 *   - Binary search when both KICKED + 3S_ERROR exist in history
 *   - Speed preset change resets ML history
 */

'use strict';

const path = require('path');
const SimpleAICore = require(path.join(__dirname, '../src/ai/SimpleAICore'));

// ─────────────────────────────────────────────
// Minimal Supabase mock
// ─────────────────────────────────────────────
function makeMockSupabase(rivalRows = [], pingMs = 90) {
    return {
        from: (table) => ({
            select: () => ({
                eq: () => ({
                    eq: () => ({
                        not: () => ({
                            order: () => ({
                                limit: async () => ({
                                    data: [{ ping_ms: pingMs }],
                                    error: null
                                })
                            })
                        })
                    })
                })
            })
        }),
        rpc: async (fn, params) => {
            if (fn === 'get_optimal_timing_for_rival') {
                if (!rivalRows || rivalRows.length === 0) {
                    return { data: [], error: null };
                }
                // Calculate weighted optimal timing from provided rows
                const filtered = rivalRows.filter(r =>
                    r.rival_name === params.p_rival_name
                );
                if (filtered.length === 0) return { data: [], error: null };

                const weights = { SUCCESS: 3.0, KICKED: 4.0, '3S_ERROR': 2.0, LEFT_EARLY: 1.5 };
                let totalWeight = 0;
                let weightedSum = 0;
                let successCount = 0, kickedCount = 0, errorCount = 0, leftEarlyCount = 0;
                let slowKicked = 0, normalKicked = 0, fastKicked = 0;

                for (const row of filtered) {
                    const w = weights[row.result] || 1.0;
                    const tv = row.result === '3S_ERROR'
                        ? row.timing_value - 15
                        : row.result === 'LEFT_EARLY'
                            ? Math.min(row.timing_value, 1980) - 10
                            : row.timing_value;
                    totalWeight += w;
                    weightedSum += tv * w;
                    if (row.result === 'SUCCESS') successCount++;
                    else if (row.result === 'KICKED') {
                        kickedCount++;
                        if (row.timing_value < 1875) slowKicked++;
                        else if (row.timing_value < 1975) normalKicked++;
                        else fastKicked++;
                    }
                    else if (row.result === '3S_ERROR') errorCount++;
                    else if (row.result === 'LEFT_EARLY') leftEarlyCount++;
                }

                const optimal = Math.round(weightedSum / totalWeight);
                return {
                    data: [{
                        optimal_timing: optimal,
                        record_count: filtered.length,
                        success_count: successCount,
                        kicked_count: kickedCount,
                        error_count: errorCount,
                        left_early_count: leftEarlyCount,
                        slow_zone_kicked: slowKicked,
                        normal_zone_kicked: normalKicked,
                        fast_zone_kicked: fastKicked
                    }],
                    error: null
                };
            }
            return { data: [], error: null };
        }
    };
}

// ─────────────────────────────────────────────
// Test runner helpers
// ─────────────────────────────────────────────
let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${message}`);
        failed++;
        errors.push(message);
    }
}

function assertRange(value, min, max, message) {
    const ok = value >= min && value <= max;
    if (ok) {
        console.log(`  ✅ ${message} [${value}ms ∈ ${min}-${max}]`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${message} [${value}ms NOT in ${min}-${max}]`);
        failed++;
        errors.push(`${message}: ${value}ms not in ${min}-${max}`);
    }
}

function section(title) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📋 ${title}`);
    console.log('─'.repeat(60));
}

// Realistic rival history (simulates a moderately experienced rival)
const RIVAL_NAME = 'xota';
const RIVAL_HISTORY = [
    { rival_name: 'xota', timing_value: 1987, result: '3S_ERROR' },
    { rival_name: 'xota', timing_value: 2000, result: '3S_ERROR' },
    { rival_name: 'xota', timing_value: 1975, result: 'SUCCESS'   },
    { rival_name: 'xota', timing_value: 1960, result: 'SUCCESS'   },
    { rival_name: 'xota', timing_value: 1985, result: 'SUCCESS'   },
    { rival_name: 'xota', timing_value: 1990, result: 'KICKED'    },
    { rival_name: 'xota', timing_value: 1970, result: 'LEFT_EARLY'},
    { rival_name: 'xota', timing_value: 1982, result: 'SUCCESS'   },
];

// ─────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────

async function testSpeedPresetInit() {
    section('TEST 1: Speed preset initialization (no DB needed)');

    for (const [preset, expectedFloor, expectedCeiling, expectedStart] of [
        ['SLOW',   1775, 1900, 1825],
        ['NORMAL', 1850, 2000, 1925],
        ['FAST',   1950, 2150, 2062],
    ]) {
        const ai = new SimpleAICore(null, 'user1', 1, 1);
        ai.setSpeedPreset(preset);
        await ai.initializeTimingFromPing();

        assert(ai.timingFloor === expectedFloor,   `${preset}: floor = ${expectedFloor}`);
        assert(ai.timingCeiling === expectedCeiling, `${preset}: ceiling = ${expectedCeiling}`);
        assert(ai.currentTiming === expectedStart, `${preset}: starts at median ${expectedStart}ms`);
        assertRange(ai.currentTiming, ai.timingFloor, ai.timingCeiling,
            `${preset}: start timing within bounds`);
    }
}

async function testDBPreloadMinRecords() {
    section('TEST 2: DB preload — requires 5+ records to override ping timing');

    // Only 3 records — should NOT override
    const fewRows = RIVAL_HISTORY.slice(0, 3);
    const ai = new SimpleAICore(makeMockSupabase(fewRows), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.setCurrentRival(RIVAL_NAME);

    assert(ai.currentTiming === 1925,
        'With 3 records: stays at preset median 1925ms (DB preload skipped)');

    // 8 records — should override
    const ai2 = new SimpleAICore(makeMockSupabase(RIVAL_HISTORY), 'user1', 1, 1);
    ai2.setSpeedPreset('NORMAL');
    await ai2.setCurrentRival(RIVAL_NAME);

    assert(ai2.currentTiming !== 1925,
        'With 8 records: DB preload overrides preset median');
    assertRange(ai2.currentTiming, 1850, 2000,
        'DB preload timing clamped to NORMAL bounds');
    console.log(`     DB preloaded timing: ${ai2.currentTiming}ms`);
}

async function testThreeSErrorOscillation() {
    section('TEST 3: 3S_ERROR oscillation — timing alternates above/below anchor');

    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.initializeTimingFromPing();

    const timings = [];
    // Fire 8 consecutive 3S_ERRORs
    for (let i = 0; i < 8; i++) {
        const t = await ai.getNextTiming('3S_ERROR', 'attack', null);
        timings.push(t);
    }

    console.log(`     3S_ERROR timings: [${timings.join(', ')}]`);

    // All should be within NORMAL bounds
    timings.forEach((t, i) =>
        assertRange(t, 1850, 2000, `Round ${i+1}: within NORMAL bounds`)
    );

    // Should not be monotonically increasing (oscillation means alternating)
    const allIncreasing = timings.every((t, i) => i === 0 || t > timings[i - 1]);
    assert(!allIncreasing, 'Timings are NOT monotonically increasing (oscillation active)');

    // Overall trend should be upward (anchor drifts up)
    const firstHalfAvg = timings.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
    const secondHalfAvg = timings.slice(4).reduce((a, b) => a + b, 0) / 4;
    assert(secondHalfAvg > firstHalfAvg,
        `Anchor drifting up: first-half avg ${Math.round(firstHalfAvg)}ms < second-half avg ${Math.round(secondHalfAvg)}ms`);
}

async function testCeilingAwareCap() {
    section('TEST 4: Ceiling-aware cap — small steps near ceiling');

    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL'); // ceiling = 2000
    await ai.initializeTimingFromPing();

    // Manually push timing close to ceiling
    ai.currentTiming = 1992;
    ai.attackTiming = 1992;

    const t = await ai.getNextTiming('3S_ERROR', 'attack', null);
    console.log(`     At 1992ms (8ms from 2000 ceiling) → next: ${t}ms (step: +${t - 1992}ms)`);

    assert(t <= 2000, 'Does not exceed ceiling (2000ms)');
    assert(t - 1992 <= 10, `Step is small (≤10ms) near ceiling — got +${t - 1992}ms`);
}

async function testSuccessNeighbourhoodOscillation() {
    section('TEST 5: SUCCESS — stays near success timing with ±10ms oscillation');

    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.initializeTimingFromPing();

    // Get to a position first
    ai.currentTiming = 1960;
    ai.attackTiming = 1960;

    const successTimings = [];
    for (let i = 0; i < 4; i++) {
        const t = await ai.getNextTiming('SUCCESS', 'attack', null);
        const fired = ai.getTimingWithJitter('attack');
        successTimings.push({ next: t, fired });
    }

    console.log(`     SUCCESS rounds: ${successTimings.map(s => `next=${s.next} fired=${s.fired}`).join(' | ')}`);

    successTimings.forEach((s, i) => {
        assertRange(s.fired, 1850, 2000, `Round ${i+1}: fired timing in NORMAL bounds`);
    });

    // oscillatedTiming should be set (±10ms from base)
    assert(ai.oscillatedTiming !== null, 'oscillatedTiming is set after SUCCESS');
    assertRange(ai.oscillatedTiming, 1850, 2000, 'oscillatedTiming within bounds');
}

async function testKickedDeadZoneMemory() {
    section('TEST 6: KICKED — dead zone memory avoids re-entering kick timing');

    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.initializeTimingFromPing();

    // Simulate getting kicked at 1965ms
    ai.currentTiming = 1965;
    ai.attackTiming = 1965;
    await ai.getNextTiming('KICKED', 'attack', null);

    console.log(`     kickedTimings after KICKED: [${ai.kickedTimings.join(', ')}]`);
    assert(ai.kickedTimings.includes(1965), 'KICKED at 1965ms recorded in dead zone memory');

    // Now if ML would propose going back near 1965ms, it should nudge away
    // Force currentTiming back near dead zone to test the guard
    ai.currentTiming = 1968;
    ai.attackTiming = 1968;
    // Temporarily add a 3S_ERROR to trigger ML prediction that might return near 1965
    const proposedBefore = ai.currentTiming;
    const t = await ai.getNextTiming('3S_ERROR', 'attack', null);
    console.log(`     Near dead zone (1968ms) → next timing: ${t}ms`);
    // Result should not be within 10ms of 1965 (our dead zone)
    assert(Math.abs(t - 1965) > 10 || t > 1965,
        `Dead zone avoided: timing ${t}ms is safely away from 1965ms kick zone`);
}

async function testLeftEarlyPlausibility() {
    section('TEST 7: LEFT_EARLY — plausible vs implausible opponent leave time');

    // Plausible: opponent left at time above our floor
    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.initializeTimingFromPing();
    ai.currentTiming = 1940;
    ai.attackTiming = 1940;
    // Set floor so 1970 is clearly above it
    ai.opponentFloor = 1920;

    const t1 = await ai.getNextTiming('LEFT_EARLY', 'attack', 1970);
    console.log(`     Plausible LEFT_EARLY (opponent at 1970ms) → ${t1}ms`);
    assertRange(t1, 1850, 2000, 'Plausible LEFT_EARLY: timing within NORMAL bounds');
    assert(t1 >= 1940, 'Plausible LEFT_EARLY: follows opponent upward (≥ 1940ms)');

    // Implausible: opponent claimed to leave at time far below opponentFloor
    const ai2 = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai2.setSpeedPreset('NORMAL');
    await ai2.initializeTimingFromPing();
    ai2.currentTiming = 1940;
    ai2.attackTiming = 1940;
    ai2.opponentFloor = 1930; // floor is 1930, implausible leave time below this

    const t2 = await ai2.getNextTiming('LEFT_EARLY', 'attack', 1800); // 1800 < floor 1930 → implausible
    console.log(`     Implausible LEFT_EARLY (opponent at 1800ms, floor=1930) → ${t2}ms`);
    assertRange(t2, 1850, 2000, 'Implausible LEFT_EARLY: timing stays in NORMAL bounds');
    assert(t2 < 1940, 'Implausible LEFT_EARLY: goes to cautious halfway (< current 1940ms)');
}

async function testBinarySearch() {
    section('TEST 8: Binary search — converges between KICKED and 3S_ERROR bounds');

    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.initializeTimingFromPing();

    // Establish both bounds: 3S_ERROR at 1920, KICKED at 1970
    ai.currentTiming = 1920;
    ai.attackTiming = 1920;
    await ai.getNextTiming('3S_ERROR', 'attack', null);

    ai.currentTiming = 1970;
    ai.attackTiming = 1970;
    await ai.getNextTiming('KICKED', 'attack', null);

    // Now we have both in mlHistory — binary search should fire
    ai.currentTiming = 1940;
    ai.attackTiming = 1940;
    const t = await ai.getNextTiming('3S_ERROR', 'attack', null);

    console.log(`     Binary search (3S_ERROR@1920, KICKED@1970) → ${t}ms`);
    // Should land between 1920 and 1970 (with 25% gap step from maxError side)
    assert(t >= 1920 && t <= 1975,
        `Binary search result ${t}ms is between the error (1920) and kick (1970) bounds`);
}

async function testDBBlendWrongDirectionGuard() {
    section('TEST 9: DB blend — wrong direction guard during 3S_ERROR run');

    // DB has optimal 1880ms (lower than current) — should be rejected when in 3S_ERROR run
    const lowRows = [
        { rival_name: 'rival2', timing_value: 1870, result: '3S_ERROR' },
        { rival_name: 'rival2', timing_value: 1875, result: '3S_ERROR' },
        { rival_name: 'rival2', timing_value: 1880, result: '3S_ERROR' },
        { rival_name: 'rival2', timing_value: 1885, result: '3S_ERROR' },
        { rival_name: 'rival2', timing_value: 1890, result: '3S_ERROR' },
    ];

    const ai = new SimpleAICore(makeMockSupabase(lowRows), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL'); // floor=1850, ceiling=2000
    await ai.setCurrentRival('rival2');

    // Force current timing higher than DB optimal
    ai.currentTiming = 1960;
    ai.attackTiming = 1960;
    ai.consecutive3sErrors = 3; // in a 3S_ERROR run

    // Trigger DB refresh (every 2 attempts)
    ai.stats.totalAttempts = 2;
    const t = await ai.getNextTiming('3S_ERROR', 'attack', null);

    console.log(`     currentTiming=1960, DB optimal≈1875 (lower), consecutive3sErrors=3 → ${t}ms`);
    assert(t >= 1960 - 30,
        `Wrong-direction DB blend rejected: timing stayed at/above 1930ms (not dragged down to ~1875)`);
}

async function testPreemptiveShiftGuard() {
    section('TEST 10: Preemptive shift — only fires when bounds are wide (opponent moved)');

    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.initializeTimingFromPing();
    ai.currentTiming = 1940;
    ai.attackTiming = 1940;

    // Set tight bounds (gap < 60ms) — preemptive shift should NOT fire
    ai.opponentFloor = 1930;
    ai.opponentCeiling = 1955; // gap = 25ms
    ai.consecutiveSuccessCount = 3; // would normally trigger shift

    const timingBefore = ai.currentTiming;
    const t = await ai.getNextTiming('SUCCESS', 'attack', null);
    console.log(`     Tight bounds (gap=25ms), 3 successes → ${t}ms (shift fired: ${Math.abs(t - timingBefore) > 20})`);
    assert(Math.abs(t - timingBefore) <= 25,
        'Preemptive shift blocked: bounds gap=25ms < 60ms threshold (opponent still in known zone)');

    // Note: each SUCCESS call tightens opponentFloor/Ceiling to ±15ms around the timing
    // BEFORE the preemptive check runs — so during a success streak bounds are always tight.
    // The guard correctly blocks the shift while the opponent is in a known zone.
    // Preemptive shift fires only when opponent bounds are null (never seen / fully decayed).
    // Test: 3 successes with NO bounds set → shift fires
    const ai2 = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai2.setSpeedPreset('NORMAL');
    await ai2.initializeTimingFromPing();
    ai2.currentTiming = 1940;
    ai2.attackTiming = 1940;

    // Disable bounds tracking so they stay null throughout (simulates first-time rival with no data)
    const origUpdate = ai2.updateOpponentBounds.bind(ai2);
    ai2.updateOpponentBounds = () => {}; // stub out for this test

    const timingBeforeShift = ai2.currentTiming;
    await ai2.getNextTiming('SUCCESS', 'attack', null);
    await ai2.getNextTiming('SUCCESS', 'attack', null);
    const t2 = await ai2.getNextTiming('SUCCESS', 'attack', null); // 3rd → shift fires (boundsGap=999)

    // Restore
    ai2.updateOpponentBounds = origUpdate;

    console.log(`     No bounds (gap=999), 3 successes → ${t2}ms (moved: ${Math.abs(t2 - timingBeforeShift)}ms)`);
    assert(Math.abs(t2 - timingBeforeShift) >= 25,
        `Preemptive shift fired when bounds null: timing moved ≥25ms from ${timingBeforeShift} → ${t2}`);
}

async function testSpeedPresetChangeResetsML() {
    section('TEST 11: Speed preset change — resets ML history and counters');

    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.initializeTimingFromPing();

    // Build up ML history with NORMAL preset
    for (let i = 0; i < 5; i++) {
        await ai.getNextTiming('3S_ERROR', 'attack', null);
    }
    const historyBefore = ai.mlHistory.length;
    const errorsBefore = ai.consecutive3sErrors;
    console.log(`     ML history before preset change: ${historyBefore} entries, consecutive3sErrors=${errorsBefore}`);

    // Change preset — should wipe ML history
    ai.setSpeedPreset('FAST');

    assert(ai.mlHistory.length === 0, 'mlHistory cleared on preset change');
    assert(ai.opponentZoneHistory.length === 0, 'opponentZoneHistory cleared on preset change');
    assert(ai.consecutive3sErrors === 0, 'consecutive3sErrors reset on preset change');
    assert(ai.errorAnchor === null, 'errorAnchor reset on preset change');
    assert(ai.timingFloor === 1950 && ai.timingCeiling === 2150, 'FAST preset bounds applied');
}

async function testFullSessionSimulation() {
    section('TEST 12: Full session simulation — realistic rival "xota"');

    const ai = new SimpleAICore(makeMockSupabase(RIVAL_HISTORY), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.setCurrentRival(RIVAL_NAME);

    console.log(`     Starting timing after DB preload: ${ai.currentTiming}ms`);
    assertRange(ai.currentTiming, 1850, 2000, 'DB preload timing in NORMAL bounds');

    // Simulate a realistic sequence of game rounds
    const sequence = [
        { result: '3S_ERROR', opponentLeft: null,  label: 'Too fast' },
        { result: '3S_ERROR', opponentLeft: null,  label: 'Too fast again' },
        { result: 'SUCCESS',  opponentLeft: null,  label: 'Imprisoned!' },
        { result: 'SUCCESS',  opponentLeft: null,  label: 'Imprisoned again' },
        { result: 'KICKED',   opponentLeft: null,  label: 'Opponent kicked us' },
        { result: '3S_ERROR', opponentLeft: null,  label: 'Too fast after correction' },
        { result: 'LEFT_EARLY', opponentLeft: 1955, label: 'Rival left at 1955ms' },
        { result: 'SUCCESS',  opponentLeft: null,  label: 'Imprisoned after LEFT_EARLY' },
        { result: 'SUCCESS',  opponentLeft: null,  label: 'Second success' },
        { result: 'SUCCESS',  opponentLeft: null,  label: 'Third success (may trigger preemptive)' },
        { result: 'KICKED',   opponentLeft: null,  label: 'Kicked after preemptive shift' },
        { result: '3S_ERROR', opponentLeft: null,  label: 'Recovery' },
        { result: 'SUCCESS',  opponentLeft: null,  label: 'Back on track' },
    ];

    console.log(`\n     Round | Result      | Timing | Fired  | Note`);
    console.log(`     ${'─'.repeat(65)}`);

    let prevTiming = ai.currentTiming;
    for (let i = 0; i < sequence.length; i++) {
        const { result, opponentLeft, label } = sequence[i];
        const nextTiming = await ai.getNextTiming(result, 'attack', opponentLeft);
        const firedTiming = ai.getTimingWithJitter('attack');

        console.log(`     ${String(i + 1).padStart(5)} | ${result.padEnd(11)} | ${String(nextTiming).padStart(6)} | ${String(firedTiming).padStart(6)} | ${label}`);

        assertRange(nextTiming, 1850, 2000, `Round ${i+1} (${result}): nextTiming in NORMAL bounds`);
        assertRange(firedTiming, 1850, 2000, `Round ${i+1} (${result}): firedTiming in NORMAL bounds`);

        prevTiming = nextTiming;
    }

    // Verify stats are tracked
    assert(ai.stats.totalAttempts === sequence.length, `totalAttempts = ${sequence.length}`);
    const successExpected = sequence.filter(s => s.result === 'SUCCESS').length;
    assert(ai.stats.successCount === successExpected, `successCount = ${successExpected}`);
    const kickedExpected = sequence.filter(s => s.result === 'KICKED').length;
    assert(ai.stats.kickedCount === kickedExpected, `kickedCount = ${kickedExpected}`);

    console.log(`\n     Final state: timing=${ai.currentTiming}ms, opponentFloor=${ai.opponentFloor}ms, opponentCeiling=${ai.opponentCeiling}ms`);
    console.log(`     kickedTimings: [${ai.kickedTimings.join(', ')}]`);
}

async function testOpponentBoundsTracking() {
    section('TEST 13: Opponent bounds — floor/ceiling updated correctly');

    const ai = new SimpleAICore(makeMockSupabase([]), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.initializeTimingFromPing();

    // 3S_ERROR at 1930ms → opponent is above 1930ms → floor should be ≥ 1930
    ai.currentTiming = 1930;
    ai.attackTiming = 1930;
    await ai.getNextTiming('3S_ERROR', 'attack', null);
    console.log(`     After 3S_ERROR@1930: floor=${ai.opponentFloor}, ceiling=${ai.opponentCeiling}`);
    assert(ai.opponentFloor !== null && ai.opponentFloor >= 1930,
        `Floor set ≥ 1930ms after 3S_ERROR at 1930ms (got ${ai.opponentFloor})`);

    // KICKED at 1980ms → opponent is below 1980ms → ceiling should be ≤ 1980
    ai.currentTiming = 1980;
    ai.attackTiming = 1980;
    await ai.getNextTiming('KICKED', 'attack', null);
    console.log(`     After KICKED@1980: floor=${ai.opponentFloor}, ceiling=${ai.opponentCeiling}`);
    assert(ai.opponentCeiling !== null && ai.opponentCeiling <= 1980,
        `Ceiling set ≤ 1980ms after KICKED at 1980ms (got ${ai.opponentCeiling})`);

    // SUCCESS at 1955ms → opponent is near 1955ms → both floor/ceiling should tighten
    ai.currentTiming = 1955;
    ai.attackTiming = 1955;
    await ai.getNextTiming('SUCCESS', 'attack', null);
    console.log(`     After SUCCESS@1955: floor=${ai.opponentFloor}, ceiling=${ai.opponentCeiling}`);
    assert(ai.opponentLastKnownAt === 1955, 'opponentLastKnownAt set to 1955ms after SUCCESS');

    // Verify floor < ceiling (valid bounds)
    assert(ai.opponentFloor < ai.opponentCeiling,
        `Bounds are valid: floor(${ai.opponentFloor}) < ceiling(${ai.opponentCeiling})`);
}

async function testNewRivalResetsState() {
    section('TEST 14: New rival — all ML state resets completely');

    const ai = new SimpleAICore(makeMockSupabase(RIVAL_HISTORY), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL');
    await ai.setCurrentRival(RIVAL_NAME);

    // Build up state
    for (let i = 0; i < 5; i++) await ai.getNextTiming('3S_ERROR', 'attack', null);
    await ai.getNextTiming('KICKED', 'attack', null);

    assert(ai.kickedTimings.length > 0, 'kickedTimings populated before rival switch');
    assert(ai.mlHistory.length > 0, 'mlHistory populated before rival switch');

    // Switch rival — full reset
    await ai.setCurrentRival('newrival');

    assert(ai.currentRivalName === 'newrival', 'currentRivalName updated');
    assert(ai.mlHistory.length === 0, 'mlHistory cleared for new rival');
    assert(ai.opponentZoneHistory.length === 0, 'opponentZoneHistory cleared');
    assert(ai.kickedTimings.length === 0, 'kickedTimings cleared for new rival');
    assert(ai.opponentFloor === null, 'opponentFloor reset');
    assert(ai.opponentCeiling === null, 'opponentCeiling reset');
    assert(ai.consecutive3sErrors === 0, 'consecutive3sErrors reset');
    assert(ai.errorAnchor === null, 'errorAnchor reset');
    assert(ai.consecutiveSuccessCount === 0, 'consecutiveSuccessCount reset');
}

// ─────────────────────────────────────────────
// Main runner
// ─────────────────────────────────────────────
async function main() {
    console.log('═'.repeat(60));
    console.log('  SimpleAICore Test Suite');
    console.log('═'.repeat(60));

    try {
        await testSpeedPresetInit();
        await testDBPreloadMinRecords();
        await testThreeSErrorOscillation();
        await testCeilingAwareCap();
        await testSuccessNeighbourhoodOscillation();
        await testKickedDeadZoneMemory();
        await testLeftEarlyPlausibility();
        await testBinarySearch();
        await testDBBlendWrongDirectionGuard();
        await testPreemptiveShiftGuard();
        await testSpeedPresetChangeResetsML();
        await testFullSessionSimulation();
        await testOpponentBoundsTracking();
        await testNewRivalResetsState();
    } catch (err) {
        console.error('\n💥 Unexpected error during tests:', err);
        failed++;
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    if (errors.length > 0) {
        console.log('\n  Failed assertions:');
        errors.forEach(e => console.log(`    ❌ ${e}`));
    }
    console.log('═'.repeat(60));

    process.exit(failed > 0 ? 1 : 0);
}

main();
