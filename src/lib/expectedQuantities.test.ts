import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { useWarehouseStore } from '../store/useWarehouseStore';

// Plan item 100.3 / R-026 (test-first): the manual stock adjustment must tell the server which stock the user saw.
describe('expected quantities (R-026)', () => {
  it('store commitTransaction forwards options.expectedQuantities in the commit payload', async () => {
    const fetchGas = vi.fn().mockResolvedValue({ status: 'error', message: 'stop' });
    useWarehouseStore.setState({ fetchGas, kits: [] } as never);
    const item = [{ article: 'A', quantity: 1, price: 1 }] as never;
    await useWarehouseStore.getState().commitTransaction(item, 'Приход', 'Склад', '', 'op-1', { expectedQuantities: { A: 10 } } as never);
    expect(fetchGas.mock.calls[0][0]).toBe('commit');
    expect(fetchGas.mock.calls[0][1].expectedQuantities).toEqual({ A: 10 });
  });

  it('store commitTransaction sends no expectedQuantities when none are given', async () => {
    const fetchGas = vi.fn().mockResolvedValue({ status: 'error', message: 'stop' });
    useWarehouseStore.setState({ fetchGas, kits: [] } as never);
    const item = [{ article: 'A', quantity: 1, price: 1 }] as never;
    await useWarehouseStore.getState().commitTransaction(item, 'Приход', 'Склад', '', 'op-2', { comment: 'x' });
    expect(fetchGas.mock.calls[0][1].expectedQuantities).toBeUndefined();
  });

  it('ManualTab adjustment passes expectedQuantities with both the :in and the :out call (source-level check)', () => {
    const src = readFileSync(new URL('../components/ManualTab.tsx', import.meta.url), 'utf8');
    const start = src.indexOf("if (manualForm.type === 'Корректировка остатка')");
    const end = src.indexOf('const { type, destination, deliveryDate } = manualForm;');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    const inCall = block.match(/commitTransaction\(incomingItems[^;]*;/);
    const outCall = block.match(/commitTransaction\(outgoingItems[^;]*;/);
    expect(inCall?.[0]).toMatch(/expectedQuantities/);
    expect(outCall?.[0]).toMatch(/expectedQuantities/);
  });

  it('ManualTab :out call uses expectedAll when there are no incoming items and expectedOut only after an :in call (source-level check)', () => {
    const src = readFileSync(new URL('../components/ManualTab.tsx', import.meta.url), 'utf8');
    const start = src.indexOf("if (manualForm.type === 'Корректировка остатка')");
    const end = src.indexOf('const { type, destination, deliveryDate } = manualForm;');
    const block = src.slice(start, end);
    const outCall = block.match(/commitTransaction\(outgoingItems[^;]*;/)?.[0] ?? '';
    expect(outCall).toMatch(/incomingItems\.length\s*>\s*0\s*\?\s*expectedOut\s*:\s*expectedAll/);
  });
});
