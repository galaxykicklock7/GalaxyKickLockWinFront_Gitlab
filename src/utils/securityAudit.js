/**
 * Security Audit Utility
 * 
 * Performs comprehensive security checks and generates audit reports
 * for enterprise compliance and monitoring.
 */

import { secureStorage } from './secureStorage';
import { securityManager } from './securityManager';

class SecurityAudit {
  constructor() {
    this.findings = [];
    this.score = 100;
  }

  /**
   * Run comprehensive security audit
   */
  async runAudit() {
    this.findings = [];
    this.score = 100;

    await this.checkStorageSecurity();
    await this.checkSessionSecurity();
    await this.checkNetworkSecurity();
    await this.checkBrowserSecurity();
    await this.checkComplianceSecurity();

    return this.generateReport();
  }

  /**
   * Check localStorage security
   */
  async checkStorageSecurity() {
    const category = 'Storage Security';

    // Check if storage is available
    if (!secureStorage.isAvailable()) {
      this.addFinding(category, 'CRITICAL', 'LocalStorage not available', 'Enable localStorage in browser settings');
      this.score -= 20;
      return;
    }

    // Validate storage security
    const validation = await secureStorage.validateSecurity();
    if (!validation.secure) {
      validation.issues.forEach(issue => {
        this.addFinding(category, issue.severity, issue.issue, `Fix ${issue.key}`);
        this.score -= issue.severity === 'CRITICAL' ? 15 : issue.severity === 'HIGH' ? 10 : 5;
      });
    }

    // Check storage size
    const stats = await secureStorage.getStats();
    if (stats.totalSize > 5 * 1024 * 1024) { // 5MB
      this.addFinding(category, 'MEDIUM', 'Storage size exceeds 5MB', 'Clean up old data');
      this.score -= 5;
    }

    // Check encryption ratio
    const encryptionRatio = stats.encrypted / stats.totalItems;
    if (encryptionRatio < 0.5 && stats.totalItems > 0) {
      this.addFinding(category, 'HIGH', 'Less than 50% of items encrypted', 'Encrypt sensitive data');
      this.score -= 10;
    }

    this.addFinding(category, 'INFO', `Storage stats: ${stats.totalItems} items, ${stats.encrypted} encrypted`, null);
  }

  /**
   * Check session security
   */
  async checkSessionSecurity() {
    const category = 'Session Security';

    try {
      const session = await secureStorage.getItem('userSession');
      
      if (session) {
        // Check session age
        const sessionAge = Date.now() - (session.created_at || 0);
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        if (sessionAge > maxAge) {
          this.addFinding(category, 'HIGH', 'Session older than 7 days', 'Force re-authentication');
          this.score -= 10;
        }

        // Check if session has required fields
        const requiredFields = ['user_id', 'username', 'session_token'];
        const missingFields = requiredFields.filter(field => !session[field]);
        
        if (missingFields.length > 0) {
          this.addFinding(category, 'CRITICAL', `Session missing fields: ${missingFields.join(', ')}`, 'Logout and re-authenticate');
          this.score -= 15;
        }

        // Check token format (should be UUID or JWT)
        if (session.session_token && session.session_token.length < 20) {
          this.addFinding(category, 'HIGH', 'Session token appears weak', 'Regenerate session token');
          this.score -= 10;
        }
      }
    } catch (error) {
      this.addFinding(category, 'MEDIUM', 'Failed to validate session', 'Check session integrity');
      this.score -= 5;
    }
  }

  /**
   * Check network security
   */
  async checkNetworkSecurity() {
    const category = 'Network Security';

    // Check if HTTPS is used
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      this.addFinding(category, 'CRITICAL', 'Not using HTTPS', 'Enable HTTPS');
      this.score -= 20;
    }

    // Check if backend URL is exposed
    const backendUrl = await secureStorage.getItem('backendUrl');
    if (backendUrl && !backendUrl.startsWith('https://')) {
      this.addFinding(category, 'HIGH', 'Backend URL not using HTTPS', 'Use HTTPS for backend');
      this.score -= 10;
    }

