/**
 * 🌐 Tunnel Connection Manager — Enterprise Edition
 *
 * Strategy: PASSIVE-FIRST health monitoring
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  All tunnels HEALTHY → no polling at all                │
 * │  A tunnel degrades  → poll only THAT tunnel to recover  │
 * │  Tab hidden         → pause all polling                 │
 * │  Back online        → resume via navigator.onLine       │
 * └──────────────────────────────────────────────────────────┘
 *
 * Real traffic = the health signal.
 * Explicit pings only when a tunnel is DEGRADED/OFFLINE.
 */

class TunnelManager {
  constructor(maxTunnels = 3) {
    this.maxTunnels = maxTunnels;
    this.tunnels = [];
    this.FAILURE_THRESHOLD = 3;

    // Adaptive poll intervals (ms)
    this.DEGRADED_POLL_MS  = 10000;  // Poll degraded tunnels every 10s
    this.OFFLINE_POLL_MS   = 30000;  // Poll offline tunnels every 30s

    // Per-tunnel recovery timers (Map<url, timerId>)
    this._recoveryTimers = new Map();

    // Visibility / online listeners (store refs for cleanup)
    this._onVisibilityChange = this._handleVisibilityChange.bind(this);
    this._onOnline            = this._handleOnline.bind(this);
    this._onOffline           = this._handleOffline.bind(this);

    // Register browser events
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('online',  this._onOnline);
    window.addEventListener('offline', this._onOffline);
  }

  // ─────────────────────────────────────────────
  //  PUBLIC API
  // ─────────────────────────────────────────────

  addTunnel(url) {
    if (this.tunnels.some(t => t.url === url)) return false;
    if (this.tunnels.length >= this.maxTunnels) return false;

    this.tunnels.push({
      url,
      status: 'HEALTHY',
      failureCount: 0,
      responseTime: 0,
      lastFailureTime: null,
    });

    console.log(`✅ Tunnel added: ${url} (${this.tunnels.length}/${this.maxTunnels})`);
    return true;
  }

  removeTunnel(url) {
    const idx = this.tunnels.findIndex(t => t.url === url);
    if (idx === -1) return false;
    this.tunnels.splice(idx, 1);
    this._cancelRecovery(url);
    if (this.tunnels.length === 0) this._cancelAllRecovery();
    return true;
  }

  getHealthyTunnel() {
    if (this.tunnels.length === 0) return null;

    const healthy = this.tunnels.filter(t => t.status === 'HEALTHY');
    if (healthy.length > 0) {
      // Pick fastest; ties broken by array order
      return healthy.reduce((a, b) => (a.responseTime <= b.responseTime ? a : b));
    }

    const degraded = this.tunnels.filter(t => t.status === 'DEGRADED');
    if (degraded.length > 0) return degraded[0];

    return this.tunnels[0]; // all offline — caller will handle error
  }

  /** Called by api.js on every successful HTTP response */
  recordSuccess(url, responseTime) {
    const t = this._find(url);
    if (!t) return;

    const wasUnhealthy = t.status !== 'HEALTHY';
    t.responseTime  = responseTime;
    t.failureCount  = 0;
    t.status        = 'HEALTHY';

    if (wasUnhealthy) {
      console.log(`✅ Tunnel recovered (via real traffic): ${url}`);
      this._cancelRecovery(url);
    }
  }

  /** Called by api.js on every failed HTTP response */
  recordFailure(url, error) {
    const t = this._find(url);
    if (!t) return;

    t.failureCount++;
    t.lastFailureTime = Date.now();

    if (t.failureCount >= this.FAILURE_THRESHOLD) {
      if (t.status !== 'OFFLINE') {
        t.status = 'OFFLINE';
        console.warn(`🔴 Tunnel OFFLINE: ${url}`);
        this._scheduleRecovery(url, this.OFFLINE_POLL_MS);
      }
    } else {
      if (t.status === 'HEALTHY') {
        t.status = 'DEGRADED';
        console.warn(`⚠️ Tunnel DEGRADED: ${url} (${t.failureCount}/${this.FAILURE_THRESHOLD})`);
        this._scheduleRecovery(url, this.DEGRADED_POLL_MS);
      }
    }
  }

