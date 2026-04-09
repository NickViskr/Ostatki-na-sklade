import React, { useMemo, useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Calendar, 
  Filter, 
  Trash2, 
  Edit3,
  MapPin,
  ChevronDown,
  Check
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';

export const HistoryTab: React.FC = () => {
  const transactions = useWarehouseStore((state) => state.transactions);
  const skus = useWarehouseStore((state) => state.skus);
  const handleDeleteTransaction = useWarehouseStore((state) => state.handleDeleteTransaction);
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const histSelectedSkus = useUIStore((state) => state.histSelectedSkus);
  const setHistSelectedSkus = useUIStore((state) => state.setHistSelectedSkus);
  const histTypeFilter = useUIStore((state) => state.histTypeFilter);
  const setHistTypeFilter = useUIStore((state) => state.setHistTypeFilter);
  const histStartDate = useUIStore((state) => state.histStartDate);
  const setHistStartDate = useUIStore((state) => state.setHistStartDate);
  const histEndDate = useUIStore((state) => state.histEndDate);
  const setHistEndDate = useUIStore((state) => state.setHistEndDate);
  const histDestFilter = useUIStore((state) => state.histDestFilter);
  const setHistDestFilter = useUIStore((state) => state.setHistDestFilter);
  const setEditingTrans = useUIStore((state) => state.setEditingTrans);
  const setShowEditTransModal = useUIStore((state) => state.setShowEditTransModal);

  const destinations = useSettingsStore((state) => state.destinations);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    if (dateStr.includes('.')) return dateStr.split(',')[0].trim().replace(/\./g, '-');
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
    return dateStr.split('T')[0];
  };

  const filteredHistory = useMemo(() => {
    return transactions.filter(t => {
      const matchesSku = histSelectedSkus.length === 0 || histSelectedSkus.includes(t.article);
      const matchesType = histTypeFilter === 'all' || t.type === histTypeFilter;
      
      let matchesDate = true;
      if (histStartDate || histEndDate) {
        const tDate = new Date(t.date);
        if (histStartDate) {
          const sDate = new Date(histStartDate);
          sDate.setHours(0, 0, 0, 0);
          if (tDate < sDate) matchesDate = false;
        }
        if (histEndDate) {
          const eDate = new Date(histEndDate);
          eDate.setHours(23, 59, 59, 999);
          if (tDate > eDate) matchesDate = false;
        }
      }
      
      const matchesDest = histDestFilter === 'all' || t.destination === histDestFilter;

      return matchesSku && matchesType && matchesDate && matchesDest;
    });
  }, [transactions, histSelectedSkus, histTypeFilter, histStartDate, histEndDate, histDestFilter]);

  return (
    <motion.div 
      key="history"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold">История операций</h2>
          <p className="text-slate-500">Все движения товаров по складу</p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative" ref={dropdownRef}>
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="w-full flex items-center justify-between px-4 py-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-left"
          >
            <span className="truncate text-slate-700 text-sm">
              {histSelectedSkus.length === 0 
                ? 'Все артикулы' 
                : `Выбрано: ${histSelectedSkus.length}`}
            </span>
            <ChevronDown size={18} className="text-slate-400 flex-shrink-0" />
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto py-2">
              {skus.length === 0 ? (
                <div className="px-4 py-2 text-sm text-slate-500 italic text-center">Нет доступных артикулов</div>
              ) : (
                skus.map(sku => (
                  <div 
                    key={sku.sku}
                    onClick={() => {
                      if (histSelectedSkus.includes(sku.sku)) {
                        setHistSelectedSkus(histSelectedSkus.filter(s => s !== sku.sku));
                      } else {
                        setHistSelectedSkus([...histSelectedSkus, sku.sku]);
                      }
                    }}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${histSelectedSkus.includes(sku.sku) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                      {histSelectedSkus.includes(sku.sku) && <Check size={12} strokeWidth={3} />}
                    </div>
                    <span className="text-sm font-medium text-slate-700 truncate">{sku.sku}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        
        <div className="relative">
          <select 
            value={histTypeFilter}
            onChange={(e) => setHistTypeFilter(e.target.value as any)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
          >
            <option value="all">Все типы</option>
            <option value="Приход">Приход</option>
            <option value="Расход">Расход</option>
          </select>
          <Filter className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>

        <div className="relative">
          <select 
            value={histDestFilter}
            onChange={(e) => setHistDestFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
          >
            <option value="all">Все объекты</option>
            {destinations.map((dest, idx) => (
              <option key={idx} value={dest}>{dest}</option>
            ))}
          </select>
          <MapPin className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>

        <div className="relative">
          <input 
            type="date"
            value={histStartDate}
            onChange={(e) => setHistStartDate(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
            title="Начальная дата"
          />
          <Calendar className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>

        <div className="relative">
          <input 
            type="date"
            value={histEndDate}
            onChange={(e) => setHistEndDate(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
            title="Конечная дата"
          />
          <Calendar className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-200">
              <th className="px-6 py-4 font-semibold text-slate-600">Дата</th>
              <th className="px-6 py-4 font-semibold text-slate-600">Тип</th>
              <th className="px-6 py-4 font-semibold text-slate-600">Артикул</th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right">Кол-во</th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right">Сумма</th>
              <th className="px-6 py-4 font-semibold text-slate-600">Объект</th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.slice(0, 100).map((t, index) => (
              <tr key={`${t.id}-${index}`} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                  {formatDate(t.date)}
                </td>
                <td className="px-6 py-4">
                  <span className={`flex items-center gap-1 w-fit px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    t.type === 'Приход' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                  }`}>
                    {t.type}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm font-bold text-indigo-600 font-mono">{t.article}</div>
                </td>
                <td className="px-6 py-4 text-right font-bold whitespace-nowrap">{t.quantity}</td>
                <td className="px-6 py-4 text-right font-bold text-slate-900 whitespace-nowrap">
                  {t.type === 'Приход' ? t.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : t.writeOffCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽
                </td>
                <td className="px-6 py-4 text-xs text-slate-500 max-w-[200px] truncate">{t.destination}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => {
                        setEditingTrans(t);
                        setShowEditTransModal(true);
                      }}
                      className="p-2 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-lg transition-all"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button 
                      onClick={() => handleDeleteTransaction(t.id)}
                      className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredHistory.length === 0 && (
          <div className="p-20 text-center">
            <Calendar className="mx-auto text-slate-200 mb-4" size={48} />
            <p className="text-slate-400 font-medium">История пуста</p>
          </div>
        )}
        
        {filteredHistory.length > 100 && (
          <div className="p-4 text-center border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Показаны первые 100 из {filteredHistory.length} операций
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
};
