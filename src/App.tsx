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
  const gasUrl = useSettingsStore((state) => state.gasUrl);

  const showConfirmModal = useUIStore((state) => state.showConfirmModal);
  const showEditTransModal = useUIStore((state) => state.showEditTransModal);
  const showSkuModal = useUIStore((state) => state.showSkuModal);

  useEffect(() => {
    if (gasUrl && gasUrl.startsWith('http')) {
      fetchStock();
    }
  }, [gasUrl, fetchStock]);

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
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
          {activeTab === 'settings' && <SettingsTab key="settings" />}
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
