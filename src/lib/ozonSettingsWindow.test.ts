import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canEditOzonSettings,
  OZON_SETTINGS_BLOCKS,
  OZON_SETTINGS_FIELDS,
  OZON_RECOMMENDED_SETTINGS,
  applyRecommended,
  buildOzonSettingsPayload,
  type OzonSettingsForm,
  type OzonSettingsFormNumeric,
} from './ozonSettingsFields';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { OzonSettingsModal } from '../components/OzonSettingsModal';

/**
 * Item 87 step 2: reworked «Настройки Ozon» window — collapsible blocks, plain names, one
 * hint line per field, a role gate and a «Вернуть к рекомендованным значениям» button.
 * No @testing-library in this repo (vitest.config.ts matches only `src/**\/*.test.ts`,
 * environment 'node'); rendering is done with `react-dom/server`'s renderToStaticMarkup,
 * which needs no DOM. JSX is not used because this file is `.ts`, not `.tsx` — plain
 * `createElement` calls instead.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// ---------------------------------------------------------------------------
// canEditOzonSettings
// ---------------------------------------------------------------------------

describe('canEditOzonSettings: role only, username is ignored', () => {
  it('admin roles pass regardless of case/whitespace', () => {
    expect(canEditOzonSettings({ role: 'admin' })).toBe(true);
    expect(canEditOzonSettings({ role: 'Admin' })).toBe(true);
    expect(canEditOzonSettings({ role: ' администратор ' })).toBe(true);
  });

  it('non-admin roles, missing users and agent-like roles fail', () => {
    expect(canEditOzonSettings({ role: 'user' })).toBe(false);
    expect(canEditOzonSettings({ role: '' })).toBe(false);
    expect(canEditOzonSettings(undefined)).toBe(false);
    expect(canEditOzonSettings(null)).toBe(false);
    for (const role of ['agent', 'manager', 'viewer', 'bot']) {
      expect(canEditOzonSettings({ role })).toBe(false);
    }
  });

  it('a matching username does not substitute for the role', () => {
    expect(canEditOzonSettings({ username: 'admin', role: 'user' })).toBe(false);
    expect(canEditOzonSettings({ username: 'администратор', role: '' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Callers: the button is gated, openBlocks is wired correctly
// ---------------------------------------------------------------------------

describe('OzonStocksTab and TurnoverTab: the settings button is role-gated', () => {
  it('OzonStocksTab shows the button only to canEditOzonSettings and opens supply+factory', () => {
    const src = read('src/components/OzonStocksTab.tsx');
    expect(src).toContain("import { canEditOzonSettings } from '../lib/ozonSettingsFields';");
    expect(src).toMatch(/\{canEditOzonSettings\(currentUser\) && \([\s\S]*id="btn-ozon-settings"/);
    expect(src).toContain("openBlocks={['supply', 'factory']}");
  });

  it('TurnoverTab shows the button only to canEditOzonSettings and opens turnover', () => {
    const src = read('src/components/TurnoverTab.tsx');
    expect(src).toContain("import { canEditOzonSettings } from '../lib/ozonSettingsFields';");
    expect(src).toMatch(/\{canEditOzonSettings\(currentUser\) && \([\s\S]*Пороги/);
    expect(src).toContain("openBlocks={['turnover']}");
  });
});

// ---------------------------------------------------------------------------
// buildOzonSettingsPayload
// ---------------------------------------------------------------------------

/**
 * The pre-step-2 payload conversion, copied verbatim from OzonSettingsModal.tsx (lines
 * 383-411 before this step) as the reference to prove nothing but the four item-42 fields
 * moved.
 */
