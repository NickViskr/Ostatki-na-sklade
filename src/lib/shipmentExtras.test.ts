// Item 80. The additional costs of a shipment, taken apart and put back together.
// The fixtures are real rows of «БД Склад» (22.09.2026), numbers included.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDestination,
  extrasTotal,
  parseServicesTag,
  parseShipmentExtras,
  rowMoneyAfterExtras
} from './shipmentExtras';

const YANDEX = 'Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x4 (636₽)]';
const KIT = 'Ozon (MaxiStore) [Упаковка: 18 шт. x 37₽ = 666₽ | Услуги: Доставка по городу 1 короб x1 (159₽), Стоимость 1 короба ФФ x1 (106₽)]';

describe('parseShipmentExtras', () => {
  it('reads the object, the packaging total and the services of a real shipment', () => {
    const e = parseShipmentExtras(YANDEX);
    expect(e.main).toBe('Яндекс');
    // The per-piece shape ends with the total: 240, not the 6₽ of one piece.
    expect(e.packaging).toBe(240);
    expect(e.other).toBe(0);
    expect(e.services).toEqual([{ name: 'Доставка по городу 1 короб', quantity: 4, unitCost: 159 }]);
    expect(e.keptGroups).toEqual([]);
    expect(extrasTotal(e)).toBe(876);
  });

  it('reads two services of one shipment and the whole-batch shape of an amount', () => {
    expect(parseShipmentExtras(KIT).services).toEqual([
      { name: 'Доставка по городу 1 короб', quantity: 1, unitCost: 159 },
      { name: 'Стоимость 1 короба ФФ', quantity: 1, unitCost: 106 }
    ]);
    const whole = parseShipmentExtras('Ozon [Упаковка: 500₽ | Прочее: 55₽]');
    expect(whole.packaging).toBe(500);
    expect(whole.other).toBe(55);
    expect(extrasTotal(whole)).toBe(555);
  });

  it('keeps every other tag, in its own group, and finds the extras in any group', () => {
    const d = 'Ozon FBO [Услуги: Стикеровка x10 (500₽)] [Общая поставка: заявки № 123, № 124; доля 5 из 10 шт.]';
    const e = parseShipmentExtras(d);
    expect(e.main).toBe('Ozon FBO');
    expect(e.services).toHaveLength(1);
    expect(e.keptGroups).toEqual([['Общая поставка: заявки № 123, № 124; доля 5 из 10 шт.']]);
    expect(parseShipmentExtras('Склад [Списание - Брак]').keptGroups).toEqual([['Списание - Брак']]);
  });

  it('a destination without a tail and an empty one are read without inventing extras', () => {
    expect(parseShipmentExtras('Wildberries FBS')).toMatchObject({ main: 'Wildberries FBS', packaging: 0, services: [] });
    expect(extrasTotal(parseShipmentExtras(''))).toBe(0);
    expect(extrasTotal(parseShipmentExtras(null))).toBe(0);
  });

  it('the legacy «Доп. услуги» wording without a quantity counts as one item', () => {
    expect(parseServicesTag('Доп. услуги: Погрузка (300₽)')).toEqual([{ name: 'Погрузка', quantity: 1, unitCost: 300 }]);
  });
});

describe('buildDestination', () => {
  it('rebuilds the text a shipment was written with, byte for byte', () => {
    const e = parseShipmentExtras(YANDEX);
    expect(buildDestination(e, e)).toBe(YANDEX);
    const k = parseShipmentExtras(KIT);
    expect(buildDestination(k, k)).toBe(KIT);
  });

  it('an untouched packaging keeps its per-piece wording, a changed one is written as a total', () => {
    const original = parseShipmentExtras(YANDEX);
    const edited = { ...original, services: [{ name: 'Доставка по городу 1 короб', quantity: 6, unitCost: 159 }] };
    expect(buildDestination(edited, original)).toBe(
      'Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x6 (954₽)]'
    );
    expect(buildDestination({ ...edited, packaging: 300 }, original)).toBe(
      'Яндекс [Упаковка: 300₽ | Услуги: Доставка по городу 1 короб x6 (954₽)]'
    );
  });

  it('removing everything leaves the object alone, and kept tags survive it', () => {
    const original = parseShipmentExtras(YANDEX);
    expect(buildDestination({ ...original, packaging: 0, services: [] }, original)).toBe('Яндекс');
    const batch = parseShipmentExtras('Ozon FBO [Услуги: Стикеровка x10 (500₽)] [Общая поставка: доля 5 из 10 шт.]');
    expect(buildDestination({ ...batch, services: [] }, batch)).toBe('Ozon FBO [Общая поставка: доля 5 из 10 шт.]');
    // A service left at zero pieces is not written at all.
    expect(buildDestination({ ...batch, services: [{ name: 'Стикеровка', quantity: 0, unitCost: 50 }] }, batch))
      .toBe('Ozon FBO [Общая поставка: доля 5 из 10 шт.]');
  });
});

