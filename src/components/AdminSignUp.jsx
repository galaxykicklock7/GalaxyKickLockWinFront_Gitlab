import { useState } from 'react';
import { registerAdmin } from '../utils/adminAuth';
import './Auth.css';

function AdminSignUp({ onSuccess, onSwitchToSignIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const result = await registerAdmin(username, password);

      if (result.success) {
        // Auto-switch to sign in after successful registration
        setError('');
        setTimeout(() => {
          onSwitchToSignIn();
        }, 1000);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-form">
      <h2 className="auth-title">Admin Sign Up</h2>
      
      {error && (
        <div className="auth-error">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="admin-signup-username">Username</label>
          <input
            type="text"
            id="admin-signup-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Create admin username"
            required
            autoComplete="username"
            disabled={loading}
            autoFocus
          />
          <span className="form-hint">3-50 characters, alphanumeric only</span>
        </div>

        <div className="form-group">
          <label htmlFor="admin-signup-password">Password</label>
          <input
            type="password"
            id="admin-signup-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a strong password"
            required
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="admin-confirm-password">Confirm Password</label>
          <input
            type="password"
            id="admin-confirm-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            required
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <button 
          type="submit" 
          className="auth-button"
          disabled={loading}
        >
          {loading ? 'Creating Account...' : 'Sign Up'}
        </button>
      </form>

      <div className="auth-switch">
        <p>
          Already have an admin account?{' '}
          <button 
            type="button"
            onClick={onSwitchToSignIn}
            className="auth-link"
            disabled={loading}
          >
            Sign In
          </button>
        </p>
      </div>
    </div>
  );
}

export default AdminSignUp;
