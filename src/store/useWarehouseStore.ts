import { create } from 'zustand';
import { StockItem, Transaction, SKUItem, ParsedItem } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { useUIStore } from './useUIStore';
import { parseInvoiceWithGemini } from '../lib/gemini';
import { toast } from 'sonner';

interface WarehouseState {
  stock: StockItem[];
  transactions: Transaction[];
  skus: SKUItem[];
  isSyncing: boolean;
  isProcessing: boolean;
  isAddingSku: boolean;
  
  setStock: (stock: StockItem[]) => void;
  setTransactions: (transactions: Transaction[]) => void;
  setSkus: (skus: SKUItem[]) => void;
  setIsSyncing: (isSyncing: boolean) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  
  fetchGas: (action: string, extraPayload?: any) => Promise<any>;
  fetchStock: () => Promise<void>;
  handleSetupDatabase: () => Promise<boolean>;
  handleSaveSku: (skuForm: SKUItem, editingSku: SKUItem | null) => Promise<boolean>;
  handleDeleteSku: (sku: string) => Promise<boolean>;
  commitTransaction: (items: ParsedItem[], type: string, destination: string) => Promise<boolean>;
  handleDeleteTransaction: (id: string) => Promise<boolean>;
  handleUpdateTransaction: (id: string, data: Transaction) => Promise<boolean>;
  handleProcessInvoice: (feedback?: any) => Promise<void>;
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  stock: [],
  transactions: [],
  skus: [],
  isSyncing: false,
  isProcessing: false,
  isAddingSku: false,

  setStock: (stock) => set({ stock }),
  setTransactions: (transactions) => set({ transactions }),
  setSkus: (skus) => set({ skus }),
  setIsSyncing: (isSyncing) => set({ isSyncing }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),

  fetchGas: async (action, extraPayload = {}) => {
    const { gasUrl, gasToken } = useSettingsStore.getState();
    if (!gasUrl) return { status: 'error', message: 'URL не задан' };
    
    try {
      const response = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: gasToken, ...extraPayload })
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
    const { gasUrl } = useSettingsStore.getState();
    if (!gasUrl) return;
    
    set({ isSyncing: true });
    try {
      const [stockResult, skuResult, transResult] = await Promise.all([
        get().fetchGas('getStock'),
        get().fetchGas('getSkus'),
        get().fetchGas('getTransactions')
      ]);

      if (stockResult.status === 'success') {
        set({ stock: stockResult.data });
      }
      if (skuResult.status === 'success') {
        set({ skus: skuResult.data });
      }
      if (transResult.status === 'success') {
        set({ transactions: transResult.data });
      }
    } catch (error) {
      console.error("Fetch Error:", error);
    } finally {
      set({ isSyncing: false });
    }
  },

  handleSetupDatabase: async () => {
    const { gasUrl } = useSettingsStore.getState();
    if (!gasUrl) {
      toast.error('Пожалуйста, укажите URL Google Apps Script в настройках.');
      return false;
    }
    
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

  commitTransaction: async (items, type, destination) => {
    const { notificationEmail } = useSettingsStore.getState();
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('commit', {
        data: items, 
        type, 
        destination,
        notificationEmail 
      });
      
      if (result.status === 'success') {
        set({ stock: result.data });
        toast.success('Операция успешно записана в Google Таблицу!');
        
        // Fetch transactions in background so UI doesn't block
        get().fetchGas('getTransactions').then(transResult => {
          if (transResult.status === 'success') {
            set({ transactions: transResult.data });
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
        set({ stock: result.data.stock, transactions: result.data.transactions });
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

  handleUpdateTransaction: async (id, data) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('updateTransaction', { id, data });
      if (result.status === 'success') {
        set({ stock: result.data });
        toast.success('Операция обновлена');
        
        // Fetch transactions in background
        get().fetchGas('getTransactions').then(transResult => {
          if (transResult.status === 'success') {
            set({ transactions: transResult.data });
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
    const { geminiKey, geminiModel, customPrompt } = useSettingsStore.getState();
    const { stock, skus } = get();

    if (!rawText.trim()) return;
    
    set({ isProcessing: true });
    try {
      const articleSet = new Set<string>();
      stock.forEach(s => articleSet.add(s.article));
      skus.forEach(s => articleSet.add(s.sku));
      const articles = Array.from(articleSet);
      
      const feedbackStr = (typeof feedback === 'string' && feedback) ? feedback : aiFeedback;
      const result = await parseInvoiceWithGemini(rawText, articles, geminiModel, feedbackStr, geminiKey, customPrompt);
      
      if (!Array.isArray(result) || result.length === 0) {
        toast.error("ИИ не смог распознать товары в этом тексте. Попробуйте другой файл или уточните запрос.");
        return;
      }

      const validated = result.map((item: any) => {
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
      setShowConfirmModal(true);
    } catch (e) {
      console.error(e);
      toast.error('Ошибка при обработке Gemini: ' + (e as Error).message);
    } finally {
      set({ isProcessing: false });
    }
  },
}));
