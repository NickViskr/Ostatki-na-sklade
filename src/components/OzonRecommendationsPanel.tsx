// Item 88, ticket 05: the «Рекомендации» panel — supply recommendations per cluster and factory
// order recommendations — moved out of OzonStocksTab.tsx verbatim. Draws only; the tab model
// computes `recommendations` and `supplyPlan`, the screen keeps the tick state and handlers.
import React from 'react';
import { Calculator, ChevronDown, ChevronRight } from 'lucide-react';
import { disabledReason, isClusterSelectable, DirectClusterRule } from '../lib/ozonDirectSupply';
import { cabinetDisabledReason, isCabinetCompatible } from '../lib/ozonSupplyCabinet';
import { canTickCluster } from '../lib/ozonSupplyLines';
import { OzonStocksRecommendations, SupplyPlan } from '../lib/ozonStocksTabModel';
import { OzonSupplySettingsShape, fmtInt } from './ozonStocksFormat';

interface OzonRecommendationsPanelProps {
  recommendations: OzonStocksRecommendations;
  showRecommendations: boolean;
  onToggleShowRecommendations: () => void;
  supplyPlan: SupplyPlan;
  supplySettings: OzonSupplySettingsShape;
  onClearSupplySelection: () => void;
  onOpenSupplySummary: () => void;
  selectedSupply: Record<string, boolean>;
  onToggleSupplyRow: (article: string, clusterId: string) => void;
  directRules: DirectClusterRule[];
  selectedClusterIds: string[];
  selectedCabinetSets: string[][];
  cabinetsByArticleMap: Record<string, string[]>;
  wideWeeks: number;
  speedWeeks: number;
  onToggleWideArticle: (article: string) => void;
  isAdmin: boolean;
  onGoToChinaForecast: () => void;
  setFactoryModalArticle: (article: string) => void;
}

