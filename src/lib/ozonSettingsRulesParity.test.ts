/**
 * Item 87 step 3: the window must refuse a dangerous settings value with the SAME rules the
 * server enforces (Code.gs `validateOzonSettingsRules`). This file proves the TS port
 * (`validateOzonSettingsRulesTs`) agrees with the real GS function loaded from Code.gs on the
 * Apps Script stand — same keys, same messages, same order — plus the field-name map parity and
 * the two settings sets the window must accept without a single error.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import {
  OZON_SETTINGS_RULE_FIELD_NAMES,
  OZON_RECOMMENDED_SETTINGS,
  validateOzonSettingsRulesTs,
  validateOzonSettingsForm,
  type OzonSettingsForm,
  type OzonSettingsFormNumeric,
} from './ozonSettingsFields';

const require = createRequire(import.meta.url);
const freshStand = () => {
  const p = require.resolve('../../tests/apps-script/harness.cjs');
  delete require.cache[p];
  return require('../../tests/apps-script/harness.cjs');
};
const stand = freshStand();

// ---------------------------------------------------------------------------
// Field-name map parity
// ---------------------------------------------------------------------------

describe('OZON_SETTINGS_RULE_FIELD_NAMES equals Code.gs OZON_SETTINGS_FIELD_NAMES exactly', () => {
  it('same keys, same Russian text', () => {
    expect(OZON_SETTINGS_RULE_FIELD_NAMES).toEqual(stand.OZON_SETTINGS_FIELD_NAMES);
  });
});

// ---------------------------------------------------------------------------
// Rule parity: generated settings objects around every boundary
// ---------------------------------------------------------------------------

const RULE_KEYS: (keyof OzonSettingsFormNumeric)[] = [
  'speedWeeks', 'trendWeeks', 'targetStockDays', 'minStockDays', 'maxClusterDays',
  'deliveryToOzonDays', 'salesRetentionWeeks', 'returnsToSalePct', 'turnoverSlowDays',
  'turnoverFastDays', 'gmroiGreenPct', 'gmroiRedPct', 'maxBoxesPerCluster',
];

// Values clustered around every boundary the 10 rules check: equal, ±1, 0, and the specific
// thresholds 60/61 (deliveryToOzonDays), 26/27 (salesRetentionWeeks), 100/101 (returnsToSalePct),
// plus negatives and fractions.
const BOUNDARY_VALUES = [
  -5, -1, -0.5, 0, 0.5, 1, 2, 3, 4, 5, 7, 8, 10, 13, 19, 20, 21, 26, 27, 28, 29, 30, 31, 44, 45, 46,
  59, 60, 61, 62, 79, 80, 81, 99, 100, 101, 200,
];

function rndFactory(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function generateMerged(seed: number): Partial<Record<keyof OzonSettingsFormNumeric, number>> {
  const rnd = rndFactory(seed + 1);
  const merged: Partial<Record<keyof OzonSettingsFormNumeric, number>> = {};
  for (const key of RULE_KEYS) {
    // ~10% of the time the key is omitted entirely, exercising the `!== undefined` skips.
    if (rnd() < 0.1) continue;
    merged[key] = BOUNDARY_VALUES[Math.floor(rnd() * BOUNDARY_VALUES.length)];
  }
  return merged;
}

describe('validateOzonSettingsRulesTs matches Code.gs validateOzonSettingsRules', () => {
  it('2000 generated settings objects around every boundary produce identical keys and messages, in order', () => {
    for (let seed = 0; seed < 2000; seed++) {
      const merged = generateMerged(seed);
      const ts = validateOzonSettingsRulesTs(merged);
      const gs = stand.validateOzonSettingsRules(merged);
      expect(ts, `seed ${seed}: ${JSON.stringify(merged)}`).toEqual(gs);
    }
  });

  // Explicit boundary cases for each of the 10 rules, checked on both sides.
  const CASES: { name: string; merged: Partial<Record<keyof OzonSettingsFormNumeric, number>> }[] = [
    { name: 'speedWeeks fractional', merged: { speedWeeks: 2.5 } },
    { name: 'speedWeeks zero', merged: { speedWeeks: 0 } },
    { name: 'speedWeeks exactly 1 (valid)', merged: { speedWeeks: 1 } },
    { name: 'trendWeeks one below speedWeeks', merged: { speedWeeks: 8, trendWeeks: 7 } },
    { name: 'trendWeeks equal speedWeeks (valid)', merged: { speedWeeks: 8, trendWeeks: 8 } },
    { name: 'targetStockDays one below minStockDays', merged: { minStockDays: 10, targetStockDays: 9 } },
    { name: 'targetStockDays equal minStockDays (valid)', merged: { minStockDays: 10, targetStockDays: 10 } },
    { name: 'maxClusterDays zero is allowed (off)', merged: { targetStockDays: 20, maxClusterDays: 0 } },
    { name: 'maxClusterDays below targetStockDays and nonzero', merged: { targetStockDays: 20, maxClusterDays: 19 } },
    { name: 'maxClusterDays equal targetStockDays (valid)', merged: { targetStockDays: 20, maxClusterDays: 20 } },
    { name: 'deliveryToOzonDays negative', merged: { deliveryToOzonDays: -1 } },
    { name: 'deliveryToOzonDays 60 (valid)', merged: { deliveryToOzonDays: 60 } },
    { name: 'deliveryToOzonDays 61 (invalid)', merged: { deliveryToOzonDays: 61 } },
    { name: 'salesRetentionWeeks 26 (invalid)', merged: { salesRetentionWeeks: 26 } },
    { name: 'salesRetentionWeeks 27 (valid)', merged: { salesRetentionWeeks: 27 } },
    { name: 'salesRetentionWeeks fractional', merged: { salesRetentionWeeks: 27.5 } },
    { name: 'returnsToSalePct negative', merged: { returnsToSalePct: -1 } },
    { name: 'returnsToSalePct 100 (valid)', merged: { returnsToSalePct: 100 } },
    { name: 'returnsToSalePct 101 (invalid)', merged: { returnsToSalePct: 101 } },
    { name: 'turnoverSlowDays equal turnoverFastDays', merged: { turnoverSlowDays: 20, turnoverFastDays: 20 } },
    { name: 'turnoverSlowDays one above turnoverFastDays (valid)', merged: { turnoverSlowDays: 21, turnoverFastDays: 20 } },
    { name: 'gmroiGreenPct equal gmroiRedPct', merged: { gmroiGreenPct: 30, gmroiRedPct: 30 } },
    { name: 'gmroiGreenPct one above gmroiRedPct (valid)', merged: { gmroiGreenPct: 31, gmroiRedPct: 30 } },
    { name: 'maxBoxesPerCluster zero', merged: { maxBoxesPerCluster: 0 } },
    { name: 'maxBoxesPerCluster fractional', merged: { maxBoxesPerCluster: 1.5 } },
    { name: 'maxBoxesPerCluster exactly 1 (valid)', merged: { maxBoxesPerCluster: 1 } },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const ts = validateOzonSettingsRulesTs(c.merged);
      const gs = stand.validateOzonSettingsRules(c.merged);
      expect(ts).toEqual(gs);
    });
  }
});

// ---------------------------------------------------------------------------
// Known-good settings sets: no errors on either side
// ---------------------------------------------------------------------------

describe('OZON_RECOMMENDED_SETTINGS and the owner\'s current live settings produce no errors', () => {
  it('OZON_RECOMMENDED_SETTINGS', () => {
    expect(validateOzonSettingsRulesTs(OZON_RECOMMENDED_SETTINGS)).toEqual([]);
    expect(stand.validateOzonSettingsRules(OZON_RECOMMENDED_SETTINGS)).toEqual([]);
  });

  it('the owner\'s current live set (2026-09-26)', () => {
    const live = {
      speedWeeks: 2, trendWeeks: 8, minStockDays: 10, targetStockDays: 20, deliveryToOzonDays: 7,
      maxClusterDays: 60, maxBoxesPerCluster: 30, returnsToSalePct: 95, factoryOrderDays: 30,
      turnoverPeriodDays: 90, turnoverSlowDays: 60, turnoverFastDays: 20, gmroiGreenPct: 80,
      gmroiRedPct: 30, salesRetentionWeeks: 78, demandGrowthPct: 30, salesGrowthPct: 0,
    };
    expect(validateOzonSettingsRulesTs(live)).toEqual([]);
    expect(stand.validateOzonSettingsRules(live)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateOzonSettingsForm: the window-only per-field checks on top of the ported rules
// ---------------------------------------------------------------------------

const VALID_FORM: OzonSettingsForm = {
  speedWeeks: 4, minStockDays: 7, targetStockDays: 30, deliveryToOzonDays: 7, maxClusterDays: 100,
  factoryOrderDays: 60, returnsToSalePct: 80, salesRetentionWeeks: 78, trendWeeks: 13,
  salesGrowthPct: 0, demandGrowthPct: 30, turnoverPeriodDays: 90, turnoverSlowDays: 45,
  turnoverFastDays: 20, gmroiGreenPct: 100, gmroiRedPct: 30, maxBoxesPerCluster: 30,
  excludedClusters: '', priorityClusters: '', dropOffWarehouseId: '', dropOffWarehouseName: '',
  dropOffWarehouseType: '', directClusters: '',
};

describe('validateOzonSettingsForm: window-only per-field checks', () => {
  it('a fully valid form has no errors', () => {
    expect(validateOzonSettingsForm(VALID_FORM)).toEqual([]);
  });

  it('maxBoxesPerCluster 0 is red, not silently clamped to 1', () => {
    const form = { ...VALID_FORM, maxBoxesPerCluster: 0 };
    const errors = validateOzonSettingsForm(form);
    expect(errors.some((e) => e.key === 'maxBoxesPerCluster')).toBe(true);
  });

  it('an integer-only field with a fractional value is red (turnoverPeriodDays)', () => {
    const form = { ...VALID_FORM, turnoverPeriodDays: 90.5 };
    const errors = validateOzonSettingsForm(form);
    expect(errors.some((e) => e.key === 'turnoverPeriodDays')).toBe(true);
  });

  it('a negative value on a min-0 field is red (minStockDays)', () => {
    const form = { ...VALID_FORM, minStockDays: -1 };
    const errors = validateOzonSettingsForm(form);
    expect(errors.some((e) => e.key === 'minStockDays')).toBe(true);
  });

  it('a NaN value is red', () => {
    const form = { ...VALID_FORM, deliveryToOzonDays: NaN };
    const errors = validateOzonSettingsForm(form);
    expect(errors.some((e) => e.key === 'deliveryToOzonDays')).toBe(true);
  });

  it('returnsToSalePct above its max (100) is red', () => {
    const form = { ...VALID_FORM, returnsToSalePct: 150 };
    const errors = validateOzonSettingsForm(form);
    expect(errors.some((e) => e.key === 'returnsToSalePct')).toBe(true);
  });

  it('a per-field error suppresses the duplicate cross-field rule error for the same key', () => {
    // maxBoxesPerCluster fails its own >=1/integer check; the server rule for the same key
    // would also fire on 0 — only one message for the field is expected from the window.
    const form = { ...VALID_FORM, maxBoxesPerCluster: 0 };
    const errors = validateOzonSettingsForm(form);
    expect(errors.filter((e) => e.key === 'maxBoxesPerCluster').length).toBe(1);
  });

  it('a cross-field rule still fires when both fields individually pass their own checks (targetStockDays < minStockDays)', () => {
    const form = { ...VALID_FORM, minStockDays: 20, targetStockDays: 10 };
    const errors = validateOzonSettingsForm(form);
    expect(errors.some((e) => e.key === 'targetStockDays')).toBe(true);
  });
});
