import React from 'react';
import { FaRocket, FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import './DeploymentModal.css';

const DeploymentModal = ({ isOpen, status, progress, onClose, isDeactivating = false }) => {
  if (!isOpen) return null;

  const getStatusIcon = () => {
    switch (status) {
      case 'deploying':
        return <div className="deploy-spinner"></div>;
      case 'deployed':
        return <FaCheckCircle className="deploy-icon success" />;
      case 'failed':
        return <FaTimesCircle className="deploy-icon error" />;
      default:
        return <FaRocket className="deploy-icon" />;
    }
  };

  const getStatusTitle = () => {
    if (isDeactivating) {
      return status === 'deploying' ? 'DEACTIVATING SYSTEM' : 'SYSTEM DEACTIVATED';
    }
    
    switch (status) {
      case 'deploying':
        return 'ACTIVATING GALAXY KICK LOCK 2.0';
      case 'deployed':
        return 'SYSTEM ACTIVATED';
      case 'failed':
        return 'ACTIVATION FAILED';
      default:
        return 'INITIALIZING';
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'deploying':
        return progress.message || (isDeactivating ? 'Deactivating system...' : 'Initializing deployment sequence...');
      case 'deployed':
        return isDeactivating ? 'System has been deactivated successfully.' : 'Galaxy Kick Lock 2.0 is now online and ready for connection.';
      case 'failed':
        return progress.message || (isDeactivating ? 'Deactivation failed. Please try again.' : 'Deployment failed. Please try again.');
      default:
        return '';
    }
  };

  const progressPercentage = progress.percentage || 0;

  return (
    <div className="deploy-modal-backdrop">
      <div className="deploy-modal-container">
        <div className="deploy-modal-header">
          {getStatusIcon()}
          <h2 className="deploy-modal-title">{getStatusTitle()}</h2>
        </div>

        <div className="deploy-modal-body">
          <p className="deploy-modal-message">{getStatusMessage()}</p>

          {status === 'deploying' && (
            <div className="deploy-progress-container">
              <div className="deploy-progress-bar">
                <div 
                  className="deploy-progress-fill"
                  style={{ width: `${progressPercentage}%` }}
                >
                  <div className="deploy-progress-glow"></div>
                </div>
              </div>
              <div className="deploy-progress-text">
                {progressPercentage}% Complete
              </div>
            </div>
          )}

          {status === 'deployed' && (
            <div className="deploy-success-animation">
              <div className="success-pulse"></div>
              <div className="success-ring"></div>
            </div>
          )}

          {status === 'failed' && (
            <div className="deploy-error-details">
              <p className="error-hint">Check your GitHub token permissions or try again.</p>
            </div>
          )}
        </div>

        {(status === 'deployed' || status === 'failed') && (
          <div className="deploy-modal-footer">
            <button className="deploy-modal-btn" onClick={onClose}>
              {status === 'deployed' ? 'CONTINUE' : 'CLOSE'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeploymentModal;
