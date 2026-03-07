/**
 * SimpleAICore — Realistic Human vs Bot Simulation
 * Run: node test/aicore.simulate.js
 *
 * HOW IT WORKS:
 * ─────────────
 * The human has a "preferred timing" (where they fire their action).
 * The bot has its own timing (managed by SimpleAICore).
 * Each round, both fire at the same event. The result depends on overlap:
 *
 *   bot timing < human timing - WIN_WINDOW  → 3S_ERROR  (bot too fast, missed)
 *   bot timing > human timing + WIN_WINDOW  → KICKED    (bot too slow, human wins)
 *   within ±WIN_WINDOW                      → SUCCESS   (bot wins, imprisoned human)
 *   human randomly decides to leave early   → LEFT_EARLY (human bailed out)
 *
 * WIN_WINDOW = ±25ms (realistic game tolerance — within 25ms of human timing = success)
 *
 * Human behaviour profiles:
 *   - STEADY: stays at one timing with small ±10ms natural variation
 *   - DRIFTER: slowly moves their timing up/down over time
 *   - BAITER: uses LEFT_EARLY frequently to mislead the bot, then kicks
 *   - AGGRESSIVE: kicks every round, rarely leaves early, moves unpredictably
 *   - ERRATIC: large random jumps in timing every few rounds
 *   - CEILING_CAMPER: sits near ceiling (1990ms), waits for bot to overshoot
 *
 * Each profile runs 60 rounds (realistic session length).
 * Results are shown as: SUCCESS%, KICKED%, 3S_ERROR%, LEFT_EARLY%
 */

'use strict';

const path = require('path');
const SimpleAICore = require(path.join(__dirname, '../src/ai/SimpleAICore'));

const WIN_WINDOW = 25; // ±25ms window for SUCCESS

// ─────────────────────────────────────────────
// Empty supabase mock (pure ML, no DB)
// ─────────────────────────────────────────────
function makeEmptySupabase() {
    return {
        from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ not: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }) }),
        rpc: async () => ({ data: [], error: null })
    };
}

// ─────────────────────────────────────────────
// Human models
// ─────────────────────────────────────────────

class HumanPlayer {
    constructor(name, startTiming, profile) {
        this.name = name;
        this.timing = startTiming;   // current preferred timing
        this.profile = profile;
        this.round = 0;
        this.lastResult = null;
        // State for baiter
        this.baitCount = 0;
        this.baitPhase = 'bait'; // 'bait' | 'kick'
    }

