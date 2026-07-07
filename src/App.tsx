/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, Suspense } from 'react';
import { Toaster } from 'sonner';

// Components
import { Sidebar } from './components/Sidebar';

import { LoginScreen } from './components/LoginScreen';

// Lazy loaded components
const Dashboard = React.lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const UploadTab = React.lazy(() => import('./components/UploadTab').then(m => ({ default: m.UploadTab })));
const ManualTab = React.lazy(() => import('./components/ManualTab').then(m => ({ default: m.ManualTab })));
const HistoryTab = React.lazy(() => import('./components/HistoryTab').then(m => ({ default: m.HistoryTab })));
const SkusTab = React.lazy(() => import('./components/SkusTab').then(m => ({ default: m.SkusTab })));
const SettingsTab = React.lazy(() => import('./components/SettingsTab').then(m => ({ default: m.SettingsTab })));
const ShipmentCostTab = React.lazy(() => import('./components/ShipmentCostTab').then(m => ({ default: m.ShipmentCostTab })));
const UsersTab = React.lazy(() => import('./components/UsersTab').then(m => ({ default: m.UsersTab })));
const DeletedItemsTab = React.lazy(() => import('./components/DeletedItemsTab').then(m => ({ default: m.DeletedItemsTab })));
const DirectoryTab = React.lazy(() => import('./components/DirectoryTab').then(m => ({ default: m.DirectoryTab })));

// Modals
import { ConfirmModal } from './components/ConfirmModal';
import { EditTransModal } from './components/EditTransModal';
import { SkuModal } from './components/SkuModal';
import { KitModal } from './components/KitModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { MarketplaceMismatchModal } from './components/MarketplaceMismatchModal';

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
  const devMode = useWarehouseStore((state) => state.devMode);

  const showConfirmModal = useUIStore((state) => state.showConfirmModal);
  const showEditTransModal = useUIStore((state) => state.showEditTransModal);
  const showSkuModal = useUIStore((state) => state.showSkuModal);
  const showKitModal = useUIStore((state) => state.showKitModal);
  const setShowKitModal = useUIStore((state) => state.setShowKitModal);
  const kitModalSku = useUIStore((state) => state.kitModalSku);
  const setKitModalSku = useUIStore((state) => state.setKitModalSku);

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
    <div className={`h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900 overflow-hidden ${devMode ? 'border-4 border-red-600' : ''}`}>
      {devMode && (
        <div className="fixed top-0 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white text-xs font-bold px-4 py-1 rounded-b-md shadow">РЕЖИМ РАЗРАБОТКИ — ТЕСТОВАЯ БД</div>
      )}
      {/* Sidebar / Bottom Nav */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto w-full mb-16 md:mb-0">
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><div className="animate-pulse text-slate-400">Загрузка...</div></div>}>
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
        </Suspense>
      </main>

      {/* Modals */}
      <>
        <MarketplaceMismatchModal key="mismatchModal" />
        {showConfirmModal && <ConfirmModal key="confirmModal" />}
        {showEditTransModal && <EditTransModal key="editTransModal" />}
        {showSkuModal && <SkuModal key="skuModal" />}
        {showKitModal && kitModalSku && (
          <KitModal
            key="kitModal"
            kitSku={kitModalSku}
            onClose={() => { setShowKitModal(false); setKitModalSku(null); }}
          />
        )}
        
        <ConfirmDialog 
          key="confirmDialog"
          show={confirmDialog.show}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog({ ...confirmDialog, show: false })}
        />
      </>

      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
