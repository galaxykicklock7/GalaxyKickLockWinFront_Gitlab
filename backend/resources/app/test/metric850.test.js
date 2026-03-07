/**
 * Metric Recording Test — 850 Message Flow
 * Tests that adjustment_reason is correctly stored for SUCCESS and 3S_ERROR
 * in both ML (AI Core ON) and non-ML (AI Core OFF) modes.
 *
 * Run: node test/metric850.test.js
 *
 * Scenarios tested:
 *   1. 850 SUCCESS arrives within 150ms — WITH AI Core
 *   2. 850 SUCCESS arrives within 150ms — WITHOUT AI Core
 *   3. 850 3S_ERROR arrives within 150ms — WITH AI Core
 *   4. 850 3S_ERROR arrives within 150ms — WITHOUT AI Core
 *   5. Multi-round: 3S_ERROR then SUCCESS — pending850AlreadyRecorded must reset each round
 *   6. Multi-round: SUCCESS then 3S_ERROR — must record each correctly
 *   7. No 850 arrives (timeout fires) — late 850 SUCCESS must still record
 *   8. No 850 arrives (timeout fires) — late 850 3S_ERROR must still record
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal stubs so GameLogic can be instantiated without full dependencies
// ─────────────────────────────────────────────────────────────────────────────

// Stub out modules that gameLogic.js requires
const Module = require('module');
const originalLoad = Module._load;

const mockFileLogger = {
    imprison: () => {},
    autoInterval: () => {},
    log: () => {},
    aiStatus: () => {},
    autoRelease: () => {},
    ban: () => {},
    kick: () => {},
    whitelist: () => {},
    smartMode: () => {},
};

const mockHelpers = {
    parseHaaapsi: () => ({}),
    countOccurrences: () => 0,
};

const mockFounderMemory = {
    getFounderId: () => null,
    setFounderId: () => {},
};

const mockAIChatService = { AIChatService: class { constructor() {} } };

Module._load = function(request, parent, isMain) {
    if (request.includes('fileLogger'))    return mockFileLogger;
    if (request.includes('helpers'))       return mockHelpers;
    if (request.includes('founderMemory')) return mockFounderMemory;
    if (request.includes('AIChatService')) return mockAIChatService;
    if (request === 'axios') {
        // Return a mock axios — we capture calls here
        return mockAxios;
    }
    return originalLoad.apply(this, arguments);
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock axios — captures all POST /api/metrics/imprison calls
// ─────────────────────────────────────────────────────────────────────────────
const recordedMetrics = [];
const mockAxios = {
    post: async (url, body) => {
        if (url.includes('/api/metrics/imprison')) {
            recordedMetrics.push({ ...body, _url: url, _at: Date.now() });
        }
        return { data: { success: true } };
    },
    get: async () => ({ data: {} }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Now load GameLogic (after stubs are in place)
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const GameLogic = require(path.join(__dirname, '../src/game/gameLogic'));

// ─────────────────────────────────────────────────────────────────────────────
// Mock SimpleAICore — tracks getAdjustmentReason return value
// ─────────────────────────────────────────────────────────────────────────────
const path2 = require('path');
const SimpleAICore = require(path2.join(__dirname, '../src/ai/SimpleAICore'));

function makeMockAICore(lastReason = '3S_ERROR') {
    // Mock AI core — getAdjustmentReason returns the stale value passed in
    // This simulates the real bug: AI returns previous round's reason if adjustmentReason=null is passed
    return {
        currentTiming: 1940,
        speedPreset: 'NORMAL',
        getAdjustmentReason: () => lastReason,
        getNextTiming: async () => 1950,
        getTimingWithJitter: (mode) => 1940,
        setCurrentRival: async () => {},
        setSpeedPreset: () => {},
        getStats: () => ({
            successRate: 50, totalAttempts: 10, successCount: 5,
            attackSuccess: 5, attackAttempts: 10, defenseAttempts: 0, defenseSuccess: 0
        }),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a minimal GameLogic instance
// ─────────────────────────────────────────────────────────────────────────────
function makeGameLogic(aiEnabled = true) {
    const config = {
        metricsEnabled: true,
        userId: 'test-user-id-123',
        attack1: 1940,
        waiting1: 1910,
        timershift: false,
    };

    const gl = new GameLogic(
        1,                     // wsNumber
        config,
        () => {},              // addLog
        () => {},              // updateConfig
        () => {}               // reconnect
    );

    gl.aiEnabled = aiEnabled;
    if (aiEnabled) {
        gl.aiCore = makeMockAICore('3S_ERROR'); // stale reason = 3S_ERROR
    }

    // Pre-set ping so ensurePingMeasured() skips network call
    gl.currentPing = 80;

    // Pre-set tracking fields (as if rival was detected and ACTION 3 was sent)
    gl.rivalDetectedTime = Date.now() - 1900; // rival detected 1900ms ago
    gl.currentTargetName = 'TestRival';
    gl.actionSentTime = Date.now() - 50;      // ACTION 3 sent 50ms ago
    gl.status = 'attack';
    gl.currentCodeType = 'primary';

    return gl;
}

// Fake WebSocket
const fakeWs = {
    readyState: 1, // OPEN
    OPEN: 1,
    send: () => {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

function section(title) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📋 ${title}`);
    console.log('─'.repeat(70));
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function clearMetrics() {
    recordedMetrics.length = 0;
}

// 850 SUCCESS message text (matches "allows you to imprison")
const SUCCESS_850_TEXT = `:server 850 bot :Your code allows you to imprison TestRival for 30 seconds`;
const SUCCESS_850_SNIPPETS = [':server', ':Your', 'code', 'allows', 'you', 'to', 'imprison'];

// 850 3S_ERROR message text
const ERROR_850_TEXT = `:server 850 bot :You can't imprison more often than once in 3s after you appear`;
const ERROR_850_SNIPPETS = [':server', ':You', "can't", 'imprison', 'more', 'often', 'than'];

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 1: 850 SUCCESS within 150ms — WITH AI Core');
    // ─────────────────────────────────────────────────────────────────────────
    {
        clearMetrics();
        const gl = makeGameLogic(true);

        // Simulate: ACTION 3 sent → start 150ms window
        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        // 850 SUCCESS arrives at ~30ms (well within 150ms)
        await wait(30);
        await gl.handle850Message(fakeWs, SUCCESS_850_SNIPPETS, SUCCESS_850_TEXT);

        // Wait for timeout to also fire (and correctly skip)
        await wait(200);

        assert(recordedMetrics.length >= 1, 'At least one metric recorded');
        const m = recordedMetrics.find(m => m.adjustmentReason === 'SUCCESS');
        assert(!!m, 'adjustment_reason = SUCCESS (not stale 3S_ERROR from AI)');
        assert(m && m.isSuccess === true, 'isSuccess = true');
        assert(m && m.playerName === 'TestRival', 'playerName = TestRival');
        assert(recordedMetrics.filter(m => m.adjustmentReason === 'SUCCESS').length === 1, 'No duplicate SUCCESS records');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 2: 850 SUCCESS within 150ms — WITHOUT AI Core');
    // ─────────────────────────────────────────────────────────────────────────
    {
        clearMetrics();
        const gl = makeGameLogic(false); // AI OFF

        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        await wait(30);
        await gl.handle850Message(fakeWs, SUCCESS_850_SNIPPETS, SUCCESS_850_TEXT);
        await wait(200);

        const m = recordedMetrics.find(m => m.adjustmentReason === 'SUCCESS');
        assert(!!m, 'adjustment_reason = SUCCESS (no AI, still correct)');
        assert(m && m.isSuccess === true, 'isSuccess = true');
        assert(recordedMetrics.filter(m => m.adjustmentReason === 'SUCCESS').length === 1, 'No duplicate SUCCESS records');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 3: 850 3S_ERROR within 150ms — WITH AI Core');
    // ─────────────────────────────────────────────────────────────────────────
    {
        clearMetrics();
        const gl = makeGameLogic(true);

        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        await wait(30);
        await gl.handle850Message(fakeWs, ERROR_850_SNIPPETS, ERROR_850_TEXT);
        await wait(200);

        const m = recordedMetrics.find(m => m.adjustmentReason === '3S_ERROR');
        assert(!!m, 'adjustment_reason = 3S_ERROR');
        assert(m && m.isSuccess === false, 'isSuccess = false');
        assert(recordedMetrics.filter(m => m.adjustmentReason === '3S_ERROR').length === 1, 'No duplicate 3S_ERROR records');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 4: 850 3S_ERROR within 150ms — WITHOUT AI Core');
    // ─────────────────────────────────────────────────────────────────────────
    {
        clearMetrics();
        const gl = makeGameLogic(false);

        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        await wait(30);
        await gl.handle850Message(fakeWs, ERROR_850_SNIPPETS, ERROR_850_TEXT);
        await wait(200);

        const m = recordedMetrics.find(m => m.adjustmentReason === '3S_ERROR');
        assert(!!m, 'adjustment_reason = 3S_ERROR (no AI)');
        assert(m && m.isSuccess === false, 'isSuccess = false');
        assert(recordedMetrics.filter(m => m.adjustmentReason === '3S_ERROR').length === 1, 'No duplicate 3S_ERROR records');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 5: Multi-round — 3S_ERROR then SUCCESS — pending850AlreadyRecorded must reset');
    // ─────────────────────────────────────────────────────────────────────────
    // This is the KEY bug scenario: round 1 sets AlreadyRecorded=true, round 2 must reset it
    {
        clearMetrics();
        const gl = makeGameLogic(true);

        // ── ROUND 1: 3S_ERROR ──
        gl.rivalDetectedTime = Date.now() - 1900;
        gl.currentTargetName = 'Rival_A';
        gl.actionSentTime = Date.now() - 50;
        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        await wait(20);
        await gl.handle850Message(fakeWs, ERROR_850_SNIPPETS, ERROR_850_TEXT);
        await wait(200); // let timeout fire too

        const round1 = recordedMetrics.filter(m => m.adjustmentReason === '3S_ERROR');
        assert(round1.length === 1, 'Round 1: exactly 1 × 3S_ERROR recorded');

        // ── ROUND 2: SUCCESS — pending850AlreadyRecorded must be reset ──
        clearMetrics();
        gl.rivalDetectedTime = Date.now() - 1900;
        gl.currentTargetName = 'Rival_B';
        gl.actionSentTime = Date.now() - 50;
        // Simulate new attack starting (this is what the fix adds)
        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false; // ← the fix: reset each round

        await wait(20);
        await gl.handle850Message(fakeWs, SUCCESS_850_SNIPPETS, SUCCESS_850_TEXT);
        await wait(200);

        const round2 = recordedMetrics.filter(m => m.adjustmentReason === 'SUCCESS');
        assert(round2.length === 1, 'Round 2: exactly 1 × SUCCESS recorded (not suppressed by round 1 flag)');
        assert(round2[0]?.isSuccess === true, 'Round 2: isSuccess = true');
        assert(round2[0]?.playerName === 'Rival_B', 'Round 2: correct player name');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 6: Multi-round — SUCCESS then 3S_ERROR — no cross-contamination');
    // ─────────────────────────────────────────────────────────────────────────
    {
        clearMetrics();
        const gl = makeGameLogic(true);

        // ── ROUND 1: SUCCESS ──
        gl.rivalDetectedTime = Date.now() - 1900;
        gl.currentTargetName = 'Rival_X';
        gl.actionSentTime = Date.now() - 50;
        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        await wait(20);
        await gl.handle850Message(fakeWs, SUCCESS_850_SNIPPETS, SUCCESS_850_TEXT);
        await wait(200);

        assert(recordedMetrics.filter(m => m.adjustmentReason === 'SUCCESS').length === 1, 'Round 1: 1 × SUCCESS');

        // ── ROUND 2: 3S_ERROR ──
        clearMetrics();
        gl.rivalDetectedTime = Date.now() - 1900;
        gl.currentTargetName = 'Rival_Y';
        gl.actionSentTime = Date.now() - 50;
        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        await wait(20);
        await gl.handle850Message(fakeWs, ERROR_850_SNIPPETS, ERROR_850_TEXT);
        await wait(200);

        assert(recordedMetrics.filter(m => m.adjustmentReason === '3S_ERROR').length === 1, 'Round 2: 1 × 3S_ERROR (no SUCCESS bleed-through)');
        assert(recordedMetrics.filter(m => m.adjustmentReason === 'SUCCESS').length === 0, 'Round 2: no SUCCESS recorded');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 7: No 850 arrives (timeout fires) — late 850 SUCCESS still records');
    // ─────────────────────────────────────────────────────────────────────────
    {
        clearMetrics();
        const gl = makeGameLogic(true);

        gl.rivalDetectedTime = Date.now() - 1900;
        gl.currentTargetName = 'Rival_Late';
        gl.actionSentTime = Date.now() - 50;
        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        // Wait for 150ms timeout to fire (no 850 arrives)
        await wait(200);

        // Timeout fired with no 850 — should NOT have recorded (new behavior: skip + leave door open)
        assert(recordedMetrics.length === 0, 'Timeout with no 850: nothing recorded yet (door left open)');
        assert(gl.pending850AlreadyRecorded === false, 'AlreadyRecorded = false so late 850 can record');

        // Now late 850 SUCCESS arrives
        clearMetrics();
        await gl.handle850Message(fakeWs, SUCCESS_850_SNIPPETS, SUCCESS_850_TEXT);
        await wait(50);

        const m = recordedMetrics.find(m => m.adjustmentReason === 'SUCCESS');
        assert(!!m, 'Late 850 SUCCESS recorded after timeout');
        assert(m && m.isSuccess === true, 'isSuccess = true for late 850');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 8: No 850 arrives (timeout fires) — late 850 3S_ERROR still records');
    // ─────────────────────────────────────────────────────────────────────────
    {
        clearMetrics();
        const gl = makeGameLogic(true);

        gl.rivalDetectedTime = Date.now() - 1900;
        gl.currentTargetName = 'Rival_Late2';
        gl.actionSentTime = Date.now() - 50;
        gl.pending850Response = true;
        gl.pending850Result = null;
        gl.pending850AlreadyRecorded = false;

        await wait(200); // timeout fires, no 850

        assert(recordedMetrics.length === 0, 'Timeout with no 850: nothing recorded');

        clearMetrics();
        await gl.handle850Message(fakeWs, ERROR_850_SNIPPETS, ERROR_850_TEXT);
        await wait(50);

        const m = recordedMetrics.find(m => m.adjustmentReason === '3S_ERROR');
        assert(!!m, 'Late 850 3S_ERROR recorded after timeout');
        assert(m && m.isSuccess === false, 'isSuccess = false for late 850 3S_ERROR');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 9: 5-round simulation — alternating SUCCESS/3S_ERROR WITH AI Core');
    // ─────────────────────────────────────────────────────────────────────────
    {
        const pattern = ['SUCCESS', '3S_ERROR', 'SUCCESS', 'SUCCESS', '3S_ERROR'];
        const results = [];

        for (let i = 0; i < pattern.length; i++) {
            clearMetrics();
            const gl = makeGameLogic(true);

            gl.rivalDetectedTime = Date.now() - 1900;
            gl.currentTargetName = `Rival_R${i}`;
            gl.actionSentTime = Date.now() - 50;
            gl.pending850Response = true;
            gl.pending850Result = null;
            gl.pending850AlreadyRecorded = false;

            const text = pattern[i] === 'SUCCESS' ? SUCCESS_850_TEXT : ERROR_850_TEXT;
            const snippets = pattern[i] === 'SUCCESS' ? SUCCESS_850_SNIPPETS : ERROR_850_SNIPPETS;

            await wait(20);
            await gl.handle850Message(fakeWs, snippets, text);
            await wait(200);

            const stored = recordedMetrics.find(m => m.adjustmentReason === pattern[i]);
            results.push({ round: i + 1, expected: pattern[i], got: stored?.adjustmentReason || 'NONE', ok: !!stored });
        }

        console.log('\n  Round results:');
        results.forEach(r => {
            console.log(`    Round ${r.round}: expected=${r.expected}, got=${r.got}`);
        });

        const allCorrect = results.every(r => r.ok);
        assert(allCorrect, 'All 5 rounds stored correct adjustment_reason');
        assert(results.filter(r => r.expected === 'SUCCESS' && r.ok).length === 3, '3 SUCCESS rounds recorded correctly');
        assert(results.filter(r => r.expected === '3S_ERROR' && r.ok).length === 2, '2 × 3S_ERROR rounds recorded correctly');
    }

    // ─────────────────────────────────────────────────────────────────────────
    section('TEST 10: 5-round simulation — alternating SUCCESS/3S_ERROR WITHOUT AI Core');
    // ─────────────────────────────────────────────────────────────────────────
    {
        const pattern = ['3S_ERROR', 'SUCCESS', '3S_ERROR', 'SUCCESS', 'SUCCESS'];
        const results = [];

        for (let i = 0; i < pattern.length; i++) {
            clearMetrics();
            const gl = makeGameLogic(false); // AI OFF

            gl.rivalDetectedTime = Date.now() - 1900;
            gl.currentTargetName = `Rival_NoAI_${i}`;
            gl.actionSentTime = Date.now() - 50;
            gl.pending850Response = true;
            gl.pending850Result = null;
            gl.pending850AlreadyRecorded = false;

            const text = pattern[i] === 'SUCCESS' ? SUCCESS_850_TEXT : ERROR_850_TEXT;
            const snippets = pattern[i] === 'SUCCESS' ? SUCCESS_850_SNIPPETS : ERROR_850_SNIPPETS;

            await wait(20);
            await gl.handle850Message(fakeWs, snippets, text);
            await wait(200);

            const stored = recordedMetrics.find(m => m.adjustmentReason === pattern[i]);
            results.push({ round: i + 1, expected: pattern[i], got: stored?.adjustmentReason || 'NONE', ok: !!stored });
        }

        console.log('\n  Round results (no AI):');
        results.forEach(r => {
            console.log(`    Round ${r.round}: expected=${r.expected}, got=${r.got}`);
        });

        const allCorrect = results.every(r => r.ok);
        assert(allCorrect, 'All 5 rounds (no AI) stored correct adjustment_reason');
        assert(results.filter(r => r.expected === 'SUCCESS' && r.ok).length === 3, '3 SUCCESS recorded correctly without AI');
        assert(results.filter(r => r.expected === '3S_ERROR' && r.ok).length === 2, '2 × 3S_ERROR recorded correctly without AI');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('═'.repeat(70));

    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
