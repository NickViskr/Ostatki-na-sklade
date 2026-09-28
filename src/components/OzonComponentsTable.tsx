// Item 88, ticket 05: three blocks under the coverage table — factory orders for articles not on
// Ozon yet, the kit-component factory table and the cluster-share bars — moved out of
// OzonStocksTab.tsx verbatim.
import React from 'react';
import type { OzonCoverageSettings } from '../lib/ozonCoverage';
import { factoryOrderBadge, factoryLateLabel } from '../lib/factoryOrderDisplay';
import { ClusterShares, ComponentCoverageRow, FactoryCellState, OffOzonFactoryOrders } from '../lib/ozonStocksTabModel';
import { fmtInt, fmtSpeed, fmtDateShort } from './ozonStocksFormat';

interface OzonComponentsTableProps {
  offOzonFactoryOrders: OffOzonFactoryOrders[];
  componentRows: ComponentCoverageRow[];
  factoryCellByComponent: Record<string, FactoryCellState>;
  factoryLateById: Record<string, number>;
  ozonSettings: OzonCoverageSettings;
  clusterShares: ClusterShares;
  setFactoryModalArticle: (article: string) => void;
}

export const OzonComponentsTable: React.FC<OzonComponentsTableProps> = ({
  offOzonFactoryOrders, componentRows, factoryCellByComponent, factoryLateById, ozonSettings,
  clusterShares, setFactoryModalArticle,
}) => (
  <>
    {/* Owner, 2026-09-25: goods ordered in China that are not on Ozon yet (they go there
        after arriving at the warehouse) have no row above — list their orders here so an
        order never disappears from sight. Components have their own table below. */}
    {offOzonFactoryOrders.length > 0 && (
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mt-3" id="ozon-offozon-factory">
        <div className="text-xs font-bold text-slate-700 mb-1">
          Заказано на фабрике — товары, которых пока нет на Ozon
          <span className="font-normal text-slate-400 ml-2">артикулов: {offOzonFactoryOrders.length}</span>
        </div>
        <div className="flex flex-col gap-1 text-[11px]">
          {offOzonFactoryOrders.map(({ article, orders }) => (
            <div key={article} className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono font-bold text-slate-800">{article}</span>
              {orders.map((o) => (
                <span key={o.id} className="text-sky-700">
                  {fmtInt(o.qty)} шт{factoryOrderBadge(o) ? ` · ${factoryOrderBadge(o)}` : ''}{o.expectedAt ? ` · ждём ${fmtDateShort(o.expectedAt)}` : ''}{factoryLateLabel(factoryLateById[o.id]) ? ` · ${factoryLateLabel(factoryLateById[o.id])}` : ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    )}

    {componentRows.length > 0 && (
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mt-3" id="ozon-components-factory">
        <div className="text-xs font-bold text-slate-700 mb-1">
          Заказ на фабрике — компоненты
          <span className="font-normal text-slate-400 ml-2">компонентов в расчёте: {componentRows.length}</span>
        </div>
        <div className="text-[11px] text-slate-500 bg-slate-50 rounded-xl p-3 mb-3 leading-snug">
          Виртуальный комплект на фабрике не заказывают — заказывают его компоненты, у них свои сроки поставки и свои коробки. Скорость компонента — сумма скоростей комплектов, куда он входит, умноженная на норму расхода: у компонента с нормой 1 она в точности равна скорости комплекта из таблицы выше. Заказ считается не по ней, а по прогнозной скорости (факт × тренд продаж комплекта) — она показана второй строкой, когда отличается от факта. «В обороте» — это НЕ складской остаток: сюда входит и тот же компонент внутри готовых комплектов, уже уехавших на Ozon. Он будет продан, но собрать из него новые комплекты нельзя — для сборки есть только складская часть, и она показана в разбивке под числом.
        </div>
        <div className="overflow-auto">
          <table className="w-full text-left text-[11px] border-collapse" id="ozon-components-table">
            <thead>
              <tr className="text-slate-500 font-semibold border-b border-slate-200">
                <th className="py-2 pr-2 min-w-[200px]">Компонент</th>
                <th className="py-2 pr-2 text-right">Скорость, шт/д</th>
                        <th
                          className="py-2 pr-2 text-right"
                          title="НЕ остаток на Моём складе. Это весь компонент, который сейчас есть в обороте: собственный остаток на складе, плюс тот же компонент внутри готовых комплектов, уже лежащих на Ozon, плюс заказанное на фабрике. Разбивка — строкой ниже под числом. Собрать новые комплекты можно только из складской части."
                        >
                          В обороте
                        </th>
                <th className="py-2 pr-2 text-right">Срок поставки, дней</th>
                <th className="py-2 pr-2 text-right">Хватит на</th>
                <th className="py-2 pr-2 text-right">Требуемый заказ</th>
              </tr>
            </thead>
            <tbody>
              {componentRows.map((c) => {
                // Разбор заказов на фабрике для компонента — по образцу основной таблицы,
                // иначе после оформления заказа он пропадал бы из вида: сигнал гас, а сам заказ было не видно и не открыть.
                // Item 85, step 1.7: the same rule as the main table and the pipeline — a late
                // China order stays waiting («задерживается N дн»), never «просрочен».
                const compFactoryCell = factoryCellByComponent[c.component];
                // Item 88 ticket 04 follow-up: the same predicate the cell's own `orderQty`
                // field already encodes (`c.factory && c.factory.orderQty > 0`), and
                // threshold/daysLeftNoSignal now come straight off the model's component row.
                const needOrder = compFactoryCell.orderQty > 0;
                const overdueList = compFactoryCell.overdueList;
                const overdueQty = compFactoryCell.overdueQty;
                const waitingQty = compFactoryCell.waitingQty;
                const nearest = compFactoryCell.nearest;
                const threshold = c.threshold;
                // Сколько дней хватит запаса без сигнала — нужно показывать даже когда заказывать не надо,
                // иначе после оформления заказа рост покрытия остаётся невидимым.
                // Пункт 38: делить надо на ПРОГНОЗНУЮ скорость — по ней же считается и сам сигнал,
                // иначе колонка показывала бы одни дни, а порог срабатывания считался бы по другим.
                const daysLeftNoSignal = c.daysLeftNoSignal;
                return (
                  <tr
                    key={c.component}
                    id={`ozon-comp-row-${c.component}`}
                    className={`border-b border-slate-100 ${needOrder ? 'bg-rose-50/60' : overdueList.length > 0 || (c.factory && c.factory.unmetDeficitQty > 0) ? 'bg-amber-50/60' : ''}`}
                  >
                    <td className="py-2 pr-2">
                      <span className="font-mono font-bold text-slate-800">{c.component}</span>
                      <span className="block text-[10px] text-slate-400" title="Комплекты, в которые входит компонент">
                        ({c.usedInKits.join(', ')})
                      </span>
                    </td>
                    {/* Крупно — ФАКТИЧЕСКИЙ расход: это та же величина, что скорость комплекта в
                        таблице выше (норма расхода на комплект), и расходиться с ней она не может.
                        Прогноз — производная от неё, поэтому идёт второй строкой. */}
                    <td className="py-2 pr-2 text-right font-semibold text-slate-800">
                      {fmtSpeed(c.perDay)}
                      {Math.abs(c.forecastPerDay - c.perDay) > 0.005 && (
                        <span
                          className="block text-[10px] font-normal text-slate-400"
                          title="Заказ на фабрике считается по прогнозной скорости: фактическая скорость комплектов умножена на их тренд продаж. Рекомендации на поставку в кластеры считаются по фактической."
                        >
                          прогноз {fmtSpeed(c.forecastPerDay)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <span className="font-semibold text-slate-800">{fmtInt(c.pipelineQty)}</span>
                      <span
                        className="block text-[10px] font-normal text-slate-400"
                        title="«Склад» — свободный остаток компонента. Резерв — часть склада, уже расписанная по созданным заявкам: эти штуки считаются внутри комплектов, которые едут на Ozon, поэтому второй раз в трубу не входят. Собрать из резерва новые комплекты нельзя."
                      >
                        из комплектов {fmtInt(c.fromKitsQty)} / склад {fmtInt(c.freeMyStockQty)} / заказано {fmtInt(c.onOrderQty)}
                        {c.reservedQty > 0 && <> · в резерве ещё {fmtInt(c.reservedQty)} (учтены в комплектах, которые едут)</>}
                      </span>
                    </td>
                    <td className={`py-2 pr-2 text-right ${(Number(c.leadTimeDays) || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                      {(Number(c.leadTimeDays) || 0) === 0 ? '—' : fmtInt(c.leadTimeDays)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {c.perDay === 0 ? (
                        <span
                          className="text-slate-300"
                          title="Комплекты с этим компонентом за расчётное окно не продавались — сигнал не считается."
                        >
                          —
                        </span>
                      ) : c.factory ? (
                        <span
                          className="font-semibold text-slate-700"
                          title={`Запаса хватит на ${Math.round(c.factory.daysLeft)} дн. при пороге ${Math.round(threshold)} дн. (срок поставки компонента ${fmtInt(c.leadTimeDays)} дн. + срок доставки до Ozon ${Number(ozonSettings.deliveryToOzonDays) || 0} дн. + неснижаемый запас).`}
                        >
                          {Math.round(c.factory.daysLeft)} дн
                        </span>
                      ) : (
                        <span
                          className="text-slate-500"
                          title={`Заказ не нужен: запаса хватит на ${daysLeftNoSignal} дн. при пороге ${Math.round(threshold)} дн.`}
                        >
                          {daysLeftNoSignal} дн
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {compFactoryCell.kind === 'overdue' ? (
                        <button
                          type="button"
                          onClick={() => setFactoryModalArticle(c.component)}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                          title="Фабрика сорвала срок. Просроченный заказ в запас НЕ входит. Нажми, чтобы изменить дату или отметить приход партии."
                        >
                          просрочен · {fmtDateShort(overdueList[0].expectedAt)}
                          <span className="block text-[10px] font-semibold text-amber-600">{fmtInt(overdueQty)} шт · нажми, чтобы решить</span>
                        </button>
                      ) : compFactoryCell.kind === 'order' && c.factory ? (
                        <button
                          type="button"
                          onClick={() => setFactoryModalArticle(c.component)}
                          className="text-rose-600 font-bold text-right hover:underline"
                        >
                          {waitingQty > 0 ? 'дозаказать ' : ''}{fmtInt(c.factory.orderQty)} шт
                          <span className="block text-[10px] font-semibold text-rose-400">
                            {fmtInt(c.factory.orderBoxes)} кор · {waitingQty > 0 ? `уже заказано ${fmtInt(waitingQty)} шт` : `хватит на ${Math.round(c.factory.daysLeft)} дн.`}
                          </span>
                        </button>
                      ) : compFactoryCell.kind === 'clusterDeficit' && c.factory ? (
                        /* 29.08.2026. Дефицит кластеров комплекта теперь доходит до компонента,
                           который держит сборку. Заказа на фабрике при этом может и не быть:
                           общего запаса хватает надолго, не хватает именно свободного склада
                           прямо сейчас — и это два разных утверждения, которые нельзя смешивать. */
                        <button
                          type="button"
                          onClick={() => setFactoryModalArticle(c.component)}
                          className="text-[10px] font-semibold text-amber-700 text-right hover:underline"
                          title={`Кластерам не досталось ${fmtInt(c.factory.unmetDeficitQty)} шт из-за этого компонента: собрать больше комплектов не из чего. Свободно на складе ${fmtInt(c.freeMyStockQty)} шт из ${fmtInt(c.myStockQty)} — остальное обещано созданным заявкам. Общего запаса при этом хватает на ${Math.round(c.factory.daysLeft)} дн. при пороге ${Math.round(threshold)} дн., поэтому расчёт заказа на фабрике не требует.${waitingQty > 0 ? ` Уже заказано ${fmtInt(waitingQty)} шт.` : ''} Нажми, чтобы оформить заказ на фабрике.`}
                        >
                          держит сборку · {fmtInt(c.factory.unmetDeficitQty)} шт
                          <span className="block text-[10px] font-normal text-amber-600">
                            свободно {fmtInt(c.freeMyStockQty)} шт{waitingQty > 0 ? ` · заказано ${fmtInt(waitingQty)} шт` : ''}
                          </span>
                        </button>
                      ) : compFactoryCell.kind === 'waiting' ? (
                        <button
                          type="button"
                          onClick={() => setFactoryModalArticle(c.component)}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100"
                          title={`Заказано на фабрике ${waitingQty} шт. Заказ входит в запас, дозаказывать не нужно. Нажми, чтобы изменить заказ или отметить приход партии.`}
                        >
                          заказано {fmtInt(waitingQty)} шт
                          <span className="block text-[10px] font-semibold text-sky-600">
                            ждём {nearest && nearest.expectedAt ? fmtDateShort(nearest.expectedAt) : '—'}
                            {nearest && factoryOrderBadge(nearest) ? ` · ${factoryOrderBadge(nearest)}` : ''}
                            {nearest && factoryLateLabel(factoryLateById[nearest.id]) ? ` · ${factoryLateLabel(factoryLateById[nearest.id])}` : ''}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setFactoryModalArticle(c.component)}
                          className="text-slate-300 hover:text-slate-500 hover:underline"
                          title="Заказ по расчёту не нужен. Нажми, чтобы всё равно отметить заказ на фабрике по этому компоненту."
                        >
                          не нужно
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {clusterShares.list.length > 0 && (
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mt-3" id="ozon-cluster-shares">
        <div className="text-xs font-bold text-slate-700 mb-3">
          Доли кластеров в продажах
          <span className="font-normal text-slate-400 ml-2">всего продано: {fmtInt(clusterShares.total)} шт</span>
        </div>
        <div className="flex flex-col gap-2">
          {clusterShares.list.map((c) => (
            <div key={c.clusterName} className="flex items-center gap-3">
              <span className="w-40 shrink-0 flex items-center gap-1.5 overflow-hidden">
                <span className="text-[11px] text-slate-600 truncate" title={c.clusterName}>{c.clusterName}</span>
                {c.priority && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-amber-100 text-amber-700 shrink-0" title="Приоритетный кластер: целевой и неснижаемый запас умножены на коэффициент">
                    ×{c.priorityK}
                  </span>
                )}
              </span>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, c.pct)}%` }} />
              </div>
              <span className="text-[11px] font-semibold text-slate-700 w-14 text-right">{c.pct.toFixed(1)}%</span>
              <span className="text-[11px] text-slate-400 w-16 text-right">{fmtInt(c.qty)} шт</span>
            </div>
          ))}
        </div>
      </div>
    )}
  </>
);
