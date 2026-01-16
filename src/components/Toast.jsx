import { useEffect, useRef } from 'react';
import './Toast.css';

const Toast = ({ message, type = 'error', onClose }) => {
  const timerRef = useRef(null);

  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new timer
    timerRef.current = setTimeout(() => {
      onClose();
    }, 3000);

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [message]);

  return (
    <div className={`toast toast-${type}`}>
      <span className="toast-icon">
        {type === 'error' ? '⚠️' : type === 'success' ? '✓' : 'ℹ️'}
      </span>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={onClose}>×</button>
    </div>
  );
};

export default Toast;
