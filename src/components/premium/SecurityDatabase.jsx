import React, { useState } from 'react';
import { FaDatabase, FaShieldAlt, FaBan } from 'react-icons/fa';
import './PremiumLayout.css';

const SecurityDatabase = ({ config, onConfigChange, showToast }) => {
    // Auto-switch tab based on protocol selection, but allow manual override
    const [manualTab, setManualTab] = useState(null);
    
    // Determine active tab
    let activeTab;
    if (manualTab) {
        activeTab = manualTab;
    } else if (config.imprisonmode) {
        activeTab = 'IMPRISON';
    } else {
        activeTab = 'KICK';
    }

    // Validate target names - prevent adding own username or codes
    const handleTargetChange = (field, value) => {
        // Get current user's username from session
        const session = JSON.parse(localStorage.getItem('galaxyKickLockSession') || '{}');
        const currentUsername = session.username?.toLowerCase();

        // Get all RC codes
        const allCodes = [
            config.rc1, config.rc2, config.rc3, config.rc4, config.rc5,
            config.rcl1, config.rcl2, config.rcl3, config.rcl4, config.rcl5,
            config.kickrc
        ].filter(code => code && code.trim()).map(code => code.toLowerCase());

        // Split the input by newlines or commas
        const targets = value.split(/[\n,]/).map(t => t.trim()).filter(t => t);

        // Check each target
        for (const target of targets) {
            const lowerTarget = target.toLowerCase();
            
            // Check if target is own username
            if (currentUsername && lowerTarget === currentUsername) {
                if (showToast) {
                    showToast('Cannot add your own username to target list', 'error');
                }
                return; // Don't update
            }

            // Check if target is one of the RC codes
            if (allCodes.includes(lowerTarget)) {
                if (showToast) {
                    showToast('Cannot add your own connection codes to target list', 'error');
                }
                return; // Don't update
            }
        }

        // If validation passes, update the config
        onConfigChange(field, value);
    };

    return (
        <div className="hud-panel security-db">
            <div className="panel-header">
                <FaShieldAlt className="panel-icon" />
                <span className="panel-title">TARGET DATABASE</span>
            </div>

            <div className="security-tabs">
                <button
                    className={`sec-tab ${activeTab === 'IMPRISON' ? 'active' : ''}`}
                    onClick={() => setManualTab('IMPRISON')}
                >
                    <FaBan style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                    IMPRISON
                </button>
                <button
                    className={`sec-tab ${activeTab === 'KICK' ? 'active' : ''}`}
                    onClick={() => setManualTab('KICK')}
                >
                    <FaDatabase style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                    KICK
                </button>
            </div>

            <div className="security-content">
                <div className="list-container">
                    <span className="section-label">TARGET USERNAMES</span>
                    <textarea
                        className="db-textarea"
                        value={activeTab === 'IMPRISON' ? config.blacklist : config.kblacklist}
                        onChange={(e) => handleTargetChange(activeTab === 'IMPRISON' ? 'blacklist' : 'kblacklist', e.target.value)}
                        placeholder="ENTER TARGETS..."
                        style={{ color: '#fff' }}
                    />
                </div>

                <div className="list-container">
                    <span className="section-label">TARGET CLANS</span>
                    <textarea
                        className="db-textarea"
                        value={activeTab === 'IMPRISON' ? config.gangblacklist : config.kgangblacklist}
                        onChange={(e) => handleTargetChange(activeTab === 'IMPRISON' ? 'gangblacklist' : 'kgangblacklist', e.target.value)}
                        placeholder="ENTER CLANS..."
                        style={{ color: '#fff' }}
                    />
                </div>
            </div>
        </div>
    );
};

export default SecurityDatabase;
