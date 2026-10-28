// Item 74a. The documents of an existing order are rebuilt from Ozon's own composition
// (/v1/supply-order/bundle), not from a layout the browser once held.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SKUItem } from '../types';
import { layoutFromBundle, orderDocsStatus, parseSupplyDocs, SUPPLY_DOCS_SINCE } from './ozonSupplyDocs';
import { gasReadsInvalidatedBy } from './gasActions';

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

describe('orderDocsStatus', () => {
  const rec = (ok: boolean, extra: Partial<{ warnings: string[]; problems: string[]; missingLabels: string[] }> = {}) =>
    JSON.stringify({ at: 'x', orderNumber: 'n', folderName: 'f', folderUrl: 'u', saved: [], cargoes: 2, warnings: [], problems: [], missingLabels: [], ok, ...extra });

  it('an order without a journal row gets no indicator', () => {
    const st = orderDocsStatus([{ orderId: '1', date: '2026-09-18T10:00:00.000Z', docsJSON: rec(true) }], '2');
    expect(st).toEqual({ inJournal: false, record: null, kind: 'none', issues: [] });
  });

  it('a journal row without a record means «not built»', () => {
    const st = orderDocsStatus([{ orderId: '1', date: '2026-09-18T10:00:00.000Z', docsJSON: '' }], '1');
    expect(st.inJournal).toBe(true);
    expect(st.kind).toBe('none');
    expect(st.record).toBeNull();
  });

  it('ok record → ok; the latest row of a duplicate-bound order wins', () => {
    const rows = [
      { orderId: '1', date: '2026-09-18T10:00:00.000Z', docsJSON: rec(false, { problems: ['old'] }) },
      { orderId: '1', date: '2026-09-18T12:00:00.000Z', docsJSON: rec(true) },
      { orderId: '1', date: '2026-09-18T11:00:00.000Z', docsJSON: rec(false, { problems: ['mid'] }) }
    ];
    const st = orderDocsStatus(rows, '1');
    expect(st.kind).toBe('ok');
    expect(st.issues).toEqual([]);
  });

  it('a record with issues lists warnings, problems and missing labels in that order', () => {
    const st = orderDocsStatus([{ orderId: ' 1 ', date: 'd', docsJSON: rec(false, { warnings: ['w'], problems: ['p'], missingLabels: ['A.pdf'] }) }], '1');
    expect(st.kind).toBe('issues');
    expect(st.issues).toEqual(['w', 'p', 'Нет этикетки ШК: A.pdf']);
  });

  // Item 79b. The journal had 32 rows from before the server-side build (29.07–14.09.2026)
  // with an empty «Документы» cell; the tab marked every one of them «not built».
  it('a row without a record dated before the build went live is legacy, not «not built»', () => {
    expect(SUPPLY_DOCS_SINCE).toBe('2026-09-18');
    const before = orderDocsStatus([{ orderId: '1', date: '2026-09-17T23:59:59.000Z', docsJSON: '' }], '1');
    expect(before).toEqual({ inJournal: true, record: null, kind: 'legacy', issues: [] });
    const onDay = orderDocsStatus([{ orderId: '1', date: '2026-09-18T00:00:00.000Z', docsJSON: '' }], '1');
    expect(onDay.kind).toBe('none');
    // The threshold day itself, even written without a time, is already the build era.
    expect(orderDocsStatus([{ orderId: '1', date: '2026-09-18', docsJSON: '' }], '1').kind).toBe('none');
    const after = orderDocsStatus([{ orderId: '1', date: '2026-09-22T09:24:19.000Z', docsJSON: '' }], '1');
    expect(after.kind).toBe('none');
  });

  it('legacy is decided by the latest row of the order and never by a row with a record', () => {
    const rows = [
      { orderId: '1', date: '2026-09-01T10:00:00.000Z', docsJSON: '' },
      { orderId: '1', date: '2026-09-20T10:00:00.000Z', docsJSON: '' }
    ];
    expect(orderDocsStatus(rows, '1').kind).toBe('none');
    expect(orderDocsStatus([{ orderId: '1', date: '2026-09-01T10:00:00.000Z', docsJSON: rec(true) }], '1').kind).toBe('ok');
    // A row without a date cannot be legacy: an unreadable date must not hide a real gap.
    expect(orderDocsStatus([{ orderId: '1', date: '', docsJSON: '' }], '1').kind).toBe('none');
    // The threshold is a parameter: the tab passes nothing and gets the constant.
    expect(orderDocsStatus([{ orderId: '1', date: '2026-09-20T10:00:00.000Z', docsJSON: '' }], '1', '2026-09-21').kind).toBe('legacy');
  });
});

