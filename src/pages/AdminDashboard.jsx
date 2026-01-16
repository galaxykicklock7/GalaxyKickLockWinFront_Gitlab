import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminSession, logoutAdmin } from '../utils/adminAuth';
import TokenGenerator from '../components/TokenGenerator';
import UserManagement from '../components/UserManagement';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import './AdminDashboard.css';

function AdminDashboard() {
  const [adminSession, setAdminSession] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '', type: 'alert', onClose: null });
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', confirmText: '', type: 'warning', onConfirm: null });
  const navigate = useNavigate();

  useEffect(() => {
    const session = getAdminSession();
    if (!session) {
      navigate('/admin');
    } else {
      setAdminSession(session);
    }
  }, [navigate]);

  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      logoutAdmin();
      navigate('/admin');
    }
  };

  const handleTokenGenerated = () => {
    // Refresh user list when new token is generated
    setRefreshTrigger(prev => prev + 1);
  };

  const handleTokenDeleted = () => {
    // Refresh user list when token is deleted
    setRefreshTrigger(prev => prev + 1);
  };

  const handleTokenRenewed = () => {
    // Refresh token generator when token is renewed
    setRefreshTrigger(prev => prev + 1);
  };

  const handleShowModal = (modalConfig) => {
    setModal({
      isOpen: true,
      title: modalConfig.title,
      message: modalConfig.message,
      type: modalConfig.type || 'alert',
      onClose: modalConfig.onClose
    });
  };

  const handleShowConfirm = (confirmConfig) => {
    setConfirmModal({
      isOpen: true,
      title: confirmConfig.title,
      message: confirmConfig.message,
      confirmText: confirmConfig.confirmText,
      type: confirmConfig.type || 'warning',
      onConfirm: confirmConfig.onConfirm
    });
  };

  const handleCloseModal = () => {
    if (modal.onClose) {
      modal.onClose();
    }
    setModal({ isOpen: false, title: '', message: '', type: 'alert', onClose: null });
  };

  const handleCloseConfirm = () => {
    setConfirmModal({ isOpen: false, title: '', message: '', confirmText: '', type: 'warning', onConfirm: null });
  };

  const handleConfirm = () => {
    if (confirmModal.onConfirm) {
      confirmModal.onConfirm();
    }
    handleCloseConfirm();
  };

  if (!adminSession) {
    return null;
  }

  return (
    <div className="admin-dashboard">
      {/* Header */}
      <header className="admin-header">
        <div className="admin-header-content">
          <div className="admin-header-left">
            <h1 className="admin-header-title">GALAXY KICK LOCK 2.0</h1>
            <span className="admin-header-subtitle">Admin Controller</span>
          </div>
          <div className="admin-header-right">
            <span className="admin-username">👤 {adminSession.username}</span>
            <button className="admin-logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="admin-main">
        <div className="admin-container">
          <TokenGenerator onTokenGenerated={handleTokenGenerated} onTokenDeleted={handleTokenDeleted} refreshTrigger={refreshTrigger} />
          <UserManagement 
            refreshTrigger={refreshTrigger} 
            onTokenRenewed={handleTokenRenewed} 
            onShowModal={handleShowModal}
            onShowConfirm={handleShowConfirm}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="admin-footer">
        <p>© 2025 | Galaxy Kick Lock 2.0 Admin Controller | Created by THALA</p>
      </footer>

      {/* Global Modal */}
      <Modal
        isOpen={modal.isOpen}
        onClose={handleCloseModal}
        title={modal.title}
        message={modal.message}
        type={modal.type}
      />

      {/* Global Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        type={confirmModal.type}
        onConfirm={handleConfirm}
        onCancel={handleCloseConfirm}
      />
    </div>
  );
}

export default AdminDashboard;
