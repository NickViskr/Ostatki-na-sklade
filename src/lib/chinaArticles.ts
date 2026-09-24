/**
 * Item 81d: the articles of our own SKU base, for the list the owner picks from against a
 * carrier marking. An article already written against a line is kept in the list even when it
 * is no longer in the base — otherwise opening an old batch would silently blank it.
 */

import { SKUItem } from '../types';

export function chinaArticleOptions(skus: SKUItem[], current: string): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  (skus || []).forEach((item) => {
    const article = String((item && item.sku) || '').trim();
    if (!article || seen[article]) return;
    seen[article] = true;
    out.push(article);
  });
  out.sort((a, b) => a.localeCompare(b, 'ru'));
  const kept = String(current || '').trim();
  if (kept && !seen[kept]) out.unshift(kept);
  return out;
}
