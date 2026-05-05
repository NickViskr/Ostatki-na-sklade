/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { Toaster } from 'sonner';

// Components
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { UploadTab } from './components/UploadTab';
import { ManualTab } from './components/ManualTab';
import { HistoryTab } from './components/HistoryTab';
import { SkusTab } from './components/SkusTab';
import { SettingsTab } from './components/SettingsTab';
import { ShipmentCostTab } from './components/ShipmentCostTab';
import { LoginScreen } from './components/LoginScreen';
import { UsersTab } from './components/UsersTab';
import { DeletedItemsTab } from './components/DeletedItemsTab';
import { DirectoryTab } from './components/DirectoryTab';

// Modals
import { ConfirmModal } from './components/ConfirmModal';
import { EditTransModal } from './components/EditTransModal';
import { SkuModal } from './components/SkuModal';
import { ConfirmDialog } from './components/ConfirmDialog';

// Stores
import { useUIStore } from './store/useUIStore';
import { useWarehouseStore } from './store/useWarehouseStore';
import { useSettingsStore } from './store/useSettingsStore';

export default function App() {
  const activeTab = useUIStore((state) => state.activeTab);
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const confirmDialog = useUIStore((state) => state.confirmDialog);
  const setConfirmDialog = useUIStore((state) => state.setConfirmDialog);
  
  const fetchStock = useWarehouseStore((state) => state.fetchStock);
  const fetchArchivedItems = useWarehouseStore((state) => state.fetchArchivedItems);
  const checkSession = useWarehouseStore((state) => state.checkSession);
  const currentUser = useWarehouseStore((state) => state.currentUser);

  const showConfirmModal = useUIStore((state) => state.showConfirmModal);
  const showEditTransModal = useUIStore((state) => state.showEditTransModal);
  const showSkuModal = useUIStore((state) => state.showSkuModal);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || 
    ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  useEffect(() => {
    if (currentUser) {
      fetchStock();
      if (isAdmin) {
        fetchArchivedItems();
      }
    }
  }, [fetchStock, fetchArchivedItems, currentUser, isAdmin]);

  useEffect(() => {
    if ((activeTab === 'settings' || activeTab === 'users' || activeTab === 'deleted') && !isAdmin) {
      setActiveTab('dashboard');
    }
  }, [activeTab, isAdmin, setActiveTab]);

  if (!currentUser) {
    return (
      <>
        <LoginScreen />
        <Toaster position="top-right" richColors closeButton />
      </>
    );
  }

  return (
    <div className="h-screen bg-slate-50 flex font-sans text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && <Dashboard key="dashboard" />}
          {activeTab === 'upload' && <UploadTab key="upload" />}
          {activeTab === 'manual' && <ManualTab key="manual" />}
          {activeTab === 'shipment' && <ShipmentCostTab key="shipment" />}
          {activeTab === 'history' && <HistoryTab key="history" />}
          {activeTab === 'skus' && <SkusTab key="skus" />}
          {activeTab === 'directory' && <DirectoryTab key="directory" />}
          {activeTab === 'users' && isAdmin && <UsersTab key="users" />}
          {activeTab === 'deleted' && isAdmin && <DeletedItemsTab key="deleted" />}
          {activeTab === 'settings' && isAdmin && <SettingsTab key="settings" />}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showConfirmModal && <ConfirmModal key="confirmModal" />}
        {showEditTransModal && <EditTransModal key="editTransModal" />}
        {showSkuModal && <SkuModal key="skuModal" />}
        
        <ConfirmDialog 
          key="confirmDialog"
          show={confirmDialog.show}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog({ ...confirmDialog, show: false })}
        />
      </AnimatePresence>

      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
