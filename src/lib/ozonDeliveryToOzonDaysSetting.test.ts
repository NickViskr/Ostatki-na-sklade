import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Item 86, step C (owner, 26.09.2026): «Срок доставки до Ozon, дней» — new setting
 * `deliveryToOzonDays`, default 7. The formula tests live in `ozonCoverage.test.ts` and
 * `ozonCoverageTone.test.ts`; this file is a source guard (same technique as the anchored checks
 * in `ozonCoverageTone.test.ts`) proving the setting is actually WIRED into the screens the
 * owner reads money-critical numbers from — no jsdom/RTL is set up in this repo (`vitest.config.ts`
 * matches only `src/**\/*.test.ts`, environment 'node'), so a rendered-DOM test is not available;
 * these anchors are the established substitute (see `ozonCoverageTone.test.ts`'s last `it`).
 */

const storeSrc = fs.readFileSync(path.join(process.cwd(), 'src/store/useWarehouseStore.ts'), 'utf8');
const modalSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonSettingsModal.tsx'), 'utf8');
const tabSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');

describe('useWarehouseStore: deliveryToOzonDays mapped from the raw sheet with default 7', () => {
  it('the initial store default is 7', () => {
    expect(storeSrc).toMatch(/deliveryToOzonDays:\s*7,/);
  });

  it('the load from getOzonInitialData clamps to non-negative, default 7', () => {
    expect(storeSrc).toContain("deliveryToOzonDays: numNonNeg(s.deliveryToOzonDays, 7),");
  });
});

describe('OzonSettingsModal: the field is rendered next to the target stock field with a hint', () => {
  // Item 87 step 2 moved the field table (label/hint/help, load and save conversions) out of
  // the modal into src/lib/ozonSettingsFields.ts — these anchors now scan that file instead.
  const fieldsSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/ozonSettingsFields.ts'), 'utf8');

  it('the form carries deliveryToOzonDays through load, state and save', () => {
    expect(fieldsSrc).toContain('deliveryToOzonDays: number;');
    expect(modalSrc).toContain('deliveryToOzonDays: numSetting(res.data.deliveryToOzonDays, 7),');
    expect(fieldsSrc).toContain('deliveryToOzonDays: Math.max(0, parseFloat(String(form.deliveryToOzonDays)) || 0),');
  });

  it('renders the Russian label «Срок доставки до Ozon, дней» right after the target stock field, with a hint', () => {
    const targetIdx = fieldsSrc.indexOf('Целевой запас в кластере, дней');
    const deliveryIdx = fieldsSrc.indexOf('Срок доставки до Ozon, дней', targetIdx);
    const maxClusterIdx = fieldsSrc.indexOf('Потолок запаса в кластере после поставки, дней');
    expect(targetIdx).toBeGreaterThan(-1);
    expect(deliveryIdx).toBeGreaterThan(targetIdx);
    expect(deliveryIdx).toBeLessThan(maxClusterIdx);
    // The hint mentions both directions of change, as the owner asked.
    const hintStart = fieldsSrc.indexOf('hint:', deliveryIdx);
    const hintBlock = fieldsSrc.slice(deliveryIdx, hintStart + 200);
    expect(hintBlock).toContain('крупнее и раньше');
    expect(hintBlock).toContain('меньше — наоборот');
  });
});

describe('OzonStocksTab: coverageTone and the factory threshold both see deliveryToOzonDays', () => {
  it('coverageTone is still called with the whole ozonSettings object at both levels (D rides along)', () => {
    expect(tabSrc).toContain('TONE_CLASS[coverageTone(art.totalEstimated, art.perDay, ozonSettings)]');
    expect(tabSrc).toContain('TONE_CLASS[coverageTone(cls.estimated, cls.perDay, ozonSettings, cls.priorityK, cls.excluded)]');
  });

  it('the article-level and component-level factory thresholds add deliveryToOzonDays', () => {
    expect(tabSrc).toContain(
      "factoryThreshold: (Number(art.leadTimeDays) || 0) + (Number(ozonSettings.deliveryToOzonDays) || 0) + ozonSettings.minStockDays,"
    );
    expect(tabSrc).toContain(
      "const threshold = (Number(c.leadTimeDays) || 0) + (Number(ozonSettings.deliveryToOzonDays) || 0) + ozonSettings.minStockDays;"
    );
  });
});
