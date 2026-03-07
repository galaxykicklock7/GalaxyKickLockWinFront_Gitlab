/**
 * Boundary ML v2 Verification — actual SimpleAICore implementation
 * Tests all presets: SLOW, NORMAL, FAST
 * Preset controls floor only, ceiling always 2150.
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

async function runTest(preset, rivalType, rounds = 50, runs = 30) {
    let totals = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };

    for (let run = 0; run < runs; run++) {
        const ai = new SimpleAICore(1);
        ai.setSpeedPreset(preset);

        const rivalGen = createRival(rivalType);
        let rivalLastResult = null;

        for (let i = 0; i < rounds; i++) {
            const botTiming = ai.getTimingWithJitter('attack');
            const rivalTiming = rivalGen(rivalLastResult);
            const { result, rivalLeftAt } = simulateRound(botTiming, rivalTiming);
            totals[result]++;

            if (result === 'SUCCESS') rivalLastResult = 'lost';
            else if (result === 'KICKED') rivalLastResult = 'won';
            else rivalLastResult = null;

            await ai.getNextTiming(result, 'attack', rivalLeftAt);
        }
    }

    const total = rounds * runs;
    const avg = {};
    for (const k of Object.keys(totals)) {
        avg[k] = { count: (totals[k] / runs).toFixed(1), pct: ((totals[k] / total) * 100).toFixed(1) };
    }
    return avg;
}

async function main() {
    const ROUNDS = 50;
    const RUNS = 30;
    const rivals = ['STABLE', 'SLOW', 'FAST', 'ERRATIC', 'ADAPTIVE'];
    const presets = ['SLOW', 'NORMAL', 'FAST'];

    console.log('═══════════════════════════════════════════════════════════════════════════════════════');
    console.log('  BOUNDARY ML v2 VERIFICATION — actual SimpleAICore');
    console.log(`  Ceiling always 2150 | ${ROUNDS} rounds | ${RUNS} runs avg`);
    console.log('═══════════════════════════════════════════════════════════════════════════════════════\n');

    for (const preset of presets) {
        const floors = { SLOW: 1675, NORMAL: 1850, FAST: 1950 };
        console.log(`  ┌─── ${preset} PRESET (floor=${floors[preset]}, ceiling=2150) ───────────────────────────────────┐`);
        console.log(`  │  Rival        │ SUCCESS       │ KICKED        │ 3S_ERROR      │ LEFT_EARLY    │`);
        console.log(`  ├───────────────┼───────────────┼───────────────┼───────────────┼───────────────┤`);

        for (const rival of rivals) {
            const r = await runTest(preset, rival, ROUNDS, RUNS);
            console.log(`  │  ${rival.padEnd(12)} │ ${r.SUCCESS.count.padStart(5)}  ${(r.SUCCESS.pct + '%').padStart(6)} │ ${r.KICKED.count.padStart(5)}  ${(r.KICKED.pct + '%').padStart(6)} │ ${r['3S_ERROR'].count.padStart(5)}  ${(r['3S_ERROR'].pct + '%').padStart(6)} │ ${r.LEFT_EARLY.count.padStart(5)}  ${(r.LEFT_EARLY.pct + '%').padStart(6)} │`);
        }

        console.log(`  └───────────────┴───────────────┴───────────────┴───────────────┴───────────────┘\n`);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
