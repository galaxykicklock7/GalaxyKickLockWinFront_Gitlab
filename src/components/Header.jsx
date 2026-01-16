import React from 'react';
import './Header.css';

const Header = ({ status, connected, loading, error, currentUser, onLogout }) => {
  return (
    <header className="header">
      <h1 className="title">GALAXY KICK LOCK 2.0</h1>
      
      <div className="status-bar">
        <div className="status-item">
          <span 
            className={`status-indicator ${
              loading ? 'loading' : connected ? 'connected' : 'disconnected'
            }`}
          />
          <span className="status-text">
            {loading ? 'Connecting...' : connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {currentUser && (
          <div className="user-info">
            <span className="username">👤 {currentUser.username}</span>
            <button className="logout-button" onClick={onLogout}>
              Logout
            </button>
          </div>
        )}

        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
