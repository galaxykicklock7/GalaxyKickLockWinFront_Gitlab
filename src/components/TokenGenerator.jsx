import { useState, useEffect } from 'react';
import {
  generateToken, getTokensByDuration, deleteToken,
  getRailwayAccounts, addRailwayAccount, updateRailwayAccount, deleteRailwayAccount,
  getServiceCountsByAccount, provisionRailwayService, saveServiceMapping,
  getServiceByTokenId, deleteRailwayService, deleteUserDeployment, getAccountById,
  getDeploymentsByAccountId, updateUserDeployment
} from '../utils/adminApi';
import Modal from './Modal';
import './TokenGenerator.css';

function TokenGenerator({ onTokenGenerated, onTokenDeleted, refreshTrigger, adminSession }) {
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

  // Railway accounts
  const [railwayAccounts, setRailwayAccounts] = useState([]);
  const [serviceCounts, setServiceCounts] = useState({});
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null); // null = add mode, object = edit mode
  const [accountForm, setAccountForm] = useState({ label: '', token: '', projectId: '' });
  const [savingAccount, setSavingAccount] = useState(false);

  // Account selector for generate
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [pendingGenerateMonths, setPendingGenerateMonths] = useState(null);

  // Migration state
  const [migratingAccount, setMigratingAccount] = useState(null); // account id being migrated
  const [migrationProgress, setMigrationProgress] = useState({ current: 0, total: 0, log: [] });
  const [showMigrationModal, setShowMigrationModal] = useState(false);

  // Service info cache per token
  const [serviceInfoMap, setServiceInfoMap] = useState({});

  useEffect(() => {
    fetchAllTokens();
    if (adminSession?.admin_id) {
      loadRailwayAccounts();
    }
  }, []);

  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchAllTokens();
    }
  }, [refreshTrigger]);

  const loadRailwayAccounts = async () => {
    const [accountsResult, countsResult] = await Promise.all([
      getRailwayAccounts(adminSession.admin_id),
      getServiceCountsByAccount()
    ]);
    if (accountsResult.success) {
      setRailwayAccounts(accountsResult.accounts);
    }
    if (countsResult.success) {
      setServiceCounts(countsResult.counts);
    }
  };

  const handleSaveAccount = async () => {
    if (!accountForm.label.trim() || !accountForm.token.trim() || !accountForm.projectId.trim()) {
      setError('Label, Railway API Token, and Project ID are all required');
      return;
    }

    setSavingAccount(true);
    setError('');

    try {
      if (editingAccount) {
        // Detect if credentials actually changed
        const credentialsChanged =
          accountForm.token.trim() !== editingAccount.railway_api_token ||
          accountForm.projectId.trim() !== editingAccount.railway_project_id;

        // Save the OLD credentials before updating
        const oldToken = editingAccount.railway_api_token;
        const oldProjectId = editingAccount.railway_project_id;

        // Update the account in DB first
        const result = await updateRailwayAccount(editingAccount.id, {
          label: accountForm.label.trim(),
          railway_api_token: accountForm.token.trim(),
          railway_project_id: accountForm.projectId.trim(),
        });

        if (!result.success) {
          setError(result.error);
          return;
        }

        await loadRailwayAccounts();

        if (credentialsChanged) {
          // Check if there are services on this account that need migration
          const deploymentsResult = await getDeploymentsByAccountId(editingAccount.id);
          if (deploymentsResult.success && deploymentsResult.deployments.length > 0) {
            // Trigger migration
            setAccountForm({ label: '', token: '', projectId: '' });
            setEditingAccount(null);
            setShowAccountPanel(false);
            setSavingAccount(false);
            await handleMigrateAccount(
              editingAccount.id,
              oldToken,
              oldProjectId,
              accountForm.token.trim(),
              accountForm.projectId.trim(),
              deploymentsResult.deployments
            );
            return;
          }
        }

        setAccountForm({ label: '', token: '', projectId: '' });
        setEditingAccount(null);
        setShowAccountPanel(false);
        setSuccessMessage('Railway account updated!');
        setShowSuccessModal(true);
      } else {
        const result = await addRailwayAccount(
          adminSession.admin_id,
          accountForm.label.trim(),
          accountForm.token.trim(),
          accountForm.projectId.trim()
        );

        if (result.success) {
          await loadRailwayAccounts();
          setAccountForm({ label: '', token: '', projectId: '' });
          setEditingAccount(null);
          setShowAccountPanel(false);
          setSuccessMessage('Railway account added!');
          setShowSuccessModal(true);
        } else {
          setError(result.error);
        }
      }
    } catch (err) {
      setError('Failed to save Railway account');
    } finally {
      setSavingAccount(false);
    }
  };

  const handleMigrateAccount = async (accountId, oldToken, oldProjectId, newToken, newProjectId, deployments) => {
    setMigratingAccount(accountId);
    setMigrationProgress({ current: 0, total: deployments.length, log: [] });
    setShowMigrationModal(true);

    const addLog = (msg) => {
      setMigrationProgress(prev => ({
        ...prev,
        log: [...prev.log, msg]
      }));
    };

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < deployments.length; i++) {
      const dep = deployments[i];
      const label = dep.user_id || dep.token_id || 'unknown';

      setMigrationProgress(prev => ({ ...prev, current: i + 1 }));
      addLog(`[${i + 1}/${deployments.length}] Migrating service for "${label}"...`);

      try {
        // Step 1: Delete old service on OLD credentials (best effort)
        if (dep.railway_service_id && oldToken && oldProjectId) {
          const delResult = await deleteRailwayService(oldToken, oldProjectId, dep.railway_service_id);
          if (delResult.success) {
            addLog(`  Deleted old service ${dep.railway_service_id.substring(0, 8)}...`);
          } else {
            addLog(`  Warning: Could not delete old service: ${delResult.error}`);
          }
        }

        // Step 2: Provision new service on NEW credentials
        const serviceName = `gkl-${(dep.user_id || dep.token_id || 'svc').substring(0, 8).toLowerCase()}`;
        const provisionResult = await provisionRailwayService(newToken, newProjectId, serviceName);

        if (!provisionResult.success) {
          addLog(`  FAILED to provision new service: ${provisionResult.error}`);
          failCount++;
          continue;
        }

        addLog(`  New service: ${provisionResult.service_name} → ${provisionResult.backend_url}`);

        // Step 3: Update user_deployments row in-place
        const updateResult = await updateUserDeployment(dep.user_id, {
          railway_service_id: provisionResult.service_id,
          backend_url: provisionResult.backend_url,
          status: 'stopped',
        });

        if (updateResult.success) {
          addLog(`  DB updated for "${label}"`);
          successCount++;
        } else {
          addLog(`  Warning: DB update failed: ${updateResult.error}`);
          failCount++;
        }
      } catch (err) {
        addLog(`  ERROR: ${err.message}`);
        failCount++;
      }
    }

    addLog(`\nMigration complete: ${successCount} succeeded, ${failCount} failed`);
    setMigratingAccount(null);

    // Refresh everything
    await loadRailwayAccounts();
    await fetchAllTokens();
  };

  const handleEditAccount = (account) => {
    setEditingAccount(account);
    setAccountForm({
      label: account.label,
      token: account.railway_api_token,
      projectId: account.railway_project_id,
    });
    setShowAccountPanel(true);
  };

  const handleDeleteAccount = async (accountId) => {
    const result = await deleteRailwayAccount(accountId);
    if (result.success) {
      await loadRailwayAccounts();
      setSuccessMessage('Railway account deleted!');
      setShowSuccessModal(true);
    } else {
      setError(result.error || 'Failed to delete account');
    }
  };

  const handleCancelAccountForm = () => {
    setShowAccountPanel(false);
    setEditingAccount(null);
    setAccountForm({ label: '', token: '', projectId: '' });
  };

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

      const allTokens = [
        ...(result3.tokens || []),
        ...(result6.tokens || []),
        ...(result12.tokens || [])
      ];
      loadServiceInfoForTokens(allTokens);
    } catch (err) {
      console.error('Failed to fetch tokens:', err);
    } finally {
      setLoadingTokens(false);
    }
  };

  const loadServiceInfoForTokens = async (tokens) => {
    const infoMap = {};
    await Promise.all(
      tokens.map(async (token) => {
        const result = await getServiceByTokenId(token.id);
        if (result.success && result.data) {
          infoMap[token.id] = result.data;
        }
      })
    );
    setServiceInfoMap(infoMap);
  };

  const handleGenerate = async (months) => {
    if (railwayAccounts.length === 0) {
      setError('Please add a Railway account first before generating tokens');
      setShowAccountPanel(true);
      return;
    }

    if (railwayAccounts.length === 1) {
      // Auto-select the only account
      performGenerate(months, railwayAccounts[0]);
    } else {
      // Show account selector
      setPendingGenerateMonths(months);
      setShowAccountSelector(true);
    }
  };

  const handleSelectAccountForGenerate = (account) => {
    setShowAccountSelector(false);
    if (pendingGenerateMonths) {
      performGenerate(pendingGenerateMonths, account);
      setPendingGenerateMonths(null);
    }
  };

  const performGenerate = async (months, account) => {
    setError('');
    setLoading(months);

    try {
      // Step 1: Generate the token
      const result = await generateToken(months);

      if (!result.success) {
        setError(result.error);
        return;
      }

      const tokenId = result.data.token_id;
      const tokenValue = result.data.token_value;

      // Step 2: Provision Railway service on selected account
      const serviceName = `gkl-${tokenValue.substring(0, 8).toLowerCase()}`;
      const provisionResult = await provisionRailwayService(
        account.railway_api_token,
        account.railway_project_id,
        serviceName
      );

      if (!provisionResult.success) {
        setError(`Token created but Railway provisioning failed: ${provisionResult.error}`);
        await fetchAllTokens();
        return;
      }

      // Step 3: Save service mapping with account ID
      const mappingResult = await saveServiceMapping(
        tokenId,
        provisionResult.service_id,
        provisionResult.backend_url,
        account.id
      );

      if (!mappingResult.success) {
        setError(`Token & service created but mapping failed: ${mappingResult.error}`);
      }

      // Refresh
      await fetchAllTokens();
      await loadRailwayAccounts();

      setSuccessMessage(
        `Token generated on ${account.label}!\nService: ${provisionResult.service_name}\nURL: ${provisionResult.backend_url}`
      );
      setShowSuccessModal(true);

      if (onTokenGenerated) {
        onTokenGenerated(result.data);
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
      // Step 1: Delete Railway service if one exists for this token
      const serviceInfo = serviceInfoMap[tokenToDelete.id];
      if (serviceInfo?.railway_service_id) {
        // Lookup account credentials from railway_account_id
        let apiToken, projectId;
        if (serviceInfo.railway_account_id) {
          const accResult = await getAccountById(serviceInfo.railway_account_id);
          if (accResult.success && accResult.data) {
            apiToken = accResult.data.railway_api_token;
            projectId = accResult.data.railway_project_id;
          }
        }

        if (apiToken && projectId) {
          const deleteServiceResult = await deleteRailwayService(apiToken, projectId, serviceInfo.railway_service_id);
          if (!deleteServiceResult.success) {
            console.warn('Failed to delete Railway service:', deleteServiceResult.error);
          }
        }

        // Clean up user_deployments
        await deleteUserDeployment(`token_${tokenToDelete.id}`);
        if (tokenToDelete.used_by) {
          const cleanUsername = tokenToDelete.used_by.toLowerCase().replace(/[^a-z0-9]/g, '');
          await deleteUserDeployment(cleanUsername);
        }
      }

      // Step 2: Delete the token
      const result = await deleteToken(tokenToDelete.id);

      if (result.success) {
        await fetchAllTokens();
        await loadRailwayAccounts();
        setSuccessMessage(serviceInfo?.railway_service_id
          ? 'Token and Railway service deleted!'
          : 'Token deleted successfully!');
        setShowSuccessModal(true);
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
      return `WARNING: This token is currently being used by user "${token.used_by}".\n\nDeleting this token will:\n- Prevent "${token.used_by}" from logging in\n- Enable the renewal option for this user\n- Permanently remove this token\n\nToken: ${token.token_value}\n\nAre you sure you want to delete this token?`;
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

  const maskToken = (token) => {
    if (!token) return '';
    return token.substring(0, 6) + '...' + token.substring(token.length - 4);
  };

  // Build account ID -> label lookup
  const accountLabelMap = {};
  railwayAccounts.forEach(acc => { accountLabelMap[acc.id] = acc.label; });

  const TokenList = ({ tokens, duration, color }) => (
    <div className={`token-section token-section-${duration}`}>
      <div className="token-section-header">
        <h3 className="token-section-title">{duration} Month{duration > 1 ? 's' : ''}</h3>
        <button
          className={`token-generate-btn token-btn-${color}`}
          onClick={() => handleGenerate(duration)}
          disabled={loading !== null}
        >
          {loading === duration ? 'Provisioning...' : '+ Generate'}
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
                      Copy
                    </button>
                    <button
                      className="token-delete-icon"
                      onClick={() => openDeleteModal(token)}
                      disabled={deletingToken === token.id}
                      title="Delete token"
                    >
                      {deletingToken === token.id ? '...' : 'Del'}
                    </button>
                  </div>
                </div>
                {token.is_used && token.used_by && (
                  <div className="token-user-info">
                    Used by: <strong>{token.used_by}</strong>
                  </div>
                )}
                <div className="token-item-value">{token.token_value}</div>
                {serviceInfoMap[token.id] && (
                  <div className="token-service-info">
                    {serviceInfoMap[token.id].railway_account_id && accountLabelMap[serviceInfoMap[token.id].railway_account_id] && (
                      <span className="token-account-badge">
                        {accountLabelMap[serviceInfoMap[token.id].railway_account_id]}
                      </span>
                    )}
                    <span className="token-service-url">{serviceInfoMap[token.id].backend_url}</span>
                    <span className={`token-service-status status-${serviceInfoMap[token.id].status}`}>
                      {serviceInfoMap[token.id].status}
                    </span>
                  </div>
                )}
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
        <div className="token-generator-header">
          <h2 className="token-generator-title">Token Generator</h2>
          <button
            className="railway-settings-toggle"
            onClick={() => { setShowAccountPanel(!showAccountPanel); setEditingAccount(null); setAccountForm({ label: '', token: '', projectId: '' }); }}
          >
            {railwayAccounts.length > 0 ? `Railway Accounts (${railwayAccounts.length})` : 'Setup Railway'}
          </button>
        </div>

        {/* Railway Accounts Panel */}
        {showAccountPanel && (
          <div className="railway-accounts-panel">
            <div className="railway-accounts-header">
              <h3 className="railway-accounts-title">Railway Accounts</h3>
              {!editingAccount && (
                <button
                  className="railway-add-btn"
                  onClick={() => { setEditingAccount(null); setAccountForm({ label: '', token: '', projectId: '' }); }}
                >
                  + Add Account
                </button>
              )}
            </div>

            {/* Accounts list */}
            {railwayAccounts.length > 0 && (
              <div className="railway-accounts-list">
                {railwayAccounts.map((acc) => (
                  <div key={acc.id} className="railway-account-row">
                    <div className="railway-account-info">
                      <span className="railway-account-label">{acc.label}</span>
                      <span className="railway-account-project">{maskToken(acc.railway_project_id)}</span>
                      <span className="railway-account-count">
                        {serviceCounts[acc.id] || 0} services
                      </span>
                    </div>
                    <div className="railway-account-actions">
                      <button className="railway-edit-btn" onClick={() => handleEditAccount(acc)}>Edit</button>
                      <button className="railway-del-btn" onClick={() => handleDeleteAccount(acc.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add/Edit form */}
            <div className="railway-account-form">
              <h4 className="railway-form-title">{editingAccount ? `Edit: ${editingAccount.label}` : 'Add New Account'}</h4>
              <div className="railway-settings-row">
                <label className="railway-label">Label</label>
                <input
                  type="text"
                  className="railway-input"
                  value={accountForm.label}
                  onChange={(e) => setAccountForm(prev => ({ ...prev, label: e.target.value }))}
                  placeholder="e.g. Account 1"
                />
              </div>
              <div className="railway-settings-row">
                <label className="railway-label">Railway API Token</label>
                <input
                  type="password"
                  className="railway-input"
                  value={accountForm.token}
                  onChange={(e) => setAccountForm(prev => ({ ...prev, token: e.target.value }))}
                  placeholder="Enter Railway API token"
                />
              </div>
              <div className="railway-settings-row">
                <label className="railway-label">Railway Project ID</label>
                <input
                  type="text"
                  className="railway-input"
                  value={accountForm.projectId}
                  onChange={(e) => setAccountForm(prev => ({ ...prev, projectId: e.target.value }))}
                  placeholder="Enter Railway project UUID"
                />
              </div>
              <div className="railway-form-buttons">
                <button
                  className="railway-save-btn"
                  onClick={handleSaveAccount}
                  disabled={savingAccount}
                >
                  {savingAccount ? 'Saving...' : editingAccount ? 'Update Account' : 'Add Account'}
                </button>
                <button className="railway-cancel-btn" onClick={handleCancelAccountForm}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="token-error">
            <span className="error-icon">!</span>
            {error}
          </div>
        )}

        <div className="token-sections-grid">
          <TokenList tokens={tokens3} duration={3} color="blue" />
          <TokenList tokens={tokens6} duration={6} color="purple" />
          <TokenList tokens={tokens12} duration={12} color="pink" />
        </div>
      </div>

      {/* Account Selector Modal */}
      {showAccountSelector && (
        <div className="account-selector-overlay" onClick={() => { setShowAccountSelector(false); setPendingGenerateMonths(null); }}>
          <div className="account-selector-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="account-selector-title">Select Railway Account</h3>
            <p className="account-selector-subtitle">Choose which account to provision the service on</p>
            <div className="account-selector-cards">
              {railwayAccounts.map((acc) => (
                <button
                  key={acc.id}
                  className="account-selector-card"
                  onClick={() => handleSelectAccountForGenerate(acc)}
                >
                  <span className="account-card-label">{acc.label}</span>
                  <span className="account-card-project">{maskToken(acc.railway_project_id)}</span>
                  <span className="account-card-count">{serviceCounts[acc.id] || 0} services</span>
                </button>
              ))}
            </div>
            <button className="account-selector-cancel" onClick={() => { setShowAccountSelector(false); setPendingGenerateMonths(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Migration Progress Modal */}
      {showMigrationModal && (
        <div className="account-selector-overlay">
          <div className="migration-modal">
            <h3 className="migration-modal-title">
              {migratingAccount ? 'Migrating Services...' : 'Migration Complete'}
            </h3>
            <div className="migration-progress-bar">
              <div
                className="migration-progress-fill"
                style={{ width: `${migrationProgress.total ? (migrationProgress.current / migrationProgress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="migration-progress-text">
              {migrationProgress.current} / {migrationProgress.total} services
            </p>
            <div className="migration-log">
              {migrationProgress.log.map((line, i) => (
                <div key={i} className={`migration-log-line ${line.includes('FAILED') || line.includes('ERROR') ? 'log-error' : line.includes('complete') ? 'log-success' : ''}`}>
                  {line}
                </div>
              ))}
            </div>
            {!migratingAccount && (
              <button
                className="migration-close-btn"
                onClick={() => setShowMigrationModal(false)}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

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
