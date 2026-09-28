// Item 88, ticket 05: a new part of the «Остатки Озон» screen must be added to
// OZON_STOCKS_SCREEN_FILES, or every source-text test that reads the whole screen through
// `readOzonStocksScreen()` silently stops seeing it. The check walks the `./*.tsx` imports
// transitively from OzonStocksTab.tsx, so a part nested inside another part is caught too.
// Stand-alone windows the screen merely opens are not parts and are named here explicitly.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OZON_STOCKS_SCREEN_FILES } from './ozonStocksScreen.fixture';

const NOT_PARTS = new Set([
  'src/components/OzonSettingsModal.tsx',
  'src/components/OzonSupplyModal.tsx',
  'src/components/FactoryOrderModal.tsx',
]);

function screenParts(): Set<string> {
  const found = new Set<string>();
  const queue = ['src/components/OzonStocksTab.tsx'];
  while (queue.length) {
    const file = queue.pop()!;
    if (found.has(file)) continue;
    found.add(file);
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    for (const m of text.matchAll(/from\s+'(\.\/[^']+)'/g)) {
      const candidate = path.posix.join('src/components', `${m[1]}.tsx`);
      if (NOT_PARTS.has(candidate) || !fs.existsSync(path.join(process.cwd(), candidate))) continue;
      queue.push(candidate);
    }
  }
  return found;
}

describe('item 88 ticket 05: the fixture list matches the screen\'s actual parts', () => {
  it('OZON_STOCKS_SCREEN_FILES equals the .tsx parts reachable from OzonStocksTab.tsx', () => {
    expect([...screenParts()].sort()).toEqual([...OZON_STOCKS_SCREEN_FILES].sort());
  });
});
