import { create } from 'zustand';
import { StockItem, Transaction, SKUItem, ParsedItem, User, ArchivedItem, ServiceItem } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { useUIStore } from './useUIStore';
import { parseInvoiceWithGemini } from '../lib/gemini';
import { toast } from 'sonner';

interface WarehouseState {
  stock: StockItem[];
  transactions: Transaction[];
  skus: SKUItem[];
  services: ServiceItem[];
  usersList: User[];
  archivedItems: ArchivedItem[];
  currentUser: User | null;
  sessionToken: string | null;
  isSyncing: boolean;
  isProcessing: boolean;
  isAddingSku: boolean;
  
  setStock: (stock: StockItem[]) => void;
  setTransactions: (transactions: Transaction[]) => void;
  setSkus: (skus: SKUItem[]) => void;
  setServices: (services: ServiceItem[]) => void;
  setUsersList: (users: User[]) => void;
  setCurrentUser: (user: User | null) => void;
  setSessionToken: (token: string | null) => void;
  setIsSyncing: (isSyncing: boolean) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  
  fetchGas: (action: string, extraPayload?: any) => Promise<any>;
  fetchStock: () => Promise<void>;
  handleSetupDatabase: () => Promise<boolean>;
  handleSaveSku: (skuForm: SKUItem, editingSku: SKUItem | null) => Promise<boolean>;
  handleDeleteSku: (sku: string) => Promise<boolean>;
  handleAddService: (name: string, cost: number) => Promise<boolean>;
  handleUpdateService: (id: string, name: string, cost: number, isActive: boolean) => Promise<boolean>;
  handleDeleteService: (id: string) => Promise<boolean>;
  commitTransaction: (items: ParsedItem[], type: string, destination: string, deliveryDate?: string) => Promise<boolean>;
  handleDeleteTransaction: (id: string) => Promise<boolean>;
  handleDeleteMultipleTransactions: (ids: string[]) => Promise<boolean>;
  handleUpdateTransaction: (id: string, data: Transaction) => Promise<boolean>;
  handleProcessInvoice: (feedback?: any) => Promise<void>;
  
  checkSession: () => Promise<void>;
  handleLogin: (username: string, password: string) => Promise<boolean>;
  handleLogout: () => void;
  fetchUsersList: () => Promise<void>;
  handleAddUser: (username: string, password: string, role: 'admin' | 'user') => Promise<boolean>;
  handleDeleteUser: (username: string) => Promise<boolean>;
  fetchArchivedItems: () => Promise<void>;
  handleRestoreArchivedItem: (archiveId: string) => Promise<boolean>;
  handleRestoreMultipleArchivedItems: (archiveIds: string[]) => Promise<boolean>;
  handleHardDeleteArchivedItems: (archiveIds: string[]) => Promise<boolean>;
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  stock: [],
  transactions: [],
  skus: [],
  services: [],
  usersList: [],
  archivedItems: [],
  currentUser: null,
  sessionToken: null,
  isSyncing: false,
  isProcessing: false,
  isAddingSku: false,

  setStock: (stock) => set({ stock }),
  setTransactions: (transactions) => set({ transactions }),
  setSkus: (skus) => set({ skus }),
  setServices: (services) => set({ services }),
  setUsersList: (usersList) => set({ usersList }),
  setCurrentUser: (currentUser) => set({ currentUser }),
  setSessionToken: (sessionToken) => set({ sessionToken }),
  setIsSyncing: (isSyncing) => set({ isSyncing }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),

