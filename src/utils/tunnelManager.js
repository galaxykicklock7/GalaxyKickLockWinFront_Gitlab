/**
 * 🌐 Tunnel Connection Manager
 * Manages multiple tunnel connections with automatic failover and health monitoring
 *
 * Features:
 * - Up to 3 simultaneous tunnel connections
 * - Health monitoring for each tunnel
 * - Automatic failover when tunnel fails
 * - Load balancing across healthy tunnels
 * - Recovery attempts for degraded tunnels
 */

class TunnelManager {
  constructor(maxTunnels = 3) {
    this.maxTunnels = maxTunnels;
    this.tunnels = []; // Array of tunnel configs: { url, index, status, failureCount, responseTime }
    this.currentTunnelIndex = 0;
    this.healthCheckInterval = null;
    this.HEALTH_CHECK_INTERVAL_MS = 5000; // Check health every 5 seconds
    this.FAILURE_THRESHOLD = 3; // Mark tunnel as offline after 3 failures
    this.OFFLINE_RECOVERY_MS = 30000; // Try to recover offline tunnel after 30 seconds
  }

  /**
   * Add a new tunnel URL to the pool
   * @param {string} url - Tunnel URL (e.g., https://bharanitest007.loca.lt)
   * @returns {boolean} - Success or failure
   */
  addTunnel(url) {
    // Check if already exists
    if (this.tunnels.some(t => t.url === url)) {
      console.warn(`🌐 Tunnel already exists: ${url}`);
      return false;
    }

    // Check max tunnels
    if (this.tunnels.length >= this.maxTunnels) {
      console.warn(`🌐 Max tunnels (${this.maxTunnels}) reached. Remove one first.`);
      return false;
    }

    const tunnel = {
      url,
      index: this.tunnels.length,
      status: 'HEALTHY', // HEALTHY, DEGRADED, OFFLINE
      failureCount: 0,
      responseTime: 0,
      lastHealthCheck: null,
      lastFailureTime: null
    };

    this.tunnels.push(tunnel);
    console.log(`✅ Tunnel added: ${url} (${this.tunnels.length}/${this.maxTunnels})`);

    // Auto-start health checks if not running
    if (!this.healthCheckInterval) {
      this.startHealthChecks();
    }

    return true;
  }

  /**
   * Remove a tunnel from the pool
   * @param {string} url - Tunnel URL to remove
   * @returns {boolean} - Success or failure
   */
  removeTunnel(url) {
    const index = this.tunnels.findIndex(t => t.url === url);
    if (index === -1) {
      console.warn(`🌐 Tunnel not found: ${url}`);
      return false;
    }

    this.tunnels.splice(index, 1);
    console.log(`❌ Tunnel removed: ${url} (${this.tunnels.length}/${this.maxTunnels} remaining)`);

    // Reset index if needed
    if (this.currentTunnelIndex >= this.tunnels.length) {
      this.currentTunnelIndex = 0;
    }

    // Stop health checks if no tunnels left
    if (this.tunnels.length === 0) {
      this.stopHealthChecks();
    }

    return true;
  }

  /**
   * Get the next healthy tunnel for routing
   * @returns {object|null} - Tunnel config or null if all offline
   */
  getHealthyTunnel() {
    if (this.tunnels.length === 0) {
      return null;
    }

    // Find healthy tunnels, prefer fastest
    const healthyTunnels = this.tunnels.filter(t => t.status === 'HEALTHY');

    if (healthyTunnels.length > 0) {
      // Sort by response time (fastest first)
      healthyTunnels.sort((a, b) => a.responseTime - b.responseTime);
      return healthyTunnels[0];
    }

    // No healthy tunnels - try degraded
    const degradedTunnels = this.tunnels.filter(t => t.status === 'DEGRADED');
    if (degradedTunnels.length > 0) {
      console.warn(`⚠️ All tunnels degraded, using: ${degradedTunnels[0].url}`);
      return degradedTunnels[0];
    }

    // All offline - return first to trigger error
    console.error(`❌ All tunnels offline!`);
    return this.tunnels[0];
  }

