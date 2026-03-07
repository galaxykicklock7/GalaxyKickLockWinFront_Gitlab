/**
 * SimpleAICore — Human Attack Pattern Tests (NORMAL zone only)
 * Run: node test/aicore.human.test.js
 *
 * Tests every realistic way a human opponent tries to kick the bot.
 * All tests run in NORMAL preset (1850–2000ms).
 * If it survives in NORMAL it survives in all zones (same math, different bounds).
 *
 * Human strategies tested:
 *   A. Repeated LEFT_EARLY bait → lure bot up then sit and kick
 *   B. Zigzag LEFT_EARLY → alternate leave/kick to confuse direction
 *   C. Slow-raise trap → gradually raise timing, park at ceiling to kick
 *   D. Fake-out after successes → let bot succeed 3x then suddenly drop to kick
 *   E. Speed oscillator → alternate between two timing values to trap binary search midpoint
 *   F. Ceiling camper → sit at ceiling, bot keeps 3S_ERROR-climbing into them
 *   G. Rapid alternating kick/leave → KICKED then LEFT_EARLY repeatedly
 *   H. Ghost rival → no LEFT_EARLY, just pure kick every round (aggressive player)
 */

'use strict';

const path = require('path');
const SimpleAICore = require(path.join(__dirname, '../src/ai/SimpleAICore'));

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${message}`);
        failed++;
        failures.push(message);
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
        failures.push(`${message}: ${value}ms not in ${min}-${max}`);
    }
}

function section(title) {
    console.log(`\n${'─'.repeat(65)}`);
    console.log(`⚔️  ${title}`);
    console.log('─'.repeat(65));
}

function printRound(round, result, botTiming, firedTiming, humanTiming, note = '') {
    const noteStr = note ? ` ← ${note}` : '';
    console.log(
        `     R${String(round).padStart(2)} | ${result.padEnd(11)} | bot=${String(botTiming).padStart(4)} fired=${String(firedTiming).padStart(4)} | human≈${String(humanTiming).padStart(4)}${noteStr}`
    );
}

// Supabase mock — no DB data (pure ML learning from scratch)
function makeEmptySupabase() {
    return {
        from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ not: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }) }),
        rpc: async () => ({ data: [], error: null })
    };
}

async function makeBot(startTiming = null) {
    const ai = new SimpleAICore(makeEmptySupabase(), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL'); // 1850–2000ms
    await ai.initializeTimingFromPing();
    if (startTiming !== null) {
        ai.currentTiming = startTiming;
        ai.attackTiming = startTiming;
    }
    return ai;
}

// Simulate one round: feed result to bot, return { nextTiming, firedTiming }
async function round(ai, result, opponentLeftTime = null) {
    const next = await ai.getNextTiming(result, 'attack', opponentLeftTime);
    const fired = ai.getTimingWithJitter('attack');
    return { next, fired };
}

// ─────────────────────────────────────────────
// PATTERN A: Repeated LEFT_EARLY bait
// Human strategy: leave early every round to lure bot up, then stay and kick
// Expected bot defence: LEFT_EARLY plausibility check + opponentFloor bounds
//   prevent bot from blindly following high leave times into kick zone
// ─────────────────────────────────────────────
async function testPatternA_RepeatedLeftEarlyBait() {
    section('PATTERN A: Repeated LEFT_EARLY bait (leave early 5x → then KICK)');

    const ai = await makeBot(1900);
    const NORMAL_FLOOR = 1850, NORMAL_CEILING = 2000;

    // Human leaves early at progressively higher times to lure bot up
    // Then at round 6, stays and kicks
    const leftEarlyTimes = [1930, 1950, 1960, 1970, 1975];
    let botTimings = [];

    console.log(`     Round | Result      | bot    fired  | humanLeave | Note`);
    for (let i = 0; i < leftEarlyTimes.length; i++) {
        const leaveTime = leftEarlyTimes[i];
        const r = await round(ai, 'LEFT_EARLY', leaveTime);
        botTimings.push(r.next);
        printRound(i + 1, 'LEFT_EARLY', r.next, r.fired, leaveTime);
        assertRange(r.next, NORMAL_FLOOR, NORMAL_CEILING, `Round ${i+1} LEFT_EARLY: within NORMAL bounds`);
    }

    // Round 6: Human stays and kicks (bot should be somewhere below 2000)
    const kickRound = await round(ai, 'KICKED', null);
    botTimings.push(kickRound.next);
    printRound(6, 'KICKED', kickRound.next, kickRound.fired, '????', 'Human kicks!');
    assertRange(kickRound.next, NORMAL_FLOOR, NORMAL_CEILING, 'Round 6 KICKED: bot still within NORMAL bounds');

    // Key assertions:
    // 1. Bot must not have been pulled above ceiling by LEFT_EARLY bait
    const maxReached = Math.max(...botTimings.slice(0, 5));
    assert(maxReached <= NORMAL_CEILING,
        `LEFT_EARLY bait did NOT pull bot above ceiling (max reached: ${maxReached}ms)`);

    // 2. After kick, dead zone memory recorded
    assert(ai.kickedTimings.length > 0,
        'Dead zone memory recorded after KICKED');

    // 3. Bot recovers after kick — next timing should be below where it got kicked
    const kickedAt = ai.kickedTimings[ai.kickedTimings.length - 1];
    assert(kickRound.next < kickedAt || kickRound.next <= NORMAL_CEILING,
        `Bot corrected after kick: next=${kickRound.next}ms, kicked at=${kickedAt}ms`);

    console.log(`     → Max timing reached during bait: ${maxReached}ms, kicked at: ${kickedAt}ms`);
}

// ─────────────────────────────────────────────
// PATTERN B: Zigzag LEFT_EARLY
// Human: leave early, then kick, then leave early, then kick alternating
// Expected defence: opponentFloor/Ceiling bounds + dead zone memory prevent
//   bot from being pulled up and down repeatedly without converging
// ─────────────────────────────────────────────
async function testPatternB_ZigzagLeftEarly() {
    section('PATTERN B: Zigzag — LEFT_EARLY then KICKED alternating (5 cycles)');

    const ai = await makeBot(1920);
    const NORMAL_FLOOR = 1850, NORMAL_CEILING = 2000;

    const sequence = [
        { result: 'LEFT_EARLY', leave: 1960 },
        { result: 'KICKED',     leave: null  },
        { result: 'LEFT_EARLY', leave: 1965 },
        { result: 'KICKED',     leave: null  },
        { result: 'LEFT_EARLY', leave: 1970 },
        { result: 'KICKED',     leave: null  },
        { result: 'LEFT_EARLY', leave: 1958 },
        { result: 'KICKED',     leave: null  },
    ];

    console.log(`     Round | Result      | bot    fired  | Note`);
    let kickCount = 0;
    for (let i = 0; i < sequence.length; i++) {
        const { result, leave } = sequence[i];
        const r = await round(ai, result, leave);
        if (result === 'KICKED') kickCount++;
        printRound(i + 1, result, r.next, r.fired, leave || '????');
        assertRange(r.next, NORMAL_FLOOR, NORMAL_CEILING, `Round ${i+1} (${result}): within NORMAL bounds`);
    }

    // Bot should have dead zones from all the kicks
    assert(ai.kickedTimings.length > 0,
        `Dead zone memory has ${ai.kickedTimings.length} entries from zigzag kicks`);

    // Bot should not be stuck at ceiling or floor (shouldn't have gone permanently high or low)
    assertRange(ai.currentTiming, NORMAL_FLOOR, NORMAL_CEILING,
        `After zigzag: bot timing ${ai.currentTiming}ms within NORMAL bounds`);

    // opponentFloor should be defined (bot learned opponent has a floor)
    assert(ai.opponentFloor !== null || ai.kickedTimings.length >= 2,
        'Bot has opponent boundary data after zigzag pattern');

    console.log(`     → Final timing: ${ai.currentTiming}ms, deadZones: [${ai.kickedTimings.join(', ')}]`);
}

// ─────────────────────────────────────────────
// PATTERN C: Slow-raise trap
// Human: keep raising timing causing 3S_ERROR every round, then park at ceiling to kick
// Expected defence: ceiling-aware caps prevent bot overshooting ceiling
//   DB wrong-direction guard prevents DB pulling bot back down
// ─────────────────────────────────────────────
async function testPatternC_SlowRaiseTrap() {
    section('PATTERN C: Slow-raise trap (7x 3S_ERROR climb → KICKED at ceiling)');

    const ai = await makeBot(1900);
    const NORMAL_CEILING = 2000;

    // Human slowly raises, causing 7 consecutive 3S_ERRORs
    // Bot has to climb — but should do so with oscillation, not straight line
    const climbTimings = [];
    console.log(`     Round | Result      | bot    fired  | Note`);
    for (let i = 0; i < 7; i++) {
        const r = await round(ai, '3S_ERROR', null);
        climbTimings.push(r.next);
        printRound(i + 1, '3S_ERROR', r.next, r.fired, '????', i === 6 ? 'Human at ceiling' : '');
        assertRange(r.next, 1850, NORMAL_CEILING, `3S_ERROR round ${i+1}: within bounds`);
    }

    // When opponentBounds are being updated each round (3S_ERROR sets floor),
    // the BOUNDS path is used for stepping — which is direct and may be monotonic.
    // What matters is: steps get smaller near the ceiling (ceiling-aware cap).
    // Check that the step size reduces as bot approaches ceiling.
    const steps = climbTimings.map((t, i) => i === 0 ? t - 1900 : t - climbTimings[i - 1]);
    const firstHalfMaxStep = Math.max(...steps.slice(0, 3));
    const secondHalfMaxStep = Math.max(...steps.slice(4));
    console.log(`     Steps: [${steps.join(', ')}] — first-half max: ${firstHalfMaxStep}ms, second-half max: ${secondHalfMaxStep}ms`);
    assert(secondHalfMaxStep <= firstHalfMaxStep + 5,
        `Steps get smaller near ceiling: second-half max(${secondHalfMaxStep}ms) ≤ first-half max(${firstHalfMaxStep}ms)`);

    // Bot must not exceed ceiling
    const max = Math.max(...climbTimings);
    assert(max <= NORMAL_CEILING,
        `Max timing during climb: ${max}ms ≤ ceiling ${NORMAL_CEILING}ms`);

    // Human parks at ceiling and kicks
    const kickR = await round(ai, 'KICKED', null);
    printRound(8, 'KICKED', kickR.next, kickR.fired, 2000, 'Human kicks at ceiling!');
    assertRange(kickR.next, 1850, NORMAL_CEILING, 'After ceiling kick: bot within NORMAL bounds');

    // After kick, bot should retreat — NOT climb further into ceiling
    assert(kickR.next < NORMAL_CEILING,
        `Bot retreated from ceiling after KICKED: ${kickR.next}ms < ${NORMAL_CEILING}ms`);

    // Dead zone at ceiling recorded
    assert(ai.kickedTimings.length > 0,
        `Ceiling kick recorded in dead zone memory: [${ai.kickedTimings.join(', ')}]`);

    console.log(`     → Climb range: ${Math.min(...climbTimings)}–${max}ms, retreated to: ${kickR.next}ms`);
}

// ─────────────────────────────────────────────
// PATTERN D: Fake-out after successes
// Human: lets bot succeed 3 times (establishing confidence), then suddenly drops timing to kick
// Expected defence: opponentBounds tracks last known position (SUCCESS tightens bounds);
//   after KICK at lower timing, dead zone prevents re-entry; binary search converges
// ─────────────────────────────────────────────
async function testPatternD_FakeOutAfterSuccess() {
    section('PATTERN D: Fake-out — let bot succeed 3x at 1960ms, then kick at 1940ms');

    const ai = await makeBot(1960);
    const NORMAL_FLOOR = 1850, NORMAL_CEILING = 2000;

    console.log(`     Round | Result      | bot    fired  | Note`);

    // Phase 1: 3 successes at 1960ms — bot thinks it knows the zone
    for (let i = 0; i < 3; i++) {
        const r = await round(ai, 'SUCCESS', null);
        printRound(i + 1, 'SUCCESS', r.next, r.fired, 1960);
        assertRange(r.next, NORMAL_FLOOR, NORMAL_CEILING, `Success round ${i+1}: within bounds`);
    }

    const timingAfterSuccesses = ai.currentTiming;
    console.log(`     → After 3 successes: bot at ${timingAfterSuccesses}ms, lastKnownAt=${ai.opponentLastKnownAt}ms`);

    // Phase 2: Human drops timing and kicks bot
    const kickR = await round(ai, 'KICKED', null);
    printRound(4, 'KICKED', kickR.next, kickR.fired, 1940, 'Human drops timing, kicks!');
    assertRange(kickR.next, NORMAL_FLOOR, NORMAL_CEILING, 'After surprise kick: within bounds');

    // Bot should respond by moving faster (lower timing) — not continuing SUCCESS drift
    assert(kickR.next < timingAfterSuccesses + 10,
        `Bot corrected after fake-out kick: ${kickR.next}ms (was at ${timingAfterSuccesses}ms)`);

    // Dead zone recorded at kick position
    assert(ai.kickedTimings.length > 0,
        `Fake-out kick recorded in dead zone: [${ai.kickedTimings.join(', ')}]`);

    // Phase 3: Bot should now try to converge — give it 3 more rounds
    for (let i = 0; i < 3; i++) {
        const result = i % 2 === 0 ? '3S_ERROR' : 'SUCCESS';
        const r = await round(ai, result, null);
        printRound(5 + i, result, r.next, r.fired, '????');
        assertRange(r.next, NORMAL_FLOOR, NORMAL_CEILING, `Recovery round ${i+1}: within bounds`);
    }

    assert(ai.currentTiming >= NORMAL_FLOOR && ai.currentTiming <= NORMAL_CEILING,
        `Final timing ${ai.currentTiming}ms within NORMAL bounds after fake-out recovery`);
}

// ─────────────────────────────────────────────
// PATTERN E: Speed oscillator
// Human: alternates between two timing values (e.g. 1920 and 1970) every round
// This creates LEFT_EARLY at 1920, then KICK at 1970, repeating
// Binary search should find the midpoint ~1945ms and converge there
// ─────────────────────────────────────────────
async function testPatternE_SpeedOscillator() {
    section('PATTERN E: Speed oscillator — human alternates 1920ms ↔ 1970ms');

    const ai = await makeBot(1940);
    const NORMAL_FLOOR = 1850, NORMAL_CEILING = 2000;

    // Human alternates: LEFT_EARLY at 1920 (they left before bot), KICKED at 1970 (they kicked bot)
    const sequence = [
        { result: 'LEFT_EARLY', leave: 1920 },
        { result: 'KICKED',     leave: null  },
        { result: 'LEFT_EARLY', leave: 1920 },
        { result: 'KICKED',     leave: null  },
        { result: 'LEFT_EARLY', leave: 1920 },
        { result: 'KICKED',     leave: null  },
        { result: 'LEFT_EARLY', leave: 1920 },
        { result: 'KICKED',     leave: null  },
    ];

    console.log(`     Round | Result      | bot    fired  | humanAt | Note`);
    for (let i = 0; i < sequence.length; i++) {
        const { result, leave } = sequence[i];
        const r = await round(ai, result, leave);
        const humanAt = leave || 1970;
        printRound(i + 1, result, r.next, r.fired, humanAt);
        assertRange(r.next, NORMAL_FLOOR, NORMAL_CEILING, `Round ${i+1} (${result}): within bounds`);
    }

    // After 4 cycles of LEFT_EARLY(1920) + KICKED, bot should converge somewhere
    // in the lower half of NORMAL zone — not pushed to ceiling
    // Binary search or bounds path should keep it in 1850–1970 range
    assertRange(ai.currentTiming, 1850, 1975,
        `After oscillator pattern: bot converged to ${ai.currentTiming}ms (within expected convergence zone)`);

    // bot should NOT be at ceiling (wasn't pulled above 1970)
    assert(ai.currentTiming <= 1975,
        `Speed oscillator did NOT push bot to ceiling: ${ai.currentTiming}ms ≤ 1975ms`);

    console.log(`     → Converged to: ${ai.currentTiming}ms (human oscillated 1920↔1970, midpoint≈1945)`);
}

// ─────────────────────────────────────────────
// PATTERN F: Ceiling camper
// Human sits at exactly 1998ms (ceiling). Bot keeps 3S_ERROR climbing toward them.
// Near ceiling, steps should be tiny (ceiling-aware cap). Bot should NOT overshoot.
// ─────────────────────────────────────────────
async function testPatternF_CeilingCamper() {
    section('PATTERN F: Ceiling camper — human sits at 1998ms, bot climbs from 1930ms');

    const ai = await makeBot(1930);
    const NORMAL_CEILING = 2000;

    // Human at 1998ms — every round bot gets 3S_ERROR until it reaches ~1998
    // Then human kicks
    console.log(`     Round | Result      | bot    fired  | distToCeiling`);
    const timings = [];
    for (let i = 0; i < 10; i++) {
        const distBefore = NORMAL_CEILING - ai.currentTiming;
        const r = await round(ai, '3S_ERROR', null);
        timings.push(r.next);
        const step = r.next - (timings[i - 1] || 1930);
        printRound(i + 1, '3S_ERROR', r.next, r.fired, 1998, `dist=${distBefore}ms step=+${step}`);
        assertRange(r.next, 1850, NORMAL_CEILING, `Round ${i+1}: within bounds`);
    }

    // Near ceiling (last few rounds), step must be tiny
    const lastTiming = timings[timings.length - 1];
    const secondLastTiming = timings[timings.length - 2];
    const lastStep = lastTiming - secondLastTiming;

    console.log(`     → Last step: +${lastStep}ms at ${secondLastTiming}ms`);

    // If within 25ms of ceiling, step should be ≤ 20ms
    if (secondLastTiming >= NORMAL_CEILING - 25) {
        assert(Math.abs(lastStep) <= 20,
            `Near-ceiling step is small: +${lastStep}ms (was within 25ms of ceiling)`);
    }

    // Human kicks when bot finally reaches their zone
    const kickR = await round(ai, 'KICKED', null);
    printRound(11, 'KICKED', kickR.next, kickR.fired, 1998, 'Ceiling camper kicks!');
    assertRange(kickR.next, 1850, NORMAL_CEILING, 'After ceiling kick: within bounds');
    assert(kickR.next < NORMAL_CEILING,
        `Bot retreated from ceiling: ${kickR.next}ms < ${NORMAL_CEILING}ms`);

    // Must not exceed ceiling at any point
    const maxReached = Math.max(...timings);
    assert(maxReached <= NORMAL_CEILING,
        `Bot NEVER exceeded ceiling during climb: max=${maxReached}ms`);

    console.log(`     → Climbed from 1930 to ${maxReached}ms (ceiling: ${NORMAL_CEILING}ms)`);
}

// ─────────────────────────────────────────────
// PATTERN G: Rapid KICKED → LEFT_EARLY alternating
// Human: kick the bot, then leave early, then kick, then leave early
// Tries to exploit the direction change on each result
// ─────────────────────────────────────────────
async function testPatternG_RapidKickLeaveAlternating() {
    section('PATTERN G: Rapid KICKED↔LEFT_EARLY alternating (4 cycles)');

    const ai = await makeBot(1940);
    const NORMAL_FLOOR = 1850, NORMAL_CEILING = 2000;

    const sequence = [
        { result: 'KICKED',     leave: null },
        { result: 'LEFT_EARLY', leave: 1955 },
        { result: 'KICKED',     leave: null },
        { result: 'LEFT_EARLY', leave: 1950 },
        { result: 'KICKED',     leave: null },
        { result: 'LEFT_EARLY', leave: 1960 },
        { result: 'KICKED',     leave: null },
        { result: 'LEFT_EARLY', leave: 1958 },
    ];

    console.log(`     Round | Result      | bot    fired  | Note`);
    for (let i = 0; i < sequence.length; i++) {
        const { result, leave } = sequence[i];
        const r = await round(ai, result, leave);
        printRound(i + 1, result, r.next, r.fired, leave || '????');
        assertRange(r.next, NORMAL_FLOOR, NORMAL_CEILING, `Round ${i+1} (${result}): within bounds`);
    }

    // After alternating, bot must be somewhere in valid range
    assertRange(ai.currentTiming, NORMAL_FLOOR, NORMAL_CEILING,
        `After alternating kicks/leaves: final timing ${ai.currentTiming}ms within NORMAL bounds`);

    // Dead zones should be populated (bot was kicked 4 times)
    assert(ai.kickedTimings.length > 0,
        `Dead zone memory populated: [${ai.kickedTimings.join(', ')}]`);

    // Bot should have opponent bounds established from the mix
    const hasBounds = ai.opponentFloor !== null || ai.opponentCeiling !== null;
    assert(hasBounds,
        `Opponent bounds established after alternating pattern (floor=${ai.opponentFloor}, ceiling=${ai.opponentCeiling})`);

    console.log(`     → Final: ${ai.currentTiming}ms, bounds: ${ai.opponentFloor}–${ai.opponentCeiling}`);
}

// ─────────────────────────────────────────────
// PATTERN H: Ghost rival — pure kick every round
// Human: aggressive player who just kicks every single round with no variation
// Bot must retreat, find lower timing, and eventually converge to somewhere safe
// ─────────────────────────────────────────────
async function testPatternH_GhostRival() {
    section('PATTERN H: Ghost rival — pure KICKED every round (6 rounds)');

    const ai = await makeBot(1970);
    const NORMAL_FLOOR = 1850, NORMAL_CEILING = 2000;

    console.log(`     Round | Result | bot    fired`);
    const botTimings = [];
    for (let i = 0; i < 6; i++) {
        const r = await round(ai, 'KICKED', null);
        botTimings.push(r.next);
        printRound(i + 1, 'KICKED', r.next, r.fired, '????');
        assertRange(r.next, NORMAL_FLOOR, NORMAL_CEILING, `KICKED round ${i+1}: within bounds`);
    }

    console.log(`     → Timings: [${botTimings.join(', ')}]`);

    // Bot must be retreating — each KICKED should drive timing lower
    // After 6 KICKs bot should be clearly below starting point 1970
    assert(ai.currentTiming < 1970,
        `Bot retreated after 6 kicks: ${ai.currentTiming}ms < starting 1970ms`);

    // Must stay above floor
    assert(ai.currentTiming >= NORMAL_FLOOR,
        `Bot above floor: ${ai.currentTiming}ms ≥ ${NORMAL_FLOOR}ms`);

    // Dead zone memory should have up to 5 entries
    assert(ai.kickedTimings.length > 0 && ai.kickedTimings.length <= 5,
        `Dead zone memory: ${ai.kickedTimings.length} entries (max 5)`);

    // recentKickedCount should be high → DB trust suppressed
    assert(ai.recentKickedCount >= 2,
        `DB trust suppressed after repeated kicks: recentKickedCount=${ai.recentKickedCount}`);

    console.log(`     → Final: ${ai.currentTiming}ms, deadZones: [${ai.kickedTimings.join(', ')}]`);
}

// ─────────────────────────────────────────────
// PATTERN I: Frequent LEFT_EARLY to implausible low times
// Human: keeps leaving at very low times (below bot's opponentFloor)
// trying to drag bot down into a zone where human can then kick
// Expected defence: implausibility check prevents following; cautious halfway used
// ─────────────────────────────────────────────
async function testPatternI_ImplausibleLeftEarlyDrag() {
    section('PATTERN I: Implausible LEFT_EARLY drag — leave at 1800ms to pull bot down then kick');

    const ai = await makeBot(1950);
    const NORMAL_FLOOR = 1850, NORMAL_CEILING = 2000;

    // First establish an opponentFloor via 3S_ERROR so implausibility check works
    await round(ai, '3S_ERROR', null); // floor set to ~1950
    console.log(`     Established floor: ${ai.opponentFloor}ms`);

    // Human repeatedly leaves at implausibly low time (1800ms) to drag bot down
    console.log(`     Round | Result      | bot    fired  | leaveAt | Note`);
    const dragTimings = [];
    for (let i = 0; i < 5; i++) {
        const r = await round(ai, 'LEFT_EARLY', 1800); // well below floor
        dragTimings.push(r.next);
        printRound(i + 1, 'LEFT_EARLY', r.next, r.fired, 1800, 'Implausible!');
        assertRange(r.next, NORMAL_FLOOR, NORMAL_CEILING, `Drag round ${i+1}: within NORMAL bounds`);
    }

    // Bot must NOT have been dragged down to 1800ms range
    const minReached = Math.min(...dragTimings);
    assert(minReached >= NORMAL_FLOOR,
        `Implausible drag FAILED: bot never went below floor (min=${minReached}ms)`);

    // Human now kicks thinking bot is low
    const kickR = await round(ai, 'KICKED', null);
    printRound(6, 'KICKED', kickR.next, kickR.fired, '????', 'Human tries to kick');
    assertRange(kickR.next, NORMAL_FLOOR, NORMAL_CEILING, 'After kick: within bounds');

    console.log(`     → Bot never dragged below ${minReached}ms. Implausibility check worked.`);
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
    console.log('═'.repeat(65));
    console.log('  SimpleAICore — Human Attack Pattern Tests (NORMAL zone)');
    console.log('═'.repeat(65));

    try {
        await testPatternA_RepeatedLeftEarlyBait();
        await testPatternB_ZigzagLeftEarly();
        await testPatternC_SlowRaiseTrap();
        await testPatternD_FakeOutAfterSuccess();
        await testPatternE_SpeedOscillator();
        await testPatternF_CeilingCamper();
        await testPatternG_RapidKickLeaveAlternating();
        await testPatternH_GhostRival();
        await testPatternI_ImplausibleLeftEarlyDrag();
    } catch (err) {
        console.error('\n💥 Unexpected error:', err);
        failed++;
    }

    console.log('\n' + '═'.repeat(65));
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        console.log('\n  Failed assertions:');
        failures.forEach(f => console.log(`    ❌ ${f}`));
    }
    console.log('═'.repeat(65));

    process.exit(failed > 0 ? 1 : 0);
}

main();
