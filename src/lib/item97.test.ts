import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { ITEM97_ENABLED } from './item97';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('item 97 is hidden', () => {
  it('flag is off', () => {
    expect(ITEM97_ENABLED).toBe(false);
  });

  it('every item-97 block in the screens is behind ITEM97_ENABLED', () => {
    const tab = read('../components/OzonSuppliesTab.tsx');
    expect(tab).toContain('{ITEM97_ENABLED && !isLoading && (\n        <div className="flex items-center gap-2">'); // «Неделя» filter + «Окно недели»
    expect(tab).toContain('{ITEM97_ENABLED && showWeekWindow && <WeekWindowModal');
    expect(tab).toContain("{ITEM97_ENABLED && !isLoading && weekFilter !== 'all' && weekFilter !== 'none' && <WeekFilesBlock");
    expect(tab).toContain('if (!ITEM97_ENABLED) return list;');
    // per-posting week label, «проверьте неделю», «ждёт счёта», «спишите вручную» all sit after this gate
    const gate = tab.indexOf('{ITEM97_ENABLED && (\n');
    const gateEnd = tab.indexOf('Статус Ozon</div>');
    expect(gate).toBeGreaterThan(-1);
    for (const label of ['проверьте неделю', 'ждёт счёта\n', 'спишите вручную\n', 'Изменить неделю']) {
      const i = tab.indexOf(label, gate);
      expect(i).toBeGreaterThan(gate);
      expect(i).toBeLessThan(gateEnd);
    }
    const settings = read('../components/SettingsTab.tsx');
    expect(settings).toMatch(/\{ITEM97_ENABLED && isAdmin && \(\s*<div className="space-y-4 pt-2">\s*<div className="space-y-1">\s*<label[^>]*>\s*Статус автосписания/);
  });
});
