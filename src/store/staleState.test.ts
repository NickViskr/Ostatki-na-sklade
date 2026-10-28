import { describe, expect, it, vi } from 'vitest';
import { useWarehouseStore } from './useWarehouseStore';
import { useChinaStore } from './useChinaStore';

// The real fetchStock; the China test replaces it with a spy, so later tests restore it.
const realFetchStock = useWarehouseStore.getState().fetchStock;

const stockOf = (quantity: number) => [{ article: 'A', quantity, avgCost: 100, capitalization: quantity * 100 }];
const initialData = (quantity: number) => ({
  status: 'success',
  data: { stock: stockOf(quantity), skus: [], services: [], kits: {}, transactions: { rows: [], hasMore: false } },
});

// A promise whose resolution the test controls (a "late" server answer).
const gate = () => {
  let release: () => void = () => {};
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
};
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('stale browser state (item 100.3, R-057 / R-059)', () => {
  it('R-057: a fetchStock started before a commit but answering after it does not overwrite the commit result', async () => {
    const late = gate();
    const fetchGas = vi.fn(async (action: string) => {
      if (action === 'getInitialData') { await late.promise; return initialData(10); }
      if (action === 'getServiceRates') return { status: 'success', data: [] };
      if (action === 'commit') return { status: 'success', data: { stock: stockOf(15), newTransactions: [{ id: 'T1', article: 'A', type: 'Приход' }] } };
      return { status: 'success', data: {} };
    });
    useWarehouseStore.setState({ sessionToken: 'tok', stock: [], transactions: [], kits: [], fetchGas, fetchStock: realFetchStock } as never);
    const refresh = useWarehouseStore.getState().fetchStock();
    await tick();
    await useWarehouseStore.getState().commitTransaction([{ article: 'A', quantity: 5, price: 100 }] as never, 'Приход', 'Склад', '', 'op-57');
    expect(useWarehouseStore.getState().stock[0].quantity).toBe(15);
    late.release();
    await refresh;
    const st = useWarehouseStore.getState();
    expect(st.stock[0].quantity).toBe(15);
    expect(st.transactions.map((t) => t.id)).toEqual(['T1']);
    expect(st.isSyncing).toBe(false);
  });

  it('R-057: of two overlapping fetchStock calls, an older answer arriving last does not overwrite the newer one', async () => {
    const first = gate();
    let call = 0;
    const fetchGas = vi.fn(async (action: string) => {
      if (action === 'getInitialData') {
        call += 1;
        if (call === 1) { await first.promise; return initialData(10); }
        return initialData(12);
      }
      return { status: 'success', data: [] };
    });
    useWarehouseStore.setState({ sessionToken: 'tok', stock: [], transactions: [], kits: [], fetchGas, fetchStock: realFetchStock } as never);
    const older = useWarehouseStore.getState().fetchStock();
    await tick();
    await useWarehouseStore.getState().fetchStock();
    expect(useWarehouseStore.getState().stock[0].quantity).toBe(12);
    first.release();
    await older;
    expect(useWarehouseStore.getState().stock[0].quantity).toBe(12);
    expect(useWarehouseStore.getState().isSyncing).toBe(false);
  });

  it('control: a single fetchStock with no write in between applies its answer', async () => {
    const fetchGas = vi.fn(async (action: string) => (action === 'getInitialData' ? initialData(10) : { status: 'success', data: [] }));
    useWarehouseStore.setState({ sessionToken: 'tok', stock: [], transactions: [], kits: [], fetchGas, fetchStock: realFetchStock } as never);
    await useWarehouseStore.getState().fetchStock();
    expect(useWarehouseStore.getState().stock[0].quantity).toBe(10);
    expect(useWarehouseStore.getState().isSyncing).toBe(false);
  });

  it('R-059: saving a posted China batch re-reads the warehouse stock', async () => {
    const posted = { id: 'CB1', postingState: 'предварительно' };
    const fetchStock = vi.fn(async () => {});
    const fetchGas = vi.fn(async () => ({ status: 'success', data: { batches: [posted], payments: [], settings: {}, money: {} } }));
    useWarehouseStore.setState({ sessionToken: 'tok', fetchGas, fetchStock, fetchFactoryOrders: async () => {} } as never);
    const ok = await useChinaStore.getState().saveChinaBatch({ id: 'CB1' } as never);
    await tick();
    expect(ok).toBe(true);
    expect(fetchStock).toHaveBeenCalled();
  });

  it('R-057: a fetchStock started before a transaction delete but answering after it does not overwrite the delete result', async () => {
    const late = gate();
    const fetchGas = vi.fn(async (action: string) => {
      if (action === 'getInitialData') { await late.promise; return initialData(10); }
      if (action === 'deleteTransaction') return { status: 'success', data: { stock: stockOf(7), transactions: { rows: [] } } };
      return { status: 'success', data: [] };
    });
    useWarehouseStore.setState({ sessionToken: 'tok', stock: [], transactions: [{ id: 'T9', article: 'A', type: 'Приход' }], kits: [], fetchGas, fetchStock: realFetchStock } as never);
    const refresh = useWarehouseStore.getState().fetchStock();
    await tick();
    await useWarehouseStore.getState().handleDeleteTransaction('T9');
    expect(useWarehouseStore.getState().stock[0].quantity).toBe(7);
    late.release();
    await refresh;
    expect(useWarehouseStore.getState().stock[0].quantity).toBe(7);
  });
});
