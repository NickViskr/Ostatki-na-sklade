import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Правило 11.11 брифа. Хук, вызванный ПОСЛЕ раннего выхода из компонента, — это белый экран.
 *
 * 20.08.2026 так упало окно поставки Ozon: оно смонтировано всегда, а открывается пропсом
 * isOpen. Пока окно закрыто, до раннего `return null` доходит меньше хуков, чем после
 * открытия; React увидел разное их число между отрисовками, выбросил ошибку и снёс всё
 * дерево. Лечилось только перезагрузкой страницы.
 *
 * Правило в брифе — совет, эта проверка — запрет: она падает, если приём вернётся.
 */

const HOOK = /^\s{2}(?:const\s+\[?[\w,\s\]]*\]?\s*=\s*)?use(State|Effect|Memo|Ref|Callback|LayoutEffect|Reducer)\b/;
const EARLY_RETURN = /^\s{2}if\s*\(.*\)\s*return\b|^\s{2}return\s+null\s*;/;
const COMPONENT_START = /^(export\s+)?(const|function)\s+[A-Z]\w*/;

const listTsx = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsx(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
};

interface Offence {
  file: string;
  earlyLine: number;
  hookLine: number;
  hookText: string;
}

const findOffences = (file: string): Offence[] => {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const found: Offence[] = [];
  let insideComponent = false;
  let earlyAt: number | null = null;
  lines.forEach((line, idx) => {
    if (COMPONENT_START.test(line)) {
      insideComponent = true;
      earlyAt = null;
      return;
    }
    if (!insideComponent) return;
    if (earlyAt === null && EARLY_RETURN.test(line)) {
      earlyAt = idx + 1;
    } else if (earlyAt !== null && HOOK.test(line)) {
      found.push({ file, earlyLine: earlyAt, hookLine: idx + 1, hookText: line.trim() });
      earlyAt = null;
    }
  });
  return found;
};

describe('Правило 11.11: хуки не вызываются после раннего выхода из компонента', () => {
  it('во всех компонентах хуки стоят выше любого раннего return', () => {
    const files = listTsx(path.join(process.cwd(), 'src'));
    expect(files.length).toBeGreaterThan(10);
    const offences = files.flatMap(findOffences);
    const report = offences
      .map((o) => `${path.relative(process.cwd(), o.file)}: ранний выход в строке ${o.earlyLine}, хук в строке ${o.hookLine} — ${o.hookText}`)
      .join('\n');
    expect(report).toBe('');
  });

  it('сама проверка ловит нарушение', () => {
    // Проверка на подмену: если бы правило нарушили, тест обязан упасть.
    const tmp = path.join(process.cwd(), 'src', '__hookorder_probe.tsx');
    fs.writeFileSync(tmp, [
      'export const Probe = () => {',
      '  if (!open) return null;',
      '  const [x, setX] = useState(0);',
      '  return null;',
      '};',
      ''
    ].join('\n'));
    try {
      expect(findOffences(tmp)).toHaveLength(1);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
