import React from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';
import './ConfirmModal.css';

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel, confirmText = 'CONFIRM', cancelText = 'CANCEL', type = 'warning' }) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal-backdrop" onClick={onCancel}>
      <div className="confirm-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-header">
          <FaExclamationTriangle className={`confirm-icon ${type}`} />
          <h2 className="confirm-modal-title">{title}</h2>
        </div>

        <div className="confirm-modal-body">
          <p className="confirm-modal-message">{message}</p>
        </div>

        <div className="confirm-modal-footer">
          <button className="confirm-modal-btn btn-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button className={`confirm-modal-btn btn-confirm ${type}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
