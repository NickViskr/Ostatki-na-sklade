/**
 * Item 81b: the form of a batch of the module «Заказы в Китае».
 *
 * Nothing here works out money. The script is the only place that costs a batch, and the
 * screen shows what came back from it; what this file does is count rows, boxes and pieces,
 * refuse a form the script would refuse anyway, and say which lines the script will treat as
 * one product — by exactly the rule `chinaGroupKey` uses in `ChinaOrders.gs`.
 */

import { ChinaBatch, ChinaBatchLine } from '../types';

export interface ChinaLineForm {
  marking: string;
  name: string;
  boxes: string;
  pcsPerBox: string;
  qty: string;
  priceCny: string;
  pallet: string;
  palletWeightKg: string;
  boxWeightKg: string;
  article: string;
  group: string;
}

export interface ChinaBatchForm {
  id: string;
  orderNo: string;
  code: string;
  shippedAt: string;
  arrivedAt: string;
  status: string;
  chinaDeliveryCny: string;
  weightKg: string;
  volumeM3: string;
  ratePerKgUsd: string;
  packingUsd: string;
  otherCargoUsd: string;
  freightUsd: string;
  cargoRate: string;
  rubRate: string;
  comment: string;
  lines: ChinaLineForm[];
}

export const CHINA_STATUSES = ['Черновик', 'В пути', 'Прибыла'];
export const CHINA_COST_TYPES = ['Разгрузка', 'Доставка до склада', 'Прочее'];

/** A number typed by a person: a comma for the decimal point, spaces inside, empty for zero. */
export function chinaNumber(value: string | number): number {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  const text = String(value == null ? '' : value).replace(/\s/g, '').replace(',', '.');
  if (text === '') return 0;
  const num = Number(text);
  return isFinite(num) ? num : 0;
}

export function emptyChinaLine(): ChinaLineForm {
  return {
    marking: '', name: '', boxes: '', pcsPerBox: '', qty: '', priceCny: '',
    pallet: '', palletWeightKg: '', boxWeightKg: '', article: '', group: ''
  };
}

export function emptyChinaBatchForm(): ChinaBatchForm {
  return {
    id: '', orderNo: '', code: '', shippedAt: '', arrivedAt: '', status: CHINA_STATUSES[0],
    chinaDeliveryCny: '', weightKg: '', volumeM3: '', ratePerKgUsd: '', packingUsd: '',
    otherCargoUsd: '', freightUsd: '', cargoRate: '', rubRate: '', comment: '',
    lines: [emptyChinaLine()]
  };
}

const text = (value: number): string => (value ? String(value) : '');

export function chinaBatchToForm(batch: ChinaBatch): ChinaBatchForm {
  return {
    id: batch.id,
    orderNo: batch.orderNo,
    code: batch.code,
    shippedAt: batch.shippedAt,
    arrivedAt: batch.arrivedAt,
    status: batch.status || CHINA_STATUSES[0],
    chinaDeliveryCny: text(batch.chinaDeliveryCny),
    weightKg: text(batch.weightKg),
    volumeM3: text(batch.volumeM3),
    ratePerKgUsd: text(batch.ratePerKgUsd),
    packingUsd: text(batch.packingUsd),
    otherCargoUsd: text(batch.otherCargoUsd),
    freightUsd: text(batch.freightUsd),
    cargoRate: text(batch.cargoRate),
    rubRate: text(batch.rubRate),
    comment: batch.comment,
    lines: (batch.lines || []).map((l: ChinaBatchLine) => ({
      marking: l.marking,
      name: l.name,
      boxes: text(l.boxes),
      pcsPerBox: text(l.pcsPerBox),
      qty: text(l.qty),
      priceCny: text(l.priceCny),
      pallet: l.pallet,
      palletWeightKg: text(l.palletWeightKg),
      boxWeightKg: text(l.boxWeightKg),
      article: l.article,
      group: l.group
    }))
  };
}