    // Returns { humanTiming, decidedToLeaveEarly }
    decideAction(botFiredTiming) {
        this.round++;
        let leaveEarly = false;

        switch (this.profile) {

            case 'STEADY': {
                // Stays near one timing with small natural jitter ±10ms
                const jitter = Math.round((Math.random() - 0.5) * 20);
                this.timing = clamp(this.timing + jitter, 1850, 2000);
                // 5% chance of leaving early (distracted player)
                leaveEarly = Math.random() < 0.05;
                break;
            }

            case 'DRIFTER': {
                // Slowly drifts up or down, reverses at boundaries
                if (!this._driftDir) this._driftDir = 1;
                const drift = this._driftDir * (5 + Math.round(Math.random() * 5));
                this.timing += drift;
                if (this.timing >= 1995) this._driftDir = -1;
                if (this.timing <= 1855) this._driftDir = 1;
                this.timing = clamp(this.timing, 1855, 1995);
                leaveEarly = Math.random() < 0.08;
                break;
            }

            case 'BAITER': {
                // Phase: leave early N times to lure bot up, then kick, repeat
                if (this.baitPhase === 'bait') {
                    // Leave early — report a slightly higher timing to lure bot
                    leaveEarly = true;
                    this.timing = clamp(this.timing + 8, 1860, 1985);
                    this.baitCount++;
                    if (this.baitCount >= 3 + Math.floor(Math.random() * 3)) {
                        this.baitPhase = 'kick';
                        this.baitCount = 0;
                    }
                } else {
                    // Kick phase: stay and fight at current timing
                    leaveEarly = false;
                    const jitter = Math.round((Math.random() - 0.5) * 10);
                    this.timing = clamp(this.timing + jitter, 1860, 1995);
                    if (Math.random() < 0.4) {
                        this.baitPhase = 'bait'; // switch back to bait after ~2.5 kicks
                    }
                }
                break;
            }

            case 'AGGRESSIVE': {
                // Aggressive: rarely leaves, constantly shifts timing unpredictably
                leaveEarly = Math.random() < 0.03;
                // Large random jump every 3–4 rounds
                if (this.round % (3 + Math.floor(Math.random() * 2)) === 0) {
                    const bigShift = (Math.random() < 0.5 ? -1 : 1) * (20 + Math.round(Math.random() * 40));
                    this.timing = clamp(this.timing + bigShift, 1860, 1990);
                } else {
                    const jitter = Math.round((Math.random() - 0.5) * 14);
                    this.timing = clamp(this.timing + jitter, 1860, 1990);
                }
                break;
            }

            case 'ERRATIC': {
                // Wild jumps — human is unpredictable, changes timing drastically each round
                leaveEarly = Math.random() < 0.15;
                const jump = Math.round((Math.random() - 0.5) * 120);
                this.timing = clamp(this.timing + jump, 1860, 1990);
                break;
            }

            case 'CEILING_CAMPER': {
                // Sits at ~1985ms with tiny jitter, rarely moves
                // Waits for bot to overshoot ceiling then kicks
                const jitter = Math.round((Math.random() - 0.5) * 8);
                this.timing = clamp(1985 + jitter, 1978, 1998);
                leaveEarly = Math.random() < 0.04;
                break;
            }

            default:
                break;
        }

        return { humanTiming: this.timing, leaveEarly };
    }
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

// ─────────────────────────────────────────────
// Determine round result from bot fired timing vs human timing
// ─────────────────────────────────────────────
function determineResult(botFiredTiming, humanTiming, leaveEarly) {
    if (leaveEarly) {
        // Human left — return their leave timing as opponentLeftTime
        return { result: 'LEFT_EARLY', opponentLeftTime: humanTiming };
    }

    const diff = botFiredTiming - humanTiming;

    if (diff > WIN_WINDOW) {
        // Bot too slow — human fired earlier, human wins → bot gets kicked
        return { result: 'KICKED', opponentLeftTime: null };
    } else if (diff < -WIN_WINDOW) {
        // Bot too fast — bot fired before human, 3 second error
        return { result: '3S_ERROR', opponentLeftTime: null };
    } else {
        // Bot within window — SUCCESS
        return { result: 'SUCCESS', opponentLeftTime: null };
    }
}

// ─────────────────────────────────────────────
// Run one simulation: bot vs human profile
// ─────────────────────────────────────────────
async function runSimulation(profileName, startHumanTiming, rounds = 60) {
    const ai = new SimpleAICore(makeEmptySupabase(), 'user1', 1, 1);
    ai.setSpeedPreset('NORMAL'); // 1850–2000ms
    await ai.initializeTimingFromPing();

    const human = new HumanPlayer(profileName, startHumanTiming, profileName);

    const counts = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };
    const roundLog = [];

    for (let r = 0; r < rounds; r++) {
        // Bot fires from its current state
        const botFiredTiming = ai.getTimingWithJitter('attack');

        // Human decides what to do
        const { humanTiming, leaveEarly } = human.decideAction(botFiredTiming);

        // Determine result
        const { result, opponentLeftTime } = determineResult(botFiredTiming, humanTiming, leaveEarly);

        counts[result]++;

        // Feed result back to AI
        await ai.getNextTiming(result, 'attack', opponentLeftTime);

        roundLog.push({
            r: r + 1,
            botFired: botFiredTiming,
            botInternal: ai.currentTiming,
            humanTiming,
            result,
            diff: botFiredTiming - humanTiming
        });
    }

    return { counts, roundLog, finalBotTiming: ai.currentTiming };
}

// ─────────────────────────────────────────────
// Format percentage
// ─────────────────────────────────────────────
function pct(count, total) {
    return ((count / total) * 100).toFixed(1).padStart(5) + '%';
}

