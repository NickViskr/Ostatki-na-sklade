import { describe, expect, it } from 'vitest';
import { buildCoverageAlerts } from './ozonAlerts';
import { isFunnelVisibleStatus } from './ozonStatus';
import type { ArticleCoverage, ClusterCoverageRow, OzonCoverageResult, OzonCoverageSettings } from './ozonCoverage';

const settings: OzonCoverageSettings = {
  speedWeeks: 4,
  minStockDays: 7,
  targetStockDays: 20,
  maxClusterDays: 0,
  factoryOrderDays: 14,
  returnsToSalePct: 0,
  excludedClusters: ''
};

/**
 * One cluster row. Only the fields buildCoverageAlerts reads carry meaning:
 * boxes is what can actually be shipped from our own warehouse, unmetQty is what
 * the cluster asked for and did not get.
 */
function makeCluster(over: { clusterName: string; boxes: number; unmetQty: number; coverageDays?: number }): ClusterCoverageRow {
  return {
    clusterId: over.clusterName,
    clusterName: over.clusterName,
    qtySold: 0,
    perDay: 0,
    available: 0,
    transit: 0,
    returns: 0,
    estimated: 0,
    coverageDays: over.coverageDays === undefined ? 5 : over.coverageDays,
    excluded: false,
    priority: false,
    priorityK: 1,
    unmetQty: over.unmetQty,
    pendingQty: 0,
    requestedQty: 0,
    ozonInFlightQty: 0,
    inFlightQty: 0,
    speedSharePct: 0,
    shareWindowWeeks: 0,
    recommendation: {
      neededQty: over.boxes * 10 + over.unmetQty,
      wantQty: over.boxes * 10 + over.unmetQty,
      boxes: over.boxes,
      qty: over.boxes * 10,
      limitedByMyStock: over.unmetQty > 0,
      partialByMaxDays: false,
      fullBoxDays: 0
    }
  };
}

function makeCoverage(clusters: ClusterCoverageRow[]): OzonCoverageResult {
  const article: ArticleCoverage = {
    article: 'ART-1',
    qtySold: 0,
    perDay: 0,
    forecastPerDay: 0,
    trend: null,
    pcsPerBox: 10,
    leadTimeDays: 0,
    myStockAvailable: 0,
    totalEstimated: 0,
    unboundEstimated: 0,
    unboundQtySold: 0,
    unmetDeficitQty: clusters.reduce((s, c) => s + c.unmetQty, 0),
    pendingTotal: 0,
    freeMyStock: 0,
    shippableMyStock: 0,
    sharedLimitedBy: [],
    clusters,
    factory: null,
    speedCorrection: null,
    demandGrowth: null
  };
  return {
    speed: { perDayByArticle: {}, weeksUsed: 0 } as unknown as OzonCoverageResult['speed'],
    articles: [article],
    components: [],
    bottlenecks: [],
    trends: {}
  };
}

const supplyAlerts = (clusters: ClusterCoverageRow[]) =>
  buildCoverageAlerts(makeCoverage(clusters), settings, {}).filter(a => a.type === 'supply_needed');

