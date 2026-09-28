// Item 88, ticket 05: the sync-issue warning, the «Данные по магазинам» line and the four
// summary cards — moved out of OzonStocksTab.tsx verbatim.
import React from 'react';

interface OzonStocksNoticesProps {
  ozonStocksSyncIssues: { name: string }[];
  ozonStocksCabinets: string[];
  cabinetFilter: string;
  ozonTotals: { available: number; requested: number; transit: number; returns: number };
}

export const OzonStocksNotices: React.FC<OzonStocksNoticesProps> = ({
  ozonStocksSyncIssues, ozonStocksCabinets, cabinetFilter, ozonTotals,
}) => (
  <>
    {ozonStocksSyncIssues.length > 0 && (
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm font-semibold" id="ozon-stocks-partial-warning">
        Данные неполные: не удалось обновить {ozonStocksSyncIssues.map(i => i.name).join(', ')}. Показаны последние успешно полученные данные по остальным магазинам.
      </div>
    )}
    {ozonStocksCabinets.length > 0 && (
      <div className="text-xs text-slate-500 font-medium" id="ozon-stocks-cabinets-info">
        Данные по магазинам: {ozonStocksCabinets.join(', ')}
        {cabinetFilter !== 'all' && (
          <span className="text-indigo-600 font-semibold">
            {' '}· показан только «{cabinetFilter}»: и числа наверху, и таблица считаются по нему
          </span>
        )}
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
  </>
);
