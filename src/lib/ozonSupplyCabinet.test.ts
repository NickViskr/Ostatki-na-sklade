import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  cabinetDisabledReason,
  isCabinetCompatible,
  possibleCabinets,
  resolveSupplyCabinet
} from './ozonSupplyCabinet';

// Пункт 59. На боевых данных 27.08.2026: 13 артикулов, 10 у Mercurius и 3 у MaxiStore,
// ни один не продаётся в двух кабинетах сразу. Фикстуры повторяют это, но обязательно
// проверяют и товар «в обоих магазинах» — модель его допускает, и он должен подходить
// к любой из двух заявок, а не блокировать обе.

const M = ['Mercurius'];
const X = ['MaxiStore'];
const BOTH = ['Mercurius', 'MaxiStore'];

describe('магазин заявки', () => {
  it('пустой выбор магазина не задаёт', () => {
    expect(possibleCabinets([])).toEqual([]);
    expect(resolveSupplyCabinet([])).toBe('');
  });

  it('первая галочка задаёт магазин', () => {
    expect(possibleCabinets([M])).toEqual(['Mercurius']);
    expect(resolveSupplyCabinet([M])).toBe('Mercurius');
  });

  it('несколько товаров одного магазина магазин не меняют', () => {
    expect(resolveSupplyCabinet([M, M, M])).toBe('Mercurius');
  });

  it('товар «в обоих магазинах» сам по себе магазин не определяет', () => {
    expect(possibleCabinets([BOTH])).toEqual(['Mercurius', 'MaxiStore']);
    expect(resolveSupplyCabinet([BOTH])).toBe('');
  });

  it('товар «в обоих» рядом с товаром одного магазина сужает выбор до него', () => {
    expect(resolveSupplyCabinet([BOTH, X])).toBe('MaxiStore');
    expect(resolveSupplyCabinet([M, BOTH])).toBe('Mercurius');
  });

  it('товар без магазина ничего не сужает — незнание не повод привязывать заявку', () => {
    expect(resolveSupplyCabinet([M, []])).toBe('Mercurius');
    expect(possibleCabinets([[], []])).toEqual([]);
  });

  it('пустые строки и пробелы в названиях не создают фантомных магазинов', () => {
    expect(resolveSupplyCabinet([[' Mercurius '], ['Mercurius', '', '  ']])).toBe('Mercurius');
  });
});

describe('пункт 59: товар другого магазина не добавляется', () => {
  it('при пустом выборе доступны все', () => {
    expect(isCabinetCompatible([], M)).toBe(true);
    expect(isCabinetCompatible([], X)).toBe(true);
  });

  it('выбран Mercurius — товары MaxiStore недоступны', () => {
    expect(isCabinetCompatible([M], X)).toBe(false);
    expect(isCabinetCompatible([M], M)).toBe(true);
  });

  it('выбран MaxiStore — товары Mercurius недоступны', () => {
    expect(isCabinetCompatible([X], M)).toBe(false);
    expect(isCabinetCompatible([X], X)).toBe(true);
  });

  it('товар «в обоих магазинах» подходит к любой заявке', () => {
    expect(isCabinetCompatible([M], BOTH)).toBe(true);
    expect(isCabinetCompatible([X], BOTH)).toBe(true);
  });

  it('товар без магазина не блокируется', () => {
    expect(isCabinetCompatible([M], [])).toBe(true);
  });

  it('причина называет магазин заявки', () => {
    expect(cabinetDisabledReason([], X)).toBe('');
    const text = cabinetDisabledReason([M], X);
    expect(text).toContain('Mercurius');
    expect(text).toContain('разные ключи Ozon');
  });
});

// Подключение стережётся по исходному коду: компонентных тестов в проекте нет.
describe('подключение правила магазина к экранам', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const stocks = read('src/components/OzonStocksTab.tsx');
  const modal = read('src/components/OzonSupplyModal.tsx');
  const server = read('server.ts');

  it('«Рекомендации»: галочка гаснет и по магазину, не только по кластеру', () => {
    expect(stocks).toContain('isCabinetCompatible(selectedCabinetSets, cabinetsByArticleMap[s.article] || [])');
  });

  it('«Рекомендации»: магазин заявки берётся правилом, а не первым попавшимся', () => {
    expect(stocks).toContain('resolveSupplyCabinet(');
    expect(stocks).not.toContain('supplyPlan.cabinets.length === 1 ? supplyPlan.cabinets[0]');
  });

  it('Мастер: список товаров ограничен магазином заявки', () => {
    expect(modal).toContain('isCabinetCompatible([[cabinet]], o.cabinets || [])');
  });

  it('Мастер: заявка без определённого магазина не отправляется', () => {
    expect(modal).toMatch(/if \(!cabinet\)[\s\S]{0,200}Магазин заявки не определён/);
  });

  it('Прокси: пустой кабинет отвергается, а не подменяется первым', () => {
    expect(server).toContain('Не указан магазин: заявка на поставку принадлежит одному кабинету');
    expect(server.match(/requireCabinet\(/g) || []).toHaveLength(4); // объявление + три эндпоинта заявки
  });
});
