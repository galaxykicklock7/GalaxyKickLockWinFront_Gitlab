import React, { useState } from 'react';
import { FaFingerprint, FaShieldAlt, FaCrosshairs, FaSkullCrossbones, FaChartLine } from 'react-icons/fa';
import MetricsModal from '../MetricsModal';
import { getSession } from '../../utils/auth';
import './PremiumLayout.css';

const NeuralLink = ({ config, onConfigChange, status, connected }) => {
    const [showMetrics, setShowMetrics] = useState(false);
    const [selectedConnection, setSelectedConnection] = useState(null);
    const [metricsData, setMetricsData] = useState({});
    const [loadingMetrics, setLoadingMetrics] = useState(false);
    const [metricsEnabled, setMetricsEnabled] = useState(config.metricsEnabled || false);
    const [streamingInterval, setStreamingInterval] = useState(null);

    // Fetch metrics data from backend
    const fetchMetricsData = async (connNum) => {
        setLoadingMetrics(true);
        try {
            const { getBackendUrl } = await import('../../utils/backendUrl');
            const backendUrl = getBackendUrl();
            
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

            const response = await fetch(`${backendUrl}/api/metrics/${connNum}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'bypass-tunnel-reminder': 'true',
                    'x-user-id': session.user_id
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch metrics');
            }

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
        
        // Start streaming (refresh every 3 seconds)
        const interval = setInterval(() => {
            fetchMetricsData(connNum);
        }, 3000);
        
        setStreamingInterval(interval);
    };

    const handleMetricsClose = () => {
        setShowMetrics(false);
        
        // Stop streaming when modal closes
        if (streamingInterval) {
            clearInterval(streamingInterval);
            setStreamingInterval(null);
        }
    };

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
                                <span style={{ fontSize: '11px', color: '#fff', fontFamily: 'Orbitron', fontWeight: 700 }}>
                                    CODE {num}
                                </span>
                                <button
                                    onClick={() => handleMetricsClick(num)}
                                    title={metricsEnabled ? `View Code ${num} Metrics` : 'Enable metrics first'}
                                    disabled={!metricsEnabled}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: metricsEnabled ? '#00f3ff' : '#444',
                                        cursor: metricsEnabled ? 'pointer' : 'not-allowed',
                                        padding: '2px 4px',
                                        fontSize: '12px',
                                        marginLeft: 'auto',
                                        transition: 'all 0.2s ease',
                                        opacity: metricsEnabled ? 1 : 0.3
                                    }}
                                    onMouseEnter={(e) => {
                                        if (metricsEnabled) {
                                            e.target.style.color = '#00d4ff';
                                            e.target.style.transform = 'scale(1.2)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (metricsEnabled) {
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
                                    placeholder="DEF"
                                    title="Defense"
                                    style={{ color: '#fff' }}
                                />
                                <input
                                    type="number"
                                    className="hud-input"
                                    value={config[`attack${num}`] || ''}
                                    onChange={(e) => onConfigChange(`attack${num}`, parseInt(e.target.value) || 0)}
                                    placeholder="ATK"
                                    title="Attack"
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
        </div>
    );
};

export default NeuralLink;
