import React, { useState } from 'react';
import { FaDatabase, FaShieldAlt, FaBan } from 'react-icons/fa';
import './PremiumLayout.css';

const SecurityDatabase = ({ config, onConfigChange, showToast }) => {
    // Auto-switch tab based on protocol selection, but allow manual override
    const [manualTab, setManualTab] = useState(null);
    const [usernameListType, setUsernameListType] = useState('blacklist'); // 'blacklist' or 'whitelist'
    const [clanListType, setClanListType] = useState('blacklist'); // 'blacklist' or 'whitelist'
    
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
                {/* Target Usernames Section */}
                <div className="list-container">
                    <div className="section-header">
                        <span className="section-label">TARGET USERNAMES</span>
                        <div className="list-type-tabs">
                            <button
                                className={`list-type-tab ${usernameListType === 'blacklist' ? 'active' : ''}`}
                                onClick={() => setUsernameListType('blacklist')}
                            >
                                BLACKLIST
                            </button>
                            <button
                                className={`list-type-tab ${usernameListType === 'whitelist' ? 'active' : ''}`}
                                onClick={() => setUsernameListType('whitelist')}
                            >
                                WHITELIST
                            </button>
                        </div>
                    </div>
                    <textarea
                        className="db-textarea"
                        value={
                            usernameListType === 'blacklist'
                                ? (activeTab === 'IMPRISON' ? config.blacklist : config.kblacklist)
                                : (activeTab === 'IMPRISON' ? config.whitelist : config.kwhitelist)
                        }
                        onChange={(e) => {
                            const field = usernameListType === 'blacklist'
                                ? (activeTab === 'IMPRISON' ? 'blacklist' : 'kblacklist')
                                : (activeTab === 'IMPRISON' ? 'whitelist' : 'kwhitelist');
                            handleTargetChange(field, e.target.value);
                        }}
                        placeholder={
                            usernameListType === 'blacklist'
                                ? "ENTER TARGETS TO ATTACK..."
                                : "ENTER USERS TO SKIP..."
                        }
                        style={{ color: '#fff' }}
                    />
                    <div className="list-hint">
                        {usernameListType === 'blacklist' 
                            ? '⚔️ Users in blacklist will be targeted'
                            : '🛡️ Users in whitelist will be skipped'
                        }
                    </div>
                </div>

                {/* Target Clans Section */}
                <div className="list-container">
                    <div className="section-header">
                        <span className="section-label">TARGET CLANS</span>
                        <div className="list-type-tabs">
                            <button
                                className={`list-type-tab ${clanListType === 'blacklist' ? 'active' : ''}`}
                                onClick={() => setClanListType('blacklist')}
                            >
                                BLACKLIST
                            </button>
                            <button
                                className={`list-type-tab ${clanListType === 'whitelist' ? 'active' : ''}`}
                                onClick={() => setClanListType('whitelist')}
                            >
                                WHITELIST
                            </button>
                        </div>
                    </div>
                    <textarea
                        className="db-textarea"
                        value={
                            clanListType === 'blacklist'
                                ? (activeTab === 'IMPRISON' ? config.gangblacklist : config.kgangblacklist)
                                : (activeTab === 'IMPRISON' ? config.gangwhitelist : config.kgangwhitelist)
                        }
                        onChange={(e) => {
                            const field = clanListType === 'blacklist'
                                ? (activeTab === 'IMPRISON' ? 'gangblacklist' : 'kgangblacklist')
                                : (activeTab === 'IMPRISON' ? 'gangwhitelist' : 'kgangwhitelist');
                            handleTargetChange(field, e.target.value);
                        }}
                        placeholder={
                            clanListType === 'blacklist'
                                ? "ENTER CLANS TO ATTACK..."
                                : "ENTER CLANS TO SKIP..."
                        }
                        style={{ color: '#fff' }}
                    />
                    <div className="list-hint">
                        {clanListType === 'blacklist' 
                            ? '⚔️ Clan members in blacklist will be targeted'
                            : '🛡️ Clan members in whitelist will be skipped'
                        }
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SecurityDatabase;
