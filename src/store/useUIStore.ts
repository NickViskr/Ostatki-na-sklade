import { create } from 'zustand';
import { Transaction, SKUItem, ParsedItem, RecognitionHistoryItem } from '../types';

type TabType = 'dashboard' | 'upload' | 'manual' | 'shipment' | 'history' | 'skus' | 'directory' | 'settings' | 'users' | 'deleted';

interface UIState {
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  
  // Dashboard Filters
  dashSearch: string;
  setDashSearch: (search: string) => void;
  dashStockFilter: 'all' | 'in_stock' | 'low_stock';
  setDashStockFilter: (filter: 'all' | 'in_stock' | 'low_stock') => void;
  lowStockThreshold: number | string;
  setLowStockThreshold: (threshold: number | string) => void;
  dashSelectedSkus: string[];
  setDashSelectedSkus: (skus: string[]) => void;
  dashTurnoverDays: number | string;
  setDashTurnoverDays: (days: number | string) => void;
  showDashSettingsModal: boolean;
  setShowDashSettingsModal: (show: boolean) => void;
  dashTableSelectedSkus: string[];
  setDashTableSelectedSkus: (skus: string[]) => void;

  // History Filters
  histSelectedSkus: string[];
  setHistSelectedSkus: (skus: string[]) => void;
  histTypeFilter: 'all' | 'Приход' | 'Расход' | 'Корректировка';
  setHistTypeFilter: (filter: 'all' | 'Приход' | 'Расход' | 'Корректировка') => void;
  histStartDate: string;
  setHistStartDate: (date: string) => void;
  histEndDate: string;
  setHistEndDate: (date: string) => void;
  histDestFilter: string;
  setHistDestFilter: (dest: string) => void;

  // Upload State
  rawText: string;
  setRawText: (text: string) => void;
  filesInfo: string[];
  setFilesInfo: (files: string[]) => void;
  recognitionHistory: RecognitionHistoryItem[];
  addRecognitionHistory: (item: RecognitionHistoryItem) => void;
  opType: 'Приход' | 'Расход';
  setOpType: (type: 'Приход' | 'Расход') => void;
  uploadDestination: string;
  setUploadDestination: (dest: string) => void;
  parsedItems: ParsedItem[] | null;
  setParsedItems: (items: ParsedItem[] | null) => void;
  updateParsedItem: (index: number, updates: Partial<ParsedItem>) => void;
  aiFeedback: string;
  setAiFeedback: (feedback: string) => void;
  clearRecognitionData: () => void;

  // Modals
  showConfirmModal: boolean;
  setShowConfirmModal: (show: boolean) => void;
  showMismatchModal: boolean;
  setShowMismatchModal: (show: boolean) => void;
  mismatchData: { detected: string; selected: string } | null;
  setMismatchData: (data: { detected: string; selected: string } | null) => void;
  showEditTransModal: boolean;
  setShowEditTransModal: (show: boolean) => void;
  editingTrans: any;
  setEditingTrans: (trans: any) => void;
  showSkuModal: boolean;
  setShowSkuModal: (show: boolean) => void;
  editingSku: SKUItem | null;
  setEditingSku: (sku: SKUItem | null) => void;
  showKitModal: boolean;
  setShowKitModal: (show: boolean) => void;
  kitModalSku: string | null;
  setKitModalSku: (sku: string | null) => void;
  
  // Manual Form
  manualForm: {
    article: string;
    type: string;
    quantity: number | string;
    destination: string;
    price: number | string;
    deliveryDate: string;
  };
  setManualForm: (form: any) => void;
  
  // SKU Form
  skuForm: any;
  setSkuForm: (form: any) => void;
  skuSearch: string;
  setSkuSearch: (search: string) => void;

  // Confirmation Dialog
  confirmDialog: {
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  };
  setConfirmDialog: (dialog: any) => void;
  askConfirmation: (title: string, message: string, onConfirm: () => void) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarCollapsed: false,
  setIsSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
  activeTab: 'dashboard',
  setActiveTab: (activeTab) => set({ activeTab }),

