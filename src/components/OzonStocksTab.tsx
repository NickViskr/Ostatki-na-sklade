import React, { useMemo, useState, useEffect } from 'react';
import { ChevronDown, RefreshCw, Settings } from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { OzonStockRow } from '../types';
import { OzonSettingsModal } from './OzonSettingsModal';

export const OzonStocksTab: React.FC = React.memo(() => {
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const ozonStocksSyncIssues = useWarehouseStore((state) => state.ozonStocksSyncIssues);
  const fetchOzonStocks = useWarehouseStore((state) => state.fetchOzonStocks);
  const runOzonStocksSync = useWarehouseStore((state) => state.runOzonStocksSync);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);

  const [isOzonStocksCollapsed, setIsOzonStocksCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedOfferKeys, setExpandedOfferKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isAdmin) {
      fetchOzonStocks();
    }
  }, [isAdmin, fetchOzonStocks]);

  const toggleOfferKey = (key: string) => {
    setExpandedOfferKeys(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const maxUpdatedAt = useMemo(() => {
    if (!ozonStocks || ozonStocks.length === 0) return '';
    let max = '';
    for (const s of ozonStocks) {
      if (s.updatedAt && s.updatedAt > max) {
        max = s.updatedAt;
      }
    }
    return max;
  }, [ozonStocks]);

  const ozonStocksCabinets = useMemo(() => {
    if (!ozonStocks || ozonStocks.length === 0) return [];
    return Array.from(new Set(ozonStocks.map(s => s.cabinet).filter(Boolean)));
  }, [ozonStocks]);

  const ozonTotals = useMemo(() => {
    let available = 0;
    let requested = 0;
    let transit = 0;
    let returns = 0;
    if (ozonStocks) {
      for (const s of ozonStocks) {
        available += s.available || 0;
        requested += s.requested || 0;
        transit += s.transit || 0;
        returns += s.returns || 0;
      }
    }
    return { available, requested, transit, returns };
  }, [ozonStocks]);

  const uniqueCabinetsCount = useMemo(() => {
    if (!ozonStocks) return 0;
    const cabs = new Set(ozonStocks.map(s => s.cabinet));
    return cabs.size;
  }, [ozonStocks]);

  const groupedStocks = useMemo(() => {
    if (!ozonStocks) return [];
    const map: Record<string, any> = {};
    for (const s of ozonStocks) {
      const key = `${s.cabinet}:::${s.offerId}`;
      if (!map[key]) {
        map[key] = {
          key,
          cabinet: s.cabinet,
          offerId: s.offerId,
          name: s.name || '',
          available: 0,
          preparing: 0,
          requested: 0,
          transit: 0,
          excess: 0,
          returns: 0,
          other: 0,
          items: []
        };
      }
      map[key].available += s.available || 0;
      map[key].preparing += s.preparing || 0;
      map[key].requested += s.requested || 0;
      map[key].transit += s.transit || 0;
      map[key].excess += s.excess || 0;
      map[key].returns += s.returns || 0;
      map[key].other += s.other || 0;
      map[key].items.push(s);
    }

    return Object.values(map).sort((a: any, b: any) => b.available - a.available);
  }, [ozonStocks]);

  if (!isAdmin) return null;

  return (
    <div className="space-y-6 tab-enter">
      {/* Ozon Stocks Mirror Section */}
      <div className="space-y-4 bg-slate-50/50 p-6 rounded-3xl border border-slate-200/60 shadow-sm" id="ozon-stocks-mirror-section">
        <div
          className="flex justify-between items-center cursor-pointer select-none"
          onClick={() => setIsOzonStocksCollapsed(prev => !prev)}
          id="ozon-stocks-header"
        >
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-slate-800">Остатки на складах Ozon</h3>
            {!isOzonStocksCollapsed && maxUpdatedAt && (
              <span className="text-xs text-slate-400 font-medium">
                Обновлено: {maxUpdatedAt}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            {!isOzonStocksCollapsed && (
              <>
                <button
                  type="button"
                  id="btn-ozon-settings"
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs"
                >
                  <Settings size={14} />
                  Настройки
                </button>
                <button
                  type="button"
                  id="btn-refresh-ozon-stocks"
                  disabled={isProcessing}
                  onClick={runOzonStocksSync}
                  className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs disabled:opacity-50"
                >
                  <RefreshCw size={14} className={`transition-transform ${isProcessing ? 'animate-spin' : ''}`} />
                  Обновить
                </button>
              </>
            )}
            <button
              type="button"
              id="btn-collapse-ozon-stocks"
              aria-label={isOzonStocksCollapsed ? 'Развернуть остатки Ozon' : 'Свернуть остатки Ozon'}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              onClick={() => setIsOzonStocksCollapsed(prev => !prev)}
            >
              <ChevronDown
                size={20}
                className={`transition-transform duration-200 ${isOzonStocksCollapsed ? '-rotate-90' : ''}`}
              />
            </button>
          </div>
        </div>

        {!isOzonStocksCollapsed && (
          <div className="space-y-4" id="ozon-stocks-content">
            {ozonStocksSyncIssues.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm font-semibold" id="ozon-stocks-partial-warning">
                Данные неполные: не удалось обновить {ozonStocksSyncIssues.map(i => i.name).join(', ')}. Показаны последние успешно полученные данные по остальным кабинетам.
              </div>
            )}
            {ozonStocksCabinets.length > 0 && (
              <div className="text-xs text-slate-500 font-medium" id="ozon-stocks-cabinets-info">
                Данные по кабинетам: {ozonStocksCabinets.join(', ')}
              </div>
            )}
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" id="ozon-stocks-summary-cards">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                  Доступно к продаже
                </span>
                <div className="text-2xl font-extrabold text-slate-900 leading-none">
                  {ozonTotals.available.toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                  В заявках
                </span>
                <div className="text-2xl font-extrabold text-slate-900 leading-none">
                  {ozonTotals.requested.toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                  В пути
                </span>
                <div className="text-2xl font-extrabold text-slate-900 leading-none">
                  {ozonTotals.transit.toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                  Возвраты
                </span>
                <div className="text-2xl font-extrabold text-slate-900 leading-none">
                  {ozonTotals.returns.toLocaleString('ru-RU')}
                </div>
              </div>
            </div>

            {/* Table / List */}
            {!ozonStocks || ozonStocks.length === 0 ? (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-sm text-slate-500" id="ozon-stocks-empty">
                Данных пока нет. Нажмите „Обновить", чтобы загрузить остатки со складов Ozon.
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm" id="ozon-stocks-table-container">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs" id="ozon-stocks-table">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold">
                        <th className="p-3">Артикул / Название</th>
                        <th className="p-3 text-right">Доступно</th>
                        <th className="p-3 text-right">Готовим</th>
                        <th className="p-3 text-right">В заявках</th>
                        <th className="p-3 text-right">В пути</th>
                        <th className="p-3 text-right">Излишки</th>
                        <th className="p-3 text-right">Возвраты</th>
                        <th className="p-3 text-right">Прочее</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedStocks.map((group) => {
                        const isExpanded = !!expandedOfferKeys[group.key];
                        return (
                          <React.Fragment key={group.key}>
                            {/* Main Article Row */}
                            <tr
                              className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer transition-colors"
                              onClick={() => toggleOfferKey(group.key)}
                              id={`ozon-stock-row-${group.offerId}`}
                            >
                              <td className="p-3 min-w-[200px] max-w-[350px]">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {uniqueCabinetsCount > 1 && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold tracking-wide bg-indigo-50 text-indigo-600 border border-indigo-100">
                                        {group.cabinet}
                                      </span>
                                    )}
                                    <span className="font-mono font-bold text-slate-700">{group.offerId}</span>
                                  </div>
                                  <span className="text-slate-500 truncate block text-[11px]" title={group.name}>
                                    {group.name}
                                  </span>
                                </div>
                              </td>
                              <td className={`p-3 text-right font-semibold ${group.available === 0 ? 'text-slate-300' : 'text-slate-900'}`}>
                                {group.available.toLocaleString('ru-RU')}
                              </td>
                              <td className={`p-3 text-right ${group.preparing === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                {group.preparing.toLocaleString('ru-RU')}
                              </td>
                              <td className={`p-3 text-right ${group.requested === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                {group.requested.toLocaleString('ru-RU')}
                              </td>
                              <td className={`p-3 text-right ${group.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                {group.transit.toLocaleString('ru-RU')}
                              </td>
                              <td className={`p-3 text-right ${group.excess === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                {group.excess.toLocaleString('ru-RU')}
                              </td>
                              <td className={`p-3 text-right ${group.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                {group.returns.toLocaleString('ru-RU')}
                              </td>
                              <td className={`p-3 text-right ${group.other === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                {group.other.toLocaleString('ru-RU')}
                              </td>
                            </tr>

                            {/* Warehouse Details Rows */}
                            {isExpanded && group.items.map((item: OzonStockRow, idx: number) => (
                              <tr
                                key={`${group.key}-item-${idx}`}
                                className="bg-slate-50/30 border-b border-slate-100/50 hover:bg-slate-50 transition-colors"
                                id={`ozon-stock-subrow-${group.offerId}-${idx}`}
                              >
                                <td className="p-2.5 pl-6">
                                  <div className="flex flex-col gap-0.5 border-l-2 border-indigo-200 pl-3">
                                    <span className="font-semibold text-slate-700 text-[11px]">{item.warehouseName}</span>
                                    {item.clusterName && (
                                      <span className="text-[10px] text-slate-400 font-medium">Кластер: {item.clusterName}</span>
                                    )}
                                  </div>
                                </td>
                                <td className={`p-2.5 text-right font-medium ${item.available === 0 ? 'text-slate-300 font-normal' : 'text-slate-800'}`}>
                                  {item.available.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-2.5 text-right ${item.preparing === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {item.preparing.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-2.5 text-right ${item.requested === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {item.requested.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-2.5 text-right ${item.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {item.transit.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-2.5 text-right ${item.excess === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {item.excess.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-2.5 text-right ${item.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {item.returns.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-2.5 text-right ${item.other === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {item.other.toLocaleString('ru-RU')}
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <OzonSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
});
