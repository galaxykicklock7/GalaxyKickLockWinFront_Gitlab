/**
 * Backend Connection Manager
 *
 * Manages a single Railway backend URL with lightweight health tracking:
 *   - Records success/failure from real API traffic
 *   - Schedules recovery probes only when backend is unhealthy
 */

class ConnectionManager {
  constructor() {
    this.backend = null; // { url, status, failureCount, responseTime }
    this.FAILURE_THRESHOLD = 5;
    this.RECOVERY_POLL_MS = 10000; // 10s between recovery probes
    this._recoveryTimer = null;

    // Browser event handlers
    this._onVisibilityChange = this._handleVisibilityChange.bind(this);
    this._onOnline = this._handleOnline.bind(this);

    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('online', this._onOnline);
  }

  // ─────────────────────────────────────────────
  //  PUBLIC API
  // ─────────────────────────────────────────────

  setUrl(url) {
    if (!url) return false;
    this._cancelRecovery();
    this.backend = {
      url,
      status: 'HEALTHY',
      failureCount: 0,
      responseTime: 0,
    };
    console.log(`Backend URL set: ${url}`);
    return true;
  }

  getUrl() {
    return this.backend?.url || null;
  }

  getStatus() {
    if (!this.backend) return [];
    const { url, status, failureCount, responseTime } = this.backend;
    return [{ url, status, failureCount, responseTime }];
  }

  recordSuccess(url, responseTime) {
    if (!this.backend || this.backend.url !== url) return;

    const wasUnhealthy = this.backend.status !== 'HEALTHY';
    this.backend.responseTime = responseTime;
    this.backend.failureCount = 0;
    this.backend.status = 'HEALTHY';

    if (wasUnhealthy) {
      console.log(`Backend recovered: ${url}`);
      this._cancelRecovery();
    }
  }

  recordFailure(url, error) {
    if (!this.backend || this.backend.url !== url) return;

    this.backend.failureCount++;

    if (this.backend.failureCount >= this.FAILURE_THRESHOLD) {
      if (this.backend.status !== 'OFFLINE') {
        this.backend.status = 'OFFLINE';
        console.warn(`Backend OFFLINE: ${url}`);
        this._scheduleRecovery();
      }
    } else if (this.backend.status === 'HEALTHY') {
      this.backend.status = 'DEGRADED';
      console.warn(`Backend DEGRADED: ${url} (${this.backend.failureCount}/${this.FAILURE_THRESHOLD})`);
      this._scheduleRecovery();
    }
  }

  clear() {
    this._cancelRecovery();
    this.backend = null;
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    window.removeEventListener('online', this._onOnline);
  }

  // ─────────────────────────────────────────────
  //  PRIVATE — Recovery
  // ─────────────────────────────────────────────

  _scheduleRecovery() {
    this._cancelRecovery();

    this._recoveryTimer = setTimeout(async () => {
      this._recoveryTimer = null;

      if (document.hidden || !navigator.onLine) {
        this._scheduleRecovery();
        return;
      }

      if (!this.backend || this.backend.status === 'HEALTHY') return;

      try {
        const start = Date.now();
        const res = await fetch(`${this.backend.url}/api/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(8000),
        });
        const rt = Date.now() - start;

        if (res.ok) {
          this.recordSuccess(this.backend.url, rt);
        } else {
          this.recordFailure(this.backend.url, `HTTP ${res.status}`);
          this._scheduleRecovery();
        }
      } catch {
        this.recordFailure(this.backend.url, 'probe-timeout');
        this._scheduleRecovery();
      }
    }, this.RECOVERY_POLL_MS);
  }

  _cancelRecovery() {
    if (this._recoveryTimer !== null) {
      clearTimeout(this._recoveryTimer);
      this._recoveryTimer = null;
    }
  }

  _handleVisibilityChange() {
    if (!document.hidden && this.backend && this.backend.status !== 'HEALTHY') {
      this._scheduleRecovery();
    }
  }

  _handleOnline() {
    if (this.backend && this.backend.status !== 'HEALTHY') {
      console.log('Browser back online — probing backend');
      this._scheduleRecovery();
    }
  }
}

// Singleton
export const connectionManager = new ConnectionManager();
export default ConnectionManager;