/** The payload of `saveChinaBatch`. Numbers go as numbers, so the script parses nothing. */
export function chinaFormToPayload(form: ChinaBatchForm): Record<string, unknown> {
  return {
    ...(form.id ? { id: form.id } : {}),
    orderNo: form.orderNo.trim(),
    code: form.code.trim(),
    shippedAt: form.shippedAt.trim(),
    arrivedAt: form.arrivedAt.trim(),
    status: form.status,
    chinaDeliveryCny: chinaNumber(form.chinaDeliveryCny),
    weightKg: chinaNumber(form.weightKg),
    volumeM3: chinaNumber(form.volumeM3),
    ratePerKgUsd: chinaNumber(form.ratePerKgUsd),
    packingUsd: chinaNumber(form.packingUsd),
    otherCargoUsd: chinaNumber(form.otherCargoUsd),
    freightUsd: chinaNumber(form.freightUsd),
    cargoRate: chinaNumber(form.cargoRate),
    rubRate: chinaNumber(form.rubRate),
    comment: form.comment.trim(),
    lines: form.lines.map((l) => ({
      marking: l.marking.trim(),
      name: l.name.trim(),
      boxes: chinaNumber(l.boxes),
      pcsPerBox: chinaNumber(l.pcsPerBox),
      qty: chinaNumber(l.qty),
      priceCny: chinaNumber(l.priceCny),
      pallet: l.pallet.trim(),
      palletWeightKg: chinaNumber(l.palletWeightKg),
      boxWeightKg: chinaNumber(l.boxWeightKg),
      article: l.article.trim(),
      group: l.group.trim()
    }))
  };
}

export interface ChinaFormCounts {
  rows: number;
  boxes: number;
  qty: number;
}

export function chinaFormCounts(lines: ChinaLineForm[]): ChinaFormCounts {
  let boxes = 0;
  let qty = 0;
  let rows = 0;
  lines.forEach((l) => {
    const pieces = chinaNumber(l.qty);
    if (pieces <= 0 && !l.marking.trim()) return;
    rows += 1;
    boxes += chinaNumber(l.boxes);
    qty += pieces;
  });
  return { rows, boxes, qty };
}

/**
 * What the script will treat as one product: the owner's marker first, our article second,
 * the carrier's marking last. Kept in step with `chinaGroupKey` in `ChinaOrders.gs`.
 */
export function chinaGroupLabel(line: { group?: string; article?: string; marking?: string }): string {
  const group = String(line.group || '').trim();
  if (group) return group;
  const article = String(line.article || '').trim();
  if (article) return article;
  return String(line.marking || '').trim();
}

/** Lines the script will cost together, by index. A group of one is left out. */
export function chinaLevelledGroups(lines: { group?: string; article?: string; marking?: string }[]): Record<string, number[]> {
  const groups: Record<string, number[]> = {};
  lines.forEach((l, i) => {
    const key = chinaGroupLabel(l).toLowerCase();
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(i);
  });
  const out: Record<string, number[]> = {};
  Object.keys(groups).forEach((key) => {
    if (groups[key].length > 1) out[key] = groups[key];
  });
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The same refusals the script makes, said before the round trip. */
export function validateChinaBatchForm(form: ChinaBatchForm): string[] {
  const errors: string[] = [];
  if (!form.code.trim()) errors.push('Не указан код партии');
  if (CHINA_STATUSES.indexOf(form.status) === -1) errors.push('Неизвестный статус партии');
  if (form.shippedAt.trim() && !ISO_DATE.test(form.shippedAt.trim())) {
    errors.push('Дата отгрузки должна быть в формате ГГГГ-ММ-ДД');
  }
  if (form.arrivedAt.trim() && !ISO_DATE.test(form.arrivedAt.trim())) {
    errors.push('Дата прибытия должна быть в формате ГГГГ-ММ-ДД');
  }

  const filled = form.lines.filter((l) => l.marking.trim() !== '' || chinaNumber(l.qty) > 0);
  if (filled.length === 0) errors.push('В партии нет ни одной строки товара');
  filled.forEach((l, i) => {
    if (!l.marking.trim()) errors.push(`В строке ${i + 1} не указана маркировка`);
    if (chinaNumber(l.qty) <= 0) errors.push(`В строке ${i + 1} количество должно быть больше нуля`);
  });
  return errors;
}

/** The lines actually sent: the empty tail rows of the form are dropped. */
export function chinaFilledLines(lines: ChinaLineForm[]): ChinaLineForm[] {
  return lines.filter((l) => l.marking.trim() !== '' || chinaNumber(l.qty) > 0);
}
