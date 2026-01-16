import { useState, useEffect } from 'react';
import { generateToken, getTokensByDuration, deleteToken } from '../utils/adminApi';
import Modal from './Modal';
import './TokenGenerator.css';

function TokenGenerator({ onTokenGenerated, onTokenDeleted, refreshTrigger }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState('');
  const [tokens3, setTokens3] = useState([]);
  const [tokens6, setTokens6] = useState([]);
  const [tokens12, setTokens12] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [deletingToken, setDeletingToken] = useState(null);
  
  // Modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    fetchAllTokens();
  }, []);

  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchAllTokens();
    }
  }, [refreshTrigger]);

  const fetchAllTokens = async () => {
    setLoadingTokens(true);
    try {
      const [result3, result6, result12] = await Promise.all([
        getTokensByDuration(3),
        getTokensByDuration(6),
        getTokensByDuration(12)
      ]);

      if (result3.success) setTokens3(result3.tokens);
      if (result6.success) setTokens6(result6.tokens);
      if (result12.success) setTokens12(result12.tokens);
    } catch (err) {
      console.error('Failed to fetch tokens:', err);
    } finally {
      setLoadingTokens(false);
    }
  };

  const handleGenerate = async (months) => {
    setError('');
    setLoading(months);

    try {
      const result = await generateToken(months);

      if (result.success) {
        // Refresh token lists
        await fetchAllTokens();
        if (onTokenGenerated) {
          onTokenGenerated(result.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to generate token');
    } finally {
      setLoading(null);
    }
  };

  const handleDeleteToken = async () => {
    if (!tokenToDelete) return;

    setShowDeleteModal(false);
    setDeletingToken(tokenToDelete.id);

    try {
      const result = await deleteToken(tokenToDelete.id);

      if (result.success) {
        // Refresh token lists
        await fetchAllTokens();
        setSuccessMessage('Token deleted successfully!');
        setShowSuccessModal(true);
        // Notify parent to refresh user management
        if (onTokenDeleted) {
          onTokenDeleted();
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to delete token');
    } finally {
      setDeletingToken(null);
      setTokenToDelete(null);
    }
  };

  const openDeleteModal = (token) => {
    setTokenToDelete(token);
    setShowDeleteModal(true);
  };

  const getDeleteMessage = (token) => {
    if (token.is_used && token.used_by) {
      return `⚠️ WARNING: This token is currently being used by user "${token.used_by}".\n\nDeleting this token will:\n• Prevent "${token.used_by}" from logging in\n• Enable the renewal option for this user\n• Permanently remove this token\n\nToken: ${token.token_value}\n\nAre you sure you want to delete this token?`;
    }
    return `Are you sure you want to delete this token?\n\nToken: ${token.token_value}`;
  };

  const copyToClipboard = (tokenValue) => {
    navigator.clipboard.writeText(tokenValue);
    setSuccessMessage('Token copied to clipboard!');
    setShowSuccessModal(true);
  };

  const getStatusBadge = (token) => {
    if (token.is_used) {
      return <span className="token-status-badge status-used">Used</span>;
    }
    if (!token.is_active) {
      return <span className="token-status-badge status-inactive">Inactive</span>;
    }
    if (new Date(token.expiry_date) < new Date()) {
      return <span className="token-status-badge status-expired">Expired</span>;
    }
    return <span className="token-status-badge status-available">Available</span>;
  };

  const TokenList = ({ tokens, duration, color }) => (
    <div className={`token-section token-section-${duration}`}>
      <div className="token-section-header">
        <h3 className="token-section-title">{duration} Month{duration > 1 ? 's' : ''}</h3>
        <button
          className={`token-generate-btn token-btn-${color}`}
          onClick={() => handleGenerate(duration)}
          disabled={loading !== null}
        >
          {loading === duration ? '⏳' : '+ Generate'}
        </button>
      </div>
      
      <div className="token-list-container">
        {loadingTokens ? (
          <div className="token-list-loading">Loading tokens...</div>
        ) : tokens.length === 0 ? (
          <div className="token-list-empty">No tokens generated yet</div>
        ) : (
          <div className="token-list">
            {tokens.map((token) => (
              <div key={token.id} className="token-item">
                <div className="token-item-header">
                  {getStatusBadge(token)}
                  <div className="token-item-actions">
                    <button
                      className="token-copy-icon"
                      onClick={() => copyToClipboard(token.token_value)}
                      title="Copy token"
                    >
                      📋
                    </button>
                    <button
                      className="token-delete-icon"
                      onClick={() => openDeleteModal(token)}
                      disabled={deletingToken === token.id}
                      title="Delete token"
                    >
                      {deletingToken === token.id ? '⏳' : '🗑️'}
                    </button>
                  </div>
                </div>
                {token.is_used && token.used_by && (
                  <div className="token-user-info">
                    👤 Used by: <strong>{token.used_by}</strong>
                  </div>
                )}
                <div className="token-item-value">{token.token_value}</div>
                <div className="token-item-footer">
                  <span className="token-item-date">
                    Created: {new Date(token.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="token-generator">
        <h2 className="token-generator-title">Token Generator</h2>

        {error && (
          <div className="token-error">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}

        <div className="token-sections-grid">
          <TokenList tokens={tokens3} duration={3} color="blue" />
          <TokenList tokens={tokens6} duration={6} color="purple" />
          <TokenList tokens={tokens12} duration={12} color="pink" />
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setTokenToDelete(null);
        }}
        onConfirm={handleDeleteToken}
        title="Delete Token"
        message={tokenToDelete ? getDeleteMessage(tokenToDelete) : ''}
        type="confirm"
      />

      {/* Success Modal */}
      <Modal
        isOpen={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        title="Success"
        message={successMessage}
        type="alert"
      />
    </>
  );
}

export default TokenGenerator;
