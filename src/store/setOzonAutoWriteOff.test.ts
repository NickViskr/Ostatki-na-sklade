import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWarehouseStore } from './useWarehouseStore';

// Client<->server contract: Code.gs doPost reads payload.data.enabled for this action
// (case 'setOzonAutoWriteOff'), so `enabled` must sit under `data`, never at the top level.
describe('setOzonAutoWriteOff request body', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: 'success', data: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    useWarehouseStore.setState({ sessionToken: 'tok', devMode: false } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sentBody(enabled: boolean) {
    await useWarehouseStore.getState().setOzonAutoWriteOff(enabled);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/gas');
    return JSON.parse(fetchMock.mock.calls[0][1].body);
  }

  it('enabling sends action and data.enabled === true', async () => {
    const body = await sentBody(true);
    expect(body.action).toBe('setOzonAutoWriteOff');
    expect(body.data.enabled).toBe(true);
    expect('enabled' in body).toBe(false);
  });

  it('disabling sends data.enabled === false (not missing, not top-level)', async () => {
    const body = await sentBody(false);
    expect(body.action).toBe('setOzonAutoWriteOff');
    expect(body.data.enabled).toBe(false);
    expect('enabled' in body).toBe(false);
  });
});
