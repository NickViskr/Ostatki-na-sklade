import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { chinaArticleOptions } from './chinaArticles';
import { SKUItem } from '../types';

const sku = (name: string): SKUItem =>
  ({ sku: name, price: 0, minStock: 0, pcsPerBox: 0, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 });

describe('список наших артикулов для маркировки перевозчика', () => {
  it('is sorted and free of repeats', () => {
    const list = chinaArticleOptions([sku('Б-2'), sku('А-1'), sku('Б-2'), sku('В-3')], '');
    expect(list).toEqual(['А-1', 'Б-2', 'В-3']);
  });

  it('keeps an article that is no longer in the base, so an old batch does not lose it', () => {
    const list = chinaArticleOptions([sku('А-1')], 'СНЯТ-С-ПРОДАЖИ');
    expect(list[0]).toBe('СНЯТ-С-ПРОДАЖИ');
    expect(list).toContain('А-1');
  });

  it('does not repeat the current article when it is in the base', () => {
    expect(chinaArticleOptions([sku('А-1'), sku('Б-2')], 'А-1')).toEqual(['А-1', 'Б-2']);
  });

  it('survives an empty base and empty rows', () => {
    expect(chinaArticleOptions([], '')).toEqual([]);
    expect(chinaArticleOptions([sku(''), sku('  ')], '')).toEqual([]);
  });
});

describe('подключение списка артикулов', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('both the window and the card let the owner pick an article instead of typing it', () => {
    const modal = read('src/components/ChinaBatchModal.tsx');
    const tab = read('src/components/ChinaOrdersTab.tsx');
    [modal, tab].forEach((source) => {
      expect(source).toContain('chinaArticleOptions(skus');
      expect(source).toContain('— выберите артикул —');
      expect(source).toContain('useWarehouseStore');
    });
    expect(modal).toContain('select-china-article');
  });
});
