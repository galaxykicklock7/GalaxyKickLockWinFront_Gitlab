import React from 'react';
import './BlacklistPanel.css';

const BlacklistPanel = ({ config, onConfigChange }) => {
  return (
    <>
      <fieldset className="blacklist-panel">
        <legend>Imprison Blacklist / Whitelist</legend>
        
        <div className="blacklist-grid">
          <div className="form-group">
            <label>Usernames</label>
            <textarea
              value={config.blacklist}
              onChange={(e) => onConfigChange('blacklist', e.target.value)}
              placeholder="Enter usernames"
            />
          </div>
          
          <div className="form-group">
            <label>Clans</label>
            <textarea
              value={config.gangblacklist}
              onChange={(e) => onConfigChange('gangblacklist', e.target.value)}
              placeholder="Enter clans"
            />
          </div>
        </div>
      </fieldset>
      
      <fieldset className="blacklist-panel">
        <legend>Kick Blacklist / Whitelist</legend>
        
        <div className="blacklist-grid">
          <div className="form-group">
            <label>Usernames</label>
            <textarea
              value={config.kblacklist}
              onChange={(e) => onConfigChange('kblacklist', e.target.value)}
              placeholder="Enter usernames"
            />
          </div>
          
          <div className="form-group">
            <label>Clans</label>
            <textarea
              value={config.kgangblacklist}
              onChange={(e) => onConfigChange('kgangblacklist', e.target.value)}
              placeholder="Enter clans"
            />
          </div>
        </div>
      </fieldset>
    </>
  );
};

export default BlacklistPanel;