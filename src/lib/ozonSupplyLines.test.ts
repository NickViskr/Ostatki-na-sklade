import { describe, expect, it } from 'vitest';
import { capForSupplyLine, supplyLineKey } from './ozonSupplyLines';

const free = { 'ART-A': 100, 'ART-B': 30, 'ART-ZERO': 0 };

const line = (article: string, clusterId: string, qty: number) => ({ article, clusterId, qty });

describe('Item 45. Потолок строки заявки = свободный остаток минус то, что заняли другие строки', () => {
  it('одна строка: потолок равен свободному остатку', () => {
    const lines = [line('ART-A', 'C1', 40)];
    expect(capForSupplyLine(free, lines, 'ART-A', supplyLineKey(lines[0]))).toBe(100);
  });

  it('тот же товар в другом кластере уменьшает потолок', () => {
    const lines = [line('ART-A', 'C1', 40), line('ART-A', 'C2', 25)];
    expect(capForSupplyLine(free, lines, 'ART-A', supplyLineKey(lines[0]))).toBe(75);
    expect(capForSupplyLine(free, lines, 'ART-A', supplyLineKey(lines[1]))).toBe(60);
  });

  it('другой товар на потолок не влияет', () => {
    const lines = [line('ART-A', 'C1', 40), line('ART-B', 'C1', 30)];
    expect(capForSupplyLine(free, lines, 'ART-A', supplyLineKey(lines[0]))).toBe(100);
  });

  it('новая строка: занятое считается по всем существующим строкам', () => {
    const lines = [line('ART-A', 'C1', 40), line('ART-A', 'C2', 25)];
    expect(capForSupplyLine(free, lines, 'ART-A', '')).toBe(35);
  });

  it('весь остаток разобран — потолок ноль, а не отрицательное число', () => {
    const lines = [line('ART-B', 'C1', 30)];
    expect(capForSupplyLine(free, lines, 'ART-B', '')).toBe(0);
  });

  it('строки просят больше, чем есть: потолок не уходит в минус', () => {
    const lines = [line('ART-B', 'C1', 50)];
    expect(capForSupplyLine(free, lines, 'ART-B', '')).toBe(0);
  });

  it('нулевой свободный остаток — добавить нельзя', () => {
    expect(capForSupplyLine(free, [], 'ART-ZERO', '')).toBe(0);
  });

  it('товара нет в справке об остатках — потолка нет, а не ноль', () => {
    // Неизвестный предел не должен молча превратиться в запрет.
    expect(capForSupplyLine(free, [], 'НЕТ-ТАКОГО', '')).toBe(Number.POSITIVE_INFINITY);
  });

  it('ключ строки собирается из артикула и кластера', () => {
    expect(supplyLineKey({ article: 'ART-A', clusterId: 'C1' })).toBe('ART-A|||C1');
  });

  it('пустые и нечисловые количества считаются нулём', () => {
    const lines = [line('ART-A', 'C1', NaN as any), line('ART-A', 'C2', undefined as any)];
    expect(capForSupplyLine(free, lines, 'ART-A', '')).toBe(100);
  });
});

import { acceptedForLine, correctedQuantities, foldOzonVerdict } from './ozonSupplyLines';

// Ozon отвечает по кластерам и опознаёт товар по offerId и своему SKU.
// В тестах артикул совпадает с offerId — так же, как это делает resolveOzonArticle на боевых данных.
const resolve = (offerId: string, sku: string) => offerId || (sku === '111' ? 'ART-A' : '');

const verdictClusters = [
  {
    clusterId: 'C1',
    state: 'PARTIAL_AVAILABLE',
    invalidReason: 'PARTIAL_MATRIX_AVAILABLE',
    accepted: [{ offerId: 'ART-A', sku: '111', quantity: 30 }],
    rejected: [{ offerId: 'ART-B', sku: '222', quantity: 10 }]
  },
  {
    clusterId: 'C2',
    state: 'NOT_AVAILABLE',
    invalidReason: 'NOT_AVAILABLE_ROUTE',
    accepted: [],
    rejected: [{ offerId: 'ART-A', sku: '111', quantity: 20 }]
  }
];

