# 🚀 START HERE - BEST Backend Deployment

## What Is This?

This folder contains everything needed to run BEST as a **backend server** on **GitHub Actions** with API access via **Cloudflare Tunnel**.

## 📁 Folder Structure

```
github_backend/
├── .github/
│   └── workflows/
│       └── run-best-headless.yml       # GitHub Actions workflow
│
├── resources/
│   └── app/
│       ├── main.js                     # Modified: Express API server
│       ├── package.json                # Updated: express dependencies
│       ├── any.html                    # Original HTML (not used in headless)
│       ├── bestscript.js               # Original game logic
│       ├── axios.js                    # HTTP client library
│       └── require.js                  # Module loader
│
├── .gitignore                          # Git ignore rules
├── README.md                           # Complete documentation
├── QUICKSTART.md                       # Step-by-step guide
├── DEPLOYMENT_CHECKLIST.md             # Deployment checklist
└── START_HERE.md                       # This file!
```

## 🎯 What You Get

✅ **Backend API Server** - Runs on GitHub Actions (free!)
✅ **Public Access** - Via Cloudflare Tunnel (https://xxxxx.trycloudflare.com)
✅ **JSON API** - Control everything via HTTP requests
✅ **No GUI Required** - Runs in headless mode
✅ **6 Hour Runtime** - GitHub Actions limit
✅ **CORS Enabled** - Works from any web application

## 🚀 Quick Deploy (5 Minutes)

### 1. Create GitHub Repo & Push

```bash
cd github_backend
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### 2. Run Workflow

1. Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO/actions`
2. Click: **"BEST Headless Server with Cloudflare Tunnel"**
3. Click: **"Run workflow"**
4. Leave all inputs **EMPTY**
5. Set duration: **360** minutes
6. Click: **"Run workflow"**

### 3. Get Your API URL

1. Wait 30-60 seconds
2. Click on running workflow
3. Click on **"Start Cloudflare Tunnel"** step
4. Copy URL: `https://xxxxx.trycloudflare.com`

### 4. Test It!

```bash
curl https://xxxxx.trycloudflare.com/api/health
```

**Success!** 🎉 Your backend is running!

## 🌐 Use From Your Web App

```html
<!DOCTYPE html>
<html>
<body>
    <h1>BEST Controller</h1>
    <input type="text" id="tunnelUrl" placeholder="Tunnel URL" style="width:400px"><br>
    <input type="text" id="rc1" placeholder="Recovery Code 1"><br>
    <input type="text" id="planet" placeholder="Planet"><br>
    <button onclick="connect()">Connect</button>
    <pre id="output"></pre>

    <script>
        async function connect() {
            const url = document.getElementById('tunnelUrl').value;
            
            // Configure
            await fetch(`${url}/api/configure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rc1: document.getElementById('rc1').value,
                    planet: document.getElementById('planet').value,
                    device: "312"
                })
            });
            
            // Connect
            const res = await fetch(`${url}/api/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await res.json();
            document.getElementById('output').textContent = JSON.stringify(data, null, 2);
        }
    </script>
</body>
</html>
```

## 📖 Documentation

- **README.md** - Complete API reference and examples
- **QUICKSTART.md** - Step-by-step deployment guide
- **DEPLOYMENT_CHECKLIST.md** - Deployment checklist with troubleshooting

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/status` | Connection status |
| GET | `/api/logs` | Get all logs |
| POST | `/api/configure` | Set configuration (codes, planet, settings) |
| POST | `/api/connect` | Connect to game |
| POST | `/api/disconnect` | Disconnect |
| POST | `/api/send` | Send custom command |

## 📋 Configuration Example

Send this JSON to `/api/configure`:

```json
{
  "rc1": "YourCode1",
  "rc2": "YourCode2",
  "rc3": "YourCode3",
  "rc4": "YourCode4",
  "planet": "YourPlanet",
  "device": "312",
  "autorelease": true,
  "smart": true,
  "blacklist": "enemy1\nenemy2",
  "attack1": 1940,
  "waiting1": 1910
}
```

## 🎮 Complete Workflow

```
Your Web App → Tunnel URL → GitHub Actions → BEST Backend → Galaxy Game
```

1. **User opens your web app**
2. **User enters tunnel URL** (from GitHub Actions)
3. **User fills configuration** (codes, planet, settings)
4. **User clicks Connect**
5. **Your app sends JSON** to tunnel URL
6. **Backend connects** to game
7. **Your app shows status** from API

## ⚡ Key Features

- **No Pre-configuration** - Configure dynamically via API
- **Change Settings On-the-fly** - Update config without restarting
- **Real-time Monitoring** - Get status and logs via API
- **Works from Anywhere** - Access via public HTTPS URL
- **CORS Enabled** - Works from any domain

## ⚠️ Important Notes

- **Tunnel URL changes** every workflow run
- **Maximum 6 hours** per workflow run
- **Anyone with URL** can control during runtime
- **No authentication** by default (consider adding)

## 🐛 Troubleshooting

### Can't find tunnel URL?
- Wait 60 seconds after starting workflow
- Look in "Start Cloudflare Tunnel" step logs
- Search for: `https://xxxxx.trycloudflare.com`

### API returns 404?
- Double-check tunnel URL
- Ensure workflow is still running
- URL changes each run

### Connection fails?
- Verify recovery codes are correct
- Check device type: "312", "323", or "352"
- Review logs: `curl TUNNEL_URL/api/logs`

## 🎯 Next Steps

1. ✅ **Deploy to GitHub** (5 minutes)
2. ✅ **Get tunnel URL** (1 minute)
3. ✅ **Test with curl** (2 minutes)
4. ✅ **Integrate with your web app** (your time)
5. ✅ **Monitor and control remotely** (ongoing)

## 📞 Need Help?

1. Read **DEPLOYMENT_CHECKLIST.md** for detailed steps
2. Check workflow logs in Actions tab
3. Test endpoints with curl first
4. Verify JSON syntax

## 🎉 You're Ready!

This folder has **everything you need**. Just:
1. Push to GitHub
2. Run workflow
3. Get tunnel URL
4. Use API from your web app

**Happy Deploying! 🚀**

---

**Made with 💚 for BEST Backend**
