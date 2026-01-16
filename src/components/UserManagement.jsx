import { useState, useEffect } from 'react';
import { getAllUsers, renewUserToken, deleteUser, deleteToken } from '../utils/adminApi';
import './UserManagement.css';

function UserManagement({ refreshTrigger, onTokenRenewed, onShowModal, onShowConfirm }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState({});

  useEffect(() => {
    fetchUsers();
  }, [refreshTrigger]);

  const fetchUsers = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');

    try {
      const result = await getAllUsers();

      if (result.success) {
        setUsers(result.users);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to fetch users');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleRenewToken = async (userId, months) => {
    setActionLoading(prev => ({ ...prev, [`renew-${userId}`]: true }));

    try {
      const result = await renewUserToken(userId, months);

      if (result.success) {
        if (onShowModal) {
          onShowModal({
            title: 'Token Renewed Successfully',
            message: `Token renewed successfully for ${months} months!\n\nNew Token:\n${result.token_value}\n\nThis token has been added to the ${months}-month token list.`,
            type: 'alert',
            onClose: async () => {
              await fetchUsers(false);
              // Notify parent to refresh token generator
              if (onTokenRenewed) {
                onTokenRenewed();
              }
            }
          });
        }
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (err) {
      alert('Failed to renew token');
    } finally {
      setActionLoading(prev => ({ ...prev, [`renew-${userId}`]: false }));
    }
  };

  const handleDeleteUser = async (userId, username) => {
    // Use parent's confirm modal
    if (onShowConfirm) {
      onShowConfirm({
        title: '⚠️ DELETE USER',
        message: `Are you sure you want to delete user "${username}"?\n\nThis will:\n• Force logout on all devices\n• Cancel any running workflows\n• Prevent username reuse\n\nThis action cannot be undone.`,
        confirmText: 'DELETE USER',
        type: 'danger',
        onConfirm: () => performDeleteUser(userId, username)
      });
    }
  };

  const performDeleteUser = async (userId, username) => {
    setActionLoading(prev => ({ ...prev, [`delete-user-${userId}`]: true }));

    try {
      const result = await deleteUser(userId);

      if (result.success) {
        // Refresh token generator IMMEDIATELY if token was deleted (before showing modal)
        if (result.token_deleted && onTokenRenewed) {
          onTokenRenewed();
        }
        
        // Refresh user list immediately
        await fetchUsers(false);

        // Build success message
        let message = `User "${username}" has been deleted successfully!\n\nSessions invalidated: ${result.sessions_invalidated || 0}`;
        
        // Add token deletion info if token was deleted
        if (result.token_deleted) {
          message += '\n✅ User token also deleted';
        }

        if (onShowModal) {
          onShowModal({
            title: 'User Deleted',
            message: message,
            type: 'alert'
          });
        }
      } else {
        if (onShowModal) {
          onShowModal({
            title: 'Error',
            message: `Failed to delete user: ${result.error}`,
            type: 'alert'
          });
        }
      }
    } catch (err) {
      if (onShowModal) {
        onShowModal({
          title: 'Error',
          message: 'Failed to delete user',
          type: 'alert'
        });
      }
    } finally {
      setActionLoading(prev => ({ ...prev, [`delete-user-${userId}`]: false }));
    }
  };

  const handleDeleteToken = async (tokenId, username) => {
    // Use parent's confirm modal
    if (onShowConfirm) {
      onShowConfirm({
        title: '⚠️ DELETE TOKEN',
        message: `Delete token for user "${username}"?\n\nThis will:\n• Force logout on all devices\n• Cancel any running workflows\n• User cannot login until renewed\n\nAre you sure?`,
        confirmText: 'DELETE TOKEN',
        type: 'warning',
        onConfirm: () => performDeleteToken(tokenId, username)
      });
    }
  };

  const performDeleteToken = async (tokenId, username) => {
    setActionLoading(prev => ({ ...prev, [`delete-token-${tokenId}`]: true }));

    try {
      const result = await deleteToken(tokenId);

      if (result.success) {
        // Refresh token generator IMMEDIATELY (before showing modal)
        if (onTokenRenewed) {
          onTokenRenewed();
        }
        
        // Refresh user list immediately
        await fetchUsers(false);

        if (onShowModal) {
          onShowModal({
            title: 'Token Deleted',
            message: `Token deleted for "${username}"!\n\nSessions invalidated: ${result.sessions_invalidated || 0}\n\nUser can no longer login.`,
            type: 'alert'
          });
        }
      } else {
        if (onShowModal) {
          onShowModal({
            title: 'Error',
            message: `Failed to delete token: ${result.error}`,
            type: 'alert'
          });
        }
      }
    } catch (err) {
      if (onShowModal) {
        onShowModal({
          title: 'Error',
          message: 'Failed to delete token',
          type: 'alert'
        });
      }
    } finally {
      setActionLoading(prev => ({ ...prev, [`delete-token-${tokenId}`]: false }));
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const isExpired = (dateString) => {
    if (!dateString) return false;
    return new Date(dateString) < new Date();
  };

  // Filter out deleted users (usernames starting with DELETED_)
  const activeUsers = users.filter(user => !user.username.startsWith('DELETED_'));

  if (loading) {
    return (
      <div className="user-management">
        <h2 className="user-management-title">User Management</h2>
        <div className="loading-state">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="user-management">
      <h2 className="user-management-title">User Management</h2>
      <p className="user-management-subtitle">
        Total Users: {activeUsers.length}
      </p>

      {error && (
        <div className="user-error">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      {activeUsers.length === 0 ? (
        <div className="empty-state">
          <p>No users registered yet.</p>
        </div>
      ) : (
        <div className="user-table-container">
          <table className="user-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Subscription</th>
                <th>Expiry Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeUsers.map((user) => (
                <tr key={user.id}>
                  <td className="user-username">{user.username}</td>
                  <td>{user.subscription_months ? `${user.subscription_months} months` : 'N/A'}</td>
                  <td className={isExpired(user.token_expiry_date) ? 'expired-date' : ''}>
                    {formatDate(user.token_expiry_date)}
                  </td>
                  <td>
                    <span className={`status-badge ${isExpired(user.token_expiry_date) ? 'status-expired' : 'status-active'}`}>
                      {isExpired(user.token_expiry_date) ? 'Expired' : 'Active'}
                    </span>
                  </td>
                  <td className="user-actions">
                    <div className="action-buttons">
                      <select
                        className="renew-dropdown"
                        onChange={(e) => {
                          if (e.target.value) {
                            handleRenewToken(user.id, parseInt(e.target.value));
                            e.target.value = '';
                          }
                        }}
                        disabled={actionLoading[`renew-${user.id}`] || (user.token_id && !isExpired(user.token_expiry_date))}
                      >
                        <option value="">
                          {!user.token_id || isExpired(user.token_expiry_date) ? 'Renew Token' : 'Token Active'}
                        </option>
                        <option value="3">3 Months</option>
                        <option value="6">6 Months</option>
                        <option value="12">1 Year</option>
                      </select>

                      {user.token_id && (
                        <button
                          className="action-btn delete-token-btn"
                          onClick={() => handleDeleteToken(user.token_id, user.username)}
                          disabled={actionLoading[`delete-token-${user.token_id}`]}
                        >
                          {actionLoading[`delete-token-${user.token_id}`] ? '...' : 'Delete Token'}
                        </button>
                      )}

                      <button
                        className="action-btn delete-user-btn"
                        onClick={() => handleDeleteUser(user.id, user.username)}
                        disabled={actionLoading[`delete-user-${user.id}`]}
                      >
                        {actionLoading[`delete-user-${user.id}`] ? '...' : 'Delete User'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
