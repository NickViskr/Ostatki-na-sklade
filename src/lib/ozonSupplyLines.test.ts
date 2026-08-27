import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { capForSupplyLine, supplyLineKey,
  canTickCluster,
  sortClustersBySalesShare,
  qtyFieldValue,
  shouldBlankQtyOnFocus
} from './ozonSupplyLines';

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

import { acceptedForLine, applyOzonCorrection, foldOzonVerdict } from './ozonSupplyLines';

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

describe('«Скорректировать поставку» приводит состав к ответу Ozon', () => {
  const folded = foldOzonVerdict(verdictClusters, resolve);

  it('строка, из которой Ozon берёт часть, получает принятое количество', () => {
    const res = applyOzonCorrection(folded, [{ article: 'ART-A', clusterId: 'C1', qty: 40 }]);
    expect(res.quantities).toEqual({ 'ART-A|||C1': 30 });
    expect(res.removedKeys).toEqual([]);
    expect(res.removedClusterIds).toEqual([]);
  });

  it('товар, который Ozon не берёт совсем, убирается из заявки, а не обнуляется', () => {
    const res = applyOzonCorrection(folded, [
      { article: 'ART-A', clusterId: 'C1', qty: 40 },
      { article: 'ART-B', clusterId: 'C1', qty: 10 }
    ]);
    expect(res.quantities).toEqual({ 'ART-A|||C1': 30 });
    expect(res.removedKeys).toEqual(['ART-B|||C1']);
    // Кластер остаётся: в нём ещё есть что везти.
    expect(res.removedClusterIds).toEqual([]);
  });

  it('кластер, из которого Ozon не берёт ничего, убирается целиком', () => {
    const res = applyOzonCorrection(folded, [
      { article: 'ART-A', clusterId: 'C1', qty: 40 },
      { article: 'ART-A', clusterId: 'C2', qty: 20 }
    ]);
    expect(res.quantities).toEqual({ 'ART-A|||C1': 30 });
    expect(res.removedKeys).toEqual(['ART-A|||C2']);
    expect(res.removedClusterIds).toEqual(['C2']);
  });

  it('кластер уходит, только когда потеряны ВСЕ его строки', () => {
    const many = foldOzonVerdict([{
      clusterId: 'C3', state: 'PARTIAL_AVAILABLE', invalidReason: '',
      accepted: [{ offerId: 'ART-A', quantity: 5 }],
      rejected: [{ offerId: 'ART-B', quantity: 5 }]
    }], resolve);
    const res = applyOzonCorrection(many, [
      { article: 'ART-A', clusterId: 'C3', qty: 5 },
      { article: 'ART-B', clusterId: 'C3', qty: 5 }
    ]);
    expect(res.removedKeys).toEqual(['ART-B|||C3']);
    expect(res.removedClusterIds).toEqual([]);
  });

  it('Ozon не берёт ничего вообще: пустой состав и все кластеры убраны', () => {
    const res = applyOzonCorrection(folded, [
      { article: 'ART-B', clusterId: 'C1', qty: 10 },
      { article: 'ART-A', clusterId: 'C2', qty: 20 }
    ]);
    expect(res.quantities).toEqual({});
    expect(res.removedKeys.length).toBe(2);
    expect(res.removedClusterIds.sort()).toEqual(['C1', 'C2']);
  });

  it('кластера в ответе нет — строка убирается, а не остаётся молча', () => {
    const res = applyOzonCorrection(folded, [{ article: 'ART-A', clusterId: 'C-НЕТ', qty: 5 }]);
    expect(res.quantities).toEqual({});
    expect(res.removedKeys).toEqual(['ART-A|||C-НЕТ']);
    expect(res.removedClusterIds).toEqual(['C-НЕТ']);
  });

  it('повторная коррекция ничего не меняет', () => {
    const first = applyOzonCorrection(folded, [
      { article: 'ART-A', clusterId: 'C1', qty: 40 },
      { article: 'ART-B', clusterId: 'C1', qty: 10 }
    ]);
    // Убранные строки в состав больше не входят, поэтому второй проход идёт по оставшимся.
    const second = applyOzonCorrection(folded, [{ article: 'ART-A', clusterId: 'C1', qty: first.quantities['ART-A|||C1'] }]);
    expect(second.quantities).toEqual({ 'ART-A|||C1': 30 });
    expect(second.removedKeys).toEqual([]);
  });

  it('после коррекции непринятого не остаётся', () => {
    const lines = [
      { article: 'ART-A', clusterId: 'C1', qty: 40 },
      { article: 'ART-B', clusterId: 'C1', qty: 10 },
      { article: 'ART-A', clusterId: 'C2', qty: 20 }
    ];
    const res = applyOzonCorrection(folded, lines);
    const left = lines
      .filter((l) => res.removedKeys.indexOf(`${l.article}|||${l.clusterId}`) < 0)
      .map((l) => acceptedForLine(folded, { ...l, qty: res.quantities[`${l.article}|||${l.clusterId}`] }).notAccepted)
      .reduce((a, b) => a + b, 0);
    expect(left).toBe(0);
  });
});

