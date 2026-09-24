/**
 * Item 81b: the form of a batch of the module «Заказы в Китае».
 *
 * Nothing here works out money. The script is the only place that costs a batch, and the
 * screen shows what came back from it; what this file does is count rows, boxes and pieces,
 * refuse a form the script would refuse anyway, and say which lines the script will treat as
 * one product — by exactly the rule `chinaGroupKey` uses in `ChinaOrders.gs`.
 */

import { ChinaBatch, ChinaBatchLine } from '../types';
import { ChinaParsedArrival, ChinaParsedBatch, ChinaParsedReport, chinaFreightOf, chinaOrderOf } from './chinaFileParse';

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
  /** Item 81e: dimensions and weight of ONE factory box, from the arrival file. Typed by no one. */
  boxLengthM: string;
  boxWidthM: string;
  boxHeightM: string;
  factoryBoxKg: string;
  /** Read-only, worked out by the script: shown, never sent back. */
  boxVolumeM3: string;
  goodsKg: string;
  densityKgM3: string;
  kgPerPiece: string;
  article: string;
  group: string;
}

export interface ChinaBatchForm {
  id: string;
  orderNo: string;
  code: string;
  shippedAt: string;
  arrivedAt: string;
  /** Item 81e: date the goods reached the carrier's Yiwu warehouse, from the arrival file. */
  receivedAt: string;
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
  /** Item 81d: what the report of the Chinese side says about the order. Not edited by hand. */
  paidCny: string;
  unpaidCny: string;
  comment: string;
  lines: ChinaLineForm[];
  /** Item 81e: packaging and carriage — read-only, worked out by the script. */
  goodsKg: string;
  goodsVolumeM3: string;
  packagingKg: string;
  packagingM3: string;
  goodsDensity: string;
  packedDensity: string;
  tariffBasis: string;
  packagingUsd: string;
  goodsFreightUsd: string;
  packagingRub: string;
  goodsFreightRub: string;
  packagingShareFreight: string;
  packagingShareCost: string;
  goodsFreightShareCost: string;
}

export const CHINA_STATUSES = ['Черновик', 'В пути', 'Прибыла'];
export const CHINA_COST_TYPES = ['Разгрузка', 'Доставка до склада', 'Прочее'];

/** A number typed by a person: a comma for the decimal point, spaces inside, empty for zero. */
export function chinaNumber(value: string | number): number {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  let text = String(value == null ? '' : value).replace(/\s/g, '');
  // «1,636.75», pasted from an English sheet: the comma separates thousands there, and read
  // as a decimal point it would turn the number into nothing at all.
  if (text.indexOf(',') !== -1 && text.indexOf('.') !== -1) text = text.replace(/,/g, '');
  text = text.replace(',', '.');
  if (text === '') return 0;
  const num = Number(text);
  return isFinite(num) ? num : 0;
}

export function emptyChinaLine(): ChinaLineForm {
  return {
    marking: '', name: '', boxes: '', pcsPerBox: '', qty: '', priceCny: '',
    pallet: '', palletWeightKg: '', boxWeightKg: '',
    boxLengthM: '', boxWidthM: '', boxHeightM: '', factoryBoxKg: '',
    boxVolumeM3: '', goodsKg: '', densityKgM3: '', kgPerPiece: '',
    article: '', group: ''
  };
}

