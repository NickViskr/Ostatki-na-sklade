import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { summarizeSettingsImpact, OzonSettingsImpact } from './ozonSettingsImpact';
import {
  buildOzonCoverage,
  OzonCoverageInput,
  OzonCoverageResult,
  OzonCoverageSettings,
} from './ozonCoverage';
import { KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { OzonSettingsModal } from '../components/OzonSettingsModal';

/**
 * Item 87 step 4: «было → станет» summary at the bottom of the «Настройки Ozon» window.
 */

// ---------------------------------------------------------------------------
// Fixtures shared with the ozonCoverage.test.ts style: plain factories, only fields the
// calculation reads are filled in.
// ---------------------------------------------------------------------------

function makeSku(overrides: Partial<SKUItem> & { sku: string }): SKUItem {
  return {
    price: 0,
    minStock: 0,
    pcsPerBox: 1,
    boxesPerPallet: 1,
    volumeLiters: 0,
    leadTimeDays: 0,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4,
    minStockDays: 7,
    targetStockDays: 20,
    maxClusterDays: 0,
    factoryOrderDays: 14,
    returnsToSalePct: 0,
    excludedClusters: '',
    ...overrides,
  };
}

function makeStockRow(offerId: string, available: number, overrides: Partial<OzonStockRow> = {}): OzonStockRow {
  return {
    cabinet: 'test',
    sku: '',
    offerId,
    name: offerId,
    warehouseName: '',
    clusterName: overrides.clusterId ? 'Москва' : '',
    clusterId: '',
    available,
    preparing: 0,
    requested: 0,
    transit: 0,
    excess: 0,
    returns: 0,
    other: 0,
    updatedAt: '',
    ...overrides,
  };
}

// Продажи разложены по одной неделе — 28 шт/неделя даёт 4 шт/день при окне 4 недели.
function makeSalesRows(offerId: string, weeklyQty: number, weeks = 4): OzonSalesRow[] {
  const rows: OzonSalesRow[] = [];
  for (let i = 0; i < weeks; i++) {
    rows.push({
      week: `2024-01-${String(1 + i * 7).padStart(2, '0')}`,
      cabinet: 'test',
      offerId,
      clusterName: '',
      qty: weeklyQty,
      updatedAt: '',
      days: 7,
    });
  }
  return rows;
}

function baseInput(overrides: Partial<OzonCoverageInput> = {}): OzonCoverageInput {
  return {
    stocks: [],
    sales: [],
    skus: [],
    clusters: [],
    settings: makeSettings(),
    myStockAvailability: {},
    now: new Date('2024-01-31T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// summarizeSettingsImpact: hand-built OzonCoverageResult objects
// ---------------------------------------------------------------------------

function emptyResult(): OzonCoverageResult {
  return { speed: {} as any, articles: [], components: [], bottlenecks: [], trends: {} } as OzonCoverageResult;
}

describe('summarizeSettingsImpact: hand-built coverage results', () => {
  it('zero case: no articles, no components — every figure is 0, empty noPriceArticles', () => {
    const summary = summarizeSettingsImpact(emptyResult(), () => 0);
    expect(summary).toEqual<OzonSettingsImpact>({
      factoryPcs: 0,
      factoryRub: 0,
      factoryArticles: 0,
      supplyPcs: 0,
      noPriceArticles: [],
    });
  });

  it('sums factory pcs/₽/articles across articles AND kit components, sums supply pcs across clusters', () => {
    const result: OzonCoverageResult = {
      ...emptyResult(),
      articles: [
        {
          article: 'A',
          factory: { orderQty: 10 } as any,
          clusters: [
            { recommendation: { qty: 30 } as any } as any,
            { recommendation: { qty: 20 } as any } as any,
          ],
        } as any,
        {
          // Виртуальный комплект: своего сигнала нет, только кластерные рекомендации.
          article: 'KIT',
          factory: null,
          clusters: [{ recommendation: { qty: 5 } as any } as any],
        } as any,
      ],
      components: [
        { component: 'COMP-1', factory: { orderQty: 4 } as any } as any,
        { component: 'COMP-2', factory: null } as any,
      ],
    };
    const price = (article: string) => ({ A: 100, 'COMP-1': 50 }[article] || 0);
    const summary = summarizeSettingsImpact(result, price);
    expect(summary.factoryPcs).toBe(14); // 10 (A) + 4 (COMP-1)
    expect(summary.factoryRub).toBe(10 * 100 + 4 * 50);
    expect(summary.factoryArticles).toBe(2); // A и COMP-1, COMP-2 без сигнала не считается
    expect(summary.supplyPcs).toBe(55); // 30 + 20 + 5
    expect(summary.noPriceArticles).toEqual([]);
  });

  it('a factory signal without a price is counted in pcs but listed separately, not in ₽', () => {
    const result: OzonCoverageResult = {
      ...emptyResult(),
      articles: [
        { article: 'NOPRICE', factory: { orderQty: 7 } as any, clusters: [] } as any,
        { article: 'PRICED', factory: { orderQty: 3 } as any, clusters: [] } as any,
      ],
    };
    const price = (article: string) => (article === 'PRICED' ? 25 : 0);
    const summary = summarizeSettingsImpact(result, price);
    expect(summary.factoryPcs).toBe(10);
    expect(summary.factoryRub).toBe(75); // только PRICED
    expect(summary.factoryArticles).toBe(2);
    expect(summary.noPriceArticles).toEqual(['NOPRICE']);
  });

  it('rounds ₽ to exactly 2 decimals', () => {
    const result: OzonCoverageResult = {
      ...emptyResult(),
      articles: [{ article: 'A', factory: { orderQty: 3 } as any, clusters: [] } as any],
    };
    const summary = summarizeSettingsImpact(result, () => 10.005);
    expect(summary.factoryRub).toBe(30.02); // 3 × 10.005 = 30.015 -> округление до копеек
  });
});

// ---------------------------------------------------------------------------
// «Было» equals the screen: same runCoverage path, same totals the screen itself shows.
// ---------------------------------------------------------------------------

describe('summarizeSettingsImpact: "было" ties to the screen\'s own totals', () => {
  it('factoryPcs/₽ and supplyPcs equal what a coverage build gives via the article/cluster totals the screen displays', () => {
    const skus: SKUItem[] = [makeSku({ sku: 'X', pcsPerBox: 1, leadTimeDays: 5 })];
    const stocks: OzonStockRow[] = [makeStockRow('X', 2, { clusterId: '1', clusterName: 'Москва' })];
    const clusters = [{ clusterId: '1', clusterName: 'Москва' }];
    // Высокая скорость продаж — гарантирует и сигнал заказа на фабрике, и рекомендацию в кластер.
    const sales = makeSalesRows('X', 28);
    const settings = makeSettings({ minStockDays: 7, targetStockDays: 30, factoryOrderDays: 30 });
    const result = buildOzonCoverage(
      baseInput({ stocks, sales, skus, clusters, settings, myStockAvailability: { X: 0 } })
    );

    // То, что показывает экран: recommendedQty по товару (Пункт 35, coverageRows) и orderQty
    // фабрики (recommendations.factories) — воспроизведены тем же способом, что в OzonStocksTab.
    const article = result.articles.find((a) => a.article === 'X')!;
    const screenRecommendedQty = article.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.qty : 0), 0);
    const screenFactoryQty = article.factory && article.factory.orderQty > 0 ? article.factory.orderQty : 0;

    const summary = summarizeSettingsImpact(result, (a) => (a === 'X' ? 15 : 0));
    expect(summary.supplyPcs).toBe(screenRecommendedQty);
    expect(summary.factoryPcs).toBe(screenFactoryQty);
    expect(summary.factoryRub).toBe(screenFactoryQty * 15);
  });

  it('kit components: the summary counts the component\'s own factory signal, matching componentRows on screen', () => {
    const kits: KitItem[] = [{ kitSku: 'KIT', type: 'virtual', components: [{ componentSku: 'COMP', quantity: 2 }] }];
    const skus: SKUItem[] = [makeSku({ sku: 'COMP', pcsPerBox: 1, leadTimeDays: 10 })];
    const stocks: OzonStockRow[] = [makeStockRow('KIT', 1, { clusterId: '1', clusterName: 'Москва' })];
    const clusters = [{ clusterId: '1', clusterName: 'Москва' }];
    const sales = makeSalesRows('KIT', 28);
    const settings = makeSettings({ minStockDays: 7, targetStockDays: 30, factoryOrderDays: 30 });
    const result = buildOzonCoverage(
      baseInput({ stocks, sales, skus, clusters, kits, settings, myStockAvailability: { COMP: 0 } })
    );

    const comp = result.components.find((c) => c.component === 'COMP')!;
    const screenComponentFactoryQty = comp.factory && comp.factory.orderQty > 0 ? comp.factory.orderQty : 0;
    expect(screenComponentFactoryQty).toBeGreaterThan(0); // sanity: the fixture actually triggers a signal

    const summary = summarizeSettingsImpact(result, () => 0);
    expect(summary.factoryPcs).toBe(screenComponentFactoryQty);
    expect(summary.noPriceArticles).toEqual(['COMP']);
  });
});

// ---------------------------------------------------------------------------
// Monotonic sanity on generated fixtures
// ---------------------------------------------------------------------------

describe('summarizeSettingsImpact: monotonic sanity (200 generated fixtures)', () => {
  it('raising factoryOrderDays never lowers factoryPcs (calcFactorySignal.orderQty is non-decreasing in it)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const perDay = 1 + (seed % 5);
      const available = seed % 30;
      const skus: SKUItem[] = [makeSku({ sku: 'A', pcsPerBox: 1 + (seed % 4), leadTimeDays: seed % 20 })];
      const stocks: OzonStockRow[] = [makeStockRow('A', available)];
      const sales = makeSalesRows('A', perDay * 7);
      const lowSettings = makeSettings({ factoryOrderDays: seed % 10 });
      const highSettings = makeSettings({ factoryOrderDays: (seed % 10) + 40 });

      const low = buildOzonCoverage(baseInput({ stocks, sales, skus, settings: lowSettings, myStockAvailability: { A: 0 } }));
      const high = buildOzonCoverage(baseInput({ stocks, sales, skus, settings: highSettings, myStockAvailability: { A: 0 } }));

      const lowSummary = summarizeSettingsImpact(low, () => 0);
      const highSummary = summarizeSettingsImpact(high, () => 0);
      expect(highSummary.factoryPcs, `seed ${seed}`).toBeGreaterThanOrEqual(lowSummary.factoryPcs);
    }
  });

  it('raising targetStockDays never lowers supplyPcs (calcSupplyRecommendation.qty = min(wantQty, stock), wantQty non-decreasing)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const perDay = 1 + (seed % 5);
      const stockAvail = 50 + (seed % 20);
      const skus: SKUItem[] = [makeSku({ sku: 'A', pcsPerBox: 1 + (seed % 4), leadTimeDays: seed % 15 })];
      const stocks: OzonStockRow[] = [makeStockRow('A', seed % 10, { clusterId: '1', clusterName: 'Москва' })];
      const clusters = [{ clusterId: '1', clusterName: 'Москва' }];
      const sales = makeSalesRows('A', perDay * 7);
      const lowSettings = makeSettings({ targetStockDays: 5 + (seed % 10) });
      const highSettings = makeSettings({ targetStockDays: 5 + (seed % 10) + 30 });

      const low = buildOzonCoverage(
        baseInput({ stocks, sales, skus, clusters, settings: lowSettings, myStockAvailability: { A: stockAvail } })
      );
      const high = buildOzonCoverage(
        baseInput({ stocks, sales, skus, clusters, settings: highSettings, myStockAvailability: { A: stockAvail } })
      );

      const lowSummary = summarizeSettingsImpact(low, () => 0);
      const highSummary = summarizeSettingsImpact(high, () => 0);
      expect(highSummary.supplyPcs, `seed ${seed}`).toBeGreaterThanOrEqual(lowSummary.supplyPcs);
    }
  });
});

