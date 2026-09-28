// Item 88, ticket 05: the settings modal, both supply modals, the factory modal and the «В
// заявках» pending modal — moved out of OzonStocksTab.tsx verbatim. Draws only; every value
// comes from the tab model or from the screen's own UI state.
import React from 'react';
import { FactoryOrder } from '../types';
import { OzonSettingsModal } from './OzonSettingsModal';
import { FactoryOrderModal } from './FactoryOrderModal';
import { OzonSupplyModal, SupplyStockOption } from './OzonSupplyModal';
import { resolveSupplyCabinet } from '../lib/ozonSupplyCabinet';
import { getStatusDetails } from '../lib/ozonStatus';
import type { OzonCoverageSettings } from '../lib/ozonCoverage';
import type { OzonSettingsImpact } from '../lib/ozonSettingsImpact';
import { PendingSupplyDetail } from '../lib/ozonPending';
import { FactoryModalRow, SupplyPlan, ClusterShares } from '../lib/ozonStocksTabModel';
import { ManualPlan } from '../lib/ozonManualSupply';
import { OzonSupplySettingsShape, fmtInt, fmtDateFull } from './ozonStocksFormat';

interface OzonStocksModalsProps {
  showSettings: boolean;
  onCloseSettings: () => void;
  computeSettingsImpact: (settings: OzonCoverageSettings) => OzonSettingsImpact | null;

  supplySummaryOpen: boolean;
  onCloseSupplySummary: () => void;
  supplyPlan: SupplyPlan;
  supplyStockOptions: SupplyStockOption[];
  selectedCabinetSets: string[][];
  cabinetFilter: string;
  clusterShares: ClusterShares;
  supplySettings: OzonSupplySettingsShape;
  setSelectedSupply: (value: Record<string, boolean>) => void;
  exitManualMode: () => void;

  manualSummaryOpen: boolean;
  onCloseManualSummary: () => void;
  manualPlan: ManualPlan;
  manualCabinetSets: string[][];
  setManualSummaryOpen: (value: boolean) => void;

  factoryModalArticle: string | null;
  onCloseFactoryModal: () => void;
  factoryModalRow: FactoryModalRow | null;
  activeFactoryOrders: Record<string, FactoryOrder>;
  factoryOrdersByArticle: Record<string, FactoryOrder[]>;
  hiddenManualByArticle: Record<string, FactoryOrder[]>;
  onResolveFactoryConflict: (order: FactoryOrder, same: boolean) => void;

  pendingModalArticle: string | null;
  onClosePendingModal: () => void;
  pendingModalRows: PendingSupplyDetail[];
  clusterNameById: Record<string, string>;
}

