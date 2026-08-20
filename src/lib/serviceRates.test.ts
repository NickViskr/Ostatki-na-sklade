import { describe, expect, it } from 'vitest';
import { parseStoredServiceEntries, resolveServiceCostAt, resolveServiceRateAt, todayLocalDateString } from './serviceRates';
import type { ServiceItem, ServiceRate } from '../types';
import { formatDateRu } from './utils';

const services: ServiceItem[] = [
  { id: 'S1', name: 'Упаковка в пакет', cost: 10, isActive: true },
  { id: 'S2', name: 'Без тарифов', cost: 7, isActive: true }
];

// Услуга S1: заведена по 10 ₽, с 01.03 стоит 15 ₽, с 01.08 — 22 ₽.
const rates: ServiceRate[] = [
  { serviceId: 'S1', cost: 15, validFrom: '2026-03-01' },
  { serviceId: 'S1', cost: 22, validFrom: '2026-08-01' }
];

describe('Item 43. Дата отсечки решает, какая расценка действует', () => {
  it('до первого тарифа действует базовая цена услуги', () => {
    expect(resolveServiceCostAt(rates, services, 'S1', '2026-02-28')).toBe(10);
  });

  it('в день начала тарифа действует уже новая цена', () => {
    expect(resolveServiceCostAt(rates, services, 'S1', '2026-03-01')).toBe(15);
    expect(resolveServiceCostAt(rates, services, 'S1', '2026-08-01')).toBe(22);
  });

  it('между тарифами держится предыдущий', () => {
    expect(resolveServiceCostAt(rates, services, 'S1', '2026-07-31')).toBe(15);
  });

  it('после последнего тарифа держится последний', () => {
    expect(resolveServiceCostAt(rates, services, 'S1', '2026-12-31')).toBe(22);
  });

  it('тариф из будущего не применяется задним числом', () => {
    const future: ServiceRate[] = [{ serviceId: 'S1', cost: 99, validFrom: '2027-01-01' }];
    expect(resolveServiceCostAt(rates.concat(future), services, 'S1', '2026-08-20')).toBe(22);
  });

  it('порядок строк в таблице значения не имеет', () => {
    expect(resolveServiceCostAt(rates.slice().reverse(), services, 'S1', '2026-08-20')).toBe(22);
  });

  it('строка с пустой датой не подменяет базовую цену', () => {
    const broken: ServiceRate[] = [{ serviceId: 'S2', cost: 999, validFrom: '' }];
    expect(resolveServiceRateAt(broken, 'S2', '2026-08-20')).toBeNull();
    expect(resolveServiceCostAt(broken, services, 'S2', '2026-08-20')).toBe(7);
  });

  it('у услуги без тарифов действует базовая цена, у неизвестной — ноль', () => {
    expect(resolveServiceCostAt(rates, services, 'S2', '2026-08-20')).toBe(7);
    expect(resolveServiceCostAt(rates, services, 'НЕТ ТАКОЙ', '2026-08-20')).toBe(0);
  });

  it('день без даты берётся по местному календарю, а не по UTC', () => {
    // 01.03.2026, 01:30 по Москве. По UTC это ещё 28 февраля, и тариф,
    // начавшийся 1 марта, не применился бы первые три часа рабочего дня.
    const mskEarlyMorning = new Date(2026, 2, 1, 1, 30, 0);
    expect(todayLocalDateString(mskEarlyMorning)).toBe('2026-03-01');
  });
});

describe('Item 43. Старая отгрузка остаётся по старым расценкам', () => {
  it('цена и количество берутся из записи, а не из справочника', () => {
    // Отгрузка записана, когда услуга стоила 15 ₽: 2 шт на 30 ₽.
    // Сегодня в справочнике 10 ₽ базовой и 22 ₽ действующей — на разбор это не влияет.
    const parsed = parseStoredServiceEntries('Услуги: Упаковка в пакет x2 (30₽)', services);
    expect(parsed).toEqual([{ name: 'Упаковка в пакет', unitCost: 15, quantity: 2 }]);
  });

  it('количество не пересчитывается по текущей цене', () => {
    // Прежде количество считалось как round(сумма / цена справочника) = round(30 / 10) = 3,
    // и при сохранении окна отгрузка переписывалась тремя штуками вместо двух.
    const parsed = parseStoredServiceEntries('Услуги: Упаковка в пакет x2 (30₽)', services);
    expect(parsed[0].quantity).toBe(2);
    expect(parsed[0].unitCost * parsed[0].quantity).toBe(30);
  });

  it('несколько услуг в одной строке разбираются по отдельности', () => {
    const parsed = parseStoredServiceEntries('Услуги: Упаковка в пакет x2 (30₽), Без тарифов x3 (21₽)', services);
    expect(parsed).toEqual([
      { name: 'Упаковка в пакет', unitCost: 15, quantity: 2 },
      { name: 'Без тарифов', unitCost: 7, quantity: 3 }
    ]);
  });

  it('услуга, которой больше нет в справочнике, разбирается по записи', () => {
    const parsed = parseStoredServiceEntries('Услуги: Удалённая услуга x4 (100₽)', services);
    expect(parsed).toEqual([{ name: 'Удалённая услуга', unitCost: 25, quantity: 4 }]);
  });

  it('старый формат без количества: делится нацело — количество восстанавливается', () => {
    const parsed = parseStoredServiceEntries('Доп. услуги: Упаковка в пакет (30₽)', services);
    expect(parsed).toEqual([{ name: 'Упаковка в пакет', unitCost: 10, quantity: 3 }]);
  });

  it('старый формат без количества: не делится нацело — услуга разовая на всю сумму', () => {
    const parsed = parseStoredServiceEntries('Доп. услуги: Упаковка в пакет (35₽)', services);
    expect(parsed).toEqual([{ name: 'Упаковка в пакет', unitCost: 35, quantity: 1 }]);
  });

  it('сумма отгрузки не меняется ни в одном разобранном случае', () => {
    for (const [tag, total] of [
      ['Услуги: Упаковка в пакет x2 (30₽)', 30],
      ['Услуги: Удалённая услуга x4 (100₽)', 100],
      ['Доп. услуги: Упаковка в пакет (30₽)', 30],
      ['Доп. услуги: Упаковка в пакет (35₽)', 35]
    ] as [string, number][]) {
      const parsed = parseStoredServiceEntries(tag, services);
      const sum = parsed.reduce((s, e) => s + e.unitCost * e.quantity, 0);
      expect(sum).toBeCloseTo(total, 2);
    }
  });
});

describe('Даты на экране показываются как ДД.ММ.ГГГГ', () => {
  it('дата из базы переворачивается', () => {
    expect(formatDateRu('2026-07-06')).toBe('06.07.2026');
    expect(formatDateRu('2026-12-31')).toBe('31.12.2026');
  });

  it('однозначные день и месяц дополняются нулём', () => {
    expect(formatDateRu('2026-01-02')).toBe('02.01.2026');
  });

  it('уже перевёрнутая дата остаётся перевёрнутой', () => {
    expect(formatDateRu('06.07.2026')).toBe('06.07.2026');
  });

  it('пустое значение не превращается в мусор', () => {
    expect(formatDateRu('')).toBe('');
    expect(formatDateRu(undefined)).toBe('');
  });

  it('неразбираемая строка возвращается как есть', () => {
    expect(formatDateRu('нет даты')).toBe('нет даты');
  });
});