// Item 74b. Wiring guards: the wizard and the tab go through the server-side build, and the
// browser no longer holds a step of its own between Ozon and Drive.
describe('подключение серверной сборки документов к экранам', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const modal = read('src/components/OzonSupplyModal.tsx');
  const tab = read('src/components/OzonSuppliesTab.tsx');
  const server = read('server.ts');

  it('мастер после создания заявки вызывает /api/ozon/supply/docs и сам на Диск не ходит', () => {
    expect(modal).toContain("fetchWithTimeout('/api/ozon/supply/docs'");
    expect(modal).not.toContain('saveSupplyDocsToDrive');
    expect(modal).not.toContain('supply/finalize');
  });

  it('вкладка читает журнал при открытии и рисует индикатор по orderDocsStatus', () => {
    expect(tab).toContain("import { orderDocsStatus } from '../lib/ozonSupplyDocs';");
    expect(tab).toMatch(/useEffect\(\(\) => \{\s*fetchOzonSupplyRequests\(\);\s*\}, \[fetchOzonSupplyRequests\]\);/);
    expect(tab).toContain('Документы собраны');
    expect(tab).toContain('Документы не собраны');
    expect(tab).toContain('Документы с замечаниями');
  });

  it('кнопка «Собрать документы» спрашивает подтверждение о пересоздании грузомест и зовёт прокси', () => {
    expect(tab).toContain('Собрать документы');
    expect(tab).toMatch(/askConfirmation\(\s*'Собрать документы заявки\?'[\s\S]{0,400}заново созданы грузоместа/);
    expect(tab).toContain("fetch('/api/ozon/supply/docs'");
  });

  it('прокси: finalize снят, документы собирает /api/ozon/supply/docs с записью в журнал', () => {
    expect(server).not.toContain('/api/ozon/supply/finalize');
    expect(server).toContain('app.post("/api/ozon/supply/docs"');
    expect(server).toContain("callGasAction('saveSupplyDocsToDrive'");
    expect(server).toContain("callGasAction('saveOzonSupplyDocs'");
  });

  // Item 79b. The docs route writes the journal past /api/gas, so it must clear the cached
  // journal read itself, and the tab must draw nothing for a legacy row.
  it('proxy: the docs route clears the cached journal read right after the record is written', () => {
    // Item 89: the invalidation list moved from server.ts into src/lib/gasActions.ts.
    expect(gasReadsInvalidatedBy('saveOzonSupplyDocs')).toEqual(['getOzonSupplyRequests']);
    // Part 2 of 100.3: the invalidation moved into callGasAction's finally (noteGasWrite for every non-read action).
    expect(server).toContain("callGasAction('saveOzonSupplyDocs'");
    expect(server).toMatch(/if \(!isGasRead\(action\)\) noteGasWrite\(action\);/);
  });

  // Item 79a. The order must reach «Поставки Озон» without the sync button.
  it('wizard: after the documents are built it fires the Ozon poll itself, once the window closed', () => {
    expect(modal).toContain('const checkOzonShipments = useWarehouseStore((state) => state.checkOzonShipments);');
    expect(modal).toMatch(/await finalizeSupply\(orderId\);[\s\S]{0,900}?onClose\(\);\s*checkOzonShipments\(\);\s*\};/);
  });

  it('tab: a legacy row gets no documents badge', () => {
    expect(tab).toMatch(/if \(st\.kind === 'legacy'\) return null;[\s\S]{0,200}if \(st\.kind === 'issues'\)/);
  });
});

// ---- Item 101 ticket 03: decideSupplyDocs (skip / label / recreate) ----
import { decideSupplyDocs, SupplyDocsDecisionInput, SupplyDocsEntry } from './ozonSupplyDocs';

