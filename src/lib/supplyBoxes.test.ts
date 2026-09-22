// Item 79c. Boxes and pallets in the wizard's total line.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { supplyBoxTotals } from './supplyBoxes';

describe('supplyBoxTotals', () => {
  const norm = { A: 24, B: 10 };

  it('packs every line into full boxes plus one partial box, then sums the order', () => {
    // A: 250 / 24 = 10 full + 10 pcs → 11; B: 30 / 10 = 3 exactly; A again in another cluster: 24 → 1
    const t = supplyBoxTotals([{ article: 'A', qty: 250 }, { article: 'B', qty: 30 }, { article: 'A', qty: 24 }], norm, 12);
    expect(t.boxes).toBe(15);
    // 15 boxes / 12 per pallet → 2 pallets
    expect(t.pallets).toBe(2);
    expect(t.noNormArticles).toEqual([]);
  });

  it('exact multiples of the pallet norm do not open a new pallet', () => {
    expect(supplyBoxTotals([{ article: 'A', qty: 24 * 12 }], norm, 12).pallets).toBe(1);
    expect(supplyBoxTotals([{ article: 'A', qty: 24 * 12 + 1 }], norm, 12).pallets).toBe(2);
  });

  it('an article without «ШТ/КОР» is named once and adds no boxes; empty lines are skipped', () => {
    const t = supplyBoxTotals(
      [{ article: 'Z', qty: 5 }, { article: 'Z', qty: 7 }, { article: 'A', qty: 0 }, { article: 'Q', qty: 0 }, { article: 'B', qty: 10 }],
      norm,
      12
    );
    expect(t).toEqual({ boxes: 1, pallets: 1, noNormArticles: ['Z'] });
  });

  it('without a pallet norm in «Справочник» the pallets are null, boxes still count', () => {
    expect(supplyBoxTotals([{ article: 'B', qty: 25 }], norm, 0)).toEqual({ boxes: 3, pallets: null, noNormArticles: [] });
    expect(supplyBoxTotals([{ article: 'B', qty: 25 }], norm, NaN).pallets).toBeNull();
  });

  it('an empty order has zero boxes and zero pallets', () => {
    expect(supplyBoxTotals([], norm, 12)).toEqual({ boxes: 0, pallets: 0, noNormArticles: [] });
  });
});

describe('wiring: the wizard prints boxes and pallets in its total line', () => {
  const modal = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonSupplyModal.tsx'), 'utf8');

  it('reads the pallet norm from the settings store and feeds every active line to supplyBoxTotals', () => {
    expect(modal).toContain("import { supplyBoxTotals } from '../lib/supplyBoxes';");
    expect(modal).toContain('useSettingsStore((state) => state.boxesPerPalletGlobal)');
    expect(modal).toMatch(/supplyBoxTotals\(\s*activeRows\.map\(\(r\) => \(\{ article: r\.article, qty: getQty\(r\) \}\)\),\s*pcsPerBoxMap,\s*boxesPerPalletGlobal\s*\)/);
  });

  it('the total line names boxes, pallets and the norm, and tells when the norm is missing', () => {
    expect(modal).toMatch(/Итого: \{totals\.rows\} строк, \{totals\.clusters\} кластеров, \{totals\.qty\} шт, \{boxTotals\.boxes\} коробок/);
    expect(modal).toContain('задайте «Коробок на паллете» в Справочнике');
    expect(modal).toContain('коробки не посчитаны для:');
  });
});