// ===== Пункт 60. Кластеры без остатка и порядок списка =====

describe('пункт 60: галочка у кластера, которому остатка не хватило', () => {
  it('кластер с рекомендацией отмечается, как и раньше', () => {
    expect(canTickCluster(4, 4)).toBe(true);
  });

  it('кластеру нужна поставка, но остатка нет — галочка ЕСТЬ', () => {
    expect(canTickCluster(0, 1)).toBe(true);
    expect(canTickCluster(0, 2)).toBe(true);
  });

  it('кластеру ничего не нужно — галочки нет', () => {
    expect(canTickCluster(0, 0)).toBe(false);
  });

  it('отсутствующие числа не превращаются в галочку', () => {
    expect(canTickCluster(null, null)).toBe(false);
    expect(canTickCluster(undefined, undefined)).toBe(false);
    expect(canTickCluster(NaN as any, NaN as any)).toBe(false);
  });
});

describe('пункт 60: порядок кластеров по доле продаж', () => {
  const clusters = [
    { clusterId: '4007', clusterName: 'Санкт-Петербург и СЗО' },
    { clusterId: '4039', clusterName: 'Москва, МО и Дальние регионы' },
    { clusterId: '4066', clusterName: 'Екатеринбург' },
    { clusterId: '4071', clusterName: 'Ростов' }
  ];
  const shares = { '4039': 41.2, '4007': 23.8, '4071': 9.4 };

  it('сначала кластеры с большей долей продаж', () => {
    const sorted = sortClustersBySalesShare(clusters, shares);
    expect(sorted.map((c) => c.clusterId)).toEqual(['4039', '4007', '4071', '4066']);
  });

  it('кластер без продаж уходит в конец, а не наверх', () => {
    const sorted = sortClustersBySalesShare(clusters, shares);
    expect(sorted[sorted.length - 1].clusterId).toBe('4066');
  });

  it('при равных долях порядок по названию', () => {
    const sorted = sortClustersBySalesShare(
      [
        { clusterId: 'b', clusterName: 'Ярославль' },
        { clusterId: 'a', clusterName: 'Астрахань' }
      ],
      { a: 5, b: 5 }
    );
    expect(sorted.map((c) => c.clusterName)).toEqual(['Астрахань', 'Ярославль']);
  });

  it('исходный массив не изменяется', () => {
    // Ловушка: общая фикстура уже отсортирована предыдущими проверками, и сортировка
    // «на месте» на ней незаметна. Массив собирается заново прямо здесь.
    const own = [
      { clusterId: '4007', clusterName: 'Санкт-Петербург и СЗО' },
      { clusterId: '4039', clusterName: 'Москва, МО и Дальние регионы' },
      { clusterId: '4066', clusterName: 'Екатеринбург' }
    ];
    const before = own.map((c) => c.clusterId);
    const sorted = sortClustersBySalesShare(own, shares);
    expect(own.map((c) => c.clusterId)).toEqual(before);
    expect(sorted.map((c) => c.clusterId)).toEqual(['4039', '4007', '4066']);
  });

  it('пустая карта долей и пустой список не роняют расчёт', () => {
    expect(sortClustersBySalesShare(clusters, {}).map((c) => c.clusterId)).toEqual(['4066', '4039', '4071', '4007']);
    expect(sortClustersBySalesShare([], shares)).toEqual([]);
  });
});