describe('decideSupplyDocs', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.parse('2026-11-01T12:00:00Z');
  const SID = '2000000000001';
  const rule = (satisfied: boolean) => ({ satisfied, is_applicable: true, is_required: true });
  const okCheckList = () => ({
    supply_id: SID,
    cargoes_presents_rule: rule(true),
    package_units_with_distribution_rule: rule(true),
    is_valid_distribution_rule: rule(true)
  });
  const entry = (over: Partial<SupplyDocsEntry> = {}): SupplyDocsEntry => ({
    supplyId: SID, clusterName: 'Казань', cargoIds: ['902', '901'], composition: true, label: true, ...over
  });
  const input = (over: Partial<SupplyDocsDecisionInput> = {}): SupplyDocsDecisionInput => ({
    supplyId: SID,
    clusterName: 'Казань',
    previous: entry(),
    recordAt: new Date(NOW - DAY).toISOString(),
    nowMs: NOW,
    currentCargoIds: ['901', '902'],
    checkList: okCheckList(),
    folderFiles: ['Казань.xlsx', 'tags-cargoes-by-supply-' + SID + '.pdf'],
    plannedBoxes: 2,
    ...over
  });

  it('skips when everything matches: fresh record, same ids, rules pass, both files present', () => {
    expect(decideSupplyDocs(input())).toBe('skip');
  });
  it('recreates when there is no previous entry', () => {
    expect(decideSupplyDocs(input({ previous: null }))).toBe('recreate');
  });
  it('recreates when the previous entry belongs to another supply', () => {
    expect(decideSupplyDocs(input({ previous: entry({ supplyId: '2000000000009' }) }))).toBe('recreate');
  });
  it('recreates when Ozon holds different cargo ids than the record', () => {
    expect(decideSupplyDocs(input({ currentCargoIds: ['901', '903'] }))).toBe('recreate');
  });
  it('treats the same ids in another order as equal (both sides sorted)', () => {
    expect(decideSupplyDocs(input({ currentCargoIds: ['902', '901'], previous: entry({ cargoIds: ['901', '902'] }) }))).toBe('skip');
  });
  it('recreates when Ozon returns no cargoes', () => {
    expect(decideSupplyDocs(input({ currentCargoIds: [], previous: entry({ cargoIds: [] }), plannedBoxes: 0 }))).toBe('recreate');
  });
  it('recreates when the cargo count differs from the planned box count', () => {
    expect(decideSupplyDocs(input({ plannedBoxes: 3 }))).toBe('recreate');
  });
  it('recreates when Ozon has more ids than the record', () => {
    expect(decideSupplyDocs(input({ currentCargoIds: ['901', '902', '903'], plannedBoxes: 3 }))).toBe('recreate');
  });
  it('recreates when the check-list is missing', () => {
    expect(decideSupplyDocs(input({ checkList: null }))).toBe('recreate');
  });
  for (const code of ['cargoes_presents_rule', 'package_units_with_distribution_rule', 'is_valid_distribution_rule']) {
    it(`recreates when content rule ${code} is not satisfied`, () => {
      expect(decideSupplyDocs(input({ checkList: { ...okCheckList(), [code]: rule(false) } }))).toBe('recreate');
    });
    it(`recreates when content rule ${code} is absent from the check-list`, () => {
      const cl: any = okCheckList();
      delete cl[code];
      expect(decideSupplyDocs(input({ checkList: cl }))).toBe('recreate');
    });
  }
  it('does NOT recreate when only placement_zones_rule / expiry / edit-deadline rules fail', () => {
    const cl = { ...okCheckList(), placement_zones_rule: rule(false), expiration_dates_rule: rule(false), edit_deadline_rule: rule(false) };
    expect(decideSupplyDocs(input({ checkList: cl }))).toBe('skip');
  });
  it('a record 19.9 days old still counts, a record exactly 20 days old does not', () => {
    expect(decideSupplyDocs(input({ recordAt: new Date(NOW - 19.9 * DAY).toISOString() }))).toBe('skip');
    expect(decideSupplyDocs(input({ recordAt: new Date(NOW - 20 * DAY).toISOString() }))).toBe('recreate');
  });
  it('recreates when the record time is in the future or unparsable', () => {
    expect(decideSupplyDocs(input({ recordAt: new Date(NOW + 1000).toISOString() }))).toBe('recreate');
    expect(decideSupplyDocs(input({ recordAt: 'garbage' }))).toBe('recreate');
    expect(decideSupplyDocs(input({ recordAt: '' }))).toBe('recreate');
  });
  it('recreates when the composition flag is false even though the file is in the folder', () => {
    expect(decideSupplyDocs(input({ previous: entry({ composition: false }) }))).toBe('recreate');
  });
  it('recreates when the composition file is absent from the folder', () => {
    expect(decideSupplyDocs(input({ folderFiles: ['tags-cargoes-by-supply-' + SID + '.pdf'] }))).toBe('recreate');
  });
  it('returns label when the label flag is true but the label file is absent', () => {
    expect(decideSupplyDocs(input({ folderFiles: ['Казань.xlsx'] }))).toBe('label');
  });
  it('returns label when the label file is present but the flag is false', () => {
    expect(decideSupplyDocs(input({ previous: entry({ label: false }) }))).toBe('label');
  });
  it('counts <supplyId>.pdf and tags-cargoes-by-supply-<supplyId>.zip as the label file', () => {
    expect(decideSupplyDocs(input({ folderFiles: ['Казань.xlsx', SID + '.pdf'] }))).toBe('skip');
    expect(decideSupplyDocs(input({ folderFiles: ['Казань.xlsx', 'tags-cargoes-by-supply-' + SID + '.zip'] }))).toBe('skip');
  });
  it('does not count a longer id with the same prefix (<supplyId>1.pdf) as the label file', () => {
    expect(decideSupplyDocs(input({ folderFiles: ['Казань.xlsx', SID + '1.pdf'] }))).toBe('label');
  });
  it('matches cluster names with «й» in NFD in the folder against NFC in the record (and the reverse)', () => {
    for (const name of ['Новосибирск', 'Йошкар-Ола']) {
      const nfc = name.normalize('NFC');
      const nfd = name.normalize('NFD');
      expect(decideSupplyDocs(input({ clusterName: nfc, folderFiles: [nfd + '.xlsx', SID + '.pdf'] }))).toBe('skip');
      expect(decideSupplyDocs(input({ clusterName: nfd, folderFiles: [nfc + '.xlsx', SID + '.pdf'] }))).toBe('skip');
    }
  });
});
