import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  assignedForArticle,
  buildManualPlan,
  clampManualQty,
  manualKey,
  pickedCabinetSets,
  pickedClusterIds,
  readManualPicks,
  manualClusterList,
  remainingForArticle
} from './ozonManualSupply';
import type { ManualArticleInfo } from './ozonManualSupply';

// Пункт 63. Владелец собирает поставку сам, глядя на остатки по кластерам, а не по
// рекомендациям. Главное правило: сколько бы кластеров он ни отметил, суммарно нельзя
// назначить больше, чем свободно на «Моём складе».

const info = (over: Partial<ManualArticleInfo> = {}): ManualArticleInfo => ({
  article: 'Полка_бел',
  name: 'Полка белая',
  pcsPerBox: 10,
  freeMyStock: 55,
  cabinets: ['Mercurius'],
  clusters: [
    { clusterId: '4007', clusterName: 'Москва' },
    { clusterId: '4039', clusterName: 'Санкт-Петербург и СЗО' },
    { clusterId: '4066', clusterName: 'Екатеринбург' }
  ],
  ...over
});

describe('разбор галочек', () => {
  it('ключ собирается и разбирается обратно', () => {
    const picks = readManualPicks({ [manualKey('Полка_бел', '4007')]: '30' });
    expect(picks).toEqual([{ article: 'Полка_бел', clusterId: '4007', qty: 30 }]);
  });

  it('отмеченный кластер без количества входит с нулём, а не выбрасывается', () => {
    // Так же, как в пункте 60: галочка стоит, количество владелец задаст позже.
    expect(readManualPicks({ [manualKey('Полка_бел', '4007')]: '' })).toEqual([
      { article: 'Полка_бел', clusterId: '4007', qty: 0 }
    ]);
  });

  it('дробное и отрицательное количество превращаются в целое неотрицательное', () => {
    const picks = readManualPicks({
      [manualKey('A', '1')]: '12.7',
      [manualKey('B', '2')]: '-5',
      [manualKey('C', '3')]: 'абв'
    });
    expect(picks.map((p) => p.qty)).toEqual([12, 0, 0]);
  });

  it('битый ключ пропускается', () => {
    expect(readManualPicks({ 'без-разделителя': '5' })).toEqual([]);
    expect(readManualPicks({ [manualKey('', '4007')]: '5' })).toEqual([]);
    expect(readManualPicks(null)).toEqual([]);
  });

  it('кластеры и магазины выбора собираются для правил пунктов 58 и 59', () => {
    const picks = readManualPicks({
      [manualKey('A', '4007')]: '10',
      [manualKey('B', '4007')]: '10',
      [manualKey('B', '4039')]: '10'
    });
    expect(pickedClusterIds(picks)).toEqual(['4007', '4039']);
    expect(pickedCabinetSets(picks, { A: ['Mercurius'], B: ['MaxiStore'] })).toEqual([
      ['Mercurius'], ['MaxiStore'], ['MaxiStore']
    ]);
  });
});

describe('остаток пересчитывается при каждой галочке', () => {
  it('назначенное другим кластерам вычитается из свободного', () => {
    const picks = readManualPicks({
      [manualKey('Полка_бел', '4007')]: '30',
      [manualKey('Полка_бел', '4039')]: '15'
    });
    // Считаем остаток для НОВОГО кластера: занято 45 из 55.
    expect(remainingForArticle(55, picks, 'Полка_бел', '4066')).toBe(10);
  });

  it('свой собственный кластер из подсчёта исключается — иначе поле нельзя было бы увеличить', () => {
    const picks = readManualPicks({
      [manualKey('Полка_бел', '4007')]: '30',
      [manualKey('Полка_бел', '4039')]: '15'
    });
    // Для Москвы её же 30 не считаются занятыми: 55 − 15 = 40.
    expect(remainingForArticle(55, picks, 'Полка_бел', '4007')).toBe(40);
  });

  it('чужой товар на остаток не влияет', () => {
    const picks = readManualPicks({
      [manualKey('Полка_бел', '4007')]: '30',
      [manualKey('Стеллаж', '4007')]: '100'
    });
    expect(remainingForArticle(55, picks, 'Полка_бел', '4039')).toBe(25);
    expect(assignedForArticle(picks, 'Стеллаж', '')).toBe(100);
  });

  it('перебор не уводит остаток в минус', () => {
    const picks = readManualPicks({ [manualKey('Полка_бел', '4007')]: '80' });
    expect(remainingForArticle(55, picks, 'Полка_бел', '4039')).toBe(0);
  });
});