describe('rowMoneyAfterExtras', () => {
  // The real Яндекс shipment: 876 ₽ over 24 + 16 pieces → 525,60 and 350,40.
  const rows = [
    { id: 'a', quantity: 24, total: 15261.6 },
    { id: 'b', quantity: 16, total: 9672.8 }
  ];

  it('takes the old share off and puts the new one on, by pieces', () => {
    expect(rowMoneyAfterExtras(rows, 876, 1200)).toEqual([
      { id: 'a', total: 15456, price: 644 },
      { id: 'b', total: 9802.4, price: 612.65 }
    ]);
  });

  it('dropping the extras to zero leaves the bare cost of the goods', () => {
    expect(rowMoneyAfterExtras(rows, 876, 0)).toEqual([
      { id: 'a', total: 14736, price: 614 },
      { id: 'b', total: 9322.4, price: 582.65 }
    ]);
  });

  it('the same extras change nothing at all', () => {
    expect(rowMoneyAfterExtras(rows, 876, 876)).toEqual([
      { id: 'a', total: 15261.6, price: 635.9 },
      { id: 'b', total: 9672.8, price: 604.55 }
    ]);
  });

  it('kit components carry no share: the whole amount lands on the kit row', () => {
    // The real Ozon shipment: components 2661,30 + 228,60 + 129,24, kit row 3950,14 with 931 ₽.
    const kit = [
      { id: 'c1', quantity: 18, total: 2661.3, isComponent: true },
      { id: 'c2', quantity: 18, total: 228.6, isComponent: true },
      { id: 'k', quantity: 18, total: 3950.14 }
    ];
    expect(rowMoneyAfterExtras(kit, 931, 0)).toEqual([{ id: 'k', total: 3019.14, price: 167.73 }]);
  });

  it('rows without pieces are ignored and an empty shipment gives nothing', () => {
    expect(rowMoneyAfterExtras([{ id: 'z', quantity: 0, total: 10 }], 100, 200)).toEqual([]);
    expect(rowMoneyAfterExtras([], 100, 200)).toEqual([]);
  });
});

// Item 80. Wiring guards: the window, the store and the server speak about the same thing.
describe('подключение правки доп. расходов поставки', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const modal = read('src/components/EditTransModal.tsx');
  const store = read('src/store/useWarehouseStore.ts');
  const code = read('Code.gs');

  it('окно собирает расходы из полей и шлёт их одним действием на всю поставку', () => {
    expect(modal).toContain("from '../lib/shipmentExtras'");
    expect(modal).toContain('updateShipmentExtras({');
    expect(modal).toContain('id: editingTrans!.id');
    expect(modal).toContain('Доп. расходы поставки');
    expect(modal).toContain('btn-save-extras');
  });

  it('заявка из общей поставки к правке не допускается ни на экране, ни на сервере', () => {
    expect(modal).toContain('общей поставки');
    expect(code).toMatch(/общая поставка[\s\S]{0,400}?править услуги по одной заявке нельзя/);
  });

  it('стор зовёт действие updateShipmentExtras и обновляет историю ответом сервера', () => {
    expect(store).toContain("fetchGas('updateShipmentExtras'");
    expect(store).toContain('d.newTransactions');
  });

  it('сервер: действие в маршруте, склад в правке не участвует', () => {
    expect(code).toContain("case 'updateShipmentExtras':");
    const body = code.slice(code.indexOf('function updateShipmentExtras(data, username)'));
    expect(body.length).toBeGreaterThan(100);
    // The edit rewrites columns of «История» and never writes to «Остатки»: services are paid
    // to contractors and have never moved a single piece of goods.
    expect(body).not.toContain('writeStockRow');
    expect(body).not.toContain("getSheetByNameRobust(ss, 'Остатки')");
    expect(body).toContain("headers.indexOf('ДопРасходы')");
  });

  it('правка строки расхода снимает с цены долю расходов поставки', () => {
    expect(code).toContain('const overrideQty = Number(totalQtyOverride) || 0;');
    expect(code).toMatch(/editData\.price = roundToTwo\(\(Number\(data\.price\) \|\| 0\) - Number\(editedAdditional\) \/ oldQty\);/);
  });
});
