import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSignIn from '../components/AdminSignIn';
import AdminSignUp from '../components/AdminSignUp';
import './LandingPage.css';

function AdminLandingPage() {
  const [isSignIn, setIsSignIn] = useState(true);
  const navigate = useNavigate();

  const handleAuthSuccess = (adminData) => {
    console.log('Admin authenticated:', adminData);
    // Small delay to ensure localStorage is updated
    setTimeout(() => {
      console.log('Navigating to dashboard...');
      navigate('/admin/dashboard', { replace: true });
    }, 100);
  };

  return (
    <div className="landing-page">
      {/* Fixed Header */}
      <div className="landing-header-fixed">
        <h1 className="landing-title">GALAXY KICK LOCK</h1>
        <p className="landing-version">2.0</p>
      </div>

      {/* Content Area */}
      <div className="landing-content">
        <div className="auth-container">
          <div className="auth-content">
            {isSignIn ? (
              <AdminSignIn
                onSuccess={handleAuthSuccess}
                onSwitchToSignUp={() => setIsSignIn(false)}
              />
            ) : (
              <AdminSignUp
                onSuccess={handleAuthSuccess}
                onSwitchToSignIn={() => setIsSignIn(true)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Fixed Footer */}
      <div className="landing-footer-fixed">
        <p>© 2025 | Admin Controller | Created by THALA</p>
      </div>
    </div>
  );
}

export default AdminLandingPage;
