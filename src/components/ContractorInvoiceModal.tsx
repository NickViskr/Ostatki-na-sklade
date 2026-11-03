import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ContractorInvoice, WeekFile } from '../types';
import {
  checkContractorInvoice, contractorInvoiceNormalise, ContractorInvoiceDraft, ContractorInvoiceLine,
  formatKopecks, parseKopecks, supplyTotalKopecks
} from '../lib/contractorInvoice';
import { invoiceWeekOptions, isoWeekLabel, serviceWeekOfInvoice } from '../lib/isoWeek';
import { formatCurrency } from '../lib/utils';

const EMPTY_LINE: ContractorInvoiceLine = { name: '', qty: '', unit: '', price: '', sum: '' };
const EMPTY_DRAFT: ContractorInvoiceDraft = {
  header: { number: '', date: '', supplier: '', buyer: '', total: '', vat: '', itemCount: '' },
  lines: [{ ...EMPTY_LINE }]
};

// Roubles stored as a number -> text with a comma and two decimals, as the checks expect.
const moneyText = (value: number | string): string =>
  typeof value === 'number' ? value.toFixed(2).replace('.', ',') : String(value ?? '');

/** Draft for the form from a saved invoice (pure; numbers back to text). */
export function draftFromSavedInvoice(inv: ContractorInvoice): ContractorInvoiceDraft {
  return {
    header: {
      number: inv.number, date: inv.date, supplier: inv.supplier, buyer: inv.buyer,
      total: moneyText(inv.total), vat: String(inv.vat ?? ''), itemCount: String(inv.itemCount ?? '')
    },
    lines: inv.lines.map((l) => ({
      name: l.name, qty: String(l.qty), unit: l.unit, price: moneyText(l.price), sum: moneyText(l.sum),
      toSupply: l.toSupply, packaging: l.packaging
    }))
  };
}

interface Props {
  /** Week folder the PDF lies in. */
  week: string;
  /** The PDF to recognise / show; null for manual entry. */
  file: WeekFile | null;
  /** A saved invoice being opened (saving goes through the replace flow). */
  saved?: ContractorInvoice | null;
  onClose: () => void;
  /** Called after a successful save so the caller reloads the lists. */
  onSaved: () => void;
}

const inputCls = 'w-full border border-slate-200 rounded-lg px-2 py-1 text-sm';
// A line outside edit mode: the same input, styled as plain text.
const readOnlyCls = 'w-full border border-transparent bg-transparent px-2 py-1 text-sm text-slate-800';
const LINE_GRID = 'sm:grid-cols-[2rem_1fr_5rem_4rem_6rem_6rem_5rem]';