describe('Ответ Ozon раскладывается по кластеру и артикулу', () => {
  it('принятое и отклонённое попадают в свой кластер и свой артикул', () => {
    const folded = foldOzonVerdict(verdictClusters, resolve);
    expect(folded.C1.byArticle['ART-A']).toEqual({ accepted: 30, rejected: 0 });
    expect(folded.C1.byArticle['ART-B']).toEqual({ accepted: 0, rejected: 10 });
    expect(folded.C2.byArticle['ART-A']).toEqual({ accepted: 0, rejected: 20 });
  });

  it('состояние кластера и причина отказа сохраняются', () => {
    const folded = foldOzonVerdict(verdictClusters, resolve);
    expect(folded.C1.state).toBe('PARTIAL_AVAILABLE');
    expect(folded.C2.invalidReason).toBe('NOT_AVAILABLE_ROUTE');
  });

  it('несколько строк одного артикула в кластере складываются', () => {
    const folded = foldOzonVerdict([{
      clusterId: 'C1', state: 'FULL_AVAILABLE', invalidReason: '',
      accepted: [{ offerId: 'ART-A', quantity: 10 }, { offerId: 'ART-A', quantity: 5 }],
      rejected: []
    }], resolve);
    expect(folded.C1.byArticle['ART-A'].accepted).toBe(15);
  });

  it('позиция, для которой артикул не восстановить, отбрасывается', () => {
    const folded = foldOzonVerdict([{
      clusterId: 'C1', state: 'FULL_AVAILABLE', invalidReason: '',
      accepted: [{ offerId: '', sku: '999', quantity: 7 }], rejected: []
    }], resolve);
    expect(Object.keys(folded.C1.byArticle)).toEqual([]);
  });

  it('пустой ответ не роняет разбор', () => {
    expect(foldOzonVerdict([], resolve)).toEqual({});
    expect(foldOzonVerdict(null as any, resolve)).toEqual({});
  });
});

describe('Сколько Ozon примет по строке', () => {
  const folded = foldOzonVerdict(verdictClusters, resolve);

  it('приняли меньше, чем просили — остальное считается непринятым', () => {
    expect(acceptedForLine(folded, { article: 'ART-A', clusterId: 'C1', qty: 40 }))
      .toEqual({ accepted: 30, notAccepted: 10 });
  });

  it('приняли ровно столько, сколько просили', () => {
    expect(acceptedForLine(folded, { article: 'ART-A', clusterId: 'C1', qty: 30 }))
      .toEqual({ accepted: 30, notAccepted: 0 });
  });

  it('кластер не принимает — не принято всё', () => {
    expect(acceptedForLine(folded, { article: 'ART-A', clusterId: 'C2', qty: 20 }))
      .toEqual({ accepted: 0, notAccepted: 20 });
  });

  it('кластера в ответе нет — не принято всё, а не «принято молча»', () => {
    expect(acceptedForLine(folded, { article: 'ART-A', clusterId: 'C-НЕТ', qty: 5 }))
      .toEqual({ accepted: 0, notAccepted: 5 });
  });
});

describe('«Скорректировать поставку» выставляет принятые количества', () => {
  const folded = foldOzonVerdict(verdictClusters, resolve);

  it('каждая строка получает то, что Ozon согласился принять', () => {
    const next = correctedQuantities(folded, [
      { article: 'ART-A', clusterId: 'C1', qty: 40 },
      { article: 'ART-B', clusterId: 'C1', qty: 10 },
      { article: 'ART-A', clusterId: 'C2', qty: 20 }
    ]);
    expect(next).toEqual({
      'ART-A|||C1': 30,
      'ART-B|||C1': 0,
      'ART-A|||C2': 0
    });
  });

  it('повторная коррекция ничего не меняет', () => {
    const lines = [{ article: 'ART-A', clusterId: 'C1', qty: 40 }];
    const once = correctedQuantities(folded, lines);
    const twice = correctedQuantities(folded, [{ article: 'ART-A', clusterId: 'C1', qty: once['ART-A|||C1'] }]);
    expect(twice).toEqual(once);
  });

  it('после коррекции непринятого не остаётся', () => {
    const lines = [
      { article: 'ART-A', clusterId: 'C1', qty: 40 },
      { article: 'ART-A', clusterId: 'C2', qty: 20 }
    ];
    const next = correctedQuantities(folded, lines);
    const left = lines
      .map((l) => acceptedForLine(folded, { ...l, qty: next[`${l.article}|||${l.clusterId}`] }).notAccepted)
      .reduce((a, b) => a + b, 0);
    expect(left).toBe(0);
  });
});
