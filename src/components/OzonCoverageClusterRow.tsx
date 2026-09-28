// Item 88, ticket 05: one cluster row of the coverage table, with its warehouse rows — split out
// of OzonCoverageRow.tsx to keep both files under ~600 lines. Draws only.
import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { OzonStockRow } from '../types';
import { coverageTone } from '../lib/ozonCoverage';
import type { OzonCoverageSettings } from '../lib/ozonCoverage';
import { disabledReason, isClusterSelectable, DirectClusterRule } from '../lib/ozonDirectSupply';
import { cabinetDisabledReason, isCabinetCompatible } from '../lib/ozonSupplyCabinet';
import { manualKey } from '../lib/ozonManualSupply';
import { CoverageClusterRow } from '../lib/ozonStocksTabModel';
import { fmtInt, fmtSpeed, fmtDays, TONE_CLASS } from './ozonStocksFormat';

interface OzonCoverageClusterRowProps {
  art: { article: string; cabinets: string[]; freeMyStock: number };
  cls: CoverageClusterRow;
  tipUp: string;
  isColVisible: (key: string) => boolean;
  isClsExpanded: boolean;
  onToggleCluster: (key: string) => void;
  manualMode: boolean;
  manualQty: Record<string, string>;
  toggleManualPick: (article: string, clusterId: string) => void;
  changeManualQty: (article: string, clusterId: string, raw: string, freeMyStock: number) => void;
  directRules: DirectClusterRule[];
  manualClusterIds: string[];
  manualCabinetSets: string[][];
  uniqueCabinetsCount: number;
  ozonSettings: OzonCoverageSettings;
}

