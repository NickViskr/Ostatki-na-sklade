/**
 * Item 89, part B (ADR 0001). Rules that live twice — in src/lib for the screen and in
 * Code.gs for writes and server checks — are fed the SAME inputs here, hand-made and
 * generated, and must give the same answer. A twin guarded only by source-text checks does not
 * count: the «упаковка» case drift passed them. Every twin pair is registered in TWINS below;
 * the two older parity files (supplyReserveParity, ozonSettingsRulesParity) stay as they are.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import {
  amountTotal, buildDestination, extrasTotal, parseShipmentExtras, rowMoneyAfterExtras,
  type ShipmentExtras
} from './shipmentExtras';
import { splitByQuantity } from './ozonBatchWriteOff';
import {
  AmbiguousOrderError, isOldCombinedShipment, orderLabels, orderSharesPreview, wholeShipmentNewExtras,
  wholeShipmentOrders, wholeShipmentRows
} from './wholeShipment';
import { factoryOnOrderByArticle, resolveOzonArticle } from './ozonCoverage';
import { useWarehouseStore } from '../store/useWarehouseStore';
import type { FactoryOrder, SKUItem } from '../types';

const require = createRequire(import.meta.url);
const freshStand = () => {
  const p = require.resolve('../../tests/apps-script/harness.cjs');
  delete require.cache[p];
  return require('../../tests/apps-script/harness.cjs');
};
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

// Deterministic generator: a failure names its seed and replays exactly.
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => next() < p;
  return { int, pick, chance };
}
type Rnd = ReturnType<typeof rng>;

interface Twin<I> {
  name: string;
  cases: I[];
  generated: number;
  generate: (r: Rnd) => I;
  ts: (input: I) => unknown;
  gs: (input: I) => unknown;
}

// One stand for every pure pair: none of them reads or writes a sheet.
const pure = freshStand().context;

// ── Shipment extras: the «Объект» text of a shipment ──

const LABEL_CASES: Record<string, string[]> = {
  packaging: ['Упаковка', 'упаковка', 'УПАКОВКА'],
  other: ['Прочее', 'прочее'],
  services: ['Услуги', 'услуги', 'Доп. услуги']
};
const money = (r: Rnd) => (r.chance(0.3) ? `${r.int(1, 999)},${r.int(10, 99)}` : String(r.int(1, 5000)));

function amountTag(r: Rnd, label: string): string {
  if (r.chance(0.5)) {
    const qty = r.int(1, 60);
    const unit = r.int(1, 40);
    return `${label}: ${qty} шт. x ${unit}₽ = ${qty * unit}₽`;
  }
  return `${label}:${r.chance(0.3) ? '' : ' '}${money(r)}${r.chance(0.2) ? ' ' : ''}₽`;
}

function servicesTag(r: Rnd, label: string): string {
  const names = ['Доставка по городу 1 короб', 'Маркировка', 'Паллета', 'Стрейч'];
  const entries = Array.from({ length: r.int(1, 3) }, () => {
    const name = r.pick(names);
    const q = r.int(1, 8);
    // A total that does not divide by the quantity («x3 (100₽)» → 33,33 ₽ a piece) as well.
    return r.chance(0.7) ? `${name} x${q} (${r.chance(0.5) ? q * r.int(10, 300) : r.int(10, 900)}₽)` : `${name} (${r.int(10, 900)}₽)`;
  });
  return `${label}: ${entries.join(', ')}`;
}

function destination(r: Rnd): string {
  const main = r.pick(['Яндекс', 'Ozon ФБО Хоругвино', 'Клиент Иванов', '']);
  const groups: string[] = [];
  for (let g = r.int(0, 2); g > 0; g--) {
    const tags: string[] = [];
    if (r.chance(0.6)) tags.push(amountTag(r, r.pick(LABEL_CASES.packaging)));
    if (r.chance(0.4)) tags.push(amountTag(r, r.pick(LABEL_CASES.other)));
    if (r.chance(0.5)) tags.push(servicesTag(r, r.pick(LABEL_CASES.services)));
    if (r.chance(0.3)) tags.push(r.pick(['Списание - Брак', 'Кабинет M', 'Заявка 2000067584248']));
    if (tags.length > 0) groups.push('[' + tags.join(' | ') + ']');
  }
  return [main, ...groups].filter(Boolean).join(' ');
}

const EXTRAS_CASES = [
  'Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x4 (636₽)]',
  // 2026-09-27: a hand-typed lower-case label — the screen counted 500, Code.gs 0.
  'Клиент [упаковка: 500₽]',
  'Клиент [прочее: 120₽ | Упаковка: 80₽]',
  'Клиент [Доп. услуги: Маркировка x2 (40₽)]',
  'Без хвоста',
  ''
];

const destinationTwins: Twin<string>[] = [
  {
    name: 'shipment extras: «Объект» taken apart',
    cases: EXTRAS_CASES, generated: 300, generate: destination,
    ts: (d) => parseShipmentExtras(d),
    gs: (d) => pure.parseShipmentExtrasGs(d)
  },
  {
    name: 'shipment extras: total of the parsed text',
    cases: EXTRAS_CASES, generated: 300, generate: destination,
    ts: (d) => extrasTotal(parseShipmentExtras(d)),
    gs: (d) => pure.extrasTotalGs(pure.parseShipmentExtrasGs(d))
  },
  {
    // commitTransaction falls back to this when the caller states no additional costs.
    name: 'shipment extras: the commit\'s text fallback equals the screen\'s total',
    cases: EXTRAS_CASES, generated: 300, generate: destination,
    ts: (d) => extrasTotal(parseShipmentExtras(d)),
    gs: (d) => pure.parseAdditionalCostsFromDestination(d)
  }
];

interface RebuildInput { original: string; edited: string; qty: number }
const rebuildTwin: Twin<RebuildInput> = {
  name: 'shipment extras: «Объект» put back together',
  cases: [{ original: EXTRAS_CASES[0], edited: 'Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x6 (954₽)]', qty: 40 }],
  generated: 300,
  generate: (r) => ({ original: destination(r), edited: destination(r), qty: r.int(0, 80) }),
  ts: ({ original, edited, qty }) => {
    const o = parseShipmentExtras(original);
    const e: ShipmentExtras = { ...parseShipmentExtras(edited), main: o.main, keptGroups: o.keptGroups };
    return buildDestination(e, o, qty);
  },
  gs: ({ original, edited, qty }) => {
    const o = pure.parseShipmentExtrasGs(original);
    const e = { ...pure.parseShipmentExtrasGs(edited), main: o.main, keptGroups: o.keptGroups };
    return pure.buildDestinationGs(e, o, qty);
  }
};

// ── Factory pipeline («Труба») ──

const TODAY = '2026-09-27';
function factoryOrders(r: Rnd): FactoryOrder[] {
  const dates = ['', '2026-08-01', '2026-09-10', '2026-09-27', '2026-10-15', '2026-11-30'];
  return Array.from({ length: r.int(0, 8) }, (_, i) => ({
    id: 'F' + i,
    article: r.pick(['Миска_двойная', 'Полка', ' Полка ', 'Органайзер', '']),
    qty: r.int(1, 900),
    orderedAt: r.pick(dates),
    expectedAt: r.pick(dates),
    status: r.pick(['active', 'active', 'received', 'replaced', '']),
    source: r.pick(['', '', 'Китай', 'Китай прогноз']),
    checked: r.chance(0.2)
  }) as unknown as FactoryOrder);
}
const pipelineTwin: Twin<FactoryOrder[]> = {
  name: 'pipeline: pieces ordered at the factory per article',
  cases: [[], [
    // Owner's case of item 83: the manual «Миска_двойная» order with no date is hidden by China.
    { id: 'm', article: 'Миска_двойная', qty: 300, orderedAt: '', expectedAt: '2026-10-01', status: 'active', source: '' },
    { id: 'c', article: 'Миска_двойная', qty: 280, orderedAt: '2026-09-16', expectedAt: '2026-09-20', status: 'active', source: 'Китай' }
  ] as unknown as FactoryOrder[]],
  generated: 300,
  generate: factoryOrders,
  ts: (orders) => factoryOnOrderByArticle(orders, TODAY).qty,
  gs: (orders) => pure.factoryPipelineQtyByArticleGs(orders, TODAY)
};

// ── Article mapping: an Ozon offer to our article ──

const SKUS = [
  { sku: 'BowlGrayMini_01', ozonBarcode: 'OZN1368918716' },
  { sku: 'Органайзер_2_пол_прозр', ozonBarcode: ' 1573302 ' },
  { sku: 'Полка', ozonBarcode: '' }
] as unknown as SKUItem[];
interface OfferInput { offerId: string; barcode: string }
const articleTwin: Twin<OfferInput> = {
  name: 'article: Ozon offer mapped to our article',
  cases: [
    { offerId: 'bowlgraymini_01', barcode: '' },
    { offerId: 'чужой', barcode: 'OZN1368918716' },
    { offerId: '', barcode: '1573302' },
    { offerId: '', barcode: '' }
  ],
  generated: 300,
  generate: (r) => ({
    offerId: r.pick(['BowlGrayMini_01', 'bowlgraymini_01', ' Полка ', 'ПОЛКА', 'Неизвестный', '']),
    barcode: r.pick(['OZN1368918716', '1573302', ' 1573302 ', '999', ''])
  }),
  ts: ({ offerId, barcode }) => resolveOzonArticle(SKUS, offerId, barcode),
  gs: ({ offerId, barcode }) => pure.supplyReserveArticle_(SKUS, offerId, barcode)
};

// ── Availability on «Мой склад»: the screen's figure vs the server's supply check ──

interface KitRow { kitSku: string; componentSku: string; quantity: number; kitType: string }
interface AvailabilityInput { stock: Record<string, number>; kits: KitRow[]; article: string }
const availabilityTwin: Twin<AvailabilityInput> = {
  name: 'availability: pieces free for a new supply (no reserve)',
  cases: [
    { stock: { BowlGray: 10, Бутылки: 7 }, kits: [
      { kitSku: 'GRAY', componentSku: 'BowlGray', quantity: 1, kitType: 'virtual' },
      { kitSku: 'GRAY', componentSku: 'Бутылки', quantity: 2, kitType: 'virtual' }
    ], article: 'GRAY' },
    { stock: { LEG: 4, BowlGray: 50 }, kits: [{ kitSku: 'LEG', componentSku: 'BowlGray', quantity: 5, kitType: 'legacy' }], article: 'LEG' },
    // A component typed with spaces on the sheet — getKits trims it for both sides.
    { stock: { BowlGray: 9 }, kits: [{ kitSku: 'K', componentSku: ' BowlGray ', quantity: 3, kitType: 'virtual' }], article: 'K' }
  ],
  generated: 60,
  generate: (r) => {
    const parts = ['BowlGray', 'BowlBlue', 'Бутылки'];
    const stock: Record<string, number> = {};
    for (const a of [...parts, 'LEG']) if (r.chance(0.8)) stock[a] = r.int(0, 40);
    const kits: KitRow[] = [];
    for (const kitSku of ['GRAY', 'LEG']) {
      const kitType = kitSku === 'LEG' ? 'legacy' : r.pick(['virtual', 'Virtual ', 'legacy']);
      for (const c of parts) if (r.chance(0.5)) kits.push({ kitSku, componentSku: r.chance(0.2) ? ` ${c}` : c, quantity: r.int(0, 3), kitType });
    }
    return { stock, kits, article: r.pick(['GRAY', 'LEG', 'BowlGray', 'Нет']) };
  },
  ts: ({ stock, kits, article }) => {
    // The shape the store receives: getKits of the same sheet, reshaped as fetchStock does.
    const stand = freshStand();
    stand.setKitSheet(kits);
    const byKit = plain(stand.context.getKits()) as Record<string, { type?: 'legacy' | 'virtual'; components: any[] }>;
    useWarehouseStore.setState({
      stock: Object.keys(stock).map((a) => ({ article: a, quantity: stock[a] })) as any,
      kits: Object.entries(byKit).map(([kitSku, k]) => ({ kitSku, components: k.components || [], type: k.type || 'legacy' }))
    });
    return useWarehouseStore.getState().getEffectiveAvailability(article);
  },
  gs: ({ stock, kits, article }) => {
    const stand = freshStand();
    stand.setStockSheet(Object.keys(stock).map((a) => ({ article: a, quantity: stock[a], avgCost: 1, capitalization: stock[a] })));
    stand.setKitSheet(kits);
    stand.setSkuSheet(['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon'], []);
    stand.setRegistrySheet('Внешние отгрузки', [[]]);
    stand.setRegistrySheet('Заявки Ozon', [[]]);
    // Asking for one piece: «available» is then exactly the free stock of the article.
    return stand.context.checkSupplyAvailability({ items: [{ article, quantity: 1 }] }).items[0].available;
  }
};

// ── Shipment extras edited later: money of every row, whole path on the stand ──

interface EditInput {
  lines: { article: string; quantity: number }[];
  dest: string;
  packaging: { mode: 'unit' | 'batch'; value: number };
  other: { mode: 'unit' | 'batch'; value: number };
  services: { name: string; quantity: number; unitCost: number }[];
}
function shipmentOnStand(input: EditInput) {
  const h = freshStand();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setStockSheet(['A', 'B', 'C'].map((a, i) => ({ article: a, quantity: 500, avgCost: 600 + i * 17.35, capitalization: 500 * (600 + i * 17.35) })));
  h.setOzonCostSheet([]);
  // No explicit additional costs: the commit reads them from the text, as a hand-made row does.
  h.commitTransaction(input.lines.map((l) => ({ ...l, price: 0 })), 'Расход', input.dest, '2026-09-22', 'tester', '2026-09-22T11:05:47.756Z', 'op-1', null);
  const rows = plain(h.shipmentRowsOfTransaction(h.getTransactions().rows.find((t: any) => t.type === 'Расход').id));
  return { h, rows };
}
const editTwin: Twin<EditInput> = {
  name: 'shipment extras edited: new money of every row and the new text',
  cases: [{
    lines: [{ article: 'A', quantity: 24 }, { article: 'B', quantity: 16 }],
    dest: 'Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x4 (636₽)]',
    packaging: { mode: 'unit', value: 6 }, other: { mode: 'unit', value: 0 },
    services: [{ name: 'Доставка по городу 1 короб', quantity: 6, unitCost: 159 }]
  }],
  generated: 40,
  generate: (r) => ({
    lines: ['A', 'B', 'C'].filter(() => r.chance(0.7)).concat('A').filter((a, i, xs) => xs.indexOf(a) === i)
      .map((article) => ({ article, quantity: r.int(1, 60) })),
    dest: destination(r),
    packaging: { mode: r.pick(['unit', 'batch'] as const), value: r.chance(0.3) ? 0 : r.int(1, 30) },
    other: { mode: r.pick(['unit', 'batch'] as const), value: r.chance(0.5) ? 0 : r.int(1, 900) },
    services: Array.from({ length: r.int(0, 2) }, () => ({ name: r.pick(['Маркировка', 'Паллета']), quantity: r.int(1, 5), unitCost: r.chance(0.5) ? r.int(5, 300) : r.int(500, 30000) / 100 }))
  }),
  // The screen: EditTransModal's own functions on the rows the server reports before the edit.
  ts: (input) => {
    const { rows } = shipmentOnStand(input);
    const o = parseShipmentExtras(input.dest);
    const qty = rows.filter((r: any) => r.isComponent !== true).reduce((s: number, r: any) => s + r.quantity, 0);
    const edited: ShipmentExtras = {
      ...o,
      packaging: amountTotal(input.packaging.mode, input.packaging.value, qty),
      packagingUnit: input.packaging.mode === 'unit' ? input.packaging.value : 0,
      other: amountTotal(input.other.mode, input.other.value, qty),
      otherUnit: input.other.mode === 'unit' ? input.other.value : 0,
      services: input.services
    };
    return {
      destination: buildDestination(edited, o, qty),
      rows: rowMoneyAfterExtras(rows, extrasTotal(o), extrasTotal(edited)).map((m) => ({ total: m.total, price: m.price }))
    };
  },
  // The server: updateShipmentExtras writes the rows; they are read back from the sheet.
  gs: (input) => {
    const { h, rows } = shipmentOnStand(input);
    const res = h.updateShipmentExtras({
      id: rows[0].id,
      packagingMode: input.packaging.mode, packagingValue: input.packaging.value,
      otherMode: input.other.mode, otherValue: input.other.value,
      services: input.services
    }, 'tester');
    const after = plain(h.shipmentRowsOfTransaction(rows[0].id));
    return {
      destination: res.destination,
      rows: after.filter((r: any) => r.isComponent !== true && r.quantity > 0).map((r: any) => ({ total: r.total, price: r.price }))
    };
  }
};

// ── Item 90: the whole shipment — per-order pieces and shares of a new extras total ──

interface CombinedInput {
  orders: { article: string; quantity: number }[][];
  oldTotal: number;
  /** After the write-off: an order deleted, a quantity edited (the row keeps its OpID), or a row without OpID added, or an old combined
   *  shipment written without a shipment number (both sides refuse the last two). */
  after: { kind: 'none' } | { kind: 'delete'; order: number } | { kind: 'edit'; order: number; quantity: number } | { kind: 'loose' } | { kind: 'old' };
  packaging: { mode: 'unit' | 'batch'; value: number };
  other: { mode: 'unit' | 'batch'; value: number };
  services: { name: string; quantity: number; unitCost: number }[];
}
const SHIPMENT_ID = 'op-comb';
// The write-off exactly as ConfirmModal makes it: one commit per order, its share from
// splitByQuantity, the note of the batch, OpID «<shipment>-N», the shared shipment number.
function combinedOnStand(input: CombinedInput) {
  const h = freshStand();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setStockSheet(['A', 'B', 'C'].map((a, i) => ({ article: a, quantity: 2000, avgCost: 600 + i * 17.35, capitalization: 2000 * (600 + i * 17.35) })));
  h.setOzonCostSheet([]);
  const pieces = input.orders.map((lines) => lines.reduce((s, l) => s + l.quantity, 0));
  const totalPieces = pieces.reduce((s, q) => s + q, 0);
  const shares = splitByQuantity(input.oldTotal, pieces);
  const labels = input.orders.map((_, i) => `13000${i}-1`);
  const base = `Яндекс [Услуги: Паллета x1 (${input.oldTotal}₽)]`;
  input.orders.forEach((lines, i) => {
    const note = `[Общая поставка: заявки ${labels.map((l) => '№ ' + l).join(', ')}; доля этой заявки ${pieces[i]} из ${totalPieces} шт., `
      + `${shares[i].toFixed(2)} руб. из ${input.oldTotal.toFixed(2)} руб.]`;
    h.commitTransaction(lines.map((l) => ({ ...l, price: 600 })), 'Расход', `${base} ${note}`, '2026-09-22', 'tester',
      '2026-09-22T11:05:47.756Z', `${SHIPMENT_ID}-${i + 1}`, shares[i], undefined, '',
      input.after.kind === 'old' ? '' : SHIPMENT_ID);
  });
  const orderRows = (n: number) => plain(h.getTransactions().rows)
    .filter((t: any) => t.type === 'Расход' && t.opId === `${SHIPMENT_ID}-${n + 1}`);
  if (input.after.kind === 'delete') {
    orderRows(input.after.order).forEach((t: any) => h.deleteTransaction(t.id, 'tester'));
  } else if (input.after.kind === 'loose') {
    // A row of the shipment without an OpID: the correction must refuse it on both sides.
    h.commitTransaction([{ article: 'A', quantity: 3, price: 600 }], 'Расход', base, '2026-09-22', 'tester',
      '2026-09-22T11:05:47.756Z', '', 0, undefined, '', SHIPMENT_ID);
  } else if (input.after.kind === 'edit') {
    const t = orderRows(input.after.order)[0];
    h.updateTransaction(t.id, {
      article: t.article, quantity: input.after.quantity, price: t.price, writeOffCost: t.writeOffCost,
      type: 'Расход', destination: t.destination, deliveryDate: '2026-09-22', date: t.date
    }, 'tester');
  }
  return { h, rows: plain(h.getTransactions().rows).filter((t: any) => t.type === 'Расход') };
}
const combinedTwin: Twin<CombinedInput> = {
  name: 'whole shipment: per-order pieces and shares of a new extras total',
  cases: [{
    // Hand case: 3 orders of 10 / 10 / 30 pieces (equal first two: the ties go to the earlier order).
    orders: [[{ article: 'A', quantity: 10 }], [{ article: 'B', quantity: 10 }], [{ article: 'A', quantity: 20 }, { article: 'C', quantity: 10 }]],
    oldTotal: 2419, after: { kind: 'none' },
    packaging: { mode: 'unit', value: 6 }, other: { mode: 'batch', value: 100 },
    services: [{ name: 'Доставка 1 пал', quantity: 1, unitCost: 2333.33 }]
  }, {
    // Hand case: a row without OpID inside a shipment — both sides refuse.
    orders: [[{ article: 'A', quantity: 10 }], [{ article: 'B', quantity: 20 }]],
    oldTotal: 1200, after: { kind: 'loose' },
    packaging: { mode: 'batch', value: 100 }, other: { mode: 'batch', value: 0 }, services: []
  }, {
    // Hand case: an old combined shipment (note, no shipment number) — both sides refuse.
    orders: [[{ article: 'A', quantity: 10 }], [{ article: 'B', quantity: 20 }]],
    oldTotal: 1200, after: { kind: 'old' },
    packaging: { mode: 'batch', value: 100 }, other: { mode: 'batch', value: 0 }, services: []
  }],
  generated: 30,
  generate: (r) => {
    const orders = Array.from({ length: r.int(2, 3) }, () =>
      ['A', 'B', 'C'].filter(() => r.chance(0.6)).concat('A').filter((a, i, xs) => xs.indexOf(a) === i)
        .map((article) => ({ article, quantity: r.int(1, 40) })));
    const order = r.int(0, orders.length - 1);
    const kind = r.pick(['none', 'delete', 'edit', 'loose', 'old'] as const);
    return {
      orders,
      oldTotal: r.int(500, 9000),
      after: (kind === 'none' || kind === 'loose' || kind === 'old') ? { kind } : kind === 'delete' ? { kind, order } : { kind, order, quantity: r.int(1, 60) },
      packaging: { mode: r.pick(['unit', 'batch'] as const), value: r.chance(0.3) ? 0 : r.int(1, 30) },
      other: { mode: r.pick(['unit', 'batch'] as const), value: r.chance(0.5) ? 0 : r.int(1, 900) },
      services: Array.from({ length: r.int(0, 2) }, () => ({ name: r.pick(['Маркировка', 'Паллета']), quantity: r.int(1, 5), unitCost: r.chance(0.5) ? r.int(5, 300) : r.int(500, 30000) / 100 }))
    };
  },
  // The screen: the browser twin over the rows the server reports; the new total from the window's own function.
  ts: (input) => {
    const { rows } = combinedOnStand(input);
    const set = wholeShipmentRows(rows, rows[0]);
    if (isOldCombinedShipment(set)) return { refused: 'old' };
    const { total } = wholeShipmentNewExtras(rows, rows[0], {
      packaging: input.packaging, other: input.other, services: input.services
    });
    try {
      const orders = wholeShipmentOrders(set);
      const labels = orderLabels(orders, (rows[0].shipmentId ?? '').trim());
      return {
        newTotal: total,
        orders: orderSharesPreview(orders, total).map((o, i) => ({ label: labels[i], pieces: o.pieces, oldShare: o.oldShare, newShare: o.newShare }))
      };
    } catch (e) {
      if (e instanceof AmbiguousOrderError) return { refused: 'ambiguous' };
      throw e;
    }
  },
  gs: (input) => {
    const { h, rows } = combinedOnStand(input);
    try {
      const res = h.updateShipmentExtras({
        id: rows[0].id,
        packagingMode: input.packaging.mode, packagingValue: input.packaging.value,
        otherMode: input.other.mode, otherValue: input.other.value,
        services: input.services
      }, 'tester');
      return {
        newTotal: res.newTotal,
        orders: res.orders.map((o: any) => ({ label: o.label, pieces: o.pieces, oldShare: o.oldShare, newShare: o.newShare }))
      };
    } catch (e: any) {
      const msg = String(e && e.message);
      if (msg.includes('Не удаётся понять')) return { refused: 'ambiguous' };
      if (msg.includes('общей поставки')) return { refused: 'old' };
      throw e;
    }
  }
};

const TWINS: Twin<any>[] = [...destinationTwins, rebuildTwin, pipelineTwin, articleTwin, availabilityTwin, editTwin, combinedTwin];

describe('item 89 B: every twin rule gives the same answer in TS and in Code.gs', () => {
  for (const twin of TWINS) {
    it(twin.name, () => {
      const r = rng(89);
      const inputs = [...twin.cases, ...Array.from({ length: twin.generated }, () => twin.generate(r))];
      inputs.forEach((input, i) => {
        expect(plain(twin.gs(input)), `#${i} ${JSON.stringify(input)}`).toEqual(plain(twin.ts(input)));
      });
    });
  }
});