describe('Item 55. «Пора сделать поставку» без остатка на своём складе', () => {
  it('нет свободного остатка ни по одному кластеру — алерта нет', () => {
    const alerts = supplyAlerts([
      makeCluster({ clusterName: 'Москва', boxes: 0, unmetQty: 40 }),
      makeCluster({ clusterName: 'Казань', boxes: 0, unmetQty: 20 })
    ]);
    expect(alerts).toEqual([]);
  });

  it('остаток появился хотя бы по одному кластеру — алерт возвращается', () => {
    const alerts = supplyAlerts([
      makeCluster({ clusterName: 'Москва', boxes: 3, unmetQty: 0 }),
      makeCluster({ clusterName: 'Казань', boxes: 0, unmetQty: 20 })
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('Пора сделать поставку на Ozon');
  });

  it('частичное покрытие: кластер без остатка остаётся в тексте как подсказка', () => {
    const alerts = supplyAlerts([
      makeCluster({ clusterName: 'Москва', boxes: 3, unmetQty: 0, coverageDays: 1 }),
      makeCluster({ clusterName: 'Казань', boxes: 0, unmetQty: 20, coverageDays: 2 })
    ]);
    expect(alerts[0].description).toContain('Москва: 3 кор. (30 шт)');
    expect(alerts[0].description).toContain('Казань: нужно 20 шт — нет на своём складе');
  });

  it('кластеров без потребности нет — алерта нет', () => {
    const alerts = supplyAlerts([makeCluster({ clusterName: 'Москва', boxes: 0, unmetQty: 0 })]);
    expect(alerts).toEqual([]);
  });
});

describe('Item 44. Статусы воронки поставок', () => {
  it('живые статусы остаются', () => {
    for (const s of [
      'READY_TO_SUPPLY',
      'ACCEPTED_AT_SUPPLY_WAREHOUSE',
      'IN_TRANSIT',
      'ACCEPTANCE_AT_STORAGE_WAREHOUSE',
      'REPORTS_CONFIRMATION_AWAITING'
    ]) {
      expect(isFunnelVisibleStatus(s)).toBe(true);
    }
  });

  it('проблемные статусы остаются: поставка не закончена', () => {
    for (const s of ['OVERDUE', 'REJECTED_AT_SUPPLY_WAREHOUSE', 'REPORT_REJECTED']) {
      expect(isFunnelVisibleStatus(s)).toBe(true);
    }
  });

  it('отменённые, завершённые и черновики уходят', () => {
    expect(isFunnelVisibleStatus('CANCELLED')).toBe(false);
    expect(isFunnelVisibleStatus('COMPLETED')).toBe(false);
    expect(isFunnelVisibleStatus('DATA_FILLING')).toBe(false);
  });

  it('пустой статус считается черновиком и уходит', () => {
    expect(isFunnelVisibleStatus(undefined)).toBe(false);
    expect(isFunnelVisibleStatus('')).toBe(false);
  });

  it('регистр и пробелы не мешают', () => {
    expect(isFunnelVisibleStatus(' cancelled ')).toBe(false);
    expect(isFunnelVisibleStatus('in_transit')).toBe(true);
  });

  it('незнакомый статус Ozon остаётся в воронке, а не исчезает молча', () => {
    expect(isFunnelVisibleStatus('SOME_NEW_OZON_STATUS')).toBe(true);
  });
});

describe('Блок алертов на вкладке «Склад» по умолчанию свёрнут (15.09.2026)', () => {
  it('стартовое состояние isAlertsCollapsed — true, кнопка разворачивает', () => {
    const fs = require('fs');
    const path = require('path');
    const dash = fs.readFileSync(path.join(process.cwd(), 'src/components/Dashboard.tsx'), 'utf8');
    expect(dash).toMatch(/const \[isAlertsCollapsed, setIsAlertsCollapsed\] = useState\(true\)/);
    expect(dash).toContain('{!isAlertsCollapsed && (');
  });
});

// Item 73. «Спрос вырос»: the last 7 days beat the speed window by more than the threshold.
describe('Item 73. Алерт «Спрос вырос»', () => {
  const growthCoverage = (applied: boolean, growthPct = 53.4) => {
    const cov = makeCoverage([makeCluster({ clusterName: 'Москва', boxes: 2, unmetQty: 0 })]);
    cov.articles[0].demandGrowth = {
      recentQty: 63.95, recentPerDay: 9.136, currentWeekDays: 2.21, basePerDay: 5.958, growthPct, thresholdPct: 30, applied
    };
    return cov;
  };

  it('срабатывание — оранжевый алерт с артикулом и процентом, первый в списке', () => {
    const alerts = buildCoverageAlerts(growthCoverage(true), settings, { 'ART-1': 'Миска' });
    expect(alerts[0].type).toBe('demand_growth');
    expect(alerts[0].severity).toBe('orange');
    expect(alerts[0].title).toBe('Спрос вырос: ART-1 +53 %');
    expect(alerts[0].article).toBe('ART-1');
    expect(alerts[0].key).toBe('growth:ART-1:53');
    expect(alerts[0].description).toContain('ART-1 — Миска');
    expect(alerts[0].description).toContain('за 7 дней продано 64 шт (9.14 шт/д) против 5.96 шт/д по окну');
    expect(alerts.filter(a => a.type === 'demand_growth')).toHaveLength(1);
  });

  it('ниже порога (applied = false) алерта нет, хотя разбор есть', () => {
    const alerts = buildCoverageAlerts(growthCoverage(false, 20), settings, {});
    expect(alerts.filter(a => a.type === 'demand_growth')).toEqual([]);
  });

  it('несколько товаров — сортировка по убыванию роста', () => {
    const cov = growthCoverage(true, 40);
    const second: ArticleCoverage = { ...cov.articles[0], article: 'ART-2', demandGrowth: { ...cov.articles[0].demandGrowth!, growthPct: 90 } };
    cov.articles.push(second);
    const alerts = buildCoverageAlerts(cov, settings, {}).filter(a => a.type === 'demand_growth');
    expect(alerts.map(a => a.article)).toEqual(['ART-2', 'ART-1']);
  });

  it('кнопка «Открыть» ведёт в «Остатки Ozon», а таблица помечает скорость «спрос +N %»', () => {
    const fs = require('fs');
    const path = require('path');
    const dashboard = fs.readFileSync(path.join(process.cwd(), 'src/components/Dashboard.tsx'), 'utf8');
    expect(dashboard).toMatch(/alert\.type === 'demand_growth' \? 'ozonStocks'/);
    const tab = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect(tab).toContain('art.demandGrowth && art.demandGrowth.applied');
    expect(tab).toContain('спрос +{Math.round(art.demandGrowth.growthPct)} %');
  });
});
