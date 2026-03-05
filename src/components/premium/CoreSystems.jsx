import React from 'react';
import { FaMicrochip, FaShieldAlt, FaSkull, FaRobot, FaSlidersH, FaPowerOff, FaMoon } from 'react-icons/fa';
import './PremiumLayout.css';

const CoreSystems = ({ config, onConfigChange, onAiCoreToggle, aiCoreEnabled, aiCoreLoading, connected }) => {
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
                    <div className="matrix-grid-two">
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

                {/* AI CORE + SPEED PRESET - Left Bottom */}
                <div className="ai-core-wrapper">
                    <div
                        className={`ai-core-container ${aiCoreEnabled ? 'active' : ''} ${aiCoreLoading ? 'loading' : ''}`}
                        onClick={() => connected && !aiCoreLoading && onAiCoreToggle && onAiCoreToggle()}
                        style={{
                            cursor: connected && !aiCoreLoading ? 'pointer' : 'not-allowed',
                            opacity: connected ? 1 : 0.5,
                            pointerEvents: aiCoreLoading ? 'none' : 'auto'
                        }}
                        title={
                            aiCoreLoading ? 'Processing...' :
                            connected ? (aiCoreEnabled ? 'AI CORE ACTIVE - Click to disable' : 'Click to activate AI CORE for all connections') :
                            'Connect first to enable AI CORE'
                        }
                    >
                        <div className="ai-pulse"></div>
                        <div className="ai-label">
                            <FaRobot style={{ fontSize: '14px' }} />
                            <span>{aiCoreLoading ? 'PROCESSING...' : 'AI CORE'}</span>
                            {aiCoreEnabled && !aiCoreLoading && (
                                <span style={{ fontSize: '7px', color: '#00ff88', marginLeft: '5px', fontWeight: 600 }}>
                                    ACTIVE
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="speed-preset-row">
                        <div
                            className={`speed-btn ${config.speedPreset === 'SLOW' ? 'active slow' : ''} ${!aiCoreEnabled ? 'disabled' : ''}`}
                            onClick={() => aiCoreEnabled && onConfigChange('speedPreset', config.speedPreset === 'SLOW' ? '' : 'SLOW')}
                            style={{
                                cursor: aiCoreEnabled ? 'pointer' : 'not-allowed',
                                opacity: aiCoreEnabled ? 1 : 0.5,
                                pointerEvents: aiCoreEnabled ? 'auto' : 'none'
                            }}
                            title={!aiCoreEnabled ? "Enable AI CORE to use speed presets" : ""}
                        >
                            SLOW
                        </div>
                        <div
                            className={`speed-btn ${config.speedPreset === 'NORMAL' ? 'active normal' : ''} ${!aiCoreEnabled ? 'disabled' : ''}`}
                            onClick={() => aiCoreEnabled && onConfigChange('speedPreset', config.speedPreset === 'NORMAL' ? '' : 'NORMAL')}
                            style={{
                                cursor: aiCoreEnabled ? 'pointer' : 'not-allowed',
                                opacity: aiCoreEnabled ? 1 : 0.5,
                                pointerEvents: aiCoreEnabled ? 'auto' : 'none'
                            }}
                            title={!aiCoreEnabled ? "Enable AI CORE to use speed presets" : ""}
                        >
                            NORMAL
                        </div>
                        <div
                            className={`speed-btn ${config.speedPreset === 'FAST' ? 'active fast' : ''} ${!aiCoreEnabled ? 'disabled' : ''}`}
                            onClick={() => aiCoreEnabled && onConfigChange('speedPreset', config.speedPreset === 'FAST' ? '' : 'FAST')}
                            style={{
                                cursor: aiCoreEnabled ? 'pointer' : 'not-allowed',
                                opacity: aiCoreEnabled ? 1 : 0.5,
                                pointerEvents: aiCoreEnabled ? 'auto' : 'none'
                            }}
                            title={!aiCoreEnabled ? "Enable AI CORE to use speed presets" : ""}
                        >
                            FAST
                        </div>
                    </div>
                </div>

                {/* AUTO TIMING - Right Bottom */}
                <div className="control-section">
                    <span className="section-label">AUTO TIMING</span>
                    <div className="tuning-grid">
                        <div className="tuning-row">
                            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>INC/DEC</span>
                            <div style={{ display: 'flex', gap: '3px' }}>
                                <input 
                                    type="number" 
                                    className="tiny-input" 
                                    value={config.incrementvalue || ''} 
                                    onChange={(e) => onConfigChange('incrementvalue', parseInt(e.target.value) || 0)} 
                                    placeholder="Inc"
                                    disabled={aiCoreEnabled}
                                    title={aiCoreEnabled ? "Disabled - AI Core active" : "Increment value"}
                                />
                                <input 
                                    type="number" 
                                    className="tiny-input" 
                                    value={config.decrementvalue || ''} 
                                    onChange={(e) => onConfigChange('decrementvalue', parseInt(e.target.value) || 0)} 
                                    placeholder="Dec"
                                    disabled={aiCoreEnabled}
                                    title={aiCoreEnabled ? "Disabled - AI Core active" : "Decrement value"}
                                />
                            </div>
                        </div>

                        <div className="tuning-row">
                            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>DEF</span>
                            <div style={{ display: 'flex', gap: '3px' }}>
                                <input 
                                    type="number" 
                                    className="tiny-input" 
                                    value={config.mindef || ''} 
                                    onChange={(e) => onConfigChange('mindef', parseInt(e.target.value) || 0)} 
                                    placeholder="Min"
                                    disabled={aiCoreEnabled}
                                    title={aiCoreEnabled ? "Disabled - AI Core active" : "Min defense"}
                                />
                                <input 
                                    type="number" 
                                    className="tiny-input" 
                                    value={config.maxdef || ''} 
                                    onChange={(e) => onConfigChange('maxdef', parseInt(e.target.value) || 0)} 
                                    placeholder="Max"
                                    disabled={aiCoreEnabled}
                                    title={aiCoreEnabled ? "Disabled - AI Core active" : "Max defense"}
                                />
                            </div>
                        </div>

                        <div className="tuning-row">
                            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>ATK</span>
                            <div style={{ display: 'flex', gap: '3px' }}>
                                <input 
                                    type="number" 
                                    className="tiny-input" 
                                    value={config.minatk || ''} 
                                    onChange={(e) => onConfigChange('minatk', parseInt(e.target.value) || 0)} 
                                    placeholder="Min"
                                    disabled={aiCoreEnabled}
                                    title={aiCoreEnabled ? "Disabled - AI Core active" : "Min attack"}
                                />
                                <input 
                                    type="number" 
                                    className="tiny-input" 
                                    value={config.maxatk || ''} 
                                    onChange={(e) => onConfigChange('maxatk', parseInt(e.target.value) || 0)} 
                                    placeholder="Max"
                                    disabled={aiCoreEnabled}
                                    title={aiCoreEnabled ? "Disabled - AI Core active" : "Max attack"}
                                />
                            </div>
                        </div>

                        <div className="tuning-row" style={{ marginTop: '2px' }}>
                            <div
                                className={`cyber-toggle ${config.timershift ? 'active' : ''} ${aiCoreEnabled ? 'disabled' : ''}`}
                                onClick={() => !aiCoreEnabled && onConfigChange('timershift', !config.timershift)}
                                style={{ 
                                    width: '100%',
                                    cursor: aiCoreEnabled ? 'not-allowed' : 'pointer',
                                    opacity: aiCoreEnabled ? 0.5 : 1
                                }}
                                title={aiCoreEnabled ? "Disabled - AI Core controls timing" : "Toggle Auto Interval"}
                            >
                                AUTO INT {aiCoreEnabled && '(AI)'}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default CoreSystems;
