// ===== Item 74a: supply documents rebuilt from what Ozon holds =====
//
// The wizard used to lay the boxes out in the browser from the draft verdict, and the proxy
// only turned that layout into cargoes and files. To rebuild the documents of an order that
// already exists, the layout must come from Ozon itself: /v1/supply-order/bundle returns the
// composition of every supply (offer_id, barcode, quantity, placement_zone). This module turns
// that composition into the payload the proxy sends to /v1/cargoes/create, plus the zones the
// composition file prints and the articles whose barcode labels the Drive folder needs.
// Pure: no network, no store, so the proxy and the tests share it.

import { SKUItem } from '../types';
import { buildBoxesPayload, buildCargoPlan, CargoBoxPayload } from './ozonCargo';

/** One line of /v1/supply-order/bundle, as loadBundleItems on the proxy shapes it. */
export interface BundleItem {
  offerId: string;
  barcode: string;
  quantity: number;
  placementZone?: string;
}

export interface SupplyDocsLayout {
  boxes: CargoBoxPayload[];
  /** barcode → placement zone, the way finalize receives it from the wizard. */
  zones: Record<string, string>;
  /** Internal articles of the supply: the Drive folder copies their barcode labels. */
  articles: string[];
  /** Articles without «ШТ/КОР» in the SKU base: no boxes can be built for them. */
  noNormArticles: string[];
}

export function layoutFromBundle(items: BundleItem[], skus: SKUItem[]): SupplyDocsLayout {
  const plan = buildCargoPlan(
    items.map((it) => ({
      offerId: String(it.offerId || '').trim(),
      barcode: String(it.barcode || '').trim(),
      quantity: Number(it.quantity) || 0
    })),
    skus
  );

  const zones: Record<string, string> = {};
  for (const it of items) {
    const barcode = String(it.barcode || '').trim();
    const zone = String(it.placementZone || '').trim();
    if (barcode && zone) zones[barcode] = zone;
  }

  const articles: string[] = [];
  for (const b of plan.boxes) {
    if (articles.indexOf(b.article) < 0) articles.push(b.article);
  }

  return {
    boxes: buildBoxesPayload(plan),
    zones,
    articles,
    noNormArticles: plan.noNormArticles
  };
}

/** What the journal column «Документы» stores for one order. */
export interface SupplyDocsRecord {
  at: string;
  orderNumber: string;
  folderName: string;
  folderUrl: string;
  saved: string[];
  cargoes: number;
  warnings: string[];
  problems: string[];
  missingLabels: string[];
  /** Cargoes sent for every cluster, folder built, nothing missing. */
  ok: boolean;
}

export function parseSupplyDocs(docsJSON?: string | null): SupplyDocsRecord | null {
  const raw = String(docsJSON || '').trim();
  if (!raw) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const list = (v: any) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    at: String(parsed.at || ''),
    orderNumber: String(parsed.orderNumber || ''),
    folderName: String(parsed.folderName || ''),
    folderUrl: String(parsed.folderUrl || ''),
    saved: list(parsed.saved),
    cargoes: Number(parsed.cargoes) || 0,
    warnings: list(parsed.warnings),
    problems: list(parsed.problems),
    missingLabels: list(parsed.missingLabels),
    ok: parsed.ok === true
  };
}

/** The journal row fields the tab needs to find the record of an order. */
export interface DocsJournalRow {
  orderId: string;
  date: string;
  docsJSON?: string;
}

export interface OrderDocsStatus {
  /** The order was created through the app: the journal «Заявки Ozon» has its row. */
  inJournal: boolean;
  record: SupplyDocsRecord | null;
  /** 'legacy': a row from before the server-side build existed — documents were made by hand. */
  kind: 'ok' | 'issues' | 'none' | 'legacy';
  /** Warnings, problems and missing labels of the record, in that order. */
  issues: string[];
}

/**
 * Item 79b. The day the server-side build (item 74a) went live. Journal rows dated before it
 * never got a «Документы» record — their documents were collected by hand — so an empty cell
 * on such a row is not «not built» and gets no indicator.
 */
export const SUPPLY_DOCS_SINCE = '2026-09-18';

/**
 * Item 74b. Documents status of one order for the «Поставки Ozon» tab. A duplicate-bound
 * order may have several journal rows; the record of the latest row wins. Orders that never
 * went through the wizard have no journal row and get no indicator at all.
 */
export function orderDocsStatus(rows: DocsJournalRow[], orderId: string, docsSince: string = SUPPLY_DOCS_SINCE): OrderDocsStatus {
  const id = String(orderId || '').trim();
  const mine = id ? rows.filter((r) => String(r.orderId || '').trim() === id) : [];
  if (mine.length === 0) return { inJournal: false, record: null, kind: 'none', issues: [] };

  let latest = mine[0];
  for (const r of mine) {
    if (String(r.date || '') > String(latest.date || '')) latest = r;
  }
  const record = parseSupplyDocs(latest.docsJSON);
  if (!record) {
    // The journal date is an ISO string: compared as text with a YYYY-MM-DD threshold, any
    // time on the threshold day sorts after it, so no day-slicing is needed.
    const date = String(latest.date || '');
    const legacy = date !== '' && date < docsSince;
    return { inJournal: true, record: null, kind: legacy ? 'legacy' : 'none', issues: [] };
  }

  const issues = record.warnings.concat(record.problems, record.missingLabels.map((m) => 'Нет этикетки ШК: ' + m));
  return { inJournal: true, record, kind: record.ok ? 'ok' : 'issues', issues };
}
