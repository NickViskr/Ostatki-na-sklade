import { describe, expect, it } from 'vitest';
import { capForSupplyLine, supplyLineKey } from './ozonSupplyLines';

const free = { 'ART-A': 100, 'ART-B': 30, 'ART-ZERO': 0 };

const line = (article: string, clusterId: string, qty: number) => ({ article, clusterId, qty });

describe('Item 45. Потолок строки заявки = свободный остаток минус то, что заняли другие строки', () => {
  it('одна строка: потолок равен свободному остатку', () => {
    const lines = [line('ART-A', 'C1', 40)];
    expect(capForSupplyLine(free, lines, 'ART-A', supplyLineKey(lines[0]))).toBe(100);
  });

  it('тот же товар в другом кластере уменьшает потолок', () => {
    const lines = [line('ART-A', 'C1', 40), line('ART-A', 'C2', 25)];
    expect(capForSupplyLine(free, lines, 'ART-A', supplyLineKey(lines[0]))).toBe(75);
    expect(capForSupplyLine(free, lines, 'ART-A', supplyLineKey(lines[1]))).toBe(60);
  });

  it('другой товар на потолок не влияет', () => {
    const lines = [line('ART-A', 'C1', 40), line('ART-B', 'C1', 30)];
    expect(capForSupplyLine(free, lines, 'ART-A', supplyLineKey(lines[0]))).toBe(100);
  });

  it('новая строка: занятое считается по всем существующим строкам', () => {
    const lines = [line('ART-A', 'C1', 40), line('ART-A', 'C2', 25)];
    expect(capForSupplyLine(free, lines, 'ART-A', '')).toBe(35);
  });

  it('весь остаток разобран — потолок ноль, а не отрицательное число', () => {
    const lines = [line('ART-B', 'C1', 30)];
    expect(capForSupplyLine(free, lines, 'ART-B', '')).toBe(0);
  });

  it('строки просят больше, чем есть: потолок не уходит в минус', () => {
    const lines = [line('ART-B', 'C1', 50)];
    expect(capForSupplyLine(free, lines, 'ART-B', '')).toBe(0);
  });

  it('нулевой свободный остаток — добавить нельзя', () => {
    expect(capForSupplyLine(free, [], 'ART-ZERO', '')).toBe(0);
  });

  it('товара нет в справке об остатках — потолка нет, а не ноль', () => {
    // Неизвестный предел не должен молча превратиться в запрет.
    expect(capForSupplyLine(free, [], 'НЕТ-ТАКОГО', '')).toBe(Number.POSITIVE_INFINITY);
  });

  it('ключ строки собирается из артикула и кластера', () => {
    expect(supplyLineKey({ article: 'ART-A', clusterId: 'C1' })).toBe('ART-A|||C1');
  });

  it('пустые и нечисловые количества считаются нулём', () => {
    const lines = [line('ART-A', 'C1', NaN as any), line('ART-A', 'C2', undefined as any)];
    expect(capForSupplyLine(free, lines, 'ART-A', '')).toBe(100);
  });
});
