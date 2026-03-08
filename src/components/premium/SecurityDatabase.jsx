import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FaDatabase, FaShieldAlt, FaBan } from 'react-icons/fa';
import { storageManager } from '../../utils/storageManager';
import './PremiumLayout.css';

const SecurityDatabase = ({ config, onConfigChange, showToast }) => {
    // Auto-switch tab based on protocol selection, but allow manual override
    const [manualTab, setManualTab] = useState(null);
    const [usernameListType, setUsernameListType] = useState('blacklist'); // 'blacklist' or 'whitelist'
    const [clanListType, setClanListType] = useState('blacklist'); // 'blacklist' or 'whitelist'

    // Cache the session username to avoid re-parsing localStorage on every keystroke
    const currentUsernameRef = useRef(null);
    useEffect(() => {
        const updateUsername = () => {
            try {
                const session = JSON.parse(storageManager.getItem('galaxyKickLockSession') || '{}');
                currentUsernameRef.current = session.username?.toLowerCase() || null;
            } catch {
                currentUsernameRef.current = null;
            }
        };
        updateUsername();
        window.addEventListener('storage', updateUsername);
        return () => window.removeEventListener('storage', updateUsername);
    }, []);

    // Determine active tab
    let activeTab;
    if (manualTab) {
        activeTab = manualTab;
    } else if (config.imprisonmode) {
        activeTab = 'IMPRISON';
    } else {
        activeTab = 'KICK';
    }

    // onChange: just save the value, no validation while typing
    const handleTargetChange = useCallback((field, value) => {
        onConfigChange(field, value);
    }, [onConfigChange]);

    // Opposite list within the same tab only (blacklist↔whitelist, not cross-tab)
    const getOppositeField = (field) => {
        const opposites = {
            blacklist: 'whitelist', whitelist: 'blacklist',
            kblacklist: 'kwhitelist', kwhitelist: 'kblacklist',
            gangblacklist: 'gangwhitelist', gangwhitelist: 'gangblacklist',
            kgangblacklist: 'kgangwhitelist', kgangwhitelist: 'kgangblacklist',
        };
        return opposites[field] || null;
    };

    const getFullLabel = (field) => {
        const isWhite = field.includes('white');
        const listType = isWhite ? 'WHITELIST' : 'BLACKLIST';
        const isClan = field.includes('gang');
        const section = isClan ? 'CLANS' : 'USERNAMES';
        const isKick = field.startsWith('k');
        const tab = isKick ? 'KICK' : 'IMPRISON';
        return `${tab} ${section} ${listType}`;
    };

    // onBlur: validate entries — block own username/codes, warn+remove if in opposite list, auto-remove duplicates
    const handleTargetBlur = useCallback((field, value) => {
        const currentUsername = currentUsernameRef.current;
        const allCodes = [
            config.rc1, config.rc2, config.rc3, config.rc4, config.rc5,
            config.rcl1, config.rcl2, config.rcl3, config.rcl4, config.rcl5,
            config.kickrc
        ].filter(code => code && code.trim()).map(code => code.toLowerCase());

        const oppositeField = getOppositeField(field);
        const oppositeSet = new Set();
        if (oppositeField) {
            (config[oppositeField] || '').split(/[\n,]/).map(s => s.trim().toLowerCase()).filter(s => s)
                .forEach(s => oppositeSet.add(s));
        }

        const entries = value.split(/[\n,]/).map(t => t.trim()).filter(t => t);
        const seen = new Set();
        const unique = [];
        const removed = [];
        const crossConflicts = [];

        for (const target of entries) {
            const lowerTarget = target.toLowerCase();

            if (currentUsername && lowerTarget === currentUsername) {
                if (showToast) showToast('Cannot add your own username to target list', 'error');
                return;
            }

            if (allCodes.includes(lowerTarget)) {
                if (showToast) showToast('Cannot add your own connection codes to target list', 'error');
                return;
            }

            // Check if name exists in opposite list (blacklist↔whitelist within same tab)
            if (oppositeSet.has(lowerTarget)) {
                crossConflicts.push(target);
                continue;
            }

            if (seen.has(lowerTarget)) {
                removed.push(target);
            } else {
                seen.add(lowerTarget);
                unique.push(target);
            }
        }

        let changed = false;

        if (crossConflicts.length > 0) {
            const label = getFullLabel(oppositeField);
            if (showToast) showToast(`${crossConflicts.join(', ')} already in ${label} — removed from ${getFullLabel(field)}`, 'warning');
            changed = true;
        }

        if (removed.length > 0) {
            const label = getFullLabel(field);
            if (showToast) showToast(`Removed duplicate${removed.length > 1 ? 's' : ''} from ${label}: ${removed.join(', ')}`, 'info');
            changed = true;
        }

        if (changed) {
            onConfigChange(field, unique.join('\n'));
        }
    }, [config, showToast, onConfigChange]);

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
                {/* Usernames Section */}
                <div className="list-container-horizontal">
                    <div className="list-full">
                        <div className="section-header-with-tabs">
                            <span className="section-label-left">USERNAMES</span>
                            <div className="list-tabs-horizontal">
                                <button
                                    className={`list-type-tab-horizontal ${usernameListType === 'blacklist' ? 'active' : ''}`}
                                    onClick={() => setUsernameListType('blacklist')}
                                >
                                    BLACKLIST
                                </button>
                                <button
                                    className={`list-type-tab-horizontal ${usernameListType === 'whitelist' ? 'active' : ''}`}
                                    onClick={() => setUsernameListType('whitelist')}
                                >
                                    WHITELIST
                                </button>
                            </div>
                        </div>
                        <textarea
                            className="db-textarea-large"
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
                            onBlur={(e) => {
                                const field = usernameListType === 'blacklist'
                                    ? (activeTab === 'IMPRISON' ? 'blacklist' : 'kblacklist')
                                    : (activeTab === 'IMPRISON' ? 'whitelist' : 'kwhitelist');
                                handleTargetBlur(field, e.target.value);
                            }}
                            placeholder={
                                usernameListType === 'blacklist'
                                    ? "ENTER TARGETS TO ATTACK..."
                                    : "ENTER USERS TO SKIP..."
                            }
                            style={{ color: '#fff' }}
                        />
                    </div>
                </div>

                {/* Clans Section */}
                <div className="list-container-horizontal">
                    <div className="list-full">
                        <div className="section-header-with-tabs">
                            <span className="section-label-left">CLANS</span>
                            <div className="list-tabs-horizontal">
                                <button
                                    className={`list-type-tab-horizontal ${clanListType === 'blacklist' ? 'active' : ''}`}
                                    onClick={() => setClanListType('blacklist')}
                                >
                                    BLACKLIST
                                </button>
                                <button
                                    className={`list-type-tab-horizontal ${clanListType === 'whitelist' ? 'active' : ''}`}
                                    onClick={() => setClanListType('whitelist')}
                                >
                                    WHITELIST
                                </button>
                            </div>
                        </div>
                        <textarea
                            className="db-textarea-large"
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
                            onBlur={(e) => {
                                const field = clanListType === 'blacklist'
                                    ? (activeTab === 'IMPRISON' ? 'gangblacklist' : 'kgangblacklist')
                                    : (activeTab === 'IMPRISON' ? 'gangwhitelist' : 'kgangwhitelist');
                                handleTargetBlur(field, e.target.value);
                            }}
                            placeholder={
                                clanListType === 'blacklist'
                                    ? "ENTER CLANS TO ATTACK..."
                                    : "ENTER CLANS TO SKIP..."
                            }
                            style={{ color: '#fff' }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SecurityDatabase;
