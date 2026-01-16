import { useState } from 'react';
import SignIn from '../components/SignIn';
import SignUp from '../components/SignUp';
import Toast from '../components/Toast';
import './LandingPage.css';

function LandingPage({ onLoginSuccess }) {
  const [showSignUp, setShowSignUp] = useState(false);
  const [toast, setToast] = useState(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [hasSeenQR, setHasSeenQR] = useState(false);

  const showToast = (message, type = 'error') => {
    setToast({ message, type });
  };

  const handleSignUpSuccess = () => {
    setShowSignUp(false);
    showToast('Account created successfully! Please sign in.', 'success');
  };

  const handleTokenFocus = () => {
    if (!hasSeenQR) {
      setShowQRModal(true);
    }
  };

  const handleCloseQR = () => {
    setShowQRModal(false);
    setHasSeenQR(true);
  };

  const handleOpenQR = () => {
    setShowQRModal(true);
  };

  return (
    <div className="landing-page">
      {/* Fixed Header */}
      <div className="landing-header-fixed">
        <h1 className="landing-title">Galaxy Kick Lock</h1>
        <h2 className="landing-version">2.0</h2>
      </div>

      {/* Scrollable Content Area */}
      <div className="landing-content">
        <div className="auth-container">
          <div className="auth-content">
            {showSignUp ? (
              <SignUp 
                onSuccess={handleSignUpSuccess}
                onSwitchToSignIn={() => setShowSignUp(false)}
                onTokenFocus={handleTokenFocus}
                onOpenQR={handleOpenQR}
              />
            ) : (
              <SignIn 
                onSuccess={onLoginSuccess}
                onSwitchToSignUp={() => setShowSignUp(true)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Fixed Footer */}
      <footer className="landing-footer-fixed">
        <p>© 2025 | Created by THALA</p>
      </footer>

      {/* QR Code Modal - Rendered at root level */}
      {showQRModal && (
        <div className="qr-modal-overlay" onClick={handleCloseQR}>
          <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={handleCloseQR}>×</button>
            
            <div className="qr-modal-header">
              <span className="qr-icon">💬</span>
              <h3>Need a Token?</h3>
            </div>
            
            <p className="qr-modal-description">
              Connect with our admin on Discord to get your access token
            </p>
            
            <div className="qr-code-wrapper">
              <img 
                src="/discord-qr.png" 
                alt="Discord QR Code - Add galaxykicklock as friend" 
                className="discord-qr-image"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextElementSibling.style.display = 'flex';
                }}
              />
              <div className="qr-placeholder" style={{ display: 'none' }}>
                <div className="qr-placeholder-content">
                  <div className="qr-box">
                    <div className="qr-corner qr-corner-tl"></div>
                    <div className="qr-corner qr-corner-tr"></div>
                    <div className="qr-corner qr-corner-bl"></div>
                    <div className="qr-corner qr-corner-br"></div>
                    <div className="qr-pattern">
                      <div className="qr-dot"></div>
                      <div className="qr-dot"></div>
                      <div className="qr-dot"></div>
                      <div className="qr-dot"></div>
                      <div className="qr-dot"></div>
                      <div className="qr-dot"></div>
                      <div className="qr-dot"></div>
                      <div className="qr-dot"></div>
                      <div className="qr-dot"></div>
                    </div>
                  </div>
                  <p style={{ marginTop: '16px', fontSize: '0.875rem', color: 'rgba(148, 163, 184, 0.9)' }}>
                    Scan QR Code to add<br/><strong style={{ color: '#60a5fa' }}>galaxykicklock</strong><br/>on Discord
                  </p>
                </div>
              </div>
            </div>
            
            <div className="qr-instructions">
              <p className="qr-step">
                <span className="step-number">1</span>
                Scan QR code with Discord app
              </p>
              <p className="qr-step">
                <span className="step-number">2</span>
                Add <strong>galaxykicklock</strong> as friend
              </p>
              <p className="qr-step">
                <span className="step-number">3</span>
                Request your access token
              </p>
            </div>
            
            <button 
              className="qr-modal-button" 
              onClick={handleCloseQR}
            >
              Got it, close
            </button>
          </div>
        </div>
      )}

      {/* TOAST OVERLAY */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default LandingPage;