export const ContractorInvoiceModal: React.FC<Props> = ({ week, file, saved, onClose, onSaved }) => {
  const fetchGas = useWarehouseStore((s) => s.fetchGas);
  const readContractorInvoice = useWarehouseStore((s) => s.readContractorInvoice);
  const saveContractorInvoice = useWarehouseStore((s) => s.saveContractorInvoice);
  const role = (useWarehouseStore((s) => s.currentUser?.role) || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'администратор';

  const fileId = file?.id || saved?.fileId || '';
  const [draft, setDraft] = useState<ContractorInvoiceDraft>(saved ? draftFromSavedInvoice(saved) : EMPTY_DRAFT);
  const [serviceWeek, setServiceWeek] = useState<string>(saved?.week || '');
  const weekPickedByHand = useRef(!!saved);
  const [reading, setReading] = useState(!!file && !saved);
  const [saving, setSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // Indexes of lines shown as editable inputs (by default a line is read-only) and the row with an open «⋯» menu.
  const [editing, setEditing] = useState<Set<number>>(new Set());
  const [menuRow, setMenuRow] = useState<number | null>(null);

  // Close the «⋯» menu on a click anywhere outside it.
  useEffect(() => {
    if (menuRow === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-line-menu]')) setMenuRow(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuRow]);

  const weekOptions = useMemo(() => {
    const opts = invoiceWeekOptions(Date.now());
    return saved?.week && !opts.includes(saved.week) ? [saved.week, ...opts] : opts;
  }, [saved]);

  // The PDF for the left column; the object URL is revoked on close.
  useEffect(() => {
    if (!fileId) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      const res = await fetchGas('getWeekFile', { data: { week, fileId } });
      if (cancelled || res.status !== 'success' || !res.data?.base64) return;
      try {
        const bytes = Uint8Array.from(atob(res.data.base64), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        setPdfUrl(url);
      } catch { /* the form still works without the preview */ }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [fetchGas, week, fileId]);

  // Recognition on open (only for a not yet saved invoice with a PDF).
  useEffect(() => {
    if (!file || saved) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await readContractorInvoice(week, file.id);
        const parsed = contractorInvoiceNormalise(raw);
        if (cancelled) return;
        if (!parsed) toast.error('Не удалось распознать счёт — заполните форму вручную');
        else {
          setDraft(parsed.lines.length ? parsed : { ...parsed, lines: [{ ...EMPTY_LINE }] });
          const suggested = serviceWeekOfInvoice(parsed.header.date);
          if (suggested && invoiceWeekOptions(Date.now()).includes(suggested)) setServiceWeek(suggested);
        }
      } catch (e) {
        if (!cancelled) toast.error(`${(e as Error).message || 'Не удалось распознать счёт'} — заполните форму вручную`);
      } finally {
        if (!cancelled) setReading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file, saved, week, readContractorInvoice]);

  const check = useMemo(() => checkContractorInvoice(draft), [draft]);
  const suggestedWeek = serviceWeekOfInvoice(draft.header.date);

  const setHeader = (key: keyof ContractorInvoiceDraft['header'], value: string) => {
    setDraft((d) => ({ ...d, header: { ...d.header, [key]: value } }));
    // Re-suggest the week while the user has not picked one by hand.
    if (key === 'date' && !weekPickedByHand.current) {
      const s = serviceWeekOfInvoice(value);
      setServiceWeek(s && weekOptions.includes(s) ? s : '');
    }
  };
  const setLine = (i: number, key: 'name' | 'qty' | 'unit' | 'price' | 'sum', value: string) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)) }));
  const setToSupply = (i: number, value: boolean) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, idx) => (idx === i ? { ...l, toSupply: value } : l)) }));
  // A new line opens in edit mode.
  const addLine = () => {
    setEditing((prev) => new Set(prev).add(draft.lines.length));
    setDraft((d) => ({ ...d, lines: [...d.lines, { ...EMPTY_LINE }] }));
  };
  const setEditingRow = (i: number, on: boolean) =>
    setEditing((prev) => { const next = new Set(prev); if (on) next.add(i); else next.delete(i); return next; });
  const removeLine = (i: number) => {
    if (!window.confirm('Удалить строку из счёта?')) return;
    setDraft((d) => ({ ...d, lines: d.lines.filter((_, idx) => idx !== i) }));
    // Later rows move up by one: shift their edit flags too.
    setEditing((prev) => new Set([...prev].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k))));
  };

  const handleSave = async () => {
    const basePayload = { week: serviceWeek, fileWeek: week, fileId, header: draft.header, lines: draft.lines };
    const needAdmin = () => { toast.error('Заменить счёт может только администратор'); };
    let extra: { replace?: boolean; addAnother?: boolean; editId?: string } = {};
    if (saved) {
      if (!isAdmin) return needAdmin();
      // Item 97 ticket 06: a correction of a saved invoice replaces THAT invoice even if its number/date changed.
      extra = { editId: saved.id };
    }
    setSaving(true);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await saveContractorInvoice({ ...basePayload, ...extra });
        if (res.status !== 'success') { toast.error(res.message || 'Не удалось сохранить счёт'); return; }
        const data = res.data || {};
        if (data.saved) {
          toast.success('Счёт сохранён');
          onSaved();
          onClose();
          return;
        }
        if (data.needsConfirm === 'replace') {
          if (!isAdmin) return needAdmin();
          const ex = data.existing || {};
          if (!window.confirm(`Счёт № ${ex.number} от ${ex.date} уже сохранён (неделя ${ex.week}, ${formatCurrency(Number(ex.total))} ₽). Заменить его?`)) return;
          extra = { replace: true };
        } else if (data.needsConfirm === 'another') {
          const list: any[] = Array.isArray(data.existing) ? data.existing : [data.existing];
          const numbers = list.map((e) => e?.number).filter(Boolean).join(', ');
          if (!window.confirm(`У недели ${serviceWeek} уже есть счёт № ${numbers}. Добавить ещё один?`)) return;
          extra = { ...extra, addAnother: true };
        } else {
          toast.error('Неожиданный ответ сервера');
          return;
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const lineErrors = (i: number) => check.lineErrors.filter((e) => e.index === i);
  const supplyKop = supplyTotalKopecks(draft);
  const totalKop = parseKopecks(draft.header.total);
  const canSave = check.ok && !!serviceWeek && !saving && !reading;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-7xl h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <span className="font-bold text-slate-800">Счёт подрядчика{reading ? ' — распознаю…' : ''}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 font-bold cursor-pointer">Закрыть</button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {fileId && (
            <div className="md:w-1/2 h-64 md:h-auto border-b md:border-b-0 md:border-r border-slate-200">
              {pdfUrl
                ? <iframe src={pdfUrl} title="Счёт" className="w-full h-full" />
                : <div className="p-4 text-sm text-slate-400">Загружаю PDF…</div>}
            </div>
          )}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {([
                ['number', 'Номер'], ['date', 'Дата (дд.мм.гггг)'], ['supplier', 'Поставщик'], ['buyer', 'Покупатель'],
                ['total', 'Всего к оплате'], ['vat', 'НДС'], ['itemCount', 'Всего наименований']
              ] as const).map(([key, label]) => (
                <label key={key} className={key === 'supplier' || key === 'buyer' ? 'col-span-2' : ''}>
                  <span className="text-slate-500 font-bold">{label}</span>
                  <input className={inputCls} value={draft.header[key]} onChange={(e) => setHeader(key, e.target.value)} />
                </label>
              ))}
              <label className="col-span-2">
                <span className="text-slate-500 font-bold">Неделя оказания услуг (подтвердите)</span>
                <select
                  className={inputCls}
                  value={serviceWeek}
                  onChange={(e) => { weekPickedByHand.current = true; setServiceWeek(e.target.value); }}
                >
                  <option value="">— выберите неделю —</option>
                  {weekOptions.map((w) => <option key={w} value={w}>{isoWeekLabel(w)}</option>)}
                </select>
                {suggestedWeek && serviceWeek === suggestedWeek && (
                  <span className="text-xs text-amber-600">
                    Проверьте неделю: счёт выставлен {draft.header.date}, предложена предыдущая неделя
                  </span>
                )}
              </label>
            </div>

            <div className="space-y-2">
              <div className={`hidden sm:grid ${LINE_GRID} gap-1 text-xs font-bold text-slate-500`}>
                <span title="На поставку">Пост.</span><span>Наименование</span><span>Кол-во</span><span>Ед.</span><span>Цена</span><span>Сумма</span><span />
              </div>
              {draft.lines.map((l, i) => {
                const isEditing = editing.has(i);
                const fieldCls = isEditing ? inputCls : readOnlyCls;
                return (
                  <div key={i} className={l.toSupply === false ? 'opacity-50' : ''}>
                    <div className={`grid grid-cols-2 ${LINE_GRID} gap-1 items-center`}>
                      <input
                        type="checkbox"
                        title="На поставку"
                        className="justify-self-center cursor-pointer"
                        checked={l.toSupply !== false}
                        onChange={(e) => setToSupply(i, e.target.checked)}
                      />
                      <input className={`${fieldCls} col-span-2 sm:col-span-1`} placeholder="Наименование" readOnly={!isEditing} value={l.name} onChange={(e) => setLine(i, 'name', e.target.value)} />
                      <input className={fieldCls} placeholder="Кол-во" readOnly={!isEditing} value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} />
                      <input className={fieldCls} placeholder="Ед." readOnly={!isEditing} value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} />
                      <input className={fieldCls} placeholder="Цена" readOnly={!isEditing} value={l.price} onChange={(e) => setLine(i, 'price', e.target.value)} />
                      <input className={fieldCls} placeholder="Сумма" readOnly={!isEditing} value={l.sum} onChange={(e) => setLine(i, 'sum', e.target.value)} />
                      {isEditing ? (
                        <button onClick={() => setEditingRow(i, false)} className="text-sm text-indigo-600 font-bold cursor-pointer">Готово</button>
                      ) : (
                        <div className="relative" data-line-menu>
                          <button
                            onClick={() => setMenuRow(menuRow === i ? null : i)}
                            title="Действия со строкой"
                            className="px-2 text-slate-600 font-bold cursor-pointer"
                          >⋯</button>
                          {menuRow === i && (
                            <div className="absolute right-0 z-10 mt-1 w-36 bg-white border border-slate-200 rounded-lg shadow-lg text-sm">
                              <button
                                onClick={() => { setMenuRow(null); setEditingRow(i, true); }}
                                className="block w-full text-left px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                              >Корректировка</button>
                              <button
                                onClick={() => { setMenuRow(null); removeLine(i); }}
                                className="block w-full text-left px-3 py-1.5 text-red-600 hover:bg-slate-50 cursor-pointer"
                              >Удалить</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {lineErrors(i).map((e, k) => <div key={k} className="text-xs text-red-600">{e.message}</div>)}
                  </div>
                );
              })}
              <button onClick={addLine} className="text-sm text-indigo-600 font-bold hover:underline cursor-pointer">+ Добавить строку</button>
            </div>

            <div className="space-y-1 text-sm">
              {check.headerErrors.map((m, i) => <div key={i} className="text-red-600">{m}</div>)}
              {check.notes.map((m, i) => <div key={i} className="text-slate-500">{m}</div>)}
              {supplyKop !== null && totalKop !== null && (
                <div className="text-slate-700 font-bold">На поставку: {formatKopecks(supplyKop)} ₽ из {formatKopecks(totalKop)} ₽</div>
              )}
              {!serviceWeek && <div className="text-red-600">Выберите неделю оказания услуг</div>}
              <button
                onClick={handleSave}
                disabled={!canSave}
                className={`px-4 py-2 rounded-xl font-bold ${canSave ? 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer' : 'bg-slate-100 text-slate-400'}`}
              >
                {saving ? 'Сохраняю…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
