// Item 49. Boxes of an expense (shipment): how many physical boxes the positions take, and
// how many of them are fulfilment-centre boxes to charge as the service «короб». Pallets are
// counted from the physical boxes; the service only from the articles whose SKU card says
// they need a box from the fulfilment centre («Коробка ФФ» — «да» by default, «нет» to skip).

import { SKUItem } from '../types';

export interface ShipmentBoxItem {
  article: string;
  quantity: number;
}

export interface ShipmentBoxes {
  /** Physical boxes of every position, rounded up per article. */
  boxes: number;
  /** Boxes charged as the service «короб»: only articles with needsFfBox. */
  ffBoxes: number;
}

/** Undefined (a SKU saved before the column existed) means the box IS needed. */
export const needsFfBox = (sku: Pick<SKUItem, 'needsFfBox'> | undefined): boolean =>
  !sku || sku.needsFfBox !== false;

export function countShipmentBoxes(items: ShipmentBoxItem[], skus: SKUItem[]): ShipmentBoxes {
  let boxes = 0;
  let ffBoxes = 0;
  for (const item of items) {
    const sku = skus.find((s) => s.sku === item.article);
    const pcsPerBox = sku ? Number(sku.pcsPerBox) || 0 : 0;
    const n = pcsPerBox > 0 ? Math.ceil((Number(item.quantity) || 0) / pcsPerBox) : 0;
    boxes += n;
    if (needsFfBox(sku)) ffBoxes += n;
  }
  return { boxes, ffBoxes };
}
