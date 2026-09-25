/**
 * Item 81b: the state of the module «Заказы в Китае».
 *
 * A store of its own, because the module is autonomous: it keeps its data in its own
 * spreadsheet and shares nothing with the warehouse yet. Every write answers with the whole
 * state the script holds, so the screen never has to guess what a write did — and never
 * computes money of its own.
 */

import { create } from 'zustand';
import { toast } from 'sonner';
import { ChinaBatch, ChinaForecastData, ChinaForecastResult, ChinaMoney, ChinaPayment } from '../types';
import { useWarehouseStore } from './useWarehouseStore';

interface ChinaAnswer {
  status: string;
  message?: string;
  data?: {
    batches?: ChinaBatch[];
    payments?: ChinaPayment[];
    settings?: Record<string, number | string>;
    warnings?: string[];
    /** Owner, 2026-09-25: every China write now folds the same picture `getChinaMoney` answers
     * with into its own answer (server-side, ChinaOrders.gs), so the browser can skip the extra
     * ~6 s request that used to follow every save. */
    money?: ChinaMoney;
  } & Partial<ChinaMoney> & Partial<ChinaForecastData> & Partial<ChinaForecastResult>;
}

interface ChinaState {
  batches: ChinaBatch[];
  payments: ChinaPayment[];
  settings: Record<string, number | string>;
  /** Item 81g: the picture `getChinaMoney` answers with — payments, receipts and orders of the
   * financial report, kept apart from `batches` because the payments card reads it, not them. */
  money: ChinaMoney | null;
  /** Item 82: tariff history, box directory and saved forecasts — `getChinaForecastData`'s own
   * state, kept apart from `batches`/`money` the same way `money` is. */
  forecastData: ChinaForecastData | null;
  /** Item 82: quantities the warehouse screen «Заказ на фабрике» pushes in, for the forecast
   * form to pick up when the owner opens the tab — null until something pushes it, cleared by
   * the form itself once read. */
  forecastPrefill: { article: string; pieces: number }[] | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Empty until the first answer arrives, so an empty list is not shown as «нет партий». */
  loaded: boolean;
  /** The last refusal of the script, shown on the tab itself and not only in a toast. */
  error: string;
  fetchChinaBatches: () => Promise<void>;
  fetchChinaMoney: () => Promise<void>;
  setupChinaSpreadsheet: () => Promise<boolean>;
  saveChinaBatch: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaBatch: (id: string) => Promise<boolean>;
  saveChinaCost: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaCost: (id: string) => Promise<boolean>;
  saveChinaPayment: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaPayment: (id: string) => Promise<boolean>;
  /** Item 81g: the financial report, parsed in the browser and grouped by `chinaReportPayload`. */
  saveChinaReport: (payload: Record<string, unknown>) => Promise<string[] | null>;
  matchChinaPayment: (paymentId: string, receiptId: string) => Promise<boolean>;
  unmatchChinaPayment: (paymentId: string) => Promise<boolean>;
  /** Item 89: an owner's manual mark that a receipt still «ждёт оплату» is actually old — no rate
   * is missing, it just predates tracking, exactly like a receipt the report itself calls
   * 'история'. `history: false` undoes the mark. */
  setChinaReceiptHistory: (receiptId: string, history: boolean) => Promise<boolean>;
  setChinaRubCostsDone: (batchId: string, done: boolean) => Promise<boolean>;
  /** Item 82: reads the tariff history, box directory and saved forecasts in one call. */
  fetchChinaForecastData: () => Promise<void>;
  /** Item 82: a pure read+compute, no write — the result is not stored on its own, the caller
   * (the forecast form) holds it until it saves. */
  calcChinaForecast: (lines: { article: string; pieces: number }[]) => Promise<ChinaForecastResult | null>;
  saveChinaForecast: (payload: { id?: string; orderNo: string; comment?: string; expectedShipAt?: string; lines: { article: string; pieces: number }[] }) => Promise<boolean>;
  deleteChinaForecast: (id: string) => Promise<boolean>;
  setForecastPrefill: (lines: { article: string; pieces: number }[] | null) => void;
  /** Item 83i: the manual/first-run sync button — reconciles «Заказы на фабрике» and reports
   * the pipeline qty per article before/after. */
  syncChinaFactoryOrders: () => Promise<{ added: number; updated: number; removed: number; before: Record<string, number>; after: Record<string, number> } | null>;
  /** Item 84 (stage 2): posts an arrived batch onto «Мой склад» at a provisional cost. `opId` is
   * generated ONCE per confirmation window, by the caller, so a double click cannot post twice. */
  postChinaBatch: (payload: { id: string; opId: string; lines: { article: string; qty: number }[] }) => Promise<boolean>;
  /** Item 84 (stage 2): admin-only rollback of a posting — removes its receipts/corrections. */
  cancelChinaBatchPosting: (id: string) => Promise<boolean>;
}