function bar(pctVal, width = 20) {
    const filled = Math.round((parseFloat(pctVal) / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ─────────────────────────────────────────────
// Print detailed round-by-round log (first 20 rounds)
// ─────────────────────────────────────────────
function printRoundLog(roundLog) {
    console.log(`\n     R  | BotFired | HumanAt | Diff   | Result`);
    console.log(`     ${'─'.repeat(52)}`);
    const show = roundLog.slice(0, 20);
    for (const row of show) {
        const diffStr = (row.diff >= 0 ? '+' : '') + row.diff;
        const icon = row.result === 'SUCCESS' ? '✅' :
                     row.result === 'KICKED'  ? '🔴' :
                     row.result === '3S_ERROR'? '⚡' : '🚪';
        console.log(
            `     ${String(row.r).padStart(2)} | ${String(row.botFired).padStart(8)} | ${String(row.humanTiming).padStart(7)} | ${String(diffStr).padStart(6)} | ${icon} ${row.result}`
        );
    }
    if (roundLog.length > 20) {
        console.log(`     ... (${roundLog.length - 20} more rounds not shown)`);
    }
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
    const ROUNDS = 60;

    console.log('═'.repeat(70));
    console.log('  SimpleAICore — Human vs Bot Simulation (NORMAL zone, 60 rounds each)');
    console.log('  WIN_WINDOW: ±25ms   |   Preset: NORMAL (1850–2000ms)');
    console.log('═'.repeat(70));

    const profiles = [
        { name: 'STEADY',         startTiming: 1940, desc: 'Consistent player, small jitter ±10ms' },
        { name: 'DRIFTER',        startTiming: 1920, desc: 'Gradually shifts timing up/down over session' },
        { name: 'BAITER',         startTiming: 1930, desc: 'Leaves early 3–5x to lure bot up, then kicks' },
        { name: 'AGGRESSIVE',     startTiming: 1950, desc: 'Rarely leaves, large unpredictable timing jumps' },
        { name: 'ERRATIC',        startTiming: 1940, desc: 'Wild random ±60ms jumps every round' },
        { name: 'CEILING_CAMPER', startTiming: 1985, desc: 'Sits at ceiling 1985ms, waits for bot to overshoot' },
    ];

    // Summary table for end
    const summary = [];

    for (const profile of profiles) {
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`⚔️  ${profile.name.padEnd(18)} — ${profile.desc}`);
        console.log(`${'─'.repeat(70)}`);

        const { counts, roundLog, finalBotTiming } = await runSimulation(
            profile.name, profile.startTiming, ROUNDS
        );

        const total = ROUNDS;
        const successPct  = pct(counts.SUCCESS,    total);
        const kickedPct   = pct(counts.KICKED,     total);
        const errorPct    = pct(counts['3S_ERROR'], total);
        const leftPct     = pct(counts.LEFT_EARLY, total);

        printRoundLog(roundLog);

        console.log(`\n  📊 Results after ${ROUNDS} rounds:`);
        console.log(`     ✅ SUCCESS   : ${successPct}  ${bar(successPct)}  (${counts.SUCCESS} rounds)`);
        console.log(`     🔴 KICKED    : ${kickedPct}   ${bar(kickedPct)}  (${counts.KICKED} rounds)`);
        console.log(`     ⚡ 3S_ERROR  : ${errorPct}   ${bar(errorPct)}  (${counts['3S_ERROR']} rounds)`);
        console.log(`     🚪 LEFT_EARLY: ${leftPct}   ${bar(leftPct)}  (${counts.LEFT_EARLY} rounds)`);
        console.log(`     🤖 Final bot timing: ${finalBotTiming}ms`);

        summary.push({
            name: profile.name,
            success: parseFloat(successPct),
            kicked: parseFloat(kickedPct),
            error: parseFloat(errorPct),
            left: parseFloat(leftPct),
            finalBot: finalBotTiming
        });
    }

    // ─────────────────────────
    // Summary table
    // ─────────────────────────
    console.log(`\n${'═'.repeat(70)}`);
    console.log('  SUMMARY — Success & Kicked % across all human profiles');
    console.log(`${'═'.repeat(70)}`);
    console.log(`  ${'Profile'.padEnd(18)} | ${'SUCCESS%'.padStart(9)} | ${'KICKED%'.padStart(8)} | ${'3S_ERR%'.padStart(8)} | ${'LEFT%'.padStart(6)} | FinalBot`);
    console.log(`  ${'─'.repeat(66)}`);
    for (const s of summary) {
        const status = s.success >= 40 ? '🟢' : s.success >= 25 ? '🟡' : '🔴';
        console.log(
            `  ${status} ${s.name.padEnd(16)} | ${String(s.success+'%').padStart(9)} | ${String(s.kicked+'%').padStart(8)} | ${String(s.error+'%').padStart(8)} | ${String(s.left+'%').padStart(6)} | ${s.finalBot}ms`
        );
    }

    const avgSuccess = (summary.reduce((a, b) => a + b.success, 0) / summary.length).toFixed(1);
    const avgKicked  = (summary.reduce((a, b) => a + b.kicked,  0) / summary.length).toFixed(1);
    console.log(`  ${'─'.repeat(66)}`);
    console.log(`  ${'AVERAGE'.padEnd(18)} | ${String(avgSuccess+'%').padStart(9)} | ${String(avgKicked+'%').padStart(8)}`);
    console.log(`${'═'.repeat(70)}`);

    // ─────────────────────────
    // Verdict
    // ─────────────────────────
    console.log('\n  📋 VERDICT:');
    for (const s of summary) {
        let verdict;
        if (s.success >= 50)      verdict = '✅ EXCELLENT — bot dominates';
        else if (s.success >= 35) verdict = '✅ GOOD — bot wins more often than not';
        else if (s.success >= 20) verdict = '⚠️  ACCEPTABLE — bot and human roughly even';
        else                      verdict = '❌ NEEDS WORK — human too dominant';

        console.log(`     ${s.name.padEnd(18)}: ${verdict} (${s.success}% success, ${s.kicked}% kicked)`);
    }
    console.log('');
}

main().catch(console.error);
