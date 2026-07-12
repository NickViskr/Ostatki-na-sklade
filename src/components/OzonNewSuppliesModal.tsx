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

  useEffect(() => {
    fetchExternalShipments().finally(() => {
      setIsLoaded(true);
    });
  }, [fetchExternalShipments]);

  const groups = useMemo(() => {
    if (!isLoaded || skus.length === 0) return [];
    return buildOzonGroups(externalShipments, skus, transactions);
  }, [isLoaded, externalShipments, skus, transactions]);

  const newGroups = useMemo(() => {
    return groups.filter(g => g.items.some(item => item.status === 'new'));
  }, [groups]);

  const processOzonGroup = useProcessOzonGroup();

  const handleProcess = (group: OzonGroup) => {
    setDismissed(true);
    processOzonGroup(group);
  };

  const showModal = !dismissed && isLoaded && skus.length > 0 && newGroups.length > 0;

  if (!showModal || typeof document === 'undefined') return null;

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
              <h3 className="text-xl font-bold text-slate-900">Обнаружены новые поставки Ozon</h3>
              <p className="text-slate-500 text-sm mt-0.5 font-medium">Новых заявок готовых к оформлению: {newGroups.length}</p>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content - Scrollable List */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 max-h-[50vh]">
          {newGroups.map((group) => {
            const newPostingsCount = group.items.filter(p => p.status === 'new').length;
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
            onClick={() => setDismissed(true)}
            className="flex-1 py-3 rounded-xl font-bold text-slate-600 hover:bg-white transition-all border border-slate-200 bg-white text-center text-sm cursor-pointer"
          >
            Позже
          </button>
          <button
            onClick={() => {
              setActiveTab('ozon');
              setDismissed(true);
            }}
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