// ---------------------------------------------------------------------------
// Display: the modal's «Что изменится после сохранения» block
// ---------------------------------------------------------------------------

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const setStoreUserForRender = (
  user: { username: string; role: string } | null,
  ozonSettings?: OzonCoverageSettings
) => {
  Object.assign(useWarehouseStore.getInitialState(), {
    currentUser: user,
    ...(ozonSettings ? { ozonSettings } : {}),
  });
};

// Matches the WINDOW-KEY subset of VALID_FORM below exactly — used to test the «form equals the
// loaded settings» branch without depending on the store's own (partly unset) defaults.
const MATCHING_OZON_SETTINGS: OzonCoverageSettings = {
  speedWeeks: 4, minStockDays: 7, targetStockDays: 30, deliveryToOzonDays: 7, maxClusterDays: 100,
  factoryOrderDays: 60, returnsToSalePct: 80, excludedClusters: '', priorityClusters: '',
  trendWeeks: 13, salesGrowthPct: 0, demandGrowthPct: 30,
};

const VALID_FORM: any = {
  speedWeeks: 4, minStockDays: 7, targetStockDays: 30, deliveryToOzonDays: 7, maxClusterDays: 100,
  factoryOrderDays: 60, returnsToSalePct: 80, salesRetentionWeeks: 78, trendWeeks: 13,
  salesGrowthPct: 0, demandGrowthPct: 30, turnoverPeriodDays: 90, turnoverSlowDays: 45,
  turnoverFastDays: 20, gmroiGreenPct: 100, gmroiRedPct: 30, maxBoxesPerCluster: 30,
  excludedClusters: '', priorityClusters: '', dropOffWarehouseId: '', dropOffWarehouseName: '',
  dropOffWarehouseType: '', directClusters: '',
};

