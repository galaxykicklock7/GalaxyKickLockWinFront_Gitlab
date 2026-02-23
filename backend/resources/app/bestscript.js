
// UI Tab switching logic (moved from inline script)
function openPage(pageName, elmnt, color) {
  var i, tabcontent, tablinks;
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }
  tablinks = document.getElementsByClassName("tablink");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].style.backgroundColor = "";
  }
  document.getElementById(pageName).style.display = "block";
  elmnt.style.backgroundColor = color;
}

// Initial tab open
document.getElementById("defaultOpen").click();

// ==========================================
// FRONTEND CONTROLLER FOR NEW BACKEND API
// ==========================================
const API_URL = "http://localhost:3000/api";

// Elements
const btnConnect = document.getElementById("btn-connect");
const btnDisconnect = document.getElementById("btn-disconnect");
const btnRelease = document.getElementById("releasenow");
// Log divs
const logDivs = {
  1: document.getElementById("log1"),
  2: document.getElementById("log2"),
  3: document.getElementById("log3"),
  4: document.getElementById("log4"), // Actually log4/5 might be mapped differently in UI
  5: document.getElementById("log4")  // UI only has 4 log boxes?
};

// helper to get value safely
const val = (id) => {
  const el = document.getElementById(id);
  return el ? (el.type === 'checkbox' ? el.checked : el.value) : null;
};

// Connect Button Handler
btnConnect.addEventListener("click", async () => {
  console.log("Connect clicked - gathering config...");

  // Gather all configuration from UI
  const config = {
    // Connection Codes
    rc1: val("rc1"), rcl1: val("rcl1"),
    rc2: val("rc2"), rcl2: val("rcl2"),
    rc3: val("rc3"), rcl3: val("rcl3"),
    rc4: val("rc4"), rcl4: val("rcl4"),
    rc5: val("kickrc"), // Mapped to rc5 internally

    // Settings
    planet: val("planet"),

    // Attack/Def values
    attack1: val("attack1"), waiting1: val("waiting1"),
    attack2: val("attack2"), waiting2: val("waiting2"),
    attack3: val("attack3"), waiting3: val("waiting3"),
    attack4: val("attack4"), waiting4: val("waiting4"),

    // Features
    autorelease: val("autorelease"),
    smart: val("smart"),
    lowsecmode: val("lowsecmode"),
    exitting: val("exitting"), // Exit mode
    sleeping: val("sleeping"), // Sleep mode

    // Kick/Ban modes
    kickmode: val("modekick"), // true if checked
    modena: val("modena"),
    kickall: val("kickall"),
    kickbybl: val("kickbybl"),
    dadplus: val("dadplus"),

    // Timer shift
    timershift: val("timershift"),
    incrementvalue: val("incrementvalue"),
    decrementvalue: val("decrementvalue"),
    minatk: val("minatk"), maxatk: val("maxatk"),
    mindef: val("mindef"), maxdef: val("maxdef"),

    // Lists
    blacklist: val("blacklist"),
    gangblacklist: val("gangblacklist"),
    kblacklist: val("kblacklist"),
    kgangblacklist: val("kgangblacklist"),

    // Reconnect settings
    reconnect: val("reconnect")
  };

  // Save to local storage for persistence (legacy behavior users expect)
  localStorage.setItem("rc1", config.rc1);
  localStorage.setItem("planet", config.planet);
  // ... (can add more but config sent to backend is key)

  try {
    // 1. Send Configuration
    await axios.post(`${API_URL}/configure`, config);
    console.log("Configuration sent to backend.");

    // 2. Trigger Connect
    await axios.post(`${API_URL}/connect`, {});
    console.log("Connect signal sent.");

  } catch (error) {
    console.error("Error connecting:", error);
    alert("Failed to connect to backend: " + error.message);
  }
});

// Disconnect Button
btnDisconnect.addEventListener("click", async () => {
  try {
    await axios.post(`${API_URL}/disconnect`, {});
    console.log("Disconnect signal sent.");
  } catch (e) { console.error(e); }
});

// Release All Button (Manually trigger escape)
if (btnRelease) {
  btnRelease.addEventListener("click", async () => {
    // We can create a specific endpoint for this or just rely on backend auto-release logic re-trigger
    // For now, let's just re-send config enabling auto-release
    const config = { autorelease: true };
    await axios.post(`${API_URL}/configure`, config);
    // Note: Real "force escape" might need a specific endpoint, but usually config update is enough 
    // if the backend checks state loop.
    console.log("Release signal sent (enabled autorelease).");
  });
}

// Fly Button (Join/Rejoin Planet)
const btnFly = document.getElementById("plntgo");
if (btnFly) {
  btnFly.addEventListener("click", async () => {
    try {
      const planet = val("planet");
      if (!planet || planet.trim() === "") {
        alert("Please enter a planet name");
        return;
      }
      
      console.log(`Flying to planet: ${planet}`);
      const response = await axios.post(`${API_URL}/fly`, { planet: planet.trim() });
      console.log("Fly response:", response.data);
      
      if (response.data.success) {
        console.log(`✅ ${response.data.message}`);
      } else {
        console.error("Fly failed:", response.data);
        alert("Failed to fly: " + response.data.message);
      }
    } catch (error) {
      console.error("Error flying:", error);
      alert("Failed to fly: " + error.message);
    }
  });
}

// Stats / Logs Polling
setInterval(async () => {
  try {
    const response = await axios.get(`${API_URL}/logs`);
    const logs = response.data;

    // Update Log Divs
    // logs object structure: { log1: [...], log2: [...], ... }
    if (logs) {
      updateLogDiv("log1", logs.log1);
      updateLogDiv("log2", logs.log2);
      updateLogDiv("log3", logs.log3);
      updateLogDiv("log4", logs.log4);
      // If there's a log5 and a UI for it, add here. Currently UI only has 4.
    }
  } catch (e) {
    // Silent fail on polling error (e.g. if server restarting)
  }
}, 1000);

function updateLogDiv(imgId, messages) {
  const el = document.getElementById(imgId);
  if (!el || !messages) return;

  // Convert message list to HTML
  // We only take the last 20 messages to keep UI clean/fast
  const recent = messages.slice(-50);
  const html = recent.map(m => `<div><span style="color:#aaa">[${m.timestamp.split('T')[1].split('.')[0]}]</span> ${m.message}</div>`).join('');

  // Only update if changed to avoid scroll glitches
  if (el.innerHTML !== html) {
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }
}
