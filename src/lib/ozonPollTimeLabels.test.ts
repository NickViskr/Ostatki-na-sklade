import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Item 86, step A follow-up (owner 2026-09-26: «автоопрос переключил, но время не поменялось»).
 * Code.gs moved the poll to 11:00/20:00 МСК, but four screen labels kept «05:00 и 17:00»: the
 * screen does not read the hours from the server. The hours shown must be the hours set.
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('auto-poll hours: the screen says what Code.gs sets', () => {
  it('Code.gs creates scheduledOzonCheck at 11 and 20 Europe/Moscow and nothing else', () => {
    const gs = read('Code.gs');
    const body = gs.slice(gs.indexOf('function setupOzonSyncTriggers()'), gs.indexOf('function removeOzonSyncTriggers()'));
    expect(body.match(/\.atHour\((\d+)\)/g)).toEqual(['.atHour(11)', '.atHour(20)']);
    expect(body.match(/inTimezone\('Europe\/Moscow'\)/g)).toHaveLength(2);
  });

  it('every label names 11:00 and 20:00 МСК', () => {
    const settings = read('src/components/SettingsTab.tsx');
    expect(settings).toContain('Автоопрос включён: ежедневно в 11:00 и 20:00 МСК');
    expect(settings).toContain('Включить автоопрос (11:00 и 20:00 МСК)');
    expect(settings).toContain('(11:00–12:00 и 20:00–21:00 МСК)');
    expect(read('src/store/useWarehouseStore.ts')).toContain("'Автоопрос включён: 11:00 и 20:00 МСК'");
  });

  it('no old hours are left anywhere on the screen', () => {
    for (const file of ['src/components/SettingsTab.tsx', 'src/store/useWarehouseStore.ts', 'src/components/Sidebar.tsx', 'src/components/OzonStocksTab.tsx', 'src/components/OzonSettingsModal.tsx']) {
      const src = read(file);
      expect(src, file).not.toMatch(/0?5:00[^0-9]/);
      expect(src, file).not.toContain('17:00');
    }
  });
});
