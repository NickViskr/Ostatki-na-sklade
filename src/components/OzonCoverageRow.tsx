// Item 88, ticket 05: one article row of the coverage table, with its cluster rows and
// warehouse rows — moved out of OzonStocksTab.tsx verbatim. Draws only; every figure comes from
// the tab model's output, read through props.
import React from 'react';
import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react';
import { FactoryOrder } from '../types';
import { coverageTone } from '../lib/ozonCoverage';
import type { KitBottleneck } from '../lib/ozonCoverage';
import { DirectClusterRule } from '../lib/ozonDirectSupply';
import { manualClusterList, remainingForArticle, ManualPick } from '../lib/ozonManualSupply';
import { factoryOrderBadge, factoryLateLabel } from '../lib/factoryOrderDisplay';
import { CoverageTabRow, CoverageClusterRow, FactoryCellState, emptyManualCluster, SupplyClusterRef, ClusterShares } from '../lib/ozonStocksTabModel';
import { OzonCoverageSettings } from '../lib/ozonCoverage';
import {
  fmtInt, fmtSpeed, fmtTrend, fmtDays, fmtDateShort, fmtDateFull, TONE_CLASS, TREND_REASON_SHORT, TREND_REASON_LONG,
} from './ozonStocksFormat';
import { OzonCoverageClusterRow } from './OzonCoverageClusterRow';

interface OzonCoverageRowProps {
  art: CoverageTabRow;
  rowIdx: number;
  isColVisible: (key: string) => boolean;
  isArtExpanded: boolean;
  onToggleArticle: (article: string) => void;
  expandedClusters: Record<string, boolean>;
  onToggleCluster: (key: string) => void;
  uniqueCabinetsCount: number;
  manualMode: boolean;
  manualPicks: ManualPick[];
  manualQty: Record<string, string>;
  toggleManualPick: (article: string, clusterId: string) => void;
  changeManualQty: (article: string, clusterId: string, raw: string, freeMyStock: number) => void;
  directRules: DirectClusterRule[];
  manualClusterIds: string[];
  manualCabinetSets: string[][];
  supplyClusterRefs: SupplyClusterRef[];
  clusterShares: ClusterShares;
  factoryOrdersByArticle: Record<string, FactoryOrder[]>;
  hiddenManualByArticle: Record<string, FactoryOrder[]>;
  factoryCellByArticle: Record<string, FactoryCellState>;
  factoryLateById: Record<string, number>;
  bottleneckByKit: Record<string, KitBottleneck>;
  ozonSettings: OzonCoverageSettings;
  unboundInFlightByArticle: Record<string, number>;
  getOrderUnitCost: (article: string) => { price: number; source: string };
  setFactoryModalArticle: (article: string) => void;
  setPendingModalArticle: (article: string) => void;
  onResolveFactoryConflict: (order: FactoryOrder, same: boolean) => void;
}

