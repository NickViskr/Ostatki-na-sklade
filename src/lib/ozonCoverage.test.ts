import { describe, expect, it } from 'vitest';
import {
  buildOzonCoverage,
  calcCoverageDays,
  calcSupplyRecommendation,
  getLastFullWeeks,
  getMskWeekMonday,
  OzonCoverageInput,
  OzonCoverageSettings,
  parseExcludedClusters,
  parsePriorityClusters,
  resolveOzonArticle
} from './ozonCoverage';
import { KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

// Фабрика SKU для тестов resolveOzonArticle: заполняет только обязательные поля.
function makeSku(overrides: Partial<SKUItem> & { sku: string }): SKUItem {
  return {
    price: 0,
    minStock: 0,
    pcsPerBox: 1,
    boxesPerPallet: 1,
    volumeLiters: 0,
    leadTimeDays: 0,
    ...overrides
  };
}

// Фабрика настроек для calcSupplyRecommendation: значения по умолчанию, в тестах
// переопределяются только нужные поля.
function makeSettings(overrides: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4,
    minStockDays: 7,
    targetStockDays: 20,
    maxClusterDays: 0,
    factoryOrderDays: 14,
    returnsToSalePct: 0,
    excludedClusters: '',
    ...overrides
  };
}

describe('getMskWeekMonday', () => {
  it('дата, попадающая на понедельник МСК, возвращает саму себя', () => {
    // 2024-01-08 10:00 UTC = 13:00 МСК понедельника.
    expect(getMskWeekMonday(new Date('2024-01-08T10:00:00Z'))).toBe('2024-01-08');
  });

  it('дата на воскресенье МСК возвращает понедельник этой же недели', () => {
    // 2024-01-07 — воскресенье, понедельник недели — 2024-01-01.
    expect(getMskWeekMonday(new Date('2024-01-07T10:00:00Z'))).toBe('2024-01-01');
  });

  it('переход через границу месяца считается верно', () => {
    // 2024-03-03 — воскресенье, понедельник недели — 2024-02-26 (предыдущий месяц).
    expect(getMskWeekMonday(new Date('2024-03-03T10:00:00Z'))).toBe('2024-02-26');
  });

  it('по UTC ещё воскресенье, а по МСК уже понедельник (сдвиг +3 часа)', () => {
    // 2024-01-07 22:00 UTC + 3ч = 2024-01-08 01:00 МСК — уже понедельник.
    expect(getMskWeekMonday(new Date('2024-01-07T22:00:00Z'))).toBe('2024-01-08');
  });
});

