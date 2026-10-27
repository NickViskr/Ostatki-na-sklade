/**
 * Item 97 ticket 01, part C2 (96.10): the popup «Операция не завершена». Written TEST-FIRST, by the tester,
 * against the agreed interface — the component, the store members and the type do not exist yet, so this file
 * is red until the coder builds them.
 *
 * Owner's decisions (ticket 01, «Comments»): a stuck operation shows a popup at EVERY app start until it is
 * resolved; EVERY user sees it; the buttons work for the ADMIN only, the others see the description and a hint to
 * contact the administrator.
 *
 * Interface the tests are written against:
 *  - `PendingOperation` in src/types.ts: { opId, startedAt, user, type, destination, articles: [{ article, quantity }],
 *    stage: 'stock' | 'history' | 'journal' | 'conflict', canComplete, canCancel } (the shape of the server's
 *    getPendingOperations()).
 *  - store: `pendingOperations` filled by fetchStock from getInitialData's `pendingOperations` (absent → []), and
 *    `resolvePendingOperation(opId, action: 'complete' | 'cancel' | 'dismiss'): Promise<boolean>` that calls
 *    fetchGas('resolvePendingOperation', { data: { opId, action } }) and then reloads the data.
 *  - src/components/PendingOperationsModal.tsx exports `PendingOperationsModal` (no props; reads `pendingOperations` and
 *    `currentUser` from the store; renders nothing when the list is empty or «Позже» was pressed in this app session),
 *    mounted in App.tsx for every user.
 * Fixed Russian strings asserted: «Операция не завершена»; «Довести до конца», «Отменить операцию»,
 * «Разобрано, убрать уведомление», «Позже»; «Обратитесь к администратору» for a non-admin. Nothing else of the wording.
 *
 * How the screen is exercised (no DOM in this repo's vitest, environment 'node'): the modal is rendered on the server
 * with renderToStaticMarkup against the frozen initial store state (see ozonSettingsWindow.test.ts). The JSX runtime
 * is wrapped to record every element that carries an `onClick`, so a button's REAL handler can be called afterwards
 * against store spies; `useState` is replaced by one that keeps its values between two renders of the same "session"
 * (a re-render after a click). The modal must render without a DOM: `createPortal` is a pass-through here and
 * `document` is an empty object, so both an inline modal and a portal one render.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const rec = vi.hoisted(() => ({
  clickables: [] as { type: unknown; props: any }[],
  states: [] as unknown[],
  index: 0
}));

const recordClickable = (type: unknown, props: any) => {
  if (props && typeof props.onClick === 'function') rec.clickables.push({ type, props });
};
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, jsxDEV: (type: any, props: any, ...rest: any[]) => { recordClickable(type, props); return actual.jsxDEV(type, props, ...rest); } };
});
vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    jsx: (type: any, props: any, ...rest: any[]) => { recordClickable(type, props); return actual.jsx(type, props, ...rest); },
    jsxs: (type: any, props: any, ...rest: any[]) => { recordClickable(type, props); return actual.jsxs(type, props, ...rest); }
  };
});
vi.mock('react', async (importOriginal) => {
  const actual: any = await importOriginal();
  const real = actual.default ?? actual;
  const useState = (initial: any) => {
    const i = rec.index++;
    if (!(i in rec.states)) rec.states[i] = typeof initial === 'function' ? initial() : initial;
    const set = (value: any) => { rec.states[i] = typeof value === 'function' ? value(rec.states[i]) : value; };
    return [rec.states[i], set];
  };
  return { ...actual, useState, default: { ...real, useState } };
});
vi.mock('react-dom', async (importOriginal) => {
  const actual: any = await importOriginal();
  const createPortal = (node: unknown) => node;
  return { ...actual, createPortal, default: { ...(actual.default ?? actual), createPortal } };
});

import { useWarehouseStore } from '../store/useWarehouseStore';
import { PendingOperationsModal } from '../components/PendingOperationsModal';
import type { PendingOperation } from '../types';

// Read before any test touches the store: the store starts with an empty list.
const INITIAL_PENDING = (useWarehouseStore.getInitialState() as any).pendingOperations;

const TITLE = 'Операция не завершена';
const COMPLETE = 'Довести до конца';
const CANCEL = 'Отменить операцию';
const DISMISS = 'Разобрано, убрать уведомление';
const LATER = 'Позже';
const HINT = 'Обратитесь к администратору';
const ADMIN = { username: 'boss', role: 'admin' };
const PLAIN = { username: 'Кладовщик', role: 'user' };

const entry = (over: Partial<PendingOperation> = {}): PendingOperation => ({
  opId: 'op-1760000000-abc',
  startedAt: '2026-10-22T09:15:00.000Z',
  user: 'Мария',
  type: 'Расход',
  destination: 'Ozon (MaxiStore)',
  articles: [{ article: 'Органайзер_3_пол_белый', quantity: 12 }, { article: 'Полка_выдв_27см', quantity: 72 }],
  stage: 'history',
  canComplete: true,
  canCancel: true,
  ...over
});
// The flags the server reports for each stage.
// Review fix: a fifth stage 'done' — «История» holds the rows and nothing is missing (the memo delete failed once).
const STAGE_FLAGS: Record<string, Pick<PendingOperation, 'canComplete' | 'canCancel'>> = {
  stock: { canComplete: true, canCancel: true },
  history: { canComplete: true, canCancel: true },
  journal: { canComplete: true, canCancel: false },
  conflict: { canComplete: false, canCancel: false },
  done: { canComplete: true, canCancel: false }
};
const atStage = (stage: string, over: Partial<PendingOperation> = {}) => entry({ stage: stage as PendingOperation['stage'], ...STAGE_FLAGS[stage], ...over });

const state: any = useWarehouseStore.getInitialState();
const original = { currentUser: state.currentUser, pendingOperations: state.pendingOperations, resolvePendingOperation: state.resolvePendingOperation, fetchGas: state.fetchGas };
const resolveSpy = vi.fn(async (_opId: string, _action: string) => true);
const fetchGasSpy = vi.fn(async () => ({ status: 'success', data: {} }));

const textOf = (node: any): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props && node.props.children);
};
const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One render of the modal; `fresh` starts a new app session (forgets the values `useState` kept). */
const render = (list: PendingOperation[], user: { username: string; role: string } | null, fresh = true) => {
  Object.assign(state, { pendingOperations: list, currentUser: user, resolvePendingOperation: resolveSpy, fetchGas: fetchGasSpy });
  if (fresh) rec.states = [];
  rec.index = 0;
  rec.clickables = [];
  const html = renderToStaticMarkup(createElement(PendingOperationsModal));
  const button = (label: string) => rec.clickables.find((c) => textOf(c.props.children).includes(label));
  // a control the user can press: present, not disabled
  const usable = (label: string) => { const b = button(label); return !!b && b.props.disabled !== true; };
  return { html, text: plainText(html), button, usable };
};