export const OzonCoverageClusterRow: React.FC<OzonCoverageClusterRowProps> = ({
  art, cls, tipUp, isColVisible, isClsExpanded, onToggleCluster,
  manualMode, manualQty, toggleManualPick, changeManualQty, directRules, manualClusterIds,
  manualCabinetSets, uniqueCabinetsCount, ozonSettings,
}) => {
  const clusterKey = `${art.article}:::${cls.clusterId}`;
  return (
    <React.Fragment key={clusterKey}>
      <tr
        className="border-b border-slate-100 bg-slate-50/70 hover:bg-slate-100/60 cursor-pointer transition-colors"
        onClick={() => onToggleCluster(clusterKey)}
        id={`ozon-cls-row-${art.article}-${cls.clusterId}`}
      >
        <td className="p-2.5 pl-8">
          <div className="flex items-center gap-1.5">
            {/* Пункт 63. Галочка и количество. Клик по ним не должен раскрывать строку,
                иначе каждая отметка ещё и разворачивала бы список складов. */}
            {manualMode && (() => {
              const mKey = manualKey(art.article, String(cls.clusterId));
              const picked = manualQty[mKey] !== undefined;
              const blockedDirect = !isClusterSelectable(directRules, manualClusterIds, String(cls.clusterId));
              const blockedCabinet = !isCabinetCompatible(manualCabinetSets, art.cabinets || []);
              const why =
                disabledReason(directRules, manualClusterIds, String(cls.clusterId))
                || cabinetDisabledReason(manualCabinetSets, art.cabinets || [])
                || undefined;
              return (
                <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    id={`ozon-manual-pick-${art.article}-${cls.clusterId}`}
                    checked={picked}
                    disabled={blockedDirect || blockedCabinet}
                    title={why}
                    onChange={() => toggleManualPick(art.article, String(cls.clusterId))}
                    className="rounded border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                  {picked && (
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={manualQty[mKey]}
                      onChange={(e) => changeManualQty(art.article, String(cls.clusterId), e.target.value, art.freeMyStock)}
                      className="w-16 px-1.5 py-0.5 text-[11px] text-right rounded-lg border border-indigo-200 bg-white focus:outline-none focus:border-indigo-400"
                    />
                  )}
                </span>
              );
            })()}
            {isClsExpanded ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
            <span className="font-semibold text-slate-700 text-[11px]">{cls.clusterName}</span>
            {cls.excluded && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-slate-200 text-slate-600">без поставок</span>
            )}
            {cls.priority && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-amber-100 text-amber-700" title="Приоритетный кластер: целевой и неснижаемый запас умножены на коэффициент">
                приоритет ×{cls.priorityK}
              </span>
            )}
          </div>
        </td>
        {isColVisible('sold') && <td className="p-2.5 text-right text-slate-700">{fmtInt(cls.qtySold)}</td>}
        {isColVisible('speed') && (
          <td className="p-2.5 text-right text-slate-700">
            {/* Item 86, step B. Cluster speed = article speed × its share of the article's
                sales over the long share window (replaces item 72's own best-weeks lift). */}
            <span className="relative inline-flex group cursor-help">
              <span>{fmtSpeed(cls.perDay)}</span>
              <span className={`absolute right-0 ${tipUp} hidden group-hover:block z-30 w-72 p-2.5 rounded-lg bg-slate-800 text-white text-[11px] font-normal leading-snug text-left shadow-xl`}>
                Скорость кластера = скорость товара × доля кластера в продажах за {cls.shareWindowWeeks} нед. ({cls.speedSharePct.toFixed(1)} %).
              </span>
            </span>
          </td>
        )}
        {isColVisible('trend') && <td className="p-2.5 text-right text-slate-300">—</td>}
        {isColVisible('share') && <td className="p-2.5 text-right text-slate-600">{cls.speedSharePct > 0 ? `${cls.speedSharePct.toFixed(1)}%` : '—'}</td>}
        {isColVisible('available') && <td className={`p-2.5 text-right ${cls.available === 0 ? 'text-slate-300' : 'text-slate-800 font-medium'}`}>{fmtInt(cls.available)}</td>}
        {isColVisible('preparing') && <td className="p-2.5 text-right text-slate-300">—</td>}
        {isColVisible('requested') && <td className="p-2.5 text-right text-slate-300">—</td>}
        {isColVisible('transit') && <td className={`p-2.5 text-right ${cls.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(cls.transit)}</td>}
        {isColVisible('excess') && <td className="p-2.5 text-right text-slate-300">—</td>}
        {isColVisible('returns') && <td className={`p-2.5 text-right ${cls.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(cls.returns)}</td>}
        {isColVisible('other') && <td className="p-2.5 text-right text-slate-300">—</td>}
        {isColVisible('estimated') && <td className="p-2.5 text-right font-medium text-slate-800">{fmtInt(cls.estimated)}</td>}
        {isColVisible('coverage') && <td className={`p-2.5 text-right ${TONE_CLASS[coverageTone(cls.estimated, cls.perDay, ozonSettings, cls.priorityK, cls.excluded)]}`}>{fmtDays(cls.coverageDays, cls.estimated)}</td>}
        {isColVisible('pending') && (
          <td className="p-2.5 text-right">
            {cls.inFlightQty > 0 ? (
              <span className="font-medium text-sky-600" title={`Едет в кластер ${fmtInt(cls.inFlightQty)} шт — учтены в «Расчётном». По нашим заявкам: ${fmtInt(cls.pendingQty)} шт. По данным Ozon: «В пути» ${fmtInt(cls.transit)} + «В заявках» ${fmtInt(cls.requestedQty)} = ${fmtInt(cls.ozonInFlightQty)} шт. Берём большее из двух, а не сумму — это одни и те же поставки.`}>
                {fmtInt(cls.inFlightQty)}
              </span>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </td>
        )}
        {isColVisible('myStock') && <td className="p-2.5 text-right text-slate-300">—</td>}
        {isColVisible('recommendation') && (
          <td className="p-2.5 text-right">
            {cls.recommendation && cls.recommendation.boxes > 0 ? (
              <span
                className={cls.recommendation.limitedByMyStock ? 'text-amber-600 font-semibold' : 'text-indigo-600 font-semibold'}
                title={cls.recommendation.limitedByMyStock ? `Урезано остатком Моего склада: полная потребность ${fmtInt(cls.needQty)} шт` : undefined}
              >
                {fmtInt(cls.recommendation.boxes)} кор ({fmtInt(cls.recommendation.qty)} шт)
                {cls.recommendation.partialByMaxDays && (
                  <span
                    className="block text-[10px] font-normal text-slate-500"
                    title={`Полная коробка дала бы кластеру запас на ${fmtInt(cls.recommendation.fullBoxDays)} дн — дольше настройки «Максимальный срок продаж кластера, дней». Везём ровно столько, сколько нужно до целевого запаса.`}
                  >
                    неполная коробка: полная = запас на {fmtInt(cls.recommendation.fullBoxDays)} дн
                  </span>
                )}
              </span>
            ) : cls.recommendation && cls.needQty > 0 ? (
              <span className="text-red-600 font-semibold" title="Кластеру нужна поставка, но на Моём складе нет товара">
                нужно {fmtInt(cls.needBoxes)} кор ({fmtInt(cls.needQty)} шт)
                <span className="block text-[10px] font-bold text-red-400">нет на складе</span>
              </span>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </td>
        )}
        {isColVisible('factory') && <td className="p-2.5 text-right text-slate-300">—</td>}
        {isColVisible('orderCost') && <td className="p-2.5 text-right text-slate-300">—</td>}
      </tr>

      {/* LEVEL 3: WAREHOUSES */}
      {isClsExpanded && cls.warehouses.map((wh: OzonStockRow, idx: number) => (
        <tr
          key={`${clusterKey}-wh-${idx}`}
          className="border-b border-slate-100/50 bg-white hover:bg-slate-50 transition-colors"
          id={`ozon-wh-row-${art.article}-${cls.clusterId}-${idx}`}
        >
          <td className="p-2 pl-14">
            <div className="flex items-center gap-1.5">
              {uniqueCabinetsCount > 1 && (
                <span className="text-[10px] px-1 py-0.5 rounded font-bold bg-slate-100 text-slate-500">{wh.cabinet}</span>
              )}
              <span className="text-slate-600 text-[11px]">{wh.warehouseName}</span>
            </div>
          </td>
          {isColVisible('sold') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('speed') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('trend') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('share') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('available') && <td className={`p-2 text-right ${(wh.available || 0) === 0 ? 'text-slate-300' : 'text-slate-700'}`}>{fmtInt(wh.available)}</td>}
          {isColVisible('preparing') && <td className={`p-2 text-right ${(wh.preparing || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.preparing)}</td>}
          {isColVisible('requested') && <td className={`p-2 text-right ${(wh.requested || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.requested)}</td>}
          {isColVisible('transit') && <td className={`p-2 text-right ${(wh.transit || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.transit)}</td>}
          {isColVisible('excess') && <td className={`p-2 text-right ${(wh.excess || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.excess)}</td>}
          {isColVisible('returns') && <td className={`p-2 text-right ${(wh.returns || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.returns)}</td>}
          {isColVisible('other') && <td className={`p-2 text-right ${(wh.other || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.other)}</td>}
          {isColVisible('estimated') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('coverage') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('pending') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('myStock') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('recommendation') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('factory') && <td className="p-2 text-right text-slate-300">—</td>}
          {isColVisible('orderCost') && <td className="p-2 text-right text-slate-300">—</td>}
        </tr>
      ))}
    </React.Fragment>
  );
};
