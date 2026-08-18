import { describe, expect, it } from 'vitest';
import {
  calcCoverageDays,
  calcSupplyRecommendation,
  getLastFullWeeks,
  getMskWeekMonday,
  OzonCoverageSettings,
  parseExcludedClusters,
  parsePriorityClusters,
  resolveOzonArticle
} from './ozonCoverage';
import { SKUItem } from '../types';

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
