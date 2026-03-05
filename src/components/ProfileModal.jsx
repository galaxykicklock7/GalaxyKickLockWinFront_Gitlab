import React from 'react';
import { FaUser, FaKey, FaClock, FaTimes } from 'react-icons/fa';
import './ProfileModal.css';

const ProfileModal = ({ isOpen, currentUser, onClose }) => {
    if (!isOpen || !currentUser) return null;

    const formatExpiryDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const now = new Date();
        
        if (date < now) {
            return 'EXPIRED';
        }
        
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const isExpired = (dateString) => {
        if (!dateString) return false;
        return new Date(dateString) < new Date();
    };

    const getDaysRemaining = (dateString) => {
        if (!dateString) return 0;
        const date = new Date(dateString);
        const now = new Date();
        const diff = date - now;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };

    const daysRemaining = getDaysRemaining(currentUser.token_expiry_date);
    const expired = isExpired(currentUser.token_expiry_date);

    return (
        <>
            <div className="profile-modal-overlay" onClick={onClose} />
            <div className="profile-modal">
                <div className="profile-modal-header">
                    <div className="profile-header-content">
                        <FaUser className="profile-icon" />
                        <span className="profile-title">USER PROFILE</span>
                    </div>
                    <button className="profile-close-btn" onClick={onClose}>
                        <FaTimes />
                    </button>
                </div>

                <div className="profile-modal-content">
                    {/* Username */}
                    <div className="profile-field">
                        <div className="profile-field-label">
                            <FaUser className="field-icon" />
                            <span>USERNAME</span>
                        </div>
                        <div className="profile-field-value username-value">
                            {currentUser.username.toUpperCase()}
                        </div>
                    </div>

                    {/* Token Status */}
                    <div className="profile-field">
                        <div className="profile-field-label">
                            <FaKey className="field-icon" />
                            <span>TOKEN STATUS</span>
                        </div>
                        <div className={`profile-field-value status-value ${expired ? 'expired' : 'active'}`}>
                            {expired ? '⚠️ EXPIRED' : '✓ ACTIVE'}
                        </div>
                    </div>

                    {/* Expiry Date */}
                    <div className="profile-field">
                        <div className="profile-field-label">
                            <FaClock className="field-icon" />
                            <span>EXPIRES ON</span>
                        </div>
                        <div className={`profile-field-value ${expired ? 'expired-text' : 'active-text'}`}>
                            {formatExpiryDate(currentUser.token_expiry_date)}
                        </div>
                    </div>

                    {/* Days Remaining */}
                    {!expired && (
                        <div className="profile-field">
                            <div className="profile-field-label">
                                <FaClock className="field-icon" />
                                <span>DAYS REMAINING</span>
                            </div>
                            <div className={`profile-field-value days-value ${daysRemaining <= 7 ? 'warning' : ''}`}>
                                {daysRemaining} {daysRemaining === 1 ? 'DAY' : 'DAYS'}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default ProfileModal;
