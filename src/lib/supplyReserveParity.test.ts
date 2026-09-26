/**
 * Item 85, step 1.5. The last check before a supply goes to Ozon runs on the SERVER
 * (`checkSupplyAvailability` in Code.gs) and must see the same reserve of created supplies as
 * the screen (`buildPendingSupplies`). The reserve rule therefore lives twice: here the two
 * copies are fed the same rows — hand-made cases and 300 generated sets — and must agree to the
 * piece. Then the real server check runs on the Apps Script stand from its sheets.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { buildPendingSupplies, type OzonSupplyRequestRow } from './ozonPending';
import type { ExternalShipment, SKUItem } from '../types';

const require = createRequire(import.meta.url);
const freshStand = () => {
  const p = require.resolve('../../tests/apps-script/harness.cjs');
  delete require.cache[p];
  return require('../../tests/apps-script/harness.cjs');
};

const NOW = new Date('2026-09-16T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const SKUS: SKUItem[] = [
  { sku: 'BowlGrayMini_01', price: 0, minStock: 0, pcsPerBox: 18, ozonBarcode: 'OZN1368918716', wbBarcode: '', boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 },
  { sku: 'Органайзер_2_пол_прозр', price: 0, minStock: 0, pcsPerBox: 8, ozonBarcode: '', wbBarcode: '', boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }
];

function sh(over: Partial<ExternalShipment> & { items?: any[] }): ExternalShipment {
  const { items, ...rest } = over;
  return {
    postingId: 'P', detectedAt: ago(1), shipmentDate: '', status: 'new', itemsJSON: JSON.stringify(items || []),
    transGroupInfo: '', orderId: '', orderNumber: '', ozonStatus: 'READY_TO_SUPPLY', cabinet: 'M', clusterId: '4039', isVirtual: false,
    ...rest
  };
}
function rq(over: Partial<OzonSupplyRequestRow> & { items?: any[] }): OzonSupplyRequestRow {
  const { items, ...rest } = over;
  return { id: 'R', date: ago(0.5), cabinet: 'M', draftId: '', orderId: '', dropOffName: '', clusters: '', itemsJSON: JSON.stringify(items || []), who: '', status: 'Создана', ...rest };
}

// supplyReservesByArticle reads no sheet, so one stand serves every comparison.
const reserveStand = freshStand();
function both(shipments: ExternalShipment[], requests: OzonSupplyRequestRow[]) {
  const stand = reserveStand;
  const ts = buildPendingSupplies({ shipments, requests, skus: SKUS, now: NOW }).byArticle;
  const gs = stand.context.supplyReservesByArticle(shipments, requests, SKUS, NOW.getTime());
  return { ts, gs: JSON.parse(JSON.stringify(gs)) };
}

describe('item 85, step 1.5: the server reserve equals the screen reserve', () => {
  const cases: { name: string; shipments: ExternalShipment[]; requests: OzonSupplyRequestRow[]; expected: Record<string, number> }[] = [
    { name: 'не списанная READY_TO_SUPPLY резервирует', shipments: [sh({ items: [{ offerId: 'BowlGrayMini_01', quantity: 18 }] })], requests: [], expected: { BowlGrayMini_01: 18 } },
    { name: 'списанная не резервирует', shipments: [sh({ status: 'processed', items: [{ offerId: 'BowlGrayMini_01', quantity: 18 }] })], requests: [], expected: {} },
    { name: 'проигнорированная не резервирует', shipments: [sh({ status: 'ignored', items: [{ offerId: 'BowlGrayMini_01', quantity: 18 }] })], requests: [], expected: {} },
    { name: 'виртуальная не резервирует', shipments: [sh({ isVirtual: true, items: [{ offerId: 'BowlGrayMini_01', quantity: 18 }] })], requests: [], expected: {} },
    { name: 'отменённая, отклонённая, просроченная не резервируют', shipments: ['CANCELLED', 'REJECTED_AT_SUPPLY_WAREHOUSE', 'overdue'].map((s) => sh({ ozonStatus: s, items: [{ offerId: 'BowlGrayMini_01', quantity: 5 }] })), requests: [], expected: {} },
    { name: 'принятая Ozon, но не списанная — резерв держится', shipments: [sh({ ozonStatus: 'COMPLETED', items: [{ offerId: 'BowlGrayMini_01', quantity: 7 }] })], requests: [], expected: { BowlGrayMini_01: 7 } },
    { name: 'статус неизвестен: внутри 7 дней резервирует, старше — нет', shipments: [sh({ ozonStatus: '', detectedAt: ago(6), items: [{ offerId: 'BowlGrayMini_01', quantity: 3 }] }), sh({ ozonStatus: 'SOMETHING_NEW', detectedAt: ago(8), items: [{ offerId: 'BowlGrayMini_01', quantity: 100 }] })], requests: [], expected: { BowlGrayMini_01: 3 } },
    { name: 'дата в формате листа «yyyy-MM-dd HH:mm:ss»', shipments: [sh({ ozonStatus: '', detectedAt: '2026-09-14 10:00:00', items: [{ offerId: 'BowlGrayMini_01', quantity: 4 }] })], requests: [], expected: { BowlGrayMini_01: 4 } },
    { name: 'без даты и без статуса не резервирует', shipments: [sh({ ozonStatus: '', detectedAt: '', items: [{ offerId: 'BowlGrayMini_01', quantity: 4 }] })], requests: [], expected: {} },
    { name: 'связь по «ШК Ozon», qty вместо quantity, offer_id', shipments: [sh({ items: [{ offerId: 'чужое имя', barcode: 'OZN1368918716', quantity: 2 }, { offer_id: 'органайзер_2_пол_прозр', qty: 8 }, { offerId: 'Неизвестный', quantity: 1 }] })], requests: [], expected: { BowlGrayMini_01: 2, 'Органайзер_2_пол_прозр': 8, 'Неизвестный': 1 } },
    { name: 'нулевые, отрицательные и битые позиции пропускаются', shipments: [sh({ items: [{ offerId: 'BowlGrayMini_01', quantity: 0 }, { offerId: 'BowlGrayMini_01', quantity: -3 }, null] }), sh({ itemsJSON: '{broken' } as any)], requests: [], expected: {} },
    { name: 'журнал без строк Ozon резервирует', shipments: [], requests: [rq({ orderId: '1', items: [{ article: 'BowlGrayMini_01', clusterId: '4039', qty: 36 }] })], expected: { BowlGrayMini_01: 36 } },
    { name: 'журнал, отменённый пользователем, не резервирует', shipments: [], requests: [rq({ orderId: '1', status: 'Отменена', items: [{ article: 'BowlGrayMini_01', qty: 36 }] })], expected: {} },
    { name: 'журнал старше 7 дней не резервирует', shipments: [], requests: [rq({ orderId: '1', date: ago(8), items: [{ article: 'BowlGrayMini_01', qty: 36 }] })], expected: {} },
    { name: 'журнал не задваивает заявку, которую Ozon уже прислал с составом', shipments: [sh({ orderId: '1', items: [{ offerId: 'BowlGrayMini_01', quantity: 36 }] })], requests: [rq({ orderId: '1', items: [{ article: 'BowlGrayMini_01', qty: 36 }] })], expected: { BowlGrayMini_01: 36 } },
    { name: 'журнал молчит, если Ozon снял заявку', shipments: [sh({ orderId: '1', ozonStatus: 'CANCELLED', items: [] })], requests: [rq({ orderId: '1', items: [{ article: 'BowlGrayMini_01', qty: 36 }] })], expected: {} },
    { name: 'журнал работает, если строка Ozon ещё без состава и без снятия', shipments: [sh({ orderId: '1', items: [] })], requests: [rq({ orderId: '1', items: [{ article: 'BowlGrayMini_01', qty: 36 }] })], expected: { BowlGrayMini_01: 36 } },
    { name: 'живой срез 26.09: три поставки BowlGray и одна прозр', shipments: [
      sh({ postingId: '1', items: [{ offerId: 'BowlGrayMini_01', barcode: 'OZN1368918716', quantity: 54 }] }),
      sh({ postingId: '2', items: [{ offerId: 'BowlGrayMini_01', barcode: 'OZN1368918716', quantity: 36 }] }),
      sh({ postingId: '3', status: 'processed', ozonStatus: 'IN_TRANSIT', items: [{ offerId: 'Органайзер_2_пол_прозр', quantity: 24 }] }),
      sh({ postingId: '4', ozonStatus: 'REPORTS_CONFIRMATION_AWAITING', status: 'processed', items: [{ offerId: 'BowlGrayMini_01', quantity: 72 }] })
    ], requests: [], expected: { BowlGrayMini_01: 90 } }
  ];

  for (const c of cases) {
    it(c.name, () => {
      const { ts, gs } = both(c.shipments, c.requests);
      expect(ts).toEqual(c.expected);
      expect(gs).toEqual(c.expected);
    });
  }

  it('300 generated sets: the two copies agree on every one', () => {
    // A small deterministic generator, so a failure is reproducible.
    let seed = 20260926;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const statuses = ['', 'DATA_FILLING', 'READY_TO_SUPPLY', 'ACCEPTED_AT_SUPPLY_WAREHOUSE', 'IN_TRANSIT', 'ACCEPTANCE_AT_STORAGE_WAREHOUSE',
      'REPORTS_CONFIRMATION_AWAITING', 'REPORT_REJECTED', 'COMPLETED', 'CANCELLED', 'REJECTED_AT_SUPPLY_WAREHOUSE', 'OVERDUE', 'weird'];
    const locals = ['new', 'processed', 'ignored', 'NEW', ''];
    const articles = [{ offerId: 'BowlGrayMini_01' }, { offerId: 'x', barcode: 'OZN1368918716' }, { offerId: 'органайзер_2_пол_прозр' }, { offerId: 'Прочее' }];
    const ages = [0.2, 3, 6.9, 7.2, 30];
    for (let n = 0; n < 300; n++) {
      const shipments: ExternalShipment[] = [];
      const requests: OzonSupplyRequestRow[] = [];
      const k = 1 + Math.floor(rnd() * 6);
      for (let i = 0; i < k; i++) {
        const a = pick(articles);
        shipments.push(sh({
          postingId: String(i), orderId: String(Math.floor(rnd() * 4)), status: pick(locals), ozonStatus: pick(statuses),
          detectedAt: ago(pick(ages)), isVirtual: rnd() < 0.1,
          items: rnd() < 0.1 ? [] : [{ ...a, quantity: Math.floor(rnd() * 40) - 2 }]
        }));
      }
      const r = Math.floor(rnd() * 3);
      for (let i = 0; i < r; i++) {
        requests.push(rq({
          orderId: String(Math.floor(rnd() * 6)), date: ago(pick(ages)), status: pick(['Создана', 'Отменена', 'отменена', 'Завершена']),
          items: [{ article: pick(['BowlGrayMini_01', 'Органайзер_2_пол_прозр']), qty: Math.floor(rnd() * 30) }]
        }));
      }
      const { ts, gs } = both(shipments, requests);
      expect(gs, `set ${n}`).toEqual(ts);
    }
  });
});

// ===== The real server check, from its sheets =====

const SHIP_HEADERS = ['PostingID', 'Дата обнаружения', 'Дата отгрузки', 'Статус', 'ПозицииJSON', 'TransGroupInfo', 'OrderID', 'Номер заявки',
  'Статус Ozon', 'Дата статуса Ozon', 'Пункт отгрузки', 'Склад хранения', 'Таймслот', 'Кабинет', 'ПринятоJSON', 'ПерерасчётJSON', 'ПересортJSON',
  'КластерID', 'Виртуальная', 'ИсходнаяПоставка', 'ОтгруженоJSON'];
const REQ_HEADERS = ['ID', 'Дата', 'Кабинет', 'DraftID', 'OrderID', 'Точка отгрузки', 'Кластеры', 'Состав', 'Кто', 'Статус', 'Документы'];

interface Setup {
  stock: Record<string, number>;
  kits?: { kitSku: string; componentSku: string; quantity: number; kitType: string }[];
  shipments?: { id: string; status: string; ozonStatus: string; items: any[]; orderId?: string }[];
  requests?: { orderId: string; items: any[] }[];
}

function serverCheck(setup: Setup, items: { article: string; quantity: number }[]) {
  const stand = freshStand();
  stand.setNow(NOW.toISOString());
  stand.setStockSheet(Object.keys(setup.stock).map((a) => ({ article: a, quantity: setup.stock[a], avgCost: 1, capitalization: setup.stock[a] })));
  stand.setKitSheet(setup.kits || []);
  stand.setSkuSheet(['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon'], [['BowlGrayMini_01', 18, 0, 'OZN1368918716']]);
  const idx = (h: string) => SHIP_HEADERS.indexOf(h);
  stand.setRegistrySheet('Внешние отгрузки', [SHIP_HEADERS, ...(setup.shipments || []).map((s) => {
    const row = new Array(SHIP_HEADERS.length).fill('');
    row[idx('PostingID')] = s.id; row[idx('Дата обнаружения')] = '2026-09-15 10:00:00'; row[idx('Статус')] = s.status;
    row[idx('Статус Ozon')] = s.ozonStatus; row[idx('ПозицииJSON')] = JSON.stringify(s.items); row[idx('OrderID')] = s.orderId || s.id;
    row[idx('КластерID')] = '4039';
    return row;
  })]);
  stand.setRegistrySheet('Заявки Ozon', [REQ_HEADERS, ...(setup.requests || []).map((r) => {
    const row = new Array(REQ_HEADERS.length).fill('');
    row[REQ_HEADERS.indexOf('ID')] = 'SUP-' + r.orderId; row[REQ_HEADERS.indexOf('Дата')] = '2026-09-16T08:00:00Z';
    row[REQ_HEADERS.indexOf('OrderID')] = r.orderId; row[REQ_HEADERS.indexOf('Состав')] = JSON.stringify(r.items);
    row[REQ_HEADERS.indexOf('Статус')] = 'Создана';
    return row;
  })]);
  const res = stand.context.checkSupplyAvailability({ items });
  return JSON.parse(JSON.stringify(res.items)) as { article: string; requested: number; available: number; enough: boolean }[];
}

const KITS = [
  { kitSku: 'GRAY', componentSku: 'BowlGray', quantity: 1, kitType: 'virtual' },
  { kitSku: 'GRAY', componentSku: 'Бутылки', quantity: 1, kitType: 'virtual' },
  { kitSku: 'BLUE', componentSku: 'BowlBlue', quantity: 1, kitType: 'virtual' },
  { kitSku: 'BLUE', componentSku: 'Бутылки', quantity: 2, kitType: 'virtual' },
  { kitSku: 'LEG', componentSku: 'BowlGray', quantity: 5, kitType: 'legacy' }
];

describe('item 85, step 1.5: checkSupplyAvailability on the stand', () => {
  it('без других заявок: хватает ровно до остатка', () => {
    expect(serverCheck({ stock: { A: 100 } }, [{ article: 'A', quantity: 100 }])[0]).toEqual({ article: 'A', requested: 100, available: 100, enough: true });
    expect(serverCheck({ stock: { A: 100 } }, [{ article: 'A', quantity: 101 }])[0].enough).toBe(false);
  });

  it('резерв другой созданной заявки вычитается: 100 − 60 = 40', () => {
    const setup: Setup = { stock: { A: 100 }, shipments: [{ id: '1', status: 'new', ozonStatus: 'READY_TO_SUPPLY', items: [{ offerId: 'A', quantity: 60 }] }] };
    expect(serverCheck(setup, [{ article: 'A', quantity: 40 }])[0]).toEqual({ article: 'A', requested: 40, available: 40, enough: true });
    expect(serverCheck(setup, [{ article: 'A', quantity: 50 }])[0]).toEqual({ article: 'A', requested: 50, available: 40, enough: false });
  });

  it('списанная, отменённая и виртуальная поставки склад не занимают', () => {
    const setup: Setup = { stock: { A: 100 }, shipments: [
      { id: '1', status: 'processed', ozonStatus: 'IN_TRANSIT', items: [{ offerId: 'A', quantity: 60 }] },
      { id: '2', status: 'new', ozonStatus: 'CANCELLED', items: [{ offerId: 'A', quantity: 60 }] }
    ] };
    expect(serverCheck(setup, [{ article: 'A', quantity: 100 }])[0].enough).toBe(true);
  });

  it('заявка из журнала, которую Ozon ещё не прислал, тоже занимает склад', () => {
    const setup: Setup = { stock: { A: 100 }, requests: [{ orderId: '9', items: [{ article: 'A', clusterId: '4039', qty: 70 }] }] };
    expect(serverCheck(setup, [{ article: 'A', quantity: 31 }])[0]).toEqual({ article: 'A', requested: 31, available: 30, enough: false });
  });

  it('один товар в двух строках заявки суммируется: 30 + 30 при остатке 50 — не хватает', () => {
    const res = serverCheck({ stock: { A: 50 } }, [{ article: 'A', quantity: 30 }, { article: 'A', quantity: 30 }]);
    expect(res).toEqual([{ article: 'A', requested: 60, available: 50, enough: false }]);
  });

  it('два комплекта с общими бутылками в одной заявке: вместе больше, чем бутылок', () => {
    // Бутылок 10; GRAY 6 шт × 1 + BLUE 3 шт × 2 = 12 бутылок.
    const res = serverCheck({ stock: { BowlGray: 100, BowlBlue: 100, 'Бутылки': 10 }, kits: KITS }, [{ article: 'GRAY', quantity: 6 }, { article: 'BLUE', quantity: 3 }]);
    expect(res).toEqual([
      { article: 'GRAY', requested: 6, available: 4, enough: false },
      { article: 'BLUE', requested: 3, available: 2, enough: false }
    ]);
  });

  it('те же комплекты, бутылок хватает на оба — проходит', () => {
    const res = serverCheck({ stock: { BowlGray: 100, BowlBlue: 100, 'Бутылки': 12 }, kits: KITS }, [{ article: 'GRAY', quantity: 6 }, { article: 'BLUE', quantity: 3 }]);
    expect(res.every((r) => r.enough)).toBe(true);
  });

  it('резерв одного комплекта уменьшает другой: GRAY занял 8 бутылок из 10, BLUE (норма 2) — 1 шт', () => {
    const setup: Setup = { stock: { BowlGray: 100, BowlBlue: 100, 'Бутылки': 10 }, kits: KITS,
      shipments: [{ id: '1', status: 'new', ozonStatus: 'READY_TO_SUPPLY', items: [{ offerId: 'GRAY', quantity: 8 }] }] };
    expect(serverCheck(setup, [{ article: 'BLUE', quantity: 2 }])[0]).toEqual({ article: 'BLUE', requested: 2, available: 1, enough: false });
  });

  it('компонент отдельной строкой рядом с комплектом делит тот же остаток', () => {
    const res = serverCheck({ stock: { BowlGray: 100, 'Бутылки': 10 }, kits: KITS }, [{ article: 'GRAY', quantity: 6 }, { article: 'Бутылки', quantity: 5 }]);
    expect(res.find((r) => r.article === 'Бутылки')).toEqual({ article: 'Бутылки', requested: 5, available: 4, enough: false });
    expect(res.find((r) => r.article === 'GRAY')).toEqual({ article: 'GRAY', requested: 6, available: 5, enough: false });
  });

  it('legacy-комплект проверяется по своему остатку, не по компонентам', () => {
    expect(serverCheck({ stock: { LEG: 3, BowlGray: 0 }, kits: KITS }, [{ article: 'LEG', quantity: 3 }])[0].enough).toBe(true);
  });

  it('резерв больше остатка: доступно 0, не минус', () => {
    const setup: Setup = { stock: { A: 10 }, shipments: [{ id: '1', status: 'new', ozonStatus: 'READY_TO_SUPPLY', items: [{ offerId: 'A', quantity: 60 }] }] };
    expect(serverCheck(setup, [{ article: 'A', quantity: 1 }])[0]).toEqual({ article: 'A', requested: 1, available: 0, enough: false });
  });

  it('пустой список — ошибка, как раньше', () => {
    expect(() => serverCheck({ stock: { A: 1 } }, [])).toThrow('Не передан список товаров');
  });
});