describe('«Операция не завершена»: the popup (item 97 / 96.10, part C2)', () => {
  beforeAll(() => { vi.stubGlobal('document', {}); });
  afterAll(() => { vi.unstubAllGlobals(); });
  beforeEach(() => { resolveSpy.mockClear(); fetchGasSpy.mockClear(); });
  afterEach(() => {
    Object.assign(state, { ...original, pendingOperations: [] });
  });

  it('renders nothing when no operation is stuck, for an admin and for a plain user', () => {
    expect(render([], ADMIN).html).toBe('');
    expect(render([], PLAIN).html).toBe('');
  });

  it('admin, stage «history»: the title, the operation (opId, user, articles with quantities) and enabled «Довести до конца» and «Отменить операцию», no «Разобрано»', () => {
    const r = render([atStage('history')], ADMIN);
    expect(r.text).toContain(TITLE);
    expect(r.text).toContain('op-1760000000-abc');
    expect(r.text).toContain('Мария');
    for (const [name, qty] of [['Органайзер_3_пол_белый', '12'], ['Полка_выдв_27см', '72']]) {
      const near = new RegExp(`${escapeRe(name)}[^0-9]{0,15}${qty}(?!\\d)|(?<!\\d)${qty}[^0-9]{0,15}${escapeRe(name)}`);
      expect(r.text, `${name} with its quantity ${qty}`).toMatch(near);
    }
    expect(r.usable(COMPLETE), COMPLETE).toBe(true);
    expect(r.usable(CANCEL), CANCEL).toBe(true);
    expect(r.button(DISMISS), DISMISS).toBeUndefined();
    expect(r.text).not.toContain(HINT);
  });

  it('admin, stage «journal» (the history rows exist): «Довести до конца» only — no «Отменить операцию», no «Разобрано»', () => {
    const r = render([atStage('journal')], ADMIN);
    expect(r.usable(COMPLETE), COMPLETE).toBe(true);
    expect(r.button(CANCEL), CANCEL).toBeUndefined();
    expect(r.button(DISMISS), DISMISS).toBeUndefined();
  });

  it('admin, stage «conflict» (the stock moved on): neither complete nor cancel, «Разобрано, убрать уведомление» and «Позже» present', () => {
    const r = render([atStage('conflict')], ADMIN);
    expect(r.button(COMPLETE), COMPLETE).toBeUndefined();
    expect(r.button(CANCEL), CANCEL).toBeUndefined();
    expect(r.usable(DISMISS), DISMISS).toBe(true);
    expect(r.usable(LATER), LATER).toBe(true);
  });

  it('each of the five stages (stock, history, journal, done, conflict) explains itself differently, and the conflict one names the articles to check by hand', () => {
    const labels = [COMPLETE, CANCEL, DISMISS, LATER];
    const explanation = (stage: string) => {
      let text = render([atStage(stage, { articles: [{ article: 'ZZ-ПРОВЕРИТЬ-1', quantity: 3 }, { article: 'ZZ-ПРОВЕРИТЬ-2', quantity: 5 }] })], ADMIN).text;
      for (const label of labels) text = text.split(label).join(' ');
      return text.replace(/\s+/g, ' ').trim();
    };
    const stages = ['stock', 'history', 'journal', 'done', 'conflict'];
    const texts = stages.map(explanation);
    expect(new Set(texts).size, 'five different texts').toBe(5);
    // ... and none of them is empty: a stage without a text of its own reads like a stage nobody knows
    const nobody = explanation('no-such-stage');
    stages.forEach((stage, i) => expect(texts[i], `${stage} has an explanation of its own`).not.toBe(nobody));

    const conflict = render([atStage('conflict', { articles: [{ article: 'ZZ-ПРОВЕРИТЬ-1', quantity: 3 }, { article: 'ZZ-ПРОВЕРИТЬ-2', quantity: 5 }] })], ADMIN).text;
    for (const name of ['ZZ-ПРОВЕРИТЬ-1', 'ZZ-ПРОВЕРИТЬ-2']) {
      // once in the list of the operation, once more in the explanation of what to check
      expect(conflict.split(name).length - 1, `${name} named in the explanation`).toBeGreaterThanOrEqual(2);
    }
  });

  it('plain user: the operation is described, the hint «Обратитесь к администратору» is shown, no action button can be pressed, «Позже» can', () => {
    for (const stage of ['stock', 'history', 'journal', 'conflict'] as const) {
      const r = render([atStage(stage)], PLAIN);
      expect(r.text, stage).toContain(TITLE);
      expect(r.text, stage).toContain('op-1760000000-abc');
      expect(r.text, stage).toContain('Органайзер_3_пол_белый');
      expect(r.text, stage).toContain(HINT);
      for (const label of [COMPLETE, CANCEL, DISMISS]) expect(r.usable(label), `${stage}: ${label}`).toBe(false);
      expect(r.usable(LATER), `${stage}: ${LATER}`).toBe(true);
    }
  });

  // Owner/coordinator decisions: «Разобрано, убрать уведомление» is the admin's way out whenever neither
  // «Довести до конца» nor «Отменить операцию» is available; a damaged memory says so and offers only that and «Позже».
  const labelsOnScreen = () => rec.clickables.map((c) => textOf(c.props.children).trim()).filter(Boolean).sort();
  const damaged = () => entry({
    stage: 'conflict', canComplete: false, canCancel: false, user: '', type: '', destination: '', articles: [],
    ...({ damaged: true, origin: 'other' } as Record<string, unknown>)
  });

  it('a damaged entry says «повреждена»: the admin gets only «Разобрано, убрать уведомление» and «Позже», a plain user the hint and «Позже»', () => {
    const admin = render([damaged()], ADMIN);
    expect(admin.text).toContain(TITLE);
    expect(admin.text).toContain('повреждена');
    expect(admin.text).toContain('op-1760000000-abc');
    expect(admin.text).not.toContain(HINT);
    expect(labelsOnScreen()).toEqual([DISMISS, LATER].sort());
    expect(admin.usable(DISMISS), DISMISS).toBe(true);

    const plain = render([damaged()], PLAIN);
    expect(plain.text).toContain('повреждена');
    expect(plain.text).toContain(HINT);
    for (const label of [COMPLETE, CANCEL, DISMISS]) expect(plain.usable(label), label).toBe(false);
    expect(plain.usable(LATER), LATER).toBe(true);
  });

  it('a dead end that is not a conflict (nothing can be completed or cancelled) gives the admin «Разобрано»; one cancel or complete away from a way out does not', () => {
    // history rows exist, the module that started it must retry: complete off, cancel off
    const stuck = render([atStage('journal', { canComplete: false, canCancel: false })], ADMIN);
    expect(stuck.usable(DISMISS), DISMISS).toBe(true);
    expect(stuck.button(COMPLETE), COMPLETE).toBeUndefined();
    expect(stuck.button(CANCEL), CANCEL).toBeUndefined();

    // the same dead end for a plain user: the hint, nothing to press but «Позже»
    const plain = render([atStage('journal', { canComplete: false, canCancel: false })], PLAIN);
    expect(plain.text).toContain(HINT);
    for (const label of [COMPLETE, CANCEL, DISMISS]) expect(plain.usable(label), label).toBe(false);

    // another module started it (complete off) but the stock can still be put back: «Отменить» is the way, no «Разобрано»
    const cancellable = render([atStage('history', { canComplete: false, canCancel: true })], ADMIN);
    expect(cancellable.usable(CANCEL), CANCEL).toBe(true);
    expect(cancellable.button(COMPLETE), COMPLETE).toBeUndefined();
    expect(cancellable.button(DISMISS), DISMISS).toBeUndefined();
  });

  // Review fix: the text must agree with the buttons. An operation another module started is told to be cancelled and
  // repeated THERE only when «Отменить операцию» exists; otherwise the admin is sent to check it by hand and press «Разобрано».
  const fromOtherModule = (stage: string, flags: Pick<PendingOperation, 'canComplete' | 'canCancel'>) =>
    entry({ stage: stage as PendingOperation['stage'], ...flags, ...({ origin: 'other' } as Record<string, unknown>) });

  it('another module\'s operation: the text says «отмените … там» only when «Отменить операцию» is offered; a dead end sends the admin to «Разобрано» and never says «отмените»', () => {
    const cancellable = render([fromOtherModule('history', { canComplete: false, canCancel: true })], ADMIN);
    expect(cancellable.usable(CANCEL), CANCEL).toBe(true);
    expect(cancellable.text).toMatch(/отмените/i);
    expect(cancellable.text).toMatch(/там/);

    for (const stage of ['journal', 'done', 'conflict']) {
      for (const [who, user] of [['admin', ADMIN], ['plain user', PLAIN]] as const) {
        const deadEnd = render([fromOtherModule(stage, { canComplete: false, canCancel: false })], user);
        expect(deadEnd.button(CANCEL), `${stage}, ${who}: no cancel button`).toBeUndefined();
        expect(deadEnd.text, `${stage}, ${who}: no «отмените»`).not.toMatch(/отмените/i);
      }
      expect(render([fromOtherModule(stage, { canComplete: false, canCancel: false })], ADMIN).usable(DISMISS), `${stage}: «Разобрано»`).toBe(true);
    }
  });

  it('the journal explanation appears for stage «journal» only — no other stage, whoever started the operation, borrows its words', () => {
    const words = (text: string) => new Set(text.toLowerCase().match(/[а-яё]+/g) || []);
    const textOfStage = (stage: string, origin?: string) => {
      let text = render([atStage(stage, origin ? ({ origin } as Record<string, unknown>) : {})], ADMIN).text;
      for (const label of [COMPLETE, CANCEL, DISMISS, LATER]) text = text.split(label).join(' ');
      return text;
    };
    const others = ['stock', 'history', 'done', 'conflict'];
    const known = new Set<string>();
    for (const stage of others) for (const w of words(textOfStage(stage))) known.add(w);
    const journalOnly = [...words(textOfStage('journal'))].filter((w) => !known.has(w));
    expect(journalOnly.length, 'the journal explanation has words of its own').toBeGreaterThan(0);
    for (const stage of others) {
      for (const origin of [undefined, 'commit', 'other']) {
        const seen = [...words(textOfStage(stage, origin))].filter((w) => journalOnly.includes(w));
        expect(seen, `${stage} / ${origin ?? 'no origin'} must not use the journal words`).toEqual([]);
      }
    }
  });

  it('the admin\'s buttons call resolvePendingOperation(opId, action): complete, cancel and dismiss', async () => {
    const h = render([atStage('history')], ADMIN);
    await h.button(COMPLETE)!.props.onClick();
    expect(resolveSpy.mock.calls).toEqual([['op-1760000000-abc', 'complete']]);

    resolveSpy.mockClear();
    const c = render([atStage('history')], ADMIN);
    await c.button(CANCEL)!.props.onClick();
    expect(resolveSpy.mock.calls).toEqual([['op-1760000000-abc', 'cancel']]);

    resolveSpy.mockClear();
    const d = render([atStage('conflict')], ADMIN);
    await d.button(DISMISS)!.props.onClick();
    expect(resolveSpy.mock.calls).toEqual([['op-1760000000-abc', 'dismiss']]);
    expect(fetchGasSpy).not.toHaveBeenCalled();
  });

  // Last of the render checks: if the coder keeps «Позже» in a module variable, it stays set for the rest of the file.
  it('«Позже» hides the popup for this app session without calling the server, and it is kept in memory only (a restart shows it again)', async () => {
    const first = render([atStage('history')], ADMIN);
    expect(first.html).not.toBe('');
    await first.button(LATER)!.props.onClick();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(fetchGasSpy).not.toHaveBeenCalled();
    // the same session renders again (state a store-based flag would have set is carried over to the frozen snapshot)
    Object.assign(state, useWarehouseStore.getState(), { pendingOperations: [atStage('history')], currentUser: ADMIN });
    const again = render([atStage('history')], ADMIN, false);
    expect(again.html).toBe('');

    // an app start forgets it: the owner wants the popup at EVERY start, so nothing may survive a reload
    const source = fs.readFileSync(path.resolve(__dirname, '../components/PendingOperationsModal.tsx'), 'utf8');
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

describe('«Операция не завершена»: the store and the mount', () => {
  const data = (extra: Record<string, unknown>) => ({ status: 'success', data: { stock: [], skus: [], services: [], kits: {}, transactions: [], ...extra } });
  const answer = (initial: Record<string, unknown>) => vi.fn(async (action: string) => {
    if (action === 'getInitialData') return data(initial);
    if (action === 'getServiceRates') return { status: 'success', data: [] };
    return { status: 'success', data: {} };
  });
  afterEach(() => {
    useWarehouseStore.setState({ fetchGas: original.fetchGas, pendingOperations: [] } as never);
  });

  it('fetchStock fills pendingOperations from getInitialData, clears a stale list when the field is absent, and the store starts empty', async () => {
    expect(INITIAL_PENDING).toEqual([]);
    const list = [atStage('history'), atStage('conflict', { opId: 'op-2', articles: [{ article: 'A', quantity: 1 }] })];
    useWarehouseStore.setState({ fetchGas: answer({ pendingOperations: list }) } as never);
    await useWarehouseStore.getState().fetchStock();
    expect((useWarehouseStore.getState() as any).pendingOperations).toEqual(list);

    useWarehouseStore.setState({ fetchGas: answer({}) } as never);
    await useWarehouseStore.getState().fetchStock();
    expect((useWarehouseStore.getState() as any).pendingOperations).toEqual([]);
  });

  it('resolvePendingOperation sends { data: { opId, action } }, reloads the data and answers true; a server refusal answers false', async () => {
    const fetchGas = answer({ pendingOperations: [] });
    useWarehouseStore.setState({ fetchGas, pendingOperations: [atStage('history')] } as never);
    const ok = await (useWarehouseStore.getState() as any).resolvePendingOperation('op-1760000000-abc', 'complete');
    expect(ok).toBe(true);
    expect(fetchGas.mock.calls[0]).toEqual(['resolvePendingOperation', { data: { opId: 'op-1760000000-abc', action: 'complete' } }]);
    const actions = fetchGas.mock.calls.map((c) => c[0]);
    expect(actions.indexOf('getInitialData'), 'the data is reloaded after the resolve').toBeGreaterThan(0);
    expect((useWarehouseStore.getState() as any).pendingOperations).toEqual([]);

    const refused = vi.fn(async () => ({ status: 'error', message: 'Forbidden: Требуются права администратора' }));
    useWarehouseStore.setState({ fetchGas: refused } as never);
    expect(await (useWarehouseStore.getState() as any).resolvePendingOperation('op-1760000000-abc', 'cancel')).toBe(false);
  });

  it('App.tsx mounts the popup for every user, not only for the admin', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
    expect(app).toMatch(/import \{ PendingOperationsModal \} from '\.\/components\/PendingOperationsModal'/);
    expect(app).toMatch(/<PendingOperationsModal\b/);
    expect(app).not.toMatch(/isAdmin\s*&&\s*<PendingOperationsModal/);
  });
});
