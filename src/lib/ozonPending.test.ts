import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPendingSupplies,
  getPendingQty,
  isPendingActive,
  isPendingCleared,
  isShipmentSettled,
  isVirtualShipment,
  mergePendingWithRequested,
  PENDING_SAFETY_DAYS,
  type OzonSupplyRequestRow,
  type PendingSuppliesInput
} from './ozonPending';
import type { ExternalShipment, SKUItem } from '../types';

// Plan item 52. The reserve behind a supply order must shrink when the owner cancels
// PART of it in Ozon Seller — single clusters or single articles — while the rest stays
// alive. The mechanism itself was built by items 23, 30 and 31; these tests pin it down.
//
// Fixtures copy the real shape of the production sheets: one row of «Внешние отгрузки»
// per supply, each with its own КластерID, its own composition and its own Ozon status.
// The numbers are taken from the live order 125148175 (BowlGrayMini_01, 9 clusters).

const NOW = new Date('2026-08-26T12:38:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString().slice(0, 19).replace('T', ' ');

const ARTICLE = 'BowlGrayMini_01';
const OTHER = 'Органайзер_2_пол_PureWhite';

const skus: SKUItem[] = [
  { sku: ARTICLE, price: 0, minStock: 0, pcsPerBox: 6, ozonBarcode: '2043972703249', wbBarcode: '', boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 },
  { sku: OTHER, price: 0, minStock: 0, pcsPerBox: 8, ozonBarcode: '2043972700001', wbBarcode: '', boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }
];

/** One row of «Внешние отгрузки»: a single supply of the order into a single cluster. */
function supply(over: {
  postingId: string;
  clusterId: string;
  qty: number;
  article?: string;
  ozonStatus?: string;
  status?: string;
  orderId?: string;
  isVirtual?: boolean;
  detectedAt?: string;
}): ExternalShipment {
  const article = over.article || ARTICLE;
  return {
    postingId: over.postingId,
    detectedAt: over.detectedAt === undefined ? ago(1) : over.detectedAt,
    shipmentDate: '2026-08-28',
    status: over.status || 'new',
    itemsJSON: JSON.stringify([{ offerId: article, barcode: '', quantity: over.qty }]),
    transGroupInfo: '',
    orderId: over.orderId || '125148175',
    orderNumber: '125148175-1',
    ozonStatus: over.ozonStatus === undefined ? 'READY_TO_SUPPLY' : over.ozonStatus,
    cabinet: 'Mercurius',
    clusterId: over.clusterId,
    isVirtual: over.isVirtual === true
  };
}

/** One row of the «Заявки Ozon» journal — the application's own record of the order. */
function journal(over: Partial<OzonSupplyRequestRow> & { items?: Array<{ article?: string; clusterId: string; qty: number }> } = {}): OzonSupplyRequestRow {
  const items = over.items || [{ article: ARTICLE, clusterId: '4007', qty: 36 }];
  return {
    id: 'SUP-1785323089248',
    date: over.date === undefined ? ago(1) : over.date,
    cabinet: 'Mercurius',
    draftId: '125148000',
    orderId: over.orderId === undefined ? '125148175' : over.orderId,
    dropOffName: 'ЕКАТЕРИНБУРГ_ХАБ_ПЫШМА',
    clusters: items.map(i => i.clusterId).join(','),
    itemsJSON: JSON.stringify(items.map(i => ({ article: i.article || ARTICLE, clusterId: i.clusterId, qty: i.qty }))),
    who: 'администратор',
    status: over.status === undefined ? 'Создана' : over.status
  };
}

function build(over: Partial<PendingSuppliesInput> = {}) {
  return buildPendingSupplies({
    shipments: over.shipments || [],
    requests: over.requests || [],
    skus,
    now: over.now || NOW,
    safetyDays: over.safetyDays
  });
}

/** Whole reserve in pieces, across every article. */
const total = (res: ReturnType<typeof build>) =>
  Object.keys(res.byArticle).reduce((sum, a) => sum + res.byArticle[a], 0);

/** Nine live supplies of one order, exactly as the production order 125148175 looks. */
const NINE_CLUSTERS = [
  { clusterId: '4007', qty: 36 }, { clusterId: '4036', qty: 36 }, { clusterId: '4039', qty: 36 },
  { clusterId: '4041', qty: 36 }, { clusterId: '4043', qty: 36 }, { clusterId: '4046', qty: 18 },
  { clusterId: '4051', qty: 36 }, { clusterId: '4067', qty: 36 }, { clusterId: '4071', qty: 18 }
];
const liveOrder = () => NINE_CLUSTERS.map((c, i) => supply({ postingId: 'SUP-' + i, clusterId: c.clusterId, qty: c.qty }));

describe('резерв под заявку: живая заявка', () => {
  it('все девять кластеров живы — резерв 288 шт и разложен по кластерам', () => {
    const res = build({ shipments: liveOrder() });
    expect(total(res)).toBe(288);
    expect(res.byArticle[ARTICLE]).toBe(288);
    expect(res.byArticleCluster[ARTICLE]['4007']).toBe(36);
    expect(res.byArticleCluster[ARTICLE]['4046']).toBe(18);
    expect(res.details).toHaveLength(9);
    expect(res.unboundByArticle[ARTICLE]).toBeUndefined();
  });

  it('расшифровка помнит, откуда взялась каждая позиция', () => {
    const res = build({ shipments: liveOrder() });
    const d = res.details.find(x => x.clusterId === '4071');
    expect(d).toBeDefined();
    expect(d!.source).toBe('shipment');
    expect(d!.orderId).toBe('125148175');
    expect(d!.qty).toBe(18);
    expect(d!.ozonStatus).toBe('READY_TO_SUPPLY');
  });
});

describe('пункт 52: частичная отмена заявки в Ozon Seller', () => {
  it('отменены 3 кластера из 9 — резерв падает ровно на них, остальные живы', () => {
    const rows = liveOrder();
    rows[0].ozonStatus = 'CANCELLED'; // 4007, 36 шт
    rows[1].ozonStatus = 'CANCELLED'; // 4036, 36 шт
    rows[2].ozonStatus = 'CANCELLED'; // 4039, 36 шт
    const res = build({ shipments: rows });
    expect(total(res)).toBe(180);
    expect(res.byArticleCluster[ARTICLE]['4007']).toBeUndefined();
    expect(res.byArticleCluster[ARTICLE]['4036']).toBeUndefined();
    expect(res.byArticleCluster[ARTICLE]['4039']).toBeUndefined();
    expect(res.byArticleCluster[ARTICLE]['4041']).toBe(36);
    expect(res.details).toHaveLength(6);
  });

  it('в живой поставке урезали количество — резерв идёт за составом, а не за первым замером', () => {
    const rows = liveOrder();
    rows[4].itemsJSON = JSON.stringify([{ offerId: ARTICLE, barcode: '', quantity: 18 }]); // было 36
    const res = build({ shipments: rows });
    expect(total(res)).toBe(270);
    expect(res.byArticleCluster[ARTICLE]['4043']).toBe(18);
  });

  it('из поставки убрали артикул целиком — его кластер теряет резерв, чужой не трогается', () => {
    const rows = liveOrder();
    rows[3].itemsJSON = JSON.stringify([
      { offerId: ARTICLE, barcode: '', quantity: 20 },
      { offerId: OTHER, barcode: '', quantity: 10 }
    ]);
    const withBoth = build({ shipments: rows });
    expect(withBoth.byArticleCluster[OTHER]['4041']).toBe(10);

    rows[3].itemsJSON = JSON.stringify([{ offerId: ARTICLE, barcode: '', quantity: 20 }]);
    const afterDrop = build({ shipments: rows });
    expect(afterDrop.byArticle[OTHER]).toBeUndefined();
    expect(afterDrop.byArticleCluster[ARTICLE]['4041']).toBe(20);
  });

  it('заявка отменена целиком — резерва нет вовсе', () => {
    const rows = liveOrder().map(r => ({ ...r, ozonStatus: 'CANCELLED' }));
    const res = build({ shipments: rows });
    expect(total(res)).toBe(0);
    expect(res.details).toHaveLength(0);
  });

  it('нулевое количество в составе резерва не даёт', () => {
    const rows = liveOrder();
    rows[0].itemsJSON = JSON.stringify([{ offerId: ARTICLE, barcode: '', quantity: 0 }]);
    const res = build({ shipments: rows });
    expect(total(res)).toBe(252);
    expect(res.byArticleCluster[ARTICLE]['4007']).toBeUndefined();
  });
});

describe('пункт 52: журнал «Заявки Ozon» как подстраховка', () => {
  it('строк ещё нет, журнал свежий — резерв держится по журналу', () => {
    const res = build({ requests: [journal({ items: [{ clusterId: '4007', qty: 36 }, { clusterId: '4036', qty: 36 }] })] });
    expect(total(res)).toBe(72);
    expect(res.details.every(d => d.source === 'request')).toBe(true);
  });

  it('журналу больше предохранителя — резерв истёк сам', () => {
    const res = build({ requests: [journal({ date: ago(PENDING_SAFETY_DAYS + 1), items: [{ clusterId: '4007', qty: 36 }] })] });
    expect(total(res)).toBe(0);
  });

  it('журнал помечен «Отменена» — резерва нет', () => {
    const res = build({ requests: [journal({ status: 'Отменена' })] });
    expect(total(res)).toBe(0);
  });

  it('заявка отменена в Ozon, но запись журнала свежая — журнал НЕ воскрешает резерв', () => {
    const rows = liveOrder().map(r => ({ ...r, ozonStatus: 'CANCELLED' }));
    const res = build({ shipments: rows, requests: [journal()] });
    expect(total(res)).toBe(0);
  });

  it('часть кластеров отменена до первого опроса, живой кластер уже с составом — журнал молчит', () => {
    // Прокси не заводит строк на новые CANCELLED-поставки, поэтому в листе есть только живой
    // кластер. Как только у заявки появилась строка с составом, журнал в расчёт не идёт.
    const res = build({
      shipments: [supply({ postingId: 'SUP-live', clusterId: '4007', qty: 36 })],
      requests: [journal({ items: [{ clusterId: '4007', qty: 36 }, { clusterId: '4036', qty: 36 }] })]
    });
    expect(total(res)).toBe(36);
    expect(res.details.every(d => d.source === 'shipment')).toBe(true);
  });

  it('журнал и живая строка не задваивают одно и то же количество', () => {
    const res = build({ shipments: liveOrder(), requests: [journal({ items: NINE_CLUSTERS })] });
    expect(total(res)).toBe(288);
  });
});

describe('снятие резерва по факту', () => {
  it('списание проведено — резерв снят, даже если заявка ещё жива', () => {
    const rows = liveOrder().map(r => ({ ...r, status: 'processed' }));
    expect(total(build({ shipments: rows }))).toBe(0);
  });

  it('поставка проигнорирована — резерв снят', () => {
    const rows = liveOrder().map(r => ({ ...r, status: 'ignored' }));
    expect(total(build({ shipments: rows }))).toBe(0);
  });

  it('виртуальная заявка Ozon резерва не создаёт вовсе (пункт 31)', () => {
    const rows = liveOrder().map(r => ({ ...r, isVirtual: true }));
    expect(total(build({ shipments: rows }))).toBe(0);
  });

  it('отгрузка на Ozon резерв НЕ снимает — только фактическое списание (пункт 30)', () => {
    const rows = liveOrder().map(r => ({ ...r, ozonStatus: 'ACCEPTED_AT_SUPPLY_WAREHOUSE' }));
    expect(total(build({ shipments: rows }))).toBe(288);
  });

  it('отказ в приёмке и просрочка снимают резерв', () => {
    for (const st of ['REJECTED_AT_SUPPLY_WAREHOUSE', 'OVERDUE']) {
      const rows = liveOrder().map(r => ({ ...r, ozonStatus: st }));
      expect(total(build({ shipments: rows }))).toBe(0);
    }
  });

  it('живые статусы держат резерв сколько угодно долго, предохранитель к ним не применяется', () => {
    const rows = liveOrder().map(r => ({ ...r, detectedAt: ago(400) }));
    expect(total(build({ shipments: rows }))).toBe(288);
  });

  it('статус неизвестен — работает предохранитель по дате обнаружения', () => {
    const fresh = liveOrder().map(r => ({ ...r, ozonStatus: '', detectedAt: ago(PENDING_SAFETY_DAYS - 1) }));
    expect(total(build({ shipments: fresh }))).toBe(288);
    const stale = liveOrder().map(r => ({ ...r, ozonStatus: '', detectedAt: ago(PENDING_SAFETY_DAYS + 1) }));
    expect(total(build({ shipments: stale }))).toBe(0);
  });
});

describe('позиции без кластера', () => {
  it('идут в общий итог, но не в кластерный расчёт', () => {
    const res = build({ shipments: [supply({ postingId: 'SUP-x', clusterId: '', qty: 12 })] });
    expect(res.byArticle[ARTICLE]).toBe(12);
    expect(res.unboundByArticle[ARTICLE]).toBe(12);
    expect(res.byArticleCluster[ARTICLE]).toBeUndefined();
  });
});

describe('хелперы', () => {
  it('isPendingCleared и isPendingActive не пересекаются', () => {
    expect(isPendingCleared('CANCELLED')).toBe(true);
    expect(isPendingCleared('cancelled')).toBe(true);
    expect(isPendingActive('CANCELLED')).toBe(false);
    expect(isPendingActive('READY_TO_SUPPLY')).toBe(true);
    expect(isPendingCleared('')).toBe(false);
    expect(isPendingActive('')).toBe(false);
  });

  it('isShipmentSettled и isVirtualShipment', () => {
    expect(isShipmentSettled('processed')).toBe(true);
    expect(isShipmentSettled('ignored')).toBe(true);
    expect(isShipmentSettled('new')).toBe(false);
    expect(isVirtualShipment({ isVirtual: true })).toBe(true);
    expect(isVirtualShipment({})).toBe(false);
  });

  it('getPendingQty достаёт пару «артикул + кластер»', () => {
    const res = build({ shipments: liveOrder() });
    expect(getPendingQty(res, ARTICLE, '4051')).toBe(36);
    expect(getPendingQty(res, ARTICLE, '9999')).toBe(0);
    expect(getPendingQty(res, 'нет такого', '4051')).toBe(0);
  });

  it('mergePendingWithRequested берёт НАИБОЛЬШЕЕ из двух, а не сумму', () => {
    expect(mergePendingWithRequested(8, 8)).toBe(8);
    expect(mergePendingWithRequested(8, 3)).toBe(8);
    expect(mergePendingWithRequested(3, 8)).toBe(8);
    expect(mergePendingWithRequested(-5, 0)).toBe(0);
  });
});

describe('битые данные не роняют расчёт', () => {
  it('нечитаемый JSON состава просто не даёт резерва', () => {
    const rows = liveOrder();
    rows[0].itemsJSON = '{не json';
    expect(total(build({ shipments: rows }))).toBe(252);
  });

  it('пустые списки дают пустой результат', () => {
    const res = build({});
    expect(res.details).toHaveLength(0);
    expect(res.byArticle).toEqual({});
  });
});

// ---- 12.09.2026, a defect found by the owner on production: after «Заявка создана в Ozon»
// the block «Рекомендации» kept the old numbers until he left the tab and came back.
// The netting reads the journal «Заявки Ozon» (ozonSupplyRequests) once on entry to the tab;
// the wizard appended the new row and never re-read the list. The guard pins the one place
// that re-reads it and the ORDER: right after the creation toast, before the cargo/Drive
// stage, so the numbers move while the supply is still being finished.
describe('рекомендации пересчитываются сразу после создания заявки', () => {
  const modal = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonSupplyModal.tsx'), 'utf8');

  it('мастер берёт перечитывание журнала из хранилища', () => {
    expect(modal).toContain('const fetchOzonSupplyRequests = useWarehouseStore((state) => state.fetchOzonSupplyRequests);');
  });

  it('журнал перечитывается сразу после сообщения «Заявка создана», ДО достройки поставки', () => {
    const toastAt = modal.indexOf("toast.success('Заявка создана в Ozon. Номер: ' + orderId);");
    const refetchAt = modal.indexOf('fetchOzonSupplyRequests();');
    const finalizeAt = modal.indexOf('await finalizeSupply(orderId);');
    expect(toastAt).toBeGreaterThan(-1);
    expect(refetchAt).toBeGreaterThan(toastAt);
    expect(finalizeAt).toBeGreaterThan(refetchAt);
  });

  it('перечитывание не ждётся: достройка не должна стоять за чтением журнала', () => {
    expect(modal).not.toContain('await fetchOzonSupplyRequests()');
  });
});

// ===== Item 100.7 (review b4-planning): R-032 and R-036. Written FAILING first; the fix follows. =====

describe('R-032: after «return the unshipped part» only the shipped quantity stays in flight', () => {
  const now = new Date('2026-10-20T08:00:00Z');
  const row = (over: Partial<ExternalShipment> = {}): ExternalShipment => ({
    postingId: 'P1', detectedAt: '2026-10-19 12:00:00', shipmentDate: '2026-10-19', status: 'processed',
    itemsJSON: JSON.stringify([{ offerId: ARTICLE, quantity: 10 }]), transGroupInfo: '', orderId: 'O1',
    ozonStatus: 'IN_TRANSIT', clusterId: 'C1', cabinet: 'M', ...over
  });
  const record = (shipped: number) => JSON.stringify({
    lines: [{ offerId: ARTICLE, article: ARTICLE, declared: 10, shipped }],
    returnTxIds: ['T1'], returnedAt: '2026-10-19 13:00:00', by: 'x'
  });

  it('counts 5 in flight, not the declared 10, when 5 of 10 were shipped and 5 returned', () => {
    const res = buildPendingSupplies({ shipments: [row({ shippedJSON: record(5) })], requests: [], skus, now });
    expect(res.byArticleCluster[ARTICLE]?.C1).toBe(5);
    expect(res.byArticle).toEqual({});
  });

  it('control: a row never returned (no shippedJSON) keeps the declared 10 in flight', () => {
    const res = buildPendingSupplies({ shipments: [row()], requests: [], skus, now });
    expect(res.byArticleCluster[ARTICLE]?.C1).toBe(10);
  });

  it('shipped 0 (whole supply returned) leaves nothing in flight', () => {
    const res = buildPendingSupplies({ shipments: [row({ shippedJSON: record(0) })], requests: [], skus, now });
    expect(res.byArticleCluster[ARTICLE]?.C1 || 0).toBe(0);
  });
});

describe('R-036: the 7-day safety window reads the sheet date in the script zone Asia/Yekaterinburg, not the process zone', () => {
  // detectedAt is written by Code.gs in the script zone (+05:00): 2026-10-13 12:00 = 07:00Z.
  // At 2026-10-20 08:00Z 169 h have passed => expired in ANY process TZ.
  // Run this file under TZ=UTC and TZ=Asia/Yekaterinburg — both must pass.
  const unknownStatusRow = (detectedAt: string): ExternalShipment => ({
    postingId: 'P1', detectedAt, shipmentDate: '', status: 'new',
    itemsJSON: JSON.stringify([{ offerId: ARTICLE, quantity: 10 }]), transGroupInfo: '', orderId: 'O1',
    ozonStatus: 'NEW_UNKNOWN', clusterId: '', cabinet: 'M'
  });

  it('a row 169 h old (script zone) is expired: no reserve', () => {
    const res = buildPendingSupplies({ shipments: [unknownStatusRow('2026-10-13 12:00:00')], requests: [], skus, now: new Date('2026-10-20T08:00:00Z') });
    expect(res.byArticle).toEqual({});
  });

  it('a row 167 h old (script zone) is still reserved', () => {
    // 2026-10-13 14:00 +05:00 = 09:00Z; now 2026-10-20 08:00Z => 167 h.
    const res = buildPendingSupplies({ shipments: [unknownStatusRow('2026-10-13 14:00:00')], requests: [], skus, now: new Date('2026-10-20T08:00:00Z') });
    expect(res.byArticle).toEqual({ [ARTICLE]: 10 });
  });
});

// ===== Item 100.7: R-036 real date formats reaching parseSheetDate (via the 7-day safety window) =====
// Real formats as the GAS API returns them: Code.gs getExternalShipments formats detectedAt as
// 'yyyy-MM-dd HH:mm:ss' and shipmentDate as 'yyyy-MM-dd' (script zone Asia/Yekaterinburg, +05:00);
// getOzonSupplyRequests returns the journal «Дата» as Date.toISOString() (UTC, 'Z', with milliseconds).
// Probe: a row whose reserve is kept iff the date parsed (NaN => null => not within the window).
// The instant 2026-10-13T07:00:00Z is 169 h before NOW_PROBE, so every format below that denotes it
// must be expired, and the same string shifted +3 h (09:00Z, 167 h) must be kept — under any process TZ.
describe('R-036: every real sheet date format parses to the same instant and never to NaN (run under TZ=UTC and TZ=Asia/Yekaterinburg)', () => {
  const NOW_PROBE = new Date('2026-10-20T08:00:00Z');
  const shipmentWith = (detectedAt: string, shipmentDate = ''): ExternalShipment => ({
    postingId: 'P1', detectedAt, shipmentDate, status: 'new',
    itemsJSON: JSON.stringify([{ offerId: ARTICLE, quantity: 10 }]), transGroupInfo: '', orderId: 'O1',
    ozonStatus: 'NEW_UNKNOWN', clusterId: '', cabinet: 'M'
  });
  const requestWith = (date: string): OzonSupplyRequestRow => ({
    id: 'SUP-1', date, cabinet: 'M', draftId: 'D1', orderId: 'O2', dropOffName: '', clusters: '',
    itemsJSON: JSON.stringify([{ article: ARTICLE, clusterId: 'C1', qty: 7 }]), who: 'x', status: 'Создана'
  });
  const keptByShipment = (detectedAt: string, shipmentDate = '') =>
    (buildPendingSupplies({ shipments: [shipmentWith(detectedAt, shipmentDate)], requests: [], skus, now: NOW_PROBE }).byArticle[ARTICLE] || 0) > 0;
  const keptByRequest = (date: string) =>
    (buildPendingSupplies({ shipments: [], requests: [requestWith(date)], skus, now: NOW_PROBE }).byArticle[ARTICLE] || 0) > 0;

  // [format label, string for 169 h ago (expired), string for 167 h ago (kept)]
  const shipmentFormats: Array<[string, string, string]> = [
    ['detectedAt yyyy-MM-dd HH:mm:ss (script zone)', '2026-10-13 12:00:00', '2026-10-13 14:00:00'],
    ['detectedAt ISO with T and no offset', '2026-10-13T12:00:00', '2026-10-13T14:00:00'],
    ['detectedAt ISO with +05:00', '2026-10-13T12:00:00+05:00', '2026-10-13T14:00:00+05:00'],
    ['detectedAt ISO with Z', '2026-10-13T07:00:00Z', '2026-10-13T09:00:00Z'],
    ['detectedAt ISO with Z and milliseconds', '2026-10-13T07:00:00.000Z', '2026-10-13T09:00:00.000Z']
  ];

  for (const [label, expired, kept] of shipmentFormats) {
    it(`shipment ${label}: parses (not NaN) and lands on the same instant`, () => {
      expect(keptByShipment(expired)).toBe(false);
      expect(keptByShipment(kept)).toBe(true);
    });
  }

  it('shipmentDate yyyy-MM-dd (date-only fallback when detectedAt is empty) is read as midnight +05:00, not NaN', () => {
    // 2026-10-13 00:00 +05:00 = 2026-10-12T19:00Z => 181 h before NOW_PROBE: expired.
    expect(keptByShipment('', '2026-10-13')).toBe(false);
    // 2026-10-14 00:00 +05:00 = 2026-10-13T19:00Z => 157 h: kept.
    expect(keptByShipment('', '2026-10-14')).toBe(true);
  });

  it('journal «Дата» as Date.toISOString() (Z with milliseconds) parses to the same instant', () => {
    expect(keptByRequest('2026-10-13T07:00:00.000Z')).toBe(false);
    expect(keptByRequest('2026-10-13T09:00:00.000Z')).toBe(true);
  });

  it('the offset-less script-zone string and the equal ISO-Z instant agree at the window boundary', () => {
    for (const [local, utc] of [['2026-10-13 13:00:00', '2026-10-13T08:00:00.000Z'], ['2026-10-13 12:59:59', '2026-10-13T07:59:59.000Z']]) {
      expect(keptByShipment(local)).toBe(keptByRequest(utc));
    }
  });
});

// ===== Item 100.7: R-032 matching gaps =====
describe('R-032: matching of shippedJSON lines to supply lines', () => {
  const now = new Date('2026-10-20T08:00:00Z');
  const base = (items: object[], shippedLines: object[]): ExternalShipment => ({
    postingId: 'P1', detectedAt: '2026-10-19 12:00:00', shipmentDate: '2026-10-19', status: 'processed',
    itemsJSON: JSON.stringify(items), transGroupInfo: '', orderId: 'O1', ozonStatus: 'IN_TRANSIT', clusterId: 'C1', cabinet: 'M',
    shippedJSON: JSON.stringify({ lines: shippedLines, returnTxIds: ['T1'], returnedAt: '2026-10-19 13:00:00', by: 'x' })
  });

  it('a shippedJSON line is matched by article when its offerId differs from the supply line offerId', () => {
    const row = base([{ offerId: ARTICLE, quantity: 10 }], [{ offerId: 'OTHER-OFFER-ID', article: ARTICLE, declared: 10, shipped: 4 }]);
    const res = buildPendingSupplies({ shipments: [row], requests: [], skus, now });
    expect(res.byArticleCluster[ARTICLE]?.C1).toBe(4);
  });

  it('two lines of one supply: the partly shipped line shrinks, the untouched line keeps its declared quantity', () => {
    const other = 'OtherArticle_77';
    const row = base(
      [{ offerId: ARTICLE, quantity: 10 }, { offerId: other, quantity: 6 }],
      [{ offerId: ARTICLE, article: ARTICLE, declared: 10, shipped: 3 }, { offerId: other, article: other, declared: 6, shipped: 6 }]
    );
    const res = buildPendingSupplies({ shipments: [row], requests: [], skus, now });
    expect(res.byArticleCluster[ARTICLE]?.C1).toBe(3);
    expect(res.byArticleCluster[other]?.C1).toBe(6);
  });

  it('a supply line absent from shippedJSON keeps its declared quantity', () => {
    const row = base([{ offerId: ARTICLE, quantity: 10 }], [{ offerId: 'Unrelated', article: 'Unrelated', declared: 2, shipped: 0 }]);
    const res = buildPendingSupplies({ shipments: [row], requests: [], skus, now });
    expect(res.byArticleCluster[ARTICLE]?.C1).toBe(10);
  });

  it('shipped greater than declared never inflates the reserve: min(declared, shipped) = declared', () => {
    const row = base([{ offerId: ARTICLE, quantity: 10 }], [{ offerId: ARTICLE, article: ARTICLE, declared: 10, shipped: 25 }]);
    const res = buildPendingSupplies({ shipments: [row], requests: [], skus, now });
    expect(res.byArticleCluster[ARTICLE]?.C1).toBe(10);
  });
});
