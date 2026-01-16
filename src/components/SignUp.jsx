import { useState } from 'react';
import { registerUser } from '../utils/auth';
import './Auth.css';

// Import Discord QR code image
// Place your Discord QR code image at: src/assets/discord-qr.png
const discordQR = '/discord-qr.png'; // Will be placed in public folder

function SignUp({ onSuccess, onSwitchToSignIn, onTokenFocus, onOpenQR }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);

  // Calculate password strength
  const calculatePasswordStrength = (pwd) => {
    let strength = 0;
    if (pwd.length >= 8) strength += 25;
    if (pwd.length >= 12) strength += 25;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength += 25;
    if (/\d/.test(pwd)) strength += 15;
    if (/[^a-zA-Z0-9]/.test(pwd)) strength += 10;
    return Math.min(strength, 100);
  };

  const handlePasswordChange = (e) => {
    const newPassword = e.target.value;
    setPassword(newPassword);
    setPasswordStrength(calculatePasswordStrength(newPassword));
  };

  const getStrengthColor = () => {
    if (passwordStrength < 40) return '#ef4444';
    if (passwordStrength < 70) return '#f59e0b';
    return '#22c55e';
  };

  const getStrengthLabel = () => {
    if (passwordStrength < 40) return 'Weak';
    if (passwordStrength < 70) return 'Medium';
    return 'Strong';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    // Client-side validation
    if (!username.trim()) {
      setError('Please enter a username');
      setLoading(false);
      return;
    }

    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters');
      setLoading(false);
      return;
    }

    if (username.trim().length > 50) {
      setError('Username must not exceed 50 characters');
      setLoading(false);
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
      setError('Username can only contain letters, numbers, underscores, and hyphens');
      setLoading(false);
      return;
    }

    if (!password) {
      setError('Please enter a password');
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      setLoading(false);
      return;
    }

    if (!confirmPassword) {
      setError('Please confirm your password');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (!token.trim()) {
      setError('Please enter your access token');
      setLoading(false);
      return;
    }

    try {
      const result = await registerUser(username.trim(), password, confirmPassword, token.trim());

      if (result.success) {
        setSuccess(true);
        // Clear form
        setUsername('');
        setPassword('');
        setConfirmPassword('');
        setToken('');
        setPasswordStrength(0);

        // Show success message for 2 seconds then switch to sign in
        setTimeout(() => {
          onSuccess();
        }, 2000);
      } else {
        setError(result.error || 'Registration failed. Please try again.');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError('Unable to connect to server. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-form">
      <h2 className="auth-title">Create Account</h2>

      {error && (
        <div className="auth-error">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      {success && (
        <div className="auth-success">
          <span className="success-icon">✓</span>
          Account created successfully! Redirecting to sign in...
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Choose a unique username"
            required
            autoComplete="username"
            disabled={loading || success}
            minLength={3}
            maxLength={50}
            title="Username can only contain letters, numbers, underscores, and hyphens"
          />
          <small className="form-hint">3-50 characters, alphanumeric only</small>
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={handlePasswordChange}
            placeholder="Create a strong password"
            required
            autoComplete="new-password"
            disabled={loading || success}
            minLength={8}
          />
          {password && (
            <div style={{ marginTop: '10px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '5px'
              }}>
                <div style={{
                  flex: 1,
                  height: '6px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '3px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${passwordStrength}%`,
                    height: '100%',
                    background: getStrengthColor(),
                    transition: 'all 0.3s ease',
                    borderRadius: '3px'
                  }} />
                </div>
                <span style={{
                  fontSize: '0.85rem',
                  color: getStrengthColor(),
                  fontWeight: 600,
                  minWidth: '60px'
                }}>
                  {getStrengthLabel()}
                </span>
              </div>
              <small className="form-hint">Use 12+ chars with mixed case, numbers & symbols</small>
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm Password</label>
          <input
            type="password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            required
            autoComplete="new-password"
            disabled={loading || success}
            minLength={8}
            style={{
              borderColor: confirmPassword && password !== confirmPassword
                ? 'rgba(239, 68, 68, 0.5)'
                : confirmPassword && password === confirmPassword
                  ? 'rgba(34, 197, 94, 0.5)'
                  : undefined
            }}
          />
          {confirmPassword && password !== confirmPassword && (
            <small style={{ color: '#fca5a5', marginTop: '5px', display: 'block' }}>
              Passwords do not match
            </small>
          )}
          {confirmPassword && password === confirmPassword && (
            <small style={{ color: '#86efac', marginTop: '5px', display: 'block' }}>
              ✓ Passwords match
            </small>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="token">Access Token</label>
          <input
            type="text"
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onFocus={onTokenFocus}
            placeholder="Enter your access token"
            required
            disabled={loading || success}
          />
          <small className="form-hint">
            Don't have a token? <button type="button" className="qr-link" onClick={onOpenQR}>Click here to get one</button>
          </small>
        </div>

        <button
          type="submit"
          className="auth-button"
          disabled={loading || success || (password && password !== confirmPassword)}
        >
          {loading ? 'Creating Account...' : success ? 'Success!' : 'Sign Up'}
        </button>
      </form>

      <div className="auth-switch">
        <p>
          Already have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToSignIn}
            className="auth-link"
            disabled={loading || success}
          >
            Sign In
          </button>
        </p>
      </div>
    </div>
  );
}

export default SignUp;
