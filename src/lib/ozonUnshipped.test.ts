import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { arrivedByVirtualSupply, buildUnshippedLines, findShortShipments, parseShippedRecord } from './ozonUnshipped';
import type { ExternalShipment, SKUItem } from '../types';

// ============================================================================================
// Item 68, stages 2 and 3 (15.09.2026). The owner's live case: supply 2000065651020 of order
// 127380557-1 written off as 36 pcs of BowlGrayMini_01, one box of 18 reached Ozon, Ozon
// refused the acceptance and created virtual supply 2000066659799 for the 18 that arrived.
// ============================================================================================

const skus: SKUItem[] = [
  { sku: 'BowlGrayMini_01', name: 'Набор', ozonBarcode: 'OZN1368918716' } as any,
  { sku: 'Полка', name: 'Полка', ozonBarcode: 'OZN2' } as any
];

function row(over: Partial<ExternalShipment>): ExternalShipment {
  return {
    postingId: 'P', detectedAt: '2026-09-06 19:13:32', shipmentDate: '2026-09-16', status: 'processed',
    itemsJSON: '[]', transGroupInfo: '', cabinet: 'MaxiStore', ...over
  } as ExternalShipment;
}

const original = row({
  postingId: '2000065651020', orderNumber: '127380557-1', ozonStatus: 'REJECTED_AT_SUPPLY_WAREHOUSE',
  itemsJSON: JSON.stringify([{ offerId: 'BowlGrayMini_01', barcode: 'OZN1368918716', quantity: 36 }]),
  transGroupInfo: '["a595b3f5"]'
});
const virtual = row({
  postingId: '2000066659799', orderId: '128675533', status: 'new', ozonStatus: 'IN_TRANSIT', isVirtual: true,
  originalSupplyId: '2000065651020',
  itemsJSON: JSON.stringify([{ offerId: 'BowlGrayMini_01', barcode: 'OZN1368918716', quantity: 18 }])
});

describe('arrivedByVirtualSupply', () => {
  it('боевой случай: виртуальная поставка Ozon говорит, что доехало 18', () => {
    expect(arrivedByVirtualSupply(original, [original, virtual])).toEqual({ BowlGrayMini_01: 18 });
  });

  it('без виртуальной поставки — null: Ozon ничего не утверждает', () => {
    expect(arrivedByVirtualSupply(original, [original])).toBeNull();
  });

  it('чужая виртуальная поставка и невиртуальная строка с той же ссылкой не в счёт', () => {
    const other = row({ ...virtual, postingId: 'V2', originalSupplyId: '999' });
    const notVirtual = row({ ...virtual, postingId: 'V3', isVirtual: false });
    expect(arrivedByVirtualSupply(original, [original, other, notVirtual])).toBeNull();
  });

  it('две виртуальные поставки по одной исходной складываются', () => {
    const second = row({ ...virtual, postingId: 'V2', itemsJSON: JSON.stringify([{ offerId: 'BowlGrayMini_01', quantity: 6 }]) });
    expect(arrivedByVirtualSupply(original, [original, virtual, second])).toEqual({ BowlGrayMini_01: 24 });
  });
});

describe('buildUnshippedLines', () => {
  it('боевой случай: заявлено 36, уехало 18 по слову Ozon, артикул из SKU Базы', () => {
    expect(buildUnshippedLines(original, [original, virtual], skus)).toEqual([
      { offerId: 'BowlGrayMini_01', article: 'BowlGrayMini_01', declared: 36, shipped: 18 }
    ]);
  });

  it('без виртуальной поставки форма начинается с «уехало = заявлено»', () => {
    expect(buildUnshippedLines(original, [original], skus)[0].shipped).toBe(36);
  });

  it('позиция, которой нет в виртуальной поставке, уехала как 0; больше заявленного не бывает', () => {
    const two = row({ ...original, itemsJSON: JSON.stringify([
      { offerId: 'BowlGrayMini_01', quantity: 36 }, { offerId: 'Полка', quantity: 10 }
    ]) });
    const big = row({ ...virtual, itemsJSON: JSON.stringify([{ offerId: 'BowlGrayMini_01', quantity: 50 }]) });
    const lines = buildUnshippedLines(two, [two, big], skus);
    expect(lines.find(l => l.offerId === 'BowlGrayMini_01')!.shipped).toBe(36);
    expect(lines.find(l => l.offerId === 'Полка')!.shipped).toBe(0);
  });

  it('одна позиция дважды в составе складывается в одну строку', () => {
    const dup = row({ ...original, itemsJSON: JSON.stringify([
      { offerId: 'BowlGrayMini_01', quantity: 20 }, { offerId: 'BowlGrayMini_01', quantity: 16 }
    ]) });
    expect(buildUnshippedLines(dup, [dup], skus)).toEqual([{ offerId: 'BowlGrayMini_01', article: 'BowlGrayMini_01', declared: 36, shipped: 36 }]);
  });

  it('битый состав даёт пустую форму, а не падение', () => {
    expect(buildUnshippedLines(row({ itemsJSON: 'не json' }), [], skus)).toEqual([]);
  });
});