function oldBuildPayload(form: any) {
  return {
    speedWeeks: Math.max(1, parseInt(String(form.speedWeeks), 10) || 1),
    minStockDays: Math.max(0, parseFloat(String(form.minStockDays)) || 0),
    targetStockDays: Math.max(0, parseFloat(String(form.targetStockDays)) || 0),
    deliveryToOzonDays: Math.max(0, parseFloat(String(form.deliveryToOzonDays)) || 0),
    maxClusterDays: Math.max(0, parseFloat(String(form.maxClusterDays)) || 0),
    factoryOrderDays: Math.max(0, parseFloat(String(form.factoryOrderDays)) || 0),
    returnsToSalePct: Math.min(100, Math.max(0, parseFloat(String(form.returnsToSalePct)) || 0)),
    salesRetentionWeeks: Math.max(1, parseInt(String(form.salesRetentionWeeks), 10) || 1),
    deficitDays: Math.max(0, parseFloat(String(form.deficitDays)) || 0),
    trendWeeks: Math.max(1, parseInt(String(form.trendWeeks), 10) || 1),
    bestWeeks: Math.max(1, parseInt(String(form.bestWeeks), 10) || 1),
    minSalesForCorrection: Math.max(0, parseFloat(String(form.minSalesForCorrection)) || 0),
    maxSpeedGrowth: Math.max(0, parseFloat(String(form.maxSpeedGrowth)) || 0),
    salesGrowthPct: Math.max(0, parseFloat(String(form.salesGrowthPct)) || 0),
    demandGrowthPct: Math.max(0, parseFloat(String(form.demandGrowthPct)) || 0),
    turnoverPeriodDays: Math.max(1, parseInt(String(form.turnoverPeriodDays), 10) || 1),
    turnoverSlowDays: Math.max(0, parseFloat(String(form.turnoverSlowDays)) || 0),
    turnoverFastDays: Math.max(0, parseFloat(String(form.turnoverFastDays)) || 0),
    gmroiGreenPct: parseFloat(String(form.gmroiGreenPct)) || 0,
    gmroiRedPct: parseFloat(String(form.gmroiRedPct)) || 0,
    excludedClusters: form.excludedClusters,
    priorityClusters: form.priorityClusters,
    maxBoxesPerCluster: Math.max(1, parseInt(String(form.maxBoxesPerCluster), 10) || 1),
    dropOffWarehouseId: form.dropOffWarehouseId,
    dropOffWarehouseName: form.dropOffWarehouseName,
    dropOffWarehouseType: form.dropOffWarehouseType,
    directClusters: form.directClusters,
  };
}

const REMOVED_ITEM42_KEYS = ['deficitDays', 'bestWeeks', 'minSalesForCorrection', 'maxSpeedGrowth'];

const NUMERIC_KEYS_FOR_GENERATOR = [
  'speedWeeks', 'minStockDays', 'targetStockDays', 'deliveryToOzonDays', 'maxClusterDays',
  'factoryOrderDays', 'returnsToSalePct', 'salesRetentionWeeks', 'deficitDays', 'trendWeeks',
  'bestWeeks', 'minSalesForCorrection', 'maxSpeedGrowth', 'salesGrowthPct', 'demandGrowthPct',
  'turnoverPeriodDays', 'turnoverSlowDays', 'turnoverFastDays', 'gmroiGreenPct', 'gmroiRedPct',
  'maxBoxesPerCluster',
];
const TEXT_KEYS_FOR_GENERATOR = [
  'excludedClusters', 'priorityClusters', 'dropOffWarehouseId', 'dropOffWarehouseName',
  'dropOffWarehouseType', 'directClusters',
];

function randomNumericRaw(i: number): number | string {
  const variants = [0, -5, 3.5, '', '12', '7.25', 'not-a-number', -0.1, 999, '0'];
  return variants[i % variants.length] as number | string;
}

function generateForm(seed: number): any {
  const form: any = {};
  NUMERIC_KEYS_FOR_GENERATOR.forEach((key, i) => {
    form[key] = randomNumericRaw(seed + i);
  });
  TEXT_KEYS_FOR_GENERATOR.forEach((key, i) => {
    form[key] = `${key}-${(seed + i) % 7}`;
  });
  return form;
}

