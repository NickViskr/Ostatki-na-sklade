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
import { buildBoxesPayload, buildCargoPlan, CargoBoxPayload, parseCargoRules } from './ozonCargo';

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

/** Item 101. What the record remembers about one supply, to redo only what is missing. */
export interface SupplyDocsEntry {
  supplyId: string;
  clusterName: string;
  /** Sorted, as strings (int64). Kept for comparison with Ozon only and dropped after SUPPLY_DOCS_IDS_KEEP_DAYS. */
  cargoIds: string[];
  /** The composition file was SAVED on Drive in that run. */
  composition: boolean;
  /** The cargo-label file was SAVED on Drive in that run. */
  label: boolean;
}

/** Owner decision 2026-10-28: cargo ids in the journal live 20 days; Code.gs clears them on the same rule. */
export const SUPPLY_DOCS_IDS_KEEP_DAYS = 20;

/** Name of the composition file of a cluster on Drive (the same cleaning the file is created with). */
export function compositionFileName(clusterName: string): string {
  const cleaned = String(clusterName || '')
    .replace(/[\/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Без названия') + '.xlsx';
}

export type SupplyDocsAction = 'skip' | 'label' | 'recreate';

export interface SupplyDocsDecisionInput {
  supplyId: string;
  clusterName: string;
  /** This supply's entry of the previous record; null when there is none. */
  previous: SupplyDocsEntry | null;
  /** `at` of the previous record (ISO). */
  recordAt: string;
  nowMs: number;
  /** cargo_id values Ozon holds for the supply right now. */
  currentCargoIds: string[];
  /** Raw supply_check_lists[] element of the supply, or null when Ozon returned none. */
  checkList: any;
  /** Names of the files in the order folder on Drive now. */
  folderFiles: string[];
  plannedBoxes: number;
}

/**
 * Item 101. What a repeat «Собрать документы» does with one supply. Money-critical: a wrong
 * 'skip' leaves labels that do not match the boxes, so every doubt answers 'recreate'.
 * skip: the record is fresh, Ozon holds exactly the cargoes it remembers (as many as planned),
 *   Ozon's content rules pass (cargoes present, every box filled, distribution valid), and both
 *   files were saved and are still in the folder.
 * label: the same, except the label file is missing (flag false or file absent).
 */
const CONTENT_RULES = ['cargoes_presents_rule', 'package_units_with_distribution_rule', 'is_valid_distribution_rule'];

export function decideSupplyDocs(input: SupplyDocsDecisionInput): SupplyDocsAction {
  const prev = input.previous;
  if (!prev || prev.supplyId !== input.supplyId) return 'recreate';

  const recordMs = Date.parse(input.recordAt);
  if (!Number.isFinite(recordMs)) return 'recreate';
  const ageMs = input.nowMs - recordMs;
  if (ageMs < 0 || ageMs >= SUPPLY_DOCS_IDS_KEEP_DAYS * 24 * 60 * 60 * 1000) return 'recreate';

  const current = input.currentCargoIds.map(String).sort();
  const stored = prev.cargoIds.map(String).sort();
  if (current.length === 0 || current.length !== stored.length) return 'recreate';
  if (current.some((id, i) => id !== stored[i])) return 'recreate';
  if (current.length !== input.plannedBoxes) return 'recreate';

  // Only the rules that say «Ozon's cargoes still hold the supply's composition». Expiry dates,
  // placement zones and the edit deadline do not change when the cargoes are recreated with the
  // same layout, so requiring them would only force pointless recreations.
  if (!input.checkList) return 'recreate';
  const rules = parseCargoRules(input.checkList).rules;
  for (const code of CONTENT_RULES) {
    const rule = rules.find((r) => r.code === code);
    if (!rule || !rule.satisfied) return 'recreate';
  }

  const files = input.folderFiles.map((f) => String(f).normalize('NFC'));
  if (prev.composition !== true || files.indexOf(compositionFileName(input.clusterName).normalize('NFC')) < 0) return 'recreate';

  const labelPresent = files.some((f) => f.indexOf(input.supplyId + '.') === 0 || f.indexOf('tags-cargoes-by-supply-' + input.supplyId + '.') === 0);
  return prev.label === true && labelPresent ? 'skip' : 'label';
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
  /** Item 101: per-supply memory for the next build; empty in records made before it. */
  supplies: SupplyDocsEntry[];
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
    supplies: (Array.isArray(parsed.supplies) ? parsed.supplies : [])
      .filter((e: any) => e && typeof e === 'object' && String(e.supplyId || '') !== '')
      .map((e: any) => ({
        supplyId: String(e.supplyId),
        clusterName: String(e.clusterName || ''),
        cargoIds: list(e.cargoIds),
        composition: e.composition === true,
        label: e.label === true
      })),
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