export const OzonRecommendationsPanel: React.FC<OzonRecommendationsPanelProps> = ({
  recommendations, showRecommendations, onToggleShowRecommendations, supplyPlan, supplySettings,
  onClearSupplySelection, onOpenSupplySummary, selectedSupply, onToggleSupplyRow, directRules,
  selectedClusterIds, selectedCabinetSets, cabinetsByArticleMap, wideWeeks, speedWeeks,
  onToggleWideArticle, isAdmin, onGoToChinaForecast, setFactoryModalArticle,
}) => {
  const supplyKey = (article: string, clusterId: string) => `${article}|||${clusterId}`;

  if (recommendations.supplies.length === 0 && recommendations.factories.length === 0 && recommendations.orderedCount === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4" id="ozon-recommendations">
      <button
        type="button"
        onClick={onToggleShowRecommendations}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
          {showRecommendations ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
          Рекомендации
        </span>
        <span className="text-[11px] text-slate-400">
          поставок: {recommendations.supplies.length} · заказов на фабрике: {recommendations.factories.length}
        </span>
      </button>
      {showRecommendations && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Отвезти на Ozon</div>

            {supplyPlan.rows.length > 0 && (
              <div className="mb-3 p-3 rounded-xl bg-indigo-50 border border-indigo-200">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] font-semibold text-indigo-900">
                    Выбрано: {supplyPlan.rows.length} строк · {fmtInt(supplyPlan.totalBoxes)} кор ({fmtInt(supplyPlan.totalQty)} шт) · кластеров: {supplyPlan.clusters.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onClearSupplySelection}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      Снять всё
                    </button>
                    <button
                      type="button"
                      id="btn-ozon-create-supply"
                      onClick={onOpenSupplySummary}
                      disabled={supplyPlan.cabinets.length > 1 || !supplySettings.dropOffWarehouseId}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-bold transition-colors"
                    >
                      Оформить поставку
                    </button>
                  </div>
                </div>

                {supplyPlan.cabinets.length > 1 && (
                  <div className="mt-2 text-[11px] font-semibold text-red-700">
                    Выбраны товары из разных магазинов ({supplyPlan.cabinets.join(', ')}). Заявка создаётся в одном магазине — отфильтруйте магазин выше.
                  </div>
                )}

                {supplyPlan.overLimit.length > 0 && (
                  <div className="mt-2 text-[11px] font-semibold text-amber-700">
                    Превышен лимит {supplyPlan.limit} кор на кластер: {supplyPlan.overLimit.map((c) => `${c.clusterName} — ${c.boxes} кор`).join('; ')}. Остаток лучше оформить отдельной заявкой.
                  </div>
                )}

                {!supplySettings.dropOffWarehouseId && (
                  <div className="mt-2 text-[11px] font-semibold text-red-700">
                    Не выбрана точка отгрузки — укажите её в настройках Ozon.
                  </div>
                )}
              </div>
            )}


            {recommendations.supplies.length === 0 ? (
              <div className="text-[11px] text-slate-400">Запасы кластеров в норме.</div>
            ) : (
              <div className="flex flex-col gap-3">
                {recommendations.supplies.map((s) => (
                  <div key={s.article} className="border border-slate-100 rounded-xl p-3 bg-slate-50/60">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono font-bold text-slate-800 text-[12px]">{s.article}</span>
                      <span
                        className="text-[11px] text-slate-400 shrink-0"
                        title={s.pendingTotal > 0 ? `На складе всего ${fmtInt(s.myStockAvailable)} шт, из них ${fmtInt(s.pendingTotal)} шт зарезервировано под уже созданные заявки. Свободно для новых поставок ${fmtInt(s.freeMyStock)} шт.` : undefined}
                      >
                        свободно {fmtInt(s.freeMyStock)} шт
                        {s.pendingTotal > 0 && <span className="text-amber-500"> (из {fmtInt(s.myStockAvailable)})</span>}
                        {/* Item 85, step 1.6: a shared component is split between the kits. */}
                        {s.sharedLimitedBy.length > 0 && s.shippableMyStock < s.freeMyStock && (
                          <span
                            className="block text-orange-600"
                            title={`Компоненты ${s.sharedLimitedBy.join(', ')} общие с другими комплектами, и на все их потребности не хватает. Они поделены между комплектами пропорционально потребности кластеров; этому товару досталось на ${fmtInt(s.shippableMyStock)} шт.`}
                          >
                            доля общих компонентов: {fmtInt(s.shippableMyStock)} шт
                          </span>
                        )}
                      </span>
                    </div>
                    {s.name && <div className="text-[11px] text-slate-500 truncate" title={s.name}>{s.name}</div>}

                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleWideArticle(s.article)}
                        title={s.wide
                          ? `Вернуться к обычному расчёту: окно скорости ${speedWeeks} нед.`
                          : `Пересчитать распределение по окну тренда — ${wideWeeks} нед. Кластеры, продававшие до того, как товар кончился, вернутся в распределение.`}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                          s.wide
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {s.wide ? `по окну тренда, ${wideWeeks} нед.` : 'Распределить весь остаток'}
                      </button>
                      {s.wide && s.leftover > 0 && (
                        <span className="text-[10px] text-slate-400 shrink-0" title="Расчёт разложил не весь свободный остаток: потребности кластеров за окно тренда на него не хватило">
                          не разложено {fmtInt(s.leftover)} шт
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-col gap-1">
                      {s.clusters.map((c) => {
                        // `buildRecommendations` filters this list to rows whose recommendation
                        // is not null (boxes > 0 or needQty > 0) — the same guarantee the
                        // original JSX relied on without checking. The guard below only tells
                        // TypeScript that; it never actually returns null.
                        if (!c.recommendation) return null;
                        return (
                        <div key={c.clusterId} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-slate-600 truncate flex items-center gap-1.5" title={c.clusterName}>
                            {canTickCluster(c.recommendation.boxes, c.needBoxes) && (
                              <input
                                type="checkbox"
                                checked={Boolean(selectedSupply[supplyKey(s.article, c.clusterId)])}
                                onChange={() => onToggleSupplyRow(s.article, c.clusterId)}
                                disabled={
                                  !isClusterSelectable(directRules, selectedClusterIds, String(c.clusterId)) ||
                                  !isCabinetCompatible(selectedCabinetSets, cabinetsByArticleMap[s.article] || [])
                                }
                                className="shrink-0 w-3.5 h-3.5 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                title={
                                  disabledReason(directRules, selectedClusterIds, String(c.clusterId)) ||
                                  cabinetDisabledReason(selectedCabinetSets, cabinetsByArticleMap[s.article] || []) ||
                                  (c.recommendation.boxes > 0
                                    ? 'Включить в заявку на поставку'
                                    : 'Добавить кластер в заявку с нулём: количество распределите сами в окне оформления')
                                }
                              />
                            )}
                            {c.clusterName}
                            {c.priority && <span className="ml-1 text-amber-600 font-bold">×{c.priorityK}</span>}
                          </span>
                          {c.recommendation.boxes > 0 ? (
                            <span className={`shrink-0 text-right font-semibold ${c.recommendation.limitedByMyStock ? 'text-amber-600' : 'text-indigo-600'}`}>
                              {fmtInt(c.recommendation.boxes)} кор ({fmtInt(c.recommendation.qty)} шт)
                              {c.recommendation.partialByMaxDays && (
                                <span
                                  className="block text-[10px] font-normal text-slate-500"
                                  title={`Полная коробка дала бы кластеру запас на ${fmtInt(c.recommendation.fullBoxDays)} дн — дольше настройки «Максимальный срок продаж кластера, дней». Везём ровно столько, сколько нужно до целевого запаса.`}
                                >
                                  неполная: полная коробка = запас на {fmtInt(c.recommendation.fullBoxDays)} дн
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="shrink-0 font-semibold text-red-600">
                              нужно {fmtInt(c.needBoxes)} кор — нет на складе
                            </span>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Заказать на фабрике</div>
              {isAdmin && recommendations.factories.length > 0 && (
                <button
                  type="button"
                  data-testid="btn-china-forecast-prefill"
                  onClick={onGoToChinaForecast}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                  title="Открыть прогноз поставки в модуле «Заказы в Китае» с этими артикулами и количествами"
                >
                  <Calculator size={12} /> Прогноз Китай
                </button>
              )}
            </div>
            {recommendations.factories.length === 0 ? (
              <div className="text-[11px] text-slate-400">
                Заказывать пока нечего.
                {recommendations.orderedCount > 0 && <span className="block text-sky-700">Размещённых заказов на фабрике: {recommendations.orderedCount}.</span>}
                {recommendations.clusterDeficitCount > 0 && <span className="block text-slate-500">Дефицит в кластерах: {recommendations.clusterDeficitCount} товаров — товар есть, лежит не там.</span>}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recommendations.factories.map((f) => (
                  <button
                    key={f.article}
                    type="button"
                    onClick={() => setFactoryModalArticle(f.article)}
                    className="text-left border border-rose-100 bg-rose-50/60 rounded-xl p-3 hover:bg-rose-50 transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono font-bold text-slate-800 text-[12px]">{f.article}</span>
                      <span className="text-rose-600 font-bold text-[12px] shrink-0">
                        {fmtInt(f.factory.orderQty)} шт ({fmtInt(f.factory.orderBoxes)} кор)
                      </span>
                    </div>
                    {f.name && <div className="text-[11px] text-slate-500 truncate" title={f.name}>{f.name}</div>}
                    <div className="text-[11px] text-slate-500 mt-1">
                      Хватит на {Math.round(f.factory.daysLeft)} дн. · срок поставки {f.leadTimeDays || 0} дн. · {f.factory.reason === 'clusterDeficit' ? 'нечем пополнить кластеры' : 'кончается везде'}
                    </div>
                  </button>
                ))}
                {recommendations.orderedCount > 0 && (
                  <div className="text-[11px] text-sky-700">Размещённых заказов на фабрике: {recommendations.orderedCount} товаров, они уже учтены в расчёте.</div>
                )}
                {recommendations.clusterDeficitCount > 0 && (
                  <div className="text-[11px] text-slate-500">Дефицит в кластерах: {recommendations.clusterDeficitCount} товаров — товар есть, лежит не там, заказывать не нужно.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
