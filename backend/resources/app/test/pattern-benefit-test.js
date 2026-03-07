/**
 * Pattern Detection Benefit Test
 * Tests specific rival behaviors where pattern detection should help:
 * 1. OSCILLATING - alternates between two timings
 * 2. TRAPPING - sends fake LEFT_EARLY to bait bot down
 * 3. DRIFTING_UP - slowly increases timing each round
 * 4. ZONE_SWITCHER - switches between fast/slow zones every 3 rounds
 *
 * Compares: pattern detection ON vs OFF
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
        return { prepare: function() { return { get: function() { return null; }, all: function() { return []; }, run: function() {} }; }, exec: function() {}, pragma: function() {} };
    }
};

const SimpleAICore = require('../src/ai/SimpleAICore');

var PING_BOT = 46, PING_RIVAL = 40;

function simulateRound(botTiming, rivalTiming) {
    var botServer = botTiming + PING_BOT;
    var rivalServer = rivalTiming + PING_RIVAL;
    var serverWindow = 1870 + Math.floor(Math.random() * 20 - 10);

    if (rivalServer < botServer && rivalTiming < botTiming - 30) {
        return { result: 'LEFT_EARLY', rivalLeftAt: rivalTiming + Math.floor(Math.random() * 10 - 5) };
    }
    if (botServer < serverWindow) return { result: '3S_ERROR', rivalLeftAt: null };
    if (botServer <= rivalServer) return { result: 'SUCCESS', rivalLeftAt: null };
    return { result: 'KICKED', rivalLeftAt: null };
}

function createRival(type) {
    switch (type) {
        case 'OSCILLATING': {
            var round = 0;
            return function() {
                round++;
                var base = (round % 2 === 0) ? 1830 : 1960;
                return base + Math.floor(Math.random() * 10 - 5);
            };
        }
        case 'TRAPPING': {
            var round = 0;
            return function() {
                round++;
                if (round % 5 === 0) return 1720 + Math.floor(Math.random() * 10);
                return 1900 + Math.floor(Math.random() * 15 - 7);
            };
        }
        case 'DRIFTING_UP': {
            var timing = 1850;
            return function() {
                timing = Math.min(2100, timing + 8);
                return timing + Math.floor(Math.random() * 10 - 5);
            };
        }
        case 'ZONE_SWITCHER': {
            var round = 0;
            return function() {
                round++;
                var inFastZone = Math.floor((round - 1) / 3) % 2 === 1;
                if (inFastZone) return 1975 + Math.floor(Math.random() * 25);
                return 1800 + Math.floor(Math.random() * 20);
            };
        }
        case 'STABLE':
            return function() { return 1895 + Math.floor(Math.random() * 10); };
        default:
            return function() { return 1900; };
    }
}

async function runTest(preset, rivalType, rounds, runs, disablePattern) {
    var totals = { SUCCESS: 0, KICKED: 0, '3S_ERROR': 0, LEFT_EARLY: 0 };
    var roundDetails = [];

    for (var run = 0; run < runs; run++) {
        var ai = new SimpleAICore(1);
        ai.setSpeedPreset(preset);

        if (disablePattern) {
            ai._applyPatternOverride = function(bt) { return bt; };
            ai._isTrap = function() { return false; };
        }

        var rivalGen = createRival(rivalType);

        for (var i = 0; i < rounds; i++) {
            var botTiming = ai.getTimingWithJitter('attack');
            var rivalTiming = rivalGen();
            var sim = simulateRound(botTiming, rivalTiming);
            totals[sim.result]++;

            if (run === 0) {
                roundDetails.push({ round: i + 1, bot: botTiming, rival: rivalTiming, result: sim.result, rivalLeftAt: sim.rivalLeftAt });
            }

            await ai.getNextTiming(sim.result, 'attack', sim.rivalLeftAt);
        }
    }

    var total = rounds * runs;
    var avg = {};
    var keys = Object.keys(totals);
    for (var k = 0; k < keys.length; k++) {
        avg[keys[k]] = { count: (totals[keys[k]] / runs).toFixed(1), pct: ((totals[keys[k]] / total) * 100).toFixed(1) };
    }
    return { avg: avg, trace: roundDetails };
}

async function main() {
    var ROUNDS = 80;
    var RUNS = 50;
    var rivals = ['OSCILLATING', 'TRAPPING', 'DRIFTING_UP', 'ZONE_SWITCHER', 'STABLE'];

    console.log('');
    console.log('='.repeat(100));
    console.log('  PATTERN DETECTION BENEFIT TEST');
    console.log('  SLOW preset | ' + ROUNDS + ' rounds | ' + RUNS + ' runs avg | Pattern ON vs OFF');
    console.log('='.repeat(100));
    console.log('');

    console.log('  Rival         |  PATTERN ON                     |  PATTERN OFF                    | DELTA');
    console.log('                |  SUCCESS  KICKED  3S_ERR  L_EAR |  SUCCESS  KICKED  3S_ERR  L_EAR | SUCCESS');
    console.log('  --------------|------ ---|--------|--------|-----|---------|--------|--------|------|--------');

    for (var r = 0; r < rivals.length; r++) {
        var rival = rivals[r];
        var on = await runTest('SLOW', rival, ROUNDS, RUNS, false);
        var off = await runTest('SLOW', rival, ROUNDS, RUNS, true);

        var delta = (parseFloat(on.avg.SUCCESS.pct) - parseFloat(off.avg.SUCCESS.pct)).toFixed(1);
        var sign = parseFloat(delta) >= 0 ? '+' : '';

        console.log(
            '  ' + rival.padEnd(14) +
            '|  ' + (on.avg.SUCCESS.pct + '%').padStart(6) +
            '  ' + (on.avg.KICKED.pct + '%').padStart(6) +
            '  ' + (on.avg['3S_ERROR'].pct + '%').padStart(6) +
            '  ' + (on.avg.LEFT_EARLY.pct + '%').padStart(5) +
            ' |  ' + (off.avg.SUCCESS.pct + '%').padStart(6) +
            '  ' + (off.avg.KICKED.pct + '%').padStart(6) +
            '  ' + (off.avg['3S_ERROR'].pct + '%').padStart(6) +
            '  ' + (off.avg.LEFT_EARLY.pct + '%').padStart(5) +
            ' | ' + (sign + delta + '%').padStart(7)
        );
    }

    // --- TRACE: OSCILLATING ---
    console.log('\n');
    console.log('  === TRACE: OSCILLATING rival (1 run, 30 rounds) ===');
    console.log('  Rival alternates: ~1960 and ~1830 each round');
    console.log('');

    var traceOn = await runTest('SLOW', 'OSCILLATING', 30, 1, false);
    var traceOff = await runTest('SLOW', 'OSCILLATING', 30, 1, true);

    console.log('  Round | Rival | PatternON bot  result     | PatternOFF bot  result');
    console.log('  ------|-------|---------------------------|---------------------------');
    for (var i = 0; i < 30; i++) {
        var onR = traceOn.trace[i];
        var offR = traceOff.trace[i];
        var onStr = String(onR.bot).padStart(4) + ' -> ' + onR.result.padEnd(10);
        var offStr = String(offR.bot).padStart(4) + ' -> ' + offR.result.padEnd(10);
        var marker = '';
        if (onR.result === 'SUCCESS' && offR.result !== 'SUCCESS') marker = ' << pattern wins';
        else if (offR.result === 'SUCCESS' && onR.result !== 'SUCCESS') marker = ' << boundary wins';
        console.log('  ' + String(i + 1).padStart(5) + ' | ' + String(onR.rival).padStart(5) + ' | ' + onStr + ' | ' + offStr + marker);
    }

    // --- TRACE: TRAPPING ---
    console.log('\n');
    console.log('  === TRACE: TRAPPING rival (1 run, 30 rounds) ===');
    console.log('  Rival plays ~1900 normally, every 5th round sends fake low ~1720 (trap)');
    console.log('');

    var trapOn = await runTest('SLOW', 'TRAPPING', 30, 1, false);
    var trapOff = await runTest('SLOW', 'TRAPPING', 30, 1, true);

    console.log('  Round | Rival | PatternON bot  result     | PatternOFF bot  result');
    console.log('  ------|-------|---------------------------|---------------------------');
    for (var i = 0; i < 30; i++) {
        var onR = trapOn.trace[i];
        var offR = trapOff.trace[i];
        var onStr = String(onR.bot).padStart(4) + ' -> ' + onR.result.padEnd(10);
        var offStr = String(offR.bot).padStart(4) + ' -> ' + offR.result.padEnd(10);
        var trapMarker = onR.rival < 1750 ? ' << TRAP' : '';
        var winMarker = '';
        if (onR.result === 'SUCCESS' && offR.result !== 'SUCCESS') winMarker = ' << pattern wins';
        else if (offR.result === 'SUCCESS' && onR.result !== 'SUCCESS') winMarker = ' << boundary wins';
        console.log('  ' + String(i + 1).padStart(5) + ' | ' + String(onR.rival).padStart(5) + ' | ' + onStr + ' | ' + offStr + trapMarker + winMarker);
    }

    console.log('\n' + '='.repeat(100));
}

main().catch(console.error);
