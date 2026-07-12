import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { buildOzonGroups, useProcessOzonGroup, OzonGroup } from '../lib/ozonGroups';
import { Calendar, Package, X } from 'lucide-react';

export const OzonNewSuppliesModal: React.FC = () => {
  const fetchExternalShipments = useWarehouseStore((state) => state.fetchExternalShipments);
  const externalShipments = useWarehouseStore((state) => state.externalShipments);
  const skus = useWarehouseStore((state) => state.skus);
  const transactions = useWarehouseStore((state) => state.transactions);
  
  const setActiveTab = useUIStore((state) => state.setActiveTab);

  const [isLoaded, setIsLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // 1. Память показанных поставок — загрузка из localStorage (ключ 'ozon_notifiedPostingIds')
  // Чтение обернуто в try/catch для отказоустойчивости при битом JSON
  const notifiedIds = useMemo<string[]>(() => {
    try {
      const storedStr = localStorage.getItem('ozon_notifiedPostingIds');
      if (storedStr) {
        const parsed = JSON.parse(storedStr);
        if (Array.isArray(parsed)) {
          return parsed.map(String);
        }
      }
    } catch (e) {
      console.error('Failed to parse ozon_notifiedPostingIds from localStorage', e);
    }
    return [];
  }, []);

  useEffect(() => {
    fetchExternalShipments().finally(() => {
      setIsLoaded(true);
    });
  }, [fetchExternalShipments]);

  const groups = useMemo(() => {
    if (!isLoaded || skus.length === 0) return [];
    return buildOzonGroups(externalShipments, skus, transactions);
  }, [isLoaded, externalShipments, skus, transactions]);

  // Фильтруем группы, в которых есть хотя бы одна поставка в статусе 'new'
  const newGroups = useMemo(() => {
    return groups.filter(g => g.items.some(item => item.status === 'new'));
  }, [groups]);

  // 2. Для каждой заявки со статусом new вычисляем флаг isNew: true,
  // если хотя бы один postingId её новых поставок отсутствует в notifiedIds
  // 3. Заявки с isNew === true сортируются первыми для вывода вверху списка
  const processedGroups = useMemo(() => {
    const mapped = newGroups.map(group => {
      const newItems = group.items.filter(item => item.status === 'new');
      const isNew = newItems.some(item => !notifiedIds.includes(item.postingId));
      return {
        ...group,
        isNew,
        newItemsCount: newItems.length
      };
    });

    return [...mapped].sort((a, b) => {
      if (a.isNew && !b.isNew) return -1;
      if (!a.isNew && b.isNew) return 1;
      return 0;
    });
  }, [newGroups, notifiedIds]);

  const saveNotifiedPostingIds = () => {
    try {
      const storedStr = localStorage.getItem('ozon_notifiedPostingIds');
      let existingIds: string[] = [];
      if (storedStr) {
        try {
          const parsed = JSON.parse(storedStr);
          if (Array.isArray(parsed)) {
            existingIds = parsed.map(String);
          }
        } catch (e) {
          existingIds = [];
        }
      }
      const currentNewPostingIds = newGroups.flatMap(group =>
        group.items
          .filter(item => item.status === 'new')
          .map(item => item.postingId)
      );
      const combined = Array.from(new Set([...existingIds, ...currentNewPostingIds])).slice(-1000);
      localStorage.setItem('ozon_notifiedPostingIds', JSON.stringify(combined));
    } catch (e) {
      console.error('Failed to save notified posting IDs', e);
    }
  };

  const processOzonGroup = useProcessOzonGroup();

  const handleProcess = (group: OzonGroup) => {
    saveNotifiedPostingIds();
    setDismissed(true);
    processOzonGroup(group);
  };

  const handleCloseBtn = () => {
    saveNotifiedPostingIds();
    setDismissed(true);
  };

  const handleLater = () => {
    saveNotifiedPostingIds();
    setDismissed(true);
  };

  const handleOpenTab = () => {
    saveNotifiedPostingIds();
    setActiveTab('ozon');
    setDismissed(true);
  };

  const showModal = !dismissed && isLoaded && skus.length > 0 && processedGroups.length > 0;

  if (!showModal || typeof document === 'undefined') return null;

  const newGroupsCount = processedGroups.filter(g => g.isNew).length;
  const waitingGroupsCount = processedGroups.filter(g => !g.isNew).length;

  const title = newGroupsCount > 0 
    ? "Обнаружены новые поставки Ozon" 
    : "Заявки Ozon ждут оформления";

  const subtitle = newGroupsCount > 0
    ? (waitingGroupsCount > 0 
        ? `Новых заявок: ${newGroupsCount} · Ожидают оформления: ${waitingGroupsCount}` 
        : `Новых заявок: ${newGroupsCount}`)
    : `Не оформлено и не отклонено заявок: ${waitingGroupsCount}`;

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4 fade-in">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[85vh] modal-enter">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center shrink-0 text-indigo-600">
              <Package size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">{title}</h3>
              <p className="text-slate-500 text-sm mt-0.5 font-medium">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleCloseBtn}
            className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content - Scrollable List */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 max-h-[50vh]">
          {processedGroups.map((group) => {
            const newPostingsCount = group.newItemsCount;
            return (
              <div 
                key={group.id} 
                className="border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white hover:border-slate-300 transition-all shadow-sm"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-800 text-base truncate">
                      Заявка № {group.label}
                    </span>
                    {group.isNew && (
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full whitespace-nowrap">
                        Новая
                      </span>
                    )}
                    {group.cabinet && (
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-sky-50 text-sky-700 rounded-full whitespace-nowrap">
                        {group.cabinet}
                      </span>
                    )}
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full whitespace-nowrap">
                      Новых поставок: {newPostingsCount}
                    </span>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium">
                    <div className="flex items-center gap-1">
                      <Calendar size={13} className="text-slate-400" />
                      <span>Дата отгрузки: {group.shipmentDate}</span>
                    </div>
                  </div>

                  {group.matchResult?.verdict === 'duplicate' && (
                    <div className="pt-1">
                      <span className="inline-block text-xs font-semibold px-2.5 py-0.5 bg-red-50 text-red-700 rounded-full border border-red-100 whitespace-nowrap">
                        Возможный дубль ручной отгрузки
                      </span>
                    </div>
                  )}
                  {group.matchResult?.verdict === 'suspect' && (
                    <div className="pt-1">
                      <span className="inline-block text-xs font-semibold px-2.5 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-100 whitespace-nowrap">
                        Похожа на ручную — проверьте
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end shrink-0">
                  <button
                    onClick={() => handleProcess(group)}
                    className="w-full sm:w-auto bg-sky-500 text-white px-5 py-2 rounded-xl font-bold text-sm hover:bg-sky-600 transition-all shadow-md shadow-sky-100 cursor-pointer text-center whitespace-nowrap"
                  >
                    Оформить
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row gap-3 shrink-0 rounded-b-3xl">
          <button
            onClick={handleLater}
            className="flex-1 py-3 rounded-xl font-bold text-slate-600 hover:bg-white transition-all border border-slate-200 bg-white text-center text-sm cursor-pointer"
          >
            Позже
          </button>
          <button
            onClick={handleOpenTab}
            className="flex-1 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 text-center text-sm cursor-pointer"
          >
            Открыть Поставки Озон
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