    // Check CSP
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (!csp) {
      this.addFinding(category, 'MEDIUM', 'No Content-Security-Policy meta tag', 'Add CSP headers');
      this.score -= 5;
    }
  }

  /**
   * Check browser security features
   */
  checkBrowserSecurity() {
    const category = 'Browser Security';

    // Check if cookies are enabled
    if (!navigator.cookieEnabled) {
      this.addFinding(category, 'MEDIUM', 'Cookies disabled', 'Enable cookies for better security');
      this.score -= 5;
    }

    // Check if in private/incognito mode
    if (this.isPrivateMode()) {
      this.addFinding(category, 'INFO', 'Private browsing detected', 'Some features may be limited');
    }

    // Check if Web Crypto API is available
    if (!window.crypto || !window.crypto.subtle) {
      this.addFinding(category, 'HIGH', 'Web Crypto API not available', 'Use modern browser');
      this.score -= 10;
    }

    // Check if running in iframe
    if (window.self !== window.top) {
      this.addFinding(category, 'MEDIUM', 'Running in iframe', 'Potential clickjacking risk');
      this.score -= 5;
    }
  }

  /**
   * Check compliance requirements
   */
  async checkComplianceSecurity() {
    const category = 'Compliance';

    // Check data retention
    const auditLog = secureStorage.getAuditLog();
    if (auditLog.length === 0) {
      this.addFinding(category, 'LOW', 'No audit log entries', 'Audit logging may not be working');
      this.score -= 3;
    }

    // Check for PII in localStorage
    const keys = Object.keys(localStorage);
    const piiPatterns = ['email', 'phone', 'address', 'ssn', 'credit'];
    
    keys.forEach(key => {
      if (piiPatterns.some(pattern => key.toLowerCase().includes(pattern))) {
        this.addFinding(category, 'HIGH', `Potential PII in key: ${key}`, 'Remove or encrypt PII');
        this.score -= 10;
      }
    });

    // Check data export capability (GDPR)
    try {
      await secureStorage.exportData();
      this.addFinding(category, 'INFO', 'Data export capability verified', null);
    } catch (error) {
      this.addFinding(category, 'MEDIUM', 'Data export failed', 'Fix export functionality');
      this.score -= 5;
    }
  }

  /**
   * Add finding to report
   */
  addFinding(category, severity, issue, recommendation) {
    this.findings.push({
      category,
      severity,
      issue,
      recommendation,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Generate audit report
   */
  generateReport() {
    const criticalCount = this.findings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = this.findings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = this.findings.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = this.findings.filter(f => f.severity === 'LOW').length;

    // Calculate grade
    let grade = 'A';
    if (this.score < 90) grade = 'B';
    if (this.score < 80) grade = 'C';
    if (this.score < 70) grade = 'D';
    if (this.score < 60) grade = 'F';

    return {
      timestamp: new Date().toISOString(),
      score: Math.max(0, this.score),
      grade,
      summary: {
        total: this.findings.length,
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: lowCount
      },
      findings: this.findings,
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Generate prioritized recommendations
   */
  generateRecommendations() {
    const recommendations = [];

    // Critical issues first
    const critical = this.findings.filter(f => f.severity === 'CRITICAL' && f.recommendation);
    if (critical.length > 0) {
      recommendations.push({
        priority: 'IMMEDIATE',
        items: critical.map(f => f.recommendation)
      });
    }

    // High priority issues
    const high = this.findings.filter(f => f.severity === 'HIGH' && f.recommendation);
    if (high.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        items: high.map(f => f.recommendation)
      });
    }

    // Medium priority issues
    const medium = this.findings.filter(f => f.severity === 'MEDIUM' && f.recommendation);
    if (medium.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        items: medium.map(f => f.recommendation)
      });
    }

    return recommendations;
  }

  /**
   * Check if browser is in private mode
   */
  isPrivateMode() {
    try {
      // This is a heuristic and may not work in all browsers
      if (window.indexedDB === null) return true;
      if (window.localStorage === null) return true;
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Export audit report
   */
  exportReport(report) {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Export singleton instance
export const securityAudit = new SecurityAudit();
export default securityAudit;
