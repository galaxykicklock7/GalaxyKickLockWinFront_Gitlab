import React, { useState, useEffect } from 'react';
import { FaAndroid, FaApple, FaGlobe, FaSignOutAlt, FaRocket, FaWifi, FaCloudUploadAlt, FaTimesCircle } from 'react-icons/fa';
import { triggerGitLabPipeline, pollGitLabPipelineUntilRunning, cancelGitLabPipeline, getLatestRunningGitLabPipeline } from '../../utils/gitlab';
import { setBackendUrl, clearBackendUrl } from '../../utils/backendUrl';
import { storageManager } from '../../utils/storageManager';
import { tunnelStorage } from '../../utils/tunnelStorage';
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
    const [currentRunId, setCurrentRunId] = useState(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmModalConfig, setConfirmModalConfig] = useState({});
    const [isDeactivating, setIsDeactivating] = useState(false);
    const [isReleasing, setIsReleasing] = useState(false);
    const [showProfileModal, setShowProfileModal] = useState(false);

    // Check if deployment is already done (persisted in storage)
    useEffect(() => {
        const savedDeploymentStatus = storageManager.getItem('deploymentStatus');
        const savedPipelineId = storageManager.getItem('pipelineId');
        
        // Clean up any old localTestMode settings
        storageManager.removeItem('localTestMode');
        
        if (savedDeploymentStatus === 'deployed') {
            setDeploymentStatus('deployed');
            if (savedPipelineId) {
                setCurrentRunId(parseInt(savedPipelineId));
            }
        }
    }, []);

    // Listen for deployment status changes (from deployment monitor)
    useEffect(() => {
        const handleDeploymentChange = (e) => {
            if (e.detail.status === 'idle') {
                // Deployment stopped - reset to idle state
                setDeploymentStatus('idle');
                setCurrentRunId(null);
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
        // CRITICAL: Check if user already has a running pipeline
        try {
            setDeploymentProgress({ percentage: 0, message: 'Checking for existing sessions...' });
            const existingPipelineId = await getLatestRunningGitLabPipeline();
            
            if (existingPipelineId) {
                // User has a running pipeline - show confirmation modal
                setConfirmModalConfig({
                    title: '⚠️ SYSTEM ALREADY ACTIVE',
                    message: 'You already have an active session running.\n\nStarting a new session will stop the current one.\n\nContinue?',
                    confirmText: 'START NEW SESSION',
                    type: 'warning',
                    onConfirm: () => {
                        setShowConfirmModal(false);
                        performDeploy(existingPipelineId);
                    }
                });
                setShowConfirmModal(true);
                return;
            }
        } catch (error) {
            console.warn('Failed to check for existing pipelines:', error);
            // Continue anyway - better to deploy than block user
        }
        
        // No existing pipeline - proceed directly
        performDeploy(null);
    };

    const performDeploy = async (oldPipelineId) => {
        setIsDeploying(true);
        setIsDeactivating(false);
        setDeploymentStatus('deploying');
        setShowDeployModal(true);
        setDeploymentProgress({ percentage: 0, message: 'Initializing deployment sequence...' });

        try {
            // If there's an old pipeline, cancel it first
            if (oldPipelineId) {
                setDeploymentProgress({ percentage: 5, message: 'Stopping previous session...' });
                await cancelGitLabPipeline(oldPipelineId);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for cancellation
            }

            // Step 1: Trigger pipeline (10%)
            setDeploymentProgress({ percentage: 10, message: 'Initializing system...' });
            
            // Get current user's username
            if (!currentUser || !currentUser.username) {
                throw new Error('User information not available. Please refresh and try again.');
            }

            const triggerResult = await triggerGitLabPipeline(currentUser.username);

            if (!triggerResult.success) {
                throw new Error(triggerResult.error || 'Failed to trigger deployment');
            }

            // Store the subdomain for later use (but don't show it to user)
            const subdomain = triggerResult.subdomain;
            const backendUrl = `https://${subdomain}.loca.lt`;

            // Update the backend URL in the app
            setBackendUrl(backendUrl);
            storageManager.setItem('backendSubdomain', subdomain);
            storageManager.setItem('deploymentStatus', 'deployed');
            storageManager.setItem('pipelineId', triggerResult.pipeline_id.toString());

            // ✅ FIXED: Clear old tunnels from previous deployments
            // Old tunnels are now offline, so remove them to avoid confusion
            tunnelStorage.clearAllTunnels();
            console.log(`🌐 Cleared old tunnels from previous deployments`);

            // ✅ NEW: Add 3 NEW tunnels from current deployment
            const tunnel1Url = `https://${subdomain}-tunnel1.loca.lt`;
            const tunnel2Url = `https://${subdomain}-tunnel2.loca.lt`;
            const tunnel3Url = `https://${subdomain}-tunnel3.loca.lt`;

            tunnelStorage.addTunnel(tunnel1Url);
            tunnelStorage.addTunnel(tunnel2Url);
            tunnelStorage.addTunnel(tunnel3Url);
            tunnelStorage.setActiveTunnel(tunnel1Url);

            console.log(`🌐 NEW TUNNELS REGISTERED:`);
            console.log(`   Tunnel 1: ${tunnel1Url}`);
            console.log(`   Tunnel 2: ${tunnel2Url}`);
            console.log(`   Tunnel 3: ${tunnel3Url}`);

            // Step 2: Pipeline triggered (20%)
            setDeploymentProgress({ percentage: 20, message: 'System initialized...' });
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 3: Waiting for pipeline to start (30%)
            setDeploymentProgress({ percentage: 30, message: 'Establishing connection...' });

            // Step 4: Poll until pipeline reaches "Keep running" stage (30% - 90%)
            const pollResult = await pollGitLabPipelineUntilRunning(
                triggerResult.pipeline_id,
                (progress) => {
                    // Calculate percentage based on attempts (30% to 90%)
                    const progressPercent = 30 + Math.min(60, (progress.attempt / progress.maxAttempts) * 60);
                    setDeploymentProgress({
                        percentage: Math.round(progressPercent),
                        message: `Activating system... (${progress.status})`
                    });
                }
            );

            if (!pollResult.success) {
                throw new Error(pollResult.error || 'Deployment failed');
            }

            // Step 5: Finalizing (95%)
            setDeploymentProgress({ percentage: 95, message: 'Finalizing activation...' });
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 6: Success! (100%) - Don't show backend URL
            setDeploymentProgress({ 
                percentage: 100, 
                message: 'Galaxy Kick Lock 2.0 activated!' 
            });
            setDeploymentStatus('deployed');
            setCurrentRunId(triggerResult.pipeline_id);
            
            // Trigger custom event to notify components that deployment is complete
            window.dispatchEvent(new CustomEvent('deploymentStatusChanged', { 
                detail: { status: 'deployed', backendUrl } 
            }));
            
            // Start deployment monitoring to detect if backend stops
            if (onDeploymentSuccess && triggerResult.pipeline_id) {
                onDeploymentSuccess(triggerResult.pipeline_id);
            }
            
            // Keep modal open for user to see success
        } catch (error) {
            console.error('Deployment error:', error);
            setDeploymentStatus('failed');
            setDeploymentProgress({ 
                percentage: 0, 
                message: error.message || error.toString() || 'Deployment failed. Please try again.'
            });
            clearBackendUrl();
            storageManager.removeItem('deploymentStatus');
            storageManager.removeItem('pipelineId');
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
        setDeploymentProgress({ percentage: 0, message: 'Deactivating system...' });

        try {
            // Try to cancel the current pipeline
            let pipelineIdToCancel = currentRunId;
            
            // If we don't have a stored pipeline ID, try to get the latest running one
            if (!pipelineIdToCancel) {
                setDeploymentProgress({ percentage: 20, message: 'Finding active pipeline...' });
                pipelineIdToCancel = await getLatestRunningGitLabPipeline();
            }

            if (pipelineIdToCancel) {
                setDeploymentProgress({ percentage: 40, message: 'Stopping system...' });
                const cancelResult = await cancelGitLabPipeline(pipelineIdToCancel);
                
                if (!cancelResult.success) {
                    console.warn('Failed to cancel pipeline:', cancelResult.error);
                    // Continue anyway - pipeline might have already completed
                }
                
                setDeploymentProgress({ percentage: 80, message: 'System stopped...' });
            } else {
                setDeploymentProgress({ percentage: 50, message: 'No active session found...' });
            }

            // Clear deployment state
            await new Promise(resolve => setTimeout(resolve, 1000));
            setDeploymentProgress({ percentage: 100, message: 'System deactivated successfully!' });
            
            // Reset state
            setTimeout(() => {
                setDeploymentStatus('idle');
                setCurrentRunId(null);
                setIsDeactivating(false);
                clearBackendUrl();
                storageManager.removeItem('deploymentStatus');
                storageManager.removeItem('pipelineId');
                storageManager.removeItem('localTestMode');
                
                // Trigger custom event to notify components
                window.dispatchEvent(new CustomEvent('deploymentStatusChanged', { 
                    detail: { status: 'idle' } 
                }));
                
                setShowDeployModal(false);
            }, 2000);

        } catch (error) {
            console.error('Undeploy error:', error);
            setDeploymentStatus('failed');
            setIsDeactivating(false);
            setDeploymentProgress({ 
                percentage: 0, 
                message: `Deactivation failed: ${error.message}`
            });
        } finally {
            setIsDeploying(false);
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
            const { getBackendUrl } = await import('../../utils/backendUrl');
            const backendUrl = getBackendUrl();
            
            if (!backendUrl) {
                showToast?.('System not active', 'error');
                setIsReleasing(false);
                return;
            }

            const response = await fetch(`${backendUrl}/api/release`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'bypass-tunnel-reminder': 'true'
                }
            });

            const data = await response.json();

            // SMART TOAST: Single message based on backend response
            if (data.success) {
                // Some were in prison - show success
                if (data.details.inPrison > 0) {
                    showToast?.(`✅ Released ${data.details.inPrison} from prison`, 'success');
                } else if (data.details.notInPrison > 0 && data.details.inPrison === 0) {
                    // None in prison - show info
                    showToast?.(`ℹ️ All connections already free`, 'info');
                } else if (data.details.noCode > 0) {
                    showToast?.(`⚠️ ${data.details.noCode} missing recovery codes`, 'warning');
                } else {
                    showToast?.(`ℹ️ No connections to release`, 'info');
                }
            } else {
                // Error case
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
            // Re-enable button after processing
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
                            {loading ? 'INIT...' : connected ? 'LINKED' : 'CONNECT'}
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
        </div>
    );
};

export default CommandBar;
