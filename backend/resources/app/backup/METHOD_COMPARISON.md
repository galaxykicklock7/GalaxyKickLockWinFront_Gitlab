# Method Comparison: game-logic-final.js vs src/game/gameLogic.js

## Methods in game-logic-final.js (43 non-AI methods)

### ✅ Present in src/game/gameLogic.js:
1. ✅ constructor
2. ✅ parseHaaapsi
3. ✅ countOccurrences
4. ✅ resetState
5. ✅ getAdaptiveStepSize
6. ✅ isOscillating
7. ✅ trackAdjustment
8. ✅ getTiming
9. ✅ markTargetAttacked
10. ✅ isOnCooldown
11. ✅ getAvailableTargets
12. ✅ selectSmartTarget
13. ✅ incrementAttack
14. ✅ decrementAttack
15. ✅ incrementDefence
16. ✅ decrementDefence
17. ✅ handle353BanMode
18. ✅ handle353KickMode
19. ✅ handle353Normal
20. ✅ handle353LowSec
21. ✅ handle353Message
22. ✅ handleJoinAttackMode
23. ✅ handleJoinDefenseMode
24. ✅ handleJoinTargetTracking
25. ✅ handleJoinBanMode
26. ✅ handleJoinKickMode (in original, merged into handle353KickMode in src)
27. ✅ handleJoinLowSec
28. ✅ handleJoinMessage
29. ✅ handle471Message
30. ✅ handle850Message
31. ✅ handle452Message
32. ✅ handle860Message
33. ✅ handlePartMessage
34. ✅ handleSleepMessage
35. ✅ handle900Message
36. ✅ getState
37. ✅ destroy
38. ✅ OffSleep
39. ✅ escapeAll
40. ✅ escapeWithCode
41. ✅ escape1-5, escapeL1-5, escapeViaDiamond (all in escapeWithCode)

### ⚠️ Missing from src/game/gameLogic.js:
1. ⚠️ **getRecoveryCode(mainCode, altCode)** - Code alternation
2. ⚠️ **getTimingLabel(mode)** - Returns timing label (FAST/NORMAL/SLOW)
3. ⚠️ **getUnattackedTargets()** - Returns unattacked targets
4. ⚠️ **track353Users(text)** - AI Mode related, but might be needed
5. ⚠️ **handlePingMessage(ws)** - In socketManager.js, not in gameLogic.js
6. ⚠️ **handleJoinKickMode** - Separate method in original, might be needed

### ❌ AI Mode Methods (Correctly Excluded):
- initAIMode
- getRivalProfile
- updateRivalProfile
- trackOpponentLogin
- startRealTimeMonitor
- stopRealTimeMonitor
- triggerProactiveAttack
- trackOpponentLogout
- addOpponentSample
- narrowRangeFromSamples
- checkRangeUpdate
- getAITiming
- recordAIResult
- processDiscoveryResult
- finalizeEdge
- processAdaptiveResult
- resetAIDiscovery
- getAIStats
- getOpponentDataFilePath
- loadOpponentData
- saveOpponentData
- addOpponentRecord
- calculateOptimalFromFile
- processRemainingOpponents
- logLearnedTimings

## Detailed Analysis of Missing Methods

### 1. getRecoveryCode(mainCode, altCode)
**Location**: game-logic-final.js line 180
**Code**:
```javascript
getRecoveryCode(mainCode, altCode) {
  this.inc++;
  if (mainCode && altCode) {
    return (this.inc % 2 == 1) ? mainCode : altCode;
  }
  return altCode || mainCode;
}
```
**Status**: ⚠️ **MISSING** - But code rotation is handled in connectionManager.js
**Impact**: Might be needed if code rotation doesn't work properly

### 2. getTimingLabel(mode)
**Location**: game-logic-final.js line 480
**Code**:
```javascript
getTimingLabel(mode) {
  if (this.config.timershift) {
    return mode === "defense" ? "Auto Defense" : "Auto Attack";
  }
  const timing = this.getTiming(mode);
  if (timing < 1800) return "[VERY FAST]";
  if (timing < 1900) return "[FAST]";
  if (timing < 2000) return "[NORMAL]";
  if (timing < 2100) return "[SLOW]";
  return "[VERY SLOW]";
}
```
**Status**: ⚠️ **MISSING**
**Impact**: **MEDIUM** - Used in logs to show timing labels
**Recommendation**: **ADD THIS**

### 3. getUnattackedTargets()
**Location**: game-logic-final.js line 1178
**Code**:
```javascript
getUnattackedTargets() {
  return this.attackids.filter(id => !this.attackedThisSession.has(id));
}
```
**Status**: ⚠️ **MISSING**
**Impact**: **LOW** - Used in Smart Mode, but selectSmartTarget has inline version
**Recommendation**: Optional

### 4. track353Users(text)
**Location**: game-logic-final.js line 2082
**Purpose**: Tracks users from 353 message for AI Mode opponent tracking
**Status**: ⚠️ **MISSING**
**Impact**: **NONE** - Only used for AI Mode
**Recommendation**: **SKIP** - AI Mode related

### 5. handlePingMessage(ws)
**Location**: game-logic-final.js line 2707
**Code**:
```javascript
handlePingMessage(ws) {
  ws.send("PONG\r\n");
}
```
**Status**: ⚠️ **MISSING** from gameLogic.js
**Impact**: **NONE** - Already handled in socketManager.js
**Recommendation**: **OK** - Already working

### 6. handleJoinKickMode
**Location**: game-logic-final.js line 2447
**Purpose**: Separate JOIN handler for kick/imprison mode
**Status**: ⚠️ **MISSING** as separate method
**Impact**: **NONE** - Functionality merged into handleJoinAttackMode
**Recommendation**: **OK** - Already working

## Summary

### Critical Missing:
1. ❌ **getTimingLabel(mode)** - Used in logs, should be added

### Optional Missing:
1. ⚠️ **getRecoveryCode** - Code rotation handled elsewhere
2. ⚠️ **getUnattackedTargets** - Inline version exists

### Correctly Excluded:
1. ✅ **track353Users** - AI Mode related
2. ✅ **handlePingMessage** - In socketManager.js
3. ✅ **All AI Mode methods** - Correctly excluded

## Recommendation

**ADD getTimingLabel(mode)** to src/game/gameLogic.js for complete functionality.
