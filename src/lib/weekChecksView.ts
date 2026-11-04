/** Item 97 ticket 08, part C: display model of the server's week checks (banner, reconciliation, not-in-spread). */
import { ContractorInvoice, InvoiceSpreadState } from '../types';

export interface WeekChecksView {
  /** «Перераспределить» banner items; empty = no banner. */
  staleItems: string[];
  reconciliation: { text: string; ok: boolean; problems: string[] }[];
  notInSpread: string[];
}

export function weekChecksView(
  state: InvoiceSpreadState | null,
  invoices: Pick<ContractorInvoice, 'id' | 'number' | 'date'>[],
  formatKop: (kop: number) => string
): WeekChecksView {
  const view: WeekChecksView = { staleItems: [], reconciliation: [], notInSpread: [] };
  if (!state) return view;
  const opText = (opId: string) => {
    const op = state.operations.find((o) => o.opId === opId);
    return op ? `${op.cabinet ? op.cabinet + ' ' : ''}${op.orderNumbers.join(', ')}`.trim() : 'удалённая поставка';
  };
  const invText = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    return inv ? `№ ${inv.number} от ${inv.date}` : invoiceId;
  };
  for (const s of state.stale?.step1 || []) {
    view.staleItems.push(`${opText(s.opId)} — шаг 1 (артикулы: ${s.articles.join(', ')})`);
  }
  for (const s of state.stale?.invoices || []) {
    view.staleItems.push(`${s.opIds.map(opText).join('; ')} — счёт ${invText(s.invoiceId)}`);
  }
  for (const r of state.reconciliation || []) {
    const problems = [
      ...r.missingRows.map((id) => `строка ${id}: строка удалена`),
      ...r.mismatchedRows.map((m) => `${m.article}: в строке ${formatKop(m.cellKop)}, по долям ${formatKop(m.sharesKop)}`)
    ];
    view.reconciliation.push({
      text: `Счёт ${invText(r.invoiceId)}: распределено ${formatKop(r.allocatedKop)} · на строках ${formatKop(r.onRowsKop)}`,
      ok: r.ok,
      problems: r.ok ? [] : problems
    });
  }
  for (const n of state.notInSpread || []) view.notInSpread.push(opText(n.opId));
  return view;
}
