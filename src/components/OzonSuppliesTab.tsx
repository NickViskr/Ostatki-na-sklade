import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ExternalShipment } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Package, 
  RefreshCw, 
  Loader2, 
  ChevronDown, 
  ChevronUp, 
  Calendar
} from 'lucide-react';
import { STATUS_DICT, getStatusDetails, getStatusLabel } from '../lib/ozonStatus';
import { useUIStore } from '../store/useUIStore';
import { toast } from 'sonner';
import { buildOzonGroups, useProcessOzonGroup, OzonGroup } from '../lib/ozonGroups';


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
  const transactions = useWarehouseStore((state) => state.transactions);

  const skus = useWarehouseStore((state) => state.skus);
  const stock = useWarehouseStore((state) => state.stock);
  const markExternalShipment = useWarehouseStore((state) => state.markExternalShipment);
  const setPendingOzonPostingIds = useWarehouseStore((state) => state.setPendingOzonPostingIds);
  const setOpType = useUIStore((state) => state.setOpType);
  const setUploadDestination = useUIStore((state) => state.setUploadDestination);
  const askConfirmation = useUIStore((state) => state.askConfirmation);

  const [isLoading, setIsLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedPostings, setExpandedPostings] = useState<Set<string>>(new Set());
  const [cabinetFilter, setCabinetFilter] = useState<string>('all');
  const [showProcessed, setShowProcessed] = useState(false);

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

  const handleProcessOzonGroup = useProcessOzonGroup();

  const handleIgnoreOzonGroup = useCallback((group: OzonGroup) => {
    const newPostings: ExternalShipment[] = (group.items as ExternalShipment[]).filter(p => p.status === 'new');
    if (newPostings.length === 0) {
      toast.error('В заявке нет новых поставок');
      return;
    }
    askConfirmation(
      "Игнорировать заявку Ozon?",
      `Все новые поставки заявки № ${group.label} (${newPostings.length} шт.) будут помечены как проигнорированные.`,
      async () => {
        for (const p of newPostings) {
          await markExternalShipment(p.postingId, 'ignored');
        }
        toast.success(`Заявка № ${group.label} проигнорирована`);
      }
    );
  }, [askConfirmation, markExternalShipment]);

  const handleLinkAsDuplicate = useCallback((group: OzonGroup) => {
    const newPostings: ExternalShipment[] = (group.items as ExternalShipment[]).filter(p => p.status === 'new');
    if (newPostings.length === 0) {
      toast.error('В заявке нет новых поставок');
      return;
    }
    const bestCandidate = group.matchResult?.candidates?.[0];
    if (!bestCandidate) {
      toast.error('Совпадение не найдено');
      return;
    }

    askConfirmation(
      "Привязать заявку к ручной отгрузке?",
      `Заявка № ${group.label} будет помечена обработанной и привязана к ручной отгрузке от ${bestCandidate.date}. Новый расход НЕ создаётся. Если позже удалить эту отгрузку из Истории, заявка автоматически вернётся в новые.`,
      async () => {
        const linkInfo = JSON.stringify(bestCandidate.txIds);
        for (const p of newPostings) {
          await markExternalShipment(p.postingId, 'processed', linkInfo);
        }
        toast.success(`Заявка № ${group.label} привязана к ручной отгрузке`);
      }
    );
  }, [askConfirmation, markExternalShipment]);

  const handleReturnGroupToNew = useCallback((group: OzonGroup) => {
    const donePostings: ExternalShipment[] = (group.items as ExternalShipment[]).filter(
      p => p.status === 'processed' || p.status === 'ignored'
    );
    if (donePostings.length === 0) return;
    askConfirmation(
      "Вернуть заявку в новые?",
      `Все поставки заявки № ${group.label} (${donePostings.length} шт.) снова станут новыми — их можно будет оформить или игнорировать заново. Убедитесь, что связанная отгрузка удалена из Истории, иначе при повторном оформлении получится дубль расхода.`,
      async () => {
        for (const p of donePostings) {
          await markExternalShipment(p.postingId, 'new');
        }
        toast.success(`Заявка № ${group.label} возвращена в новые`);
      }
    );
  }, [askConfirmation, markExternalShipment]);

  const groupedShipments = useMemo(() => {
    return buildOzonGroups(externalShipments, skus, transactions);
  }, [externalShipments, transactions, skus]);

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

  const availableCabinets = useMemo(() => {
    const set = new Set<string>();
    groupedShipments.forEach(g => { if (g.cabinet) set.add(g.cabinet); });
    return Array.from(set).sort();
  }, [groupedShipments]);

  const filteredGroups = useMemo(() => {
    if (cabinetFilter === 'all') return sortedGroups;
    return sortedGroups.filter(g => g.cabinet === cabinetFilter);
  }, [sortedGroups, cabinetFilter]);

  // Обработанные = заявки без единой новой поставки (оформлены или проигнорированы)
  const processedGroupsCount = useMemo(
    () => filteredGroups.filter(g => !g.items.some((i) => i.status === 'new')).length,
    [filteredGroups]
  );

  // По умолчанию видны только актуальные заявки (есть хотя бы одна новая поставка)
  const displayedGroups = useMemo(() => {
    if (showProcessed) return filteredGroups;
    return filteredGroups.filter(g => g.items.some((i) => i.status === 'new'));
  }, [filteredGroups, showProcessed]);

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
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Поставки Озон</h2>
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

      {/* Фильтр по магазинам (виден при двух и более кабинетах) */}
      {!isLoading && availableCabinets.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCabinetFilter('all')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
              cabinetFilter === 'all'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Все магазины
          </button>
          {availableCabinets.map((name) => (
            <button
              key={name}
              onClick={() => setCabinetFilter(name)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                cabinetFilter === name
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Показ обработанных заявок */}
      {!isLoading && processedGroupsCount > 0 && (
        <label className="flex items-center gap-2 text-sm font-bold text-slate-500 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={showProcessed}
            onChange={(e) => setShowProcessed(e.target.checked)}
            className="w-4 h-4 rounded accent-indigo-600"
          />
          Показать обработанные заявки ({processedGroupsCount})
        </label>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Loader2 size={40} className="animate-spin text-indigo-600 mb-4" />
          <p className="font-semibold">Загрузка заявок Ozon...</p>
        </div>
      ) : displayedGroups.length === 0 ? (
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
          {displayedGroups.map((group) => {
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
                      {group.items.some(i => i.status === 'new') && (
                        group.needsExpense ? (
                          <span className="text-xs font-semibold px-2.5 py-1 bg-red-50 text-red-700 rounded-full border border-red-100">
                            Отгружена — оформите списание
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
                            Ожидает отгрузки на Ozon
                          </span>
                        )
                      )}
                      {group.matchResult?.verdict === 'duplicate' && (
                        <span className="text-xs font-semibold px-2.5 py-1 bg-red-50 text-red-700 rounded-full border border-red-100">
                          Возможный дубль ручной отгрузки
                        </span>
                      )}
                      {group.matchResult?.verdict === 'suspect' && (
                        <span className="text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-100">
                          Похожа на ручную — проверьте
                        </span>
                      )}
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
                    {group.items.some((i) => i.status === 'new') && (
                      <div className="flex gap-2">
                        {group.matchResult?.verdict !== 'none' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleLinkAsDuplicate(group); }}
                            className="bg-white border border-red-400 text-red-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-red-50 transition-all cursor-pointer whitespace-nowrap"
                          >
                            Привязать как дубль
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleProcessOzonGroup(group); }}
                          disabled={!group.needsExpense}
                          title={!group.needsExpense ? 'Оформление доступно после приёмки товара на точке отгрузки Ozon' : undefined}
                          className="bg-sky-500 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-sky-600 transition-all shadow-md shadow-sky-100 cursor-pointer disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed"
                        >
                          Оформить
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleIgnoreOzonGroup(group); }}
                          className="bg-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold text-sm hover:bg-slate-300 transition-all cursor-pointer"
                        >
                          Игнорировать
                        </button>
                      </div>
                    )}
                    {!group.items.some((i) => i.status === 'new') &&
                      group.items.some((i) => i.status === 'processed' || i.status === 'ignored') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReturnGroupToNew(group); }}
                        className="bg-white border border-amber-400 text-amber-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-amber-50 transition-all cursor-pointer"
                      >
                        Вернуть в новые
                      </button>
                    )}
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
                        {group.matchResult && group.matchResult.verdict !== 'none' && group.matchResult.candidates?.[0] && (() => {
                          const bestCandidate = group.matchResult.candidates[0];
                          const isDuplicate = group.matchResult.verdict === 'duplicate';
                          const cardBorderBg = isDuplicate 
                            ? 'border-red-200 bg-red-50/30 text-red-800' 
                            : 'border-amber-200 bg-amber-50/30 text-amber-800';
                          
                          const daysText = bestCandidate.dateDiffDays !== null 
                            ? `${bestCandidate.dateDiffDays} ${
                                bestCandidate.dateDiffDays === 1 ? 'день' :
                                [2,3,4].includes(bestCandidate.dateDiffDays) ? 'дня' : 'дней'
                              }`
                            : 'не определена';

                          const itemsListText = bestCandidate.items
                            .map(it => `${it.article} ×${it.quantity}`)
                            .join(', ');

                          return (
                            <div className={`p-4 border rounded-2xl space-y-1.5 ${cardBorderBg}`}>
                              <div className="font-bold text-sm">
                                {isDuplicate 
                                  ? `Возможный дубль: ручная отгрузка от ${bestCandidate.date}` 
                                  : `Похожая ручная отгрузка от ${bestCandidate.date}`}
                              </div>
                              <div className="text-xs text-slate-500 font-medium">
                                Поставка: {bestCandidate.deliveryDate || '—'} · Объект: {bestCandidate.destination} · Разница дат: {daysText}
                              </div>
                              <div className="text-xs text-slate-600 font-medium">
                                <span className="text-slate-400">Состав ручной отгрузки (совпадает с заявкой):</span> {itemsListText}
                              </div>
                            </div>
                          );
                        })()}

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
