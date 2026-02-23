# Backup Folder

This folder contains the original files that have been replaced by the refactored modular structure.

## Files Moved to Backup:

### Original Implementation Files:
1. **game-logic-final.js** (3,609 lines)
   - Original monolithic game logic file
   - Replaced by modular `src/` folder structure
   - ⚠️ Kept for reference only

### Legacy/Unused Files:
2. **require.js** - Old require implementation (not used)

### Documentation Files:
3. **METHOD_COMPARISON.md** - Comparison of methods between old and new structure
4. **MISSING_ITEMS.md** - Analysis of missing items (all resolved)

## Files Kept in Active Directory:

### Required for GUI Mode:
- **any.html** - GUI interface (used by Electron when not in headless mode)
- **axios.js** - Required by any.html
- **bestscript.js** - Required by any.html for GUI functionality

### Active Modular Structure:
```
resources/app/
├── src/
│   ├── config/
│   │   └── appState.js (163 lines)
│   ├── game/
│   │   └── gameLogic.js (627 lines)
│   ├── network/
│   │   ├── connectionManager.js (70 lines)
│   │   └── socketManager.js (204 lines)
│   └── utils/
│       └── helpers.js (32 lines)
├── main.js (entry point - uses src/ for headless, any.html for GUI)
├── any.html (GUI interface)
├── axios.js (GUI dependency)
├── bestscript.js (GUI dependency)
├── package.json
└── start-headless.js

Total modular code: 1,096 lines (70% reduction from 3,609 lines)
```

## Architecture:

### Headless Mode (API Server):
- Uses `src/` folder structure
- No GUI dependencies loaded
- Pure Node.js API server

### GUI Mode (Electron):
- Uses `any.html` + `bestscript.js` + `axios.js`
- Electron window with legacy UI
- Controlled via `main.js`

## What Was Removed from Active Code:
- AI Mode functionality (~800 lines, 25 methods)
- Duplicate code and redundancy
- Legacy implementations

## What Was Kept:
- All 43 non-AI methods
- All game modes (normal, low sec, BAN, kick, imprison)
- Timer Shift feature
- Smart Mode feature
- OffSleep auto-reconnect
- Prison escape functionality
- All API endpoints
- GUI mode support

## Date: January 10, 2026
