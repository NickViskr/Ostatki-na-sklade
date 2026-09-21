/**
 * Item 78d (2026-09-21): what the AI window of the «Оборачиваемость» tab sends to the model.
 *
 * The model gets a compact, self-describing snapshot: the definitions, the portfolio totals
 * and one line per article with every figure the screen shows. The three starting prompts are
 * the owner's first three analyses; the fourth message is whatever the owner types. The
 * snapshot is built here, in the browser, so the tests can pin its shape; the proxy only adds
 * the model.
 */
import { ArticleTurnover, PortfolioTurnover, TurnoverResult } from './turnover';

export interface TurnoverPreset {
  id: 'slow' | 'leaders' | 'capital';
  label: string;
  prompt: string;
}

export const TURNOVER_PRESETS: TurnoverPreset[] = [
  {
    id: 'slow',
    label: 'Что делать с неликвидом',
    prompt: 'Разбери медленные товары (status = slow). По каждому: сколько капитала заморожено и где (склад / Ozon / в пути / возвраты), сколько дней идёт один оборот, сколько дней покрытия. Предложи конкретное действие: снизить цену или запустить акцию, остановить поставки на Ozon, вывезти с Ozon, распродать со склада, не заказывать на фабрике. Начни с товаров, где заморожено больше всего денег.',
  },
  {
    id: 'leaders',
    label: 'Лидеры и риск обнуления',
    prompt: 'Разбери лидеров (status = fast) и товары с малыми днями покрытия. Где остаток на Ozon и на складе кончится раньше, чем успеет приехать следующая поставка? Что докупить у фабрики и что отвезти на Ozon в первую очередь? Оцени, сколько продаж теряется при обнулении.',
  },
  {
    id: 'capital',
    label: 'Где заморожен капитал',
    prompt: 'Покажи, где заморожен капитал: доли по товарам и по частям (свой склад, остаток на Ozon, в доставке, возвраты). Какие 20 % товаров держат 80 % капитала? Что даст быстрее всего высвободить деньги? Сравни оборачиваемость капитала и GMROI по портфелю с лучшими и худшими товарами.',
  },
];

const DEFINITIONS = [
  'Определения:',
  '- avgCapital — средний за период капитал в товаре, ₽ = склад (остаток × себестоимость) + остаток на Ozon по себестоимости + в доставке к покупателям + возвращается от покупателей.',
  '- turns — оборачиваемость капитала за период, раз = себестоимость проданного ÷ avgCapital; daysPerTurn — дней на один оборот = период ÷ turns; null — продаж не было.',
  '- gmroiPct — валовая прибыль ÷ avgCapital × 100.',
  '- coverDays — дни покрытия = (остаток на складе + на Ozon, шт) ÷ (выкуплено за период ÷ период).',
  '- ageDays — дней с последней продажи на Ozon; если продаж не было — с последнего прихода на склад.',
  '- status: fast — лидер (оборот быстрее порога), slow — медленный (дольше порога или без продаж), normal, component — компонент набора, продаётся в составе набора (kitOf).',
  '- isKit — набор: продаётся на Ozon как один товар, на складе лежит компонентами.',
].join('\n');

/** `String(null)` is the literal `null` the definitions promise the model. */
function n(v: number | null): string {
  return String(v);
}

export function articleLine(a: ArticleTurnover): string {
  return [
    `${a.article}${a.isKit ? ' [набор]' : ''}${a.kitOf.length ? ` [компонент: ${a.kitOf.join(', ')}]` : ''}`,
    `status=${a.status}`, `turns=${n(a.turns)}`, `daysPerTurn=${n(a.daysPerTurn)}`, `gmroiPct=${n(a.gmroiPct)}`,
    `coverDays=${n(a.coverDays)}`, `ageDays=${n(a.ageDays)}`,
    `shelfQty=${a.shelfQty}`, `shelfCapital=${a.shelfCapital}`, `ozonQty=${a.ozonQty}`, `ozonStockCost=${a.ozonStockCost}`,
    `deliveringCost=${a.deliveringCost}`, `returningCost=${a.returningCost}`, `avgCapital=${a.avgCapital}`,
    `costOfSales=${a.costOfSales}`, `grossProfit=${a.grossProfit}`, `boughtQty=${a.boughtQty}`, `orderedQty=${a.orderedQty}`,
    `lastSaleDay=${a.lastSaleDay || 'null'}`, `lastReceiptDay=${a.lastReceiptDay || 'null'}`,
  ].join('; ');
}

export function portfolioBlock(p: PortfolioTurnover, slowDays: number, fastDays: number): string {
  return [
    `Портфель за ${p.periodDays} дн. (${p.fromDay} … ${p.toDay}); пороги: slow > ${slowDays} дн. на оборот, fast < ${fastDays} дн.`,
    `capitalNow=${p.capitalNow} (склад ${p.shelfCapital}, Ozon ${p.ozonStockCost}, в доставке ${p.deliveringCost}, возвраты ${p.returningCost})`,
    `avgCapital=${p.avgCapital} (склад ${p.avgWarehouseCapital}, Ozon ${p.avgOzonCapital}); costOfSales=${p.costOfSales}; grossProfit=${p.grossProfit}`,
    `turns=${n(p.turns)}; daysPerTurn=${n(p.daysPerTurn)}; gmroiPct=${n(p.gmroiPct)}; ozonOnlyTurns=${n(p.ozonOnlyTurns)} (сопоставимо с KAN inventory_turnover_ratio)`,
    `slowCapital=${p.slowCapital} (${p.slowSharePct} % капитала); fastCapital=${p.fastCapital}; counts: fast ${p.counts.fast}, normal ${p.counts.normal}, slow ${p.counts.slow}, component ${p.counts.component}`,
  ].join('\n');
}

/** The whole snapshot the model reads before the question. */
export function buildTurnoverSnapshot(result: TurnoverResult, slowDays: number, fastDays: number): string {
  return [
    'Данные по оборачиваемости капитала бизнеса (Ozon FBO + свой склад). Все деньги в рублях по себестоимости, все количества в штуках.',
    DEFINITIONS,
    '',
    portfolioBlock(result.portfolio, slowDays, fastDays),
    '',
    `Товары (${result.articles.length}), по одному в строке:`,
    ...result.articles.map(articleLine),
  ].join('\n');
}

export const TURNOVER_SYSTEM_PROMPT =
  'Ты — финансовый аналитик по товарным запасам продавца на Ozon (FBO) со своим складом. ' +
  'Отвечай по-русски, коротко и предметно: цифры из данных, конкретные действия по конкретным артикулам, ' +
  'без общих советов. Не выдумывай данных, которых нет; если чего-то не хватает — скажи, чего именно. ' +
  'Деньги показывай в рублях с разделителем тысяч, проценты — с одним знаком после запятой.';