  getTunnelStatus() {
    return this.tunnels.map(({ url, status, failureCount, responseTime }) =>
      ({ url, status, failureCount, responseTime })
    );
  }

  logTunnelStatus() {
    const icons = { HEALTHY: '✅', DEGRADED: '⚠️', OFFLINE: '🔴' };
    console.log('\n🌐 TUNNEL STATUS:');
    this.tunnels.forEach((t, i) => {
      console.log(`   ${icons[t.status] || '❓'} [${i}] ${t.url.replace('https://', '')} - ${t.status} (${t.failureCount}/${this.FAILURE_THRESHOLD} failures, ${t.responseTime}ms)`);
    });
  }

  clear() {
    this._cancelAllRecovery();
    this.tunnels = [];
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    window.removeEventListener('online',  this._onOnline);
    window.removeEventListener('offline', this._onOffline);
  }

  // ─────────────────────────────────────────────
  //  PRIVATE — Recovery scheduling
  // ─────────────────────────────────────────────

  /**
   * Schedule a single probe for a degraded/offline tunnel.
   * Uses setTimeout (fires once) not setInterval (fires forever).
   * On failure → reschedules itself. On success → stops.
   */
  _scheduleRecovery(url, delayMs) {
    this._cancelRecovery(url); // prevent duplicates

    const id = setTimeout(async () => {
      this._recoveryTimers.delete(url);

      if (document.hidden || !navigator.onLine) {
        // Tab hidden or browser offline — reschedule without pinging
        this._scheduleRecovery(url, delayMs);
        return;
      }

      const t = this._find(url);
      if (!t || t.status === 'HEALTHY') return; // already recovered via real traffic

      try {
        const start = Date.now();
        const res = await fetch(`${url}/api/health`, {
          method: 'GET',
          headers: { 'bypass-tunnel-reminder': 'true' },
          signal: AbortSignal.timeout(8000), // 8 s timeout — don't hang forever
        });
        const rt = Date.now() - start;

        if (res.ok) {
          this.recordSuccess(url, rt);
          // Recovered → no more scheduled pings needed
        } else {
          this.recordFailure(url, `HTTP ${res.status}`);
          // Still unhealthy → reschedule at OFFLINE interval
          this._scheduleRecovery(url, this.OFFLINE_POLL_MS);
        }
      } catch {
        this.recordFailure(url, 'probe-timeout');
        this._scheduleRecovery(url, this.OFFLINE_POLL_MS);
      }
    }, delayMs);

    this._recoveryTimers.set(url, id);
  }

  _cancelRecovery(url) {
    const id = this._recoveryTimers.get(url);
    if (id !== undefined) {
      clearTimeout(id);
      this._recoveryTimers.delete(url);
    }
  }

  _cancelAllRecovery() {
    for (const id of this._recoveryTimers.values()) clearTimeout(id);
    this._recoveryTimers.clear();
  }

  // ─────────────────────────────────────────────
  //  PRIVATE — Browser event handlers
  // ─────────────────────────────────────────────

  _handleVisibilityChange() {
    if (!document.hidden) {
      // Tab became visible — do one immediate probe on unhealthy tunnels
      this.tunnels
        .filter(t => t.status !== 'HEALTHY')
        .forEach(t => {
          // Re-schedule immediately (1 s) to catch up
          this._scheduleRecovery(t.url, 1000);
        });
    }
    // When hidden — existing timeouts simply wait; no extra work needed
  }

  _handleOnline() {
    console.log('🌐 Browser back online — probing unhealthy tunnels');
    this.tunnels
      .filter(t => t.status !== 'HEALTHY')
      .forEach(t => this._scheduleRecovery(t.url, 500));
  }

  _handleOffline() {
    console.warn('🌐 Browser offline — pausing tunnel probes');
    // Timers are still scheduled but _scheduleRecovery guards against pinging
  }

  _find(url) {
    return this.tunnels.find(t => t.url === url) || null;
  }

  // ─────────────────────────────────────────────
  //  Legacy-compat stubs (so nothing breaks)
  // ─────────────────────────────────────────────
  startHealthChecks() { /* no-op — probes are demand-driven now */ }
  stopHealthChecks()  { this._cancelAllRecovery(); }
}

// Singleton
export const tunnelManager = new TunnelManager(3);
export default TunnelManager;