describe('buildOzonSettingsPayload: identical to the old conversion minus the four item-42 keys', () => {
  it('the key set equals the old key set minus exactly deficitDays, bestWeeks, minSalesForCorrection, maxSpeedGrowth', () => {
    const form = generateForm(1);
    const oldKeys = Object.keys(oldBuildPayload(form)).sort();
    const newKeys = Object.keys(buildOzonSettingsPayload(form)).sort();
    const expectedKeys = oldKeys.filter((k) => !REMOVED_ITEM42_KEYS.includes(k)).sort();
    expect(newKeys).toEqual(expectedKeys);
    for (const removed of REMOVED_ITEM42_KEYS) {
      expect(newKeys).not.toContain(removed);
    }
  });

  it('every remaining key matches the old conversion for ~200 generated forms', () => {
    for (let seed = 0; seed < 200; seed++) {
      const form = generateForm(seed);
      const oldPayload: any = oldBuildPayload(form);
      const newPayload: any = buildOzonSettingsPayload(form);
      for (const key of Object.keys(newPayload)) {
        expect(newPayload[key], `seed ${seed}, key ${key}`).toEqual(oldPayload[key]);
      }
      for (const removed of REMOVED_ITEM42_KEYS) {
        expect(newPayload[removed]).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Field table
// ---------------------------------------------------------------------------

const EXPECTED_FIELDS: Record<string, { block: string; label: string; hint: string }> = {
  speedWeeks: { block: 'speed', label: 'Окно скорости, недель', hint: 'больше — скорость ровнее, но позже замечает перемены; меньше — быстрее реагирует, но сильнее скачет' },
  trendWeeks: { block: 'speed', label: 'Окно тренда и долей кластеров, недель', hint: 'больше — тренд и доли кластеров устойчивее; меньше — быстрее следуют за последними неделями' },
  demandGrowthPct: { block: 'speed', label: 'Порог резкого роста спроса за 7 дней, %', hint: 'больше — «Спрос вырос» срабатывает реже; меньше — чаще; 0 — выключено' },
  salesGrowthPct: { block: 'speed', label: 'Ручная надбавка к заказу на фабрике, %', hint: 'больше — заказ на фабрике крупнее; 0 — без надбавки' },
  minStockDays: { block: 'supply', label: 'Неснижаемый запас в кластере, дней', hint: 'больше — поставка предлагается раньше; меньше — позже, выше риск пустого кластера' },
  targetStockDays: { block: 'supply', label: 'Целевой запас в кластере, дней', hint: 'больше — поставки крупнее и реже; меньше — мельче и чаще' },
  deliveryToOzonDays: { block: 'supply', label: 'Срок доставки до Ozon, дней', hint: 'больше — поставка и заказ на фабрике крупнее и раньше; меньше — наоборот' },
  maxClusterDays: { block: 'supply', label: 'Потолок запаса в кластере после поставки, дней', hint: 'больше — в кластер можно везти больше; меньше — меньше лишнего запаса; 0 — без потолка' },
  maxBoxesPerCluster: { block: 'supply', label: 'Не больше коробок на кластер в одной заявке', hint: 'больше — реже предупреждение о лишних коробках; меньше — чаще' },
  returnsToSalePct: { block: 'supply', label: 'Возвраты, которые снова идут в продажу, %', hint: 'больше — возвраты сильнее уменьшают поставку; меньше — слабее' },
  factoryOrderDays: { block: 'factory', label: 'Заказ на фабрике — на сколько дней продаж', hint: 'больше — заказ крупнее и реже, больше денег в товаре; меньше — мельче и чаще' },
  turnoverPeriodDays: { block: 'turnover', label: 'Период расчёта, дней', hint: 'больше — показатели ровнее; меньше — ближе к последним неделям' },
  turnoverSlowDays: { block: 'turnover', label: 'Медленный: оборот дольше, дней', hint: 'больше — меньше товаров помечено медленными; меньше — больше' },
  turnoverFastDays: { block: 'turnover', label: 'Лидер: оборот быстрее, дней', hint: 'больше — больше товаров в лидерах; меньше — меньше' },
  gmroiGreenPct: { block: 'turnover', label: 'GMROI (доходность вложений): зелёный от, %', hint: 'больше — зелёных товаров меньше; меньше — больше' },
  gmroiRedPct: { block: 'turnover', label: 'GMROI (доходность вложений): красный ниже, %', hint: 'больше — красных товаров больше; меньше — меньше' },
  salesRetentionWeeks: { block: 'advanced', label: 'Хранить историю продаж, недель', hint: 'больше — длиннее история для сезонности; меньше — таблица легче; не меньше 27' },
};

const NON_NUMERIC_WINDOW_KEYS = [
  'excludedClusters', 'priorityClusters', 'dropOffWarehouseId', 'dropOffWarehouseName',
  'dropOffWarehouseType', 'directClusters',
];

describe('OZON_SETTINGS_FIELDS: every numeric window field once, right block, exact wording', () => {
  it('the table has exactly the expected keys, one entry each', () => {
    const keys = OZON_SETTINGS_FIELDS.map((f) => f.key);
    expect(keys.length).toBe(Object.keys(EXPECTED_FIELDS).length);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(Object.keys(EXPECTED_FIELDS)));
  });

  it('label, hint and block match the plan for every field', () => {
    for (const field of OZON_SETTINGS_FIELDS) {
      const expected = EXPECTED_FIELDS[field.key];
      expect(expected, field.key).toBeDefined();
      expect(field.block).toBe(expected.block);
      expect(field.label).toBe(expected.label);
      expect(field.hint).toBe(expected.hint);
    }
  });

  it('nothing is lost vs. the old window (old keys minus the four item-42 ones)', () => {
    const oldKeys = Object.keys(oldBuildPayload(generateForm(0)));
    const survivingOldKeys = oldKeys.filter((k) => !REMOVED_ITEM42_KEYS.includes(k)).sort();
    const tableAndCustomKeys = [...Object.keys(EXPECTED_FIELDS), ...NON_NUMERIC_WINDOW_KEYS].sort();
    expect(tableAndCustomKeys).toEqual(survivingOldKeys);
  });

  it('every hint is one line and short; every help is non-empty', () => {
    for (const field of OZON_SETTINGS_FIELDS) {
      expect(field.hint, field.key).not.toContain('\n');
      expect(field.hint.length, field.key).toBeLessThanOrEqual(120);
      expect(field.help.trim().length, field.key).toBeGreaterThan(0);
    }
  });

  it('every block id used by the fields is declared in OZON_SETTINGS_BLOCKS', () => {
    const blockIds = new Set(OZON_SETTINGS_BLOCKS.map((b) => b.id));
    for (const field of OZON_SETTINGS_FIELDS) {
      expect(blockIds.has(field.block), field.key).toBe(true);
    }
  });
});

describe('OZON_RECOMMENDED_SETTINGS', () => {
  const EXPECTED_RECOMMENDED: OzonSettingsFormNumeric = {
    speedWeeks: 2, trendWeeks: 8, demandGrowthPct: 30, salesGrowthPct: 0,
    minStockDays: 10, targetStockDays: 20, deliveryToOzonDays: 7, maxClusterDays: 60,
    maxBoxesPerCluster: 30, returnsToSalePct: 95, factoryOrderDays: 30,
    turnoverPeriodDays: 90, turnoverSlowDays: 60, turnoverFastDays: 20,
    gmroiGreenPct: 80, gmroiRedPct: 30, salesRetentionWeeks: 78,
  };

  it('keys equal the numeric field table keys, values exactly as approved 2026-09-26', () => {
    expect(new Set(Object.keys(OZON_RECOMMENDED_SETTINGS))).toEqual(new Set(Object.keys(EXPECTED_FIELDS)));
    expect(OZON_RECOMMENDED_SETTINGS).toEqual(EXPECTED_RECOMMENDED);
  });
});

// ---------------------------------------------------------------------------
// applyRecommended
// ---------------------------------------------------------------------------

describe('applyRecommended: replaces numeric fields only, leaves string fields untouched', () => {
  it('numeric fields become the recommended values; strings pass through', () => {
    const form: OzonSettingsForm = {
      speedWeeks: 99, trendWeeks: 99, demandGrowthPct: 99, salesGrowthPct: 99,
      minStockDays: 99, targetStockDays: 99, deliveryToOzonDays: 99, maxClusterDays: 99,
      maxBoxesPerCluster: 99, returnsToSalePct: 99, factoryOrderDays: 99,
      turnoverPeriodDays: 99, turnoverSlowDays: 99, turnoverFastDays: 99,
      gmroiGreenPct: 99, gmroiRedPct: 99, salesRetentionWeeks: 99,
      excludedClusters: 'cluster-1', priorityClusters: 'cluster-2:1.5',
      dropOffWarehouseId: 'wh-1', dropOffWarehouseName: 'Склад', dropOffWarehouseType: 'FBO',
      directClusters: '[]',
    };
    const next = applyRecommended(form);
    for (const key of Object.keys(OZON_RECOMMENDED_SETTINGS) as (keyof OzonSettingsFormNumeric)[]) {
      expect(next[key]).toBe(OZON_RECOMMENDED_SETTINGS[key]);
    }
    expect(next.excludedClusters).toBe('cluster-1');
    expect(next.priorityClusters).toBe('cluster-2:1.5');
    expect(next.dropOffWarehouseId).toBe('wh-1');
    expect(next.dropOffWarehouseName).toBe('Склад');
    expect(next.dropOffWarehouseType).toBe('FBO');
    expect(next.directClusters).toBe('[]');
  });
});

// ---------------------------------------------------------------------------
// Display: renderToStaticMarkup, no DOM needed
// ---------------------------------------------------------------------------

// Item 87 step 2 discovery: zustand v5's useStore feeds React's useSyncExternalStore a
// `getServerSnapshot` that is `api.getInitialState()` — the object frozen at store creation —
// not the live `getState()`. `renderToStaticMarkup` triggers React's server path, so a plain
// `useWarehouseStore.setState(...)` (which replaces the live state with a NEW object, never
// touching the frozen initial one) is invisible to these renders. Mutating the initial-state
// object in place keeps both the live and the "server" snapshot in sync.
const setStoreUserForRender = (user: { username: string; role: string } | null) => {
  Object.assign(useWarehouseStore.getInitialState(), { currentUser: user });
};

describe('OzonSettingsModal: display via renderToStaticMarkup', () => {
  afterEach(() => {
    setStoreUserForRender(null);
  });

  it('a non-admin user sees nothing, even with isOpen', () => {
    setStoreUserForRender({ username: 'someone', role: 'user' });
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, { isOpen: true, onClose: () => {}, openBlocks: ['speed'] })
    );
    expect(html).toBe('');
  });

  it('an admin sees every block title, label, hint, the auto-poll line and the recommended button, and not the removed item-42 labels', () => {
    setStoreUserForRender({ username: 'boss', role: 'admin' });
    const allBlockIds = OZON_SETTINGS_BLOCKS.map((b) => b.id);
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, { isOpen: true, onClose: () => {}, openBlocks: allBlockIds })
    );
    for (const block of OZON_SETTINGS_BLOCKS) {
      expect(html, block.title).toContain(block.title);
    }
    for (const field of OZON_SETTINGS_FIELDS) {
      expect(html, field.key).toContain(field.label);
      expect(html, field.key).toContain(field.hint);
    }
    expect(html).toContain('Автоопрос: 11:00 и 20:00 МСК');
    expect(html).toContain('Вернуть к рекомендованным значениям');

    for (const removedLabel of ['Порог дефицита', 'Лучших недель', 'Минимум продаж', 'Макс. рост']) {
      expect(html, removedLabel).not.toContain(removedLabel);
    }
  });

  it('openBlocks controls which blocks are rendered: supply+factory show, turnover does not', () => {
    setStoreUserForRender({ username: 'boss', role: 'admin' });
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, { isOpen: true, onClose: () => {}, openBlocks: ['supply', 'factory'] })
    );
    expect(html).toContain('Неснижаемый запас в кластере, дней');
    expect(html).toContain('Заказ на фабрике — на сколько дней продаж');
    expect(html).not.toContain('Период расчёта, дней');
    expect(html).not.toContain('GMROI (доходность вложений)');
  });
});

