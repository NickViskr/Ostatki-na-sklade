import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { 
  Database, 
  Loader2,
  Plus,
  Trash2,
  Search,
  ChevronDown,
  Check,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatCurrency } from '../lib/utils';

interface PendingItem {
  article: string;
  quantity: number;
  price: number;
}

export const ManualTab: React.FC = React.memo(() => {
  const stock = useWarehouseStore((state) => state.stock);
  const skus = useWarehouseStore((state) => state.skus);
  const kits = useWarehouseStore((state) => state.kits);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const commitTransaction = useWarehouseStore((state) => state.commitTransaction);
  
  const manualForm = useUIStore((state) => state.manualForm);
  const setManualForm = useUIStore((state) => state.setManualForm);

  const destinations = useSettingsStore((state) => state.destinations);
  const addDestination = useSettingsStore((state) => state.addDestination);

  const [isAddingDest, setIsAddingDest] = useState(false);
  const [newDest, setNewDest] = useState('');
  
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [isArticleDropdownOpen, setIsArticleDropdownOpen] = useState(false);
  const [articleSearch, setArticleSearch] = useState(manualForm.article);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsArticleDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    return Array.from(map.values()).sort((a, b) => a.article.localeCompare(b.article));
  }, [stock, skus]);

  const filteredArticles = useMemo(() => {
    return allArticles.filter(a => a.article.toLowerCase().includes(articleSearch.toLowerCase()));
  }, [allArticles, articleSearch]);

  const handleAddDest = useCallback(() => {
    if (newDest.trim() && !destinations.includes(newDest.trim())) {
      addDestination(newDest.trim());
      setManualForm({ ...manualForm, destination: newDest.trim() });
      setNewDest('');
      setIsAddingDest(false);
    }
  }, [newDest, destinations, addDestination, manualForm, setManualForm]);

  const addPendingItem = useCallback(() => {
    const qty = Number(manualForm.quantity);
    if (!manualForm.article || !qty || qty <= 0) {
      toast.error('Заполните артикул и количество (положительное число)');
      return;
    }
    const cost = Number(manualForm.price) || 0;
    
    setPendingItems(prev => [...prev, {
      article: manualForm.article,
      quantity: qty,
      price: cost
    }]);
    
    setManualForm({
      ...manualForm,
      article: '',
      quantity: '',
      price: ''
    });
    setArticleSearch('');
  }, [manualForm, setManualForm]);

  const handleManualSubmit = useCallback(async () => {
    let itemsToSubmit = [...pendingItems];
    
    // Auto-add current form if completely valid but not added yet
    const isCorrectionType = manualForm.type === 'Корректировка остатка';
    const isValidQty = isCorrectionType
      ? manualForm.quantity !== '' && Number(manualForm.quantity) >= 0
      : Number(manualForm.quantity) > 0;

    if (manualForm.article && isValidQty) {
      itemsToSubmit.push({
        article: manualForm.article,
        quantity: Number(manualForm.quantity),
        price: Number(manualForm.price) || 0
      });
    }

    if (itemsToSubmit.length === 0) {
      toast.error('Добавьте хотя бы одну позицию для сохранения');
      return;
    }

    if (manualForm.type === 'Корректировка остатка') {
      const incomingItems: any[] = [];
      const outgoingItems: any[] = [];

      for (const item of itemsToSubmit) {
        const kit = kits.find(k => k.kitSku === item.article);
        if (kit && kit.type === 'virtual') {
          toast.error('Нельзя корректировать остаток виртуального комплекта «' + item.article + '»: у него нет собственного остатка, корректируйте компоненты');
          return;
        }
        const st = stock.find(s => s.article === item.article);
        const currentQty = st ? Number(st.quantity) : 0;
        const targetQty = Number(item.quantity);
        const delta = targetQty - currentQty;
        const unitCost = st ? Number(st.avgCost) : 0;

        if (delta > 0) {
          incomingItems.push({
            article: item.article,
            quantity: delta,
            price: unitCost,
            status: 'ok' as const,
          });
        } else if (delta < 0) {
          outgoingItems.push({
            article: item.article,
            quantity: Math.abs(delta),
            price: unitCost,
            status: 'ok' as const,
          });
        }
      }

      if (incomingItems.length === 0 && outgoingItems.length === 0) {
        toast.error('Новое количество совпадает с текущим остатком — корректировать нечего');
        return;
      }

      const { destination, deliveryDate } = manualForm;
      const labeledDestination = destination ? `${destination} [Корректировка остатка]` : '[Корректировка остатка]';

      let ok = true;
      if (incomingItems.length > 0) {
        ok = await commitTransaction(incomingItems, 'Приход', labeledDestination, deliveryDate);
      }
      if (ok && outgoingItems.length > 0) {
        ok = await commitTransaction(outgoingItems, 'Расход', labeledDestination, deliveryDate);
      }

      if (ok === true) {
        setPendingItems([]);
        setManualForm({
          ...manualForm,
          article: '',
          quantity: '',
          price: ''
        });
        setArticleSearch('');
      }
      return;
    }

    const { type, destination, deliveryDate } = manualForm;

    // Map custom manual types to standard transaction types understood by the backend
    const typeToStandard: Record<string, 'Приход' | 'Расход' | 'Корректировка'> = {
      'Списание - Брак':        'Расход',
      'Списание - Утеря':       'Расход',
      'Оприходование - Излишки': 'Приход',
      'Корректировка остатка':  'Корректировка',
    };
    const standardType: 'Приход' | 'Расход' | 'Корректировка' =
      typeToStandard[type] ?? (type as 'Приход' | 'Расход' | 'Корректировка');

    // Preserve the original label in destination so it's visible in History
    const labeledDestination = destination ? `${destination} [${type}]` : `[${type}]`;

    const parsedItems = itemsToSubmit.map(item => ({
      ...item,
      status: 'ok' as const,
    }));
    
    const success = await commitTransaction(
      parsedItems,
      standardType,
      labeledDestination,
      deliveryDate
    );
    
    if (success) {
      setPendingItems([]);
      setManualForm({
        ...manualForm,
        article: '',
        quantity: '',
        price: ''
      });
      setArticleSearch('');
    }
  }, [manualForm, commitTransaction, setManualForm, pendingItems, kits, stock]);

  const removePendingItem = (index: number) => {
    setPendingItems(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div 
      key="manual"
      className="max-w-4xl mx-auto space-y-8 tab-enter"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Ручная корректировка</h2>
        <p className="text-slate-500">Списание брака или оприходование излишков</p>
      </div>

      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
        <div className="grid grid-cols-2 gap-6">
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
                  <Check size={18} />
                </button>
                <button 
                  onClick={() => setIsAddingDest(false)}
                  className="px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-300 transition-all"
                >
                  <X size={18} />
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
                  className="px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center justify-center"
                >
                  <Plus size={18} />
                </button>
              </div>
            )}
          </div>
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
        
        <div className="border-t border-slate-100 pt-6">
          <h3 className="text-lg font-bold mb-4">Добавление позиций</h3>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="space-y-2 md:col-span-5 relative" ref={dropdownRef}>
              <label className="text-sm font-bold text-slate-500 uppercase">Артикул</label>
              <div className="relative">
                <input 
                  type="text"
                  placeholder="Поиск или выбор артикула..."
                  value={articleSearch}
                  onChange={(e) => {
                    setArticleSearch(e.target.value);
                    setManualForm({...manualForm, article: e.target.value});
                    setIsArticleDropdownOpen(true);
                  }}
                  onFocus={() => setIsArticleDropdownOpen(true)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <ChevronDown size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>

              {isArticleDropdownOpen && (
                <div className="absolute top-[100%] mt-1 left-0 right-0 max-h-60 overflow-y-auto bg-white border border-slate-200 shadow-xl rounded-xl z-20">
                  {filteredArticles.length > 0 ? (
                    filteredArticles.map(s => (
                      <div 
                        key={s.article}
                        className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 flex justify-between items-center"
                        onClick={() => {
                          setArticleSearch(s.article);
                          setManualForm({...manualForm, article: s.article});
                          setIsArticleDropdownOpen(false);
                        }}
                      >
                        <span className="font-medium">{s.article}</span>
                        <span className="text-xs text-slate-400">{s.quantity} шт</span>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-slate-500 text-sm italic">Артикулы не найдены</div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2 md:col-span-3">
              <label className="text-sm font-bold text-slate-500 uppercase">Количество</label>
              <input 
                type="number"
                min={manualForm.type === 'Корректировка остатка' ? "0" : "1"}
                value={manualForm.quantity}
                onChange={(e) => setManualForm({...manualForm, quantity: e.target.value === '' ? '' : parseInt(e.target.value)})}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {manualForm.type === 'Корректировка остатка' && manualForm.article && (
                <p className="text-xs text-slate-500 mt-1">
                  Текущий остаток: {stock.find(s => s.article === manualForm.article)?.quantity ?? 0} шт. Введите НОВОЕ количество — разница будет проведена автоматически.
                </p>
              )}
            </div>
            
            <div className={`space-y-2 ${manualForm.type.includes('Оприходование') ? 'md:col-span-3' : 'hidden'}`}>
                <label className="text-sm font-bold text-slate-500 uppercase">Цена (₽)</label>
                <input 
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualForm.price}
                  onChange={(e) => setManualForm({...manualForm, price: e.target.value === '' ? '' : parseFloat(e.target.value)})}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="0.00"
                />
            </div>

            <div className={manualForm.type.includes('Оприходование') ? 'md:col-span-1' : 'md:col-span-4'}>
              <button 
                onClick={addPendingItem}
                disabled={!manualForm.article || !manualForm.quantity}
                className="w-full h-[50px] bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                <Plus size={20} />
                <span className="md:hidden">Ещё позиция</span>
              </button>
            </div>
          </div>
        </div>

        {pendingItems.length > 0 && (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden mt-6">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/50 border-b border-slate-200">
                  <th className="px-6 py-3 font-bold text-slate-500 uppercase text-xs">Артикул</th>
                  <th className="px-6 py-3 font-bold text-slate-500 uppercase text-xs text-right">Кол-во</th>
                  <th className="px-6 py-3 font-bold text-slate-500 uppercase text-xs text-right">Цена</th>
                  <th className="px-6 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {pendingItems.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-white transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-900">{item.article}</td>
                    <td className="px-6 py-3 text-right font-medium">{item.quantity} шт</td>
                    <td className="px-6 py-3 text-right font-medium text-slate-500">{formatCurrency(item.price)} ₽</td>
                    <td className="px-6 py-3 text-right">
                      <button 
                        onClick={() => removePendingItem(idx)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button 
          onClick={handleManualSubmit}
          disabled={isProcessing || (pendingItems.length === 0 && (!manualForm.article || !manualForm.quantity))}
          className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold text-lg hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 mt-4"
        >
          {isProcessing ? <Loader2 className="animate-spin" /> : <Database size={20} />}
          Сохранить операции ({pendingItems.length + (manualForm.article && Number(manualForm.quantity) > 0 ? 1 : 0)})
        </button>
      </div>
    </div>
  );
});
