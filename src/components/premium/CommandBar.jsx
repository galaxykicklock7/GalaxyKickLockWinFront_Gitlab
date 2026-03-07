import React, { useState, useEffect } from 'react';
import { FaAndroid, FaApple, FaGlobe, FaSignOutAlt, FaRocket, FaWifi, FaCloudUploadAlt, FaTimesCircle, FaQuestionCircle } from 'react-icons/fa';
import { activateBackend, deactivateBackend } from '../../utils/gitlab';
import { setBackendUrl, clearBackendUrl } from '../../utils/backendUrl';
import { storageManager } from '../../utils/storageManager';
import { backendStorage } from '../../utils/backendStorage';
import DeploymentModal from '../DeploymentModal';
import ConfirmModal from '../ConfirmModal';
import ProfileModal from '../ProfileModal';
import './PremiumLayout.css';

const CommandBar = ({
    config,
    onConfigChange,
    onConnect,
    onDisconnect,
    onReleaseAll,
    onFlyToPlanet,
    connected,
    loading,
    onLogout,
    currentUser,
    onDeploymentSuccess, // Callback to start deployment monitoring
    showToast // Toast function from App.jsx
}) => {
    const [deploymentStatus, setDeploymentStatus] = useState('idle'); // idle, deploying, deployed, failed
    const [deploymentProgress, setDeploymentProgress] = useState({ percentage: 0, message: '' });
    const [isDeploying, setIsDeploying] = useState(false);
    const [showDeployModal, setShowDeployModal] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmModalConfig, setConfirmModalConfig] = useState({});
    const [isDeactivating, setIsDeactivating] = useState(false);
    const [isReleasing, setIsReleasing] = useState(false);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);

    // Check if deployment is already done (persisted in storage)
    useEffect(() => {
        const savedDeploymentStatus = storageManager.getItem('deploymentStatus');

        // Clean up any old settings
        storageManager.removeItem('localTestMode');
        storageManager.removeItem('pipelineId');

        if (savedDeploymentStatus === 'deployed') {
            setDeploymentStatus('deployed');
        }
    }, []);

    // Listen for deployment status changes (from deployment monitor)
    useEffect(() => {
        const handleDeploymentChange = (e) => {
            if (e.detail.status === 'idle') {
                // Deployment stopped - reset to idle state
                setDeploymentStatus('idle');
                setIsDeploying(false);
                setShowDeployModal(false);
            }
        };

        window.addEventListener('deploymentStatusChanged', handleDeploymentChange);
        return () => {
            window.removeEventListener('deploymentStatusChanged', handleDeploymentChange);
        };
    }, []);

    // Format expiry date
    const formatExpiryDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const now = new Date();
        
        // Check if expired
        if (date < now) {
            return 'EXPIRED';
        }
        
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const isExpired = (dateString) => {
        if (!dateString) return false;
        return new Date(dateString) < new Date();
    };

    const handleDeploy = async () => {
        // If already deployed, confirm before redeploying
        if (deploymentStatus === 'deployed') {
            setConfirmModalConfig({
                title: '⚠️ SYSTEM ALREADY ACTIVE',
                message: 'You already have an active session running.\n\nStarting a new session will redeploy the backend.\n\nContinue?',
                confirmText: 'REDEPLOY',
                type: 'warning',
                onConfirm: () => {
                    setShowConfirmModal(false);
                    performDeploy();
                }
            });
            setShowConfirmModal(true);
            return;
        }

        performDeploy();
    };

    const performDeploy = async () => {
        setIsDeploying(true);
        setIsDeactivating(false);
        setDeploymentStatus('deploying');
        setShowDeployModal(true);
        setDeploymentProgress({ percentage: 0, message: 'Initializing deployment...' });

        try {
            if (!currentUser || !currentUser.username) {
                throw new Error('User information not available. Please refresh and try again.');
            }

            // Clear old backend URL
            backendStorage.clearBackendUrl();

            // Step 1: Call Edge Function to redeploy Railway (0% → 80%)
            setDeploymentProgress({ percentage: 10, message: 'Deploying backend to Railway...' });

            const result = await activateBackend(currentUser.username);

            if (!result.success) {
                throw new Error(result.error || 'Activation failed');
            }

            const backendUrl = result.backend_url;
            const userId = result.userId;

            if (!backendUrl) {
                throw new Error('No backend URL returned. Contact admin to set up your service.');
            }

            // Backend URL is now stored securely (obfuscated)
            setDeploymentProgress({ percentage: 80, message: 'Backend deployed, verifying health...' });

            // Step 2: Health check from frontend (80% → 98%)
            // Edge function already does health check, but verify from browser too (CORS/network)
            let healthOk = result.health;
            if (!healthOk) {
                const maxHealthAttempts = 20;
                for (let i = 1; i <= maxHealthAttempts; i++) {
                    try {
                        const healthRes = await fetch(`${backendUrl}/api/health`, {
                            method: 'GET',
                            headers: {},
                            signal: AbortSignal.timeout(10000)
                        }).catch(err => {
                            // Ignore abort errors during health check
                            if (err.name === 'AbortError') {
                                return { ok: false };
                            }
                            throw err;
                        });
                        if (healthRes.ok) {
                            healthOk = true;
                            break;
                        }
                        setDeploymentProgress({
                            percentage: 80 + Math.min(18, Math.round((i / maxHealthAttempts) * 18)),
                            message: `Backend responding HTTP ${healthRes.status}... retrying (${i}/${maxHealthAttempts})`
                        });
                    } catch {
                        setDeploymentProgress({
                            percentage: 80 + Math.min(18, Math.round((i / maxHealthAttempts) * 18)),
                            message: `Waiting for backend... (${i}/${maxHealthAttempts})`
                        });
                    }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            if (!healthOk) {
                throw new Error('Backend deployed but not responding. Please try again.');
            }

            // Save URL and finalize
            setBackendUrl(backendUrl);
            await backendStorage.saveBackendUrl(backendUrl);
            storageManager.setItem('deploymentStatus', 'deployed');
            storageManager.setItem('userId', userId);

            // Step 3: Success! (100%)
            setDeploymentProgress({
                percentage: 100,
                message: 'Galaxy Kick Lock 2.0 activated!'
            });
            setDeploymentStatus('deployed');

            window.dispatchEvent(new CustomEvent('deploymentStatusChanged', {
                detail: { status: 'deployed', backendUrl }
            }));

            if (onDeploymentSuccess) {
                onDeploymentSuccess();
            }

        } catch (error) {
            console.error('Deployment error:', error);
            setDeploymentStatus('failed');
            setDeploymentProgress({
                percentage: 0,
                message: error.message || 'Deployment failed. Please try again.'
            });
            clearBackendUrl();
            backendStorage.clearBackendUrl();
            storageManager.removeItem('deploymentStatus');
            storageManager.removeItem('userId');
        } finally {
            setIsDeploying(false);
        }
    };

    const handleUndeploy = () => {
        // Check if connected and show appropriate warning
        if (connected) {
            setConfirmModalConfig({
                title: '⚠️ STILL CONNECTED',
                message: 'Please disconnect before deactivating.\n\nForce deactivation anyway?',
                confirmText: 'FORCE DEACTIVATE',
                type: 'danger',
                onConfirm: () => {
                    setShowConfirmModal(false);
                    performUndeploy();
                }
            });
        } else {
            setConfirmModalConfig({
                title: '⚠️ DEACTIVATE SYSTEM',
                message: 'Are you sure you want to deactivate?',
                confirmText: 'DEACTIVATE',
                type: 'warning',
                onConfirm: () => {
                    setShowConfirmModal(false);
                    performUndeploy();
                }
            });
        }
        setShowConfirmModal(true);
    };

    const performUndeploy = async () => {
        setIsDeploying(true);
        setIsDeactivating(true);
        setShowDeployModal(true);
        setDeploymentStatus('deploying');
        setDeploymentProgress({ percentage: 0, message: 'Sending exit signal to bot...' });

        try {
            // Step 1: Send EXIT signal to backend so bot finishes cleanly
            if (connected) {
                try {
                    const { apiClient } = await import('../../utils/api');
                    await apiClient.configure({ exitting: true });
                    setDeploymentProgress({ percentage: 10, message: 'Exit signal sent, waiting for bot to finish...' });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } catch (err) {
                    console.warn('Failed to send exit signal:', err);
                }

                // Step 2: Disconnect WebSocket connections
                try {
                    setDeploymentProgress({ percentage: 20, message: 'Disconnecting...' });
                    await onDisconnect();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (err) {
                    console.warn('Disconnect failed during deactivate:', err);
                }
            }

            // Step 3: Stop Railway backend via Edge Function
            setDeploymentProgress({ percentage: 40, message: 'Stopping Railway backend...' });
            const stopResult = await deactivateBackend(currentUser?.username);

            if (stopResult.success) {
                setDeploymentProgress({ percentage: 90, message: 'Backend stopped...' });
            } else {
                console.warn('Stop failed:', stopResult.error);
                setDeploymentProgress({ percentage: 80, message: 'Stop signal sent...' });
            }

            setDeploymentProgress({ percentage: 100, message: 'System deactivated successfully!' });

            // Show success for 2 seconds, then reset
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Reset all state
            clearBackendUrl();
            backendStorage.clearBackendUrl();
            storageManager.removeItem('deploymentStatus');
            storageManager.removeItem('userId');
            setDeploymentStatus('idle');
            setCurrentRunId(null);
            setIsDeactivating(false);
            setIsDeploying(false);
            setShowDeployModal(false);

            window.dispatchEvent(new CustomEvent('deploymentStatusChanged', {
                detail: { status: 'idle' }
            }));

        } catch (error) {
            console.error('Undeploy error:', error);
            setDeploymentStatus('idle');
            setIsDeactivating(false);
            setIsDeploying(false);
            clearBackendUrl();
            backendStorage.clearBackendUrl();
            storageManager.removeItem('deploymentStatus');
            storageManager.removeItem('userId');
            setDeploymentProgress({
                percentage: 0,
                message: `Deactivation failed: ${error.message}`
            });

            window.dispatchEvent(new CustomEvent('deploymentStatusChanged', {
                detail: { status: 'idle' }
            }));
        }
    };

    const handleCloseDeployModal = () => {
        setShowDeployModal(false);
        if (deploymentStatus === 'failed') {
            setDeploymentStatus('idle');
        }
    };

    const handleRelease = async () => {
        // Prevent spam - disable button during processing
        if (isReleasing) return;

        setIsReleasing(true);

        try {
            const { apiClient } = await import('../../utils/api');
            const data = await apiClient.release();

            // SMART TOAST: Single message based on backend response
            if (data.success) {
                if (data.details?.inPrison > 0) {
                    showToast?.(`✅ Released ${data.details.inPrison} from prison`, 'success');
                } else if (data.details?.notInPrison > 0 && data.details.inPrison === 0) {
                    showToast?.(`ℹ️ All connections already free`, 'info');
                } else if (data.details?.noCode > 0) {
                    showToast?.(`⚠️ ${data.details.noCode} missing recovery codes`, 'warning');
                } else {
                    showToast?.(`ℹ️ No connections to release`, 'info');
                }
            } else {
                if (data.details?.noCode > 0) {
                    showToast?.(`⚠️ ${data.details.noCode} missing recovery codes`, 'warning');
                } else {
                    showToast?.(`ℹ️ No connections to release`, 'info');
                }
            }
        } catch (error) {
            console.error('Release error:', error);
            showToast?.('❌ Release failed', 'error');
        } finally {
            setIsReleasing(false);
        }
    };

    // Check if we're in development mode
    const isDevelopment = import.meta.env.DEV;

    return (
        <div className="command-bar">
            {/* LEFT: ACTION CLUSTER */}
            <div className="action-cluster">
                {/* DEPLOY/UNDEPLOY Button */}
                {deploymentStatus !== 'deployed' ? (
                    <button
                        className="hex-btn btn-deploy"
                        onClick={handleDeploy}
                        disabled={isDeploying}
                        title="Activate Galaxy Kick Lock 2.0"
                    >
                        <FaCloudUploadAlt /> {isDeploying ? 'ACTIVATING...' : 'ACTIVATE'}
                    </button>
                ) : (
                    <button
                        className="hex-btn btn-undeploy"
                        onClick={handleUndeploy}
                        disabled={isDeploying}
                        title="Deactivate Galaxy Kick Lock 2.0"
                    >
                        <FaTimesCircle /> DEACTIVATE
                    </button>
                )}

                {/* Other buttons - Only visible after deployment */}
                {deploymentStatus === 'deployed' && (
                    <>
                        <button
                            className="hex-btn btn-connect"
                            onClick={onConnect}
                            disabled={connected || loading}
                        >
                            {loading ? 'INIT...' : connected ? 'CONNECTED' : 'CONNECT'}
                        </button>
                        <button
                            className="hex-btn btn-exit"
                            onClick={onDisconnect}
                            disabled={!connected || loading}
                            style={{ color: '#fff' }}
                        >
                            EXIT
                        </button>
                        <button
                            className="hex-btn btn-release"
                            onClick={handleRelease}
                            disabled={!connected || isReleasing}
                            style={{ color: '#fff' }}
                        >
                            {isReleasing ? 'RELEASING...' : 'RELEASE'}
                        </button>
                    </>
                )}
            </div>

            {/* MIDDLE: NAVIGATION DECK */}
            <div className={`nav-deck ${deploymentStatus !== 'deployed' ? 'nav-deck-disabled' : ''}`}>
                <span style={{ fontSize: '10px', color: '#fff', fontFamily: 'Orbitron', fontWeight: 700, whiteSpace: 'nowrap' }}>PLANET</span>
                <input
                    type="text"
                    className="nav-input"
                    placeholder="Enter planet..."
                    value={config.planet}
                    onChange={(e) => onConfigChange('planet', e.target.value)}
                    style={{ width: '180px' }}
                    disabled={deploymentStatus !== 'deployed'}
                />
                <button
                    className="fly-btn"
                    onClick={onFlyToPlanet}
                    disabled={!connected || !config.planet || deploymentStatus !== 'deployed'}
                    style={{ marginLeft: '-2px' }}
                >
                    <FaRocket /> FLY
                </button>
                
                {/* RECONNECT FIELD */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '10px' }}>
                    <span style={{ fontSize: '10px', color: '#fff', fontFamily: 'Orbitron', fontWeight: 700, whiteSpace: 'nowrap' }}>RECONNECT</span>
                    <input
                        type="number"
                        className="nav-input"
                        placeholder="ms"
                        value={config.reconnect || ''}
                        onChange={(e) => onConfigChange('reconnect', parseInt(e.target.value) || 0)}
                        title="Reconnect delay in milliseconds"
                        style={{ width: '70px', textAlign: 'center' }}
                        disabled={deploymentStatus !== 'deployed'}
                    />
                </div>
            </div>

            {/* RIGHT: SYSTEM STATUS */}
            <div className={`system-status ${deploymentStatus !== 'deployed' ? 'system-status-disabled' : ''}`}>
                <div className="device-selector">
                    <FaQuestionCircle
                        className="dev-icon help-icon"
                        onClick={() => setShowHelpModal(true)}
                        title="How to use"
                        style={{ cursor: 'pointer', color: '#9d4edd' }}
                    />
                    <FaAndroid
                        className={`dev-icon ${config.device === '312' ? 'active' : ''}`}
                        onClick={() => deploymentStatus === 'deployed' && onConfigChange('device', '312')}
                        title="Android"
                        style={{ cursor: deploymentStatus === 'deployed' ? 'pointer' : 'not-allowed' }}
                    />
                    <FaApple
                        className={`dev-icon ${config.device === '323' ? 'active' : ''}`}
                        onClick={() => deploymentStatus === 'deployed' && onConfigChange('device', '323')}
                        title="iOS"
                        style={{ cursor: deploymentStatus === 'deployed' ? 'pointer' : 'not-allowed' }}
                    />
                    <FaGlobe
                        className={`dev-icon ${config.device === '352' ? 'active' : ''}`}
                        onClick={() => deploymentStatus === 'deployed' && onConfigChange('device', '352')}
                        title="Web"
                        style={{ cursor: deploymentStatus === 'deployed' ? 'pointer' : 'not-allowed' }}
                    />
                </div>

                <div className="user-profile">
                    {currentUser && (
                        <span 
                            style={{ 
                                fontSize: '14px', 
                                color: '#00f3ff', 
                                fontFamily: 'Orbitron', 
                                fontWeight: 700, 
                                letterSpacing: '0.5px', 
                                textShadow: '0 0 10px rgba(0, 243, 255, 0.5)',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onClick={() => setShowProfileModal(true)}
                            onMouseEnter={(e) => {
                                e.target.style.color = '#00d4ff';
                                e.target.style.transform = 'scale(1.05)';
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.color = '#00f3ff';
                                e.target.style.transform = 'scale(1)';
                            }}
                            title="Click to view profile"
                        >
                            {currentUser.username.toUpperCase()}
                        </span>
                    )}
                    <button 
                        className="logout-btn-mini" 
                        onClick={onLogout} 
                        title="Logout"
                    >
                        <FaSignOutAlt /> LOGOUT
                    </button>
                </div>
            </div>

            {/* Deployment Modal */}
            <DeploymentModal
                isOpen={showDeployModal}
                status={deploymentStatus}
                progress={deploymentProgress}
                onClose={handleCloseDeployModal}
                isDeactivating={isDeactivating}
            />

            {/* Confirmation Modal */}
            <ConfirmModal
                isOpen={showConfirmModal}
                title={confirmModalConfig.title}
                message={confirmModalConfig.message}
                confirmText={confirmModalConfig.confirmText}
                type={confirmModalConfig.type}
                onConfirm={confirmModalConfig.onConfirm}
                onCancel={() => setShowConfirmModal(false)}
            />

            {/* Profile Modal */}
            <ProfileModal
                isOpen={showProfileModal}
                currentUser={currentUser}
                onClose={() => setShowProfileModal(false)}
            />

            {/* Help / README Modal */}
            {showHelpModal && (
                <div className="help-modal-overlay" onClick={() => setShowHelpModal(false)}>
                    <div className="help-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="help-modal-header">
                            <div className="help-modal-title">
                                <FaQuestionCircle style={{ marginRight: '10px', color: '#9d4edd' }} />
                                HOW TO USE — QUICK GUIDE
                            </div>
                            <button className="help-close-btn" onClick={() => setShowHelpModal(false)}>✕</button>
                        </div>

                        <div className="help-modal-body">

                            <div className="help-section">
                                <div className="help-section-title">🔵 TOP BAR — BUTTONS</div>
                                <ul className="help-list">
                                    <li><span className="help-tag">ACTIVATE</span> — Starts the system. All other controls become available after this.</li>
                                    <li><span className="help-tag">CONNECT</span> — Starts all connections. Click after ACTIVATE.</li>
                                    <li><span className="help-tag red">EXIT</span> — Fully disconnects all active sessions immediately.</li>
                                    <li><span className="help-tag">RELEASE</span> — Manually releases all currently imprisoned IDs right now.</li>
                                    <li><span className="help-tag red">DEACTIVATE</span> — Shuts down the system completely. Use EXIT first, then DEACTIVATE.</li>
                                    <li><span className="help-tag">PLANET + FLY</span> — Type a planet name and click FLY to navigate all connections there.</li>
                                    <li><span className="help-tag">RECONNECT</span> — Time in ms to wait before auto-reconnecting if a connection drops.</li>
                                    <li><span className="help-tag">Android / iOS / Web</span> — Select your device type before connecting.</li>
                                </ul>
                            </div>

                            <div className="help-section">
                                <div className="help-section-title">🔗 CONNECTION MATRIX — RECOVERY CODES & TIMING</div>
                                <ul className="help-list">
                                    <li><span className="help-tag">PRIMARY / ALT</span> — Enter your recovery codes. PRIMARY is used first, ALT as fallback. 🔒 = in prison, 🔓 = free.</li>
                                    <li><span className="help-tag">DEF</span> — Defense timing (ms) for this connection.</li>
                                    <li><span className="help-tag">ATK</span> — Attack timing (ms) for this connection.</li>
                                    <li><span className="help-tag">METRICS toggle</span> — Enable to start recording timing data for each connection.</li>
                                    <li><span className="help-tag">📊 Chart icon</span> — Opens the Log Metric Dashboard for that connection (requires METRICS ON, disabled when AI CORE is ON).</li>
                                    <li><span className="help-tag">🧠 Brain icon</span> — Opens the AI Core Dashboard for that connection (requires METRICS ON and AI CORE ON).</li>
                                    <li><span className="help-tag">AI CHAT ON/OFF</span> — Enables AI chat for that connection (requires AI CORE ON).</li>
                                </ul>
                            </div>

                            <div className="help-section">
                                <div className="help-section-title">⚙️ CORE SYSTEMS — MODE & PROTOCOLS</div>
                                <ul className="help-list">
                                    <li><span className="help-tag red">MODE: EXIT</span> — System will exit cleanly after completing its current action.</li>
                                    <li><span className="help-tag">MODE: SLEEP</span> — Pauses all activity without disconnecting.</li>
                                    <li><span className="help-tag">AUTO RELEASE</span> — Automatically releases imprisoned IDs on a schedule (no manual action needed).</li>
                                    <li><span className="help-tag">SMART MODE</span> — Enables smarter targeting: skips low-security targets. Recommended for efficiency.</li>
                                    <li><span className="help-tag">KICK / IMPRISON / BAN</span> — Choose the action to perform. Only one active at a time.</li>
                                    <li><span className="help-tag">NONE</span> — No action will be performed. System stays idle.</li>
                                    <li><span className="help-tag">ALL</span> — Targets everyone on the planet.</li>
                                    <li><span className="help-tag">BLACKLIST</span> — Targets only names and clans listed in the Target Database blacklist.</li>
                                    <li><span className="help-tag">DAD+</span> — Targets players above a certain rank/tier threshold.</li>
                                </ul>
                            </div>

                            <div className="help-section">
                                <div className="help-section-title">⚙️ CORE SYSTEMS — TIMING</div>
                                <ul className="help-list">
                                    <li><span className="help-tag">INC / DEC</span> — How much to increment or decrement timing values during auto-adjustment.</li>
                                    <li><span className="help-tag">DEF min/max</span> — The allowed range for defense timing across all connections.</li>
                                    <li><span className="help-tag">ATK min/max</span> — The allowed range for attack timing across all connections.</li>
                                    <li><span className="help-tag">TIMER SHIFT</span> — Staggers connection timings to reduce overlap.</li>
                                    <li>When AI CORE is ON, all manual timing inputs are disabled — AI controls them automatically.</li>
                                </ul>
                            </div>

                            <div className="help-section">
                                <div className="help-section-title">🤖 AI CORE & SPEED PRESETS</div>
                                <ul className="help-list">
                                    <li><span className="help-tag">AI CORE</span> — Activates the AI timing system for all connections. Must be connected first. Overrides manual ATK/DEF values.</li>
                                    <li><span className="help-tag">SLOW</span> — AI runs at a slower timing speed.</li>
                                    <li><span className="help-tag">NORMAL</span> — AI runs at a balanced timing speed.</li>
                                    <li><span className="help-tag">FAST</span> — AI runs at a faster timing speed.</li>
                                    <li>Speed presets are only available when AI CORE is ON. Click an active preset again to deselect it.</li>
                                </ul>
                            </div>

                            <div className="help-section">
                                <div className="help-section-title">🎯 TARGET DATABASE — BLACKLIST & WHITELIST</div>
                                <ul className="help-list">
                                    <li>Tabs <span className="help-tag">IMPRISON</span> / <span className="help-tag">KICK</span> — Switch to manage lists for each action separately.</li>
                                    <li><span className="help-tag">USERNAMES BLACKLIST</span> — Specific players to target. One per line or comma-separated.</li>
                                    <li><span className="help-tag">USERNAMES WHITELIST</span> — Players to always skip, even if they match other criteria.</li>
                                    <li><span className="help-tag">CLANS BLACKLIST</span> — Target all members of these clans.</li>
                                    <li><span className="help-tag">CLANS WHITELIST</span> — Skip all members of these clans.</li>
                                    <li>Whitelist always takes priority over blacklist. You cannot add your own username or recovery codes to any list.</li>
                                    <li>With <span className="help-tag">SMART MODE ON</span>: low-security targets are skipped automatically even if on the blacklist.</li>
                                    <li>With <span className="help-tag">SMART MODE OFF</span>: acts on blacklist targets regardless of their security level.</li>
                                </ul>
                            </div>

                            <div className="help-section">
                                <div className="help-section-title">📊 LOG METRIC DASHBOARD</div>
                                <ul className="help-list">
                                    <li>Click the 📊 chart icon next to any connection (requires METRICS ON, not available when AI CORE is ON).</li>
                                    <li>Shows a scatter plot of imprisonment timing data for that connection.</li>
                                    <li>Stats shown: total actions, success count, 3s-error count, avg time, primary vs alt code usage, clan vs rival breakdown.</li>
                                    <li><span className="help-tag">Auto interval</span> — Dashboard refreshes automatically every 5 seconds while open.</li>
                                    <li><span className="help-tag">Manual refresh</span> — Close and reopen the dashboard to force an immediate data reload.</li>
                                    <li>Use the SUCCESS / 3S-ERROR toggles to filter which data points appear on the chart.</li>
                                </ul>
                            </div>

                            <div className="help-section">
                                <div className="help-section-title">⚠️ QUICK TIPS</div>
                                <ul className="help-list">
                                    <li>Always <span className="help-tag">ACTIVATE</span> first — nothing works before that.</li>
                                    <li>To stop cleanly: <span className="help-tag red">EXIT</span> → wait → <span className="help-tag red">DEACTIVATE</span>.</li>
                                    <li><span className="help-tag">RELEASE</span> is a one-shot manual action — for scheduled auto-release use <span className="help-tag">AUTO RELEASE</span> toggle in Core Systems.</li>
                                    <li>BLACKLIST mode only works if you have added names/clans in the Target Database.</li>
                                    <li>Recovery codes are locked while connected — disconnect first to edit them.</li>
                                </ul>
                            </div>

                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CommandBar;