const callChina = async (action: string, data?: Record<string, unknown>): Promise<ChinaAnswer> => {
  const fetchGas = useWarehouseStore.getState().fetchGas;
  return await fetchGas(action, data === undefined ? {} : { data }) as ChinaAnswer;
};

export const useChinaStore = create<ChinaState>()((set, get) => ({
  batches: [],
  payments: [],
  settings: {},
  money: null,
  forecastData: null,
  forecastPrefill: null,
  isLoading: false,
  isSaving: false,
  loaded: false,
  error: '',

  fetchChinaBatches: async () => {
    if (!useWarehouseStore.getState().sessionToken) return;
    set({ isLoading: true });
    const result = await callChina('getChinaBatches');
    if (result.status === 'success' && result.data) {
      set({
        batches: result.data.batches || [],
        payments: result.data.payments || [],
        settings: result.data.settings || {},
        loaded: true,
        error: '',
        isLoading: false
      });
      return;
    }
    set({ isLoading: false, loaded: true, error: result.message || 'Не удалось прочитать заказы в Китае' });
  },

  // Item 81g: the payments card reads this, not `batches` — the two are refreshed together
  // after every write, so a payment matched against a receipt is reflected in both at once.
  fetchChinaMoney: async () => {
    if (!useWarehouseStore.getState().sessionToken) return;
    const result = await callChina('getChinaMoney');
    if (result.status === 'success' && result.data) {
      set({ money: result.data as ChinaMoney });
      return;
    }
    toast.error(result.message || 'Не удалось прочитать оплаты китайцам');
  },

  setupChinaSpreadsheet: async () => {
    set({ isSaving: true });
    const result = await callChina('setupChinaSpreadsheet');
    set({ isSaving: false });
    if (result.status !== 'success') {
      set({ error: result.message || 'Не удалось настроить таблицу' });
      toast.error(result.message || 'Не удалось настроить таблицу');
      return false;
    }
    toast.success('Таблица «Заказы в Китае» настроена');
    void get().fetchChinaBatches().catch(() => {});
    return true;
  },

  saveChinaBatch: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaBatch', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить партию');
      return false;
    }
    set({ batches: result.data.batches || [], payments: result.data.payments || get().payments,
      settings: result.data.settings || get().settings, loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money });
    toast.success('Партия сохранена, себестоимость пересчитана');
    // Item 84/owner 2026-09-25: the save's own answer already carries the money picture, so
    // only «Заказы на фабрике» still needs a background refresh (syncChinaFactoryOrders on the
    // server may have changed it) — the owner watches the modal close right after the save
    // answers, not after another request.
    if (!result.data.money) void get().fetchChinaMoney().catch(() => {});
    void useWarehouseStore.getState().fetchFactoryOrders().catch(() => {});
    return true;
  },

  saveChinaPayment: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaPayment', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить оплату');
      return false;
    }
    set({ batches: result.data.batches || [], payments: result.data.payments || [], loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Оплата учтена, курс партий пересчитан');
    return true;
  },

  deleteChinaPayment: async (id) => {
    set({ isSaving: true });
    const result = await callChina('deleteChinaPayment', { id });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось удалить оплату');
      return false;
    }
    set({ batches: result.data.batches || [], payments: result.data.payments || [], loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Оплата удалена, курс партий пересчитан');
    return true;
  },

  deleteChinaBatch: async (id) => {
    set({ isSaving: true });
    const result = await callChina('deleteChinaBatch', { id });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось удалить партию');
      return false;
    }
    set({ batches: result.data.batches || [], loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money });
    toast.success('Партия удалена');
    // Item 84/owner 2026-09-25: same reasoning as saveChinaBatch above — money comes with the
    // answer, «Заказы на фабрике» still needs its own background refresh.
    if (!result.data.money) void get().fetchChinaMoney().catch(() => {});
    void useWarehouseStore.getState().fetchFactoryOrders().catch(() => {});
    return true;
  },

  saveChinaCost: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaBatchCost', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить расход');
      return false;
    }
    set({ batches: result.data.batches || [], loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Расход учтён в себестоимости партии');
    return true;
  },

  deleteChinaCost: async (id) => {
    set({ isSaving: true });
    const result = await callChina('deleteChinaBatchCost', { id });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось удалить расход');
      return false;
    }
    set({ batches: result.data.batches || [], loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Расход удалён, себестоимость пересчитана');
    return true;
  },

  // Item 81g: a report file alone is a valid import — nothing about money is computed in the
  // browser, `chinaReportPayload` only groups what the parser already read. The server's own
  // warnings (about payments it could not place, say) are handed back for a toast.
  saveChinaReport: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaReport', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить отчёт');
      return null;
    }
    set({ batches: result.data.batches || get().batches, loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Отчёт загружен, партии пересчитаны');
    return result.data.warnings || [];
  },

  matchChinaPayment: async (paymentId, receiptId) => {
    set({ isSaving: true });
    const result = await callChina('matchChinaPayment', { paymentId, receiptId });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сопоставить оплату');
      return false;
    }
    set({ batches: result.data.batches || get().batches, payments: result.data.payments || get().payments });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Оплата сопоставлена с поступлением из отчёта');
    return true;
  },

  unmatchChinaPayment: async (paymentId) => {
    set({ isSaving: true });
    const result = await callChina('unmatchChinaPayment', { paymentId });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось отменить сопоставление');
      return false;
    }
    set({ batches: result.data.batches || get().batches, payments: result.data.payments || get().payments });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Сопоставление отменено');
    return true;
  },

  setChinaReceiptHistory: async (receiptId, history) => {
    set({ isSaving: true });
    const result = await callChina('setChinaReceiptHistory', { receiptId, history });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось отметить поступление');
      return false;
    }
    set({ batches: result.data.batches || get().batches, payments: result.data.payments || get().payments });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success(history ? 'Поступление отмечено историей' : 'Поступление возвращено из истории');
    return true;
  },

  setChinaRubCostsDone: async (batchId, done) => {
    set({ isSaving: true });
    const result = await callChina('setChinaRubCostsDone', { batchId, done });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось отметить расходы в РФ');
      return false;
    }
    set({ batches: result.data.batches || get().batches, loaded: true, error: '' });
    return true;
  },

  fetchChinaForecastData: async () => {
    if (!useWarehouseStore.getState().sessionToken) return;
    const result = await callChina('getChinaForecastData');
    if (result.status === 'success' && result.data) {
      set({ forecastData: result.data as ChinaForecastData });
      return;
    }
    toast.error(result.message || 'Не удалось прочитать прогнозы поставок из Китая');
  },

  calcChinaForecast: async (lines) => {
    const result = await callChina('calcChinaForecast', { lines });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось посчитать прогноз');
      return null;
    }
    return result.data as ChinaForecastResult;
  },

  saveChinaForecast: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaForecast', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить прогноз');
      return false;
    }
    set({ forecastData: result.data as ChinaForecastData });
    toast.success('Прогноз сохранён');
    // Item 83c: a forecast with an order number and expectedShipAt may add/remove rows of
    // «Заказы на фабрике» (syncChinaFactoryOrders on the server).
    void useWarehouseStore.getState().fetchFactoryOrders().catch(() => {});
    return true;
  },

  deleteChinaForecast: async (id) => {
    set({ isSaving: true });
    const result = await callChina('deleteChinaForecast', { id });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось удалить прогноз');
      return false;
    }
    set({ forecastData: result.data as ChinaForecastData });
    toast.success('Прогноз удалён');
    void useWarehouseStore.getState().fetchFactoryOrders().catch(() => {});
    return true;
  },

  setForecastPrefill: (lines) => set({ forecastPrefill: lines }),

  syncChinaFactoryOrders: async () => {
    set({ isSaving: true });
    const result = await callChina('syncChinaFactoryOrders');
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось синхронизировать заказы на фабрике');
      return null;
    }
    const data = result.data as unknown as { summary: { added: number; updated: number; removed: number }; before: Record<string, number>; after: Record<string, number> };
    toast.success(`Заказы на фабрике синхронизированы: добавлено ${data.summary.added}, обновлено ${data.summary.updated}, удалено ${data.summary.removed}`);
    void useWarehouseStore.getState().fetchFactoryOrders().catch(() => {});
    return { ...data.summary, before: data.before, after: data.after };
  },

  postChinaBatch: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('postChinaBatch', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось оприходовать партию');
      return false;
    }
    set({ batches: result.data.batches || get().batches, loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Партия оприходована на склад по предварительной цене');
    // Item 84 (stage 2): a posting moves stock and transactions of the MAIN spreadsheet and
    // the batch's row of «Заказы на фабрике» (it becomes 'received') — not awaited, same
    // pattern as the other China writes above.
    void useWarehouseStore.getState().fetchStock().catch(() => {});
    void useWarehouseStore.getState().fetchFactoryOrders().catch(() => {});
    return true;
  },

  cancelChinaBatchPosting: async (id) => {
    set({ isSaving: true });
    const result = await callChina('cancelChinaBatchPosting', { id });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось отменить оприходование');
      return false;
    }
    set({ batches: result.data.batches || get().batches, loaded: true, error: '' });
    if (result.data.money) set({ money: result.data.money }); else void get().fetchChinaMoney().catch(() => {});
    toast.success('Оприходование отменено, товар возвращён в заказ');
    void useWarehouseStore.getState().fetchStock().catch(() => {});
    void useWarehouseStore.getState().fetchFactoryOrders().catch(() => {});
    return true;
  }
}));