describe('ввод количества обрезается по остатку', () => {
  it('больше свободного ввести нельзя', () => {
    const picks = readManualPicks({ [manualKey('Полка_бел', '4007')]: '30' });
    expect(clampManualQty('999', 55, picks, 'Полка_бел', '4039')).toBe(25);
  });

  it('в пределах остатка проходит как есть', () => {
    const picks = readManualPicks({ [manualKey('Полка_бел', '4007')]: '30' });
    expect(clampManualQty('20', 55, picks, 'Полка_бел', '4039')).toBe(20);
  });

  it('пустое поле — это ноль, а не отказ: владелец стирает цифру, чтобы набрать новую', () => {
    expect(clampManualQty('', 55, [], 'Полка_бел', '4007')).toBe(0);
  });

  it('увеличение уже отмеченного кластера ограничено остальными, а не самим собой', () => {
    const picks = readManualPicks({
      [manualKey('Полка_бел', '4007')]: '30',
      [manualKey('Полка_бел', '4039')]: '15'
    });
    expect(clampManualQty('50', 55, picks, 'Полка_бел', '4007')).toBe(40);
  });
});

describe('сборка заявки из галочек', () => {
  it('строки, кластеры и коробки считаются по выбору', () => {
    const picks = readManualPicks({
      [manualKey('Полка_бел', '4007')]: '30',
      [manualKey('Полка_бел', '4066')]: '5'
    });
    const plan = buildManualPlan(picks, [info()]);
    expect(plan.rows).toEqual([
      { article: 'Полка_бел', name: 'Полка белая', clusterId: '4007', clusterName: 'Москва', boxes: 3, qty: 30, limitedByMyStock: false },
      { article: 'Полка_бел', name: 'Полка белая', clusterId: '4066', clusterName: 'Екатеринбург', boxes: 1, qty: 5, limitedByMyStock: false }
    ]);
    expect(plan.totalQty).toBe(35);
    expect(plan.totalBoxes).toBe(4);
    expect(plan.cabinets).toEqual(['Mercurius']);
  });

  it('неполная коробка считается коробкой, а не отбрасывается', () => {
    const picks = readManualPicks({ [manualKey('Полка_бел', '4007')]: '5' });
    expect(buildManualPlan(picks, [info()]).rows[0].boxes).toBe(1);
  });

  it('порядок строк идёт от экрана, а не от порядка кликов', () => {
    // Владелец отметил Екатеринбург раньше Москвы — в заявке они должны идти как в таблице.
    const picks = readManualPicks({
      [manualKey('Полка_бел', '4066')]: '5',
      [manualKey('Полка_бел', '4007')]: '30'
    });
    const plan = buildManualPlan(picks, [info()]);
    expect(plan.rows.map((r) => r.clusterId)).toEqual(['4007', '4066']);
  });

  it('одинаковые кластеры разных товаров складываются в один итог', () => {
    const picks = readManualPicks({
      [manualKey('Полка_бел', '4007')]: '30',
      [manualKey('Стеллаж', '4007')]: '12'
    });
    const plan = buildManualPlan(picks, [
      info(),
      info({ article: 'Стеллаж', name: 'Стеллаж', pcsPerBox: 6, freeMyStock: 40, cabinets: ['MaxiStore'] })
    ]);
    expect(plan.clusters).toEqual([{ clusterId: '4007', clusterName: 'Москва', qty: 42 }]);
    expect(plan.cabinets).toEqual(['Mercurius', 'MaxiStore']);
  });

  it('кластер, которого нет в списке товара, в заявку не попадает', () => {
    // Защита от мусора в состоянии галочек. Список кластеров товара экран собирает
    // ПОЛНЫМ (пункт 64) и передаёт сюда же — см. тест про новый кластер ниже.
    const picks = readManualPicks({ [manualKey('Полка_бел', '9999')]: '10' });
    expect(buildManualPlan(picks, [info()]).rows).toEqual([]);
  });

  it('кластер, куда товар ещё не ездил, попадает в заявку наравне с остальными', () => {
    // Пункт 64, скрытая половина: если бы сборка заявки брала только «свои» кластеры
    // товара, отмеченный на экране новый кластер молча исчез бы из поставки.
    const full = manualClusterList(
      [{ clusterId: '4007', clusterName: 'Москва' }],
      [{ clusterId: '4041', clusterName: 'Казань' }],
      { '4007': 41.2 },
      (ref) => ({ ...ref })
    );
    const picks = readManualPicks({ [manualKey('Полка_бел', '4041')]: '12' });
    const plan = buildManualPlan(picks, [info({ clusters: full })]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].clusterName).toBe('Казань');
    expect(plan.rows[0].qty).toBe(12);
  });

  it('товар без галочек не даёт ни строк, ни магазина', () => {
    const plan = buildManualPlan(readManualPicks({ [manualKey('Стеллаж', '4007')]: '5' }), [info()]);
    expect(plan.rows).toEqual([]);
    expect(plan.cabinets).toEqual([]);
  });

  it('перебор остатка виден отдельно: данные могли обновиться после расстановки галочек', () => {
    const picks = readManualPicks({
      [manualKey('Полка_бел', '4007')]: '40',
      [manualKey('Полка_бел', '4039')]: '30'
    });
    const plan = buildManualPlan(picks, [info({ freeMyStock: 55 })]);
    expect(plan.over).toEqual([{ article: 'Полка_бел', name: 'Полка белая', free: 55, asked: 70 }]);
  });

  it('ровно по остатку перебором не считается', () => {
    const picks = readManualPicks({ [manualKey('Полка_бел', '4007')]: '55' });
    expect(buildManualPlan(picks, [info({ freeMyStock: 55 })]).over).toEqual([]);
  });

  it('нулевая коробка не роняет расчёт', () => {
    const picks = readManualPicks({ [manualKey('Полка_бел', '4007')]: '7' });
    const plan = buildManualPlan(picks, [info({ pcsPerBox: 0 })]);
    expect(plan.rows[0].boxes).toBe(7);
  });
});

