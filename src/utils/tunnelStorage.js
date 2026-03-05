/**
 * 🌐 Tunnel Storage Utility
 * Manages persistence of tunnel URLs in localStorage
 * Coordinates with tunnelManager for seamless tunnel management
 */

import { storageManager } from './storageManager';
import { tunnelManager } from './tunnelManager';

const TUNNEL_STORAGE_KEY = 'galaxyTunnels';
const ACTIVE_TUNNEL_KEY = 'activeTunnelUrl';

export const tunnelStorage = {
  /**
   * Save all tunnels to localStorage
   * @param {Array} tunnels - Array of tunnel URLs
   */
  saveTunnels(tunnels) {
    try {
      if (!Array.isArray(tunnels)) {
        console.warn('Invalid tunnels array');
        return false;
      }
      storageManager.setItem(TUNNEL_STORAGE_KEY, JSON.stringify(tunnels));
      console.log(`✅ Saved ${tunnels.length} tunnels to storage`);
      return true;
    } catch (error) {
      console.error('Failed to save tunnels:', error);
      return false;
    }
  },

  /**
   * Load all tunnels from localStorage
   * @returns {Array} - Array of tunnel URLs
   */
  loadTunnels() {
    try {
      const stored = storageManager.getItem(TUNNEL_STORAGE_KEY);
      if (!stored) {
        console.log('No tunnels in storage');
        return [];
      }
      const tunnels = JSON.parse(stored);
      console.log(`✅ Loaded ${tunnels.length} tunnels from storage`);
      return Array.isArray(tunnels) ? tunnels : [];
    } catch (error) {
      console.error('Failed to load tunnels:', error);
      return [];
    }
  },

  /**
   * Add a tunnel URL to storage and tunnel manager
   * @param {string} url - Tunnel URL
   * @returns {boolean} - Success or failure
   */
  addTunnel(url) {
    if (!url || typeof url !== 'string') {
      console.warn('Invalid tunnel URL:', url);
      return false;
    }

    // Validate URL format
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      console.warn('Tunnel URL must start with https:// or http://:', url);
      return false;
    }

    // Add to tunnel manager first
    const success = tunnelManager.addTunnel(url);
    if (!success) {
      return false;
    }

    // Get current tunnels from storage
    const tunnels = this.loadTunnels();

    // Add if not already there
    if (!tunnels.includes(url)) {
      tunnels.push(url);
      this.saveTunnels(tunnels);
      console.log(`✅ Tunnel added to storage: ${url}`);
    }

    return true;
  },

  /**
   * Remove a tunnel URL from storage and tunnel manager
   * @param {string} url - Tunnel URL
   * @returns {boolean} - Success or failure
   */
  removeTunnel(url) {
    // Remove from tunnel manager first
    const success = tunnelManager.removeTunnel(url);
    if (!success) {
      return false;
    }

    // Remove from storage
    const tunnels = this.loadTunnels();
    const filtered = tunnels.filter(t => t !== url);

    if (filtered.length !== tunnels.length) {
      this.saveTunnels(filtered);
      console.log(`✅ Tunnel removed from storage: ${url}`);
      return true;
    }

    return false;
  },

  /**
   * Set the active tunnel (primary tunnel to use)
   * @param {string} url - Tunnel URL
   */
  setActiveTunnel(url) {
    storageManager.setItem(ACTIVE_TUNNEL_KEY, url);
    console.log(`✅ Active tunnel set to: ${url}`);
  },

  /**
   * Get the active tunnel
   * @returns {string|null} - Tunnel URL or null
   */
  getActiveTunnel() {
    return storageManager.getItem(ACTIVE_TUNNEL_KEY);
  },

  /**
   * Initialize tunnel manager from storage
   * ✅ FIXED: Only load tunnels if deployment is currently active
   * Don't load old tunnels from previous deployments
   */
  initializeTunnelManager() {
    // ✅ NEW: Check if deployment is currently active
    const deploymentStatus = storageManager.getItem('deploymentStatus');

    if (deploymentStatus !== 'deployed') {
      console.log('📌 No active deployment - skipping tunnel initialization');
      return;
    }

    const tunnels = this.loadTunnels();
    if (tunnels.length === 0) {
      console.log('📌 No tunnels in storage to initialize');
      return;
    }

    // ✅ FIXED: Only load tunnels that are part of current deployment
    // Filter out old tunnels from previous deployments
    const currentSubdomain = storageManager.getItem('backendSubdomain');

    // If subdomain is missing, load all stored tunnels rather than wiping them
    const currentTunnels = currentSubdomain
      ? tunnels.filter(url => url.includes(currentSubdomain))
      : tunnels;

    if (currentTunnels.length === 0) {
      console.log('📌 Stored tunnels are from old deployments - clearing them');
      this.clearAllTunnels();
      return;
    }

    console.log(`🌐 Initializing tunnel manager with ${currentTunnels.length} tunnels from current deployment...`);

    for (const url of currentTunnels) {
      tunnelManager.addTunnel(url);
    }

    console.log(`✅ Tunnel manager initialized with ${currentTunnels.length} tunnels`);
  },

  /**
   * Clear all tunnels from storage and tunnel manager
   */
  clearAllTunnels() {
    tunnelManager.clear();
    storageManager.removeItem(TUNNEL_STORAGE_KEY);
    storageManager.removeItem(ACTIVE_TUNNEL_KEY);
    console.log(`🌐 All tunnels cleared from storage and manager`);
  },

  /**
   * Get tunnel status summary
   * @returns {object} - Status summary
   */
  getTunnelStatusSummary() {
    const tunnels = tunnelManager.getTunnelStatus();
    const healthy = tunnels.filter(t => t.status === 'HEALTHY').length;
    const degraded = tunnels.filter(t => t.status === 'DEGRADED').length;
    const offline = tunnels.filter(t => t.status === 'OFFLINE').length;

    return {
      total: tunnels.length,
      healthy,
      degraded,
      offline,
      tunnels
    };
  }
};

export default tunnelStorage;
