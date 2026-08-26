import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  directWarehouseFor,
  disabledReason,
  findDirectRule,
  isClusterSelectable,
  isDirectCluster,
  parseDirectClusters,
  supplyModeFor,
  validateSelection,
  type DirectClusterRule
} from './ozonDirectSupply';

// Plan item 58, stage 1. Ekaterinburg (cluster 4066) ships by direct supply and therefore
// travels alone: Ozon has no draft that mixes a direct cluster with anything else.
// The owner keeps the list of direct clusters in settings, so the fixtures use two of them
// to prove the rule is about the KIND of cluster, not about Ekaterinburg by name.

const EKB = '4066';
const MSK = '4039';
const SPB = '4007';
const SECOND_DIRECT = '4051';

const rules: DirectClusterRule[] = [
  { clusterId: EKB, clusterName: 'Екатеринбург', warehouseId: '15431806189000', warehouseName: 'ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ' }
];

const twoDirect: DirectClusterRule[] = [
  ...rules,
  { clusterId: SECOND_DIRECT, clusterName: 'Казань', warehouseId: '15431806189111', warehouseName: 'КАЗАНЬ_РФЦ' }
];

describe('разбор настройки прямых кластеров', () => {
  it('строка JSON превращается в правила', () => {
    const parsed = parseDirectClusters('[{"clusterId":"4066","clusterName":"Екатеринбург","warehouseId":"1543","warehouseName":"ЕКБ_РФЦ"}]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].clusterId).toBe('4066');
    expect(parsed[0].warehouseName).toBe('ЕКБ_РФЦ');
  });

  it('готовый массив принимается как есть', () => {
    expect(parseDirectClusters([{ clusterId: 4066 }])).toHaveLength(1);
    expect(parseDirectClusters([{ clusterId: 4066 }])[0].clusterId).toBe('4066');
  });

  it('пустое, битое и не-массив дают пустой список, а не падение', () => {
    expect(parseDirectClusters('')).toEqual([]);
    expect(parseDirectClusters('   ')).toEqual([]);
    expect(parseDirectClusters('{не json')).toEqual([]);
    expect(parseDirectClusters('{"clusterId":"4066"}')).toEqual([]);
    expect(parseDirectClusters(null)).toEqual([]);
    expect(parseDirectClusters(undefined)).toEqual([]);
  });

  it('строки без кластера пропускаются, дубли схлопываются', () => {
    const parsed = parseDirectClusters('[{"clusterId":""},{"clusterId":"4066"},{"clusterId":"4066","clusterName":"дубль"}]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].clusterName).toBe('');
  });

  it('склад может быть ещё не выбран — правило всё равно читается', () => {
    const parsed = parseDirectClusters('[{"clusterId":"4066","clusterName":"Екатеринбург"}]');
    expect(parsed[0].warehouseId).toBe('');
  });
});

describe('какой кластер прямой', () => {
  it('находится по идентификатору', () => {
    expect(isDirectCluster(rules, EKB)).toBe(true);
    expect(isDirectCluster(rules, MSK)).toBe(false);
    expect(isDirectCluster(rules, '')).toBe(false);
    expect(findDirectRule(rules, EKB)!.warehouseName).toBe('ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ');
    expect(findDirectRule(rules, MSK)).toBeNull();
  });

  it('пустой список правил: прямых кластеров нет вовсе', () => {
    expect(isDirectCluster([], EKB)).toBe(false);
    expect(supplyModeFor([], [EKB])).toBe('crossdock');
    expect(isClusterSelectable([], [EKB], MSK)).toBe(true);
  });
});

describe('способ сдачи по выбору', () => {
  it('пустой выбор — кросс-докинг: до первой галочки никого не блокируем', () => {
    expect(supplyModeFor(rules, [])).toBe('crossdock');
    expect(isClusterSelectable(rules, [], EKB)).toBe(true);
    expect(isClusterSelectable(rules, [], MSK)).toBe(true);
  });

  it('выбран прямой кластер — заявка прямая', () => {
    expect(supplyModeFor(rules, [EKB])).toBe('direct');
  });

  it('выбраны обычные кластеры — заявка кросс-докинговая', () => {
    expect(supplyModeFor(rules, [MSK, SPB])).toBe('crossdock');
  });
});

describe('пункт 58: взаимоисключение галочек', () => {
  it('выбран Екатеринбург — остальные кластеры недоступны', () => {
    expect(isClusterSelectable(rules, [EKB], MSK)).toBe(false);
    expect(isClusterSelectable(rules, [EKB], SPB)).toBe(false);
  });

  it('выбраны другие кластеры — Екатеринбург недоступен', () => {
    expect(isClusterSelectable(rules, [MSK], EKB)).toBe(false);
    expect(isClusterSelectable(rules, [MSK, SPB], EKB)).toBe(false);
  });

  it('обычные кластеры друг друга не блокируют', () => {
    expect(isClusterSelectable(rules, [MSK], SPB)).toBe(true);
    expect(isClusterSelectable(rules, [MSK, SPB], '4041')).toBe(true);
  });

  it('уже отмеченный кластер остаётся доступным — иначе галочку не снять', () => {
    expect(isClusterSelectable(rules, [EKB], EKB)).toBe(true);
    expect(isClusterSelectable(rules, [MSK, SPB], MSK)).toBe(true);
  });

  it('второй прямой кластер к первому тоже не добавляется', () => {
    expect(isClusterSelectable(twoDirect, [EKB], SECOND_DIRECT)).toBe(false);
    expect(isClusterSelectable(twoDirect, [SECOND_DIRECT], EKB)).toBe(false);
  });

  it('правило про вид кластера, а не про Екатеринбург по имени', () => {
    expect(isClusterSelectable(twoDirect, [SECOND_DIRECT], MSK)).toBe(false);
    expect(isClusterSelectable(twoDirect, [MSK], SECOND_DIRECT)).toBe(false);
  });

  it('пустые и повторяющиеся идентификаторы в выборе не сбивают правило', () => {
    expect(isClusterSelectable(rules, ['', ' ', MSK, MSK], EKB)).toBe(false);
    expect(isClusterSelectable(rules, ['', ' '], EKB)).toBe(true);
    expect(isClusterSelectable(rules, [MSK], '')).toBe(false);
  });
});

describe('пояснение, почему галочка серая', () => {
  it('доступная галочка причины не имеет', () => {
    expect(disabledReason(rules, [], EKB)).toBe('');
    expect(disabledReason(rules, [MSK], SPB)).toBe('');
  });

  it('выбран прямой — причина называет его, а не заблокированный кластер', () => {
    const text = disabledReason(rules, [EKB], MSK);
    expect(text).toContain('Екатеринбург');
    expect(text).toContain('прямой поставкой');
  });

  it('выбраны обычные — причина зовёт снять остальные', () => {
    const text = disabledReason(rules, [MSK], EKB);
    expect(text).toContain('Екатеринбург');
    expect(text).toContain('снимите остальные');
  });
});

describe('проверка выбора перед созданием заявки', () => {
  it('пустой выбор и чистый кросс-докинг проходят', () => {
    expect(validateSelection(rules, [])).toBe('');
    expect(validateSelection(rules, [MSK, SPB])).toBe('');
  });

  it('один прямой кластер со складом проходит', () => {
    expect(validateSelection(rules, [EKB])).toBe('');
  });

  it('смешанный выбор отклоняется', () => {
    expect(validateSelection(rules, [EKB, MSK])).toContain('не совмещается');
  });

  it('два прямых кластера отклоняются отдельным текстом', () => {
    const text = validateSelection(twoDirect, [EKB, SECOND_DIRECT]);
    expect(text).toContain('один кластер за заявку');
    expect(text).toContain('Екатеринбург');
    expect(text).toContain('Казань');
  });

  it('прямой кластер без склада отклоняется — заявку в Ozon отправить нечем', () => {
    const noWarehouse: DirectClusterRule[] = [{ clusterId: EKB, clusterName: 'Екатеринбург', warehouseId: '', warehouseName: '' }];
    expect(validateSelection(noWarehouse, [EKB])).toContain('не выбран склад');
  });

  it('склад не требуется, если прямой кластер не выбран', () => {
    const noWarehouse: DirectClusterRule[] = [{ clusterId: EKB, clusterName: 'Екатеринбург', warehouseId: '', warehouseName: '' }];
    expect(validateSelection(noWarehouse, [MSK])).toBe('');
  });
});

describe('склад для заявки', () => {
  it('прямая заявка отдаёт свой склад', () => {
    expect(directWarehouseFor(rules, [EKB])!.warehouseId).toBe('15431806189000');
  });

  it('кросс-докинговой заявке склад не нужен', () => {
    expect(directWarehouseFor(rules, [MSK, SPB])).toBeNull();
    expect(directWarehouseFor(rules, [])).toBeNull();
  });
});

// Этап 3. Правило должно быть подключено В ДВУХ местах: галочки в «Рекомендациях» и
// ручное добавление кластера в окне оформления. Без второго запрет обходится в два клика.
// Компонентных тестов в проекте нет, поэтому подключение стережётся по исходному коду.
describe('подключение правила к экранам', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const stocks = read('src/components/OzonStocksTab.tsx');
  const modal = read('src/components/OzonSupplyModal.tsx');

  it('«Рекомендации»: галочка гаснет по правилу', () => {
    // Выражение стало многострочным: к правилу кластеров добавилось правило магазина (пункт 59).
    expect(stocks).toContain('!isClusterSelectable(directRules, selectedClusterIds, String(c.clusterId))');
  });

  it('«Рекомендации»: причина показывается подсказкой', () => {
    expect(stocks).toMatch(/title=\{\s*disabledReason\(directRules, selectedClusterIds, String\(c\.clusterId\)\)/);
  });

  it('«Рекомендации»: выбор собирается по ВСЕМ артикулам, а не по строке товара', () => {
    expect(stocks).toMatch(/selectedClusterIds\s*=\s*useMemo/);
    expect(stocks).toContain("key.split('|||')[1]");
  });

  it('«Рекомендации»: правила читаются из настроек, а не зашиты', () => {
    expect(stocks).toContain('parseDirectClusters(supplySettings.directClusters)');
    expect(stocks).not.toMatch(/['"`]4066['"`]/);
  });

  it('Мастер: недоступный кластер показан серым, а не спрятан', () => {
    expect(modal).toContain('const blocked = !isClusterSelectable(directRules, supplyClusterIds, c.clusterId);');
    expect(modal).toContain('disabled={blocked}');
    expect(modal).toContain('только отдельной заявкой');
  });

  it('Мастер: добавление строки остановит сторож, даже если список обошли', () => {
    expect(modal).toMatch(/if \(!isClusterSelectable\(directRules, supplyClusterIds, cluster\.clusterId\)\) \{[\s\S]{0,160}return;/);
  });

  it('Мастер: выбор считается по кластерам живого состава заявки', () => {
    expect(modal).toMatch(/supplyClusterIds\s*=\s*useMemo/);
    expect(modal).toContain('activeRows.forEach');
  });

  it('Мастер: правила читаются из настроек, а не зашиты', () => {
    expect(modal).toContain('parseDirectClusters(supplySettings.directClusters)');
    expect(modal).not.toMatch(/['"`]4066['"`]/);
  });
});
