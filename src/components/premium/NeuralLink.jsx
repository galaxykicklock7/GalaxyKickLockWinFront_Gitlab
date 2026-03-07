import React, { useState, useEffect, useRef } from 'react';
import { FaFingerprint, FaShieldAlt, FaCrosshairs, FaSkullCrossbones, FaChartLine, FaBrain } from 'react-icons/fa';
import MetricsModal from '../MetricsModal';
import MLLearningModal from '../MLLearningModal';
import TimerStatusIndicator from '../TimerStatusIndicator';
import { getSession } from '../../utils/auth';
import { storageManager } from '../../utils/storageManager';
import './PremiumLayout.css';

const NeuralLink = ({ config, onConfigChange, status, connected, aiCoreEnabled }) => {
    const [showMetrics, setShowMetrics] = useState(false);
    const [showMLLearning, setShowMLLearning] = useState(false);
    const [selectedConnection, setSelectedConnection] = useState(null);
    const [metricsData, setMetricsData] = useState({});
    const [loadingMetrics, setLoadingMetrics] = useState(false);
    const [metricsEnabled, setMetricsEnabled] = useState(config.metricsEnabled || false);
    // Use ref instead of state so clearing the interval never causes a re-render
    // and the cleanup still works if component unmounts while modal is open
    const streamingIntervalRef = useRef(null);
    const [backendUrl, setBackendUrl] = useState(null);
    const [userId, setUserId] = useState(null);
    const [aiChatEnabled, setAiChatEnabled] = useState(() => {
        // Restore from localStorage on mount
        const saved = storageManager.getItem('aiChatEnabled');
        if (saved) {
            try { return JSON.parse(saved); } catch { /* fall through */ }
        }
        return { 1: false, 2: false, 3: false, 4: false, 5: false };
    });

    // Get backend URL and user ID
    React.useEffect(() => {
        const getUrl = async () => {
            const { getBestUrl } = await import('../../utils/api');
            const url = getBestUrl();
            setBackendUrl(url);
        };
        getUrl();

        // Get user ID from custom session
        const session = getSession();
        if (session && session.user_id) {
            setUserId(session.user_id);
        }

        // Listen for backend URL changes (when deployment completes)
        const handleStorageChange = () => {
            getUrl();
        };
        
        window.addEventListener('storage', handleStorageChange);
        // Also listen for custom deployment event
        window.addEventListener('deploymentStatusChanged', handleStorageChange);
        
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('deploymentStatusChanged', handleStorageChange);
        };
    }, []);

    // Retry wrapper for fetch calls
    const fetchWithRetry = async (url, options = {}, maxRetries = 3) => {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        // NOTE: Connection and Keep-Alive headers are browser-managed (can't override)
                        // Browser handles keep-alive automatically
                        ...options.headers
                    }
                });

                if (!response.ok) {
                    // Retry on 503/504
                    if (response.status === 503 || response.status === 504) {
                        throw new Error(`Server error ${response.status} - retryable`);
                    }
                    throw new Error(`HTTP ${response.status}`);
                }

                return response;
            } catch (error) {
                lastError = error;

                if (attempt < maxRetries) {
                    const delayMs = 500 * attempt;  // Exponential: 500ms, 1000ms, 1500ms
                    console.log(`🔄 [RETRY] Fetch retry ${attempt}/${maxRetries} after ${delayMs}ms`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                } else {
                    console.error(`❌ [RETRY] Fetch failed after ${maxRetries} retries`);
                }
            }
        }

        throw lastError;
    };

    // Re-send AI Chat enable on connect; clear on disconnect
    useEffect(() => {
        if (connected && backendUrl && aiCoreEnabled) {
            // Re-send enable for any connections that were ON before refresh/reconnect
            Object.entries(aiChatEnabled).forEach(([connNum, isEnabled]) => {
                if (isEnabled) {
                    fetchWithRetry(`${backendUrl}/api/ai/chat/enable/${connNum}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    }).catch(err => console.warn(`[AI Chat] Failed to re-enable chat ${connNum}:`, err));
                }
            });
        }
        if (!connected) {
            // Clear state and storage on disconnect
            const cleared = { 1: false, 2: false, 3: false, 4: false, 5: false };
            setAiChatEnabled(cleared);
            storageManager.setItem('aiChatEnabled', JSON.stringify(cleared));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected]);

    // Fetch metrics data from backend with retry logic
    const fetchMetricsData = async (connNum) => {
        setLoadingMetrics(true);
        try {
            const { getBestUrl } = await import('../../utils/api');
            const backendUrl = getBestUrl();

            if (!backendUrl) {
                console.warn('Backend not active');
                return [];
            }

            // Get current user from custom session
            const session = getSession();

            if (!session || !session.user_id) {
                console.warn('User not authenticated');
                return [];
            }

            // ✅ FIX: Use fetchWithRetry instead of plain fetch
            const response = await fetchWithRetry(`${backendUrl}/api/metrics/${connNum}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': session.user_id
                }
            });

            const result = await response.json();

            if (result.success && result.data) {
                setMetricsData(prev => ({
                    ...prev,
                    [connNum]: result.data
                }));
                return result.data;
            }

            return [];
        } catch (error) {
            console.error('Error fetching metrics:', error);
            return [];
        } finally {
            setLoadingMetrics(false);
        }
    };

    const handleMetricsClick = async (connNum) => {
        setSelectedConnection(connNum);
        setShowMetrics(true);

        // Fetch fresh data immediately when opening modal
        await fetchMetricsData(connNum);

        // Clear any previous interval before starting a new one
        if (streamingIntervalRef.current) clearInterval(streamingIntervalRef.current);

        // Refresh every 5 seconds; skip when tab hidden
        streamingIntervalRef.current = setInterval(() => {
            if (!document.hidden) fetchMetricsData(connNum);
        }, 5000);
    };

    const handleMLLearningClick = (connNum) => {
        setSelectedConnection(connNum);
        setShowMLLearning(true);
    };

    const handleAiChatToggle = async (connNum) => {
        const newValue = !aiChatEnabled[connNum];

        try {
            if (!backendUrl) {
                console.warn('[AI Chat] Backend not active');
                return;
            }

            const endpoint = newValue
                ? `${backendUrl}/api/ai/chat/enable/${connNum}`
                : `${backendUrl}/api/ai/chat/disable/${connNum}`;


            // Use fetchWithRetry for stability
            const response = await fetchWithRetry(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();

            // Update state and persist to localStorage
            setAiChatEnabled(prev => {
                const updated = { ...prev, [connNum]: newValue };
                storageManager.setItem('aiChatEnabled', JSON.stringify(updated));
                return updated;
            });

        } catch (error) {
            console.error(`[AI Chat] Error toggling AI Chat for connection ${connNum}:`, error);
        }
    };

    const handleMetricsClose = () => {
        setShowMetrics(false);
        if (streamingIntervalRef.current) {
            clearInterval(streamingIntervalRef.current);
            streamingIntervalRef.current = null;
        }
    };

    // Safety net: clear interval if component unmounts while modal is open
    useEffect(() => {
        return () => {
            if (streamingIntervalRef.current) {
                clearInterval(streamingIntervalRef.current);
                streamingIntervalRef.current = null;
            }
        };
    }, []);

    const handleMetricsToggle = () => {
        const newValue = !metricsEnabled;
        setMetricsEnabled(newValue);
        onConfigChange('metricsEnabled', newValue);
    };

    // Get prison status from backend status
    // Backend should return: { prisonStatus: { "actualcode1": true, "actualcode2": false, ... } }
    const prisonStatus = status?.prisonStatus || {};
    
    return (
        <div className="hud-panel neural-link">
            <div className="panel-header">
                <FaFingerprint className="panel-icon" />
                <span className="panel-title">CONNECTION MATRIX</span>
                
                {/* Metrics Toggle */}
                <div style={{ 
                    marginLeft: 'auto', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    fontSize: '11px',
                    fontFamily: 'Orbitron'
                }}>
                    <span style={{ color: metricsEnabled ? '#00ff88' : '#666' }}>
                        METRICS
                    </span>
                    <label style={{ 
                        position: 'relative', 
                        display: 'inline-block', 
                        width: '40px', 
                        height: '20px',
                        cursor: 'pointer'
                    }}>
                        <input
                            type="checkbox"
                            checked={metricsEnabled}
                            onChange={handleMetricsToggle}
                            style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: metricsEnabled ? '#00ff88' : '#333',
                            borderRadius: '20px',
                            transition: 'all 0.3s ease',
                            border: `2px solid ${metricsEnabled ? '#00ff88' : '#666'}`,
                            boxShadow: metricsEnabled ? '0 0 10px rgba(0, 255, 136, 0.5)' : 'none'
                        }}>
                            <span style={{
                                position: 'absolute',
                                content: '',
                                height: '12px',
                                width: '12px',
                                left: metricsEnabled ? '22px' : '2px',
                                bottom: '2px',
                                backgroundColor: '#0a0e27',
                                borderRadius: '50%',
                                transition: 'all 0.3s ease'
                            }} />
                        </span>
                    </label>
                </div>
            </div>

            <div className="neural-grid">
                {[1, 2, 3, 4, 5].map((num) => {
                    // Check both possible status structures
                    const isConnected = status?.websockets?.[`ws${num}`] || status?.wsStatus?.[`ws${num}`];
                    
                    // Get prison status for PRIMARY (rc) and ALT (rcl)
                    // Each recovery code (like "abc123") has its own prison status
                    const primaryCode = config[`rc${num}`];
                    const altCode = config[`rcl${num}`];
                    
                    // Check if the actual recovery code value is in prison
                    // Backend returns prison status keyed by the actual code value (lowercase)
                    const primaryInPrison = primaryCode && primaryCode.trim() !== '' && prisonStatus[primaryCode.toLowerCase().trim()];
                    const altInPrison = altCode && altCode.trim() !== '' && prisonStatus[altCode.toLowerCase().trim()];
                    
                    return (
                        <div key={num} className="code-card">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                                <div
                                    className={`status-led ${isConnected ? 'active' : 'inactive'}`}
                                    title={isConnected ? 'Connected' : 'Disconnected'}
                                />
                                {config.timershift && backendUrl && isConnected && userId && (
                                    <TimerStatusIndicator wsNumber={num} backendUrl={backendUrl} userId={userId} />
                                )}
                                <span style={{ fontSize: '11px', color: '#fff', fontFamily: 'Orbitron', fontWeight: 700 }}>
                                    CODE {num}
                                </span>
                                {/* AI Chat Toggle - Only enabled when AI Core is active */}
                                <button
                                    onClick={() => handleAiChatToggle(num)}
                                    title={
                                        !aiCoreEnabled ? 'Enable AI Core first' :
                                        aiChatEnabled[num] ? `Disable AI Chat for Code ${num}` : `Enable AI Chat for Code ${num}`
                                    }
                                    disabled={!aiCoreEnabled}
                                    style={{
                                        background: aiChatEnabled[num] ? 'rgba(0, 243, 255, 0.2)' : 'transparent',
                                        border: `1px solid ${aiChatEnabled[num] ? '#00f3ff' : '#444'}`,
                                        borderRadius: '4px',
                                        color: aiCoreEnabled ? (aiChatEnabled[num] ? '#00f3ff' : '#888') : '#444',
                                        cursor: aiCoreEnabled ? 'pointer' : 'not-allowed',
                                        padding: '2px 6px',
                                        fontSize: '9px',
                                        marginLeft: 'auto',
                                        fontFamily: 'Orbitron',
                                        fontWeight: 600,
                                        transition: 'all 0.2s ease',
                                        opacity: aiCoreEnabled ? 1 : 0.3
                                    }}
                                    onMouseEnter={(e) => {
                                        if (aiCoreEnabled) {
                                            e.target.style.borderColor = '#00f3ff';
                                            e.target.style.color = '#00f3ff';
                                            e.target.style.transform = 'scale(1.05)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (aiCoreEnabled) {
                                            e.target.style.borderColor = aiChatEnabled[num] ? '#00f3ff' : '#444';
                                            e.target.style.color = aiChatEnabled[num] ? '#00f3ff' : '#888';
                                            e.target.style.transform = 'scale(1)';
                                        }
                                    }}
                                >
                                    AI CHAT {aiChatEnabled[num] ? 'ON' : 'OFF'}
                                </button>
                                {/* ML Learning Button - Only enabled when AI Core is active */}
                                <button
                                    onClick={() => handleMLLearningClick(num)}
                                    title={
                                        !metricsEnabled ? 'Enable metrics first' :
                                        !aiCoreEnabled ? 'Enable AI Core to view ML Learning' :
                                        `View ML Learning for Code ${num}`
                                    }
                                    disabled={!metricsEnabled || !aiCoreEnabled}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: (metricsEnabled && aiCoreEnabled) ? '#9d4edd' : '#444',
                                        cursor: (metricsEnabled && aiCoreEnabled) ? 'pointer' : 'not-allowed',
                                        padding: '2px 4px',
                                        fontSize: '12px',
                                        marginLeft: '4px',
                                        transition: 'all 0.2s ease',
                                        opacity: (metricsEnabled && aiCoreEnabled) ? 1 : 0.3
                                    }}
                                    onMouseEnter={(e) => {
                                        if (metricsEnabled && aiCoreEnabled) {
                                            e.target.style.color = '#c77dff';
                                            e.target.style.transform = 'scale(1.2)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (metricsEnabled && aiCoreEnabled) {
                                            e.target.style.color = '#9d4edd';
                                            e.target.style.transform = 'scale(1)';
                                        }
                                    }}
                                >
                                    <FaBrain />
                                </button>
                                {/* Metrics Button - disabled when AI Core is active */}
                                <button
                                    onClick={() => handleMetricsClick(num)}
                                    title={
                                        !metricsEnabled ? 'Enable metrics first' :
                                        aiCoreEnabled ? 'Disable AI Core to view Log Metric Dashboard' :
                                        `View Code ${num} Metrics`
                                    }
                                    disabled={!metricsEnabled || aiCoreEnabled}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: (metricsEnabled && !aiCoreEnabled) ? '#00f3ff' : '#444',
                                        cursor: (metricsEnabled && !aiCoreEnabled) ? 'pointer' : 'not-allowed',
                                        padding: '2px 4px',
                                        fontSize: '12px',
                                        marginLeft: '4px',
                                        transition: 'all 0.2s ease',
                                        opacity: (metricsEnabled && !aiCoreEnabled) ? 1 : 0.3
                                    }}
                                    onMouseEnter={(e) => {
                                        if (metricsEnabled && !aiCoreEnabled) {
                                            e.target.style.color = '#00d4ff';
                                            e.target.style.transform = 'scale(1.2)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (metricsEnabled && !aiCoreEnabled) {
                                            e.target.style.color = '#00f3ff';
                                            e.target.style.transform = 'scale(1)';
                                        }
                                    }}
                                >
                                    <FaChartLine />
                                </button>
                            </div>

                            <div className="code-inputs">
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        maxLength="10"
                                        className="hud-input"
                                        value={config[`rc${num}`]}
                                        onChange={(e) => onConfigChange(`rc${num}`, e.target.value)}
                                        placeholder="PRIMARY"
                                        style={{ color: '#fff', paddingRight: '22px' }}
                                        disabled={connected}
                                        title={connected ? 'Disconnect to edit recovery codes' : 'Primary recovery code'}
                                    />
                                    {primaryCode && primaryCode.trim() !== '' && (
                                        <span 
                                            style={{ 
                                                position: 'absolute', 
                                                right: '6px', 
                                                fontSize: '12px',
                                                pointerEvents: 'none'
                                            }}
                                            title={primaryInPrison ? 'In prison' : 'Free'}
                                        >
                                            {primaryInPrison ? '🔒' : '🔓'}
                                        </span>
                                    )}
                                </div>
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        maxLength="10"
                                        className="hud-input"
                                        value={config[`rcl${num}`]}
                                        onChange={(e) => onConfigChange(`rcl${num}`, e.target.value)}
                                        placeholder="ALT"
                                        style={{ color: '#fff', paddingRight: '22px' }}
                                        disabled={connected}
                                        title={connected ? 'Disconnect to edit recovery codes' : 'Alternate recovery code'}
                                    />
                                    {altCode && altCode.trim() !== '' && (
                                        <span 
                                            style={{ 
                                                position: 'absolute', 
                                                right: '6px', 
                                                fontSize: '12px',
                                                pointerEvents: 'none'
                                            }}
                                            title={altInPrison ? 'In prison' : 'Free'}
                                        >
                                            {altInPrison ? '🔒' : '🔓'}
                                        </span>
                                    )}
                                </div>
                                <input
                                    type="number"
                                    className="hud-input"
                                    value={config[`waiting${num}`] || ''}
                                    onChange={(e) => onConfigChange(`waiting${num}`, parseInt(e.target.value) || 0)}
                                    disabled={aiCoreEnabled}
                                    placeholder="DEF"
                                    title={aiCoreEnabled ? "Disabled - AI Core controls timing" : "Defense"}
                                    style={{ color: '#fff' }}
                                />
                                <input
                                    type="number"
                                    className="hud-input"
                                    value={config[`attack${num}`] || ''}
                                    onChange={(e) => onConfigChange(`attack${num}`, parseInt(e.target.value) || 0)}
                                    disabled={aiCoreEnabled}
                                    placeholder="ATK"
                                    title={aiCoreEnabled ? "Disabled - AI Core controls timing" : "Attack"}
                                    style={{ color: '#fff' }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Metrics Modal */}
            <MetricsModal
                isOpen={showMetrics}
                onClose={handleMetricsClose}
                connectionNumber={selectedConnection}
                imprisonData={selectedConnection ? (metricsData[selectedConnection] || []) : []}
                loading={loadingMetrics}
            />

            {/* ML Learning Modal */}
            <MLLearningModal
                isOpen={showMLLearning}
                onClose={() => setShowMLLearning(false)}
                connectionNumber={selectedConnection}
                backendUrl={backendUrl}
                userId={userId}
            />
        </div>
    );
};

export default NeuralLink;