describe('в ручном режиме видны все кластеры поставки', () => {
  // Пункт 64. У товара в таблице есть только кластеры, где он лежит или продаётся.
  // Везти товар в новый регион — это как раз выбрать кластер, где его сейчас НЕТ.
  type Row = { clusterId: string; clusterName: string; available?: number; stub?: boolean };
  const empty = (ref: { clusterId: string; clusterName: string }): Row => ({ ...ref, stub: true });

  const refs = [
    { clusterId: '4007', clusterName: 'Москва' },
    { clusterId: '4039', clusterName: 'Санкт-Петербург и СЗО' },
    { clusterId: '4066', clusterName: 'Екатеринбург' },
    { clusterId: '4041', clusterName: 'Казань' }
  ];
  const shares = { '4007': 41.2, '4039': 18.6, '4041': 7.4 };

  it('к своим кластерам добавляются остальные', () => {
    const own: Row[] = [{ clusterId: '4007', clusterName: 'Москва', available: 12 }];
    const list = manualClusterList(own, refs, shares, empty);
    expect(list.map((c) => c.clusterId)).toEqual(['4007', '4039', '4041', '4066']);
  });

  it('порядок — по убыванию доли в общем объёме продаж, кластеры без продаж в конце', () => {
    const list = manualClusterList([], refs, shares, empty);
    expect(list.map((c) => c.clusterName)).toEqual([
      'Москва', 'Санкт-Петербург и СЗО', 'Казань', 'Екатеринбург'
    ]);
  });

  it('свой кластер не подменяется пустышкой — иначе пропали бы остатки', () => {
    const own: Row[] = [{ clusterId: '4007', clusterName: 'Москва', available: 12 }];
    const list = manualClusterList(own, refs, shares, empty);
    const moscow = list.find((c) => c.clusterId === '4007');
    expect(moscow!.available).toBe(12);
    expect(moscow!.stub).toBeUndefined();
  });

  it('кластер товара, которого нет в справочнике, не теряется', () => {
    // Справочник кластеров может отстать от остатков — молча выбросить остаток нельзя.
    const own: Row[] = [{ clusterId: '9999', clusterName: 'Новый кластер', available: 5 }];
    const list = manualClusterList(own, refs, shares, empty);
    expect(list.map((c) => c.clusterId)).toContain('9999');
    expect(list).toHaveLength(5);
  });

  it('повторы в справочнике не удваивают строку', () => {
    const list = manualClusterList([], [...refs, { clusterId: '4007', clusterName: 'Москва' }], shares, empty);
    expect(list.filter((c) => c.clusterId === '4007')).toHaveLength(1);
  });

  it('кластер без идентификатора пропускается', () => {
    const list = manualClusterList([], [{ clusterId: '', clusterName: 'Пусто' }], shares, empty);
    expect(list).toEqual([]);
  });

  it('пустой справочник оставляет только свои кластеры', () => {
    const own: Row[] = [{ clusterId: '4007', clusterName: 'Москва', available: 12 }];
    expect(manualClusterList(own, [], shares, empty).map((c) => c.clusterId)).toEqual(['4007']);
  });
});

