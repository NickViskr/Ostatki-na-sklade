import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildComponentCoverage,
  buildOzonCoverage,
  calcCoverageDays,
  calcFactorySignal,
  calcSupplyRecommendation,
  coverageTone,
  factoryOnOrderByArticle,
  getLastFullWeeks,
  getMskWeekMonday,
  OzonCoverageInput,
  OzonCoverageSettings,
  parseExcludedClusters,
  parsePriorityClusters,
  resolveOzonArticle
} from './ozonCoverage';
import { FactoryOrder, KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

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

  it('ограничение остатком Моего склада: остаток раздаётся в штуках (пункт 51)', () => {
    // need = 200, wantQty = ceil(200/12)*12 = 204, а на складе 100 шт.
    // До пункта 51 здесь было 8 коробок и 96 шт: четыре штуки оставались лежать без дела.
    const rec = calcSupplyRecommendation(
      10,
      0,
      makeSettings({ targetStockDays: 20 }),
      12,
      100
    );
    expect(rec).not.toBeNull();
    expect(rec!.wantQty).toBe(204);
    expect(rec!.qty).toBe(100);
    expect(rec!.boxes).toBe(9);
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

// ===== Item 86, step C: deliveryToOzonDays (D) widens the need and the maxClusterDays ceiling =====
describe('calcSupplyRecommendation: срок доставки до Ozon (item 86 step C)', () => {
  it('D = 0 воспроизводит старое поведение день в день (регрессия)', () => {
    const withD0 = calcSupplyRecommendation(10, 50, makeSettings({ targetStockDays: 20, deliveryToOzonDays: 0 }), 12, 1000);
    const withoutD = calcSupplyRecommendation(10, 50, makeSettings({ targetStockDays: 20 }), 12, 1000);
    expect(withD0).toEqual(withoutD);
  });

  it('need растёт на perDay × D: need = perDay × (target + D) − estimated', () => {
    // need = 10 × (20 + 7) − 50 = 220, box = 12 → ceil(220/12) = 19 коробок = 228 шт
    const rec = calcSupplyRecommendation(10, 50, makeSettings({ targetStockDays: 20, deliveryToOzonDays: 7 }), 12, 1000);
    expect(rec).not.toBeNull();
    expect(rec!.neededQty).toBe(220);
    expect(rec!.boxes).toBe(19);
    expect(rec!.qty).toBe(228);
  });

  it('maxClusterDays теперь — дни продаж ПОСЛЕ приезда поставки: (estimated + wantQty) / perDay − D', () => {
    // need = 10*(10+5) - 0 = 150, box=1 → wantQty=150. (0+150)/10 - 5 = 10 дней <= maxClusterDays 10 — не срабатывает.
    const ok = calcSupplyRecommendation(10, 0, makeSettings({ targetStockDays: 10, deliveryToOzonDays: 5, maxClusterDays: 10 }), 1, 1000);
    expect(ok).not.toBeNull();
    expect(ok!.partialByMaxDays).toBe(false);
    expect(ok!.qty).toBe(150);

    // Тот же кластер медленнее: perDay=1. need = 1*(10+5) - 0 = 15, box=42 → wantQty=42.
    // (0+42)/1 - 5 = 37 дней > maxClusterDays 10 → неполная коробка ровно на потребность (15 шт),
    // после чего (0+15)/1 - 5 = 10 <= 10 — не отсекается.
    const partial = calcSupplyRecommendation(1, 0, makeSettings({ targetStockDays: 10, deliveryToOzonDays: 5, maxClusterDays: 10 }), 42, 1000);
    expect(partial).not.toBeNull();
    expect(partial!.partialByMaxDays).toBe(true);
    expect(partial!.qty).toBe(15);
    expect(partial!.fullBoxDays).toBe(37);
  });

  it('страховка: потолок ниже целевого запаса даже с учётом D — рекомендации нет', () => {
    // need = 10*(10+5) - 0 = 150. (0+150)/10 - 5 = 10 > maxClusterDays 5 → неполная коробка = need = 150.
    // Проверка (0+150)/10 - 5 = 10 всё ещё > 5 → null.
    const rec = calcSupplyRecommendation(10, 0, makeSettings({ targetStockDays: 10, deliveryToOzonDays: 5, maxClusterDays: 5 }), 1, 1000);
    expect(rec).toBeNull();
  });

  it('приоритетный кластер: D не умножается на коэффициент, а targetStockDays приходит уже умноженным вызывающей стороной', () => {
    // Имитация effectiveSettings из buildOzonCoverage: targetStockDays × k = 20 × 1.5 = 30, D остаётся 7.
    // need = 10 × (30 + 7) − 0 = 370.
    const rec = calcSupplyRecommendation(10, 0, makeSettings({ targetStockDays: 30, deliveryToOzonDays: 7 }), 1, 1000);
    expect(rec!.neededQty).toBe(370);
  });
});

// ===== Item 86, step C: calcFactorySignal's threshold widens by D =====
describe('calcFactorySignal: срок доставки до Ozon входит в порог (item 86 step C)', () => {
  // perDay=10, lead=3, minStockDays=7, factoryOrderDays=14, D=7, box=1, totalEstimated=100.
  const SETTINGS = makeSettings({ minStockDays: 7, factoryOrderDays: 14, deliveryToOzonDays: 7 });

  it('D = 0 воспроизводит старый порог lead + minStockDays день в день (регрессия)', () => {
    const withD0 = calcFactorySignal(100, 0, 10, 3, 1, { ...SETTINGS, deliveryToOzonDays: 0 });
    const withoutD = calcFactorySignal(100, 0, 10, 3, 1, { ...SETTINGS, deliveryToOzonDays: undefined });
    expect(withD0).toEqual(withoutD);
    // thresholdDays = 3 + 0 + 7 = 10, thresholdQty = 100; труба (100) НЕ ниже порога — сигнала нет.
    expect(withoutD).toBeNull();
  });

  it('thresholdDays = lead + D + minStockDays; тот же запас теперь ниже порога', () => {
    // thresholdDays = 3 + 7 + 7 = 17, thresholdQty = 170 > труба 100 → сигнал загорается,
    // хотя при D = 0 (тест выше) тот же запас порога не пробивал.
    const sig = calcFactorySignal(100, 0, 10, 3, 1, SETTINGS);
    expect(sig).not.toBeNull();
    expect(sig!.thresholdDays).toBe(17);
    expect(sig!.thresholdQty).toBe(170);
    // targetQty = 10 × (17 + 14) = 310; orderQty = ceil((310 − 100)/1) × 1 = 210.
    expect(sig!.orderQty).toBe(210);
  });

  it('приоритет не участвует: D читается из settings как есть, никакого умножения на коэффициент внутри calcFactorySignal', () => {
    const sig1 = calcFactorySignal(100, 0, 10, 3, 1, { ...SETTINGS, deliveryToOzonDays: 7 });
    const sig2 = calcFactorySignal(100, 0, 10, 3, 1, { ...SETTINGS, deliveryToOzonDays: 7 });
    expect(sig1!.thresholdDays).toBe(sig2!.thresholdDays);
  });
});

describe('calcFactorySignal: 500 сгенерированных наборов (item 86 step C)', () => {
  it('pipelineQty >= thresholdQty ⇔ нет сигнала \'total\' (при нулевом дефиците кластеров — сигнала нет вовсе)', () => {
    let seed = 8608;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 500; n++) {
      const perDay = rnd() * 20 + 0.1;
      const totalEstimated = Math.floor(rnd() * 500);
      const myStock = Math.floor(rnd() * 500);
      const lead = Math.floor(rnd() * 20);
      const deliveryToOzonDays = Math.floor(rnd() * 15);
      const minStockDays = Math.floor(rnd() * 20);
      const settings = makeSettings({ minStockDays, deliveryToOzonDays, factoryOrderDays: 14 });
      const sig = calcFactorySignal(totalEstimated, myStock, perDay, lead, 1, settings, 0, 0);
      const thresholdQty = perDay * (lead + deliveryToOzonDays + minStockDays);
      const pipelineQty = totalEstimated + myStock;
      const isBelow = pipelineQty < thresholdQty;
      expect(isBelow, `set ${n}`).toBe(sig !== null);
      if (sig) expect(sig.reason, `set ${n}`).toBe('total');
    }
  });
});

describe('buildOzonCoverage: сквозной путь с deliveryToOzonDays (item 86 step C)', () => {
  const NOW = new Date('2024-01-10T10:00:00Z');
  const WEEKS = ['2023-12-11', '2023-12-18', '2023-12-25', '2024-01-01'];
  const skus: SKUItem[] = [{ sku: 'A', price: 0, minStock: 0, pcsPerBox: 10, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 5 }];
  const sales: OzonSalesRow[] = WEEKS.map((week) => ({ week, cabinet: 'M', offerId: 'A', clusterName: 'Москва', qty: 70, updatedAt: '', days: 7 }));
  // Продажи 70 шт/неделю × 4 недели / 28 дней = 10 шт/день.
  const stock: OzonStockRow = { cabinet: 'M', sku: '', offerId: 'A', name: 'A', warehouseName: 'W', clusterName: 'Москва', clusterId: 'C1', available: 50, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: '' };

  function run(deliveryToOzonDays: number | undefined, myStock: number) {
    const settings: OzonCoverageSettings = {
      speedWeeks: 4, minStockDays: 7, targetStockDays: 20, deliveryToOzonDays, maxClusterDays: 0,
      factoryOrderDays: 14, returnsToSalePct: 0, excludedClusters: '', deficitDays: 0, demandGrowthPct: 0
    };
    const res = buildOzonCoverage({
      stocks: [stock], sales, skus, clusters: [{ clusterId: 'C1', clusterName: 'Москва' }], settings,
      myStockAvailability: { A: myStock }, now: NOW
    });
    return res.articles.find((a) => a.article === 'A')!;
  }

  it('рекомендация: D = 0 воспроизводит старое значение, D = 7 растит need на perDay × D (склада с избытком, чтобы не срезать)', () => {
    const artD0 = run(0, 10000);
    const artNoD = run(undefined, 10000);
    expect(artD0.clusters[0].recommendation).toEqual(artNoD.clusters[0].recommendation);
    // need = 10 × 20 − 50 = 150, box 10 → 150 шт ровно.
    expect(artD0.clusters[0].recommendation!.qty).toBe(150);

    const artD7 = run(7, 10000);
    // need = 10 × (20 + 7) − 50 = 220, box 10 → ceil(220/10) = 22 коробки = 220 шт.
    expect(artD7.clusters[0].recommendation!.qty).toBe(220);
  });

  it('заказ на фабрике: D = 0 воспроизводит старый порог, D = 7 растит thresholdQty/orderQty (склада мало, чтобы сигнал сработал)', () => {
    const artD0 = run(0, 5);
    const artNoD = run(undefined, 5);
    expect(artD0.factory).toEqual(artNoD.factory);
    // thresholdDays = 5 + 0 + 7 = 12, thresholdQty = 120; труба = 50 + 5 = 55 < 120 → сигнал есть.
    expect(artD0.factory!.thresholdDays).toBe(12);
    expect(artD0.factory!.thresholdQty).toBe(120);
    // targetQty = 10 × (12 + 14) = 260; orderQty = ceil((260 − 55)/10) × 10 = 210.
    expect(artD0.factory!.orderQty).toBe(210);

    const artD7 = run(7, 5);
    // thresholdDays = 5 + 7 + 7 = 19, thresholdQty = 190.
    expect(artD7.factory!.thresholdDays).toBe(19);
    expect(artD7.factory!.thresholdQty).toBe(190);
    // targetQty = 10 × (19 + 14) = 330; orderQty = ceil((330 − 55)/10) × 10 = 280.
    expect(artD7.factory!.orderQty).toBe(280);
  });
});

// ===== Пункт 36: компоненты виртуальных комплектов =====

const NOW = new Date('2024-01-10T10:00:00Z'); // среда; последняя полная неделя — 2024-01-01
// Все четыре недели окна скорости, а не одна: знаменатель считается по неделям, которые
// реально присутствуют в данных (пункт 39, этап B). Продажи в одной неделе означали бы окно
// в 7 дней, а не в 28, и скорости выросли бы вчетверо.
const SALES_WEEKS = ['2023-12-11', '2023-12-18', '2023-12-25', '2024-01-01'];

// Продажи без кластера, разложенные поровну по окну: окно = 4 недели = 28 дней,
// поэтому суммарный qty 28 даёт 1 шт/день.
function makeSalesRows(offerId: string, qty: number): OzonSalesRow[] {
  return SALES_WEEKS.map(week => ({
    week, cabinet: 'test', offerId, clusterName: '', qty: qty / SALES_WEEKS.length, updatedAt: '', days: 7
  }));
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
    sales: [...makeSalesRows('KIT-A', 28), ...makeSalesRows('KIT-B', 56), ...makeSalesRows('KIT-L', 28)],
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

// ============================================================================================
// Дефицит кластеров виртуального комплекта доходит до компонента, который держит сборку
// (29.08.2026, по разбору боевого случая BowlGrayMini_01).
//
// Комплект на фабрике не заказывают, поэтому сигнал заказа у него всегда null. До этой правки
// его непокрытая потребность кластеров не доходила НИКУДА: компонентам она передавалась
// жёстким нулём. Владелец видел «дефицит» у комплекта и полное молчание по бутылкам, из-за
// которых дефицит и возник, — при 1200 мисок серых на складе.
// ============================================================================================

const DEFICIT_SPEED: any = {
  weeks: ['2024-01-01'],
  windowDays: 7,
  totalQty: 0,
  totalPerDay: 0,
  qtyByArticle: {},
  perDayByArticle: { 'KIT-A': 1, 'KIT-B': 1 },
  qtyByCluster: {},
  qtyByArticleCluster: {}
};

/** Комплект из трёх компонентов: один в обрез, два в избытке — как серая миска в боевом случае. */
const DEFICIT_KITS: KitItem[] = [
  {
    kitSku: 'KIT-A',
    type: 'virtual',
    components: [
      { componentSku: 'MISKA', quantity: 1 },
      { componentSku: 'BOTTLE', quantity: 2 },
      { componentSku: 'PACK', quantity: 1 }
    ]
  }
];

function componentsWithUnmet(
  unmetByKit: Record<string, number>,
  myStock: Record<string, number>,
  kits: KitItem[] = DEFICIT_KITS
) {
  const { components } = buildComponentCoverage(
    kits,
    DEFICIT_SPEED,
    {},
    [
      makeSku({ sku: 'MISKA', pcsPerBox: 1, leadTimeDays: 10 }),
      makeSku({ sku: 'BOTTLE', pcsPerBox: 1, leadTimeDays: 10 }),
      makeSku({ sku: 'PACK', pcsPerBox: 1, leadTimeDays: 10 })
    ],
    myStock,
    {},
    makeSettings({ minStockDays: 7 }),
    undefined,
    undefined,
    unmetByKit
  );
  const by: Record<string, number> = {};
  for (const c of components) by[c.component] = c.factory ? c.factory.unmetDeficitQty : 0;
  return { by, components };
}

describe('дефицит комплекта доходит до компонента, который держит сборку', () => {
  it('узкое место получает дефицит комплекта, умноженный на норму', () => {
    // Свободно: MISKA 100 (хватает на 100 комплектов), BOTTLE 4 (на 2), PACK 100 (на 100).
    // Сборку держит BOTTLE. Дефицит комплекта 50 шт превращается в 50 × 2 = 100 шт бутылок.
    const { by } = componentsWithUnmet({ 'KIT-A': 50 }, { MISKA: 100, BOTTLE: 4, PACK: 100 });
    expect(by.BOTTLE).toBe(100);
  });

  it('компонент, лежащий в избытке, дефицита НЕ получает', () => {
    // Это и есть жалоба владельца: миски серые на складе есть, звать заказывать их нельзя.
    const { by } = componentsWithUnmet({ 'KIT-A': 50 }, { MISKA: 100, BOTTLE: 4, PACK: 100 });
    expect(by.MISKA).toBe(0);
    expect(by.PACK).toBe(0);
  });

  it('когда сборку держат двое одинаково, дефицит получают оба', () => {
    // MISKA 3 шт -> 3 комплекта, BOTTLE 6 шт при норме 2 -> тоже 3. Ничья.
    const { by } = componentsWithUnmet({ 'KIT-A': 10 }, { MISKA: 3, BOTTLE: 6, PACK: 100 });
    expect(by.MISKA).toBe(10);
    expect(by.BOTTLE).toBe(20);
    expect(by.PACK).toBe(0);
  });

  it('компонент двух комплектов складывает дефициты обоих', () => {
    const twoKits: KitItem[] = [
      { kitSku: 'KIT-A', type: 'virtual', components: [{ componentSku: 'BOTTLE', quantity: 2 }] },
      { kitSku: 'KIT-B', type: 'virtual', components: [{ componentSku: 'BOTTLE', quantity: 1 }] }
    ];
    const { by } = componentsWithUnmet({ 'KIT-A': 10, 'KIT-B': 7 }, { BOTTLE: 0 }, twoKits);
    expect(by.BOTTLE).toBe(10 * 2 + 7 * 1);
  });

  it('комплект без дефицита не передаёт компонентам ничего', () => {
    const { by } = componentsWithUnmet({}, { MISKA: 100, BOTTLE: 4, PACK: 100 });
    expect(by.BOTTLE).toBe(0);
    expect(by.MISKA).toBe(0);
  });

  it('дефицит поднимает сигнал у компонента, которому заказ по порогу не нужен', () => {
    // Запаса компонента хватает надолго, поэтому по порогу сигнала нет. Дефицит кластеров
    // обязан его зажечь — иначе комплект «в дефиците», а компонент молчит, как и было.
    const { components } = componentsWithUnmet({ 'KIT-A': 50 }, { MISKA: 100, BOTTLE: 4000, PACK: 100 });
    const bottle = components.find(c => c.component === 'BOTTLE')!;
    const miska = components.find(c => c.component === 'MISKA')!;
    // BOTTLE: свободно 4000 -> 2000 комплектов, это НЕ узкое место, дефицит уходит к MISKA/PACK.
    expect(bottle.factory).toBeNull();
    expect(miska.factory).not.toBeNull();
    expect(miska.factory!.reason).toBe('clusterDeficit');
    expect(miska.factory!.orderQty).toBe(0);
  });

  it('весь путь целиком: дефицит кластера у комплекта выходит на его компонент', () => {
    // Комплект продаётся в Москве, на Ozon его там нет — кластеру нужна поставка. Собрать
    // можно всего 2 штуки: бутылок свободно 2, мисок 500. Остальное кластеру не достанется,
    // и эта непокрытая потребность обязана дойти до БУТЫЛОК — не до мисок.
    const res = buildOzonCoverage({
      stocks: [
        { cabinet: 'test', sku: '', offerId: 'KIT-A', name: 'KIT-A', warehouseName: 'W1', clusterName: 'Москва', clusterId: 'C1', available: 0, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0 } as OzonStockRow
      ],
      sales: ['2023-12-11', '2023-12-18', '2023-12-25', '2024-01-01'].map((week) => ({
        week, cabinet: 'test', offerId: 'KIT-A', clusterName: 'Москва', qty: 7, updatedAt: '', days: 7
      })),
      skus: [
        makeSku({ sku: 'KIT-A', pcsPerBox: 1 }),
        makeSku({ sku: 'BOTTLE', pcsPerBox: 1, leadTimeDays: 10 }),
        makeSku({ sku: 'MISKA', pcsPerBox: 1, leadTimeDays: 10 })
      ],
      clusters: [{ clusterId: 'C1', clusterName: 'Москва' }],
      settings: makeSettings({ speedWeeks: 4, minStockDays: 7, targetStockDays: 20 }),
      myStockAvailability: { 'KIT-A': 2, BOTTLE: 2, MISKA: 500 },
      kits: [
        {
          kitSku: 'KIT-A',
          type: 'virtual',
          components: [{ componentSku: 'BOTTLE', quantity: 1 }, { componentSku: 'MISKA', quantity: 1 }]
        }
      ],
      now: WIDE_NOW
    });

    const kitRow = res.articles.find(a => a.article === 'KIT-A')!;
    const bottle = res.components.find(c => c.component === 'BOTTLE')!;
    const miska = res.components.find(c => c.component === 'MISKA')!;

    // У самого комплекта заказа на фабрике нет и быть не может — заказывают компоненты.
    expect(kitRow.factory).toBeNull();
    expect(kitRow.unmetDeficitQty).toBeGreaterThan(0);
    // Норма 1, поэтому дефицит переходит на бутылки один в один.
    expect(bottle.factory).not.toBeNull();
    expect(bottle.factory!.unmetDeficitQty).toBe(kitRow.unmetDeficitQty);
    // Мисок 500 — сборку они не держат и дефицита не получают.
    expect(miska.factory ? miska.factory.unmetDeficitQty : 0).toBe(0);
  });
});

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

/** Зачёт по созданным заявкам в форме, которую отдаёт buildPendingSupplies: заявки пишутся на комплект. */
function makePending(byArticle: Record<string, number>) {
  return { byArticleCluster: {}, byArticle };
}

describe('buildOzonCoverage: резерв заявок разворачивается в компоненты', () => {
  it('резерв комплекта уменьшает свободный остаток каждого компонента на резерв × норму', () => {
    // Заявка на 5 шт KIT-A: MISKA (норма 1) -> 5, BOTTLE (норма 2) -> 10.
    const res = buildOzonCoverage(makeKitsInput({ pending: makePending({ 'KIT-A': 5 }) }));
    const miska = res.components.find(c => c.component === 'MISKA')!;
    expect(miska.myStockQty).toBe(13); // сырой остаток не переопределяется
    expect(miska.reservedQty).toBe(5);
    expect(miska.freeMyStockQty).toBe(8);
    const bottle = res.components.find(c => c.component === 'BOTTLE')!;
    expect(bottle.myStockQty).toBe(40);
    expect(bottle.reservedQty).toBe(10);
    expect(bottle.freeMyStockQty).toBe(30);
  });

  it('canAssembleQty считается по свободному остатку', () => {
    const res = buildOzonCoverage(makeKitsInput({ pending: makePending({ 'KIT-A': 5 }) }));
    // KIT-A: min(floor(8 / 1) = 8, floor(30 / 2) = 15) = 8 вместо прежних 13.
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-A')!.canAssembleQty).toBe(8);
    // KIT-B: min(floor(30 / 1) = 30, floor(9 / 3) = 3) = 3 — узкое место PACK, резерва на него нет.
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-B')!.canAssembleQty).toBe(3);
  });

  it('резерв съел весь остаток компонента: собрать нельзя ни одного комплекта', () => {
    // Заявка на 13 шт KIT-A забирает всю MISKA (13 × 1 = 13).
    const res = buildOzonCoverage(makeKitsInput({ pending: makePending({ 'KIT-A': 13 }) }));
    expect(res.components.find(c => c.component === 'MISKA')!.freeMyStockQty).toBe(0);
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-A')!.canAssembleQty).toBe(0);
  });

  it('резерв больше остатка не даёт отрицательных чисел', () => {
    const res = buildOzonCoverage(makeKitsInput({ pending: makePending({ 'KIT-A': 100 }) }));
    const miska = res.components.find(c => c.component === 'MISKA')!;
    expect(miska.reservedQty).toBe(100);
    expect(miska.freeMyStockQty).toBe(0);
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-A')!.canAssembleQty).toBe(0);
  });

  it('компонент в ДВУХ комплектах: резервы обоих складываются', () => {
    // BOTTLE: KIT-A 5 × норма 2 = 10 плюс KIT-B 3 × норма 1 = 3, итого 13.
    const res = buildOzonCoverage(makeKitsInput({ pending: makePending({ 'KIT-A': 5, 'KIT-B': 3 }) }));
    const bottle = res.components.find(c => c.component === 'BOTTLE')!;
    expect(bottle.reservedQty).toBe(13);
    expect(bottle.freeMyStockQty).toBe(27);
  });

  it('норма расхода не равна 1: резерв умножается на норму', () => {
    // PACK входит в KIT-B с нормой 3: заявка на 2 комплекта резервирует 6 шт.
    const res = buildOzonCoverage(makeKitsInput({ pending: makePending({ 'KIT-B': 2 }) }));
    const pack = res.components.find(c => c.component === 'PACK')!;
    expect(pack.reservedQty).toBe(6);
    expect(pack.freeMyStockQty).toBe(3);
    // KIT-B: min(floor(BOTTLE 38 / 1) = 38, floor(3 / 3) = 1) = 1.
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-B')!.canAssembleQty).toBe(1);
  });

  it('ТРУБА и сигнал фабрики от созданной заявки НЕ меняются: штуки переходят со склада в «едет»', () => {
    // Item 85, step 1.2. The invariant is the same as before — creating a supply must not move
    // the factory order — but it now holds for the right reason. A real reserve always comes
    // with the same pieces on their way (buildPendingSupplies gives both), so they leave the
    // FREE stock and enter the kit's total at Ozon; the pipeline is unchanged.
    const before = buildOzonCoverage(makeKitsInput());
    const after = buildOzonCoverage(makeKitsInput({
      pending: {
        byArticle: { 'KIT-A': 5, 'KIT-B': 3 },
        byArticleCluster: {},
        unboundInFlightByArticle: { 'KIT-A': 5, 'KIT-B': 3 }
      }
    }));
    for (const c of after.components) {
      const old = before.components.find(x => x.component === c.component)!;
      expect(c.pipelineQty).toBe(old.pipelineQty);
      expect(c.myStockQty).toBe(old.myStockQty);
      expect(c.factory?.orderQty ?? null).toBe(old.factory?.orderQty ?? null);
    }
    // and the pieces really moved: BOTTLE free 40 → 27, from the kits 70 → 83
    const bottle = after.components.find(x => x.component === 'BOTTLE')!;
    expect(bottle.freeMyStockQty).toBe(27);
    expect(bottle.fromKitsQty).toBe(83);
  });

  it('pending не передан: поведение прежнее, резерв нулевой', () => {
    const res = buildOzonCoverage(makeKitsInput());
    for (const c of res.components) {
      expect(c.reservedQty).toBe(0);
      expect(c.freeMyStockQty).toBe(c.myStockQty);
    }
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-A')!.canAssembleQty).toBe(13);
    expect(res.bottlenecks.find(b => b.kitSku === 'KIT-B')!.canAssembleQty).toBe(3);
  });
});

// ===== Пункт 38: тренд продаж =====

const TREND_NOW = new Date('2024-01-10T10:00:00Z'); // среда; последняя полная неделя — 2024-01-01

/**
 * Строки продаж по неделям окна тренда: qtyByWeek[0] — самая старая неделя, последняя — свежая.
 * Строка пишется даже при нулевом количестве: иначе неделя не считается пришедшей с сервера
 * и вообще выпадет из окна, а нам нужен именно ноль внутри окна.
 */
function makeTrendSales(offerId: string, qtyByWeek: number[], clusterName = ''): OzonSalesRow[] {
  const weeks = getLastFullWeeks(TREND_NOW, qtyByWeek.length);
  return weeks.map((week, i) => ({
    week, cabinet: 'test', offerId, clusterName, qty: qtyByWeek[i], updatedAt: '', days: 7
  }));
}

function makeTrendInput(sales: OzonSalesRow[], overrides: Partial<OzonCoverageInput> = {}): OzonCoverageInput {
  return {
    stocks: [],
    sales,
    skus: [],
    clusters: [],
    settings: makeSettings({ trendWeeks: 13 }),
    myStockAvailability: {},
    now: TREND_NOW,
    ...overrides
  };
}

/** Тренд одного товара из полного расчёта покрытия. */
function trendOf(sales: OzonSalesRow[], overrides: Partial<OzonCoverageInput> = {}, article = 'X') {
  return buildOzonCoverage(makeTrendInput(sales, overrides)).trends[article];
}

// Ряды окна тренда: 13 недель, среднее 16 или 40, наклон ±1 или ±5 шт/неделю.
const GROW = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const FALL = [22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
const FLAT = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];

describe('buildSalesTrend: сырой множитель (пункт 38)', () => {
  it('ровно растущий ряд даёт множитель больше 1', () => {
    // среднее 16, наклон +1 шт/нед; raw = (16 + 1 × 4.345) ÷ 16 = 1.2715625.
    const t = trendOf(makeTrendSales('X', GROW));
    expect(t.mean).toBe(16);
    expect(t.slope).toBeCloseTo(1, 10);
    expect(t.raw).toBeCloseTo(1.2715625, 10);
    expect(t.raw).toBeGreaterThan(1);
  });

  it('ровно падающий ряд даёт множитель меньше 1', () => {
    // среднее 16, наклон −1 шт/нед; raw = (16 − 4.345) ÷ 16 = 0.7284375.
    const t = trendOf(makeTrendSales('X', FALL));
    expect(t.slope).toBeCloseTo(-1, 10);
    expect(t.raw).toBeCloseTo(0.7284375, 10);
    expect(t.raw).toBeLessThan(1);
  });

  it('плоский ряд даёт ровно 1.00 и множитель применяется без причины отклонения', () => {
    const t = trendOf(makeTrendSales('X', FLAT));
    expect(t.slope).toBe(0);
    expect(t.raw).toBe(1);
    expect(t.applied).toBe(1);
    expect(t.reason).toBeNull();
  });

  it('недельный ряд и итоги окна сохраняются для подсказки в интерфейсе', () => {
    const t = trendOf(makeTrendSales('X', GROW));
    expect(t.weeks).toHaveLength(13);
    expect(t.weekQty).toEqual(GROW);
    expect(t.windowQty).toBe(208);
    expect(t.zeroWeeks).toBe(0);
  });
});

describe('buildSalesTrend: фильтры (пункт 38)', () => {
  it('shortWindow: в окне меньше 6 недель с данными', () => {
    const t = trendOf(makeTrendSales('X', [20, 20, 20, 20, 20]));
    expect(t.applied).toBe(1);
    expect(t.reason).toBe('shortWindow');
  });

  it('correction: по товару сработала коррекция скорости при дефиците (пункт 42)', () => {
    // 9 недель по 100 шт, затем 4 недели по 10 — товар кончился. Остатка нет, значит дефицит;
    // лучшие 4 недели дают 100 ÷ 7 шт/д против базы 40 ÷ 28 — коррекция срабатывает.
    const sales = makeTrendSales('X', [100, 100, 100, 100, 100, 100, 100, 100, 100, 10, 10, 10, 10]);
    const res = buildOzonCoverage(makeTrendInput(sales, {
      stocks: [makeStockRow('X', 0)],
      settings: makeSettings({ trendWeeks: 13, deficitDays: 30 })
    }));
    expect(res.articles[0].speedCorrection).not.toBeNull();
    expect(res.trends['X'].applied).toBe(1);
    expect(res.trends['X'].reason).toBe('correction');
  });

  it('zeroWeek: в окне есть хотя бы одна неделя с нулевыми продажами', () => {
    const t = trendOf(makeTrendSales('X', [20, 20, 20, 0, 20, 20, 20, 20, 20, 20, 20, 20, 20]));
    expect(t.zeroWeeks).toBe(1);
    expect(t.applied).toBe(1);
    expect(t.reason).toBe('zeroWeek');
  });

  it('fewSales: за окно продано меньше 50 шт', () => {
    const t = trendOf(makeTrendSales('X', [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]));
    expect(t.windowQty).toBe(39);
    expect(t.applied).toBe(1);
    expect(t.reason).toBe('fewSales');
  });

  it('deficit: понижающий тренд при дефиците не применяется', () => {
    // minSalesForCorrection задран, чтобы коррекция скорости (фильтр выше по списку) не сработала.
    const t = trendOf(makeTrendSales('X', FALL), {
      stocks: [makeStockRow('X', 10)],
      settings: makeSettings({ trendWeeks: 13, deficitDays: 30, minSalesForCorrection: 100000 })
    });
    expect(t.raw).toBeCloseTo(0.7284375, 10);
    expect(t.applied).toBe(1);
    expect(t.reason).toBe('deficit');
  });

  it('deficit: ПОВЫШАЮЩИЙ тренд при дефиците применяется как обычно', () => {
    const t = trendOf(makeTrendSales('X', GROW), {
      stocks: [makeStockRow('X', 10)],
      settings: makeSettings({ trendWeeks: 13, deficitDays: 30, minSalesForCorrection: 100000 })
    });
    expect(t.applied).toBeCloseTo(1.2715625, 10);
    expect(t.reason).toBeNull();
  });
});

describe('buildSalesTrend: порядок фильтров и ограничение диапазоном (пункт 38)', () => {
  it('shortWindow побеждает zeroWeek и fewSales', () => {
    const t = trendOf(makeTrendSales('X', [3, 0, 3, 3, 3]));
    expect(t.reason).toBe('shortWindow');
  });

  it('correction побеждает deficit (падающий ряд у распроданного товара)', () => {
    const sales = makeTrendSales('X', [100, 100, 100, 100, 100, 100, 100, 100, 100, 10, 10, 10, 10]);
    const t = trendOf(sales, {
      stocks: [makeStockRow('X', 0)],
      settings: makeSettings({ trendWeeks: 13, deficitDays: 30 })
    });
    expect(t.raw).toBeLessThan(1); // сам по себе ряд попал бы и под фильтр дефицита
    expect(t.reason).toBe('correction');
  });

  it('zeroWeek побеждает fewSales', () => {
    const t = trendOf(makeTrendSales('X', [3, 3, 3, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3]));
    expect(t.windowQty).toBe(36); // меньше 50, то есть fewSales тоже подходит
    expect(t.reason).toBe('zeroWeek');
  });

  it('ограничение сверху: raw больше 1.5 обрезается до 1.5 с причиной clamped', () => {
    const t = trendOf(makeTrendSales('X', [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]));
    expect(t.raw).toBeCloseTo(1.543125, 10);
    expect(t.applied).toBe(1.5);
    expect(t.reason).toBe('clamped');
  });

  it('ограничение снизу: raw меньше 0.7 обрезается до 0.7 с причиной clamped', () => {
    const t = trendOf(makeTrendSales('X', [70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10]));
    expect(t.raw).toBeCloseTo(0.456875, 10);
    expect(t.applied).toBe(0.7);
    expect(t.reason).toBe('clamped');
  });

  it('внутри диапазона множитель применяется как есть, причины нет', () => {
    const t = trendOf(makeTrendSales('X', GROW));
    expect(t.applied).toBe(t.raw);
    expect(t.reason).toBeNull();
  });
});

describe('buildOzonCoverage: применение тренда (пункт 38)', () => {
  it('прогнозная скорость = факт × тренд × (1 + прирост, %)', () => {
    const res = buildOzonCoverage(makeTrendInput(makeTrendSales('X', GROW), {
      settings: makeSettings({ trendWeeks: 13, salesGrowthPct: 10 })
    }));
    const a = res.articles[0];
    // Скорость считается за speedWeeks = 4 последние недели: (19 + 20 + 21 + 22) ÷ 28.
    expect(a.perDay).toBeCloseTo(82 / 28, 10);
    expect(a.trend!.applied).toBeCloseTo(1.2715625, 10);
    expect(a.forecastPerDay).toBeCloseTo((82 / 28) * 1.2715625 * 1.1, 10);
  });

  it('прирост 0 и тренд 1 оставляют прогнозную скорость равной фактической', () => {
    const a = buildOzonCoverage(makeTrendInput(makeTrendSales('X', FLAT))).articles[0];
    expect(a.forecastPerDay).toBe(a.perDay);
  });

  it('сигнал заказа на фабрике считается по ПРОГНОЗНОЙ скорости', () => {
    // Растущий ряд: порог = прогноз × (срок 0 + неснижаемые 7). Прогноз 82/28 × 1.2715625 = 3.7238 шт/д,
    // порог 26.07 шт; труба 20 шт ниже порога. По факту (2.9286 шт/д) порог 20.5 — сигнала бы не было.
    const res = buildOzonCoverage(makeTrendInput(makeTrendSales('X', GROW), {
      stocks: [makeStockRow('X', 20)]
    }));
    const a = res.articles[0];
    expect(a.factory).not.toBeNull();
    expect(a.factory!.thresholdQty).toBeCloseTo(a.forecastPerDay * 7, 10);
    expect(a.factory!.thresholdQty).toBeGreaterThan(a.perDay * 7);
  });

  it('рекомендации на поставку в кластеры НЕ зависят от тренда и прироста', () => {
    // Один и тот же набор данных считается дважды: с приростом 50% и без него.
    const sales = makeTrendSales('X', GROW, 'Москва');
    const common: Partial<OzonCoverageInput> = {
      sales,
      stocks: [{ ...makeStockRow('X', 10), clusterId: '1', clusterName: 'Москва' }],
      clusters: [{ clusterId: '1', clusterName: 'Москва' }],
      myStockAvailability: { X: 1000 }
    };
    const withGrowth = buildOzonCoverage(makeTrendInput(sales, {
      ...common,
      settings: makeSettings({ trendWeeks: 13, salesGrowthPct: 50 })
    })).articles[0];
    const without = buildOzonCoverage(makeTrendInput(sales, {
      ...common,
      settings: makeSettings({ trendWeeks: 13, salesGrowthPct: 0 })
    })).articles[0];

    // Проверка имеет смысл только если тренд и прирост действительно живые.
    expect(withGrowth.trend!.applied).toBeGreaterThan(1);
    expect(withGrowth.forecastPerDay).toBeGreaterThan(without.forecastPerDay);

    expect(withGrowth.perDay).toBe(without.perDay);
    expect(withGrowth.clusters.map(c => c.perDay)).toEqual(without.clusters.map(c => c.perDay));
    expect(withGrowth.clusters.map(c => c.coverageDays)).toEqual(without.clusters.map(c => c.coverageDays));
    expect(withGrowth.clusters.map(c => c.recommendation)).toEqual(without.clusters.map(c => c.recommendation));
    expect(withGrowth.clusters[0].recommendation!.qty).toBeGreaterThan(0);
    expect(withGrowth.unmetDeficitQty).toBe(without.unmetDeficitQty);
  });

  it('компоненты виртуального комплекта считаются по ПРОГНОЗНОЙ скорости комплекта', () => {
    const kits: KitItem[] = [
      { kitSku: 'KIT-T', type: 'virtual', components: [{ componentSku: 'COMP-T', quantity: 2 }] }
    ];
    const res = buildOzonCoverage(makeTrendInput(makeTrendSales('KIT-T', GROW), {
      kits,
      skus: [makeSku({ sku: 'COMP-T', pcsPerBox: 1, leadTimeDays: 30 })],
      myStockAvailability: { 'COMP-T': 0 },
      settings: makeSettings({ trendWeeks: 13, salesGrowthPct: 10 })
    }));
    const kit = res.articles.find(a => a.article === 'KIT-T')!;
    const comp = res.components.find(c => c.component === 'COMP-T')!;
    // Фактическая скорость компонента остаётся фактической, прогнозная — по прогнозу комплекта.
    expect(comp.perDay).toBeCloseTo(kit.perDay * 2, 10);
    expect(comp.forecastPerDay).toBeCloseTo(kit.forecastPerDay * 2, 10);
    expect(comp.forecastPerDay).toBeGreaterThan(comp.perDay);
    // Сигнал заказа компонента считается от прогнозной скорости: порог = прогноз × (30 + 7).
    expect(comp.factory!.thresholdQty).toBeCloseTo(comp.forecastPerDay * 37, 10);
  });
});

// ===== Пункт 39: связывание продаж с остатками и знаменатель скорости =====

const P39_NOW = new Date('2024-01-10T10:00:00Z'); // среда; окно скорости — 4 недели по 2024-01-01
const P39_WEEKS = getLastFullWeeks(P39_NOW, 4);

// Товар, у которого артикул Ozon НЕ совпадает с внутренним SKU: связь идёт только по «ШК Ozon».
const P39_SKUS: SKUItem[] = [makeSku({ sku: 'INNER-1', ozonBarcode: '777' })];

// Строка остатков без КластерID: поле sku — это «ШК Ozon», по нему и идёт сопоставление.
function makeP39Stock(offerId: string, ozonSku: string, available: number): OzonStockRow {
  return {
    cabinet: 'test',
    sku: ozonSku,
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

// Строка продаж: days по умолчанию 7 (недельная зона), 28 — архивный блок.
function makeP39Sale(offerId: string, week: string, qty: number, days = 7): OzonSalesRow {
  return { week, cabinet: 'test', offerId, clusterName: '', qty, updatedAt: '', days };
}

function makeP39Input(overrides: Partial<OzonCoverageInput> = {}): OzonCoverageInput {
  return {
    stocks: [],
    sales: [],
    skus: [],
    clusters: [],
    settings: makeSettings(),
    myStockAvailability: {},
    now: P39_NOW,
    ...overrides
  };
}

describe('buildOzonCoverage: продажи связываются с остатками одинаково (пункт 39A)', () => {
  it('связь через «ШК Ozon»: остаток и скорость сходятся на ОДНОМ внутреннем артикуле', () => {
    // До правки продажи дали бы фантом 'ozon-offer-1' со скоростью и нулевым остатком,
    // а остаток лёг бы на 'INNER-1' с нулевой скоростью.
    const res = buildOzonCoverage(makeP39Input({
      stocks: [makeP39Stock('ozon-offer-1', '777', 100)],
      sales: P39_WEEKS.map(w => makeP39Sale('ozon-offer-1', w, 7)),
      skus: P39_SKUS
    }));
    expect(res.articles.map(a => a.article)).toEqual(['INNER-1']);
    const a = res.articles[0];
    expect(a.totalEstimated).toBe(100);
    expect(a.qtySold).toBe(28);
    expect(a.perDay).toBe(1); // 28 шт ÷ 28 дней
    expect(res.speed.qtyByArticle['ozon-offer-1']).toBeUndefined();
  });

  it('артикула нет ни в остатках, ни в SKU Базе: продажи дают offer_id как есть', () => {
    const res = buildOzonCoverage(makeP39Input({
      stocks: [makeP39Stock('ozon-offer-1', '777', 10)],
      sales: P39_WEEKS.map(w => makeP39Sale('НЕТ-НИГДЕ', w, 7)),
      skus: P39_SKUS
    }));
    expect(res.speed.qtyByArticle['НЕТ-НИГДЕ']).toBe(28);
    expect(res.speed.perDayByArticle['НЕТ-НИГДЕ']).toBe(1);
  });

  it('скорость, коррекция и тренд разрешают артикул ОДИНАКОВО', () => {
    // Товар распродан: 9 недель по 20 шт, последние 4 — по 1 шт, остаток на Ozon 1 шт.
    // Коррекция при дефиците срабатывает, поэтому тренд гасится причиной 'correction' —
    // а это возможно только если все три расчёта попали в один и тот же артикул.
    const sales = getLastFullWeeks(P39_NOW, 13)
      .map((w, i) => makeP39Sale('ozon-offer-1', w, i < 9 ? 20 : 1));
    const res = buildOzonCoverage(makeP39Input({
      stocks: [makeP39Stock('ozon-offer-1', '777', 1)],
      sales,
      skus: P39_SKUS,
      settings: makeSettings({ trendWeeks: 13, deficitDays: 30 })
    }));
    expect(Object.keys(res.speed.perDayByArticle)).toEqual(['INNER-1']);
    expect(Object.keys(res.trends)).toEqual(['INNER-1']);
    expect(res.articles.find(a => a.article === 'INNER-1')!.speedCorrection).not.toBeNull();
    expect(res.trends['INNER-1'].reason).toBe('correction');
  });
});

describe('buildSalesSpeed: только недельные строки и реальный знаменатель (пункт 39B)', () => {
  it('строки с «Дней» = 28 в расчёт скорости не попадают', () => {
    const sales = [
      ...P39_WEEKS.map(w => makeP39Sale('X', w, 7)),
      makeP39Sale('X', P39_WEEKS[0], 400, 28) // архивный 28-дневный блок на той же неделе
    ];
    const res = buildOzonCoverage(makeP39Input({ sales }));
    expect(res.speed.qtyByArticle['X']).toBe(28);
    expect(res.speed.windowDays).toBe(28);
    expect(res.speed.perDayByArticle['X']).toBe(1);
  });

  // Independent tester's own mutation check (not in the coder's list): mutating the presence
  // filter from `=== 7` to `>= 7` survived every existing test — every fixture that has a
  // 28-day block also carries a 7-day row for the SAME week, so the block itself never decided
  // whether the week counted as present. Here the window's oldest week has ONLY a 28-day row
  // (no matching weekly row at all) — a `>= 7` presence check would wrongly mark it present and
  // silently dilute the speed with an extra all-zero week in the denominator.
  it('a window week with ONLY a 28-day archive row (no weekly row at all) is NOT counted as present', () => {
    const sales = [
      ...P39_WEEKS.slice(1).map(w => makeP39Sale('X', w, 7)),
      makeP39Sale('X', P39_WEEKS[0], 400, 28) // only the archive block on the oldest window week
    ];
    const res = buildOzonCoverage(makeP39Input({ sales }));
    // Same expectation as "3 недели из 4 дают 21 день" below, but this time the 4th week is
    // "occupied" by a 28-day block rather than simply missing — the mutant conflated the two.
    expect(res.speed.weeks).toEqual(P39_WEEKS.slice(1));
    expect(res.speed.windowDays).toBe(21);
    expect(res.speed.qtyByArticle['X']).toBe(21);
    expect(res.speed.perDayByArticle['X']).toBe(1); // 21 ÷ 21, а не 21 ÷ 28
  });

  it('знаменатель — только реально присутствующие недели окна: 3 недели из 4 дают 21 день', () => {
    const sales = P39_WEEKS.slice(1).map(w => makeP39Sale('X', w, 7));
    const res = buildOzonCoverage(makeP39Input({ sales }));
    expect(res.speed.windowDays).toBe(21);
    expect(res.speed.qtyByArticle['X']).toBe(21);
    expect(res.speed.perDayByArticle['X']).toBe(1); // 21 ÷ 21, а не 21 ÷ 28
  });

  it('speed.weeks содержит только фактически использованные недели', () => {
    const sales = P39_WEEKS.slice(1).map(w => makeP39Sale('X', w, 7));
    const res = buildOzonCoverage(makeP39Input({ sales }));
    expect(res.speed.weeks).toEqual(P39_WEEKS.slice(1));
  });

  it('окно целиком отсутствует в данных: нулевые скорости, расчёт не падает', () => {
    const res = buildOzonCoverage(makeP39Input({
      stocks: [makeP39Stock('ozon-offer-1', '777', 50)],
      sales: [makeP39Sale('ozon-offer-1', '2023-01-02', 100)], // неделя далеко за окном
      skus: P39_SKUS
    }));
    expect(res.speed.weeks).toEqual([]);
    expect(res.speed.windowDays).toBe(0);
    expect(res.speed.totalQty).toBe(0);
    expect(res.speed.totalPerDay).toBe(0);
    expect(res.articles.map(a => a.article)).toEqual(['INNER-1']);
    expect(res.articles[0].perDay).toBe(0);
    expect(res.articles[0].factory).toBeNull();
  });
});

/* ---- «Распределить весь остаток»: окно скорости решает, какие кластеры участвуют ---- */

// Среда 10.01.2024. Последняя полная неделя — 2024-01-01.
// Окно 4 недели: с 2023-12-11. Окно 13 недель: с 2023-10-09.
const WIDE_NOW = new Date('2024-01-10T10:00:00Z');

/** Товар кончился на Ozon: остатков нет ни в одном кластере, продажи прекратились. */
function wideInput(overrides: Partial<OzonCoverageInput> = {}): OzonCoverageInput {
  return {
    stocks: [
      // Нулевые остатки, но кластеры в данных присутствуют.
      { cabinet: 'test', sku: '', offerId: 'MISKA', name: 'MISKA', warehouseName: 'W1', clusterName: 'Москва', clusterId: 'C1', available: 0, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0 } as OzonStockRow,
      { cabinet: 'test', sku: '', offerId: 'MISKA', name: 'MISKA', warehouseName: 'W2', clusterName: 'Казань', clusterId: 'C2', available: 0, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0 } as OzonStockRow,
    ],
    sales: [
      // Москва продавала в последние 4 недели.
      ...['2023-12-11', '2023-12-18', '2023-12-25', '2024-01-01'].map((week) => ({
        week, cabinet: 'test', offerId: 'MISKA', clusterName: 'Москва', qty: 7, updatedAt: '', days: 7
      })),
      // Казань продавала ТОЛЬКО раньше: товар там кончился первым.
      ...['2023-10-09', '2023-10-16', '2023-10-23', '2023-10-30'].map((week) => ({
        week, cabinet: 'test', offerId: 'MISKA', clusterName: 'Казань', qty: 7, updatedAt: '', days: 7
      })),
    ],
    skus: [makeSku({ sku: 'MISKA', pcsPerBox: 1 })],
    clusters: [
      { clusterId: 'C1', clusterName: 'Москва' },
      { clusterId: 'C2', clusterName: 'Казань' },
    ],
    settings: makeSettings({ speedWeeks: 4, minStockDays: 7, targetStockDays: 20 }),
    myStockAvailability: { MISKA: 500 },
    now: WIDE_NOW,
    ...overrides
  };
}

const clusterRec = (res: any, clusterId: string) => {
  const art = res.articles.find((a: any) => a.article === 'MISKA')!;
  return art.clusters.find((c: any) => c.clusterId === clusterId);
};

// Item 86, step B (owner, 26.09.2026): this describe used to show that WIDENING speedWeeks
// brought a stale cluster back into distribution. That mechanism is gone — item 72's per-cluster
// deficit lift is replaced by a SHARE of the article's sales over the share window
// (max(trendWeeks, speedWeeks), default trendWeeks 13), so a cluster's participation is now
// governed by trendWeeks, not by speedWeeks. Rewritten to test the actual current rule; values
// verified by hand below.
describe('окно доли решает, попадёт ли кластер в распределение (item 86, step B)', () => {
  it('trendWeeks 4 = speedWeeks: доля кластера считается только по этим 4 неделям, Казань туда не попала — рекомендации нет', () => {
    const res = buildOzonCoverage(wideInput({ settings: makeSettings({ speedWeeks: 4, trendWeeks: 4, minStockDays: 7, targetStockDays: 20 }) }));
    // Москва — единственная с продажами в окне доли, вся скорость товара 1.0 шт/д достаётся ей.
    expect(clusterRec(res, 'C1')!.recommendation).not.toBeNull();
    expect(clusterRec(res, 'C1')!.recommendation!.qty).toBe(20); // 20 target days × 1.0 шт/д
    expect(clusterRec(res, 'C2')!.recommendation).toBeNull();
  });

  it('trendWeeks по умолчанию (13) шире speedWeeks 4: Казань возвращается своей ДОЛЕЙ, а не собственной скоростью', () => {
    // Окно доли = max(13, 4) = 13 недель — в нём Москва и Казань продали поровну (28 и 28 шт),
    // поэтому скорость товара 1.0 шт/д делится 50/50: по 0.5 шт/д каждому кластеру.
    const res = buildOzonCoverage(wideInput());
    expect(clusterRec(res, 'C1')!.perDay).toBeCloseTo(0.5, 10);
    expect(clusterRec(res, 'C1')!.recommendation!.qty).toBe(10); // 20 × 0.5
    expect(clusterRec(res, 'C2')!.recommendation).not.toBeNull();
    expect(clusterRec(res, 'C2')!.perDay).toBeCloseTo(0.5, 10);
    expect(clusterRec(res, 'C2')!.recommendation!.qty).toBe(10);
  });

  it('общий объём НЕ растёт — те же продажи делятся между большим числом кластеров по мере расширения окна доли (trendWeeks)', () => {
    const narrowShare = buildOzonCoverage(wideInput({ settings: makeSettings({ speedWeeks: 4, trendWeeks: 4, minStockDays: 7, targetStockDays: 20 }) }));
    const wideShare = buildOzonCoverage(wideInput()); // default trendWeeks 13
    const total = (res: any) => res.articles
      .find((a: any) => a.article === 'MISKA')!.clusters
      .reduce((s: number, c: any) => s + (c.recommendation ? c.recommendation.qty : 0), 0);
    const withRec = (res: any) => res.articles
      .find((a: any) => a.article === 'MISKA')!.clusters
      .filter((c: any) => c.recommendation && c.recommendation.qty > 0).length;

    expect(withRec(narrowShare)).toBe(1);
    expect(withRec(wideShare)).toBe(2);
    expect(total(narrowShare)).toBe(20);
    expect(total(wideShare)).toBe(20);
  });

  it('более широкое окно доли (не speedWeeks) снижает долю и скорость Москвы: 1.0 шт/д при trendWeeks 4 против 0.5 шт/д при trendWeeks 13', () => {
    const narrowShare = buildOzonCoverage(wideInput({ settings: makeSettings({ speedWeeks: 4, trendWeeks: 4, minStockDays: 7, targetStockDays: 20 }) }));
    const wideShare = buildOzonCoverage(wideInput());
    expect(clusterRec(wideShare, 'C1')!.perDay).toBeLessThan(clusterRec(narrowShare, 'C1')!.perDay);
  });

  it('доля кластера и окно доли записаны в строке для показа: Москва 100 % при trendWeeks 4, 50 % при trendWeeks 13 (обе за 4 нед.)', () => {
    const narrowShare = buildOzonCoverage(wideInput({ settings: makeSettings({ speedWeeks: 4, trendWeeks: 4, minStockDays: 7, targetStockDays: 20 }) }));
    const wideShare = buildOzonCoverage(wideInput());
    expect(clusterRec(narrowShare, 'C1')!.speedSharePct).toBeCloseTo(100, 10);
    expect(clusterRec(narrowShare, 'C1')!.shareWindowWeeks).toBe(4);
    expect(clusterRec(wideShare, 'C1')!.speedSharePct).toBeCloseTo(50, 10);
    expect(clusterRec(wideShare, 'C1')!.shareWindowWeeks).toBe(8); // 8 недель реально присутствуют в данных из 13 запрошенных
  });
});

/* ---- Пункт 66. Кластер, куда товар уже едет, остаётся в таблице -------------------
 * Список кластеров товара — объединение остатков и продаж. Кластер, в который только
 * что оформили поставку, не имеет ни того, ни другого и пропадал с экрана до самой
 * приёмки, хотя товар туда едет. Владелец 27.08.2026: «должны оставаться только
 * кластера с реальными остатками и кластера в которые товар едет или скоро появится».
 */
describe('buildOzonCoverage: кластер с созданной заявкой остаётся в списке', () => {
  const withCluster = (offerId: string, clusterId: string, clusterName: string, available: number): OzonStockRow => ({
    ...makeStockRow(offerId, available),
    clusterId,
    clusterName
  });

  const input = (pendingByCluster: Record<string, number>): OzonCoverageInput => ({
    stocks: [withCluster('TOVAR', '4007', 'Москва', 20)],
    sales: makeSalesRows('TOVAR', 28),
    skus: [makeSku({ sku: 'TOVAR', pcsPerBox: 10 })],
    clusters: [],
    settings: makeSettings(),
    myStockAvailability: { TOVAR: 100 },
    pending: { byArticleCluster: { TOVAR: pendingByCluster }, byArticle: { TOVAR: 0 } },
    now: NOW
  });

  it('кластер без остатка и без продаж, но с заявкой, виден в таблице', () => {
    const row = buildOzonCoverage(input({ '4066': 30 })).articles.find(a => a.article === 'TOVAR')!;
    const ekb = row.clusters.find(c => c.clusterId === '4066');
    expect(ekb).toBeDefined();
    expect(ekb!.pendingQty).toBe(30);
    // Item 85: the 30 pieces on their way are what the cluster can count on.
    expect(ekb!.available).toBe(0);
    expect(ekb!.inFlightQty).toBe(30);
    expect(ekb!.estimated).toBe(30);
  });

  it('заявка на ноль штук кластер не воскрешает', () => {
    const row = buildOzonCoverage(input({ '4066': 0 })).articles.find(a => a.article === 'TOVAR')!;
    expect(row.clusters.find(c => c.clusterId === '4066')).toBeUndefined();
  });

  it('без заявок список кластеров прежний — остатки и продажи', () => {
    const row = buildOzonCoverage(input({})).articles.find(a => a.article === 'TOVAR')!;
    expect(row.clusters.map(c => c.clusterId)).toEqual(['4007']);
  });

  it('кластер в пути рекомендацию НЕ получает: продаж там нет, скорость нулевая', () => {
    // Иначе на пустой кластер посыпались бы поставки просто потому, что туда что-то едет.
    const row = buildOzonCoverage(input({ '4066': 30 })).articles.find(a => a.article === 'TOVAR')!;
    expect(row.clusters.find(c => c.clusterId === '4066')!.recommendation).toBeNull();
  });

  it('свой кластер с остатком не дублируется заявкой', () => {
    const row = buildOzonCoverage(input({ '4007': 15 })).articles.find(a => a.article === 'TOVAR')!;
    expect(row.clusters.filter(c => c.clusterId === '4007')).toHaveLength(1);
    expect(row.clusters.find(c => c.clusterId === '4007')!.available).toBe(20);
  });
});

/** 29.08.2026. Дефицит комплекта, дошедший до компонента, должен быть ВИДЕН: расчёт без
 *  показа на экране владельцу ничем не помогает. Плюс колонка «Запас» переименована —
 *  её крупное число читалось как складской остаток, а это вся труба целиком. */
describe('дефицит компонента и честная подпись колонки', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const stocks = read('src/components/OzonStocksTab.tsx');

  it('колонка больше не называется «Запас»', () => {
    expect(stocks).toContain('>\n                          В обороте\n                        </th>');
    expect(stocks).not.toMatch(/<th className="py-2 pr-2 text-right">Запас<\/th>/);
  });

  it('в подписи колонки сказано, что складская часть — только доля числа', () => {
    expect(stocks).toMatch(/НЕ остаток на Моём складе[\s\S]{0,400}?внутри готовых комплектов/);
  });

  it('компонент, держащий сборку, показан отдельным состоянием с количеством', () => {
    expect(stocks).toMatch(
      /\) : c\.factory && c\.factory\.unmetDeficitQty > 0 \? \([\s\S]{0,1600}?держит сборку · \{fmtInt\(c\.factory\.unmetDeficitQty\)\} шт/
    );
  });

  it('состояние кликабельно — по нему можно оформить заказ на фабрике', () => {
    expect(stocks).toMatch(
      /c\.factory && c\.factory\.unmetDeficitQty > 0 \? \([\s\S]{0,900}?onClick=\{\(\) => setFactoryModalArticle\(c\.component\)\}/
    );
  });

  it('строка компонента подсвечивается, как просроченный заказ', () => {
    expect(stocks).toMatch(
      /overdueList\.length > 0 \|\| \(c\.factory && c\.factory\.unmetDeficitQty > 0\) \? 'bg-amber-50\/60'/
    );
  });

  it('расчёт передаёт дефицит комплектов вниз, а не жёсткий ноль', () => {
    const lib = read('src/lib/ozonCoverage.ts');
    expect(lib).toMatch(/unmetByComponent\[componentSku\] \|\| 0,\s*\n\s*onOrderQty/);
    expect(lib).toMatch(/if \(row\.unmetDeficitQty > 0\) unmetByKit\[row\.article\] = row\.unmetDeficitQty;/);
    expect(lib).toMatch(/input\.pending\?\.byArticle,\s*\n\s*unmetByKit\s*\n\s*\);/);
  });
});

/** Item 50. A factory order placed for an article the calculation never asked for.
 *  Nothing about the RECORD changes — Code.gs already accepts any article and the ТРУБА
 *  already counts every active order — so the whole item lives in the entry points on
 *  screen. These are source guards over the cell states that used to be dead text. */
describe('заказ на фабрике вне рекомендаций', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const stocks = read('src/components/OzonStocksTab.tsx');
  const modal = read('src/components/FactoryOrderModal.tsx');

  it('состояние «заказ не нужен» открывает окно заказа', () => {
    // Прочерк в колонке был мёртвым текстом — по нему нельзя было отметить заказ.
    // Владелец 27.08.2026 заменил прочерк на «не нужно» — ту же надпись, что в таблице
    // компонентов: пустая ячейка не читается как приглашение, а надпись читается.
    expect(stocks).toMatch(
      /onClick=\{\(e\) => \{ e\.stopPropagation\(\); setFactoryModalArticle\(art\.article\); \}\}\s*\n\s*className="text-slate-300 hover:text-slate-500 hover:underline"[\s\S]{0,700}?>\s*\n\s*не нужно\s*\n\s*<\/button>/
    );
  });

  it('состояние «срок не задан» открывает окно заказа', () => {
    expect(stocks).toMatch(
      /\(Number\(art\.leadTimeDays\) \|\| 0\) === 0 \? \(\s*\n\s*<button/
    );
    expect(stocks).toMatch(/срок не задан\s*\n\s*<\/button>/);
  });

  it('состояние «товар есть, лежит не там» открывает окно заказа', () => {
    expect(stocks).toMatch(
      /дефицит в кластерах \{fmtInt\(art\.factory\.unmetDeficitQty\)\} шт[\s\S]{0,220}?<\/button>/
    );
  });

  it('компонент комплекта заказывается со строки «не нужно»', () => {
    // У комплекта своей кнопки нет намеренно: на фабрике заказывают компоненты.
    expect(stocks).toMatch(
      /onClick=\{\(\) => setFactoryModalArticle\(c\.component\)\}\s*\n\s*className="text-slate-300 hover:text-slate-500 hover:underline"\s*\n\s*title="[^"]*"\s*\n\s*>\s*\n\s*не нужно/
    );
    expect(stocks).toContain('узкое место: {bottleneckByKit[art.article].componentSku}');
  });

  it('все новые входы ведут в то же окно заказа и не раскрывают строку', () => {
    const clicks = stocks.match(/setFactoryModalArticle\(art\.article\)/g) || [];
    expect(clicks.length).toBeGreaterThanOrEqual(6);
    const unguarded = stocks.match(/onClick=\{\(e\) => \{ setFactoryModalArticle/g) || [];
    expect(unguarded).toHaveLength(0);
  });

  it('окно честно говорит, что расчёт такого заказа не предлагал', () => {
    expect(modal).toContain('id="factory-order-off-plan"');
    expect(modal).toMatch(/!order && suggestedQty <= 0/);
  });
});

// ============================================================================================
// ПУНКТ 51. Неполная коробка: медленный кластер больше не выкидывается молча, и остаток
// Моего склада раздаётся в штуках, а не в целых коробках.
// Решение владельца 03.09.2026. Отменяет половину решения от 09.08.2026 (пункт 34): такой
// кластер теперь обычный — он встаёт в очередь за остатком и его нехватка доходит до сигнала
// на фабрику.
// ============================================================================================

/** Продажи одного кластера, разложенные ровно по окну скорости. */
function makeClusterSales(offerId: string, qty: number, clusterName: string): OzonSalesRow[] {
  return SALES_WEEKS.map(week => ({
    week, cabinet: 'test', offerId, clusterName, qty: qty / SALES_WEEKS.length, updatedAt: '', days: 7
  }));
}

/** Остаток кластера: та же строка, но с КластерID — иначе кластерных рекомендаций нет. */
function makeClusterStock(offerId: string, available: number, clusterId: string, clusterName: string): OzonStockRow {
  return { ...makeStockRow(offerId, available), clusterId, clusterName };
}

describe('пункт 51: неполная коробка вместо молчаливого выкидывания', () => {
  // Числа владельца из плана: скорость 0,07 шт/д, коробка 42 шт, целевой запас 30 дней.
  const SLOW = makeSettings({ targetStockDays: 30, maxClusterDays: 100 });

  it('медленный кластер получает неполную коробку, а не null', () => {
    // need = 0.07*30 = 2.1 -> ceil = 3 шт. Полная коробка 42 шт дала бы 600 дней при потолке 100.
    const rec = calcSupplyRecommendation(0.07, 0, SLOW, 42, 1000);
    expect(rec).not.toBeNull();
    expect(rec!.wantQty).toBe(3);
    expect(rec!.qty).toBe(3);
    expect(rec!.boxes).toBe(1);
    expect(rec!.partialByMaxDays).toBe(true);
    expect(rec!.limitedByMyStock).toBe(false);
  });

  it('в рекомендации сказано, на сколько дней хватило бы ПОЛНОЙ коробки', () => {
    const rec = calcSupplyRecommendation(0.07, 0, SLOW, 42, 1000);
    expect(rec!.fullBoxDays).toBeCloseTo(42 / 0.07, 6);
    expect(Math.round(rec!.fullBoxDays)).toBe(600);
  });

  it('после неполной коробки в кластере ровно целевой запас, потолок не пробит', () => {
    const rec = calcSupplyRecommendation(0.07, 0, SLOW, 42, 1000);
    const daysAfter = rec!.qty / 0.07;
    expect(daysAfter).toBeGreaterThanOrEqual(30);
    expect(daysAfter).toBeLessThanOrEqual(100);
  });

  it('обычный кластер коробку не дробит: partialByMaxDays false, qty кратно коробке', () => {
    // need = 3*30 = 90, коробка 42 -> 126 шт, это 42 дня при потолке 100: отсекателю не за что зацепиться.
    const rec = calcSupplyRecommendation(3, 0, SLOW, 42, 1000);
    expect(rec!.partialByMaxDays).toBe(false);
    expect(rec!.fullBoxDays).toBe(0);
    expect(rec!.qty).toBe(126);
    expect(rec!.qty % 42).toBe(0);
  });

  it('отсекатель остаётся страховкой: потолок ниже целевого запаса — рекомендации нет', () => {
    // need = 0.005*30 = 0.15 -> ceil = 1 шт, но и одна штука это 200 дней при потолке 100.
    expect(calcSupplyRecommendation(0.005, 0, SLOW, 42, 1000)).toBeNull();
  });

  it('остатка не хватает на полную коробку — везём неполную, а не ноль', () => {
    // need = 10*30 = 300, коробка 42 -> 8 коробок = 336 шт, а на складе только 5 шт.
    const rec = calcSupplyRecommendation(10, 0, SLOW, 42, 5);
    expect(rec!.wantQty).toBe(336);
    expect(rec!.qty).toBe(5);
    expect(rec!.boxes).toBe(1);
    expect(rec!.limitedByMyStock).toBe(true);
    expect(rec!.partialByMaxDays).toBe(false);
  });

  it('на складе пусто — рекомендация с нулём, как и прежде', () => {
    const rec = calcSupplyRecommendation(10, 0, SLOW, 42, 0);
    expect(rec!.qty).toBe(0);
    expect(rec!.boxes).toBe(0);
    expect(rec!.limitedByMyStock).toBe(true);
  });

  // ---- Весь путь целиком: правка в calcSupplyRecommendation бесполезна, если очередь раздачи
  // остатка Моего склада продолжает округлять до целых коробок (ловушка 80). ----

  function slowInput(over: Partial<OzonCoverageInput> = {}): OzonCoverageInput {
    return {
      stocks: [makeClusterStock('SLOW', 0, '1', 'Москва')],
      sales: makeClusterSales('SLOW', 2, 'Москва'), // 2 шт за 28 дней = 1/14 шт/д
      skus: [makeSku({ sku: 'SLOW', pcsPerBox: 42, leadTimeDays: 10 })],
      clusters: [{ clusterId: '1', clusterName: 'Москва' }],
      settings: makeSettings({ minStockDays: 7, targetStockDays: 30, maxClusterDays: 100 }),
      myStockAvailability: { SLOW: 1000 },
      factoryOnOrder: {},
      now: NOW,
      ...over
    };
  }

  it('сквозь весь расчёт: медленный кластер доезжает до рекомендации неполной коробкой', () => {
    const res = buildOzonCoverage(slowInput());
    const cluster = res.articles[0].clusters.find(c => c.clusterId === '1')!;
    expect(cluster.recommendation).not.toBeNull();
    expect(cluster.recommendation!.qty).toBe(3);
    expect(cluster.recommendation!.boxes).toBe(1);
    expect(cluster.recommendation!.partialByMaxDays).toBe(true);
    expect(Math.round(cluster.recommendation!.fullBoxDays)).toBe(588);
  });

  it('сквозь весь расчёт: нехватка медленного кластера доходит до заказа на фабрике', () => {
    // Решение владельца 03.09.2026, отмена половины решения от 09.08.2026.
    const res = buildOzonCoverage(slowInput({ myStockAvailability: { SLOW: 0 } }));
    const article = res.articles[0];
    expect(article.clusters[0].unmetQty).toBe(3);
    expect(article.unmetDeficitQty).toBe(3);
    expect(article.factory!.unmetDeficitQty).toBe(3);
  });

  it('сквозь весь расчёт: остатка меньше коробки — кластер получает его, а не ноль', () => {
    // Своими словами владельца (пункт 51): «если остатков на своем складе не хватает на полную
    // коробку но требуется поставка куда-то в рекомендациях нужно предлагать неполную коробку».
    const res = buildOzonCoverage(slowInput({
      sales: makeClusterSales('SLOW', 84, 'Москва'), // 3 шт/д, нужно 3 коробки = 126 шт
      myStockAvailability: { SLOW: 20 }              // меньше одной коробки в 42 шт
    }));
    const cluster = res.articles[0].clusters.find(c => c.clusterId === '1')!;
    expect(cluster.recommendation!.qty).toBe(20);
    expect(cluster.recommendation!.boxes).toBe(1);
    expect(cluster.unmetQty).toBe(106);
  });

  it('очередь раздачи отдаёт остаток В ШТУКАХ, а не целыми коробками', () => {
    // Скорость 3 шт/д: нужно 90 шт = 3 коробки по 42 = 126 шт, а свободно только 50 шт.
    // Целыми коробками кластер получил бы одну (42 шт), 8 штук осели бы мёртвым грузом.
    const res = buildOzonCoverage(slowInput({
      sales: makeClusterSales('SLOW', 84, 'Москва'),
      myStockAvailability: { SLOW: 50 }
    }));
    const cluster = res.articles[0].clusters.find(c => c.clusterId === '1')!;
    expect(cluster.recommendation!.wantQty).toBe(126);
    expect(cluster.recommendation!.qty).toBe(50);
    expect(cluster.recommendation!.boxes).toBe(2);
    expect(cluster.recommendation!.limitedByMyStock).toBe(true);
    expect(cluster.unmetQty).toBe(76);
  });
});

// ---- Пункт 51 в интерфейсе. Расчёт может быть верным, а экран продолжать округлять
// потребность до целой коробки и называть медленный кластер исключённым. ----
describe('пункт 51: экран показывает неполную коробку', () => {
  const stocks = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');

  it('полная потребность берётся из wantQty в ОБОИХ местах, а не пересчитывается из neededQty', () => {
    const fromWant = stocks.match(/cls\.recommendation\.wantQty/g) || [];
    expect(fromWant).toHaveLength(2);
    expect(stocks).not.toMatch(/Math\.ceil\(cls\.recommendation\.neededQty/);
  });

  it('неполная коробка подписана в обоих местах: и в панели, и в строке кластера', () => {
    const notes = stocks.match(/partialByMaxDays &&/g) || [];
    expect(notes).toHaveLength(2);
    expect(stocks).toContain('полная коробка = запас на {fmtInt(c.recommendation.fullBoxDays)} дн');
    expect(stocks).toContain('полная = запас на {fmtInt(cls.recommendation.fullBoxDays)} дн');
  });

  it('подсказка колонки больше не обещает, что медленные кластеры исключаются', () => {
    expect(stocks).not.toContain('из рекомендации исключаются');
    expect(stocks).toContain('предлагается неполная коробка ровно на потребность');
  });
});

// ---- Пункт 48. Фильтр по магазину действует на весь экран, а не на одну таблицу.
// Владелец 03.09.2026: «магазин» — это тот же кабинет Ozon, другого дробления нет.
// Дефект был в том, что четыре числа наверху, бейджи магазина и отметка свежести данных
// считались по ВСЕМ магазинам сразу: таблица под ними сжималась, а числа стояли на месте.
describe('пункт 48: фильтр по магазину на вкладке «Остатки Озон»', () => {
  const stocks = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');

  it('от нефильтрованных остатков зависит РОВНО один расчёт — список магазинов для выбора', () => {
    // Фильтр, прячущий собственные варианты, назад уже не переключить.
    const unfiltered = stocks.match(/\}, \[ozonStocks\]\);/g) || [];
    expect(unfiltered).toHaveLength(1);
    expect(stocks).toMatch(/const ozonStocksCabinets = useMemo\(\(\) => \{[\s\S]{0,220}?\}, \[ozonStocks\]\);/);
  });

  it('числа наверху считаются по выбранному магазину', () => {
    expect(stocks).toMatch(
      /const ozonTotals = useMemo\(\(\) => \{[\s\S]{0,400}?for \(const s of filteredOzonStocks\)[\s\S]{0,300}?\}, \[filteredOzonStocks\]\);/
    );
  });

  it('бейдж магазина и отметка свежести данных тоже считаются по выбранному', () => {
    expect(stocks).toMatch(/const uniqueCabinetsCount = useMemo\(\(\) => \{[\s\S]{0,200}?\}, \[filteredOzonStocks\]\);/);
    expect(stocks).toMatch(/const maxUpdatedAt = useMemo\(\(\) => \{[\s\S]{0,300}?\}, \[filteredOzonStocks\]\);/);
  });

  it('фильтр объявлен ДО всего, что от него считается', () => {
    // Иначе const используется до объявления и экран падает на первом же рендере.
    const filterAt = stocks.indexOf('const filteredOzonStocks = useMemo');
    expect(filterAt).toBeGreaterThan(-1);
    for (const dependent of ['const maxUpdatedAt = useMemo', 'const ozonTotals = useMemo', 'const uniqueCabinetsCount = useMemo']) {
      expect(stocks.indexOf(dependent)).toBeGreaterThan(filterAt);
    }
  });

  it('экран называет выбранный магазин, чтобы изменившиеся числа не выглядели ошибкой', () => {
    expect(stocks).toMatch(/cabinetFilter !== 'all' && \([\s\S]{0,300}?показан только/);
    expect(stocks).toContain('Данные по магазинам:');
  });

  it('на экране одно слово — «магазин»; «личный кабинет Ozon» остаётся собой', () => {
    expect(stocks).toContain('<option value="all">Все магазины</option>');
    expect(stocks).not.toContain('Все кабинеты');
    expect(stocks).not.toContain('Данные по кабинетам');
    expect(stocks).not.toContain('из разных кабинетов');
    expect(stocks).toContain('в личном кабинете Ozon');
  });
});

// ================= Item 83: factoryOnOrderByArticle (China batches → pipeline) =============
describe('factoryOnOrderByArticle', () => {
  const TODAY = '2026-09-25';

  function order(overrides: Partial<FactoryOrder> & { article: string; qty: number }): FactoryOrder {
    return {
      id: overrides.id || 'FO-' + Math.random(),
      article: overrides.article,
      orderedAt: overrides.orderedAt || '2026-09-01',
      qty: overrides.qty,
      expectedAt: overrides.expectedAt ?? '',
      comment: overrides.comment || '',
      user: overrides.user || 'Николай',
      status: overrides.status || 'active',
      receivedAt: overrides.receivedAt || '',
      source: overrides.source ?? '',
      chinaOrderNo: overrides.chinaOrderNo || '',
      chinaBatchCode: overrides.chinaBatchCode || '',
      chinaKey: overrides.chinaKey || '',
      checked: overrides.checked ?? false
    };
  }

  it('просроченный ручной заказ выпадает из трубы (правило пункта 35 без изменений)', () => {
    const overdue = order({ article: 'ART1', qty: 10, expectedAt: '2026-09-01' });
    const result = factoryOnOrderByArticle([overdue], TODAY);
    expect(result.qty.ART1).toBeUndefined();
  });

  it('просроченный заказ из Китая остаётся в трубе и получает daysLate', () => {
    const late = order({ id: 'FCH1', article: 'ART1', qty: 10, expectedAt: '2026-09-20', source: 'Китай' });
    const result = factoryOnOrderByArticle([late], TODAY);
    expect(result.qty.ART1).toBe(10);
    expect(result.late.FCH1).toBe(5);
  });

  it("'replaced' и 'received' никогда не считаются, независимо от источника", () => {
    const replaced = order({ article: 'ART1', qty: 10, status: 'replaced' });
    const received = order({ article: 'ART1', qty: 20, status: 'received', source: 'Китай' });
    const result = factoryOnOrderByArticle([replaced, received], TODAY);
    expect(result.qty.ART1).toBeUndefined();
  });

  it('активный ручной заказ скрыт, если по артикулу есть активный заказ из Китая', () => {
    const manual = order({ id: 'FM1', article: 'ART1', qty: 10 });
    const china = order({ id: 'FCH1', article: 'ART1', qty: 20, source: 'Китай' });
    const result = factoryOnOrderByArticle([manual, china], TODAY);
    expect(result.qty.ART1).toBe(20); // только Китай, без задвоения
    expect(result.hiddenManual.map((o) => o.id)).toEqual(['FM1']);
  });

  it("checked=true снимает скрытие — считаются оба заказа как разные", () => {
    const manual = order({ id: 'FM1', article: 'ART1', qty: 10, checked: true });
    const china = order({ id: 'FCH1', article: 'ART1', qty: 20, source: 'Китай' });
    const result = factoryOnOrderByArticle([manual, china], TODAY);
    expect(result.qty.ART1).toBe(30);
    expect(result.hiddenManual).toEqual([]);
  });

  it('две партии из Китая одного артикула суммируются', () => {
    const a = order({ id: 'FCH1', article: 'ART1', qty: 15, source: 'Китай' });
    const b = order({ id: 'FCH2', article: 'ART1', qty: 20, source: 'Китай' });
    const result = factoryOnOrderByArticle([a, b], TODAY);
    expect(result.qty.ART1).toBe(35);
  });

  it('владельческий случай, БЕЗ разрешения конфликта: труба = 80 (не 130), а после «Прибыла» = 0 (не 50)', () => {
    // Партия из Китая младше или того же дня, что ручной заказ — Николаевское правило:
    // с пункта 83 заказы из Китая попадают в приложение только через модуль, поэтому такая
    // партия — это ТОТ ЖЕ заказ, пока owner явно не отметил «это разные заказы».
    const manual = order({ id: 'FM1', article: 'Миска_двойная', qty: 50, orderedAt: '2026-09-01' });
    const chinaActive = order({
      id: 'FCH1', article: 'Миска_двойная', qty: 80, source: 'Китай', chinaOrderNo: '29', orderedAt: '2026-09-16'
    });
    const step1 = factoryOnOrderByArticle([manual, chinaActive], TODAY);
    expect(step1.qty['Миска_двойная']).toBe(80); // не 130 — без задвоения
    expect(step1.hiddenManual.map((o) => o.id)).toEqual(['FM1']);

    // Партия помечена «Прибыла» — статус меняется на 'received', владелец КОНФЛИКТ НЕ РАЗРЕШИЛ
    // (ручной ряд остаётся 'active', не 'checked'). Раньше здесь труба ошибочно возвращала 50 —
    // ручной заказ "выныривал" обратно и товар считался дважды (получен + всё ещё заказан).
    const chinaReceived = { ...chinaActive, status: 'received', receivedAt: '2026-09-24' };
    const step2 = factoryOnOrderByArticle([manual, chinaReceived], TODAY);
    expect(step2.qty['Миска_двойная']).toBeUndefined(); // 0, не 50
    expect(step2.hiddenManual.map((o) => o.id)).toEqual(['FM1']); // кнопки всё ещё нужны
  });

  it('ручной заказ, оформленный ПОСЛЕ отгрузки из Китая — это другой заказ, считается', () => {
    const chinaActive = order({
      id: 'FCH1', article: 'ART-LATER', qty: 80, source: 'Китай', orderedAt: '2026-09-01'
    });
    const manualLater = order({ id: 'FM1', article: 'ART-LATER', qty: 20, orderedAt: '2026-09-10' });
    const result = factoryOnOrderByArticle([chinaActive, manualLater], TODAY);
    expect(result.qty['ART-LATER']).toBe(100); // оба — разные заказы, без скрытия
    expect(result.hiddenManual).toEqual([]);
  });

  it('checked=true — ручной заказ считается независимо от статуса партии из Китая (active и received)', () => {
    const manual = order({ id: 'FM1', article: 'ART-CHECKED', qty: 50, orderedAt: '2026-09-01', checked: true });
    const chinaActive = order({ id: 'FCH1', article: 'ART-CHECKED', qty: 80, source: 'Китай', orderedAt: '2026-09-16' });
    const activeResult = factoryOnOrderByArticle([manual, chinaActive], TODAY);
    expect(activeResult.qty['ART-CHECKED']).toBe(130);

    // A RECEIVED China row never counts itself (it's already stock, not "on order") — but the
    // checked manual row must still count on its own, not vanish along with it.
    const chinaReceived = { ...chinaActive, status: 'received', receivedAt: '2026-09-24' };
    const receivedResult = factoryOnOrderByArticle([manual, chinaReceived], TODAY);
    expect(receivedResult.qty['ART-CHECKED']).toBe(50);
  });

  it('оба места вызова (OzonStocksTab, Dashboard) импортируют общую функцию, не свою копию', () => {
    const stocks = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    const dashboard = fs.readFileSync(path.join(process.cwd(), 'src/components/Dashboard.tsx'), 'utf8');
    expect(stocks).toMatch(/factoryOnOrderByArticle/);
    expect(dashboard).toMatch(/factoryOnOrderByArticle/);
    expect(stocks).toMatch(/import \{[^}]*factoryOnOrderByArticle[^}]*\} from '..\/lib\/ozonCoverage'/);
    expect(dashboard).toMatch(/import \{[^}]*factoryOnOrderByArticle[^}]*\} from '..\/lib\/ozonCoverage'/);
  });
});
