// Item 88, ticket 05: the coverage table — search/filters, the manual-supply summary bar, the
// table head and the per-article rows — moved out of OzonStocksTab.tsx verbatim.
import React from 'react';
import { Minimize2, Search } from 'lucide-react';
import { FactoryOrder } from '../types';
import type { KitBottleneck, OzonCoverageSettings } from '../lib/ozonCoverage';
import { ManualPick, ManualPlan } from '../lib/ozonManualSupply';
import { DirectClusterRule } from '../lib/ozonDirectSupply';
import { CoverageTabRow, FactoryCellState, SupplyClusterRef, ClusterShares } from '../lib/ozonStocksTabModel';
import { fmtInt, ColHint, OzonSupplySettingsShape } from './ozonStocksFormat';
import { OzonCoverageRow } from './OzonCoverageRow';

interface OzonCoverageTableProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  ozonStocksCabinets: string[];
  cabinetFilter: string;
  onCabinetChange: (value: string) => void;
  onlyWithRecommendations: boolean;
  onOnlyWithRecommendationsChange: (value: boolean) => void;
  visibleRows: CoverageTabRow[];
  coverageRowsCount: number;
  manualMode: boolean;
  manualPlan: ManualPlan;
  supplySettings: OzonSupplySettingsShape;
  onOpenManualSummary: () => void;
  isFullscreen: boolean;
  onExitFullscreen: () => void;
  isColVisible: (key: string) => boolean;
  expandedArticles: Record<string, boolean>;
  onToggleArticle: (article: string) => void;
  expandedClusters: Record<string, boolean>;
  onToggleCluster: (key: string) => void;
  uniqueCabinetsCount: number;
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

