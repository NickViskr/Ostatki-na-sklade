// ===== Item 80: the additional costs of a shipment, read out of and written back into «Объект» =====
//
// A shipment's packaging, «Прочее» and services are not stored as fields: the confirmation
// window writes them into the destination text as
//   Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x4 (636₽)]
// and their sum lands in the column «ДопРасходы» of every row of the operation, spread over
// the rows by quantity. To let the owner change them afterwards, the text has to be taken
// apart and put back together without losing anything that was not asked about — the note of
// a batch write-off, «Списание - Брак» and any other tag are kept verbatim.
//
// Pure: no store, no network. Code.gs mirrors `rowMoneyAfterExtras` on the server side, and
// the numbers of the two are pinned by the same production example in both test suites.

export interface ExtrasServiceEntry {
  name: string;
  quantity: number;
  /** RUB per item, as this shipment was billed — the tariff of its own day. */
  unitCost: number;
}

export interface ShipmentExtras {
  /** The object itself, without any bracket group. */
  main: string;
  /** Total RUB of «Упаковка» on the whole shipment, 0 when absent. */
  packaging: number;
  /** The «Упаковка» tag as written, so an untouched amount keeps its per-piece wording. */
  packagingText: string;
  other: number;
  otherText: string;
  services: ExtrasServiceEntry[];
  /** Every tag that is none of the three above, grouped as it was written. */
  keptGroups: string[][];
}

const PACKAGING_LABEL = 'Упаковка';
const OTHER_LABEL = 'Прочее';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (raw: string): number => {
  const v = Number(String(raw).replace(',', '.').replace(/\s/g, ''));
  return isNaN(v) ? 0 : v;
};

/**
 * The amount of a labelled part. Both shapes end with the total, so the LAST amount is the
 * one that counts — the earlier «x 5₽» is the price of one piece. Same rule as
 * parseLabelledAmount in Code.gs; they must not drift apart.
 */
const labelledAmount = (tag: string): number => {
  const re = /([\d.,]+)\s*₽/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(tag)) !== null) last = num(m[1]);
  return last;
};

