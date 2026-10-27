/**
 * Item 93 ticket 05, step A: the pure helpers behind the automatic KAN cost send in the browser.
 *
 * Three jobs, no React and no store here so the tests can scan them directly:
 *  - the toast after the automatic send (what KAN accepted, what it refused),
 *  - «Отправлю сам»: the toast and the CSV file for the rows switched to a manual upload,
 *  - the per-shipment marker in «История»: what KAN said about the cost of this shipment.
 *    Answer 7 of the owner: the marker is shown to the author of the shipment and to the admin only.
 */
import { buildKanCostCsv, collapseKanCostRows } from './kanCostExport';
import type { KanCostRow } from './kanCostExport';
import { formatCurrency } from './utils';

/** One cabinet + article + day group, the way Code.gs kanCostGroupSummary reports it. */
export interface KanSendGroup {
  cabinet: string;
  article: string;
  date: string;
  action: 'upsert' | 'delete';
  /** The figure sent to KAN; null for a deletion. */
  cost: number | null;
  opIds: string[];
  /** Why KAN did not take the group; only on a failed one. */
  reason?: string;
}

/** The answer of sendOzonCostToKan. */
export interface KanSendAnswer {
  busy?: boolean;
  message?: string;
  accepted?: KanSendGroup[];
  failed?: KanSendGroup[];
  /** Rows the owner switched to «Отправлю сам»: skipped silently. */
  skippedManual?: number;
  notWritten?: number;
}

/** One row of the answer of switchOzonCostToManual (the shape of getOzonCostExport). */
export interface KanExportRow {
  row: number;
  date: string;
  cabinet: string;
  article: string;
  sku: string;
  /** A number, or a text a hand-edited sheet gave; anything unreadable counts as 0 in the file. */
  cost: number | string;
  opId?: string;
  source?: string;
}

/** The answer of switchOzonCostToManual. */
export interface KanManualAnswer {
  busy?: boolean;
  message?: string;
  rows?: KanExportRow[];
  switched?: number;
  notWritten?: number;
}

export type KanToast =
  | { kind: 'none' }
  | { kind: 'info' | 'success' | 'error'; title: string; lines?: string[] };

/** One entry of getOzonCostKanMarkers: the KAN status of the day group a shipment belongs to. */
export interface KanMarkerInfo {
  opId: string;
  article: string;
  status: string;
  answer: string;
  time: string;
}

export interface KanMarkerView {
  glyph: '✓' | '✗' | '⏳';
  tone: 'ok' | 'error' | 'wait';
  text: string;
  /** True when the two buttons («Отправить снова», «Отправлю сам») belong next to the marker. */
  buttons: boolean;
}

const BUSY_DEFAULT = 'уже отправляется';
const NO_REASON = 'причина не указана';

