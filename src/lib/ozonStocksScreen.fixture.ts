// Item 88, ticket 05: the «Остатки Озон» screen split into OzonStocksTab.tsx plus its parts.
// Source-text tests that used to read OzonStocksTab.tsx alone now read the whole screen through
// `readOzonStocksScreen()` — the concatenation below — so a check phrased against "the screen's
// source" keeps working no matter which part now holds the JSX it looks for.
import fs from 'node:fs';
import path from 'node:path';

/** Every part OzonStocksTab.tsx pulls in, directly or through another part — kept in one place
 *  so the guard test below can catch a new part that this list forgot. */
export const OZON_STOCKS_SCREEN_FILES = [
  'src/components/OzonStocksTab.tsx',
  'src/components/OzonStocksHeader.tsx',
  'src/components/OzonStocksNotices.tsx',
  'src/components/OzonRecommendationsPanel.tsx',
  'src/components/OzonCoverageTable.tsx',
  'src/components/OzonCoverageRow.tsx',
  'src/components/OzonCoverageClusterRow.tsx',
  'src/components/OzonComponentsTable.tsx',
  'src/components/OzonStocksModals.tsx',
  'src/components/ozonStocksFormat.tsx',
];

export function readOzonStocksScreen(): string {
  return OZON_STOCKS_SCREEN_FILES
    .map((rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))
    .join('\n');
}
