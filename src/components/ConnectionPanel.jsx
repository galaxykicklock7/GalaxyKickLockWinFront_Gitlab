import React, { useState, useEffect } from 'react';
import { FaChartLine, FaBrain } from 'react-icons/fa';
import MetricsModal from './MetricsModal';
import MLLearningModal from './MLLearningModal';
import TimerStatusIndicator from './TimerStatusIndicator';
import './ConnectionPanel.css';

const ConnectionPanel = ({
  config,
  onConfigChange,
  onConnect,
  onDisconnect,
  onReleaseAll,
  onFlyToPlanet,
  connected,
  loading,
  status,
  backendUrl
}) => {
  const [showMetrics, setShowMetrics] = useState(false);
  const [showMLLearning, setShowMLLearning] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [metricsData, setMetricsData] = useState({});
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [userId, setUserId] = useState(null);

  // Get user ID from Supabase
  useEffect(() => {
    const getUserId = async () => {
      const { supabase } = await import('../utils/supabase');
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    };
    getUserId();
  }, []);

  // Fetch metrics data from backend
  const fetchMetricsData = async (connNum) => {
    setLoadingMetrics(true);
    try {
      const { getBestUrl } = await import('../utils/api');
      const { supabase } = await import('../utils/supabase');
      const backendUrl = getBestUrl();
      
      if (!backendUrl) {
        console.warn('Backend not active');
        return [];
      }

      // Get current user from Supabase
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        console.warn('User not authenticated');
        return [];
      }

      const response = await fetch(`${backendUrl}/api/metrics/${connNum}`, {
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
          'x-user-id': user.id // Send user ID from Supabase auth
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
    
    // Fetch fresh data when opening modal
    if (!metricsData[connNum]) {
      await fetchMetricsData(connNum);
    }
  };

  const handleMLLearningClick = (connNum) => {
    setSelectedConnection(connNum);
    setShowMLLearning(true);
  };

  return (
    <>
      <fieldset className="connection-panel">
        <legend>Connection</legend>

        <div className="codes-grid">
          {[1, 2, 3, 4, 5].map((num) => (
            <div key={num} className="code-row-container">
              <div className="code-labels">
                <span className="code-label-with-status">
                  <span className={`ws-status-dot ${status?.websockets?.[`ws${num}`] ? 'ws-connected' : 'ws-disconnected'}`}></span>
                  {config.timershift && backendUrl && userId && (
                    <TimerStatusIndicator wsNumber={num} backendUrl={backendUrl} userId={userId} />
                  )}
                  Code {num}
                  <button 
                    className="metrics-icon-btn ml-learning-btn"
                    onClick={() => {
                      console.log('ML Learning clicked for connection', num);
                      handleMLLearningClick(num);
                    }}
                    title={`View ML Learning for Conn ${num}`}
                    style={{ display: 'inline-flex' }}
                  >
                    <FaBrain />
                  </button>
                  <button 
                    className="metrics-icon-btn"
                    onClick={() => handleMetricsClick(num)}
                    title={`View Conn ${num} Metrics`}
                  >
                    <FaChartLine />
                  </button>
                </span>
                <span>Code {num} Alt</span>
                <span>Defense</span>
                <span>Attack</span>
              </div>
              <div className="code-row">
                <input
                  type="text"
                  maxLength="10"
                  value={config[`rc${num}`]}
                  onChange={(e) => onConfigChange(`rc${num}`, e.target.value)}
                  placeholder={`Code ${num}`}
                />
                <input
                  type="text"
                  maxLength="10"
                  value={config[`rcl${num}`]}
                  onChange={(e) => onConfigChange(`rcl${num}`, e.target.value)}
                  placeholder="Alt"
                />
                <input
                  type="number"
                  className="timer-input"
                  value={config[`waiting${num}`] || ''}
                  onChange={(e) => onConfigChange(`waiting${num}`, parseInt(e.target.value) || 0)}
                />
                <input
                  type="number"
                  className="timer-input"
                  value={config[`attack${num}`] || ''}
                  onChange={(e) => onConfigChange(`attack${num}`, parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="controls">
          <button 
            className="btn btn-primary" 
            onClick={onConnect}
            disabled={connected || loading}
          >
            Connect
          </button>
          <button 
            className="btn btn-danger" 
            onClick={onDisconnect}
            disabled={!connected || loading}
          >
            Exit
          </button>
          <button 
            className="btn btn-release" 
            onClick={onReleaseAll}
            disabled={!connected}
          >
            Release All
          </button>
        </div>

        <div className="connection-grid">
          <div className="connection-column">
            <div className="form-group">
              <label>Planet:</label>
              <div className="planet-fly-row">
                <input
                  type="text"
                  value={config.planet}
                  onChange={(e) => onConfigChange('planet', e.target.value)}
                  placeholder="Enter planet"
                />
                <button 
                  className="btn btn-fly" 
                  onClick={onFlyToPlanet}
                  disabled={!connected || !config.planet}
                >
                  Fly
                </button>
              </div>
            </div>

            <div className="device-selection">
              <label>
                <input
                  type="radio"
                  name="device"
                  value="312"
                  checked={config.device === '312'}
                  onChange={(e) => onConfigChange('device', e.target.value)}
                />
                Android
              </label>
              <label>
                <input
                  type="radio"
                  name="device"
                  value="323"
                  checked={config.device === '323'}
                  onChange={(e) => onConfigChange('device', e.target.value)}
                />
                iOS
              </label>
              <label>
                <input
                  type="radio"
                  name="device"
                  value="352"
                  checked={config.device === '352'}
                  onChange={(e) => onConfigChange('device', e.target.value)}
                />
                Web
              </label>
            </div>
          </div>

          <div className="connection-column">
            <div className="form-group">
              <label>Reconnect (ms):</label>
              <input
                type="number"
                value={config.reconnect || ''}
                onChange={(e) => onConfigChange('reconnect', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
      </fieldset>

      {/* Metrics Modal */}
      <MetricsModal
        isOpen={showMetrics}
        onClose={() => setShowMetrics(false)}
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
    </>
  );
};

export default ConnectionPanel;