import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useBackendStatus } from './hooks/useBackendStatus';
import { useWorkflowMonitor } from './hooks/useWorkflowMonitor';
import { isAuthenticated, logoutUser, getSession } from './utils/auth';
import { isAdminAuthenticated } from './utils/adminAuth';
import { storageManager } from './utils/storageManager';
import { backendStorage } from './utils/backendStorage';
import LandingPage from './pages/LandingPage';
import AdminLandingPage from './pages/AdminLandingPage';
import AdminDashboard from './pages/AdminDashboard';

// PREMIUM COMPONENTS
import CommandBar from './components/premium/CommandBar';
import NeuralLink from './components/premium/NeuralLink';
import CoreSystems from './components/premium/CoreSystems';
import SecurityDatabase from './components/premium/SecurityDatabase';
import DataStreams from './components/premium/DataStreams';
import './components/premium/PremiumLayout.css';

import Toast from './components/Toast';
import ConfirmModal from './components/ConfirmModal';
// import './App.css'; // Disabled in favor of PremiumLayout

// Protected Route Component for Admin
function ProtectedAdminRoute({ children }) {
  const isAuth = isAdminAuthenticated();

  if (!isAuth) {
    return <Navigate to="/admin" replace />;
  }

  return children;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<UserApp />} />
        <Route path="/admin" element={<AdminLandingPage />} />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedAdminRoute>
              <AdminDashboard />
            </ProtectedAdminRoute>
          }
        />
      </Routes>
    </Router>
  );
}

