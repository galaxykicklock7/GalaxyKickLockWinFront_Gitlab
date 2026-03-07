/**
 * Compare: preset ceiling (1900) vs absolute ceiling (2150) for SLOW preset
 * Tests against all rival types to see which approach is better.
 */

const Module = require('module');
Module._resolveFilename = (function(orig) {
    return function(request, parent, ...args) {
        if (request === 'better-sqlite3') return request;
        return orig.call(this, request, parent, ...args);
    };
})(Module._resolveFilename);

require.cache[require.resolve('better-sqlite3')] = {
    id: 'better-sqlite3', filename: 'better-sqlite3', loaded: true,
    exports: function() {
        return { prepare: () => ({ get: () => null, all: () => [], run: () => {} }), exec: () => {}, pragma: () => {} };
    }
};

const SimpleAICore = require('../src/ai/SimpleAICore');

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

async function runTest(rivalType, ceilingOverride, rounds = 100, runs = 15) {
    let totals = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };

    for (let run = 0; run < runs; run++) {
        const ai = new SimpleAICore(1);
        ai.setSpeedPreset('SLOW');

        // Override getBoundaryMedian if testing absolute ceiling
        if (ceilingOverride) {
            const origMedian = ai.getBoundaryMedian.bind(ai);
            ai.getBoundaryMedian = function() {
                const lo = this.ms.bFloor !== null ? this.ms.bFloor : this.timingFloor;
                const hi = this.ms.bCeiling !== null ? this.ms.bCeiling : 2150;
                return this.clampTiming(Math.round((lo + hi) / 2));
            }.bind(ai);
        }

        const rivalGen = createRival(rivalType);
        let rivalLastResult = null;
        let results = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };

        for (let i = 0; i < rounds; i++) {
            const botTiming = ai.getTimingWithJitter('attack');
            const rivalTiming = rivalGen(rivalLastResult);
            const { result, rivalLeftAt } = simulateRound(botTiming, rivalTiming);
            results[result]++;
            if (result === 'SUCCESS') rivalLastResult = 'lost';
            else if (result === 'KICKED') rivalLastResult = 'won';
            else rivalLastResult = null;
            await ai.getNextTiming(result, 'attack', rivalLeftAt);
        }
        for (const k of Object.keys(totals)) totals[k] += results[k];
    }

    const avg = {};
    for (const k of Object.keys(totals)) avg[k] = Math.round(totals[k] / runs);
    return avg;
}

async function main() {
    const rivals = ['STABLE', 'SLOW', 'FAST', 'ERRATIC', 'ADAPTIVE'];
    const pct = (v) => ((v / 100) * 100).toFixed(1).padStart(5);

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('  CEILING COMPARISON — SLOW preset | 100 rounds | 15 runs avg');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    console.log('  ── Option A: Preset ceiling (1900) ──────────────────────────────────');
    for (const rival of rivals) {
        const r = await runTest(rival, false);
        console.log(`  vs ${rival.padEnd(12)} | SUCCESS: ${String(r.SUCCESS).padStart(3)} (${pct(r.SUCCESS)}%) | KICKED: ${String(r.KICKED).padStart(3)} | 3S_ERR: ${String(r['3S_ERROR']).padStart(3)} | LEFT: ${String(r.LEFT_EARLY).padStart(3)}`);
    }

    console.log('\n  ── Option B: Absolute ceiling (2150) ─────────────────────────────────');
    for (const rival of rivals) {
        const r = await runTest(rival, true);
        console.log(`  vs ${rival.padEnd(12)} | SUCCESS: ${String(r.SUCCESS).padStart(3)} (${pct(r.SUCCESS)}%) | KICKED: ${String(r.KICKED).padStart(3)} | 3S_ERR: ${String(r['3S_ERROR']).padStart(3)} | LEFT: ${String(r.LEFT_EARLY).padStart(3)}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