describe('parseShippedRecord', () => {
  it('пусто или битое — null', () => {
    expect(parseShippedRecord('')).toBeNull();
    expect(parseShippedRecord(undefined)).toBeNull();
    expect(parseShippedRecord('{"nope":1}')).toBeNull();
  });

  it('запись возврата читается целиком', () => {
    const rec = parseShippedRecord(JSON.stringify({
      lines: [{ offerId: 'A', article: 'A', declared: 36, shipped: 18 }], returnTxIds: ['t1', 't2'], returnedAt: '2026-09-15T18:00:00.000Z', by: 'admin'
    }));
    expect(rec).toEqual({ lines: [{ offerId: 'A', article: 'A', declared: 36, shipped: 18 }], returnTxIds: ['t1', 't2'], returnedAt: '2026-09-15T18:00:00.000Z', by: 'admin' });
  });
});

describe('findShortShipments (этап 3)', () => {
  it('боевой случай найден: 18 из 36', () => {
    const found = findShortShipments([original, virtual], skus);
    expect(found).toHaveLength(1);
    expect(found[0].supply.postingId).toBe('2000065651020');
    expect(found[0].declaredTotal).toBe(36);
    expect(found[0].shippedTotal).toBe(18);
  });

  it('уже возвращённая поставка больше не всплывает', () => {
    const returned = row({ ...original, shippedJSON: JSON.stringify({ lines: [], returnTxIds: [], returnedAt: '', by: '' }) });
    expect(findShortShipments([returned, virtual], skus)).toHaveLength(0);
  });

  it('неоформленная поставка не всплывает: списания не было, возвращать нечего', () => {
    expect(findShortShipments([row({ ...original, status: 'new' }), virtual], skus)).toHaveLength(0);
  });

  it('виртуальная строка сама по себе никогда не «недоотгружена»', () => {
    const selfRef = row({ ...virtual, status: 'processed', originalSupplyId: '2000066659799' });
    expect(findShortShipments([selfRef], skus)).toHaveLength(0);
  });

  it('виртуальная поставка на весь состав — недостачи нет', () => {
    const full = row({ ...virtual, itemsJSON: JSON.stringify([{ offerId: 'BowlGrayMini_01', quantity: 36 }]) });
    expect(findShortShipments([original, full], skus)).toHaveLength(0);
  });

  it('без виртуальной поставки алерта нет: Ozon ничего не утверждал', () => {
    expect(findShortShipments([original], skus)).toHaveLength(0);
  });
});

