import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { countShipmentBoxes, needsFfBox } from './shipmentBoxes';
import { SKUItem } from '../types';

const sku = (name: string, pcsPerBox: number, needs?: boolean): SKUItem => ({
  sku: name, price: 0, minStock: 0, pcsPerBox, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0,
  ...(needs === undefined ? {} : { needsFfBox: needs })
});

describe('needsFfBox', () => {
  it('only an explicit false switches the box off; undefined and a missing SKU keep it', () => {
    expect(needsFfBox(sku('A', 10))).toBe(true);
    expect(needsFfBox(sku('A', 10, true))).toBe(true);
    expect(needsFfBox(sku('A', 10, false))).toBe(false);
    expect(needsFfBox(undefined)).toBe(true);
  });
});

describe('countShipmentBoxes', () => {
  const skus = [sku('A', 10), sku('B', 24, false), sku('C', 0)];

  it('physical boxes are rounded up per article; the service counts only articles with the box', () => {
    // A: 25/10 → 3 boxes, charged; B: 48/24 → 2 boxes, not charged; C: no norm → 0.
    const out = countShipmentBoxes([{ article: 'A', quantity: 25 }, { article: 'B', quantity: 48 }, { article: 'C', quantity: 7 }], skus);
    expect(out).toEqual({ boxes: 5, ffBoxes: 3 });
  });

  it('an unknown article takes no boxes', () => {
    expect(countShipmentBoxes([{ article: 'ZZZ', quantity: 100 }], skus)).toEqual({ boxes: 0, ffBoxes: 0 });
  });

  it('with every article needing the box both numbers are equal', () => {
    const out = countShipmentBoxes([{ article: 'A', quantity: 10 }, { article: 'A', quantity: 1 }], skus);
    expect(out).toEqual({ boxes: 2, ffBoxes: 2 });
  });
});

describe('подключение: окно подтверждения расхода', () => {
  it('ConfirmModal counts boxes through countShipmentBoxes and charges «короб» by ffBoxes', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ConfirmModal.tsx'), 'utf8');
    expect(src).toContain("import { countShipmentBoxes } from '../lib/shipmentBoxes';");
    expect(src).toMatch(/nameLower\.includes\("короб"\)\)\s*\{\s*newSelected\[service\.id\] = ffBoxes;/);
    // Pallets still come from the physical boxes.
    expect(src).toMatch(/Math\.ceil\(boxes \/ boxesPerPalletGlobal\)/);
    expect(src).not.toMatch(/let boxesSum = 0/);
  });
});
