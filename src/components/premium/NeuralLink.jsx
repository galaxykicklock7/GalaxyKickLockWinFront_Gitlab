import React from 'react';
import { FaFingerprint, FaShieldAlt, FaCrosshairs, FaSkullCrossbones } from 'react-icons/fa';
import './PremiumLayout.css';

const NeuralLink = ({ config, onConfigChange, status, connected }) => {
    // Get prison status from backend status
    // Backend should return: { prisonStatus: { "actualcode1": true, "actualcode2": false, ... } }
    const prisonStatus = status?.prisonStatus || {};
    
    return (
        <div className="hud-panel neural-link">
            <div className="panel-header">
                <FaFingerprint className="panel-icon" />
                <span className="panel-title">CONNECTION MATRIX</span>
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
        </div>
    );
};

export default NeuralLink;
