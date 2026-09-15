import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================================================
// Item 68, stages 1 and 4 (15.09.2026), from the owner's live case: order 127380557-1 had one
// supply (Tver) that never left the warehouse while nine others did. The buttons sit on the
// order, but act on ROWS — and the screen did not say so. These guards pin the row-level
// action, the honest confirmation text and the OVERDUE rule to the source of the tab.
// ============================================================================================

const tab = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonSuppliesTab.tsx'), 'utf8');

describe('пункт 68, этап 4: OVERDUE у новой строки не требует действий', () => {
  it('isActionableItem закрывает строку и по CANCELLED, и по OVERDUE', () => {
    expect(tab).toMatch(/const isActionableItem = \(i: any\) =>\s*i\.status === 'new' &&\s*!\['CANCELLED', 'OVERDUE'\]\.includes\(/);
    expect(tab).not.toContain("!== 'CANCELLED';");
  });
});

describe('пункт 68, этап 1: действие по поставке, а не по заявке', () => {
  it('у не уехавшей новой поставки есть своя кнопка «Не отгружена»', () => {
    // The button is drawn only for a `new` supply that has NOT departed, in a real (not
    // virtual) order, and only while the row still asks for action.
    expect(tab).toMatch(/!group\.isVirtual && s\.status === 'new' && !isStockDeparted\(s\.ozonStatus\) && isActionableItem\(s\) && \(/);
    expect(tab).toContain('id={`btn-not-shipped-${s.postingId}`}');
    expect(tab).toContain("import { STATUS_DICT, getStatusDetails, getStatusLabel, isAcceptanceStage, isStockDeparted } from '../lib/ozonStatus';");
  });

  it('кнопка помечает ОДНУ строку одиночным действием, а не партией', () => {
    expect(tab).toMatch(/const handleMarkPostingNotShipped = useCallback\(\(s: ExternalShipment, groupLabel: string\) => \{[\s\S]*?markExternalShipment\(s\.postingId, 'ignored'\)/);
    const body = tab.slice(tab.indexOf('const handleMarkPostingNotShipped'), tab.indexOf('const handleLinkAsDuplicate'));
    expect(body).not.toContain('markExternalShipmentsBatch');
  });

  it('строка поставки показывает свой локальный статус', () => {
    expect(tab).toMatch(/\{s\.status === 'processed' && \([\s\S]{0,300}Списана/);
    expect(tab).toMatch(/\{s\.status === 'ignored' && \([\s\S]{0,300}Не отгружена/);
  });

  it('подтверждение групповой «Игнорировать» перечисляет строки и не обещает «все поставки заявки»', () => {
    expect(tab).not.toContain('Все новые поставки заявки №');
    expect(tab).toMatch(/Будут помечены как проигнорированные только ещё не оформленные поставки заявки № \$\{group\.label\}: \$\{listed\}\. Оформленные поставки этой заявки не изменятся\./);
    expect(tab).toMatch(/const listed = newPostings\s*\.map\(p => `\$\{p\.storageWarehouse \|\| 'склад не указан'\} \(№ \$\{p\.postingId\}\)`\)/);
  });
});
