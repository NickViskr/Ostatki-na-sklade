// ===== Файл «Состав ГМ поставки» =====
//
// Moved out of server.ts on 10.09.2026 together with the int64 fix (see src/lib/ozonJson.ts).
// It lived inside the request handler as a closure, so the one thing worth proving — that the
// cargo number reaches the cell of the file with every digit intact — could not be tested at
// all. The whole chain is here now: the numbers are read out of Ozon's answer by readCargoIds
// and written into the sheet by buildCompositionXlsxBase64, and a test drives both from the
// raw response text.

import * as XLSX from 'xlsx';

/** Зона размещения человеческими словами — так же, как её печатает кабинет Ozon. */
export function zoneToRussian(zone: string): string {
  const z = String(zone || '').toUpperCase();
  if (z === 'SORT') return 'Сортируемый товар';
  if (z === 'NON_SORT') return 'Несортируемый товар';
  if (z === 'KGT') return 'Крупногабаритный товар';
  return String(zone || '');
}

/**
 * Номера грузомест из ответа /v2/cargoes/create/info, разложенные по НАШИМ ключам коробок.
 *
 * Matching is by `key` only: Ozon returns the array in an arbitrary order, and on a live run
 * of 30.07.2026 it came back reversed. `cargo_id` is int64 and must already have arrived as a
 * string from parseOzonJson — String() here cannot repair a number that lost its digits.
 */
export function readCargoIds(createInfoResult: any): Record<string, string> {
  const list = Array.isArray(createInfoResult?.cargoes) ? createInfoResult.cargoes : [];
  const byKey: Record<string, string> = {};
  for (const c of list) {
    const key = String(c?.key ?? '').trim();
    const id = String(c?.value?.cargo_id ?? '').trim();
    if (key && id) byKey[key] = id;
  }
  return byKey;
}

/**
 * Файл «Состав ГМ поставки»: семь колонок в том же порядке, что отдаёт кабинет Ozon.
 * Одна строка = один артикул в одном грузоместе.
 *
 * Every cell of «ШК ГМ» is written as TEXT, never as a number. A 19-digit cargo number has no
 * exact numeric form — in a numeric cell Excel would round it back exactly the way the proxy
 * used to, and the file would be wrong again with nothing in the code looking wrong.
 */
export function buildCompositionXlsxBase64(
  boxes: any[],
  cargoIdByKey: Record<string, string>,
  zones: Record<string, string>
): string {
  const rows: any[][] = [[
    'ШК товара',
    'Артикул товара',
    'Кол-во товаров',
    'Зона размещения',
    'Срок годности ДО в формате YYYY-MM-DD (необязательно)',
    'ШК ГМ',
    'Тип ГМ (не обязательно)'
  ]];

  for (const box of boxes) {
    const cargoId = cargoIdByKey[String(box?.key || '')] || '';
    const items = Array.isArray(box?.items) ? box.items : [];
    for (const it of items) {
      const barcode = String(it?.barcode || '');
      rows.push([
        barcode,
        String(it?.offerId || ''),
        Number(it?.quantity) || 0,
        zoneToRussian(zones[barcode] || ''),
        '',
        cargoId,
        'Коробка'
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Состав ГМ поставки');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
}
