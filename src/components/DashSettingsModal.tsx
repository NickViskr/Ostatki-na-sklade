import React, { useMemo } from 'react';
import { X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '../store/useUIStore';
import { useWarehouseStore } from '../store/useWarehouseStore';

export const DashSettingsModal: React.FC = () => {
  const showDashSettingsModal = useUIStore((state) => state.showDashSettingsModal);
  const setShowDashSettingsModal = useUIStore((state) => state.setShowDashSettingsModal);
  const dashSelectedSkus = useUIStore((state) => state.dashTableSelectedSkus);
  const setDashSelectedSkus = useUIStore((state) => state.setDashTableSelectedSkus);
  const dashTurnoverDays = useUIStore((state) => state.dashTurnoverDays);
  const setDashTurnoverDays = useUIStore((state) => state.setDashTurnoverDays);
  
  const skus = useWarehouseStore((state) => state.skus);
  const stock = useWarehouseStore((state) => state.stock);
  
  const uniqueSkus = useMemo(() => {
    return Array.from(new Set([
      ...skus.map(s => s.sku),
      ...stock.map(s => s.article)
    ])).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [skus, stock]);

  const handleToggleSku = (sku: string) => {
    if (dashSelectedSkus.includes(sku)) {
      setDashSelectedSkus(dashSelectedSkus.filter(s => s !== sku));
    } else {
      setDashSelectedSkus([...dashSelectedSkus, sku]);
    }
  };

  const handleSelectAll = () => {
    if (dashSelectedSkus.length === uniqueSkus.length) {
      setDashSelectedSkus([]);
    } else {
      setDashSelectedSkus(uniqueSkus);
    }
  };

  if (!showDashSettingsModal) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]"
        >
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-bold text-slate-900">Настройки дашборда</h3>
            <button 
              onClick={() => setShowDashSettingsModal(false)}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Период для расчета оборачиваемости (дней)
              </label>
              <input 
                type="number" 
                value={dashTurnoverDays}
                onChange={(e) => setDashTurnoverDays(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                min="1"
              />
              <p className="text-xs text-slate-500 mt-2">
                Укажите количество дней, за которое система будет анализировать продажи для расчета оборачиваемости.
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-bold text-slate-700">
                  Выбор SKU для расчета
                </label>
                <button 
                  onClick={handleSelectAll}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  {dashSelectedSkus.length === uniqueSkus.length && uniqueSkus.length > 0 ? 'Снять все' : 'Выбрать все'}
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Если ничего не выбрано, расчет производится по всем товарам.
              </p>
              
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                {uniqueSkus.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-500 italic">
                    Список SKU пуст
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {uniqueSkus.map((sku) => (
                      <div 
                        key={sku} 
                        onClick={() => handleToggleSku(sku)}
                        className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${dashSelectedSkus.includes(sku) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                          {dashSelectedSkus.includes(sku) && <Check size={14} strokeWidth={3} />}
                        </div>
                        <span className="text-sm font-medium text-slate-700">{sku}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end">
            <button 
              onClick={() => setShowDashSettingsModal(false)}
              className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
            >
              Применить
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
