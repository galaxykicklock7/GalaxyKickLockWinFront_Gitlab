import React, { useState, useEffect } from 'react';
import './TimerStatusIndicator.css';
import { getSessionToken } from '../utils/auth';

const TimerStatusIndicator = ({ wsNumber, backendUrl, userId }) => {
  const [timerStatus, setTimerStatus] = useState('normal');
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [stuckType, setStuckType] = useState(null); // 'attack' or 'defense'

  useEffect(() => {
    // Don't fetch if backendUrl is not available
    if (!backendUrl || !userId) {
      return;
    }

    const fetchTimerStatus = async () => {
      try {
        // Fetch in-memory timer status
        const statusResponse = await fetch(`${backendUrl}/api/timer-status/${wsNumber}`, {
          headers: {
            'bypass-tunnel-reminder': 'true'
          }
        });
        
        let memoryStatus = 'normal';
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          if (statusData.success) {
            memoryStatus = statusData.state;
            setLastUpdate(statusData.lastUpdate);
          }
        }

        // Fetch database-based stuck detection
        const stuckResponse = await fetch(`${backendUrl}/api/check-stuck-at-max/${wsNumber}`, {
          headers: {
            'bypass-tunnel-reminder': 'true',
            'x-user-id': userId
          }
        });

        if (stuckResponse.ok) {
          const stuckData = await stuckResponse.json();
          if (stuckData.success && stuckData.stuckAtMax) {
            // Database says we're stuck at max - override memory status
            setTimerStatus('stuck_at_max');
            setStuckType(stuckData.stuckType);
          } else {
            // Not stuck - use memory status
            setTimerStatus(memoryStatus);
            setStuckType(null);
          }
        } else {
          // Fallback to memory status if database check fails
          setTimerStatus(memoryStatus);
        }
      } catch (error) {
        // Silently fail - don't spam console
      }
    };

    // Fetch immediately
    fetchTimerStatus();

    // Poll every 5 seconds; skip when tab hidden (5 instances × 2 fetches = 10 req/poll)
    const interval = setInterval(() => {
      if (!document.hidden) fetchTimerStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [wsNumber, backendUrl, userId]);

  const getStatusClass = () => {
    switch (timerStatus) {
      case 'success':
        return 'timer-status-success';
      case 'adjusting':
        return 'timer-status-adjusting';
      case 'stuck_at_max':
        return 'timer-status-stuck-max';
      case 'stuck_at_min':
        return 'timer-status-stuck-min';
      default:
        return 'timer-status-normal';
    }
  };

  const getTooltip = () => {
    switch (timerStatus) {
      case 'success':
        return '✅ Timer working well - successful action';
      case 'adjusting':
        return '🟡 Timer adjusting - normal operation';
      case 'stuck_at_max':
        return `⚠️ Stuck at max ${stuckType || 'timing'}! Increase max ${stuckType || 'value'} to continue`;
      case 'stuck_at_min':
        return '⚠️ Timer at minimum! Decrease min value to continue';
      default:
        return '⚪ Timer status: normal';
    }
  };

  return (
    <span 
      className={`timer-status-indicator ${getStatusClass()}`}
      title={getTooltip()}
    >
    </span>
  );
};

export default TimerStatusIndicator;