describe('OzonSettingsModal: «Что изменится после сохранения» (item 87 step 4)', () => {
  // The store's ozonSettings is mutated in place for some cases (renderToStaticMarkup renders
  // from `getInitialState()`, not `getState()` — see ozonSettingsWindow.test.ts) — restored after
  // every test so a later `describe` never inherits it.
  const originalOzonSettings = { ...useWarehouseStore.getInitialState().ozonSettings };
  afterEach(() => setStoreUserForRender(null, originalOzonSettings as OzonCoverageSettings));

  it('no computeImpact prop — no block at all', () => {
    setStoreUserForRender({ username: 'boss', role: 'admin' });
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, { isOpen: true, onClose: () => {}, openBlocks: [], initialForm: VALID_FORM })
    );
    expect(html).not.toContain('Что изменится после сохранения');
  });

  it('valid form, form differs from the store\'s loaded ozonSettings — shows the four labels, «было → станет» and «Без цены»', () => {
    setStoreUserForRender({ username: 'boss', role: 'admin' });
    // The stub answers differently depending on which settings it is called with, so «было» and
    // «станет» are distinguishable in the rendered HTML.
    const stub = (settings: OzonCoverageSettings): OzonSettingsImpact =>
      settings.factoryOrderDays === 60
        ? { factoryPcs: 10, factoryRub: 1500.5, factoryArticles: 2, supplyPcs: 40, noPriceArticles: [] }
        : { factoryPcs: 25, factoryRub: 3200, factoryArticles: 4, supplyPcs: 90, noPriceArticles: ['NOPRICE-A'] };
    const formWithDifferentMinStock = { ...VALID_FORM, factoryOrderDays: 90 };
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, {
        isOpen: true,
        onClose: () => {},
        openBlocks: [],
        initialForm: formWithDifferentMinStock,
        computeImpact: stub,
      })
    );
    expect(html).toContain('Что изменится после сохранения');
    expect(html).toContain('Заказ на фабрике, шт');
    expect(html).toContain('Заказ на фабрике, ₽');
    expect(html).toContain('Товаров с сигналом заказа на фабрике');
    expect(html).toContain('Поставка в кластеры, шт');
    // ru-RU formatting: thousands space + «₽», was = stub(store settings, minStockDays 7).
    expect(html).toContain('10 → 25');
    expect(html).toMatch(/1\s500,50\s₽\s→\s3\s200,00\s₽/);
    expect(html).toContain('2 → 4');
    expect(html).toContain('40 → 90');
    expect(html).toContain('Без цены: NOPRICE-A');
  });

  it('form equals the loaded (store) settings — shows current figures only with «изменений нет», no arrow', () => {
    // The store's ozonSettings is set to exactly the window-key subset of VALID_FORM, so the
    // two agree without depending on the store's own (partly unset) defaults.
    setStoreUserForRender({ username: 'boss', role: 'admin' }, MATCHING_OZON_SETTINGS);
    const stub = (): OzonSettingsImpact => ({ factoryPcs: 5, factoryRub: 100, factoryArticles: 1, supplyPcs: 20, noPriceArticles: [] });
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, { isOpen: true, onClose: () => {}, openBlocks: [], initialForm: VALID_FORM, computeImpact: stub })
    );
    expect(html).toContain('изменений нет');
    expect(html).not.toContain('→');
  });

  it('invalid form — shows the placeholder instead of any figure', () => {
    setStoreUserForRender({ username: 'boss', role: 'admin' });
    const stub = (): OzonSettingsImpact => ({ factoryPcs: 5, factoryRub: 100, factoryArticles: 1, supplyPcs: 20, noPriceArticles: [] });
    const invalidForm = { ...VALID_FORM, maxBoxesPerCluster: 0 };
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, { isOpen: true, onClose: () => {}, openBlocks: [], initialForm: invalidForm, computeImpact: stub })
    );
    expect(html).toContain('Исправьте поля — сводка появится');
    expect(html).not.toContain('→');
  });
});