export function emptyChinaBatchForm(): ChinaBatchForm {
  return {
    id: '', orderNo: '', code: '', shippedAt: '', arrivedAt: '', receivedAt: '', status: CHINA_STATUSES[0],
    chinaDeliveryCny: '', weightKg: '', volumeM3: '', ratePerKgUsd: '', packingUsd: '',
    otherCargoUsd: '', freightUsd: '', cargoRate: '', rubRate: '', paidCny: '', unpaidCny: '',
    comment: '', lines: [emptyChinaLine()],
    goodsKg: '', goodsVolumeM3: '', packagingKg: '', packagingM3: '', goodsDensity: '', packedDensity: '',
    tariffBasis: '', packagingUsd: '', goodsFreightUsd: '', packagingRub: '', goodsFreightRub: '',
    packagingShareFreight: '', packagingShareCost: '', goodsFreightShareCost: ''
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
    receivedAt: batch.receivedAt || '',
    status: batch.status || CHINA_STATUSES[0],
    chinaDeliveryCny: text(batch.chinaDeliveryCny),
    weightKg: text(batch.weightKg),
    volumeM3: text(batch.volumeM3),
    ratePerKgUsd: text(batch.ratePerKgUsd),
    packingUsd: text(batch.packingUsd),
    otherCargoUsd: text(batch.otherCargoUsd),
    freightUsd: text(batch.freightUsd),
    cargoRate: text(batch.cargoRate),
    // The rate the owner TYPED. «Курс ₽/¥» of a batch may have come from its payments, and
    // offering that one here would make it the typed rate on the next save.
    rubRate: text(batch.manualRate),
    paidCny: text(batch.paidCny),
    unpaidCny: text(batch.unpaidCny),
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
      boxLengthM: text(l.boxLengthM),
      boxWidthM: text(l.boxWidthM),
      boxHeightM: text(l.boxHeightM),
      factoryBoxKg: text(l.factoryBoxKg),
      boxVolumeM3: text(l.boxVolumeM3),
      goodsKg: text(l.goodsKg),
      densityKgM3: text(l.densityKgM3),
      kgPerPiece: text(l.kgPerPiece),
      article: l.article,
      group: l.group
    })),
    goodsKg: text(batch.goodsKg),
    goodsVolumeM3: text(batch.goodsVolumeM3),
    packagingKg: text(batch.packagingKg),
    packagingM3: text(batch.packagingM3),
    goodsDensity: text(batch.goodsDensity),
    packedDensity: text(batch.packedDensity),
    tariffBasis: batch.tariffBasis || '',
    packagingUsd: text(batch.packagingUsd),
    goodsFreightUsd: text(batch.goodsFreightUsd),
    packagingRub: text(batch.packagingRub),
    goodsFreightRub: text(batch.goodsFreightRub),
    packagingShareFreight: text(batch.packagingShareFreight),
    packagingShareCost: text(batch.packagingShareCost),
    goodsFreightShareCost: text(batch.goodsFreightShareCost)
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
    receivedAt: form.receivedAt.trim(),
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
    paidCny: chinaNumber(form.paidCny),
    unpaidCny: chinaNumber(form.unpaidCny),
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
      boxLengthM: chinaNumber(l.boxLengthM),
      boxWidthM: chinaNumber(l.boxWidthM),
      boxHeightM: chinaNumber(l.boxHeightM),
      factoryBoxKg: chinaNumber(l.factoryBoxKg),
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

type ChinaIdentity = { group?: string; article?: string; marking?: string };

/**
 * Which lines the script costs as one product — by exactly the rule of `chinaGroupIds` in
 * `ChinaOrders.gs`: two lines sharing the carrier's marking, our article or the owner's marker
 * are one product, and the sameness chains. A test runs both implementations on the same
 * lines, so the badge on the screen cannot tell a different story from the cost.
 */
