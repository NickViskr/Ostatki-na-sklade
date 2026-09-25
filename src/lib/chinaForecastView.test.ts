import { describe, it, expect } from 'vitest';
import { chinaFactoryOrdersToForecastLines, chinaForecastPrefillSplit, chinaForecastDateText } from './chinaForecastView';

describe('сигнал «Заказ на фабрике» -> строки прогноза Китая', () => {
  it('берёт только положительные orderQty, ноль и пустой factory пропускает', () => {
    const rows = [
      { article: 'А-1', factory: { orderQty: 120 } },
      { article: 'Б-2', factory: { orderQty: 0 } },
      { article: 'В-3', factory: null },
      { article: 'Г-4', factory: undefined }
    ];
    expect(chinaFactoryOrdersToForecastLines(rows)).toEqual([{ article: 'А-1', pieces: 120 }]);
  });

  it('survives an empty list', () => {
    expect(chinaFactoryOrdersToForecastLines([])).toEqual([]);
  });
});

describe('разбор прогноза по справочнику коробок', () => {
  const boxes = { 'А-1': {}, 'Б-2': {} };

  it('splits into known (in the directory) and missing, in the input order', () => {
    const split = chinaForecastPrefillSplit(
      [{ article: 'А-1', pieces: 100 }, { article: 'В-3', pieces: 50 }, { article: 'Б-2', pieces: 20 }],
      boxes
    );
    expect(split.known).toEqual([{ article: 'А-1', pieces: 100 }, { article: 'Б-2', pieces: 20 }]);
    expect(split.missing).toEqual(['В-3: 50 шт']);
  });

  it('drops zero and negative piece counts entirely, from both known and missing articles', () => {
    const split = chinaForecastPrefillSplit(
      [{ article: 'А-1', pieces: 0 }, { article: 'В-3', pieces: -5 }],
      boxes
    );
    expect(split.known).toEqual([]);
    expect(split.missing).toEqual([]);
  });

  it('survives an empty prefill and an empty directory', () => {
    expect(chinaForecastPrefillSplit([], {})).toEqual({ known: [], missing: [] });
  });
});

describe('дата в прогнозе', () => {
  it('переставляет ISO-дату в привычный вид без арифметики над Date', () => {
    expect(chinaForecastDateText('2026-10-25')).toBe('25.10.2026');
  });

  it('оставляет непонятный текст как есть', () => {
    expect(chinaForecastDateText('')).toBe('');
    expect(chinaForecastDateText('не дата')).toBe('не дата');
  });
});
