import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useBackendStatus } from './hooks/useBackendStatus';
import { useWorkflowMonitor } from './hooks/useWorkflowMonitor';
import { isAuthenticated, logoutUser, getSession } from './utils/auth';
import { isAdminAuthenticated } from './utils/adminAuth';
import { storageManager } from './utils/storageManager';
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
  const [toast, setToast] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutWarningMessage, setLogoutWarningMessage] = useState('');
  
  // Use ref to track if we've already logged out to prevent spam
  const hasLoggedOutRef = useRef(false);

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
      // AI Mode (backend handles all AI settings with defaults)
      aiMode: false
    };
  };

  const [config, setConfig] = useState(getInitialConfig());

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

  const showToast = (message, type = 'error') => {
    setToast({ message, type });
  };

  // Monitor GitHub workflow status - auto-reset if backend stops
  const { isMonitoring, startMonitoring, stopMonitoring } = useWorkflowMonitor(showToast);

  // Check authentication on mount
  useEffect(() => {
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

    // Generate unique tab ID for this tab (only once on mount)
    const tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('tabId', tabId);

    // If authenticated, claim this tab as active
    if (isAuthenticated()) {
      storageManager.setItem('activeTabId', tabId);
    }

    // Save config before page unload - NO WARNING, NO CANCELLATION
    const handleBeforeUnload = (e) => {
      if (window.configUpdateTimer) {
        clearTimeout(window.configUpdateTimer);
      }
      // Save current config immediately using storage manager
      storageManager.setItem('galaxyKickLockConfig', config);
      
      // DO NOT show warning or cancel workflow on refresh
      // User can manually deactivate if they want to stop the backend
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // DO NOT cancel workflow on page unload - let it keep running
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
      
      // Save config on unmount using storage manager
      if (window.configUpdateTimer) {
        clearTimeout(window.configUpdateTimer);
      }
      storageManager.setItem('galaxyKickLockConfig', config);
      
      // Clear active tab if this was it
      const currentTabId = sessionStorage.getItem('tabId');
      const activeTabId = storageManager.getItem('activeTabId');
      if (currentTabId === activeTabId) {
        storageManager.removeItem('activeTabId');
      }
    };
  }, [config]); // Add config as dependency

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
          storageManager.removeItem('workflowRunId');
          storageManager.removeItem('backendSubdomain');
          storageManager.removeItem('localTestMode');

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

  const handleLogout = async () => {
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
  };

  const performLogout = async () => {
    setShowLogoutConfirm(false);
    showToast('Logging out...', 'info');

    // DO NOT cancel workflow on logout - let backend keep running
    try {
      // 1. Disconnect if connected
      if (connected) {
        try {
          await disconnect();
        } catch (err) {
          console.warn('Disconnect failed during logout:', err);
        }
      }

      // 2. Just clear local state - DO NOT cancel workflow
      storageManager.removeItem('deploymentStatus');
      storageManager.removeItem('workflowRunId');
      storageManager.removeItem('backendSubdomain');
      storageManager.removeItem('localTestMode');

      // Clear backend URL
      const { clearBackendUrl } = await import('./utils/backendUrl');
      clearBackendUrl();

      // Stop workflow monitoring
      stopMonitoring();

      // Emit event to reset UI
      window.dispatchEvent(new CustomEvent('deploymentStatusChanged', {
        detail: { status: 'idle' }
      }));
    } catch (err) {
      console.error('Cleanup failed during logout:', err);
    }
    
    // 3. Perform logout
    await logoutUser();
    setCurrentUser(null);
    setAuthenticated(false);
    
    showToast('Logged out successfully', 'success');
  };

  // Show loading while checking authentication
  if (checkingAuth) {
    return (
      <div className="premium-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#00f3ff' }}>
        <div style={{ textAlign: 'center' }}>
          <h2>INITIALIZING SYSTEM...</h2>
        </div>
      </div>
    );
  }

  // Show landing page if not authenticated
  if (!authenticated) {
    return <LandingPage onLoginSuccess={handleLoginSuccess} />;
  }

  const handleConfigChange = (key, value) => {
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

      // Save and send immediately using storage manager
      storageManager.setItem('galaxyKickLockConfig', newConfig);
      updateConfig(newConfig);

      return newConfig;
    });
  };

  const handleConnect = async () => {
    console.log('🚀 CONNECT CLICKED - Full config to be sent:', config);
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

      // Update configuration first
      console.log('📤 Sending config to backend before connect...');
      await updateConfig(config);
      console.log('✅ Config sent, now connecting...');
      // Then connect
      await connect();
      showToast('Connected successfully!', 'success');
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
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
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
  };

  const handleReleaseAll = async () => {
    try {
      const { apiClient } = await import('./utils/api');
      await apiClient.release();
      showToast('Release command sent!', 'success');
    } catch (err) {
      showToast(`Release failed: ${err.message}`, 'error');
    }
  };

  const handleFlyToPlanet = async () => {
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
  };

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
      <div className={`main-dashboard ${storageManager.getItem('deploymentStatus') !== 'deployed' && storageManager.getItem('localTestMode') !== 'true' ? 'dashboard-disabled' : ''}`}>
        {/* Left: Neural Link */}
        <NeuralLink
          config={config}
          onConfigChange={handleConfigChange}
          status={status}
          connected={connected}
        />

        {/* Middle: Core Systems */}
        <CoreSystems
          config={config}
          onConfigChange={handleConfigChange}
        />

        {/* Right: Security Database */}
        <SecurityDatabase
          config={config}
          onConfigChange={handleConfigChange}
          showToast={showToast}
        />
      </div>

      {/* 3. FOOTER LOGS - Dimmed until deployed or local test */}
      <div className={storageManager.getItem('deploymentStatus') !== 'deployed' && storageManager.getItem('localTestMode') !== 'true' ? 'logs-disabled' : ''}>
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