describe('getLastFullWeeks', () => {
  const now = new Date('2024-01-10T10:00:00Z'); // среда, текущий понедельник МСК — 2024-01-08

  it('возвращает массив длиной count', () => {
    expect(getLastFullWeeks(now, 4)).toHaveLength(4);
  });

  it('текущая незавершённая неделя не входит в список', () => {
    const weeks = getLastFullWeeks(now, 4);
    expect(weeks).not.toContain(getMskWeekMonday(now));
    expect(weeks[weeks.length - 1]).toBe('2024-01-01'); // неделя перед текущей
  });

  it('даты идут по возрастанию с шагом 7 дней', () => {
    const weeks = getLastFullWeeks(now, 4);
    expect(weeks).toEqual(['2023-12-11', '2023-12-18', '2023-12-25', '2024-01-01']);
    for (let i = 1; i < weeks.length; i++) {
      const diffMs = new Date(weeks[i] + 'T00:00:00Z').getTime() - new Date(weeks[i - 1] + 'T00:00:00Z').getTime();
      expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });
});

describe('resolveOzonArticle', () => {
  it('сопоставляет по ozonBarcode («ШК Ozon»)', () => {
    const skus = [makeSku({ sku: 'ABC-1', ozonBarcode: '123456' })];
    expect(resolveOzonArticle(skus, 'какой-то-offer', '123456')).toBe('ABC-1');
  });

  it('сопоставляет по offer_id без учёта регистра, когда ШК Ozon не найден', () => {
    const skus = [makeSku({ sku: 'ABC-2' })];
    expect(resolveOzonArticle(skus, 'abc-2')).toBe('ABC-2');
  });

  it('ozonBarcode имеет приоритет над offer_id, когда они указывают на разные SKU', () => {
    const skus = [makeSku({ sku: 'ABC-1', ozonBarcode: '999' }), makeSku({ sku: 'ABC-2' })];
    expect(resolveOzonArticle(skus, 'ABC-2', '999')).toBe('ABC-1');
  });

  it('если ничего не сопоставлено — возвращается исходный offer_id', () => {
    expect(resolveOzonArticle([], 'XYZ-НЕТ-В-СПРАВОЧНИКЕ')).toBe('XYZ-НЕТ-В-СПРАВОЧНИКЕ');
  });
});

describe('parseExcludedClusters', () => {
  it('разбирает обычный список через запятую', () => {
    expect(parseExcludedClusters('101,202,303')).toEqual(new Set(['101', '202', '303']));
  });

  it('пустая строка даёт пустое множество', () => {
    expect(parseExcludedClusters('')).toEqual(new Set());
  });

  it('лишние пробелы и пустые элементы отбрасываются', () => {
    expect(parseExcludedClusters(' 101 , 202 ,, 303 ')).toEqual(new Set(['101', '202', '303']));
  });
});

describe('parsePriorityClusters', () => {
  it('разбирает обычный случай «КластерID:коэффициент» через запятую', () => {
    expect(parsePriorityClusters('101:2,202:1.5')).toEqual({ '101': 2, '202': 1.5 });
  });

  it('пустая строка даёт пустой объект', () => {
    expect(parsePriorityClusters('')).toEqual({});
  });

  it('дробный коэффициент разбирается верно', () => {
    expect(parsePriorityClusters('303:2.5')).toEqual({ '303': 2.5 });
  });
});

describe('calcCoverageDays', () => {
  it('обычный кластер: (остаток − скорость × неснижаемые дни) ÷ скорость', () => {
    // (100 - 10*5) / 10 = 5
    expect(calcCoverageDays(100, 10, 5, false)).toBe(5);
  });

  it('исключённый кластер считается без неснижаемого остатка: остаток ÷ скорость', () => {
    // 100 / 10 = 10, а не (100 - 50) / 10 = 5
    expect(calcCoverageDays(100, 10, 5, true)).toBe(10);
  });

  it('скорость 0 — покрытие не определено (null)', () => {
    expect(calcCoverageDays(100, 0, 5, false)).toBeNull();
  });

  it('остаток ниже неснижаемого даёт отрицательное покрытие', () => {
    // (20 - 10*5) / 10 = -3
    expect(calcCoverageDays(20, 10, 5, false)).toBe(-3);
  });
});

describe('calcSupplyRecommendation', () => {
  it('скорость 0 — рекомендации нет', () => {
    expect(calcSupplyRecommendation(0, 50, makeSettings(), 12, 1000)).toBeNull();
  });

  it('потребность отрицательная или нулевая (остатка достаточно) — рекомендации нет', () => {
    // need = 10*20 - 200 = 0 <= 0
    expect(calcSupplyRecommendation(10, 200, makeSettings({ targetStockDays: 20 }), 1, 1000)).toBeNull();
  });

  it('обычный случай: округление вверх до целых коробок, qty === boxes × pcsPerBox', () => {
    // need = 10*20 - 50 = 150, box = 12, boxesNeeded = ceil(150/12) = 13
    const rec = calcSupplyRecommendation(10, 50, makeSettings({ targetStockDays: 20 }), 12, 1000);
    expect(rec).not.toBeNull();
    expect(rec!.neededQty).toBe(150);
    expect(rec!.boxes).toBe(13);
    expect(rec!.qty).toBe(rec!.boxes * 12);
    expect(rec!.qty).toBe(156);
  });

  it('отсекатель maxClusterDays срабатывает, если после поставки срок продаж превысит порог', () => {
    // need = 200, boxesNeeded = 200 шт, (0 + 200)/10 = 20 дней > maxClusterDays 15
    const rec = calcSupplyRecommendation(
      10,
      0,
      makeSettings({ targetStockDays: 20, maxClusterDays: 15 }),
      1,
      1000
    );
    expect(rec).toBeNull();
  });

  it('maxClusterDays: 0 полностью выключает отсекатель', () => {
    const rec = calcSupplyRecommendation(
      10,
      0,
      makeSettings({ targetStockDays: 20, maxClusterDays: 0 }),
      1,
      1000
    );
    expect(rec).not.toBeNull();
    expect(rec!.boxes).toBe(200);
  });

  it('ограничение остатком Моего склада: коробок хватает не на всю потребность', () => {
    // need = 200, boxesNeeded = ceil(200/12) = 17, но на складе только 100 шт => maxBoxes = 8
    const rec = calcSupplyRecommendation(
      10,
      0,
      makeSettings({ targetStockDays: 20 }),
      12,
      100
    );
    expect(rec).not.toBeNull();
    expect(rec!.boxes).toBe(8);
    expect(rec!.qty).toBe(96);
    expect(rec!.limitedByMyStock).toBe(true);
  });

  it('когда склада хватает полностью — limitedByMyStock === false', () => {
    const rec = calcSupplyRecommendation(10, 50, makeSettings({ targetStockDays: 20 }), 12, 1000);
    expect(rec!.limitedByMyStock).toBe(false);
  });

  it('pcsPerBox = 0 трактуется как 1 коробка', () => {
    // need = 5*10 - 0 = 50, box = 1 (вместо 0)
    const rec = calcSupplyRecommendation(5, 0, makeSettings({ targetStockDays: 10 }), 0, 1000);
    expect(rec).not.toBeNull();
    expect(rec!.boxes).toBe(50);
    expect(rec!.qty).toBe(50);
  });
});
// ===== Пункт 36: компоненты виртуальных комплектов =====

const NOW = new Date('2024-01-10T10:00:00Z'); // среда; последняя полная неделя — 2024-01-01
const SALES_WEEK = '2024-01-01';

// Строка продаж без кластера: окно скорости = 4 недели = 28 дней, поэтому qty 28 даёт 1 шт/день.
function makeSalesRow(offerId: string, qty: number): OzonSalesRow {
  return { week: SALES_WEEK, cabinet: 'test', offerId, clusterName: '', qty, updatedAt: '', days: 7 };
}

// Строка остатков без КластерID: попадает только в totalEstimated, кластерных рекомендаций нет.
function makeStockRow(offerId: string, available: number): OzonStockRow {
  return {
    cabinet: 'test',
    sku: '',
    offerId,
    name: offerId,
    warehouseName: '',
    clusterName: '',
    clusterId: '',
    available,
    preparing: 0,
    requested: 0,
    transit: 0,
    excess: 0,
    returns: 0,
    other: 0,
    updatedAt: ''
  };
}

// Карточки SKU: у PACK карточки намеренно НЕТ — проверяем, что расчёт это переживает.
const KIT_SKUS: SKUItem[] = [
  makeSku({ sku: 'KIT-A', pcsPerBox: 1, leadTimeDays: 20 }),
  makeSku({ sku: 'KIT-B', pcsPerBox: 1, leadTimeDays: 20 }),
  makeSku({ sku: 'KIT-L', pcsPerBox: 1, leadTimeDays: 30 }),
  makeSku({ sku: 'MISKA', pcsPerBox: 10, leadTimeDays: 50 }),
  makeSku({ sku: 'BOTTLE', pcsPerBox: 100, leadTimeDays: 10 })
];

// BOTTLE входит в ОБА виртуальных комплекта — это случай «Бутылок» из ТЗ.
const KITS: KitItem[] = [
  {
    kitSku: 'KIT-A',
    type: 'virtual',
    components: [
      { componentSku: 'MISKA', quantity: 1 },
      { componentSku: 'BOTTLE', quantity: 2 }
    ]
  },
  {
    kitSku: 'KIT-B',
    type: 'virtual',
    components: [
      { componentSku: 'BOTTLE', quantity: 1 },
      { componentSku: 'PACK', quantity: 3 }
    ]
  },
  { kitSku: 'KIT-L', type: 'legacy', components: [{ componentSku: 'MISKA', quantity: 5 }] }
];

/**
 * Базовый вход:
 * скорости комплектов: KIT-A = 28/28 = 1 шт/д, KIT-B = 56/28 = 2 шт/д, KIT-L = 28/28 = 1 шт/д;
 * расчётные остатки на Ozon: KIT-A = 20, KIT-B = 30, KIT-L = 5 (возвратов и «в пути» нет).
 */
function makeKitsInput(overrides: Partial<OzonCoverageInput> = {}): OzonCoverageInput {
  return {
    stocks: [makeStockRow('KIT-A', 20), makeStockRow('KIT-B', 30), makeStockRow('KIT-L', 5)],
    sales: [makeSalesRow('KIT-A', 28), makeSalesRow('KIT-B', 56), makeSalesRow('KIT-L', 28)],
    skus: KIT_SKUS,
    clusters: [],
    settings: makeSettings({ minStockDays: 7, targetStockDays: 20, factoryOrderDays: 14 }),
    myStockAvailability: { MISKA: 13, BOTTLE: 40, PACK: 9 },
    factoryOnOrder: { PACK: 15 },
    kits: KITS,
    now: NOW,
    ...overrides
  };
}

describe('buildOzonCoverage: компоненты виртуальных комплектов (пункт 36)', () => {
  it('компонент одного комплекта: скорость и запас считаются по формуле', () => {
    // MISKA входит только в KIT-A с нормой 1.
    // скорость = 1 шт/д × 1 = 1; запас из комплектов = 20 × 1 = 20;
    // труба = 20 + Мой склад 13 + заказано 0 = 33.
    const miska = buildOzonCoverage(makeKitsInput()).components.find(c => c.component === 'MISKA')!;
    expect(miska.perDay).toBe(1);
    expect(miska.fromKitsQty).toBe(20);
    expect(miska.myStockQty).toBe(13);
    expect(miska.onOrderQty).toBe(0);
    expect(miska.pipelineQty).toBe(33);
    expect(miska.usedInKits).toEqual(['KIT-A']);
  });

  it('сигнал заказа по компоненту берёт срок поставки и коробку из карточки компонента', () => {
    // MISKA: срок 50 дн, коробка 10 шт. Порог = 50 + 7 = 57 дн = 1 × 57 = 57 шт > трубы 33 — сигнал есть.
    // Объём: 1 × (57 + 14) = 71; 71 − 33 = 38; ceil(38 / 10) = 4 коробки = 40 шт. Хватит на 33/1 = 33 дня.
    const miska = buildOzonCoverage(makeKitsInput()).components.find(c => c.component === 'MISKA')!;
    expect(miska.leadTimeDays).toBe(50);
    expect(miska.pcsPerBox).toBe(10);
    expect(miska.factory).not.toBeNull();
    expect(miska.factory!.thresholdDays).toBe(57);
    expect(miska.factory!.thresholdQty).toBe(57);
    expect(miska.factory!.pipelineQty).toBe(33);
    expect(miska.factory!.daysLeft).toBe(33);
    expect(miska.factory!.orderQty).toBe(40);
    expect(miska.factory!.orderBoxes).toBe(4);
  });

  it('компонент в ДВУХ комплектах: скорость и запас складываются', () => {
    // BOTTLE: KIT-A норма 2 и KIT-B норма 1.
    // скорость = 1 × 2 + 2 × 1 = 4; запас из комплектов = 20 × 2 + 30 × 1 = 40 + 30 = 70;
    // труба = 70 + Мой склад 40 = 110. Порог = (10 + 7) × 4 = 68 шт < 110 — сигнала нет.
    const bottle = buildOzonCoverage(makeKitsInput()).components.find(c => c.component === 'BOTTLE')!;
    expect(bottle.perDay).toBe(4);
    expect(bottle.fromKitsQty).toBe(70);
    expect(bottle.pipelineQty).toBe(110);
    expect(bottle.usedInKits).toEqual(['KIT-A', 'KIT-B']);
    expect(bottle.factory).toBeNull();
  });

  it('норма расхода не равна 1: скорость и запас умножаются на норму', () => {
    // PACK входит только в KIT-B с нормой 3: скорость = 2 × 3 = 6; запас = 30 × 3 = 90;
    // труба = 90 + Мой склад 9 + заказано на фабрике 15 = 114.
    const pack = buildOzonCoverage(makeKitsInput()).components.find(c => c.component === 'PACK')!;
    expect(pack.perDay).toBe(6);
    expect(pack.fromKitsQty).toBe(90);
    expect(pack.onOrderQty).toBe(15);
    expect(pack.pipelineQty).toBe(114);
  });

  it('компонент без карточки в SKU Базе не роняет расчёт: коробка 1, срок поставки 0', () => {
    // У PACK карточки нет. Порог = (0 + 7) × 6 = 42 шт < трубы 114 — сигнала нет.
    const pack = buildOzonCoverage(makeKitsInput()).components.find(c => c.component === 'PACK')!;
    expect(pack.pcsPerBox).toBe(1);
    expect(pack.leadTimeDays).toBe(0);
    expect(pack.factory).toBeNull();
  });

  it('legacy-комплект игнорируется полностью', () => {
    const res = buildOzonCoverage(makeKitsInput());
    // KIT-L (legacy) требует MISKA по 5 шт, но в расчёт компонентов не входит:
    // скорость MISKA осталась 1 (а не 1 + 1 × 5 = 6), запас — 20 (а не 20 + 5 × 5 = 45).
    const miska = res.components.find(c => c.component === 'MISKA')!;
    expect(miska.perDay).toBe(1);
    expect(miska.fromKitsQty).toBe(20);
    expect(miska.usedInKits).toEqual(['KIT-A']);
    expect(res.bottlenecks.map(b => b.kitSku)).toEqual(['KIT-A', 'KIT-B']);
    // Сигнал самого legacy-комплекта не меняется: труба 5 < порога (30 + 7) × 1 = 37.
    const kitL = res.articles.find(a => a.article === 'KIT-L')!;
    expect(kitL.factory).not.toBeNull();
    expect(kitL.factory!.thresholdQty).toBe(37);
  });

  it('у виртуального комплекта factory === null', () => {
    const res = buildOzonCoverage(makeKitsInput());
    expect(res.articles.find(a => a.article === 'KIT-A')!.factory).toBeNull();
    expect(res.articles.find(a => a.article === 'KIT-B')!.factory).toBeNull();
  });

  it('узкое место комплекта — компонент с наименьшим покрытием в днях', () => {
    const res = buildOzonCoverage(makeKitsInput());
    // KIT-A: MISKA 33 / 1 = 33 дня, BOTTLE 110 / 4 = 27.5 дня -> узкое место BOTTLE.
    const kitA = res.bottlenecks.find(b => b.kitSku === 'KIT-A')!;
    expect(kitA.componentSku).toBe('BOTTLE');
    expect(kitA.daysLeft).toBe(27.5);
    // KIT-B: BOTTLE 27.5 дня, PACK 114 / 6 = 19 дней -> узкое место PACK.
    const kitB = res.bottlenecks.find(b => b.kitSku === 'KIT-B')!;
    expect(kitB.componentSku).toBe('PACK');
    expect(kitB.daysLeft).toBe(19);
  });

  it('canAssembleQty = минимум по floor(остаток компонента ÷ норма)', () => {
    const res = buildOzonCoverage(makeKitsInput());
    // KIT-A: min(floor(13 / 1) = 13, floor(40 / 2) = 20) = 13.
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-A')!.canAssembleQty).toBe(13);
    // KIT-B: min(floor(40 / 1) = 40, floor(9 / 3) = 3) = 3.
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-B')!.canAssembleQty).toBe(3);
  });

  it('kits не передан: components и bottlenecks пустые, сигнал по товарам прежний', () => {
    const res = buildOzonCoverage(makeKitsInput({ kits: undefined }));
    expect(res.components).toEqual([]);
    expect(res.bottlenecks).toEqual([]);
    // KIT-A считается как обычный товар: труба = 20 + 0 = 20 < порога (20 + 7) × 1 = 27.
    // Объём: 1 × (27 + 14) = 41; 41 − 20 = 21; коробка 1 -> 21 шт. Хватит на 20 / 1 = 20 дней.
    const kitA = res.articles.find(a => a.article === 'KIT-A')!;
    expect(kitA.factory).not.toBeNull();
    expect(kitA.factory!.thresholdQty).toBe(27);
    expect(kitA.factory!.pipelineQty).toBe(20);
    expect(kitA.factory!.daysLeft).toBe(20);
    expect(kitA.factory!.orderQty).toBe(21);
  });
});