describe('подключение пункта 60 к экранам', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const stocks = read('src/components/OzonStocksTab.tsx');
  const modal = read('src/components/OzonSupplyModal.tsx');

  it('«Рекомендации»: галочка рисуется по правилу, а не по одним коробкам', () => {
    expect(stocks).toContain('canTickCluster(c.recommendation.boxes, c.needBoxes)');
    expect(stocks).not.toContain('{c.recommendation.boxes > 0 && (');
  });

  it('«Рекомендации»: кластер с нулём попадает в заявку по тому же правилу', () => {
    expect(stocks).toMatch(/if \(!canTickCluster\(c\.recommendation\.boxes, c\.needBoxes\)\) continue;/);
  });

  it('«Рекомендации»: доли кластеров уезжают в мастер', () => {
    expect(stocks).toContain('clusterSalesShare={clusterShares.byClusterId}');
    expect(stocks).toContain('byClusterId[clusterId] = total > 0');
  });

  it('Мастер: список кластеров сортируется правилом', () => {
    expect(modal).toContain('sortClustersBySalesShare(refs, clusterSalesShare)');
  });
});

describe('пункт 60а: ноль в поле количества не приходится стирать', () => {
  it('ноль стирается при постановке курсора', () => {
    expect(shouldBlankQtyOnFocus(0)).toBe(true);
  });

  it('набранное число при постановке курсора НЕ стирается', () => {
    expect(shouldBlankQtyOnFocus(36)).toBe(false);
    expect(shouldBlankQtyOnFocus(1)).toBe(false);
  });

  it('отсутствующее количество считается нулём и стирается', () => {
    expect(shouldBlankQtyOnFocus(null)).toBe(true);
    expect(shouldBlankQtyOnFocus(undefined)).toBe(true);
    expect(shouldBlankQtyOnFocus(NaN as any)).toBe(true);
  });

  it('пока поле чистят, оно пустое', () => {
    expect(qtyFieldValue(0, true)).toBe('');
    expect(qtyFieldValue(36, true)).toBe('');
  });

  it('вне правки поле показывает количество, включая ноль', () => {
    expect(qtyFieldValue(0, false)).toBe('0');
    expect(qtyFieldValue(36, false)).toBe('36');
    expect(qtyFieldValue(null, false)).toBe('0');
  });
});

describe('подключение пункта 60а к полю количества', () => {
  const modal = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonSupplyModal.tsx'), 'utf8');

  it('поле рисуется правилом, а не сырым количеством', () => {
    expect(modal).toContain('value={qtyFieldValue(getQty(r), Boolean(blankedQty[rowKey(r)]))}');
    expect(modal).not.toContain('value={getQty(r)}');
  });

  it('ноль стирается по фокусу', () => {
    expect(modal).toMatch(/onFocus=\{\(\) => \{[\s\S]{0,200}shouldBlankQtyOnFocus\(getQty\(r\)\)/);
  });

  it('опустошённое поле не заполняется нулём обратно', () => {
    expect(modal).toMatch(/if \(e\.target\.value === ''\) next\[rowKey\(r\)\] = true;/);
  });

  it('после ухода курсора поле снова показывает число', () => {
    expect(modal).toMatch(/onBlur=\{\(\) => \{[\s\S]{0,200}delete next\[rowKey\(r\)\];/);
  });
});