  dashSearch: '',
  setDashSearch: (dashSearch) => set({ dashSearch }),
  dashStockFilter: 'all',
  setDashStockFilter: (dashStockFilter) => set({ dashStockFilter }),
  lowStockThreshold: 10,
  setLowStockThreshold: (lowStockThreshold) => set({ lowStockThreshold }),
  dashSelectedSkus: [],
  setDashSelectedSkus: (dashSelectedSkus) => set({ dashSelectedSkus }),
  dashTurnoverDays: 120,
  setDashTurnoverDays: (dashTurnoverDays) => set({ dashTurnoverDays }),
  showDashSettingsModal: false,
  setShowDashSettingsModal: (showDashSettingsModal) => set({ showDashSettingsModal }),
  dashTableSelectedSkus: [],
  setDashTableSelectedSkus: (dashTableSelectedSkus) => set({ dashTableSelectedSkus }),

  histSelectedSkus: [],
  setHistSelectedSkus: (histSelectedSkus) => set({ histSelectedSkus }),
  histTypeFilter: 'all',
  setHistTypeFilter: (histTypeFilter) => set({ histTypeFilter }),
  histStartDate: '',
  setHistStartDate: (histStartDate) => set({ histStartDate }),
  histEndDate: '',
  setHistEndDate: (histEndDate) => set({ histEndDate }),
  histDestFilter: 'all',
  setHistDestFilter: (histDestFilter) => set({ histDestFilter }),

  rawText: '',
  setRawText: (rawText) => set({ rawText }),
  filesInfo: [],
  setFilesInfo: (filesInfo) => set({ filesInfo }),
  recognitionHistory: [],
  addRecognitionHistory: (item) => set((state) => {
    // Keep max 3 items
    const newHistory = [item, ...state.recognitionHistory].slice(0, 3);
    return { recognitionHistory: newHistory };
  }),
  opType: 'Расход',
  setOpType: (opType) => set({ opType }),
  uploadDestination: 'Ozon',
  setUploadDestination: (uploadDestination) => set({ uploadDestination }),
  parsedItems: null,
  setParsedItems: (parsedItems) => set({ parsedItems }),
  updateParsedItem: (index, updates) => set((state) => {
    if (!state.parsedItems) return state;
    const newItems = [...state.parsedItems];
    newItems[index] = { ...newItems[index], ...updates };
    return { parsedItems: newItems };
  }),
  aiFeedback: '',
  setAiFeedback: (aiFeedback) => set({ aiFeedback }),
  clearRecognitionData: () => set({
    recognitionHistory: [],
    rawText: '',
    filesInfo: [],
    parsedItems: null,
    aiFeedback: ''
  }),

  showConfirmModal: false,
  setShowConfirmModal: (showConfirmModal) => set({ showConfirmModal }),
  showMismatchModal: false,
  setShowMismatchModal: (showMismatchModal) => set({ showMismatchModal }),
  mismatchData: null,
  setMismatchData: (mismatchData) => set({ mismatchData }),
  showEditTransModal: false,
  setShowEditTransModal: (showEditTransModal) => set({ showEditTransModal }),
  editingTrans: null,
  setEditingTrans: (editingTrans) => set({ editingTrans }),
  showSkuModal: false,
  setShowSkuModal: (showSkuModal) => set({ showSkuModal }),
  editingSku: null,
  setEditingSku: (editingSku) => set({ editingSku }),
  showKitModal: false,
  setShowKitModal: (showKitModal) => set({ showKitModal }),
  kitModalSku: null,
  setKitModalSku: (kitModalSku) => set({ kitModalSku }),

  manualForm: {
    article: '',
    type: 'Списание - Брак',
    quantity: '',
    destination: 'Ozon',
    price: '',
    deliveryDate: ''
  },
  setManualForm: (manualForm) => set({ manualForm }),

  skuForm: { sku: '', price: '', minStock: '', pcsPerBox: '', boxesPerPallet: 0, volumeLiters: 0 },
  setSkuForm: (skuForm) => set({ skuForm }),
  skuSearch: '',
  setSkuSearch: (skuSearch) => set({ skuSearch }),

  confirmDialog: {
    show: false,
    title: '',
    message: '',
    onConfirm: () => {}
  },
  setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
  askConfirmation: (title, message, onConfirm) => set({
    confirmDialog: { show: true, title, message, onConfirm }
  }),
}));
