# BEST Headless Backend

Run BEST game automation on GitHub Codespaces or GitHub Actions with HTTP API control.

---

## 🚀 Quick Start - Test in Codespaces

### **Step 1: Open Codespace**
1. Go to: https://github.com/galaxykicklock7/GalaxyKickPipelineWin
2. Click **Code** → **Codespaces** → **Create codespace on main**

### **Step 2: Install System Dependencies**
```bash
sudo apt-get update && sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libatspi2.0-0 libgdk-pixbuf2.0-0 \
  libgtk-3-0 xvfb

# Install audio library (Ubuntu version detection)
sudo apt-get install -y libasound2t64 || sudo apt-get install -y libasound2
```

### **Step 3: Install Node Dependencies**
```bash
cd resources/app
npm install
```

### **Step 4: Start BEST**
```bash
# Start virtual display
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99

# Start BEST in headless mode
npm run headless
```

You should see:
```
🚀 BEST Headless API Server started on port 3000
✅ Headless mode active
```

---

## 📡 API Usage (Open New Terminal)

### **1. Health Check**
```bash
curl http://localhost:3000/api/health
```

**Response:**
```json
{
  "status": "ok",
  "mode": "headless",
  "timestamp": "2025-11-02T16:00:00.000Z"
}
```

### **2. Configure**
```bash
curl -X POST http://localhost:3000/api/configure \
  -H "Content-Type: application/json" \
  -d '{
    "rc1": "yourcode123",
    "rc2": "",
    "rc3": "",
    "rc4": "",
    "kickrc": "",
    "rcl1": "",
    "rcl2": "",
    "rcl3": "",
    "rcl4": "",
    "planet": "THE_BOT",
    "device": "312",
    "blacklist": "Enemy1\nEnemy2",
    "gangblacklist": "[EVIL]",
    "kblacklist": "",
    "kgangblacklist": "",
    "autorelease": true,
    "exitting": true,
    "sleeping": false,
    "smart": false,
    "lowsecmode": false,
    "kickmode": true,
    "modena": false,
    "kickbybl": false,
    "dadplus": false,
    "kickall": false,
    "attack1": 1940,
    "attack2": 1940,
    "attack3": 1940,
    "attack4": 1940,
    "waiting1": 1910,
    "waiting2": 1910,
    "waiting3": 1910,
    "waiting4": 1910,
    "timershift": false,
    "incrementvalue": 10,
    "decrementvalue": 10,
    "minatk": 1000,
    "maxatk": 3000,
    "mindef": 1000,
    "maxdef": 3000,
    "reconnect": 5000
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated",
  "config": {...}
}
```

**Important Notes:**
- For **attack mode**: Use `rc1-4` or `rcl1-4` with `blacklist` and `gangblacklist`
- For **kick mode**: You MUST provide `kickrc` (a separate recovery code) and set `kickbybl: true` or `kickall: true`
- Kick uses `kblacklist` and `kgangblacklist` for kick-specific targets, but also checks `blacklist` and `gangblacklist` when `kickbybl: true`

**Kick Configuration Example:**
```bash
curl -X POST http://localhost:3000/api/configure \
  -H "Content-Type: application/json" \
  -d '{
    "kickrc": "your_kick_code_here",
    "planet": "THE_BOT",
    "device": "312",
    "blacklist": "[L][E][0]",
    "gangblacklist": "[EVIL]",
    "kblacklist": "BadUser1\nBadUser2",
    "kgangblacklist": "[KICK]",
    "kickmode": true,
    "kickbybl": true,
    "kickall": false
  }'
```

### **3. Connect**
```bash
curl -X POST http://localhost:3000/api/connect \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "Connected 1 WebSocket(s)",
  "connected": 1
}
```

### **4. Check Status**
```bash
curl http://localhost:3000/api/status
```

**Response:**
```json
{
  "connected": true,
  "websockets": {
    "ws1": true,
    "ws2": false,
    ...
  },
  "gameStates": {
    "logic1": {
      "username": "[R]OLE[X]",
      "targetCount": 2,
      "status": "attack"
    }
  }
}
```

### **5. Get Logs**
```bash
curl http://localhost:3000/api/logs
```

### **6. Disconnect**
```bash
curl -X POST http://localhost:3000/api/disconnect \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "Disconnected all WebSockets"
}
```

---

## 📋 Quick Test Script

Save this as `test.sh` and run it:

```bash
#!/bin/bash

echo "=== Testing BEST API ==="

# Health check
echo -e "\n1. Health Check:"
curl -s http://localhost:3000/api/health | jq .

# Configure
echo -e "\n2. Configure:"
curl -s -X POST http://localhost:3000/api/configure \
  -H "Content-Type: application/json" \
  -d '{
    "rc1": "yourcode123",
    "planet": "THE_BOT",
    "device": "312",
    "blacklist": "Enemy1\nEnemy2",
    "gangblacklist": "[EVIL]",
    "autorelease": true,
    "exitting": true,
    "attack1": 1940,
    "waiting1": 1910,
    "timershift": false,
    "reconnect": 5000
  }' | jq .

# Connect
echo -e "\n3. Connect:"
curl -s -X POST http://localhost:3000/api/connect \
  -H "Content-Type: application/json" | jq .

# Wait
sleep 10

# Status
echo -e "\n4. Status:"
curl -s http://localhost:3000/api/status | jq .

# Logs
echo -e "\n5. Logs:"
curl -s http://localhost:3000/api/logs | jq '.logs.log1'

# Disconnect
echo -e "\n6. Disconnect:"
curl -s -X POST http://localhost:3000/api/disconnect \
  -H "Content-Type: application/json" | jq .

echo -e "\n=== Test Complete ==="
```

Run: `chmod +x test.sh && ./test.sh`

---

## 🌐 Deploy to GitHub Actions

Once tested in Codespaces:

1. Go to: https://github.com/galaxykicklock7/GalaxyKickPipelineWin/actions
2. Run workflow: **"BEST Headless Server with LocalTunnel (Linux)"**
3. Get your public URL: `https://your-subdomain.loca.lt`
4. Use same API commands (add `bypass-tunnel-reminder: true` header)

---

## 📚 More Documentation

- **CURL_COMMANDS.md** - More API examples
- **COMPREHENSIVE_VERIFICATION.md** - Feature verification
- **FILE_STRUCTURE.md** - Project structure

---

## ✅ Features

**100% feature parity with desktop bestscript.js:**
- Complete game automation logic
- All attack modes (normal, defense, low sec)
- Timer shift optimization
- Prison auto-escape
- Target detection and tracking
- Auto-reconnect support

**Repository:** https://github.com/galaxykicklock7/GalaxyKickPipelineWin