/** 2026-10-13 -> «13.10»; a date in any other shape is printed as it came. */
const shortDate = (date: string): string => {
  const m = String(date ?? '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}.${m[1]}` : String(date ?? '');
};

const acceptedLine = (g: KanSendGroup): string =>
  g.action === 'delete'
    ? `${g.article} (${g.cabinet}) — запись за ${shortDate(g.date)} удалена`
    : `${g.article} (${g.cabinet}) — ${formatCurrency(Number(g.cost))} ₽ с ${shortDate(g.date)}`;

const failedLine = (g: KanSendGroup): string =>
  `${g.article} (${g.cabinet}), ${shortDate(g.date)}: ${String(g.reason ?? '').trim() || NO_REASON}`;

const busyToast = (message: string | undefined): KanToast => ({
  kind: 'info',
  title: `КАН: ${String(message ?? '').trim() || BUSY_DEFAULT}`,
});

/**
 * The toast after the automatic send. A refusal beats an acceptance: the failed lines come first,
 * the accepted groups follow, each under its own «Принято: ». Nothing accepted and nothing refused
 * (an empty answer, only «Отправлю сам» rows) says nothing.
 */
export const kanSendToast = (answer: KanSendAnswer | null | undefined): KanToast => {
  if (!answer) return { kind: 'none' };
  if (answer.busy) return busyToast(answer.message);
  const accepted = answer.accepted ?? [];
  const failed = answer.failed ?? [];
  if (failed.length > 0) {
    const title = failed.length === 1
      ? `КАН не принял: ${String(failed[0].reason ?? '').trim() || NO_REASON}`
      : `КАН не принял себестоимость: ${failed.length}`;
    return {
      kind: 'error',
      title,
      lines: failed.map(failedLine).concat(accepted.map((g) => `Принято: ${acceptedLine(g)}`)),
    };
  }
  if (accepted.length > 0) {
    return { kind: 'success', title: 'КАН принял себестоимость:', lines: accepted.map(acceptedLine) };
  }
  return { kind: 'none' };
};

/** The same mapping the old «Себестоимость КАН» button uses inline in exportKanCost. */
const toKanCostRows = (rows: KanExportRow[]): KanCostRow[] =>
  (rows || []).map((r) => ({
    date: String(r.date || ''),
    sku: String(r.sku || ''),
    article: String(r.article || ''),
    cost: Number(r.cost) || 0,
    cabinet: String(r.cabinet || ''),
  }));

/** The file for «Отправлю сам»: byte for byte what the old button builds for the same rows. */
export const kanManualCsv = (rows: KanExportRow[]): string =>
  buildKanCostCsv(collapseKanCostRows(toKanCostRows(rows)));

/** The toast after «Отправлю сам»; the row count is the count of the FILE, after same-day rows collapse. */
export const kanManualToast = (answer: KanManualAnswer | null | undefined): KanToast => {
  if (!answer) return { kind: 'none' };
  if (answer.busy) return busyToast(answer.message);
  const rows = answer.rows ?? [];
  if (rows.length === 0) {
    return { kind: 'info', title: 'Неотправленной себестоимости нет — файл не нужен' };
  }
  return {
    kind: 'success',
    title: `Файл для КАН скачан: строк ${collapseKanCostRows(toKanCostRows(rows)).length}`,
    lines: ['Загрузите его в КАН. Приложение проверит КАН в течение часа.'],
  };
};

/**
 * A history row that is a shipment to an Ozon cabinet: an expense whose destination names the cabinet
 * («Ozon (Магазин) [расходы]», same reading as Code.gs ozonCabinetFromDestination) and that is not a
 * kit component — only the kit's own row carries the cost.
 */
export const isOzonShipmentRow = (row: { type?: string; destination?: string; isComponent?: boolean }): boolean => {
  if (row.type !== 'Расход' || row.isComponent) return false;
  const m = String(row.destination ?? '').match(/Ozon\s*\(([^)]+)\)/);
  return !!m && m[1].trim() !== '';
};

const markerKey = (opId: string, article: string): string => `${opId}|${article}`;

/** Markers by order id and article; a later entry of one key wins. */
export const indexKanMarkers = (list: KanMarkerInfo[] | null | undefined): Record<string, KanMarkerInfo> => {
  const index: Record<string, KanMarkerInfo> = {};
  (list || []).forEach((m) => { index[markerKey(m.opId, m.article)] = m; });
  return index;
};

/** What to draw for a marker; null when its status shows nothing (empty, unknown, no marker). */
export const kanMarkerView = (marker: KanMarkerInfo | null | undefined): KanMarkerView | null => {
  if (!marker) return null;
  const answer = String(marker.answer ?? '').trim();
  switch (String(marker.status ?? '').trim().toLowerCase()) {
    case 'принято':
      return { glyph: '✓', tone: 'ok', text: answer || 'КАН принял', buttons: false };
    case 'ошибка':
      return { glyph: '✗', tone: 'error', text: answer ? `КАН не принял: ${answer}` : 'КАН не принял', buttons: true };
    case 'вручную':
      return { glyph: '⏳', tone: 'wait', text: `Загрузка вручную: ${answer || 'ждём файл в КАН'}`, buttons: false };
    case 'отправляется':
      return { glyph: '⏳', tone: 'wait', text: 'Отправляется в КАН', buttons: false };
    default:
      return null;
  }
};

const norm = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/**
 * Answer 7: the admin sees every marker, anybody else only those of their own shipments. The admin is
 * recognised by role admin/администратор (as the server's isAdminRole) or by the account name
 * admin/админ/администратор (as App.tsx); the author is compared without case and spaces, and two
 * blanks are not a match.
 */
export const canSeeKanMarker = (
  user: { username?: unknown; role?: unknown } | null | undefined,
  row: { user?: unknown },
): boolean => {
  if (!user) return false;
  if (['admin', 'администратор'].includes(norm(user.role))) return true;
  if (['admin', 'админ', 'администратор'].includes(norm(user.username))) return true;
  const author = norm(row.user);
  return author !== '' && author === norm(user.username);
};

/** The marker of one history row, or null: no order id, a stranger's shipment, no marker, or nothing to show. */
export const historyKanMarker = (
  row: { opId?: string; article?: string; user?: unknown },
  markers: Record<string, KanMarkerInfo>,
  user: { username?: unknown; role?: unknown } | null | undefined,
): KanMarkerView | null => {
  if (!row.opId) return null;
  if (!canSeeKanMarker(user, row)) return null;
  return kanMarkerView(markers[markerKey(row.opId, String(row.article ?? ''))]);
};