// ---- Guards over the wiring: screen, store, Code.gs.
describe('подключение этапа 2 к экрану, хранилищу и Code.gs', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const tab = read('src/components/OzonSuppliesTab.tsx');
  const store = read('src/store/useWarehouseStore.ts');
  const gas = read('Code.gs');

  it('кнопка «Отгружено меньше» — только у оформленной строки без записи возврата; с записью — бейдж', () => {
    expect(tab).toMatch(/\{s\.status === 'processed' && \(\(\) => \{\s*const record = parseShippedRecord\(s\.shippedJSON\);\s*if \(record\) \{/);
    expect(tab).toContain('id={`btn-unshipped-${s.postingId}`}');
    expect(tab).toMatch(/Возврат: \{returned\} шт/);
  });

  it('окно предзаполняется чистой функцией и отправляет ровно offerId/article/shipped', () => {
    expect(tab).toMatch(/buildUnshippedLines\(shipment, externalShipments \|\| \[\], skus\)/);
    expect(tab).toMatch(/lines\.map\(l => \(\{ offerId: l\.offerId, article: l\.article, shipped: l\.shipped \}\)\)/);
    expect(tab).toMatch(/disabled=\{isProcessing \|\| invalid\.length > 0 \|\| returning\.length === 0\}/);
  });

  it('хранилище зовёт commitUnshippedReturn с ключом операции и обновляет экран ИЗ ОТВЕТА, без перечитывания базы', () => {
    // Owner's remark 15.09.2026: 20 s of waiting. Three re-reads after the answer cost ~12 s of it.
    expect(store).toMatch(/fetchGas\('commitUnshippedReturn', \{ data: \{ postingId, shipped, opId: newOperationId\(\) \} \}\)/);
    const body = store.slice(store.indexOf('commitUnshippedReturn: async'), store.indexOf('saveShipmentShortageRecalc: async'));
    expect(body).not.toContain('fetchStock()');
    expect(body).not.toContain('fetchExternalShipments()');
    expect(body).toMatch(/s\.postingId === postingId \? \{ \.\.\.s, shippedJSON: recordJSON \} : s/);
    expect(body).toMatch(/data\.newTransactions/);
    expect(body).toMatch(/normalizeStock\(data\.stock\)/);
  });

  it('прокси знает действие: сбрасывает ровно то, что возврат меняет, а не весь кэш', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    expect(server).toMatch(/commitUnshippedReturn: \['getInitialData', 'getStock', 'getTransactions', 'getExternalShipments'\]/);
  });

  it('строка поставки: сетка сжимаема, номер обрезается многоточием, блок бейджей ограничен половиной', () => {
    expect(tab).toContain('<div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1 min-w-0">');
    expect(tab).toMatch(/<div className="text-sm font-bold text-slate-800 mt-0\.5 truncate" title=\{s\.postingId\}>\{s\.postingId\}<\/div>/);
    expect(tab).toContain('flex items-center gap-4 min-w-0 lg:max-w-[50%] justify-between lg:justify-end');
    expect(tab).not.toContain('flex items-center gap-4 shrink-0 justify-between lg:justify-end border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-50');
  });

  it('Code.gs: колонка «ОтгруженоJSON» в заголовках, действие только для администратора, приход помечен «Корректировка»', () => {
    expect(gas).toMatch(/'Виртуальная', 'ИсходнаяПоставка', 'ОтгруженоJSON'\n\];/);
    expect(gas).toMatch(/case 'commitUnshippedReturn':\s*assertAdmin\(currentUser\);\s*result = commitUnshippedReturn\(data\.postingId, data\.shipped, currentUser\.username, data\.opId\);/);
    expect(gas).toContain("const destination = 'Корректировка: возврат неотгруженного, поставка № '");
    expect(gas).toContain("shippedJSON: getVal(colShippedJson, false)");
  });
});

// ---- Stage 3: the alert on the dashboard, built from the same facts.
describe('пункт 68, этап 3: алерт «Отгружено меньше, чем списано»', () => {
  it('боевой случай даёт один оранжевый алерт с цифрами и призывом оформить возврат', async () => {
    const { buildOzonAlerts } = await import('./ozonAlerts');
    const alerts = buildOzonAlerts([original, virtual], skus).filter(a => a.type === 'short_shipment');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: '2000065651020:short_shipment',
      postingId: '2000065651020',
      orderNumber: '127380557-1',
      cabinet: 'MaxiStore',
      severity: 'orange',
      title: 'Отгружено меньше, чем списано'
    });
    expect(alerts[0].description).toBe('Поставка № 2000065651020 (заявка № 127380557-1): BowlGrayMini_01: уехало 18 из 36 — оформить возврат на склад');
  });

  it('после возврата алерт гаснет, красный «Отказано в приёмке» по той же строке остаётся', async () => {
    const { buildOzonAlerts } = await import('./ozonAlerts');
    const returned = row({ ...original, shippedJSON: JSON.stringify({ lines: [], returnTxIds: [], returnedAt: '', by: '' }) });
    const alerts = buildOzonAlerts([returned, virtual], skus);
    expect(alerts.some(a => a.type === 'short_shipment')).toBe(false);
    expect(alerts.some(a => a.type === 'rejected' && a.postingId === '2000065651020')).toBe(true);
  });

  it('оранжевый идёт сразу после красных, до фиолетовых и янтарных', async () => {
    const { buildOzonAlerts } = await import('./ozonAlerts');
    // An amber alert of another supply must land AFTER the orange one — without it the
    // order check passed with the orange alert placed last (a mutation showed it, 15.09.2026).
    const withShortage = row({
      postingId: 'S2', status: 'processed', ozonStatus: 'COMPLETED',
      itemsJSON: JSON.stringify([{ offerId: 'Полка', quantity: 10 }]),
      acceptedJSON: JSON.stringify([{ offerId: 'Полка', accepted: 7 }])
    });
    const alerts = buildOzonAlerts([withShortage, original, virtual], skus);
    const order = alerts.map(a => a.severity);
    expect(order).toEqual(['red', 'orange', 'amber']);
  });

  it('кнопка «Открыть» ведёт на вкладку «Поставки Озон» (тип не в списке исключений дашборда)', () => {
    const dash = fs.readFileSync(path.join(process.cwd(), 'src/components/Dashboard.tsx'), 'utf8');
    expect(dash).toMatch(/setActiveTab\(alert\.type === 'supply_needed' \|\| alert\.type === 'factory_order' \? 'ozonStocks' : 'ozon'\)/);
    expect(dash).toContain("alert.severity === 'orange'");
  });
});