// ---------------------------------------------------------------------------
// Item 87 step 3: refusing a dangerous value before it is sent
// ---------------------------------------------------------------------------

const VALID_FORM_FOR_RENDER: OzonSettingsForm = {
  speedWeeks: 4, minStockDays: 7, targetStockDays: 30, deliveryToOzonDays: 7, maxClusterDays: 100,
  factoryOrderDays: 60, returnsToSalePct: 80, salesRetentionWeeks: 78, trendWeeks: 13,
  salesGrowthPct: 0, demandGrowthPct: 30, turnoverPeriodDays: 90, turnoverSlowDays: 45,
  turnoverFastDays: 20, gmroiGreenPct: 100, gmroiRedPct: 30, maxBoxesPerCluster: 30,
  excludedClusters: '', priorityClusters: '', dropOffWarehouseId: '', dropOffWarehouseName: '',
  dropOffWarehouseType: '', directClusters: '',
};

describe('OzonSettingsModal: red validation state (item 87 step 3)', () => {
  afterEach(() => {
    setStoreUserForRender(null);
  });

  it('a valid form renders no red message and an enabled Save', () => {
    setStoreUserForRender({ username: 'boss', role: 'admin' });
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, {
        isOpen: true,
        onClose: () => {},
        openBlocks: ['supply'],
        initialForm: VALID_FORM_FOR_RENDER,
      })
    );
    expect(html).not.toContain('Исправьте поля, отмеченные красным');
    expect(html).not.toContain('text-red-600');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Сохранить<\/button>/);
  });

  it('an invalid value (maxBoxesPerCluster 0) renders the exact red message, forces its block open and disables Save', () => {
    setStoreUserForRender({ username: 'boss', role: 'admin' });
    const invalidForm: OzonSettingsForm = { ...VALID_FORM_FOR_RENDER, maxBoxesPerCluster: 0 };
    const html = renderToStaticMarkup(
      createElement(OzonSettingsModal, {
        isOpen: true,
        onClose: () => {},
        openBlocks: [],
        initialForm: invalidForm,
      })
    );
    expect(html).toContain('Заполните поле числом не меньше 1');
    expect(html).toContain('Исправьте поля, отмеченные красным');
    // The «Поставки на Ozon» block holds maxBoxesPerCluster — forced open despite openBlocks: [].
    expect(html).toContain('Не больше коробок на кластер в одной заявке');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить<\/button>/);
  });
});

describe('OzonSettingsModal: handleSave source (item 87 step 3)', () => {
  it('the old strict target>minimum toast is gone, replaced by a hasErrors guard using validateOzonSettingsForm', () => {
    const src = read('src/components/OzonSettingsModal.tsx');
    expect(src).not.toContain('Целевой запас должен быть больше Неснижаемого остатка');
    expect(src).toContain('validateOzonSettingsForm(form)');
    expect(src).toMatch(/if \(hasErrors\) \{[\s\S]*?return;/);
  });
});
