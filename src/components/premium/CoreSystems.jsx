import React from 'react';
import { FaMicrochip, FaShieldAlt, FaSkull, FaRobot, FaSlidersH, FaPowerOff, FaMoon } from 'react-icons/fa';
import './PremiumLayout.css';

const CoreSystems = ({ config, onConfigChange }) => {
    return (
        <div className="hud-panel core-systems">
            <div className="panel-header">
                <FaMicrochip className="panel-icon" />
                <span className="panel-title">CORE SYSTEMS</span>
            </div>

            <div className="core-systems-content">

                {/* MODE SECTOR - Top Full Width */}
                <div className="control-section" style={{ gridColumn: '1 / 3' }}>
                    <span className="section-label">MODE SECTOR</span>
                    <div className="switch-row">
                        <div className="rocker-switch">
                            <div
                                className={`switch-option ${config.exitting ? 'active danger' : ''}`}
                                onClick={() => {
                                    onConfigChange('exitting', true);
                                    onConfigChange('sleeping', false);
                                }}
                            >
                                <FaPowerOff /> EXIT
                            </div>
                            <div
                                className={`switch-option ${config.sleeping ? 'active' : ''}`}
                                onClick={() => {
                                    onConfigChange('exitting', false);
                                    onConfigChange('sleeping', true);
                                }}
                            >
                                <FaMoon /> SLEEP
                            </div>
                        </div>
                    </div>
                </div>

                {/* DEFENSE MATRIX - Left */}
                <div className="control-section">
                    <span className="section-label">DEFENSE MATRIX</span>
                    <div className="matrix-grid-three">
                        <div
                            className={`cyber-toggle ${config.autorelease ? 'active' : ''}`}
                            onClick={() => onConfigChange('autorelease', !config.autorelease)}
                        >
                            AUTO RELEASE
                        </div>
                        <div
                            className={`cyber-toggle ${config.smart ? 'active' : ''}`}
                            onClick={() => onConfigChange('smart', !config.smart)}
                        >
                            SMART MODE
                        </div>
                        <div
                            className={`cyber-toggle ${config.lowsecmode ? 'active' : ''}`}
                            onClick={() => onConfigChange('lowsecmode', !config.lowsecmode)}
                        >
                            LOW-SEC
                        </div>
                    </div>
                </div>

                {/* KICK PROTOCOLS - Right */}
                <div className="control-section">
                    <span className="section-label">KICK PROTOCOLS</span>
                    <div className="kick-grid">
                        {/* Row 1: Primary Action (KICK, IMPRISON, BAN) - Always one selected */}
                        <div className="kick-row">
                            <div
                                className={`protocol-btn ${config.kickmode ? 'active' : ''}`}
                                onClick={() => {
                                    onConfigChange('kickmode', true);
                                    onConfigChange('imprisonmode', false);
                                    onConfigChange('modena', false);
                                }}
                            >
                                KICK
                            </div>
                            <div
                                className={`protocol-btn ${config.imprisonmode ? 'active' : ''}`}
                                onClick={() => {
                                    onConfigChange('imprisonmode', true);
                                    onConfigChange('kickmode', false);
                                    onConfigChange('modena', false);
                                }}
                            >
                                IMPRISON
                            </div>
                            <div
                                className={`protocol-btn ${config.modena ? 'active' : ''}`}
                                onClick={() => {
                                    onConfigChange('modena', true);
                                    onConfigChange('kickmode', false);
                                    onConfigChange('imprisonmode', false);
                                }}
                                title="Ban users"
                            >
                                BAN
                            </div>
                        </div>

                        {/* Row 2: Target Modifier (NONE, ALL, BLACKLIST, DAD+) - Always one selected */}
                        <div className="kick-row four-col">
                            <div
                                className={`protocol-btn ${!config.kickall && !config.kickbybl && !config.dadplus ? 'active' : ''}`}
                                onClick={() => {
                                    onConfigChange('kickall', false);
                                    onConfigChange('kickbybl', false);
                                    onConfigChange('dadplus', false);
                                }}
                            >
                                NONE
                            </div>
                            <div
                                className={`protocol-btn ${config.kickall ? 'active' : ''}`}
                                onClick={() => {
                                    onConfigChange('kickall', true);
                                    onConfigChange('kickbybl', false);
                                    onConfigChange('dadplus', false);
                                }}
                            >
                                ALL
                            </div>
                            <div
                                className={`protocol-btn ${config.kickbybl ? 'active' : ''}`}
                                onClick={() => {
                                    onConfigChange('kickbybl', true);
                                    onConfigChange('kickall', false);
                                    onConfigChange('dadplus', false);
                                }}
                                title={
                                    config.imprisonmode 
                                        ? 'Uses IMPRISON blacklist (usernames + clans)' 
                                        : config.kickmode 
                                            ? 'Uses KICK blacklist (usernames + clans)' 
                                            : 'Uses ALL blacklists (KICK + IMPRISON usernames + clans)'
                                }
                            >
                                BLACKLIST
                            </div>
                            <div
                                className={`protocol-btn ${config.dadplus ? 'active' : ''}`}
                                onClick={() => {
                                    onConfigChange('dadplus', true);
                                    onConfigChange('kickall', false);
                                    onConfigChange('kickbybl', false);
                                }}
                            >
                                DAD+
                            </div>
                        </div>
                    </div>
                </div>

                {/* AI CORE - Left Bottom */}
                <div
                    className="ai-core-container"
                    style={{ cursor: 'default' }}
                >
                    <div className="ai-pulse"></div>
                    <div className="ai-label">
                        <FaRobot style={{ fontSize: '14px' }} />
                        <span>AI CORE</span>
                        <span style={{ fontSize: '7px', color: '#ff9d00', marginLeft: '5px', fontWeight: 600 }}>
                            COMING SOON
                        </span>
                    </div>
                </div>

                {/* AUTO TIMING - Right Bottom */}
                <div className="control-section">
                    <span className="section-label">AUTO TIMING</span>
                    <div className="tuning-grid">
                        <div className="tuning-row">
                            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>INC/DEC</span>
                            <div style={{ display: 'flex', gap: '3px' }}>
                                <input type="number" className="tiny-input" value={config.incrementvalue || ''} onChange={(e) => onConfigChange('incrementvalue', parseInt(e.target.value) || 0)} placeholder="Inc" />
                                <input type="number" className="tiny-input" value={config.decrementvalue || ''} onChange={(e) => onConfigChange('decrementvalue', parseInt(e.target.value) || 0)} placeholder="Dec" />
                            </div>
                        </div>

                        <div className="tuning-row">
                            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>DEF</span>
                            <div style={{ display: 'flex', gap: '3px' }}>
                                <input type="number" className="tiny-input" value={config.mindef || ''} onChange={(e) => onConfigChange('mindef', parseInt(e.target.value) || 0)} placeholder="Min" />
                                <input type="number" className="tiny-input" value={config.maxdef || ''} onChange={(e) => onConfigChange('maxdef', parseInt(e.target.value) || 0)} placeholder="Max" />
                            </div>
                        </div>

                        <div className="tuning-row">
                            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>ATK</span>
                            <div style={{ display: 'flex', gap: '3px' }}>
                                <input type="number" className="tiny-input" value={config.minatk || ''} onChange={(e) => onConfigChange('minatk', parseInt(e.target.value) || 0)} placeholder="Min" />
                                <input type="number" className="tiny-input" value={config.maxatk || ''} onChange={(e) => onConfigChange('maxatk', parseInt(e.target.value) || 0)} placeholder="Max" />
                            </div>
                        </div>

                        <div className="tuning-row" style={{ marginTop: '2px' }}>
                            <div
                                className={`cyber-toggle ${config.timershift ? 'active' : ''}`}
                                onClick={() => onConfigChange('timershift', !config.timershift)}
                                style={{ width: '100%' }}
                            >
                                AUTO INT
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default CoreSystems;