export const OzonStocksModals: React.FC<OzonStocksModalsProps> = ({
  showSettings, onCloseSettings, computeSettingsImpact,
  supplySummaryOpen, onCloseSupplySummary, supplyPlan, supplyStockOptions, selectedCabinetSets,
  cabinetFilter, clusterShares, supplySettings, setSelectedSupply, exitManualMode,
  manualSummaryOpen, onCloseManualSummary, manualPlan, manualCabinetSets, setManualSummaryOpen,
  factoryModalArticle, onCloseFactoryModal, factoryModalRow, activeFactoryOrders,
  factoryOrdersByArticle, hiddenManualByArticle, onResolveFactoryConflict,
  pendingModalArticle, onClosePendingModal, pendingModalRows, clusterNameById,
}) => (
  <>
    <OzonSettingsModal isOpen={showSettings} onClose={onCloseSettings} openBlocks={['supply', 'factory']} computeImpact={computeSettingsImpact} />
    <OzonSupplyModal
      isOpen={supplySummaryOpen && supplyPlan.rows.length > 0}
      onClose={onCloseSupplySummary}
      rows={supplyPlan.rows}
      stockOptions={supplyStockOptions}
      cabinet={resolveSupplyCabinet(selectedCabinetSets) || (cabinetFilter !== 'all' ? cabinetFilter : '')}
      clusterSalesShare={clusterShares.byClusterId}
      dropOffWarehouseId={supplySettings.dropOffWarehouseId}
      dropOffWarehouseName={supplySettings.dropOffWarehouseName}
      dropOffWarehouseType={supplySettings.dropOffWarehouseType}
      onCreated={() => {
        setSelectedSupply({});
        // Пункт 66. Созданная заявка гасит режим ручного выбора, из какого бы списка
        // она ни ушла. Иначе полный список кластеров оставался на экране после
        // оформления — режим выключен только у своей кнопки, а рисуют его обе.
        exitManualMode();
      }}
    />
    {/* Пункт 63. Тот же мастер, что и у рекомендаций: ручной выбор идёт стандартным путём
        создания заявки. Выборы независимы, поэтому и окна разные. */}
    <OzonSupplyModal
      isOpen={manualSummaryOpen && manualPlan.rows.length > 0}
      onClose={onCloseManualSummary}
      rows={manualPlan.rows}
      stockOptions={supplyStockOptions}
      cabinet={resolveSupplyCabinet(manualCabinetSets) || (cabinetFilter !== 'all' ? cabinetFilter : '')}
      clusterSalesShare={clusterShares.byClusterId}
      dropOffWarehouseId={supplySettings.dropOffWarehouseId}
      dropOffWarehouseName={supplySettings.dropOffWarehouseName}
      dropOffWarehouseType={supplySettings.dropOffWarehouseType}
      onCreated={() => { exitManualMode(); setManualSummaryOpen(false); }}
    />
    {factoryModalArticle && (
      <FactoryOrderModal
        isOpen={true}
        onClose={onCloseFactoryModal}
        article={factoryModalArticle}
        productName={factoryModalRow ? factoryModalRow.name : ''}
        suggestedQty={factoryModalRow && factoryModalRow.factory ? factoryModalRow.factory.orderQty : 0}
        pcsPerBox={factoryModalRow ? factoryModalRow.pcsPerBox : 1}
        leadTimeDays={factoryModalRow ? factoryModalRow.leadTimeDays : 0}
        order={activeFactoryOrders[factoryModalArticle] || null}
        orders={factoryOrdersByArticle[factoryModalArticle] || []}
        hiddenManual={hiddenManualByArticle[factoryModalArticle] || []}
        onResolveConflict={onResolveFactoryConflict}
      />
    )}
    {pendingModalArticle && (
      <div
        className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto"
        onClick={onClosePendingModal}
      >
        <div
          className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mt-16 p-5"
          onClick={(e) => e.stopPropagation()}
          id="ozon-pending-modal"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="text-sm font-bold text-slate-800">Расшифровка зачёта</div>
              <div className="text-[11px] text-slate-500 font-mono">{pendingModalArticle}</div>
            </div>
            <button
              type="button"
              onClick={onClosePendingModal}
              className="text-slate-400 hover:text-slate-700 text-lg leading-none px-2"
            >
              ✕
            </button>
          </div>
          <div className="text-[11px] text-slate-500 bg-slate-50 rounded-xl p-3 mb-3 leading-snug">
            Эти заявки уже созданы, поэтому их количества вычтены из потребности, а пока товар не списан — зарезервированы на Моём складе. Заявка считается «едущей» до начала приёмки на складе Ozon; дальше товар учитывается по колонкам Ozon. Заявка выпадает сама, когда отменена, отклонена или просрочена. Если статус получить не удалось, она истечёт через 7 дней от даты в колонке «С какого числа». Строка «списана, едет» уже списана со склада: остаток она не резервирует, но в кластер ещё едет и из потребности вычтена. Строка «принята Ozon» уже на приёмке у Ozon и учтена его колонками: резерв держится до списания, в потребности не повторяется.
          </div>
          {pendingModalRows.length === 0 ? (
            <div className="text-[11px] text-slate-400">По этому товару активных заявок нет.</div>
          ) : (
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="text-slate-500 font-semibold border-b border-slate-200">
                  <th className="py-2 pr-2">Кластер</th>
                  <th className="py-2 pr-2 text-right">Штук</th>
                  <th className="py-2 pr-2">Статус</th>
                  <th className="py-2 pr-2">С какого числа</th>
                  <th className="py-2 pr-2">Заявка</th>
                  <th className="py-2">Откуда</th>
                </tr>
              </thead>
              <tbody>
                {pendingModalRows.map((d, idx) => (
                  <tr key={`${d.orderId}-${d.clusterId}-${idx}`} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-700">{d.clusterId ? (clusterNameById[d.clusterId] || d.clusterId) : 'Без кластера'}</td>
                    <td className="py-2 pr-2 text-right font-semibold text-slate-800">{fmtInt(d.qty)}</td>
                    <td className="py-2 pr-2">
                      <span className={`px-1.5 py-0.5 rounded-md font-semibold ${getStatusDetails(d.ozonStatus).badgeClass}`}>
                        {getStatusDetails(d.ozonStatus).label}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-slate-500">{fmtDateFull(d.since)}</td>
                    <td className="py-2 pr-2 text-slate-500 font-mono">{d.orderId || '—'}</td>
                    <td className="py-2 text-slate-400">
                      {d.source === 'shipment' ? 'данные Ozon' : 'журнал заявок'}
                      {!d.reservesMyStock && <span className="ml-1 text-amber-600 font-semibold">списана, едет</span>}
                      {!d.countsForCluster && <span className="ml-1 text-sky-600 font-semibold">принята Ozon</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-slate-800">
                  <td className="py-2 pr-2">Итого резерв склада</td>
                  <td className="py-2 pr-2 text-right">{fmtInt(pendingModalRows.reduce((s, d) => s + (d.reservesMyStock ? d.qty : 0), 0))}</td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    )}
  </>
);