  /**
   * Record a successful request (reduce failure count, update response time)
   * @param {string} url - Tunnel URL
   * @param {number} responseTime - Response time in ms
   */
  recordSuccess(url, responseTime) {
    const tunnel = this.tunnels.find(t => t.url === url);
    if (!tunnel) return;

    tunnel.responseTime = responseTime;
    tunnel.failureCount = 0;

    if (tunnel.status !== 'HEALTHY') {
      tunnel.status = 'HEALTHY';
      console.log(`✅ Tunnel recovered: ${url}`);
    }
  }

  /**
   * Record a failed request (increment failure count, check threshold)
   * @param {string} url - Tunnel URL
   * @param {string} error - Error message/code
   */
  recordFailure(url, error) {
    const tunnel = this.tunnels.find(t => t.url === url);
    if (!tunnel) return;

    tunnel.failureCount++;
    tunnel.lastFailureTime = Date.now();

    // Check if should mark as offline
    if (tunnel.failureCount >= this.FAILURE_THRESHOLD) {
      if (tunnel.status !== 'OFFLINE') {
        tunnel.status = 'OFFLINE';
        console.error(`🔴 Tunnel marked OFFLINE: ${url} (${tunnel.failureCount} failures)`);
      }
    } else if (tunnel.failureCount >= 1) {
      if (tunnel.status === 'HEALTHY') {
        tunnel.status = 'DEGRADED';
        console.warn(`⚠️ Tunnel degraded: ${url} (${tunnel.failureCount}/${this.FAILURE_THRESHOLD} failures)`);
      }
    }
  }

  /**
   * Start health monitoring (periodic ping to all tunnels)
   */
  startHealthChecks() {
    if (this.healthCheckInterval) {
      console.log(`🏥 Health checks already running`);
      return;
    }

    console.log(`🏥 Starting tunnel health checks every ${this.HEALTH_CHECK_INTERVAL_MS}ms`);

    this.healthCheckInterval = setInterval(async () => {
      for (const tunnel of this.tunnels) {
        // Try to recover offline tunnels
        if (tunnel.status === 'OFFLINE') {
          const timeSinceFailure = Date.now() - tunnel.lastFailureTime;
          if (timeSinceFailure >= this.OFFLINE_RECOVERY_MS) {
            console.log(`🔄 Attempting to recover offline tunnel: ${tunnel.url}`);
            tunnel.failureCount = 0;
            tunnel.status = 'DEGRADED';
          } else {
            continue; // Skip health check for offline tunnels still in recovery period
          }
        }

        // Health check - simple ping to /api/health
        try {
          const startTime = Date.now();
          const response = await fetch(`${tunnel.url}/api/health`, {
            headers: { 'bypass-tunnel-reminder': 'true' }
          });
          const responseTime = Date.now() - startTime;

          if (response.ok) {
            this.recordSuccess(tunnel.url, responseTime);
          } else {
            this.recordFailure(tunnel.url, `HTTP ${response.status}`);
          }
        } catch (error) {
          this.recordFailure(tunnel.url, error.message);
        }
      }

      this.logTunnelStatus();
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop health monitoring
   */
  stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log(`🏥 Health checks stopped`);
    }
  }

  /**
   * Log current status of all tunnels
   */
  logTunnelStatus() {
    console.log(`\n🌐 TUNNEL STATUS:`);
    this.tunnels.forEach((tunnel, idx) => {
      const icon =
        tunnel.status === 'HEALTHY' ? '✅' :
        tunnel.status === 'DEGRADED' ? '⚠️' : '🔴';
      console.log(`   ${icon} [${idx}] ${tunnel.url.split('://')[1]} - ${tunnel.status} (${tunnel.failureCount}/${this.FAILURE_THRESHOLD} failures, ${tunnel.responseTime}ms)`);
    });
    console.log();
  }

  /**
   * Get all tunnels with their status
   */
  getTunnelStatus() {
    return this.tunnels.map(t => ({
      url: t.url,
      status: t.status,
      failureCount: t.failureCount,
      responseTime: t.responseTime
    }));
  }

  /**
   * Clear all tunnels
   */
  clear() {
    this.stopHealthChecks();
    this.tunnels = [];
    this.currentTunnelIndex = 0;
    console.log(`🌐 All tunnels cleared`);
  }
}

// Export singleton instance
export const tunnelManager = new TunnelManager(3);

export default TunnelManager;