export function chinaGroupIds(lines: ChinaIdentity[]): string[] {
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => {
    let at = i;
    while (parent[at] !== at) { parent[at] = parent[parent[at]]; at = parent[at]; }
    return at;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const seen: Record<string, number> = {};
  lines.forEach((line, i) => {
    const l = line || {};
    ([['M', l.marking], ['A', l.article], ['G', l.group]] as [string, string | undefined][]).forEach(([kind, raw]) => {
      const value = String(raw || '').trim().toLowerCase();
      if (!value) return;
      const key = `${kind}:${value}`;
      if (seen[key] === undefined) seen[key] = i; else join(i, seen[key]);
    });
  });
  return lines.map((_, i) => `g${find(i)}`);
}

/** The lines that share their cost with at least one other line. */
export function chinaLevelledIndexes(lines: ChinaIdentity[]): Set<number> {
  const ids = chinaGroupIds(lines);
  const count: Record<string, number> = {};
  ids.forEach((id) => { count[id] = (count[id] || 0) + 1; });
  const out = new Set<number>();
  ids.forEach((id, i) => { if (count[id] > 1) out.add(i); });
  return out;
}

/**
 * A carrier marking names one product within its batch, so a marking written against two
 * different articles of ours is a slip: the script still costs its lines as one, and the owner
 * should be told rather than left to wonder why two articles came out at one price.
 */
export function chinaArticleConflicts(lines: ChinaIdentity[]): string[] {
  const byMarking: Record<string, { marking: string; articles: string[] }> = {};
  lines.forEach((l) => {
    const marking = String(l.marking || '').trim();
    const article = String(l.article || '').trim();
    if (!marking || !article) return;
    const key = marking.toLowerCase();
    if (!byMarking[key]) byMarking[key] = { marking, articles: [] };
    if (byMarking[key].articles.indexOf(article) === -1) byMarking[key].articles.push(article);
  });
  return Object.keys(byMarking)
    .filter((key) => byMarking[key].articles.length > 1)
    .map((key) => `Маркировка ${byMarking[key].marking} стоит на разных артикулах: ${byMarking[key].articles.join(', ')}. ` +
      'Одна маркировка — один товар, поэтому себестоимость у них общая; проверьте выбор артикула.');
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

/**
 * Item 81c: a batch form built from the files the Chinese side sent.
 *
 * The batch file gives the goods and everything the carrier bills. Three things it never
 * holds come from the running account: the number of the order, the date the batch arrived and
 * the carrier's yuan-per-dollar rate, which is written nowhere but inside the text of a
 * payment row. What the owner had already decided about a batch — our articles, the
 * same-product markers, the weight of a box he measured himself and the ruble rate — is
 * carried over from the batch already saved, or a re-import would quietly undo his work.
 */
export interface ChinaImportResult {
  form: ChinaBatchForm;
  /** Where a field came from, in words, for the owner to check rather than trust. */
  notes: string[];
  /** What does not add up in the file itself. */
  warnings: string[];
}

export function chinaFormFromFiles(
  parsed: ChinaParsedBatch,
  report: ChinaParsedReport | null,
  existing: ChinaBatch | null
): ChinaImportResult {
  // Item 81e, flow c: the final file was matched not to a batch of its OWN code but to a
  // 'Черновик' left by an arrival file (NV-0923-4 → the draft NV-0923). The code becomes the
  // final one, the id and the box measurements of the draft stay.
  const fromDraft = !!existing && existing.status === 'Черновик' &&
    existing.code.trim().toLowerCase() !== parsed.code.trim().toLowerCase();

  const notes: string[] = [];
  const freight = chinaFreightOf(report, parsed.code);
  const orderNoFromReport = freight && freight.orderNo ? freight.orderNo : (existing ? existing.orderNo : '');
  const order = chinaOrderOf(report, orderNoFromReport);
  if (order) {
    notes.push(`По отчёту заказ №${order.orderNo}: товар ${order.totalCny} ¥, оплачено ${order.receivedCny} ¥, долг ${order.unpaidCny} ¥`);
  }

  const orderNo = freight && freight.orderNo ? freight.orderNo : (existing ? existing.orderNo : '');
  const arrivedAt = freight && freight.arrivedAt ? freight.arrivedAt : (existing ? existing.arrivedAt : '');
  const cargoRate = freight && freight.cargoRate > 0 ? freight.cargoRate : 0;

  if (freight) {
    notes.push(`Из отчёта: заказ №${freight.orderNo || '—'}` +
      (freight.arrivedAt ? `, прибытие ${freight.arrivedAt}` : ', дата прибытия не указана') +
      (cargoRate > 0 ? `, курс ${cargoRate} ¥/$` : ', курс ¥/$ в отчёте не найден'));
    if (freight.weightKg > 0 && Math.abs(freight.weightKg - parsed.weightKg) > 0.5) {
      notes.push(`Вес в отчёте ${freight.weightKg} кг, в накладной партии ${parsed.weightKg} кг`);
    }
  } else if (report) {
    notes.push(`В отчёте нет партии ${parsed.code}: заказ, дата прибытия и курс ¥/$ не подставлены`);
  } else {
    notes.push('Финансовый отчёт не загружен: заказ, дата прибытия и курс ¥/$ не подставлены');
  }

  // Our articles, the markers and the box measurements belong to the owner, not to the file:
  // they travel by marking, to EVERY line of that marking — a marking of the arrival file can
  // split into several pallet lines of the final one (item 81e), and each must get its data,
  // not only the first.
  const byMarking = new Map<string, ChinaBatchLine>();
  (existing ? existing.lines : []).forEach((l) => { if (!byMarking.has(l.marking)) byMarking.set(l.marking, l); });
  const carry = (marking: string) => byMarking.get(marking) || null;

  // Item 81e: warn when the boxes of a marking do not add up the same way in the draft and the
  // final file — the arrival file may have been counted before a box broke, say.
  const draftBoxesByMarking = new Map<string, number>();
  (existing ? existing.lines : []).forEach((l) => draftBoxesByMarking.set(l.marking, (draftBoxesByMarking.get(l.marking) || 0) + l.boxes));
  const finalBoxesByMarking = new Map<string, number>();
  parsed.lines.forEach((l) => finalBoxesByMarking.set(l.marking, (finalBoxesByMarking.get(l.marking) || 0) + l.boxes));
  if (fromDraft) {
    finalBoxesByMarking.forEach((boxes, marking) => {
      const draftBoxes = draftBoxesByMarking.get(marking);
      if (draftBoxes !== undefined && draftBoxes !== boxes) {
        notes.push(`${marking}: коробок в черновике ${draftBoxes}, в партии ${boxes}`);
      }
    });
  }

  const lines: ChinaLineForm[] = parsed.lines.map((line) => {
    const old = carry(line.marking);
    if (old) notes.push(`Маркировка ${line.marking}: артикул и метки взяты из сохранённой партии`);
    return {
      marking: line.marking,
      name: line.name,
      boxes: line.boxes ? String(line.boxes) : '',
      pcsPerBox: line.pcsPerBox ? String(line.pcsPerBox) : '',
      qty: line.qty ? String(line.qty) : '',
      priceCny: line.priceCny ? String(line.priceCny) : '',
      pallet: '',
      palletWeightKg: line.palletWeightKg ? String(line.palletWeightKg) : '',
      boxWeightKg: old && old.boxWeightKg ? String(old.boxWeightKg) : '',
      boxLengthM: old && old.boxLengthM ? String(old.boxLengthM) : '',
      boxWidthM: old && old.boxWidthM ? String(old.boxWidthM) : '',
      boxHeightM: old && old.boxHeightM ? String(old.boxHeightM) : '',
      factoryBoxKg: old && old.factoryBoxKg ? String(old.factoryBoxKg) : '',
      boxVolumeM3: '', goodsKg: '', densityKgM3: '', kgPerPiece: '',
      article: old ? old.article : '',
      group: old ? old.group : ''
    };
  });

  const form: ChinaBatchForm = {
    ...emptyChinaBatchForm(),
    id: existing ? existing.id : '',
    orderNo,
    code: parsed.code,
    shippedAt: parsed.shippedAt,
    arrivedAt,
    receivedAt: existing ? (existing.receivedAt || '') : '',
    status: arrivedAt ? 'Прибыла' : 'В пути',
    chinaDeliveryCny: parsed.chinaDeliveryCny ? String(parsed.chinaDeliveryCny) : '',
    weightKg: parsed.weightKg ? String(parsed.weightKg) : '',
    volumeM3: parsed.volumeM3 ? String(parsed.volumeM3) : '',
    ratePerKgUsd: parsed.ratePerKgUsd ? String(parsed.ratePerKgUsd) : '',
    packingUsd: parsed.packingUsd ? String(parsed.packingUsd) : '',
    otherCargoUsd: parsed.otherCargoUsd ? String(parsed.otherCargoUsd) : '',
    freightUsd: parsed.freightUsd ? String(parsed.freightUsd) : '',
    cargoRate: cargoRate ? String(cargoRate) : '',
    rubRate: existing && existing.manualRate ? String(existing.manualRate) : '',
    paidCny: order && order.receivedCny ? String(order.receivedCny) : (existing ? text(existing.paidCny) : ''),
    unpaidCny: order && order.unpaidCny ? String(order.unpaidCny) : (existing ? text(existing.unpaidCny) : ''),
    comment: existing ? existing.comment : '',
    lines: lines.length > 0 ? lines : [emptyChinaLine()]
  };

  if (fromDraft) {
    notes.push(`Дополнен черновик ${existing!.code} из данных о приёмке`);
  } else if (existing) {
    notes.push(`Партия ${parsed.code} уже есть в базе — будет обновлена, а не создана заново`);
  }
  if (!form.rubRate) notes.push('Курс ₽/¥ не заполнен: впишите курс, по которому купили юани этой партии');

  return { form, notes, warnings: parsed.warnings.slice() };
}

/**
 * Item 81e, flows a and b: the arrival file at the Yiwu warehouse arrives BEFORE the batch is
 * shipped, so it never carries a batch code of its own — `draftCode` names a new 'Черновик'.
 * When a batch already sits under that code (or that code plus '-N', once it has shipped and
 * got its real code), the box measurements are filled into ITS lines by marking instead.
 */
export function chinaFormFromArrival(
  parsed: ChinaParsedArrival,
  existing: ChinaBatch | null
): ChinaImportResult {
  const notes: string[] = [];

  if (!existing) {
    const lines: ChinaLineForm[] = parsed.lines.map((line) => ({
      ...emptyChinaLine(),
      marking: line.marking,
      name: line.name,
      boxes: line.boxes ? String(line.boxes) : '',
      pcsPerBox: line.pcsPerBox ? String(line.pcsPerBox) : '',
      qty: line.qty ? String(line.qty) : '',
      boxLengthM: line.boxLengthM ? String(line.boxLengthM) : '',
      boxWidthM: line.boxWidthM ? String(line.boxWidthM) : '',
      boxHeightM: line.boxHeightM ? String(line.boxHeightM) : '',
      factoryBoxKg: line.factoryBoxKg ? String(line.factoryBoxKg) : ''
    }));
    const form: ChinaBatchForm = {
      ...emptyChinaBatchForm(),
      code: parsed.draftCode,
      status: 'Черновик',
      receivedAt: parsed.receivedAt,
      lines: lines.length > 0 ? lines : [emptyChinaLine()]
    };
    notes.push(`Черновик ${parsed.draftCode} создан по данным приёмки в Китае — впишите наши артикулы и сохраните`);
    return { form, notes, warnings: parsed.warnings.slice() };
  }

  // The batch file already exists (shipped, or still a draft of its own): fill its lines with
  // the box measurements BY MARKING, keep everything the owner already entered.
  const arrivalByMarking = new Map<string, ChinaParsedArrival['lines'][number]>();
  parsed.lines.forEach((line) => arrivalByMarking.set(line.marking, line));
  const arrivalBoxesByMarking = new Map<string, number>();
  parsed.lines.forEach((line) => arrivalBoxesByMarking.set(line.marking, (arrivalBoxesByMarking.get(line.marking) || 0) + line.boxes));
  const batchBoxesByMarking = new Map<string, number>();
  existing.lines.forEach((l) => batchBoxesByMarking.set(l.marking, (batchBoxesByMarking.get(l.marking) || 0) + l.boxes));
  batchBoxesByMarking.forEach((boxes, marking) => {
    const arrivalBoxes = arrivalBoxesByMarking.get(marking);
    if (arrivalBoxes !== undefined && arrivalBoxes !== boxes) {
      notes.push(`${marking}: коробок в приёмке ${arrivalBoxes}, в партии ${boxes}`);
    }
  });

  const form = chinaBatchToForm(existing);
  form.receivedAt = parsed.receivedAt || form.receivedAt;
  form.lines = form.lines.map((line) => {
    const a = arrivalByMarking.get(line.marking);
    if (!a) return line;
    return {
      ...line,
      boxLengthM: a.boxLengthM ? String(a.boxLengthM) : '',
      boxWidthM: a.boxWidthM ? String(a.boxWidthM) : '',
      boxHeightM: a.boxHeightM ? String(a.boxHeightM) : '',
      factoryBoxKg: a.factoryBoxKg ? String(a.factoryBoxKg) : ''
    };
  });
  notes.push(`Партия ${existing.code} дополнена данными приёмки — будет обновлена, а не создана заново`);

  return { form, notes, warnings: parsed.warnings.slice() };
}