/** «Имя x4 (636₽), Другое (150₽)» → entries. A missing quantity counts as one item. */
export function parseServicesTag(tag: string): ExtrasServiceEntry[] {
  const body = tag.replace(/^\s*(Доп\. услуги|Услуги)\s*:\s*/, '');
  const out: ExtrasServiceEntry[] = [];
  const re = /([^(,][^(]*)\(([\d.,]+)\s*₽\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const rawName = m[1].replace(/^,\s*/, '').trim();
    const total = num(m[2]);
    const qtyMatch = rawName.match(/^(.*?)\s+x(\d+)\s*$/i);
    if (qtyMatch) {
      const quantity = parseInt(qtyMatch[2], 10) || 1;
      out.push({ name: qtyMatch[1].trim(), quantity, unitCost: quantity > 0 ? round2(total / quantity) : total });
    } else {
      out.push({ name: rawName, quantity: 1, unitCost: total });
    }
  }
  return out;
}

const isTag = (tag: string, label: string): boolean =>
  tag.replace(/^\s+/, '').toLowerCase().indexOf(label.toLowerCase() + ':') === 0;

const isServicesTag = (tag: string): boolean => isTag(tag, 'Услуги') || isTag(tag, 'Доп. услуги');

export function parseShipmentExtras(destination?: string | null): ShipmentExtras {
  const raw = String(destination || '');
  const groups: string[][] = [];
  let main = raw;

  // Every bracket group of the tail, in order. The object is what stands before the first one.
  const groupRe = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  let firstAt = -1;
  while ((m = groupRe.exec(raw)) !== null) {
    if (firstAt < 0) firstAt = m.index;
    groups.push(m[1].split('|').map((t) => t.trim()).filter((t) => t !== ''));
  }
  if (firstAt >= 0) main = raw.slice(0, firstAt);

  const extras: ShipmentExtras = {
    main: main.trim(),
    packaging: 0,
    packagingText: '',
    other: 0,
    otherText: '',
    services: [],
    keptGroups: []
  };

  for (const group of groups) {
    const kept: string[] = [];
    for (const tag of group) {
      if (isTag(tag, PACKAGING_LABEL)) {
        extras.packaging = round2(extras.packaging + labelledAmount(tag));
        extras.packagingText = tag;
      } else if (isTag(tag, OTHER_LABEL)) {
        extras.other = round2(extras.other + labelledAmount(tag));
        extras.otherText = tag;
      } else if (isServicesTag(tag)) {
        extras.services = extras.services.concat(parseServicesTag(tag));
      } else {
        kept.push(tag);
      }
    }
    if (kept.length > 0) extras.keptGroups.push(kept);
  }

  return extras;
}

/** What the column «ДопРасходы» of the shipment must hold for these extras. */
export function extrasTotal(extras: ShipmentExtras): number {
  const services = extras.services.reduce((sum, s) => sum + Math.round(s.unitCost * s.quantity), 0);
  return round2(extras.packaging + extras.other + services);
}

/**
 * The destination text back. An amount that was not changed keeps its original wording, so an
 * edit of the services alone leaves «Упаковка: 40 шт. x 6₽ = 240₽» exactly as it was; a
 * changed amount is written for the shipment as a whole, because a per-piece price that does
 * not divide evenly would be a number nobody entered.
 */
export function buildDestination(extras: ShipmentExtras, original?: ShipmentExtras): string {
  const tags: string[] = [];

  if (extras.packaging > 0) {
    const kept = original && original.packaging === extras.packaging && original.packagingText;
    tags.push(kept ? original!.packagingText : PACKAGING_LABEL + ': ' + extras.packaging + '₽');
  }
  if (extras.other > 0) {
    const kept = original && original.other === extras.other && original.otherText;
    tags.push(kept ? original!.otherText : OTHER_LABEL + ': ' + extras.other + '₽');
  }
  const services = extras.services.filter((s) => s.quantity > 0);
  if (services.length > 0) {
    tags.push('Услуги: ' + services
      .map((s) => s.name + ' x' + s.quantity + ' (' + Math.round(s.unitCost * s.quantity) + '₽)')
      .join(', '));
  }

  const parts: string[] = [];
  if (tags.length > 0) parts.push('[' + tags.join(' | ') + ']');
  for (const group of extras.keptGroups) parts.push('[' + group.join(' | ') + ']');

  const main = extras.main.trim();
  if (parts.length === 0) return main;
  return main ? main + ' ' + parts.join(' ') : parts.join(' ');
}

export interface ExtrasRow {
  id: string;
  quantity: number;
  /** «Сумма» of the row as stored now. */
  total: number;
  isComponent?: boolean;
}

export interface ExtrasRowMoney {
  id: string;
  total: number;
  price: number;
}

/**
 * New money of the rows of one shipment after its additional costs changed. The share of a
 * row is the same formula the commit uses — `additional * qty / totalQty` over the pieces of
 * the operation — so the old share comes off and the new one goes on, and everything else in
 * the row (the write-off cost, the components of a kit) stays where it was. Rows of kit
 * components carry no share and are left out.
 */
export function rowMoneyAfterExtras(rows: ExtrasRow[], oldTotal: number, newTotal: number): ExtrasRowMoney[] {
  const main = rows.filter((r) => r.isComponent !== true && (Number(r.quantity) || 0) > 0);
  const totalQty = main.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  if (totalQty <= 0) return [];

  return main.map((r) => {
    const qty = Number(r.quantity) || 0;
    const oldShare = oldTotal > 0 ? round2(oldTotal * qty / totalQty) : 0;
    const newShare = newTotal > 0 ? round2(newTotal * qty / totalQty) : 0;
    const total = round2((Number(r.total) || 0) - oldShare + newShare);
    return { id: r.id, total, price: round2(total / qty) };
  });
}