describe('ручной выбор на экране остатков', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const stocks = read('src/components/OzonStocksTab.tsx');

  it('режим включается кнопкой и выключение стирает галочки', () => {
    expect(stocks).toContain("id=\"btn-ozon-manual-supply\"");
    expect(stocks).toContain('onClick={() => (manualMode ? exitManualMode() : setManualMode(true))}');
    expect(stocks).toMatch(/const exitManualMode = \(\) => \{\s*\n\s*setManualMode\(false\);\s*\n\s*setManualQty\(\{\}\);/);
  });

  it('правило прямой поставки применяется к РУЧНОМУ выбору, а не к галочкам рекомендаций', () => {
    // Иначе запрет пункта 58 обходился бы переключением списка.
    expect(stocks).toContain('const blockedDirect = !isClusterSelectable(directRules, manualClusterIds, String(cls.clusterId));');
    expect(stocks).toContain('disabledReason(directRules, manualClusterIds, String(cls.clusterId))');
  });

  it('правило одного магазина тоже смотрит на ручной выбор', () => {
    expect(stocks).toContain('const blockedCabinet = !isCabinetCompatible(manualCabinetSets, art.cabinets || []);');
    expect(stocks).toContain('disabled={blockedDirect || blockedCabinet}');
  });

  it('клик по галочке не раскрывает строку кластера', () => {
    expect(stocks).toContain('<span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>');
  });

  it('ввод количества обрезается по свободному остатку', () => {
    expect(stocks).toContain("const value = raw === '' ? '' : String(clampManualQty(raw, freeMyStock, manualPicks, article, clusterId));");
    expect(stocks).toContain('onChange={(e) => changeManualQty(art.article, String(cls.clusterId), e.target.value, art.freeMyStock)}');
  });

  it('таблица в режиме выбора показывает ВСЕ кластеры поставки', () => {
    expect(stocks).toContain('manualClusterList(art.clusters || [], supplyClusterRefs, clusterShares.byClusterId, emptyManualCluster)');
  });

  it('сборка заявки берёт тот же полный список, что и таблица', () => {
    // Иначе отмеченный новый кластер молча исчезнет из поставки.
    expect(stocks).toMatch(/clusters: manualClusterList\(\s*\n\s*row\.clusters \|\| \[\],\s*\n\s*supplyClusterRefs,/);
  });

  it('исключённые настройкой кластеры сами не добавляются', () => {
    expect(stocks).toContain("const excluded = parseExcludedClusters(ozonSettings ? ozonSettings.excludedClusters : '');");
    expect(stocks).toContain('.filter((c: any) => c.clusterId && !excluded.has(String(c.clusterId)))');
  });

  it('строка товара показывает, сколько ещё свободно', () => {
    expect(stocks).toContain("свободно {fmtInt(remainingForArticle(art.freeMyStock, manualPicks, art.article, ''))} шт");
  });

  it('заявка уходит в тот же мастер, что и из рекомендаций, но со своим выбором', () => {
    expect(stocks).toContain('isOpen={manualSummaryOpen && manualPlan.rows.length > 0}');
    expect(stocks).toContain('rows={manualPlan.rows}');
    expect(stocks).toContain('cabinet={resolveSupplyCabinet(manualCabinetSets) || (cabinetFilter !== \'all\' ? cabinetFilter : \'\')}');
  });

  it('оформление блокируется при переборе остатка, двух магазинах и без точки отгрузки', () => {
    expect(stocks).toMatch(/manualPlan\.rows\.length === 0\s*\n\s*\|\| manualPlan\.cabinets\.length > 1\s*\n\s*\|\| manualPlan\.over\.length > 0\s*\n\s*\|\| !supplySettings\.dropOffWarehouseId/);
  });

  it('у каждого списка своё состояние: заявка из рекомендаций чистит свой выбор', () => {
    expect(stocks).toContain('setSelectedSupply({});');
  });

  it('созданная заявка гасит режим выбора, из какого бы списка она ни ушла', () => {
    // Пункт 66. Режим рисуют обе кнопки, а выключала его только своя — после заявки
    // из рекомендаций полный список кластеров оставался на экране.
    expect(stocks).toMatch(/onCreated=\{\(\) => \{\s*\n\s*setSelectedSupply\(\{\}\);[\s\S]{0,400}exitManualMode\(\);/);
    expect(stocks).toContain('onCreated={() => { exitManualMode(); setManualSummaryOpen(false); }}');
  });
});