export const OzonCoverageRow: React.FC<OzonCoverageRowProps> = ({
  art, rowIdx, isColVisible, isArtExpanded, onToggleArticle, expandedClusters, onToggleCluster,
  uniqueCabinetsCount, manualMode, manualPicks, manualQty, toggleManualPick, changeManualQty,
  directRules, manualClusterIds, manualCabinetSets, supplyClusterRefs, clusterShares,
  factoryOrdersByArticle, hiddenManualByArticle, factoryCellByArticle, factoryLateById,
  bottleneckByKit, ozonSettings, unboundInFlightByArticle, getOrderUnitCost, setFactoryModalArticle,
  setPendingModalArticle, onResolveFactoryConflict,
}) => {
  // Подсказки раскрываются вверх, а у первых строк сверху нет места: таблица лежит
  // в контейнере с прокруткой и обрезает всё, что вышло за его край. У них раскрываем вниз.
  const tipUp = rowIdx > 1 ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  // Пункт 35, item 88 ticket 04: разбор заказов на фабрике для восьми состояний
  // ячейки — теперь читается из модели, посчитанный один раз для всех строк.
  // Item 83d: a China row NEVER drops into the «просрочен» state — it stays in the
  // ТРУБА even late, only «задерживается N дн» tells the owner about it.
  const factoryList = factoryOrdersByArticle[art.article] || [];
  // Item 83e: manual orders hidden from the ТРУБА for this article, shown as a
  // separate notice next to the article, with the two owner buttons.
  const factoryHiddenManual = hiddenManualByArticle[art.article] || [];
  const factoryCell = factoryCellByArticle[art.article];
  const factoryOverdueList = factoryCell.overdueList;
  const factoryOverdueQty = factoryCell.overdueQty;
  const factoryWaitingList = factoryCell.waitingList;
  const factoryWaitingQty = factoryCell.waitingQty;
  const factoryNearest = factoryCell.nearest;
  // Item 83g: one line per active order — badge and «задерживается N дн» when a
  // China row is late — appended to the cell's tooltips below.
  const factoryOrdersDetail = factoryList
    .map((o) => {
      const badge = factoryOrderBadge(o);
      const late = factoryLateLabel(factoryLateById[o.id]);
      return `${fmtInt(o.qty)} шт${badge ? ` · ${badge}` : ''}${o.expectedAt ? ` · ждём ${fmtDateShort(o.expectedAt)}` : ''}${late ? ` · ${late}` : ''}`;
    })
    .join('\n');
  const factoryOrderQty = factoryCell.orderQty;
  const factoryBox = factoryCell.box;
  // Item 86, step D. N — the pieces sold over the speed period, from the result
  // (not perDay × days: «Спрос вырос» may have replaced perDay since).
  const speedSoldQty = art.speedSoldQty;
  const speedTitle = art.speedSource === 'daysInStock'
    ? `Скорость по дням наличия: продано ${fmtInt(speedSoldQty)} шт за ${Math.round(art.speedDaysInStock)} дн. в наличии (из ${Math.round(art.speedWindowDays)} дн. окна)`
    : art.speedSource === 'lookback' && art.speedPeriod
      ? `Товара долго не было: скорость по периоду ${fmtDateShort(art.speedPeriod.from)}–${fmtDateShort(art.speedPeriod.to)} — ${fmtInt(speedSoldQty)} шт за ${Math.round(art.speedDaysInStock)} дн. в наличии${art.speedApproximate ? '\nПриблизительно: до 18.08 история наличия не велась, недели с продажами считаются днями в наличии' : ''}`
      : 'История наличия ещё не покрывает окно — скорость по календарным дням';

  const displayClusters: CoverageClusterRow[] = isArtExpanded
    ? (manualMode
        ? manualClusterList(art.clusters || [], supplyClusterRefs, clusterShares.byClusterId, emptyManualCluster)
        : art.clusters)
    : [];

  return (
    <React.Fragment key={art.article}>
      {/* LEVEL 1: ARTICLE */}
      <tr
        className="border-b border-slate-200 bg-slate-100/80 hover:bg-slate-200/60 cursor-pointer transition-colors"
        onClick={() => onToggleArticle(art.article)}
        id={`ozon-art-row-${art.article}`}
      >
        <td className="p-3 max-w-[350px]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {isArtExpanded ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
              {uniqueCabinetsCount > 1 && art.cabinets.map((cab: string) => (
                <span key={cab} className="text-[10px] px-1.5 py-0.5 rounded-md font-bold tracking-wide bg-indigo-50 text-indigo-600 border border-indigo-100">{cab}</span>
              ))}
              <span className="font-mono font-bold text-slate-800">{art.article}</span>
              {/* Пункт 63. Остаток тает по мере того, как владелец раскладывает его по кластерам. */}
              {manualMode && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-indigo-50 text-indigo-700 border border-indigo-100"
                  title="Свободно на «Моём складе» с учётом того, что уже разложено по кластерам в этом выборе"
                >
                  свободно {fmtInt(remainingForArticle(art.freeMyStock, manualPicks, art.article, ''))} шт
                </span>
              )}
            </div>
            <span className="text-slate-500 truncate block text-[11px]" title={art.name}>{art.name}</span>
            {/* Item 83e: the manual order is real, it just double-counts an article that
                already has a China shipment — the owner decides which. */}
            {factoryHiddenManual.map((hidden) => (
              <div
                key={hidden.id}
                className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-2 py-1 flex items-center gap-2 flex-wrap"
                onClick={(e) => e.stopPropagation()}
              >
                <span>ручной заказ {fmtInt(hidden.qty)} шт скрыт из трубы: по артикулу есть заказ из Китая</span>
                <button
                  type="button"
                  className="font-bold underline hover:text-amber-900"
                  onClick={() => onResolveFactoryConflict(hidden, true)}
                >
                  это тот же заказ
                </button>
                <button
                  type="button"
                  className="font-bold underline hover:text-amber-900"
                  onClick={() => onResolveFactoryConflict(hidden, false)}
                >
                  это разные заказы
                </button>
              </div>
            ))}
          </div>
        </td>
        {isColVisible('sold') && <td className="p-3 text-right font-semibold text-slate-800">{fmtInt(art.qtySold)}</td>}
        {isColVisible('speed') && (
          <td className="p-3 text-right font-semibold text-slate-800">
            {art.noSales26 && (
              <span className="block text-[10px] font-bold text-red-600">Товар не продавался более 26 недель</span>
            )}
            {art.speedCorrection ? (
              <span className="relative inline-flex group cursor-help">
                {/* Значок читается как «тренд», хотя это другой механизм — коррекция при
                    распродаже. Подпись снизу убирает путаницу с колонкой «Тренд». */}
                <span className="flex flex-col items-end">
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp size={13} className="text-amber-500" />
                    <span className="text-amber-600">{fmtSpeed(art.perDay)}</span>
                  </span>
                  <span className="block text-[10px] font-normal text-slate-400">коррекция</span>
                </span>
                <span className={`absolute right-0 ${tipUp} hidden group-hover:block z-30 w-72 p-2.5 rounded-lg bg-slate-800 text-white text-[11px] font-normal leading-snug text-left shadow-xl`}>
                  <span className="block font-bold mb-1">Скорость скорректирована: товар был распродан</span>
                  <span className="block">Было {fmtSpeed(art.speedCorrection.base)} шт/д, стало {fmtSpeed(art.speedCorrection.corrected)} шт/д{art.speedCorrection.base > 0 ? ` (рост в ${art.speedCorrection.factor.toFixed(2)} раза)` : ''}.</span>
                  <span className="block mt-1">Остатка Ozon хватало на {art.speedCorrection.daysLeft.toFixed(1)} дн — меньше порога дефицита, поэтому скорость взята по лучшим неделям, а не по последним.</span>
                  <span className="block mt-1">Лучшие недели окна: {art.speedCorrection.bestWeeks.map((b) => `${b.week} — ${fmtInt(b.qty)} шт`).join('; ')}.</span>
                  <span className="block mt-1 text-slate-300">В окне {art.speedCorrection.windowWeeks} нед: продано {fmtInt(art.speedCorrection.windowQty)} шт, недель с продажами {art.speedCorrection.weeksWithSales}.</span>
                  {art.speedCorrection.capped && (
                    <span className="block mt-1 text-amber-300">Рост упёрся в предел: по лучшим неделям вышло бы {fmtSpeed(art.speedCorrection.raw)} шт/д.</span>
                  )}
                </span>
              </span>
            ) : (
              <span className="cursor-help" title={speedTitle}>{fmtSpeed(art.perDay)}</span>
            )}
            {/* Item 86, step D: a lookback article gets a small visible mark next to the speed. */}
            {art.speedSource === 'lookback' && (
              <span className="block text-[10px] font-semibold text-amber-600 cursor-help" title={speedTitle}>товара долго не было</span>
            )}
            {art.demandGrowth && art.demandGrowth.applied && (
              /* Item 73. The last 7 days beat the window: the speed shown IS the recent one. */
              <span
                className="block text-[10px] font-semibold text-orange-600 cursor-help"
                title={`Спрос вырос: за 7 дней продано ${Math.round(art.demandGrowth.recentQty)} шт (${fmtSpeed(art.demandGrowth.recentPerDay)} шт/д) против ${fmtSpeed(art.demandGrowth.basePerDay)} шт/д по окну. Скорость и рекомендации взяты по последним 7 дням.`}
              >
                спрос +{Math.round(art.demandGrowth.growthPct)} %
              </span>
            )}
          </td>
        )}
        {isColVisible('trend') && (
          <td className="p-3 text-right">
            {!art.trend ? (
              <span className="text-slate-300" title="Продаж за окно тренда нет — тренд не считается.">—</span>
            ) : (
              <span className="relative inline-flex group cursor-help">
                <span className="flex flex-col items-end">
                  <span className={`font-semibold ${art.trend.applied > 1 ? 'text-emerald-600' : art.trend.applied < 1 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {fmtTrend(art.trend.applied)}
                  </span>
                  {art.trend.reason && (
                    <span className="block text-[10px] text-slate-400">{TREND_REASON_SHORT[art.trend.reason]}</span>
                  )}
                </span>
                <span className={`absolute right-0 ${tipUp} hidden group-hover:block z-30 w-96 p-2.5 rounded-lg bg-slate-800 text-white text-[11px] font-normal leading-snug text-left shadow-xl whitespace-normal`}>
                  <span className="block font-bold mb-1">Тренд продаж</span>
                  {art.demandGrowth && art.demandGrowth.applied ? (
                    /* Item 85, step 1.4: the larger of the two, never their product. */
                    <span className="block">
                      Прогноз для заказа на фабрике — большее из двух: по окну с трендом {fmtSpeed(art.demandGrowth.basePerDay)}{' × '}{fmtTrend(art.trend.applied)}{' = '}{fmtSpeed(art.demandGrowth.basePerDay * art.trend.applied)} шт/д и за последние 7 дней {fmtSpeed(art.demandGrowth.recentPerDay)} шт/д
                      {ozonSettings.salesGrowthPct ? `, затем × ${fmtTrend(1 + ozonSettings.salesGrowthPct / 100)}` : ''}
                      {' → '}{fmtSpeed(art.forecastPerDay)} шт/д
                    </span>
                  ) : (
                    <span className="block">
                      Прогноз для заказа на фабрике: {fmtSpeed(art.perDay)}{' × '}{fmtTrend(art.trend.applied)}
                      {ozonSettings.salesGrowthPct ? ` × ${fmtTrend(1 + ozonSettings.salesGrowthPct / 100)}` : ''}
                      {' = '}{fmtSpeed(art.forecastPerDay)} шт/д
                    </span>
                  )}
                  <span className="block mt-1">Расчётный множитель: {fmtTrend(art.trend.raw)}</span>
                  {art.trend.reason && (art.trend.applied !== art.trend.raw || art.trend.reason === 'lookback') && (
                    <span className="block mt-1 text-amber-300">{TREND_REASON_LONG[art.trend.reason](art.trend)}</span>
                  )}
                  {/* Item 86, step D: the trend is rate-adjusted by days in stock, not raw calendar weeks. */}
                  {art.trend.historyBased && (
                    <span className="block mt-1 text-sky-300">Тренд считается по дням наличия, а не по календарным неделям.</span>
                  )}
                  <span className="block mt-1 text-slate-300">
                    Окно: {art.trend.weeks.length} нед, {fmtDateShort(art.trend.weeks[0])}…{fmtDateShort(art.trend.weeks[art.trend.weeks.length - 1])}, продано {fmtInt(art.trend.windowQty)} шт
                  </span>
                  <span className="block mt-1 text-slate-300">
                    {art.trend.weeks.map((w: string, i: number) => `${fmtDateShort(w)} — ${fmtInt(art.trend!.weekQty[i])}`).join('; ')}
                  </span>
                </span>
              </span>
            )}
          </td>
        )}
        {isColVisible('share') && <td className="p-3 text-right text-slate-300">—</td>}
        {isColVisible('available') && <td className={`p-3 text-right font-semibold ${art.totals.available === 0 ? 'text-slate-300' : 'text-slate-900'}`}>{fmtInt(art.totals.available)}</td>}
        {isColVisible('preparing') && <td className={`p-3 text-right ${art.totals.preparing === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.preparing)}</td>}
        {isColVisible('requested') && <td className={`p-3 text-right ${art.totals.requested === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.requested)}</td>}
        {isColVisible('transit') && <td className={`p-3 text-right ${art.totals.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.transit)}</td>}
        {isColVisible('excess') && <td className={`p-3 text-right ${art.totals.excess === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.excess)}</td>}
        {isColVisible('returns') && <td className={`p-3 text-right ${art.totals.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.returns)}</td>}
        {isColVisible('other') && <td className={`p-3 text-right ${art.totals.other === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.other)}</td>}
        {isColVisible('estimated') && <td className="p-3 text-right font-semibold text-slate-800">{fmtInt(art.totalEstimated)}</td>}
        {isColVisible('coverage') && <td className={`p-3 text-right ${TONE_CLASS[coverageTone(art.totalEstimated, art.perDay, ozonSettings)]}`}>{fmtDays(art.coverageDays, art.totalEstimated)}</td>}
        {isColVisible('pending') && (
          <td className="p-3 text-right">
            {art.inFlightTotal > 0 || art.pendingTotal > 0 ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPendingModalArticle(art.article); }}
                className="font-semibold text-sky-600 hover:underline"
                title={`В кластеры этого товара едет ${fmtInt(art.inFlightTotal)} шт — они уже учтены в «Расчётном», и потребность на них уменьшена. На Моём складе под созданные заявки зарезервировано ${fmtInt(art.pendingTotal)} шт. Нажми, чтобы посмотреть список заявок.`}
              >
                {fmtInt(art.inFlightTotal)}
              </button>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </td>
        )}
        {isColVisible('myStock') && (
          <td className="p-3 text-right">
            {art.pendingTotal > 0 ? (
              <span
                className="inline-flex flex-col items-end"
                title={`На складе всего ${fmtInt(art.myStockAvailable)} шт. Из них ${fmtInt(art.pendingTotal)} шт зарезервировано под уже созданные заявки на поставку. Для новых поставок свободно ${fmtInt(art.freeMyStock)} шт — это и есть потолок рекомендации.`}
              >
                <span className="font-semibold text-amber-600">{fmtInt(art.freeMyStock)}</span>
                <span className="text-[10px] text-slate-400 font-normal">из {fmtInt(art.myStockAvailable)} · резерв {fmtInt(art.pendingTotal)}</span>
              </span>
            ) : (
              <span className="text-slate-600">{fmtInt(art.myStockAvailable)}</span>
            )}
          </td>
        )}
        {isColVisible('recommendation') && (
          <td className="p-3 text-right">
            {art.recommendedQty > 0 ? (
              <span
                className={art.recLimited ? 'text-amber-600 font-bold' : 'text-indigo-600 font-bold'}
                title={art.recLimited ? 'Рекомендация урезана: на Моём складе не хватает товара на полную потребность' : undefined}
              >
                {fmtInt(art.recommendedQty)} шт
              </span>
            ) : art.deficitQty > 0 ? (
              <span className="text-red-600 font-bold" title="Кластерам нужна поставка, но на Моём складе нет товара">
                дефицит {fmtInt(art.deficitQty)} шт
              </span>
            ) : (
              <span className="text-slate-300">—</span>
            )}
            {art.recommendedQty > 0 && art.deficitQty > 0 && (
              <span className="block text-[10px] font-bold text-red-500" title="Часть кластеров осталась без поставки: на Моём складе не хватило товара">
                + дефицит {fmtInt(art.deficitQty)} шт
              </span>
            )}
          </td>
        )}
        {/* Item 50. Every state of this cell opens the order window, including the
            states where the calculation asks for nothing: the owner sometimes orders
            anyway and the order must still land in «Заказы на фабрике» and in the ТРУБА.
            The only exception is a virtual kit — its components are ordered instead,
            and their own cells live in the components table below. */}
        {isColVisible('factory') && (
          <td className="p-3 text-right">
            {factoryCell.kind === 'overdue' ? (
              <span className="relative inline-flex group justify-end">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                >
                  просрочен · {fmtDateShort(factoryOverdueList[0].expectedAt)}
                  <span className="block text-[10px] font-semibold text-amber-600">{fmtInt(factoryOverdueQty)} шт · нажми, чтобы решить</span>
                </button>
                <span className="pointer-events-none absolute right-0 top-full mt-1 z-30 hidden group-hover:block w-64 bg-slate-800 text-white text-[11px] font-normal normal-case text-left rounded-xl px-3 py-2 shadow-lg leading-snug whitespace-normal">
                  Заказано {fmtInt(factoryOverdueList[0].qty)} шт ({fmtInt(Math.ceil(factoryOverdueList[0].qty / factoryBox))} кор)<br />
                  Размещён: {fmtDateFull(factoryOverdueList[0].orderedAt)}<br />
                  Ожидается: {fmtDateFull(factoryOverdueList[0].expectedAt)} — срок прошёл<br />
                  {factoryOverdueList[0].comment ? <>Комментарий: {factoryOverdueList[0].comment}<br /></> : null}
                  {factoryOverdueList[0].user ? <>Отметил: {factoryOverdueList[0].user}<br /></> : null}
                  {/* Item 83g: every OTHER active order of the article (e.g. a China row that
                      keeps counting while this manual one is overdue) — the owner needs to
                      see it here too, not just the one this branch is about. */}
                  {factoryList.filter((o) => o.id !== factoryOverdueList[0].id).map((o) => (
                    <React.Fragment key={o.id}>
                      {fmtInt(o.qty)} шт{factoryOrderBadge(o) ? ` · ${factoryOrderBadge(o)}` : ''}
                      {factoryLateLabel(factoryLateById[o.id]) ? ` · ${factoryLateLabel(factoryLateById[o.id])}` : ''}<br />
                    </React.Fragment>
                  ))}
                  Нажми, чтобы изменить заказ или отметить приход партии.
                </span>
              </span>
            ) : factoryCell.kind === 'order' && art.factory ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                className="text-rose-600 font-bold text-right hover:underline"
                title={`Запаса хватит на ${Math.round(art.factory.daysLeft)} дн. при пороге ${Math.round(art.factoryThreshold)} дн. (срок поставки ${art.leadTimeDays || 0} дн. + срок доставки до Ozon ${Number(ozonSettings.deliveryToOzonDays) || 0} дн. + неснижаемый запас). В запас входят остаток на Ozon, Мой склад и заказанное на фабрике ${fmtInt(factoryWaitingQty)} шт. Нажми, чтобы отметить размещённый заказ.\n${factoryOrdersDetail}`}
              >
                {factoryWaitingQty > 0 ? 'дозаказать ' : ''}{fmtInt(factoryOrderQty)} шт
                <span className="block text-[10px] font-semibold text-rose-400">
                  {fmtInt(art.factory.orderBoxes)} кор · {factoryWaitingQty > 0 ? `уже заказано ${fmtInt(factoryWaitingQty)} шт` : `хватит на ${Math.round(art.factory.daysLeft)} дн.`}
                </span>
                {/* Owner, 2026-09-25: an order that does not cover the whole need was invisible
                    here — show every waiting order with its China batch and arrival. */}
                {factoryWaitingList.map((o) => (
                  <span key={o.id} className="block text-[10px] font-semibold text-sky-600">
                    заказ {fmtInt(o.qty)} шт{factoryOrderBadge(o) ? ` · ${factoryOrderBadge(o)}` : ''}{o.expectedAt ? ` · ждём ${fmtDateShort(o.expectedAt)}` : ''}{factoryLateLabel(factoryLateById[o.id]) ? ` · ${factoryLateLabel(factoryLateById[o.id])}` : ''}
                  </span>
                ))}
              </button>
            ) : (factoryCell.kind === 'clusterDeficitWaiting' || factoryCell.kind === 'clusterDeficit') && art.factory ? (
              factoryCell.kind === 'clusterDeficitWaiting' ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                  className="text-[10px] font-semibold text-slate-500 text-right hover:underline"
                  title={`Кластерам нужна поставка на ${fmtInt(art.factory.unmetDeficitQty)} шт, но общего запаса хватает на ${Math.round(art.factory.daysLeft)} дн. с учётом заказанных на фабрике ${fmtInt(factoryWaitingQty)} шт. Товар есть, он лежит в других кластерах, а между кластерами Ozon остаток не перебросить. Заказывать на фабрике не нужно. Нажми, чтобы изменить заказ.\n${factoryOrdersDetail}`}
                >
                  дефицит в кластерах {fmtInt(art.factory.unmetDeficitQty)} шт
                  <span className="block text-[10px] font-normal text-sky-600">заказано {fmtInt(factoryWaitingQty)} шт · ждём {factoryNearest && factoryNearest.expectedAt ? fmtDateShort(factoryNearest.expectedAt) : '—'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                  className="text-[10px] font-semibold text-slate-500 text-right hover:underline"
                  title={`Кластерам нужна поставка на ${fmtInt(art.factory.unmetDeficitQty)} шт, но общего запаса хватает на ${Math.round(art.factory.daysLeft)} дн. Товар есть, он лежит в других кластерах, а между кластерами Ozon остаток не перебросить. Заказывать на фабрике не нужно. Нажми, чтобы всё равно отметить заказ на фабрике.`}
                >
                  дефицит в кластерах {fmtInt(art.factory.unmetDeficitQty)} шт
                  <span className="block text-[10px] font-normal text-slate-400">товар есть, лежит не там</span>
                </button>
              )
            ) : factoryCell.kind === 'waiting' ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                className="text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100"
                title={`Заказано на фабрике ${fmtInt(factoryWaitingQty)} шт. Заказ входит в запас, дозаказывать не нужно. Нажми, чтобы изменить заказ или отметить приход партии.\n${factoryOrdersDetail}`}
              >
                заказано {fmtInt(factoryWaitingQty)} шт
                <span className="block text-[10px] font-semibold text-sky-600">
                  ждём {factoryNearest && factoryNearest.expectedAt ? fmtDateShort(factoryNearest.expectedAt) : '—'}
                  {factoryNearest && factoryOrderBadge(factoryNearest) ? ` · ${factoryOrderBadge(factoryNearest)}` : ''}
                </span>
              </button>
            ) : factoryCell.kind === 'bottleneck' ? (
              <span
                className="text-[10px] font-semibold text-slate-500"
                title={`Комплект на фабрике не заказывают — заказывают его компоненты. Самый дефицитный компонент комплекта: ${bottleneckByKit[art.article].componentSku}. Заказ по нему — в блоке «Заказ на фабрике — компоненты» под таблицей. «Собрать» — сколько комплектов можно собрать из остатков компонентов на Моём складе прямо сейчас.`}
              >
                узкое место: {bottleneckByKit[art.article].componentSku}
                <span className="block text-[10px] font-normal text-slate-400">
                  хватит на {bottleneckByKit[art.article].daysLeft === null ? '∞' : `${Math.round(bottleneckByKit[art.article].daysLeft as number)} дн`} · собрать: {fmtInt(bottleneckByKit[art.article].canAssembleQty)} шт
                </span>
              </span>
            ) : factoryCell.kind === 'noLeadTime' ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                className="text-[10px] font-semibold text-slate-400 text-right hover:underline"
                title="Не заполнена колонка «Срок поставки, дн» в SKU Базе. Пока она пуста, сигнал по общему остатку сработает только при падении ниже неснижаемого запаса. Нажми, чтобы всё равно отметить заказ на фабрике."
              >
                срок не задан
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                className="text-slate-300 hover:text-slate-500 hover:underline"
                title={
                  (art.factoryDaysLeft === null
                    ? 'Продаж за расчётное окно нет — сигнал не считается.'
                    : `Заказ не нужен: запаса хватит на ${Math.round(art.factoryDaysLeft)} дн. при пороге ${Math.round(art.factoryThreshold)} дн., непокрытой потребности у кластеров нет.`) +
                  ' Нажми, чтобы всё равно отметить заказ на фабрике.'
                }
              >
                не нужно
              </button>
            )}
          </td>
        )}
        {isColVisible('orderCost') && (
          <td className="p-3 text-right">
            {factoryOrderQty > 0 && getOrderUnitCost(art.article).price > 0 ? (
              <span
                className="font-semibold text-slate-700"
                title={`${fmtInt(factoryOrderQty)} шт по ${getOrderUnitCost(art.article).price.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽ за штуку — ${getOrderUnitCost(art.article).source}.`}
              >
                {Math.round(factoryOrderQty * getOrderUnitCost(art.article).price).toLocaleString('ru-RU')}
              </span>
            ) : (
              <span className="text-slate-300" title={factoryOrderQty > 0 ? 'Цена неизвестна: товар ещё ни разу не приходил на склад.' : 'Заказывать нечего.'}>—</span>
            )}
          </td>
        )}
      </tr>

      {/* LEVEL 2: CLUSTERS (with their LEVEL 3 warehouses) */}
      {isArtExpanded && displayClusters.map((cls) => (
        <OzonCoverageClusterRow
          key={`${art.article}:::${cls.clusterId}`}
          art={art}
          cls={cls}
          tipUp={tipUp}
          isColVisible={isColVisible}
          isClsExpanded={!!expandedClusters[`${art.article}:::${cls.clusterId}`]}
          onToggleCluster={onToggleCluster}
          manualMode={manualMode}
          manualQty={manualQty}
          toggleManualPick={toggleManualPick}
          changeManualQty={changeManualQty}
          directRules={directRules}
          manualClusterIds={manualClusterIds}
          manualCabinetSets={manualCabinetSets}
          uniqueCabinetsCount={uniqueCabinetsCount}
          ozonSettings={ozonSettings}
        />
      ))}

      {/* LEVEL 2: UNBOUND (без кластера) */}
      {isArtExpanded && art.unboundRows.length > 0 && (
        <tr className="border-b border-slate-100 bg-slate-50/70" id={`ozon-unbound-row-${art.article}`}>
          <td className="p-2.5 pl-8">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-500 text-[11px]">Без кластера (агрегат)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-slate-200 text-slate-600">не в рекомендациях</span>
            </div>
          </td>
          {isColVisible('sold') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundQtySold)}</td>}
          {isColVisible('speed') && <td className="p-2.5 text-right text-slate-300">—</td>}
          {isColVisible('trend') && <td className="p-2.5 text-right text-slate-300">—</td>}
          {isColVisible('share') && <td className="p-2.5 text-right text-slate-300">—</td>}
          {isColVisible('available') && <td className="p-2.5 text-right text-slate-700">{fmtInt(art.unboundTotals.available)}</td>}
          {isColVisible('preparing') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.preparing)}</td>}
          {isColVisible('requested') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.requested)}</td>}
          {isColVisible('transit') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.transit)}</td>}
          {isColVisible('excess') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.excess)}</td>}
          {isColVisible('returns') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.returns)}</td>}
          {isColVisible('other') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.other)}</td>}
          {isColVisible('estimated') && <td className="p-2.5 text-right font-medium text-slate-700">{fmtInt(art.unboundEstimated)}</td>}
          {isColVisible('coverage') && <td className="p-2.5 text-right text-slate-300">—</td>}
          {isColVisible('pending') && (
            <td className="p-2.5 text-right">
              {(unboundInFlightByArticle[art.article] || 0) > 0 ? (
                <span className="text-slate-600" title="Заявки, у которых Ozon не вернул кластер. В кластерные рекомендации они не идут, но в общий итог товара и в трубу фабрики входят.">
                  {fmtInt(unboundInFlightByArticle[art.article] || 0)}
                </span>
              ) : (
                <span className="text-slate-300">—</span>
              )}
            </td>
          )}
          {isColVisible('myStock') && <td className="p-2.5 text-right text-slate-300">—</td>}
          {isColVisible('recommendation') && <td className="p-2.5 text-right text-slate-300">—</td>}
          {isColVisible('factory') && <td className="p-2.5 text-right text-slate-300">—</td>}
          {isColVisible('orderCost') && <td className="p-2.5 text-right text-slate-300">—</td>}
        </tr>
      )}
    </React.Fragment>
  );
};
