import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ContractorInvoice, WeekFile } from '../types';
import {
  checkContractorInvoice, contractorInvoiceNormalise, ContractorInvoiceDraft, ContractorInvoiceLine
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
      name: l.name, qty: String(l.qty), unit: l.unit, price: moneyText(l.price), sum: moneyText(l.sum)
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
  const setLine = (i: number, key: keyof ContractorInvoiceLine, value: string) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)) }));
  const addLine = () => setDraft((d) => ({ ...d, lines: [...d.lines, { ...EMPTY_LINE }] }));
  const removeLine = (i: number) => setDraft((d) => ({ ...d, lines: d.lines.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    const basePayload = { week: serviceWeek, fileWeek: week, fileId, header: draft.header, lines: draft.lines };
    const needAdmin = () => { toast.error('Заменить счёт может только администратор'); };
    let extra: { replace?: boolean; addAnother?: boolean } = {};
    if (saved) {
      if (!isAdmin) return needAdmin();
      extra = { replace: true };
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
              <div className="hidden sm:grid grid-cols-[1fr_5rem_4rem_6rem_6rem_2rem] gap-1 text-xs font-bold text-slate-500">
                <span>Наименование</span><span>Кол-во</span><span>Ед.</span><span>Цена</span><span>Сумма</span><span />
              </div>
              {draft.lines.map((l, i) => (
                <div key={i}>
                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_5rem_4rem_6rem_6rem_2rem] gap-1">
                    <input className={`${inputCls} col-span-2 sm:col-span-1`} placeholder="Наименование" value={l.name} onChange={(e) => setLine(i, 'name', e.target.value)} />
                    <input className={inputCls} placeholder="Кол-во" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} />
                    <input className={inputCls} placeholder="Ед." value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} />
                    <input className={inputCls} placeholder="Цена" value={l.price} onChange={(e) => setLine(i, 'price', e.target.value)} />
                    <input className={inputCls} placeholder="Сумма" value={l.sum} onChange={(e) => setLine(i, 'sum', e.target.value)} />
                    <button onClick={() => removeLine(i)} title="Удалить строку" className="text-red-600 font-bold cursor-pointer">×</button>
                  </div>
                  {lineErrors(i).map((e, k) => <div key={k} className="text-xs text-red-600">{e.message}</div>)}
                </div>
              ))}
              <button onClick={addLine} className="text-sm text-indigo-600 font-bold hover:underline cursor-pointer">+ Добавить строку</button>
            </div>

            <div className="space-y-1 text-sm">
              {check.headerErrors.map((m, i) => <div key={i} className="text-red-600">{m}</div>)}
              {check.notes.map((m, i) => <div key={i} className="text-slate-500">{m}</div>)}
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
