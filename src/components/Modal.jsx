import { useEffect } from 'react';
import './Modal.css';

function Modal({ isOpen, onClose, onConfirm, title, message, type = 'confirm' }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-container">
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="modal-message" style={{ whiteSpace: 'pre-wrap' }}>{message}</p>
        </div>
        <div className="modal-footer">
          {type === 'confirm' ? (
            <>
              <button className="modal-btn modal-btn-cancel" onClick={onClose}>
                Cancel
              </button>
              <button className="modal-btn modal-btn-confirm" onClick={onConfirm}>
                Confirm
              </button>
            </>
          ) : (
            <button className="modal-btn modal-btn-ok" onClick={onClose}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Modal;
