import { describe, expect, it } from 'vitest';
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
