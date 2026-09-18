// Item 74a. The documents of an existing order are rebuilt from Ozon's own composition
// (/v1/supply-order/bundle), not from a layout the browser once held.

import { describe, it, expect } from 'vitest';
import { SKUItem } from '../types';
import { layoutFromBundle, parseSupplyDocs } from './ozonSupplyDocs';

const sku = (name: string, pcsPerBox: number, ozonBarcode: string): SKUItem => ({
  sku: name, price: 0, minStock: 0, pcsPerBox, ozonBarcode, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0
});

const skus = [sku('Миска_серая', 24, 'OZN111'), sku('Органайзер', 10, 'OZN222')];

describe('layoutFromBundle', () => {
  it('lays the bundle out by the SKU norm: full boxes plus one partial box per article', () => {
    const out = layoutFromBundle([
      { offerId: 'Миска_серая', barcode: 'OZN111', quantity: 60, placementZone: 'SORT' },
      { offerId: 'Органайзер', barcode: 'OZN222', quantity: 10, placementZone: 'NON_SORT' }
    ], skus);

    // 60 / 24 = 2 full + 12; 10 / 10 = 1 full
    expect(out.boxes.map((b) => b.items[0].quantity)).toEqual([24, 24, 12, 10]);
    expect(out.boxes.map((b) => b.key)).toEqual(['box-1', 'box-2', 'box-3', 'box-4']);
    expect(out.boxes[0].items[0]).toEqual({ barcode: 'OZN111', offerId: 'Миска_серая', quantity: 24, quant: 1 });
    expect(out.noNormArticles).toEqual([]);
  });

  it('keeps the placement zone of every barcode for the composition file', () => {
    const out = layoutFromBundle([
      { offerId: 'Миска_серая', barcode: 'OZN111', quantity: 1, placementZone: 'SORT' },
      { offerId: 'Органайзер', barcode: 'OZN222', quantity: 1, placementZone: '' }
    ], skus);
    expect(out.zones).toEqual({ OZN111: 'SORT' });
  });

  it('lists each article once — the Drive folder copies one barcode label per article', () => {
    const out = layoutFromBundle([
      { offerId: 'Миска_серая', barcode: 'OZN111', quantity: 50 },
      { offerId: 'Органайзер', barcode: 'OZN222', quantity: 3 }
    ], skus);
    expect(out.articles).toEqual(['Миска_серая', 'Органайзер']);
  });

  it('reports an article without «ШТ/КОР» instead of building boxes for it', () => {
    const noNorm = [sku('Миска_серая', 0, 'OZN111')];
    const out = layoutFromBundle([{ offerId: 'Миска_серая', barcode: 'OZN111', quantity: 5 }], noNorm);
    expect(out.boxes).toEqual([]);
    expect(out.noNormArticles).toEqual(['Миска_серая']);
  });

  it('drops empty lines and reads the article by the Ozon barcode, not by offer_id spelling', () => {
    const out = layoutFromBundle([
      { offerId: 'миска_серая', barcode: 'OZN111', quantity: 24 },
      { offerId: 'Органайзер', barcode: 'OZN222', quantity: 0 }
    ], skus);
    expect(out.articles).toEqual(['Миска_серая']);
    expect(out.boxes).toHaveLength(1);
  });
});

describe('parseSupplyDocs', () => {
  it('returns null for an empty or broken cell', () => {
    expect(parseSupplyDocs('')).toBeNull();
    expect(parseSupplyDocs(undefined)).toBeNull();
    expect(parseSupplyDocs('{oops')).toBeNull();
    expect(parseSupplyDocs('[]')).toBeNull();
  });

  it('reads the record and treats anything but ok === true as not ok', () => {
    const rec = parseSupplyDocs(JSON.stringify({
      at: '2026-09-18T14:00:00.000Z', orderNumber: '129260922-1', folderName: 'Озон 129260922-1',
      folderUrl: 'https://drive.google.com/x', saved: ['Москва.xlsx'], cargoes: 3,
      warnings: [], problems: ['p'], missingLabels: ['A.pdf'], ok: 'true'
    }));
    expect(rec).not.toBeNull();
    expect(rec!.ok).toBe(false);
    expect(rec!.cargoes).toBe(3);
    expect(rec!.saved).toEqual(['Москва.xlsx']);
    expect(rec!.missingLabels).toEqual(['A.pdf']);
    expect(parseSupplyDocs(JSON.stringify({ ok: true }))!.ok).toBe(true);
  });
});