  fetchGas: async (action, extraPayload = {}) => {
    const sessionToken = get().sessionToken;
    
    try {
      const response = await fetch('/api/gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sessionToken, ...extraPayload })
      });
      
      if (!response.ok) {
        return { status: 'error', message: `Ошибка HTTP ${response.status}` };
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        if (text.includes('<!DOCTYPE html>')) {
          return { status: 'error', message: 'GAS вернул HTML (возможно, ошибка в коде скрипта или нет доступа)' };
        }
        return { status: 'error', message: 'Ответ сервера не является JSON' };
      }
    } catch (e) {
      return { status: 'error', message: `Ошибка сети: ${(e as Error).message}` };
    }
  },

  fetchStock: async () => {
    set({ isSyncing: true });
    try {
      const [stockResult, skuResult, transResult, servicesResult] = await Promise.all([
        get().fetchGas('getStock'),
        get().fetchGas('getSkus'),
        get().fetchGas('getTransactions'),
        get().fetchGas('getServices')
      ]);

      if (stockResult.status === 'success') {
        set({ stock: stockResult.data });
      } else {
        toast.error("Ошибка загрузки остатков: " + stockResult.message);
      }
      
      if (skuResult.status === 'success') {
        set({ skus: skuResult.data });
      } else {
        toast.error("Ошибка загрузки SKU: " + skuResult.message);
      }

      if (servicesResult.status === 'success') {
        set({ services: servicesResult.data });
      }
      
      if (transResult.status === 'success') {
        const tData = transResult.data;
        const rows = Array.isArray(tData) ? tData : (tData.rows || []);
        set({ transactions: rows });
        if (rows.length === 0) {
          toast.info("История загружена, но она пуста (0 записей).");
        }
      } else {
        toast.error("Ошибка загрузки истории: " + transResult.message);
      }
    } catch (error) {
      console.error("Fetch Error:", error);
    } finally {
      set({ isSyncing: false });
    }
  },

  handleSetupDatabase: async () => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('setup');
      if (result.status === 'success') {
        toast.success('База данных успешно инициализирована!');
        await get().fetchStock();
        return true;
      } else {
        toast.error('Ошибка инициализации: ' + result.message);
        return false;
      }
    } catch (error) {
      console.error("Setup Error:", error);
      toast.error('Ошибка сети при инициализации базы данных. Проверьте URL и доступ.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleSaveSku: async (skuForm, editingSku) => {
    if (!skuForm.sku) return false;
    
    set({ isAddingSku: true });
    try {
      const result = await get().fetchGas(editingSku ? 'updateSku' : 'addSku', {
        data: skuForm,
        oldSku: editingSku?.sku
      });
      if (result.status === 'success') {
        if (editingSku) {
          set({ skus: result.data.skus, stock: result.data.stock });
          toast.success('SKU успешно обновлен');
        } else {
          set({ skus: result.data });
          toast.success('Новый SKU добавлен');
        }
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      console.error("SKU Error:", error);
      toast.error('Ошибка сети при сохранении SKU.');
      return false;
    } finally {
      set({ isAddingSku: false });
    }
  },

  handleDeleteSku: async (sku) => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('deleteSku', { sku });
      if (result.status === 'success') {
        set({ skus: result.data });
        toast.success('SKU удален');
        return true;
      } else {
        toast.error('Ошибка при удалении: ' + result.message);
        return false;
      }
    } catch (error) {
      console.error("Delete SKU Error:", error);
      toast.error('Ошибка сети при удалении SKU.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleAddService: async (name, cost) => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('addService', { data: { name, cost } });
      if (result.status === 'success') {
        set({ services: result.data });
        toast.success('Услуга добавлена');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      toast.error('Ошибка сети при добавлении услуги.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleUpdateService: async (id, name, cost, isActive) => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('updateService', { id, data: { name, cost, isActive } });
      if (result.status === 'success') {
        set({ services: result.data });
        toast.success('Услуга обновлена');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      toast.error('Ошибка сети при обновлении услуги.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleDeleteService: async (id) => {
    set({ isSyncing: true });
    try {
      const service = get().services.find(s => s.id === id);
      if (!service) return false;
      const result = await get().fetchGas('deleteService', { id, data: { name: service.name, cost: service.cost } });
      if (result.status === 'success') {
        set({ services: result.data });
        toast.success('Услуга удалена');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      toast.error('Ошибка сети при удалении услуги.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  commitTransaction: async (items, type, destination, deliveryDate = '') => {
    const { notificationEmail } = useSettingsStore.getState();
    
    if (type === 'Расход') {
      const currentStock = get().stock;
      const requiredQtys: Record<string, number> = {};
      
      for (const item of items) {
        if (!item.article) continue;
        requiredQtys[item.article] = (requiredQtys[item.article] || 0) + (Number(item.quantity) || 0);
      }

      for (const [article, reqQty] of Object.entries(requiredQtys)) {
        const stockItem = currentStock.find(s => s.article === article);
        const availableQty = stockItem ? Number(stockItem.quantity) : 0;
        
        if (reqQty > availableQty) {
          toast.error(`Недостаточно товара "${article}". Доступно: ${availableQty}, требуется: ${reqQty}`);
          return false;
        }
      }
    }

    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('commit', {
        data: items, 
        type, 
        destination,
        deliveryDate,
        notificationEmail 
      });
      
      if (result.status === 'success') {
        set({ stock: result.data });
        toast.success('Операция успешно записана в Google Таблицу!');
        
        // Fetch transactions and skus in background so UI doesn't block
        Promise.all([
          get().fetchGas('getTransactions'),
          get().fetchGas('getSkus')
        ]).then(([transResult, skuResult]) => {
          if (transResult.status === 'success') {
            const tData = transResult.data;
            set({ transactions: Array.isArray(tData) ? tData : (tData.rows || []) });
          }
          if (skuResult.status === 'success') {
            set({ skus: skuResult.data });
          }
        }).catch(console.error);
        
        return true;
      } else {
        toast.error("Ошибка сервера: " + result.message);
        return false;
      }
    } catch (error) {
      console.error("Commit Error:", error);
      toast.error("Ошибка сети. Проверьте URL и настройки доступа GAS.");
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleDeleteTransaction: async (id) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('deleteTransaction', { id });
      if (result.status === 'success') {
        const txData = result.data.transactions;
        const txRows = Array.isArray(txData) ? txData : (txData.rows || []);
        set({ stock: result.data.stock, transactions: txRows });
        toast.success('Операция удалена');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при удалении операции');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleDeleteMultipleTransactions: async (ids) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('deleteMultipleTransactions', { ids });
      if (result.status === 'success' || result.data?.partial) {
        const payloadData = result.status === 'success' ? result.data : result.data;
        const txData = payloadData.transactions;
        const txRows = Array.isArray(txData) ? txData : (txData.rows || []);
        
        set({ stock: payloadData.stock, transactions: txRows });
        
        if (payloadData.partial && payloadData.message) {
           toast.warning(payloadData.message);
        } else {
           toast.success(`Удалено операций: ${ids.length}`);
        }
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при удалении операций');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleUpdateTransaction: async (id, data) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('updateTransaction', { id, data });
      if (result.status === 'success') {
        set({ stock: result.data });
        toast.success('Операция обновлена');
        
        // Fetch transactions and skus in background
        Promise.all([
          get().fetchGas('getTransactions'),
          get().fetchGas('getSkus')
        ]).then(([transResult, skuResult]) => {
          if (transResult.status === 'success') {
            const tData = transResult.data;
            set({ transactions: Array.isArray(tData) ? tData : (tData.rows || []) });
          }
          if (skuResult.status === 'success') {
            set({ skus: skuResult.data });
          }
        }).catch(console.error);
        
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при обновлении операции');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleProcessInvoice: async (feedback = "") => {
    const { rawText, opType, setParsedItems, setShowConfirmModal, aiFeedback } = useUIStore.getState();
    const { geminiModel, geminiKey, customPrompt } = useSettingsStore.getState();
    const { stock, skus } = get();

    if (!rawText.trim()) return;
    
    set({ isProcessing: true });
    try {
      const skuMap = new Map();
      stock.forEach(s => skuMap.set(s.article, { sku: s.article, ozonBarcode: '', wbBarcode: '' }));
      skus.forEach(s => skuMap.set(s.sku, { sku: s.sku, ozonBarcode: s.ozonBarcode || '', wbBarcode: s.wbBarcode || '' }));
      const skuMapping = Array.from(skuMap.values());
      
      const feedbackStr = (typeof feedback === 'string' && feedback) ? feedback : aiFeedback;
      const result = await parseInvoiceWithGemini(rawText, skuMapping, opType, geminiModel, feedbackStr, customPrompt);
      const items = result.items || [];
      const detectedMarketplace = result.detectedMarketplace || 'unknown';
      
      if (!Array.isArray(items) || items.length === 0) {
        toast.error("ИИ не смог распознать товары в этом тексте. Попробуйте другой файл или уточните запрос.");
        return;
      }

      const validated = items.map((item: any) => {
        const stockItem = stock.find(s => s.article === item.article);
        let status: 'ok' | 'unknown' | 'error' = 'ok';
        let errorMsg = '';
        let article = item.article;

        if (opType === 'Приход') {
          if (article === 'UNKNOWN' || !stockItem) {
            status = 'ok';
            errorMsg = 'Новый товар';
          }
        } else {
          if (article === 'UNKNOWN' || !stockItem) {
            status = 'unknown';
            errorMsg = 'Артикул не найден';
          } else {
            item.price = stockItem.avgCost;
            if (stockItem.quantity < item.quantity) {
              status = 'error';
              errorMsg = 'Недостаточно на складе';
            }
          }
        }

        return { ...item, article, status, errorMsg };
      });

      setParsedItems(validated);
      
      const { uploadDestination, setShowMismatchModal, setMismatchData } = useUIStore.getState();
      if (detectedMarketplace !== "unknown" && opType === 'Расход' && detectedMarketplace !== uploadDestination) {
        setMismatchData({ detected: detectedMarketplace, selected: uploadDestination });
        setShowMismatchModal(true);
      } else {
        setShowConfirmModal(true);
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка при обработке Gemini: ' + (e as Error).message);
    } finally {
      set({ isProcessing: false });
    }
  },

  checkSession: async () => {
    const token = localStorage.getItem('sessionToken');
    if (!token) return;
    
    set({ sessionToken: token });
    try {
      const result = await get().fetchGas('verifySession');
      if (result.status === 'success') {
        const normalizedUser = {
          ...result.data,
          role: result.data.role?.trim().toLowerCase()
        };
        set({ currentUser: normalizedUser });
        
        // Fetch global settings
        get().fetchGas('getGlobalSettings').then(res => {
          if (res.status === 'success') {
            useSettingsStore.getState().setGeminiKey(res.data.geminiKey || '');
            const modelStr = res.data.geminiModel || 'gemini-1.5-flash';
            if (modelStr.includes('|order=')) {
              const [model, orderStr] = modelStr.split('|order=');
              useSettingsStore.getState().setGeminiModel(model);
              try {
                useSettingsStore.getState().setServiceOrderIds(JSON.parse(orderStr));
              } catch (e) {}
            } else {
              useSettingsStore.getState().setGeminiModel(modelStr);
            }
          }
        });
      } else {
        localStorage.removeItem('sessionToken');
        set({ sessionToken: null });
      }
    } catch (e) {
      console.error('Session verification failed', e);
    }
  },

  handleLogin: async (username, password) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('login', { username, password });
      if (result.status === 'success') {
        const userData = result.data.user || result.data; // Handle both formats just in case
        const normalizedUser = {
          ...userData,
          role: userData.role?.trim().toLowerCase()
        };
        
        if (result.data.sessionToken) {
          localStorage.setItem('sessionToken', result.data.sessionToken);
        }
        
        set({ 
          currentUser: normalizedUser,
          sessionToken: result.data.sessionToken || null
        });
        
        // Fetch global settings
        get().fetchGas('getGlobalSettings').then(res => {
          if (res.status === 'success') {
            useSettingsStore.getState().setGeminiKey(res.data.geminiKey || '');
            const modelStr = res.data.geminiModel || 'gemini-1.5-flash';
            if (modelStr.includes('|order=')) {
              const [model, orderStr] = modelStr.split('|order=');
              useSettingsStore.getState().setGeminiModel(model);
              try {
                useSettingsStore.getState().setServiceOrderIds(JSON.parse(orderStr));
              } catch (e) {}
            } else {
              useSettingsStore.getState().setGeminiModel(modelStr);
            }
          }
        });
        
        toast.success('Успешный вход');
        return true;
      } else {
        toast.error('Ошибка входа: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при входе');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleLogout: () => {
    const token = get().sessionToken;
    if (token) {
      get().fetchGas('logout').catch(() => {});
    }
    localStorage.removeItem('sessionToken');
    set({ currentUser: null, sessionToken: null, stock: [], transactions: [], skus: [], usersList: [] });
    useUIStore.getState().setActiveTab('dashboard');
  },

  fetchUsersList: async () => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('getUsers');
      if (result.status === 'success') {
        const normalizedUsers = result.data.map((u: User) => ({
          ...u,
          role: u.role?.trim().toLowerCase()
        }));
        set({ usersList: normalizedUsers });
      }
    } catch (e) {
      console.error(e);
    } finally {
      set({ isSyncing: false });
    }
  },

  handleAddUser: async (username, password, role) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('addUser', { data: { username, password, role } });
      if (result.status === 'success') {
        set({ usersList: result.data });
        toast.success('Пользователь добавлен');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при добавлении пользователя');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleDeleteUser: async (username) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('deleteUser', { username });
      if (result.status === 'success') {
        set({ usersList: result.data });
        toast.success('Пользователь удален');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при удалении пользователя');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  fetchArchivedItems: async () => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('getArchivedItems');
      if (result.status === 'success') {
        set({ archivedItems: result.data });
      } else {
        toast.error(result.message || 'Ошибка загрузки архива');
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сервера');
    } finally {
      set({ isSyncing: false });
    }
  },

  handleRestoreArchivedItem: async (archiveId: string) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('restoreArchivedItem', { archiveId });
      if (result.status === 'success') {
        toast.success('Элемент успешно восстановлен');
        await get().fetchStock();
        await get().fetchArchivedItems();
        const isAdmin = get().currentUser?.role?.toLowerCase() === 'admin' || 
          ['admin', 'админ', 'администратор'].includes(get().currentUser?.username?.toLowerCase() || '');
        if (isAdmin) {
          get().fetchUsersList();
        }
        return true;
      } else {
        toast.error(result.message || 'Ошибка восстановления');
        return false;
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка сервера');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleRestoreMultipleArchivedItems: async (archiveIds) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('restoreMultipleArchivedItems', { archiveIds });
      if (result.status === 'success' || result.data?.partial) {
        const payloadData = result.status === 'success' ? result.data : result.data;
        
        if (payloadData.partial && payloadData.message) {
          toast.warning(payloadData.message);
        } else {
          toast.success(`Успешно восстановлено: ${archiveIds.length}`);
        }
        
        await get().fetchStock();
        await get().fetchArchivedItems();
        const isAdmin = get().currentUser?.role?.toLowerCase() === 'admin' || 
          ['admin', 'админ', 'администратор'].includes(get().currentUser?.username?.toLowerCase() || '');
        if (isAdmin) {
          get().fetchUsersList();
        }
        return true;
      } else {
        toast.error(result.message || 'Ошибка восстановления');
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сервера');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleHardDeleteArchivedItems: async (archiveIds) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('hardDeleteArchivedItems', { archiveIds });
      if (result.status === 'success') {
        toast.success(`Удалено из архива безвозвратно: ${archiveIds.length}`);
        set({ archivedItems: result.data });
        return true;
      } else {
        toast.error(result.message || 'Ошибка окончательного удаления');
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сервера');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  }
}));
