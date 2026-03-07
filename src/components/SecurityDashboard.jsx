/**
 * Security Dashboard Component
 * 
 * Enterprise security monitoring and audit interface for administrators
 */

import { useState, useEffect } from 'react';
import { securityAudit } from '../utils/securityAudit';
import { secureStorage } from '../utils/secureStorage';
import './SecurityDashboard.css';

export default function SecurityDashboard() {
  const [auditReport, setAuditReport] = useState(null);
  const [storageStats, setStorageStats] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [report, stats, log] = await Promise.all([
        securityAudit.runAudit(),
        secureStorage.getStats(),
        Promise.resolve(secureStorage.getAuditLog(50))
      ]);

      setAuditReport(report);
      setStorageStats(stats);
      setAuditLog(log);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRunAudit = async () => {
    setLoading(true);
    const report = await securityAudit.runAudit();
    setAuditReport(report);
    setLoading(false);
  };

  const handleExportReport = () => {
    if (auditReport) {
      securityAudit.exportReport(auditReport);
    }
  };

  const handleExportData = async () => {
    const data = await secureStorage.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCleanup = async () => {
    await secureStorage.cleanupExpiredItems();
    loadDashboardData();
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'CRITICAL': return '#dc2626';
      case 'HIGH': return '#ea580c';
      case 'MEDIUM': return '#f59e0b';
      case 'LOW': return '#3b82f6';
      case 'INFO': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getGradeColor = (grade) => {
    switch (grade) {
      case 'A': return '#10b981';
      case 'B': return '#3b82f6';
      case 'C': return '#f59e0b';
      case 'D': return '#ea580c';
      case 'F': return '#dc2626';
      default: return '#6b7280';
    }
  };

  if (loading && !auditReport) {
    return (
      <div className="security-dashboard loading">
        <div className="spinner"></div>
        <p>Running security audit...</p>
      </div>
    );
  }

  return (
    <div className="security-dashboard">
      <div className="dashboard-header">
        <h1>🔒 Security Dashboard</h1>
        <div className="header-actions">
          <button onClick={handleRunAudit} disabled={loading}>
            {loading ? 'Running...' : '🔄 Run Audit'}
          </button>
          <button onClick={handleExportReport} disabled={!auditReport}>
            📥 Export Report
          </button>
          <button onClick={handleExportData}>
            📦 Export Data
          </button>
          <button onClick={handleCleanup}>
            🧹 Cleanup
          </button>
        </div>
      </div>

      <div className="dashboard-tabs">
        <button 
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button 
          className={activeTab === 'findings' ? 'active' : ''}
          onClick={() => setActiveTab('findings')}
        >
          Findings
        </button>
        <button 
          className={activeTab === 'storage' ? 'active' : ''}
          onClick={() => setActiveTab('storage')}
        >
          Storage
        </button>
        <button 
          className={activeTab === 'audit-log' ? 'active' : ''}
          onClick={() => setActiveTab('audit-log')}
        >
          Audit Log
        </button>
      </div>

      {activeTab === 'overview' && auditReport && (
        <div className="tab-content">
          <div className="security-score-card">
            <div className="score-circle" style={{ borderColor: getGradeColor(auditReport.grade) }}>
              <div className="score-value">{auditReport.score}</div>
              <div className="score-grade">{auditReport.grade}</div>
            </div>
            <div className="score-details">
              <h3>Security Score</h3>
              <p>Last audit: {new Date(auditReport.timestamp).toLocaleString()}</p>
            </div>
          </div>

          <div className="summary-cards">
            <div className="summary-card critical">
              <div className="card-value">{auditReport.summary.critical}</div>
              <div className="card-label">Critical Issues</div>
            </div>
            <div className="summary-card high">
              <div className="card-value">{auditReport.summary.high}</div>
              <div className="card-label">High Priority</div>
            </div>
            <div className="summary-card medium">
              <div className="card-value">{auditReport.summary.medium}</div>
              <div className="card-label">Medium Priority</div>
            </div>
            <div className="summary-card low">
              <div className="card-value">{auditReport.summary.low}</div>
              <div className="card-label">Low Priority</div>
            </div>
          </div>

          {auditReport.recommendations.length > 0 && (
            <div className="recommendations-section">
              <h3>📋 Recommendations</h3>
              {auditReport.recommendations.map((rec, idx) => (
                <div key={idx} className={`recommendation-group ${rec.priority.toLowerCase()}`}>
                  <h4>{rec.priority} Priority</h4>
                  <ul>
                    {rec.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'findings' && auditReport && (
        <div className="tab-content">
          <div className="findings-list">
            {auditReport.findings.map((finding, idx) => (
              <div 
                key={idx} 
                className="finding-card"
                style={{ borderLeftColor: getSeverityColor(finding.severity) }}
              >
                <div className="finding-header">
                  <span className="finding-category">{finding.category}</span>
                  <span 
                    className="finding-severity"
                    style={{ backgroundColor: getSeverityColor(finding.severity) }}
                  >
                    {finding.severity}
                  </span>
                </div>
                <div className="finding-issue">{finding.issue}</div>
                {finding.recommendation && (
                  <div className="finding-recommendation">
                    💡 {finding.recommendation}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'storage' && storageStats && (
        <div className="tab-content">
          <div className="storage-stats">
            <div className="stat-card">
              <div className="stat-value">{storageStats.totalItems}</div>
              <div className="stat-label">Total Items</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{storageStats.encrypted}</div>
              <div className="stat-label">Encrypted Items</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{(storageStats.totalSize / 1024).toFixed(2)} KB</div>
              <div className="stat-label">Total Size</div>
            </div>
          </div>

          <div className="tier-breakdown">
            <h3>Data Classification</h3>
            <div className="tier-bars">
              <div className="tier-bar">
                <div className="tier-label">Public</div>
                <div className="tier-progress">
                  <div 
                    className="tier-fill public"
                    style={{ width: `${(storageStats.byTier.public / storageStats.totalItems) * 100}%` }}
                  ></div>
                </div>
                <div className="tier-count">{storageStats.byTier.public}</div>
              </div>
              <div className="tier-bar">
                <div className="tier-label">Internal</div>
                <div className="tier-progress">
                  <div 
                    className="tier-fill internal"
                    style={{ width: `${(storageStats.byTier.internal / storageStats.totalItems) * 100}%` }}
                  ></div>
                </div>
                <div className="tier-count">{storageStats.byTier.internal}</div>
              </div>
              <div className="tier-bar">
                <div className="tier-label">Confidential</div>
                <div className="tier-progress">
                  <div 
                    className="tier-fill confidential"
                    style={{ width: `${(storageStats.byTier.confidential / storageStats.totalItems) * 100}%` }}
                  ></div>
                </div>
                <div className="tier-count">{storageStats.byTier.confidential}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit-log' && (
        <div className="tab-content">
          <div className="audit-log-table">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Key</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((entry, idx) => (
                  <tr key={idx}>
                    <td>{new Date(entry.timestamp).toLocaleString()}</td>
                    <td><span className={`action-badge ${entry.action.toLowerCase()}`}>{entry.action}</span></td>
                    <td><code>{entry.key}</code></td>
                    <td>{entry.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
