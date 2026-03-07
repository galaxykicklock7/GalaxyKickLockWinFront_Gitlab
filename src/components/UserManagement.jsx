import { useState, useEffect } from 'react';
import {
  getAllUsers, renewUserToken, deleteUser, deleteToken,
  getRailwayAccounts, getAccountById, getServiceByTokenId,
  deleteRailwayService, deleteUserDeployment, provisionRailwayService,
  saveServiceMapping, getRailwayServiceStatus
} from '../utils/adminApi';
import { supabase } from '../utils/supabase';
import './UserManagement.css';

function UserManagement({ refreshTrigger, onTokenRenewed, onShowModal, onShowConfirm, adminSession }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [railwayAccounts, setRailwayAccounts] = useState([]);
  const [accountMap, setAccountMap] = useState({}); // id -> account
  const [serviceInfoMap, setServiceInfoMap] = useState({});
  const [liveStatusMap, setLiveStatusMap] = useState({}); // userId -> "online"|"stopped"|"crashed"|"deploying"

  // Account selector for renew
  const [showRenewAccountSelector, setShowRenewAccountSelector] = useState(false);
  const [pendingRenew, setPendingRenew] = useState(null); // { userId, months, username }

  useEffect(() => {
    fetchUsers();
    if (adminSession?.admin_id) {
      loadRailwayAccounts();
    }
  }, [refreshTrigger]);

  const loadRailwayAccounts = async () => {
    const result = await getRailwayAccounts(adminSession.admin_id);
    if (result.success) {
      setRailwayAccounts(result.accounts);
      const map = {};
      result.accounts.forEach(acc => { map[acc.id] = acc; });
      setAccountMap(map);
    }
  };

  const fetchUsers = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');

    try {
      const result = await getAllUsers();

      if (result.success) {
        setUsers(result.users);
        loadServiceInfoForUsers(result.users);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to fetch users');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const loadServiceInfoForUsers = async (userList) => {
    const infoMap = {};
    const expiredWithServices = [];

    await Promise.all(
      userList.filter(u => u.token_id).map(async (user) => {
        const result = await getServiceByTokenId(user.token_id);
        if (result.success && result.data) {
          infoMap[user.id] = result.data;

          if (user.token_expiry_date && new Date(user.token_expiry_date) < new Date() && result.data.railway_service_id) {
            expiredWithServices.push({
              userId: user.id,
              username: user.username,
              tokenId: user.token_id,
              serviceId: result.data.railway_service_id,
              railwayAccountId: result.data.railway_account_id,
            });
          }
        }
      })
    );

    setServiceInfoMap(infoMap);

    // Load live statuses
    loadLiveStatuses(userList, infoMap);

    // Auto-cleanup expired
    if (expiredWithServices.length > 0) {
      cleanupExpiredServices(expiredWithServices, infoMap);
    }
  };

  const loadLiveStatuses = async (userList, infoMap) => {
    const statusMap = {};

    await Promise.all(
      userList.filter(u => infoMap[u.id]?.railway_service_id && infoMap[u.id]?.railway_account_id).map(async (user) => {
        const info = infoMap[user.id];
        const acc = accountMap[info.railway_account_id];
        if (!acc) {
          // Account might not be loaded yet, try fetching
          const accResult = await getAccountById(info.railway_account_id);
          if (accResult.success && accResult.data) {
            const statusResult = await getRailwayServiceStatus(
              accResult.data.railway_api_token,
              accResult.data.railway_project_id,
              info.railway_service_id
            );
            if (statusResult.success) {
              statusMap[user.id] = statusResult.status;
            }
          }
        } else {
          const statusResult = await getRailwayServiceStatus(
            acc.railway_api_token,
            acc.railway_project_id,
            info.railway_service_id
          );
          if (statusResult.success) {
            statusMap[user.id] = statusResult.status;
          }
        }
      })
    );

    setLiveStatusMap(statusMap);
  };

  const cleanupExpiredServices = async (expiredUsers, currentInfoMap) => {
    const updatedInfoMap = { ...currentInfoMap };

    for (const item of expiredUsers) {
      try {
        // Get account credentials
        let apiToken, projectId;
        if (item.railwayAccountId) {
          const acc = accountMap[item.railwayAccountId];
          if (acc) {
            apiToken = acc.railway_api_token;
            projectId = acc.railway_project_id;
          } else {
            const accResult = await getAccountById(item.railwayAccountId);
            if (accResult.success && accResult.data) {
              apiToken = accResult.data.railway_api_token;
              projectId = accResult.data.railway_project_id;
            }
          }
        }

        if (apiToken && projectId) {
          await deleteRailwayService(apiToken, projectId, item.serviceId);
        }

        const cleanUsername = item.username.toLowerCase().replace(/[^a-z0-9]/g, '');
        await deleteUserDeployment(cleanUsername).catch(() => {});
        await deleteUserDeployment(`token_${item.tokenId}`).catch(() => {});

        delete updatedInfoMap[item.userId];
        console.log(`Auto-cleaned expired service for user: ${item.username}`);
      } catch (err) {
        console.warn(`Failed to cleanup service for ${item.username}:`, err);
      }
    }

    setServiceInfoMap(updatedInfoMap);
  };

  const handleRenewToken = async (userId, months, username) => {
    if (railwayAccounts.length > 1) {
      // Show account selector
      setPendingRenew({ userId, months, username });
      setShowRenewAccountSelector(true);
      return;
    }

    const account = railwayAccounts.length === 1 ? railwayAccounts[0] : null;
    performRenewToken(userId, months, username, account);
  };

  const handleSelectAccountForRenew = (account) => {
    setShowRenewAccountSelector(false);
    if (pendingRenew) {
      performRenewToken(pendingRenew.userId, pendingRenew.months, pendingRenew.username, account);
      setPendingRenew(null);
    }
  };

  const performRenewToken = async (userId, months, username, selectedAccount) => {
    setActionLoading(prev => ({ ...prev, [`renew-${userId}`]: true }));

    try {
      // Step 1: Delete old Railway service if exists
      const oldService = serviceInfoMap[userId];
      if (oldService?.railway_service_id) {
        let apiToken, projectId;
        if (oldService.railway_account_id) {
          const acc = accountMap[oldService.railway_account_id];
          if (acc) {
            apiToken = acc.railway_api_token;
            projectId = acc.railway_project_id;
          } else {
            const accResult = await getAccountById(oldService.railway_account_id);
            if (accResult.success && accResult.data) {
              apiToken = accResult.data.railway_api_token;
              projectId = accResult.data.railway_project_id;
            }
          }
        }

        if (apiToken && projectId) {
          await deleteRailwayService(apiToken, projectId, oldService.railway_service_id)
            .catch(err => console.warn('Failed to delete old service:', err));
        }

        const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');
        await deleteUserDeployment(cleanUsername).catch(() => {});
      }

      // Step 2: Renew the token
      const result = await renewUserToken(userId, months);

      if (!result.success) {
        alert(`Error: ${result.error}`);
        return;
      }

      // Step 3: Get new token_id
      const { data: userData } = await supabase
        .from('users')
        .select('token_id')
        .eq('id', userId)
        .single();

      const newTokenId = userData?.token_id;
      let serviceMessage = '';

      // Step 4: Provision new Railway service on selected account
      if (newTokenId && selectedAccount) {
        const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');

        await deleteUserDeployment(cleanUsername).catch(() => {});
        await deleteUserDeployment(`token_${newTokenId}`).catch(() => {});

        const serviceName = `gkl-${result.token_value.substring(0, 8).toLowerCase()}`;
        const provisionResult = await provisionRailwayService(
          selectedAccount.railway_api_token,
          selectedAccount.railway_project_id,
          serviceName
        );

        if (provisionResult.success) {
          await supabase
            .from('user_deployments')
            .insert({
              user_id: cleanUsername,
              railway_service_id: provisionResult.service_id,
              backend_url: provisionResult.backend_url,
              token_id: newTokenId,
              railway_account_id: selectedAccount.id,
              status: 'stopped',
              updated_at: new Date().toISOString()
            });

          serviceMessage = `\nNew Service on ${selectedAccount.label}: ${provisionResult.service_name}\nURL: ${provisionResult.backend_url}`;
        } else {
          serviceMessage = `\nWarning: Railway provisioning failed: ${provisionResult.error}`;
        }
      }

      if (onShowModal) {
        onShowModal({
          title: 'Token Renewed Successfully',
          message: `Token renewed for ${months} months!\n\nNew Token:\n${result.token_value}${serviceMessage}`,
          type: 'alert',
          onClose: async () => {
            await fetchUsers(false);
            if (onTokenRenewed) {
              onTokenRenewed();
            }
          }
        });
      }
    } catch (err) {
      alert('Failed to renew token');
    } finally {
      setActionLoading(prev => ({ ...prev, [`renew-${userId}`]: false }));
    }
  };

  const handleDeleteUser = async (userId, username, tokenId) => {
    if (onShowConfirm) {
      onShowConfirm({
        title: 'DELETE USER',
        message: `Are you sure you want to delete user "${username}"?\n\nThis will:\n- Force logout on all devices\n- Delete the user's token\n- Delete Railway service\n- Prevent username reuse\n\nThis action cannot be undone.`,
        confirmText: 'DELETE USER',
        type: 'danger',
        onConfirm: () => performDeleteUser(userId, username, tokenId)
      });
    }
  };

  const performDeleteUser = async (userId, username, tokenId) => {
    setActionLoading(prev => ({ ...prev, [`delete-user-${userId}`]: true }));

    try {
      // Step 1: Find and delete Railway service
      let serviceDeleted = false;
      let serviceInfo = serviceInfoMap[userId];

      if (!serviceInfo?.railway_service_id && tokenId) {
        const result = await getServiceByTokenId(tokenId);
        if (result.success && result.data) {
          serviceInfo = result.data;
        }
      }

      if (serviceInfo?.railway_service_id) {
        let apiToken, projectId;
        if (serviceInfo.railway_account_id) {
          const acc = accountMap[serviceInfo.railway_account_id];
          if (acc) {
            apiToken = acc.railway_api_token;
            projectId = acc.railway_project_id;
          } else {
            const accResult = await getAccountById(serviceInfo.railway_account_id);
            if (accResult.success && accResult.data) {
              apiToken = accResult.data.railway_api_token;
              projectId = accResult.data.railway_project_id;
            }
          }
        }

        if (apiToken && projectId) {
          const delResult = await deleteRailwayService(apiToken, projectId, serviceInfo.railway_service_id);
          serviceDeleted = delResult.success;
          if (!delResult.success) {
            console.warn('Failed to delete Railway service:', delResult.error);
          }
        }

        const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');
        await deleteUserDeployment(cleanUsername);
        if (tokenId) {
          await deleteUserDeployment(`token_${tokenId}`);
        }
      }

      // Step 2: Delete the user
      const result = await deleteUser(userId);

      if (result.success) {
        if (result.token_deleted && onTokenRenewed) {
          onTokenRenewed();
        }

        await fetchUsers(false);

        let message = `User "${username}" has been deleted successfully!\n\nSessions invalidated: ${result.sessions_invalidated || 0}`;
        if (result.token_deleted) message += '\nUser token also deleted.';
        if (serviceDeleted) message += '\nRailway service also deleted.';

        if (onShowModal) {
          onShowModal({ title: 'User Deleted', message, type: 'alert' });
        }
      } else {
        if (onShowModal) {
          onShowModal({ title: 'Error', message: `Failed to delete user: ${result.error}`, type: 'alert' });
        }
      }
    } catch (err) {
      if (onShowModal) {
        onShowModal({ title: 'Error', message: 'Failed to delete user', type: 'alert' });
      }
    } finally {
      setActionLoading(prev => ({ ...prev, [`delete-user-${userId}`]: false }));
    }
  };

  const handleDeleteToken = async (tokenId, username) => {
    if (onShowConfirm) {
      onShowConfirm({
        title: 'DELETE TOKEN',
        message: `Delete token for user "${username}"?\n\nThis will:\n- Force logout on all devices\n- Cancel any running workflows\n- User cannot login until renewed\n\nAre you sure?`,
        confirmText: 'DELETE TOKEN',
        type: 'warning',
        onConfirm: () => performDeleteToken(tokenId, username)
      });
    }
  };

  const performDeleteToken = async (tokenId, username) => {
    setActionLoading(prev => ({ ...prev, [`delete-token-${tokenId}`]: true }));

    try {
      // Step 1: Delete Railway service if exists
      let serviceDeleted = false;
      const serviceResult = await getServiceByTokenId(tokenId);
      if (serviceResult.success && serviceResult.data?.railway_service_id) {
        let apiToken, projectId;
        if (serviceResult.data.railway_account_id) {
          const acc = accountMap[serviceResult.data.railway_account_id];
          if (acc) {
            apiToken = acc.railway_api_token;
            projectId = acc.railway_project_id;
          } else {
            const accResult = await getAccountById(serviceResult.data.railway_account_id);
            if (accResult.success && accResult.data) {
              apiToken = accResult.data.railway_api_token;
              projectId = accResult.data.railway_project_id;
            }
          }
        }

        if (apiToken && projectId) {
          const delResult = await deleteRailwayService(apiToken, projectId, serviceResult.data.railway_service_id);
          serviceDeleted = delResult.success;
          if (!delResult.success) {
            console.warn('Failed to delete Railway service:', delResult.error);
          }
        }

        const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');
        await deleteUserDeployment(cleanUsername);
        await deleteUserDeployment(`token_${tokenId}`);
      }

      // Step 2: Delete the token
      const result = await deleteToken(tokenId);

      if (result.success) {
        if (onTokenRenewed) onTokenRenewed();
        await fetchUsers(false);

        let message = `Token deleted for "${username}"!\n\nSessions invalidated: ${result.sessions_invalidated || 0}\n\nUser can no longer login.`;
        if (serviceDeleted) message += '\nRailway service also deleted.';

        if (onShowModal) {
          onShowModal({ title: 'Token Deleted', message, type: 'alert' });
        }
      } else {
        if (onShowModal) {
          onShowModal({ title: 'Error', message: `Failed to delete token: ${result.error}`, type: 'alert' });
        }
      }
    } catch (err) {
      if (onShowModal) {
        onShowModal({ title: 'Error', message: 'Failed to delete token', type: 'alert' });
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

  const getAccountLabel = (userId) => {
    const info = serviceInfoMap[userId];
    if (!info?.railway_account_id) return null;
    const acc = accountMap[info.railway_account_id];
    return acc?.label || null;
  };

  const getLiveStatusBadge = (userId) => {
    const status = liveStatusMap[userId];
    if (!status) return null;

    const config = {
      online: { className: 'live-status-online', text: 'Online' },
      stopped: { className: 'live-status-stopped', text: 'Stopped' },
      crashed: { className: 'live-status-crashed', text: 'Crashed' },
      deploying: { className: 'live-status-deploying', text: 'Deploying' },
    };

    const c = config[status] || config.stopped;
    return <span className={`live-status-badge ${c.className}`}>{c.text}</span>;
  };

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
          <span className="error-icon">!</span>
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
                <th>Account</th>
                <th>Service</th>
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
                  <td className="user-account">
                    {getAccountLabel(user.id) ? (
                      <span className="account-label-badge">{getAccountLabel(user.id)}</span>
                    ) : (
                      <span className="no-account">-</span>
                    )}
                  </td>
                  <td className="user-service">
                    {serviceInfoMap[user.id] ? (
                      <div className="service-info-cell">
                        {getLiveStatusBadge(user.id) || (
                          <span className={`service-status-dot ${serviceInfoMap[user.id].status === 'active' ? 'dot-active' : 'dot-stopped'}`} />
                        )}
                        <span className="service-url-text" title={serviceInfoMap[user.id].backend_url}>
                          {serviceInfoMap[user.id].backend_url?.replace('https://', '').split('.')[0] || 'N/A'}
                        </span>
                      </div>
                    ) : (
                      <span className="no-service">No service</span>
                    )}
                  </td>
                  <td className="user-actions">
                    <div className="action-buttons">
                      <select
                        className="renew-dropdown"
                        onChange={(e) => {
                          if (e.target.value) {
                            handleRenewToken(user.id, parseInt(e.target.value), user.username);
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
                        onClick={() => handleDeleteUser(user.id, user.username, user.token_id)}
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

      {/* Account Selector for Renew */}
      {showRenewAccountSelector && (
        <div className="account-selector-overlay" onClick={() => { setShowRenewAccountSelector(false); setPendingRenew(null); }}>
          <div className="account-selector-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="account-selector-title">Select Railway Account for Renewal</h3>
            <p className="account-selector-subtitle">Choose which account to provision the new service on</p>
            <div className="account-selector-cards">
              {railwayAccounts.map((acc) => (
                <button
                  key={acc.id}
                  className="account-selector-card"
                  onClick={() => handleSelectAccountForRenew(acc)}
                >
                  <span className="account-card-label">{acc.label}</span>
                  <span className="account-card-project">{acc.railway_project_id.substring(0, 8)}...</span>
                </button>
              ))}
            </div>
            <button className="account-selector-cancel" onClick={() => { setShowRenewAccountSelector(false); setPendingRenew(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
