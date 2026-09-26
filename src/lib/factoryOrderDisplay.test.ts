import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FactoryOrder } from '../types';
import {
  isChinaFactoryOrder, factoryOrderBadge, factoryLateLabel,
  forecastPipelineStatus, forecastPipelineStatusLabel, splitFactoryOrders
} from './factoryOrderDisplay';
import { factoryOnOrderByArticle } from './ozonCoverage';

const order = (patch: Partial<FactoryOrder>): FactoryOrder => ({
  id: 'o1', article: 'ART-1', orderedAt: '2026-09-01', qty: 10, expectedAt: '2026-10-01',
  comment: '', user: '', status: 'active', receivedAt: '', source: '', chinaOrderNo: '',
  chinaBatchCode: '', chinaKey: '', checked: false, ...patch
});

describe('isChinaFactoryOrder', () => {
  it('is true for both China sources, false for a manual row', () => {
    expect(isChinaFactoryOrder(order({ source: 'Китай' }))).toBe(true);
    expect(isChinaFactoryOrder(order({ source: 'Китай прогноз' }))).toBe(true);
    expect(isChinaFactoryOrder(order({ source: '' }))).toBe(false);
  });
});

describe('factoryOrderBadge', () => {
  it('shows the batch code for a shipped China row', () => {
    expect(factoryOrderBadge(order({ source: 'Китай', chinaBatchCode: 'NV-0923-4' }))).toBe('Китай · NV-0923-4');
  });
  it('shows the order number for a forecast row, and nothing for a manual row', () => {
    expect(factoryOrderBadge(order({ source: 'Китай прогноз', chinaOrderNo: '31' }))).toBe('Китай · прогноз, заказ 31');
    expect(factoryOrderBadge(order({ source: '' }))).toBe('');
  });
});

describe('factoryLateLabel', () => {
  it('renders the day count when late, empty string otherwise', () => {
    expect(factoryLateLabel(5)).toBe('задерживается 5 дн');
    expect(factoryLateLabel(0)).toBe('');
    expect(factoryLateLabel(undefined)).toBe('');
  });
});

describe('forecastPipelineStatus / forecastPipelineStatusLabel', () => {
  it('is inPipeline only with both an order number and a ship date and no batch yet', () => {
    expect(forecastPipelineStatus({ orderNo: '31', expectedShipAt: '2026-10-01' }, false)).toBe('inPipeline');
    expect(forecastPipelineStatus({ orderNo: '', expectedShipAt: '2026-10-01' }, false)).toBe('notInPipeline');
    expect(forecastPipelineStatus({ orderNo: '31', expectedShipAt: '' }, false)).toBe('notInPipeline');
  });
  it('is replaced once a batch of the same order exists, regardless of the rest', () => {
    expect(forecastPipelineStatus({ orderNo: '31', expectedShipAt: '2026-10-01' }, true)).toBe('replaced');
  });
  it('labels every status in Russian for the owner', () => {
    expect(forecastPipelineStatusLabel('inPipeline')).toBe('в трубе');
    expect(forecastPipelineStatusLabel('replaced')).toBe('заменён партией');
    expect(forecastPipelineStatusLabel('notInPipeline')).toBe('не в трубе: нет номера заказа или даты');
  });
});

describe('item 85, step 1.7: splitFactoryOrders — the screen follows the pipeline rule', () => {
  const TODAY = '2026-09-26';
  it('a late China order stays waiting (it is in the pipeline), never overdue', () => {
    const china = order({ id: 'c', source: 'Китай', expectedAt: '2026-09-20' });
    const r = splitFactoryOrders([china], TODAY);
    expect(r.waiting.map((o) => o.id)).toEqual(['c']);
    expect(r.overdue).toEqual([]);
  });

  it('a late China forecast row stays waiting too', () => {
    const r = splitFactoryOrders([order({ id: 'f', source: 'Китай прогноз', expectedAt: '2026-09-01' })], TODAY);
    expect(r.waiting).toHaveLength(1);
    expect(r.overdue).toHaveLength(0);
  });

  it('a late manual order is overdue (it dropped out of the pipeline)', () => {
    const r = splitFactoryOrders([order({ id: 'm', expectedAt: '2026-09-25' })], TODAY);
    expect(r.overdue.map((o) => o.id)).toEqual(['m']);
    expect(r.waiting).toEqual([]);
  });

  it('a manual order due today or without a date is waiting', () => {
    const r = splitFactoryOrders([order({ id: 'a', expectedAt: TODAY }), order({ id: 'b', expectedAt: '' })], TODAY);
    expect(r.waiting.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('received, replaced and hidden rows are in neither list', () => {
    const rows = [
      order({ id: 'r', status: 'received' }),
      order({ id: 'x', status: 'replaced' }),
      order({ id: 'h', expectedAt: '2026-09-01' }),
      order({ id: 'k', expectedAt: '2026-10-10' })
    ];
    const r = splitFactoryOrders(rows, TODAY, new Set(['h']));
    expect(r.waiting.map((o) => o.id)).toEqual(['k']);
    expect(r.overdue).toEqual([]);
  });

  it('200 generated sets: «уже заказано» equals the pipeline of factoryOnOrderByArticle to the piece', () => {
    let seed = 1707;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    for (let n = 0; n < 200; n++) {
      const rows: FactoryOrder[] = [];
      const k = 1 + Math.floor(rnd() * 5);
      for (let i = 0; i < k; i++) {
        rows.push(order({
          id: 'o' + i, article: 'A', qty: 1 + Math.floor(rnd() * 50),
          source: pick(['', '', 'Китай', 'Китай прогноз']),
          status: pick(['active', 'active', 'received', 'replaced']),
          orderedAt: pick(['', '2026-08-01', '2026-09-10', '2026-09-20']),
          expectedAt: pick(['', '2026-09-01', TODAY, '2026-10-15']),
          checked: rnd() < 0.2
        }));
      }
      const pipe = factoryOnOrderByArticle(rows, TODAY);
      const hidden = new Set(pipe.hiddenManual.map((o) => o.id));
      const waitingQty = splitFactoryOrders(rows, TODAY, hidden).waiting.reduce((s2, o) => s2 + o.qty, 0);
      expect(waitingQty, `set ${n}`).toBe(pipe.qty.A || 0);
    }
  });

  it('both tables of «Остатки Озон» use it with the hidden ids, and keep no inline copy of the rule', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect(src.match(/splitFactoryOrders\((factoryList|list), todayIso, hiddenManualIds\)/g) || []).toHaveLength(2);
    expect(src).not.toMatch(/list\.filter\(\(o\) => o\.expectedAt && o\.expectedAt < todayIso\)/);
    expect(src).not.toMatch(/factoryList\.filter\(\(o\) => !isChinaFactoryOrder\(o\) && o\.expectedAt/);
  });
});
