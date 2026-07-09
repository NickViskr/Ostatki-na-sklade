import React, { useEffect, useState, useMemo } from 'react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ExternalShipment } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Package, 
  RefreshCw, 
  Loader2, 
  ChevronDown, 
  ChevronUp, 
  Calendar,
  AlertCircle
} from 'lucide-react';
import { STATUS_DICT, getStatusDetails, getStatusLabel } from '../lib/ozonStatus';


const formatStatusDate = (dateStr?: string) => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
};

const renderItemsTable = (itemsJSON?: string) => {
  if (!itemsJSON) {
    return <div className="text-slate-400 p-2 text-sm font-medium">Состав не загружен</div>;
  }
  try {
    const items = JSON.parse(itemsJSON);
    if (!Array.isArray(items) || items.length === 0) {
      return <div className="text-slate-400 p-2 text-sm font-medium">Состав не загружен</div>;
    }
    return (
      <div className="overflow-x-auto mt-2 border border-slate-100 rounded-xl">
        <table className="min-w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Артикул</th>
              <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Штрихкод</th>
              <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, index: number) => (
              <tr key={index} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-2 font-semibold text-slate-700">{it.offerId || it.offer_id || '-'}</td>
                <td className="px-4 py-2 font-mono text-slate-500">{it.barcode || '-'}</td>
                <td className="px-4 py-2 font-bold text-slate-900">{it.quantity || it.qty || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } catch (e) {
    return <div className="text-slate-400 p-2 text-sm font-medium">Состав не загружен</div>;
  }
};

export const OzonSuppliesTab: React.FC = React.memo(() => {
  const fetchExternalShipments = useWarehouseStore((state) => state.fetchExternalShipments);
  const externalShipments = useWarehouseStore((state) => state.externalShipments);
  const checkOzonShipments = useWarehouseStore((state) => state.checkOzonShipments);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);

  const [isLoading, setIsLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedPostings, setExpandedPostings] = useState<Set<string>>(new Set());

  useEffect(() => {
    setIsLoading(true);
    fetchExternalShipments().finally(() => {
      setIsLoading(false);
    });
  }, [fetchExternalShipments]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const togglePosting = (postingId: string) => {
    setExpandedPostings(prev => {
      const next = new Set(prev);
      if (next.has(postingId)) {
        next.delete(postingId);
      } else {
        next.add(postingId);
      }
      return next;
    });
  };

  const groupedShipments = useMemo(() => {
    const groupsMap = new Map<string, ExternalShipment[]>();
    
    externalShipments.forEach((s) => {
      let key = '';
      if (s.orderId && s.orderId.trim()) {
        key = `orderId_${s.orderId.trim()}`;
      } else if (s.orderNumber && s.orderNumber.trim()) {
        key = `orderNumber_${s.orderNumber.trim()}`;
      } else {
        key = `postingId_${s.postingId}`;
      }
      
      if (!groupsMap.has(key)) {
        groupsMap.set(key, []);
      }
      groupsMap.get(key)!.push(s);
    });

    return Array.from(groupsMap.entries()).map(([key, items]) => {
      const firstItem = items[0];
      const orderNumber = firstItem.orderNumber || '';
      const orderId = firstItem.orderId || '';
      const label = orderNumber || orderId || firstItem.postingId;
      
      return {
        id: key,
        label,
        items,
        postingCount: items.length,
        shipmentDate: firstItem.shipmentDate || '-',
        cabinet: (firstItem.cabinet || '').trim(),
      };
    });
  }, [externalShipments]);

  const sortedGroups = useMemo(() => {
    const getLatestStatusDate = (group: ExternalShipment[]) => {
      let latestTime = 0;
      let hasValidDate = false;
      
      group.forEach((s) => {
        if (s.ozonStatusDate) {
          const time = new Date(s.ozonStatusDate).getTime();
          if (!isNaN(time)) {
            if (time > latestTime) {
              latestTime = time;
              hasValidDate = true;
            }
          }
        }
      });
      
      return { time: latestTime, hasValidDate };
    };

    return [...groupedShipments].sort((gA, gB) => {
      const a = getLatestStatusDate(gA.items);
      const b = getLatestStatusDate(gB.items);
      
      if (a.hasValidDate && b.hasValidDate) {
        return b.time - a.time;
      }
      if (a.hasValidDate) return -1;
      if (b.hasValidDate) return 1;
      return 0;
    });
  }, [groupedShipments]);

  const getStatusSummary = (group: ExternalShipment[]) => {
    const statusCounts: Record<string, number> = {};
    group.forEach(s => {
      const statusLabel = getStatusLabel(s.ozonStatus);
      statusCounts[statusLabel] = (statusCounts[statusLabel] || 0) + 1;
    });
    
    return Object.entries(statusCounts)
      .map(([status, count]) => `${count} × ${status}`)
      .join(', ');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 tab-enter">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Поставки Ozon</h2>
          <p className="text-slate-500 font-medium">Список заявок на поставку Ozon</p>
        </div>
        <button
          onClick={() => checkOzonShipments()}
          disabled={isProcessing}
          className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 disabled:opacity-50 transition-all font-bold shadow-lg shadow-indigo-200"
        >
          {isProcessing ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <RefreshCw size={18} />
          )}
          Синхронизировать с Ozon
        </button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Loader2 size={40} className="animate-spin text-indigo-600 mb-4" />
          <p className="font-semibold">Загрузка заявок Ozon...</p>
        </div>
      ) : sortedGroups.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-12 text-center text-slate-500">
          <Package size={48} className="mx-auto mb-4 opacity-20 text-indigo-600" />
          <p className="text-lg font-medium">Нет заявок на поставку Ozon</p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            Нажмите кнопку «Синхронизировать с Ozon», чтобы запросить актуальные поставки из Ozon API.
          </p>
        </div>
      ) : (
        /* Groups List */
        <div className="space-y-4">
          {sortedGroups.map((group) => {
            const isGroupExpanded = expandedGroups.has(group.id);
            return (
              <div key={group.id} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300">
                <div 
                  onClick={() => toggleGroup(group.id)}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-lg">Заявка № {group.label}</h3>
                      {group.cabinet && (
                        <span className="text-xs font-semibold px-2.5 py-1 bg-sky-50 text-sky-700 rounded-full">
                          {group.cabinet}
                        </span>
                      )}
                      <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full">
                        Поставок в группе: {group.postingCount}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500 font-medium flex items-center gap-1.5">
                      <Calendar size={14} className="text-slate-400" />
                      Дата отгрузки: {group.shipmentDate}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between sm:justify-end gap-6 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Сводка статусов</div>
                      <div className="text-sm font-semibold text-slate-700 mt-0.5">
                        {getStatusSummary(group.items)}
                      </div>
                    </div>
                    <div className="text-slate-400 bg-slate-50 hover:bg-slate-100 p-2 rounded-xl transition-colors">
                      {isGroupExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isGroupExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-slate-100 bg-slate-50/30 overflow-hidden"
                    >
                      <div className="p-5 space-y-4">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Поставки в рамках заявки</div>
                        
                        {group.items.map((s) => {
                          const statusDetails = getStatusDetails(s.ozonStatus);
                          const isPostingExpanded = expandedPostings.has(s.postingId);
                          return (
                            <div key={s.postingId} className="border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePosting(s.postingId);
                                }}
                                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/40 transition-colors"
                              >
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">№ Поставки</div>
                                    <div className="text-sm font-bold text-slate-800 mt-0.5">{s.postingId}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Склад хранения</div>
                                    <div className="text-sm font-bold text-indigo-700 mt-0.5 truncate" title={s.storageWarehouse}>
                                      {s.storageWarehouse || '—'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Пункт отгрузки</div>
                                    <div className="text-sm font-semibold text-slate-600 mt-0.5 truncate" title={s.dropOffWarehouse}>
                                      {s.dropOffWarehouse || '—'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Таймслот</div>
                                    <div className="text-sm font-semibold text-slate-600 mt-0.5 truncate" title={s.timeslot}>
                                      {s.timeslot || '—'}
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-4 shrink-0 justify-between lg:justify-end border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-50">
                                  <div className="text-left lg:text-right">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Статус Ozon</div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${statusDetails.badgeClass}`}>
                                        {statusDetails.label}
                                      </span>
                                      {s.ozonStatusDate && (
                                        <span className="text-xs text-slate-400 font-bold whitespace-nowrap">
                                          {formatStatusDate(s.ozonStatusDate)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-slate-400 bg-slate-50 p-1.5 rounded-lg">
                                    {isPostingExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                  </div>
                                </div>
                              </div>
                              
                              <AnimatePresence initial={false}>
                                {isPostingExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="border-t border-slate-100 bg-slate-50/50 overflow-hidden"
                                  >
                                    <div className="p-4 bg-slate-50/30">
                                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Состав поставки</div>
                                      {renderItemsTable(s.itemsJSON)}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

OzonSuppliesTab.displayName = 'OzonSuppliesTab';