function UserApp() {
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [storageReady, setStorageReady] = useState(false);
  const [toast, setToast] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutWarningMessage, setLogoutWarningMessage] = useState('');
  
  // Use ref to track if we've already logged out to prevent spam
  const hasLoggedOutRef = useRef(false);

  // Debounce timer for backend config updates
  const configUpdateTimerRef = useRef(null);

  // Stable ref to latest config — used by beforeunload to avoid re-registering the listener
  const configRef = useRef(null);
  
  // Initialize storage manager on mount
  useEffect(() => {
    const initStorage = async () => {
      try {
        await storageManager.initialize();
        // Give a small delay to ensure cache is fully populated
        await new Promise(resolve => setTimeout(resolve, 100));
        setStorageReady(true);
      } catch (err) {
        console.error('Storage initialization failed:', err);
        // Still set ready to prevent infinite loading
        setStorageReady(true);
      }
    };
    
    initStorage();
  }, []);

  // Load config from storage or use defaults
  const getInitialConfig = () => {
    const savedConfig = storageManager.getItem('galaxyKickLockConfig');
    if (savedConfig) {
      try {
        return JSON.parse(savedConfig);
      } catch (err) {
        console.warn('Failed to parse saved config:', err);
      }
    }
    // Return default config if nothing saved
    return {
      rc1: '',
      rc2: '',
      rc3: '',
      rc4: '',
      rc5: '',
      kickrc: '',
      rcl1: '',
      rcl2: '',
      rcl3: '',
      rcl4: '',
      rcl5: '',
      planet: '',
      device: '312',
      autorelease: false,
      smart: false,
      lowsecmode: false,
      exitting: true,
      sleeping: false,
      kickmode: true,
      imprisonmode: false,
      blacklist: '',
      gangblacklist: '',
      kblacklist: '',
      kgangblacklist: '',
      attack1: 1940,
      attack2: 1940,
      attack3: 1940,
      attack4: 1940,
      attack5: 1940,
      waiting1: 1910,
      waiting2: 1910,
      waiting3: 1910,
      waiting4: 1910,
      waiting5: 1910,
      timershift: false,
      incrementvalue: 10,
      decrementvalue: 10,
      minatk: 1000,
      maxatk: 3000,
      mindef: 1000,
      maxdef: 3000,
      modena: false,
      kickbybl: false,
      dadplus: false,
      kickall: false,
      reconnect: 5000,
      // Metrics tracking (enabled by default)
      metricsEnabled: true,
      // AI Mode (backend handles all AI settings with defaults)
      aiMode: false,
      // Speed preset: 'SLOW', 'NORMAL', 'FAST', or '' for custom
      speedPreset: ''
    };
  };

  // Pass function reference (not call) — React only invokes it once on mount
  const [config, setConfig] = useState(getInitialConfig);
  // Keep ref in sync so event listeners can read latest config without stale closures
  configRef.current = config;
  
  // AI CORE state
  const [aiCoreEnabled, setAiCoreEnabled] = useState(() => {
    // Restore from localStorage on mount
    const saved = storageManager.getItem('aiCoreEnabled');
    return saved === 'true';
  });
  const [aiCoreLoading, setAiCoreLoading] = useState(false);

  // Dashboard/logs enabled when deployed OR in local test mode
  const [isDashboardEnabled, setIsDashboardEnabled] = useState(false);

  const {
    status,
    logs,
    loading,
    error,
    connected,
    connect,
    disconnect,
    updateConfig,
    sendCommand
  } = useBackendStatus();

  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type });
  }, []);

  // Keep isDashboardEnabled in sync with deployment/localTest status changes
  useEffect(() => {
    const syncDashboardEnabled = () => {
      setIsDashboardEnabled(
        storageManager.getItem('deploymentStatus') === 'deployed' ||
        storageManager.getItem('localTestMode') === 'true'
      );
    };
    window.addEventListener('deploymentStatusChanged', syncDashboardEnabled);
    // Also sync when storage changes from another tab
    window.addEventListener('storage', syncDashboardEnabled);
    return () => {
      window.removeEventListener('deploymentStatusChanged', syncDashboardEnabled);
      window.removeEventListener('storage', syncDashboardEnabled);
    };
  }, []);

  // Monitor deployment system status - auto-reset if backend stops
  const { isMonitoring, startMonitoring, stopMonitoring } = useWorkflowMonitor(showToast);

  // Check authentication AFTER storage is ready
  useEffect(() => {
    if (!storageReady) return; // Wait for storage to initialize
    
    const checkAuth = () => {
      if (isAuthenticated()) {
        const session = getSession();
        
        if (session) {
          setCurrentUser(session);
          setAuthenticated(true);
        } else {
          setAuthenticated(false);
          setCurrentUser(null);
        }
      } else {
        setAuthenticated(false);
        setCurrentUser(null);
      }
      setCheckingAuth(false);
    };

    checkAuth();
    
    // Also restore dashboard enabled state from storage
    const deploymentStatus = storageManager.getItem('deploymentStatus');
    const localTestMode = storageManager.getItem('localTestMode');
    setIsDashboardEnabled(deploymentStatus === 'deployed' || localTestMode === 'true');

    // Initialize connection manager on app startup
    backendStorage.initializeConnectionManager().catch(err => {
      console.error('Failed to initialize connection manager:', err);
    });

    // Generate unique tab ID for this tab (only once on mount)
    const tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('tabId', tabId);

    // If authenticated, claim this tab as active
    if (isAuthenticated()) {
      storageManager.setItem('activeTabId', tabId);
    }

    // Save config before page unload - NO WARNING, NO CANCELLATION
    const handleBeforeUnload = () => {
      if (window.configUpdateTimer) {
        clearTimeout(window.configUpdateTimer);
      }
      // Use configRef so this listener never needs to be re-registered on config changes
      storageManager.setItem('galaxyKickLockConfig', configRef.current);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // DO NOT cancel deployment on page unload - let it keep running
    // User must manually click DEACTIVATE to stop the backend

    // Listen for storage changes
    const handleStorageChange = (e) => {
      // Prevent multiple logouts
      if (hasLoggedOutRef.current) return;

      if (e.key === 'galaxyKickLockSession') {
        if (!e.newValue) {
          // Session was removed
          hasLoggedOutRef.current = true;
          setAuthenticated(false);
          setCurrentUser(null);
          showToast('You have been logged out', 'info');
        } else if (e.oldValue && e.newValue && e.oldValue !== e.newValue) {
          // Session changed (new login)
          try {
            const oldSession = JSON.parse(e.oldValue);
            const newSession = JSON.parse(e.newValue);

            if (oldSession.session_id !== newSession.session_id) {
              hasLoggedOutRef.current = true;
              setAuthenticated(false);
              setCurrentUser(null);
              showToast('You have been logged in on another device/tab', 'info');
            }
          } catch (err) {
            console.warn('Failed to parse session change:', err);
          }
        }
      } else if (e.key === 'activeTabId' && e.newValue) {
        // Another tab claimed to be active
        const currentTabId = sessionStorage.getItem('tabId');
        if (e.newValue !== currentTabId) {
          hasLoggedOutRef.current = true;
          setAuthenticated(false);
          setCurrentUser(null);
          // No toast to avoid spam
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Cleanup
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('storage', handleStorageChange);

      // Save config on unmount using configRef (avoids stale closure)
      if (window.configUpdateTimer) {
        clearTimeout(window.configUpdateTimer);
      }
      storageManager.setItem('galaxyKickLockConfig', configRef.current);

      // Clear active tab if this was it
      const currentTabId = sessionStorage.getItem('tabId');
      const activeTabId = storageManager.getItem('activeTabId');
      if (currentTabId === activeTabId) {
        storageManager.removeItem('activeTabId');
      }
    };
  }, [storageReady]); // Add storageReady dependency

  // Single-session enforcement - check if logged in elsewhere
  useEffect(() => {
    if (!authenticated) return;

    const checkForNewSession = async () => {
      // Prevent multiple checks if already logged out
      if (hasLoggedOutRef.current) return;

      const localSession = getSession();
      if (!localSession || !localSession.session_token) return;

      try {
        // Check with backend if this session is still the active one
        const { validateSessionWithBackend } = await import('./utils/auth');
        const result = await validateSessionWithBackend();
        
        if (!result.valid) {
          // Session invalidated - user logged in elsewhere or admin revoked
          console.log('🔒 Session invalidated:', result.reason);
          hasLoggedOutRef.current = true;
          
          // Clear local state
          storageManager.removeItem('deploymentStatus');
          storageManager.removeItem('pipelineId');
                    const { clearBackendUrl } = await import('./utils/backendUrl');
          clearBackendUrl();

          stopMonitoring();

          window.dispatchEvent(new CustomEvent('deploymentStatusChanged', {
            detail: { status: 'idle' }
          }));
          
          // Logout
          await logoutUser();
          setAuthenticated(false);
          setCurrentUser(null);
          showToast(result.reason || 'You have been logged in on another device', 'info');
        }
      } catch (error) {
        // Network error - don't logout, just log warning
        console.warn('Session check failed (network issue), keeping session active:', error);
      }
    };

    // Check immediately on mount
    checkForNewSession();

    // Then check every 10 seconds for new logins on other devices
    const checkInterval = setInterval(checkForNewSession, 10 * 1000);

    return () => {
      clearInterval(checkInterval);
    };
  }, [authenticated, stopMonitoring]);

  const handleLoginSuccess = (userData) => {
    setToast(null); // Clear any existing toasts
    
    // Reset logout flag
    hasLoggedOutRef.current = false;
    
    // Set this tab as the active tab on login
    const tabId = sessionStorage.getItem('tabId') || `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('tabId', tabId);
    storageManager.setItem('activeTabId', tabId);
    
    // Universal storage verification
    setTimeout(() => {
      const verifySession = getSession();
      if (!verifySession) {
        console.error('Session verification failed - storage may be blocked');
        const diagnostics = storageManager.getDiagnostics();
        console.error('Storage diagnostics:', diagnostics);
        showToast('Warning: Session may not persist. Please enable cookies and storage.', 'warning');
      }
    }, 100);
    
    setCurrentUser(userData);
    setAuthenticated(true);
    showToast(`Welcome back, ${userData.username}!`, 'success');
    
    // Immediately trigger session check to invalidate old sessions
    // This ensures old devices get logged out quickly
    setTimeout(async () => {
      try {
        const { validateSessionWithBackend } = await import('./utils/auth');
        await validateSessionWithBackend();
      } catch (error) {
        console.warn('Initial session validation failed:', error);
      }
    }, 2000);
  };

  const performLogout = useCallback(async () => {
    setShowLogoutConfirm(false);
    showToast('Logging out...', 'info');

    try {
      // 1. Send EXIT signal to backend so bot finishes cleanly
      if (connected) {
        try {
          const { apiClient } = await import('./utils/api');
          await apiClient.configure({ exitting: true });
          await new Promise(resolve => setTimeout(resolve, 3000)); // Give bot 3s to finish
        } catch (err) {
          console.warn('Failed to send exit signal during logout:', err);
        }
      }

      // 2. Disconnect if connected
      if (connected) {
        try {
          await disconnect();
        } catch (err) {
          console.warn('Disconnect failed during logout:', err);
        }
      }

      // 3. Cancel pipeline (deactivate backend) if deployed
      const isDeployed = storageManager.getItem('deploymentStatus') === 'deployed';
      if (isDeployed) {
        try {
          showToast('Stopping backend pipeline...', 'info');
          const { cancelGitLabPipeline, getLatestRunningGitLabPipeline } = await import('./utils/gitlab');
          const pipelineId = storageManager.getItem('pipelineId') || await getLatestRunningGitLabPipeline();
          if (pipelineId) {
            await cancelGitLabPipeline(pipelineId);
          }
        } catch (err) {
          console.warn('Failed to cancel pipeline during logout:', err);
        }
      }

      // 4. Clear local state
      storageManager.removeItem('deploymentStatus');
      storageManager.removeItem('pipelineId');

      const { clearBackendUrl } = await import('./utils/backendUrl');
      clearBackendUrl();

      stopMonitoring();

      window.dispatchEvent(new CustomEvent('deploymentStatusChanged', {
        detail: { status: 'idle' }
      }));
    } catch (err) {
      console.error('Cleanup failed during logout:', err);
    }

    // 5. Perform logout
    await logoutUser();
    setCurrentUser(null);
    setAuthenticated(false);

    showToast('Logged out successfully', 'success');
  }, [connected, disconnect, stopMonitoring, showToast]);

  const handleLogout = useCallback(async () => {
    // Check if user is still connected or deployed
    const isDeployed = storageManager.getItem('deploymentStatus') === 'deployed';

    if (connected || isDeployed) {
      // Show warning modal with auto-cleanup option
      const issues = [];
      if (connected) issues.push('• Still connected');
      if (isDeployed) issues.push('• System still active');

      const message = `${issues.join('\n')}\n\nAuto-cleanup will disconnect and deactivate before logout.\n\nContinue?`;

      setLogoutWarningMessage(message);
      setShowLogoutConfirm(true);
      return;
    }

    // If nothing is active, logout directly
    performLogout();
  }, [connected, performLogout]);

  const handleConfigChange = useCallback((key, value) => {
    setConfig(prev => {
      const newConfig = { ...prev, [key]: value };
      
      // Validate RC codes for duplicates
      if (key.startsWith('rc') || key === 'kickrc') {
        if (value && value.trim() !== '') {
          const allCodes = [];
          ['rc1', 'rc2', 'rc3', 'rc4', 'rc5', 'rcl1', 'rcl2', 'rcl3', 'rcl4', 'rcl5'].forEach(rcKey => {
            const codeValue = rcKey === key ? value : newConfig[rcKey];
            if (codeValue && codeValue.trim() !== '') {
              allCodes.push(codeValue.toLowerCase());
            }
          });
          
          const kickValue = key === 'kickrc' ? value : newConfig.kickrc;
          if (kickValue && kickValue.trim() !== '') {
            allCodes.push(kickValue.toLowerCase());
          }
          
          const duplicates = allCodes.filter((val, idx) => allCodes.indexOf(val) !== idx);
          if (duplicates.length > 0) {
            showToast('This code is already in use. Please use a unique code.', 'error');
            return prev;
          }
        }
      }

      // Save to storage immediately (for persistence)
      storageManager.setItem('galaxyKickLockConfig', newConfig);
      
      // Debounce backend API call to prevent spam
      if (configUpdateTimerRef.current) {
        clearTimeout(configUpdateTimerRef.current);
      }
      
      configUpdateTimerRef.current = setTimeout(() => {
        updateConfig(newConfig);
      }, 300); // 300ms debounce for backend updates

      return newConfig;
    });
  }, [showToast, updateConfig]);

  const handleConnect = useCallback(async () => {
    try {
      // Validation: Check if at least one RC code is provided
      const hasAnyCode = config.rc1 || config.rc2 || config.rc3 || config.rc4 || config.rc5;
      if (!hasAnyCode) {
        showToast('Please enter at least one connection code (PRIMARY) before connecting', 'error');
        return;
      }

      // Validation: Check if codes with values have corresponding timing values
      const codes = [
        { rc: config.rc1, attack: config.attack1, waiting: config.waiting1, num: 1 },
        { rc: config.rc2, attack: config.attack2, waiting: config.waiting2, num: 2 },
        { rc: config.rc3, attack: config.attack3, waiting: config.waiting3, num: 3 },
        { rc: config.rc4, attack: config.attack4, waiting: config.waiting4, num: 4 },
        { rc: config.rc5, attack: config.attack5, waiting: config.waiting5, num: 5 },
      ];

      for (const code of codes) {
        if (code.rc && code.rc.trim()) {
          if (!code.attack || code.attack <= 0) {
            showToast(`CODE ${code.num}: Please enter a valid Attack timing (ATK must be greater than 0)`, 'error');
            return;
          }
          if (!code.waiting || code.waiting <= 0) {
            showToast(`CODE ${code.num}: Please enter a valid Defense timing (DEF must be greater than 0)`, 'error');
            return;
          }
        }
      }

      // Validation: Check Auto Timing values if timershift is enabled
      if (config.timershift) {
        if (!config.incrementvalue || config.incrementvalue <= 0) {
          showToast('Auto Timing: Please enter a valid Increment value (must be greater than 0)', 'error');
          return;
        }
        if (!config.decrementvalue || config.decrementvalue <= 0) {
          showToast('Auto Timing: Please enter a valid Decrement value (must be greater than 0)', 'error');
          return;
        }
        if (!config.minatk || config.minatk <= 0) {
          showToast('Auto Timing: Please enter a valid Min ATK value (must be greater than 0)', 'error');
          return;
        }
        if (!config.maxatk || config.maxatk <= 0) {
          showToast('Auto Timing: Please enter a valid Max ATK value (must be greater than 0)', 'error');
          return;
        }
        if (!config.mindef || config.mindef <= 0) {
          showToast('Auto Timing: Please enter a valid Min DEF value (must be greater than 0)', 'error');
          return;
        }
        if (!config.maxdef || config.maxdef <= 0) {
          showToast('Auto Timing: Please enter a valid Max DEF value (must be greater than 0)', 'error');
          return;
        }
        if (config.minatk >= config.maxatk) {
          showToast('Auto Timing: Min ATK must be less than Max ATK', 'error');
          return;
        }
        if (config.mindef >= config.maxdef) {
          showToast('Auto Timing: Min DEF must be less than Max DEF', 'error');
          return;
        }
      }

      // Update configuration first, then connect
      const configWithUserId = {
        ...config,
        userId: currentUser?.user_id || null
      };
      await updateConfig(configWithUserId);
      // Then connect
      await connect();
      showToast('Connected successfully!', 'success');

      // If AI Core was restored from localStorage, re-send enable commands to backend
      if (aiCoreEnabled) {
        try {
          const { connectionManager } = await import('./utils/connectionManager');
          const { getBackendUrl } = await import('./utils/backendUrl');

          if (!connectionManager.getUrl()) {
            await backendStorage.initializeConnectionManager();
          }
          const backendUrl = connectionManager.getUrl() || getBackendUrl();

          if (backendUrl) {
            const aiPromises = [];
            for (let i = 1; i <= 5; i++) {
              const hasRC = config[`rc${i}`] && config[`rc${i}`].trim() !== '';
              const hasRCL = config[`rcl${i}`] && config[`rcl${i}`].trim() !== '';
              if (hasRC || hasRCL) {
                aiPromises.push(
                  fetch(`${backendUrl}/api/ai/enable/${i}`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    }
                  })
                    .then(response => {
                      if (!response.ok) {
                        connectionManager.recordFailure(backendUrl, `HTTP ${response.status}`);
                        console.warn(`⚠️ AI enable ${i}: HTTP ${response.status}`);
                        // Don't throw, continue
                        return null;
                      }
                      connectionManager.recordSuccess(backendUrl, 100);
                      return response;
                    })
                    .catch(error => {
                      connectionManager.recordFailure(backendUrl, error.message);
                      console.warn(`⚠️ AI enable ${i} failed:`, error.message);
                      return null;
                    })
                );
              }
            }
            if (aiPromises.length > 0) {
              const results = await Promise.all(aiPromises);
              const successful = results.filter(r => r !== null).length;
              if (successful > 0) {
                showToast(`🧠 AI CORE re-enabled for ${successful}/${aiPromises.length} connection(s)`, 'success');
              } else {
                showToast(`⚠️ Could not re-enable AI CORE (check backend CORS)`, 'warning');
              }
            }
          }
        } catch (aiErr) {
          console.error('Failed to re-enable AI Core after connect:', aiErr);
        }
      }
    } catch (err) {

      // Provide more specific error messages
      let errorMessage = 'Failed to connect to backend';

      if (err.message.includes('fetch') || err.message.includes('Network')) {
        errorMessage = 'Cannot reach backend server. Please check if the server is running.';
      } else if (err.message.includes('timeout')) {
        errorMessage = 'Connection timeout. Server is not responding.';
      } else if (err.message) {
        errorMessage = err.message;
      }

      showToast(errorMessage, 'error');
    }
  }, [config, aiCoreEnabled, connect, updateConfig, currentUser, showToast]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
      
      // Disable AI Core when disconnecting and clear from storage
      if (aiCoreEnabled) {
        setAiCoreEnabled(false);
        storageManager.setItem('aiCoreEnabled', 'false');
      }
    } catch (err) {

      // Try to extract error message from backend response
      let errorMessage = 'Disconnect failed';
      if (err.response?.data) {
        // If backend returns HTML error page, show generic message
        if (typeof err.response.data === 'string' && err.response.data.includes('<!DOCTYPE')) {
          errorMessage = 'Backend error: The disconnect endpoint crashed. Check backend logs.';
        } else {
          errorMessage = err.response.data.message || err.response.data;
        }
      } else if (err.message) {
        errorMessage = err.message;
      }

      showToast(errorMessage, 'error');
    }
  }, [aiCoreEnabled, disconnect, showToast]);

  // AI CORE toggle handler - enables/disables AI for ALL connections
  const handleAiCoreToggle = useCallback(async () => {
    if (aiCoreLoading) return;
    
    setAiCoreLoading(true);
    const newState = !aiCoreEnabled;
    
    // Immediate visual feedback - optimistic update
    setAiCoreEnabled(newState);
    
    try {
      const { connectionManager } = await import('./utils/connectionManager');
      const { getBackendUrl } = await import('./utils/backendUrl');

      if (!connectionManager.getUrl()) {
        await backendStorage.initializeConnectionManager();
      }
      const backendUrl = connectionManager.getUrl() || getBackendUrl();

      if (!backendUrl) {
        showToast('Backend not connected', 'error');
        setAiCoreEnabled(!newState); // Revert on error
        setAiCoreLoading(false);
        return;
      }

      const action = newState ? 'enable' : 'disable';

      // Only enable/disable AI for ACTIVE connections (those with recovery codes)
      const promises = [];
      const activeConnections = [];

      for (let i = 1; i <= 5; i++) {
        // Check if this connection has a recovery code configured
        const hasRC = config[`rc${i}`] && config[`rc${i}`].trim() !== '';
        const hasRCL = config[`rcl${i}`] && config[`rcl${i}`].trim() !== '';

        if (hasRC || hasRCL) {
          activeConnections.push(i);
          promises.push(
            fetch(`${backendUrl}/api/ai/${action}/${i}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              }
            }).then(r => ({ connection: i, ok: r.ok, response: r }))
          );
        }
      }
      
      if (activeConnections.length === 0) {
        showToast('No active connections to enable AI for', 'error');
        setAiCoreEnabled(!newState); // Revert
        setAiCoreLoading(false);
        return;
      }
      
      const results = await Promise.all(promises);
      
      // Check results
      const succeeded = results.filter(r => r.ok);
      const failed = results.filter(r => !r.ok);
      
      if (succeeded.length > 0) {
        // Save to localStorage for persistence
        storageManager.setItem('aiCoreEnabled', newState.toString());
        
        if (failed.length === 0) {
          showToast(
            newState ? `🧠 AI CORE ACTIVATED - Beast mode enabled for ${succeeded.length} connection(s)!` : 'AI CORE deactivated',
            newState ? 'success' : 'info'
          );
        } else {
          showToast(
            `AI ${newState ? 'enabled' : 'disabled'} for ${succeeded.length}/${activeConnections.length} connections`,
            'warning'
          );
        }
      } else {
        // All failed - revert state
        setAiCoreEnabled(!newState);
        storageManager.setItem('aiCoreEnabled', (!newState).toString());
        showToast('All connections failed to enable AI. Make sure connections are active.', 'error');
      }
      
    } catch (error) {
      console.error('AI Core toggle error:', error);
      setAiCoreEnabled(!newState); // Revert on error
      storageManager.setItem('aiCoreEnabled', (!newState).toString());
      showToast(`AI Core ${newState ? 'enable' : 'disable'} failed: ${error.message}`, 'error');
    } finally {
      setAiCoreLoading(false);
    }
  }, [aiCoreEnabled, aiCoreLoading, config, showToast]);

  const handleReleaseAll = useCallback(async () => {
    try {
      const { apiClient } = await import('./utils/api');
      await apiClient.release();
      showToast('Release command sent!', 'success');
    } catch (err) {
      showToast(`Release failed: ${err.message}`, 'error');
    }
  }, [showToast]);

  const handleFlyToPlanet = useCallback(async () => {
    try {
      if (!config.planet) {
        showToast('Please enter a planet name', 'error');
        return;
      }

      // Check if any websockets are connected
      const wsStatus = status?.wsStatus || {};
      const connectedWs = Object.entries(wsStatus).filter(([key, isConnected]) => isConnected);

      if (connectedWs.length === 0) {
        showToast('No connections active. Please connect first.', 'error');
        return;
      }

      // Send JOIN command to all connected websockets
      const promises = [];
      if (wsStatus.ws1) promises.push(sendCommand(1, `JOIN ${config.planet}`));
      if (wsStatus.ws2) promises.push(sendCommand(2, `JOIN ${config.planet}`));
      if (wsStatus.ws3) promises.push(sendCommand(3, `JOIN ${config.planet}`));
      if (wsStatus.ws4) promises.push(sendCommand(4, `JOIN ${config.planet}`));
      if (wsStatus.ws5) promises.push(sendCommand(5, `JOIN ${config.planet}`));

      await Promise.all(promises);
      showToast(`Flying to ${config.planet}`, 'success');
    } catch (err) {
      showToast(`Fly failed: ${err.message}`, 'error');
    }
  }, [config, status, sendCommand, showToast]);

  // Show loading while initializing storage or checking authentication
  if (!storageReady || checkingAuth) {
    return (
      <div className="premium-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#00f3ff' }}>
        <div style={{ textAlign: 'center' }}>
          <h2>🔐 INITIALIZING SECURE STORAGE...</h2>
          <p style={{ color: '#ffaa00', marginTop: '10px' }}>Decrypting your data...</p>
        </div>
      </div>
    );
  }

  // Show landing page if not authenticated
  if (!authenticated) {
    return <LandingPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app premium-layout">
      {/* TITLE HEADER */}
      <div className="app-title">
        GALAXY KICK LOCK 2.0
      </div>

      {/* 1. TOP COMMAND BAR */}
      <CommandBar
        config={config}
        onConfigChange={handleConfigChange}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onReleaseAll={handleReleaseAll}
        onFlyToPlanet={handleFlyToPlanet}
        connected={connected}
        loading={loading}
        onLogout={handleLogout}
        currentUser={currentUser}
        onDeploymentSuccess={startMonitoring}
        showToast={showToast}
      />

      {/* 2. MAIN DASHBOARD (3 COLUMNS) - Dimmed until deployed or local test */}
      <div className={`main-dashboard ${!isDashboardEnabled ? 'dashboard-disabled' : ''}`}>
        {/* Left: Neural Link */}
        <NeuralLink
          config={config}
          onConfigChange={handleConfigChange}
          status={status}
          connected={connected}
          aiCoreEnabled={aiCoreEnabled}
        />

        {/* Middle: Core Systems */}
        <CoreSystems
          config={config}
          onConfigChange={handleConfigChange}
          onAiCoreToggle={handleAiCoreToggle}
          aiCoreEnabled={aiCoreEnabled}
          aiCoreLoading={aiCoreLoading}
          connected={connected}
        />

        {/* Right: Security Database */}
        <SecurityDatabase
          config={config}
          onConfigChange={handleConfigChange}
          showToast={showToast}
        />
      </div>

      {/* 3. FOOTER LOGS - Dimmed until deployed or local test */}
      <div className={!isDashboardEnabled ? 'logs-disabled' : ''}>
        <DataStreams logs={logs} />
      </div>

      {/* FOOTER COPYRIGHT */}
      <div className="app-footer">
        © 2026 THALA. All Rights Reserved.
      </div>

      {/* LOGOUT CONFIRMATION MODAL */}
      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="⚠️ LOGOUT"
        message={logoutWarningMessage}
        onConfirm={performLogout}
        onCancel={() => setShowLogoutConfirm(false)}
        confirmText="LOGOUT"
        cancelText="CANCEL"
        type="warning"
      />

      {/* TOAST OVERLAY */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default App;
