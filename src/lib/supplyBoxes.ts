// ===== Item 79c: boxes and pallets of a supply being assembled =====
//
// The wizard's total line says how many pieces leave; the loader also needs the number of
// boxes and pallets. Boxes follow the cargo layout Ozon gets later (buildCargoPlan): every
// line of the supply — one article in one cluster — is packed into full boxes by the «ШТ/КОР»
// norm of the SKU base plus one partial box for the remainder. Pallets divide the boxes of the
// WHOLE order by the «Коробок на паллете (среднее)» figure of «Справочник» (owner's decision,
// 22.09.2026: all clusters of a cross-dock order leave through one drop-off point). Pure.

export interface SupplyBoxLine {
  article: string;
  qty: number;
}

export interface SupplyBoxTotals {
  boxes: number;
  /** null: no pallet norm in «Справочник» — the line asks to set it. */
  pallets: number | null;
  /** Articles with pieces but no «ШТ/КОР» norm: their boxes are not counted. */
  noNormArticles: string[];
}

export function supplyBoxTotals(
  lines: SupplyBoxLine[],
  pcsPerBox: Record<string, number>,
  boxesPerPallet: number
): SupplyBoxTotals {
  let boxes = 0;
  const noNorm: string[] = [];
  for (const line of lines) {
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;
    const perBox = Number(pcsPerBox[line.article]) || 0;
    if (perBox <= 0) {
      if (noNorm.indexOf(line.article) < 0) noNorm.push(line.article);
      continue;
    }
    boxes += Math.ceil(qty / perBox);
  }
  return {
    boxes,
    pallets: boxesPerPallet > 0 ? Math.ceil(boxes / boxesPerPallet) : null,
    noNormArticles: noNorm
  };
}
