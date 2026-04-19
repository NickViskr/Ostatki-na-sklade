import React, { useState, useMemo } from 'react';
import { 
  Database, 
  Loader2,
  Plus
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';

export const ManualTab: React.FC = () => {
  const stock = useWarehouseStore((state) => state.stock);
  const skus = useWarehouseStore((state) => state.skus);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const commitTransaction = useWarehouseStore((state) => state.commitTransaction);
  
  const manualForm = useUIStore((state) => state.manualForm);
  const setManualForm = useUIStore((state) => state.setManualForm);

  const destinations = useSettingsStore((state) => state.destinations);
  const addDestination = useSettingsStore((state) => state.addDestination);

  const [isAddingDest, setIsAddingDest] = useState(false);
  const [newDest, setNewDest] = useState('');

  const allArticles = useMemo(() => {
    const map = new Map();
    stock.forEach(s => {
      map.set(s.article, {
        article: s.article,
        quantity: s.quantity,
        avgCost: s.avgCost
      });
    });
    skus.forEach(s => {
      if (!map.has(s.sku)) {
        map.set(s.sku, {
          article: s.sku,
          quantity: 0,
          avgCost: 0
        });
      }
    });
    return Array.from(map.values());
  }, [stock, skus]);

  const handleAddDest = () => {
    if (newDest.trim()) {
      addDestination(newDest.trim());
      setManualForm({...manualForm, destination: newDest.trim()});
      setNewDest('');
      setIsAddingDest(false);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualForm.article || !manualForm.quantity) return;
    const item = allArticles.find(s => s.article === manualForm.article);
    if (!item) return;

    const opType = manualForm.type.includes('Списание') ? 'Расход' : 'Приход';
    const finalPrice = opType === 'Приход' ? manualForm.price : item.avgCost;

    const success = await commitTransaction([{
      article: item.article,
      quantity: Number(manualForm.quantity) || 0,
      price: Number(finalPrice) || 0,
      status: 'ok'
    }], opType, manualForm.destination || manualForm.type, manualForm.deliveryDate);

    if (success) {
      setManualForm({
        ...manualForm,
        article: '',
        quantity: '',
        price: '',
        deliveryDate: ''
      });
    }
  };

  return (
    <motion.div 
      key="manual"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-2xl mx-auto space-y-8"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Ручная корректировка</h2>
        <p className="text-slate-500">Списание брака или оприходование излишков</p>
      </div>

      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase">Артикул</label>
            <select 
              value={manualForm.article}
              onChange={(e) => setManualForm({...manualForm, article: e.target.value})}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none"
            >
              <option value="">Выберите товар...</option>
              {allArticles.map((s, index) => (
                <option key={`${s.article}-${index}`} value={s.article}>
                  {s.article} ({s.quantity} шт)
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase">Тип</label>
            <select 
              value={manualForm.type}
              onChange={(e) => setManualForm({...manualForm, type: e.target.value})}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none"
            >
              <option value="Списание - Брак">Списание - Брак</option>
              <option value="Списание - Утеря">Списание - Утеря</option>
              <option value="Оприходование - Излишки">Оприходование - Излишки</option>
              <option value="Корректировка остатка">Корректировка остатка</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase">Количество</label>
            <input 
              type="number"
              value={manualForm.quantity}
              onChange={(e) => setManualForm({...manualForm, quantity: e.target.value === '' ? '' : parseInt(e.target.value)})}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none"
            />
          </div>
          
          {manualForm.type.includes('Оприходование') && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase">Цена за единицу (₽)</label>
              <input 
                type="number"
                value={manualForm.price}
                onChange={(e) => setManualForm({...manualForm, price: e.target.value === '' ? '' : parseFloat(e.target.value)})}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none"
                placeholder="0.00"
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-500 uppercase">Объект (откуда / куда)</label>
          {isAddingDest ? (
            <div className="flex gap-2">
              <input 
                type="text"
                value={newDest}
                onChange={(e) => setNewDest(e.target.value)}
                placeholder="Введите название объекта..."
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
              <button 
                onClick={handleAddDest}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
              >
                Сохранить
              </button>
              <button 
                onClick={() => setIsAddingDest(false)}
                className="px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-300 transition-all"
              >
                Отмена
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select 
                value={manualForm.destination}
                onChange={(e) => setManualForm({...manualForm, destination: e.target.value})}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {destinations.map((dest, idx) => (
                  <option key={idx} value={dest}>{dest}</option>
                ))}
              </select>
              <button 
                onClick={() => setIsAddingDest(true)}
                className="px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center gap-2"
              >
                <Plus size={18} /> Добавить
              </button>
            </div>
          )}
        </div>

        {manualForm.type.includes('Списание') && (
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase">Дата поставки на маркетплейс</label>
            <input 
              type="date"
              value={manualForm.deliveryDate}
              onChange={(e) => setManualForm({...manualForm, deliveryDate: e.target.value})}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        <button 
          onClick={handleManualSubmit}
          disabled={isProcessing || !manualForm.article || !manualForm.quantity}
          className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {isProcessing ? <Loader2 className="animate-spin" /> : <Database size={20} />}
          Применить корректировку
        </button>
      </div>
    </motion.div>
  );
};