export const OzonCoverageTable: React.FC<OzonCoverageTableProps> = ({
  searchQuery, onSearchChange, ozonStocksCabinets, cabinetFilter, onCabinetChange,
  onlyWithRecommendations, onOnlyWithRecommendationsChange, visibleRows, coverageRowsCount,
  manualMode, manualPlan, supplySettings, onOpenManualSummary, isFullscreen, onExitFullscreen,
  isColVisible, expandedArticles, onToggleArticle, expandedClusters, onToggleCluster,
  uniqueCabinetsCount, manualPicks, manualQty, toggleManualPick, changeManualQty, directRules,
  manualClusterIds, manualCabinetSets, supplyClusterRefs, clusterShares,
  factoryOrdersByArticle, hiddenManualByArticle, factoryCellByArticle, factoryLateById,
  bottleneckByKit, ozonSettings, unboundInFlightByArticle, getOrderUnitCost, setFactoryModalArticle,
  setPendingModalArticle, onResolveFactoryConflict,
}) => (
  <>
    {/* Table / List */}
    <div className="bg-white rounded-2xl border border-slate-200 p-3 mb-3 flex flex-wrap items-center gap-3" id="ozon-stocks-filters">
      <div className="relative flex-1 min-w-[200px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          id="ozon-search-input"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по артикулу или названию"
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
        />
      </div>
      {ozonStocksCabinets.length > 1 && (
        <select
          id="ozon-cabinet-filter"
          value={cabinetFilter}
          onChange={(e) => onCabinetChange(e.target.value)}
          className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="all">Все магазины</option>
          {ozonStocksCabinets.map((cab: string) => (
            <option key={cab} value={cab}>{cab}</option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none" id="ozon-only-rec-toggle">
        <input
          type="checkbox"
          checked={onlyWithRecommendations}
          onChange={(e) => onOnlyWithRecommendationsChange(e.target.checked)}
          className="rounded border-slate-300"
        />
        Только с рекомендациями
      </label>
      <span className="text-[11px] text-slate-400 ml-auto">
        Показано товаров: {visibleRows.length} из {coverageRowsCount}
      </span>
    </div>

    {/* Пункт 63. Итог ручного выбора и вход в мастер. Заявка идёт тем же путём,
        что и из рекомендаций, — это тот же мастер оформления. */}
    {manualMode && (
      <div className="p-3 rounded-2xl border border-indigo-200 bg-indigo-50 flex flex-col gap-2" id="ozon-manual-supply-bar">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs font-semibold text-indigo-900">
            {manualPlan.rows.length === 0
              ? 'Отметьте кластеры у нужных товаров и задайте количество'
              : `Выбрано: ${manualPlan.rows.length} строк · ${fmtInt(manualPlan.totalQty)} шт (${fmtInt(manualPlan.totalBoxes)} кор) · кластеров: ${manualPlan.clusters.length}`}
          </span>
          <button
            type="button"
            id="btn-ozon-manual-supply-create"
            disabled={
              manualPlan.rows.length === 0
              || manualPlan.cabinets.length > 1
              || manualPlan.over.length > 0
              || !supplySettings.dropOffWarehouseId
            }
            onClick={onOpenManualSummary}
            className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Оформить поставку
          </button>
        </div>
        {manualPlan.cabinets.length > 1 && (
          <div className="text-[11px] text-amber-700">
            Выбраны товары из разных магазинов ({manualPlan.cabinets.join(', ')}). Заявка создаётся в одном магазине — снимите лишние галочки.
          </div>
        )}
        {manualPlan.over.map((o) => (
          <div key={o.article} className="text-[11px] text-red-600">
            {o.article}: назначено {fmtInt(o.asked)} шт, а свободно {fmtInt(o.free)} шт. Остаток изменился — уменьшите количество.
          </div>
        ))}
        {!supplySettings.dropOffWarehouseId && (
          <div className="text-[11px] text-amber-700">Не выбрана точка отгрузки — укажите её в настройках Ozon.</div>
        )}
      </div>
    )}

    {visibleRows.length === 0 ? (
      <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-sm text-slate-500" id="ozon-stocks-empty">
        Данных пока нет. Нажмите „Обновить", чтобы загрузить остатки со складов Ozon.
      </div>
    ) : (
      <div
        className={`bg-white border border-slate-200 shadow-sm ${isFullscreen ? 'fixed inset-0 z-50 rounded-none overflow-hidden flex flex-col' : 'rounded-2xl overflow-hidden'}`}
        id="ozon-stocks-table-container"
      >
        {isFullscreen && (
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
            <span className="text-sm font-bold text-slate-800">Остатки на складах Ozon</span>
            <button
              type="button"
              id="btn-ozon-fullscreen-exit"
              onClick={onExitFullscreen}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all"
            >
              <Minimize2 size={14} />
              Свернуть (Esc)
            </button>
          </div>
        )}
        <div className={`overflow-auto ${isFullscreen ? 'flex-1 min-h-0' : 'max-h-[70vh]'}`}>
          <style>{`
                    #ozon-stocks-table thead th {
                      position: sticky;
                      top: 0;
                      z-index: 20;
                      background-color: #f1f5f9;
                      box-shadow: inset 0 -1px 0 #e2e8f0;
                    }
                  `}</style>
          <table className="w-full text-left border-collapse text-xs" id="ozon-stocks-table">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold">
                <th className="p-3 min-w-[220px]">
                  Товар / Кластер / Склад
                  <ColHint text="Три уровня: строка товара — итог по всем складам Ozon; строка кластера — регион доставки; строка склада — конкретный склад Ozon внутри кластера. Нажми на строку, чтобы раскрыть уровень ниже." />
                </th>
                {isColVisible('sold') && (
                  <th className="p-3 text-right">
                    Продано
                    <ColHint text="Сколько штук продано за расчётное окно: полные недели из настройки «Недель для расчёта скорости» плюс текущая неделя с понедельника по момент последнего опроса Ozon. Продажи берутся из отчёта Ozon, не из твоих отгрузок." />
                  </th>
                )}
                {isColVisible('speed') && (
                  <th className="p-3 text-right">
                    Скорость
                    <ColHint text="Средние продажи в штуках за день: продано за окно ÷ число дней окна (полные недели × 7 + прошедшие дни текущей недели). На этой скорости строятся покрытие и рекомендации." />
                  </th>
                )}
                {isColVisible('trend') && (
                  <th className="p-3 text-right">
                    Тренд
                    <ColHint text="Тренд — направление спроса за окно тренда, посчитанное линейной регрессией по недельному ряду и переведённое в месячный множитель. Применяется ТОЛЬКО к заказу на фабрике: прогнозная скорость = фактическая × тренд × (1 + прирост объёма продаж). Рекомендации на поставку в кластеры Ozon считаются по фактической скорости и от тренда не зависят. Множитель ограничен диапазоном 0,7…1,5 и гасится до 1,00 пятью фильтрами — наведи курсор на значение, там написана причина." />
                  </th>
                )}
                {isColVisible('share') && (
                  <th className="p-3 text-right">
                    Доля
                    <ColHint text="Какую часть продаж товара даёт этот кластер за окно тренда (настройка «Окно тренда», недель). Скорость кластера = скорость товара × эта доля, поэтому кластер, который недавно стоял пустым, не теряет свою долю." />
                  </th>
                )}
                {isColVisible('available') && (
                  <th className="p-3 text-right">
                    Доступно
                    <ColHint text="Товар лежит на складе Ozon и продаётся прямо сейчас." />
                  </th>
                )}
                {isColVisible('preparing') && (
                  <th className="p-3 text-right">
                    Готовим
                    <ColHint text="Ozon готовит товар к отгрузке покупателю: он уже зарезервирован и в продаже не участвует." />
                  </th>
                )}
                {isColVisible('requested') && (
                  <th className="p-3 text-right">
                    В заявках
                    <ColHint text="Товар заявлен к вывозу или перемещению по заявке в личном кабинете Ozon." />
                  </th>
                )}
                {isColVisible('transit') && (
                  <th className="p-3 text-right">
                    В пути
                    <ColHint text="Товар едет на склад Ozon и скоро встанет в продажу. Учитывается в расчётном остатке." />
                  </th>
                )}
                {isColVisible('excess') && (
                  <th className="p-3 text-right">
                    Излишки
                    <ColHint text="Товар, найденный складом Ozon сверх принятого количества. В расчётный остаток не входит." />
                  </th>
                )}
                {isColVisible('returns') && (
                  <th className="p-3 text-right">
                    Возвраты
                    <ColHint text="Возвраты от покупателей на складе Ozon. В расчётный остаток попадает не весь объём, а доля, заданная в настройках полем «% возвратов, возвращающихся в продажу». Товар, который Ozon готовит к вывозу вам по вашей заявке, сюда не входит — он в «Прочем»." />
                  </th>
                )}
                {isColVisible('other') && (
                  <th className="p-3 text-right">
                    Прочее
                    <ColHint text="Остальные состояния товара на складе Ozon: вывоз к вам по вашей заявке, брак, утилизация, разбирательства. В расчётный остаток не входит." />
                  </th>
                )}
                {isColVisible('estimated') && (
                  <th className="p-3 text-right">
                    Расчётный
                    <ColHint text="На сколько штук реально можно рассчитывать: доступно + доля возвратов + то, что уже едет в кластер (колонка «Едет»). Именно эта величина сравнивается с целевым запасом." />
                  </th>
                )}
                {isColVisible('coverage') && (
                  <th className="p-3 text-right">
                    Покрытие
                    <ColHint text="На сколько дней хватит расчётного остатка сверх неснижаемого запаса. В расчётный остаток входит и то, что уже едет в кластер по заявкам. Красный — поставка, отправленная сегодня, всё равно приедет уже после того, как запас упадёт ниже неснижаемого (учитывает «Срок доставки до Ozon»); жёлтый — ниже целевого, и по кластеру есть рекомендация поставки; зелёный — норма. У приоритетного кластера оба порога умножены на его коэффициент (срок доставки — нет, он не зависит от приоритета). «∞» означает, что продаж нет, а остаток есть." />
                  </th>
                )}
                {isColVisible('pending') && (
                  <th className="p-3 text-right">
                    Едет
                    <ColHint text="Сколько штук уже едет в кластер. Считается двумя способами: по нашим созданным заявкам (от создания до начала приёмки на складе Ozon) и по колонкам Ozon «В пути» + «В заявках». Берётся большее из двух, а не сумма — это одни и те же поставки: наши статусы свежее, а данные остатков Ozon обновляет с опозданием до полусуток. Эти штуки входят в «Расчётный» и уменьшают потребность сразу после создания заявки. Нажми на число у товара — откроется список заявок." />
                  </th>
                )}
                {isColVisible('myStock') && (
                  <th className="p-3 text-right">
                    Мой склад
                    <ColHint text="Сколько штук этого артикула свободно на твоём складе для НОВЫХ поставок. Это потолок рекомендации. Если часть остатка уже зарезервирована под созданные заявки, крупная цифра — свободный остаток, а под ней мелким шрифтом общий остаток и размер резерва. Резерв нужен, чтобы одну и ту же партию не порекомендовало отвезти второй раз в другой кластер. Для виртуальных комплектов остаток считается по компонентам." />
                  </th>
                )}
                {isColVisible('recommendation') && (
                  <th className="p-3 text-right">
                    Рекомендация
                    <ColHint text="Сколько отвезти в кластер, чтобы вернуть запас к целевому, с учётом времени на дорогу до Ozon. Неснижаемый остаток входит внутрь целевого запаса, а не прибавляется к нему; срок доставки — прибавляется поверх целевого запаса (настройка «Срок доставки до Ozon, дней»): пока коробка едет, кластер продолжает продавать. Кратно коробке, кроме двух случаев: медленному кластеру, которому целая коробка дала бы запас дольше настройки «Максимальный срок продаж кластера, дней» (считается уже ПОСЛЕ приезда поставки), предлагается неполная коробка ровно на потребность, и неполная коробка предлагается тогда, когда на складе не набирается целой. Синий — везём полностью, оранжевый — поставка урезана нехваткой на твоём складе, красный — потребность есть, но везти нечего: на складе пусто. У товара показана сумма по всем его кластерам." />
                  </th>
                )}
                {isColVisible('factory') && (
                  <th className="p-3 text-right">
                    Заказ на фабрике
                    <ColHint text="Сигнал «пора заказывать новую партию». Загорается по одной из двух причин: «кончается везде» — товара на Ozon и на твоём складе вместе хватит меньше, чем на срок поставки с фабрики плюс срок доставки до Ozon плюс неснижаемый запас; «нечем пополнить» — кластерам нужна поставка, а на твоём складе пусто, и перебросить остаток между кластерами Ozon нельзя. Объём заказа — больший из расчёта по настройке «Объём заказа на фабрике, дней» и непокрытой потребности кластеров. Наведи курсор на ячейку: там видно, на сколько дней хватит запаса и какой порог срабатывания." />
                  </th>
                )}
                {isColVisible('orderCost') && (
                  <th className="p-3 text-right">
                    Стоимость заказа, ₽
                    <ColHint text="Сколько денег нужно на заказ: объём заказа умножен на цену последнего поступления товара на склад. Средняя себестоимость здесь не используется — она искажена накопленной капитализацией. У виртуального комплекта цена складывается из цен компонентов по нормам. Наведи курсор на цифру: там видно цену за штуку и дату поступления, из которого она взята." />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((art, rowIdx) => (
                <OzonCoverageRow
                  key={art.article}
                  art={art}
                  rowIdx={rowIdx}
                  isColVisible={isColVisible}
                  isArtExpanded={!!expandedArticles[art.article]}
                  onToggleArticle={onToggleArticle}
                  expandedClusters={expandedClusters}
                  onToggleCluster={onToggleCluster}
                  uniqueCabinetsCount={uniqueCabinetsCount}
                  manualMode={manualMode}
                  manualPicks={manualPicks}
                  manualQty={manualQty}
                  toggleManualPick={toggleManualPick}
                  changeManualQty={changeManualQty}
                  directRules={directRules}
                  manualClusterIds={manualClusterIds}
                  manualCabinetSets={manualCabinetSets}
                  supplyClusterRefs={supplyClusterRefs}
                  clusterShares={clusterShares}
                  factoryOrdersByArticle={factoryOrdersByArticle}
                  hiddenManualByArticle={hiddenManualByArticle}
                  factoryCellByArticle={factoryCellByArticle}
                  factoryLateById={factoryLateById}
                  bottleneckByKit={bottleneckByKit}
                  ozonSettings={ozonSettings}
                  unboundInFlightByArticle={unboundInFlightByArticle}
                  getOrderUnitCost={getOrderUnitCost}
                  setFactoryModalArticle={setFactoryModalArticle}
                  setPendingModalArticle={setPendingModalArticle}
                  onResolveFactoryConflict={onResolveFactoryConflict}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}
  </>
);