// ---------------------------------------------------------------------------
// Source check: OzonStocksTab's own coverage memo and the modal's impact both go through the
// SAME buildOzonCoverage call — no second hand-written one with different inputs.
// ---------------------------------------------------------------------------

describe('OzonStocksTab: coverage memo and settings-modal impact go through the same runCoverage', () => {
  it('runCoverage is the ONLY buildOzonCoverage caller used by `coverage` and `computeImpact`; the pre-existing wideCoverage (item 85, unrelated to item 87) is the only other call site', () => {
    const src = read('src/components/OzonStocksTab.tsx');
    const calls = src.match(/buildOzonCoverage\(\{/g) || [];
    // 1: inside runCoverage itself. 1: wideCoverage's own «Распределить весь остаток» memo,
    // pre-dating this item and out of scope — it recomputes with `speedWeeks: wideWeeks` for a
    // handful of manually-toggled articles and is untouched here.
    expect(calls.length).toBe(2);
    expect(src).toContain('const runCoverage = React.useCallback((settings: OzonCoverageSettings)');
    // The main `coverage` memo and the modal's `computeSettingsImpact` both call runCoverage —
    // neither has its own hand-written buildOzonCoverage call.
    expect(src).toMatch(/const coverage = useMemo<OzonCoverageResult \| null>\(\(\) => \{[\s\S]*?runCoverage\(ozonSettings\)/);
    expect(src).toMatch(/const computeSettingsImpact = React\.useCallback\(\(settings: OzonCoverageSettings\)[\s\S]*?runCoverage\(settings\)/);
    expect(src).toContain('computeImpact={computeSettingsImpact}');
  });
});
