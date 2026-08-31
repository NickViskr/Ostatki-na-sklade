import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildDestinationOptions, destinationMain, parseDestination } from './utils';

/**
 * Фильтр «Истории» по объектам (29.08.2026, по жалобе владельца).
 *
 * Два разных дефекта давали одну картину. Новый склад «Wildberries FBS» не появлялся в списке
 * вообще, потому что список брался из настройки в localStorage, которая пополняется ровно
 * одним способом — когда объект впервые печатают руками на ЭТОМ компьютере. А по складам,
 * которые в списке были, часть месяцев пропадала, потому что фильтр сравнивал ВСЮ строку
 * объекта целиком, а к ней при подтверждении операции дописывается хвост: услуги, доп.
 * расходы, пометка общей поставки.
 */
describe('разбор объекта операции', () => {
  it('объект без хвоста остаётся собой', () => {
    expect(destinationMain('Wildberries FBS')).toBe('Wildberries FBS');
    expect(parseDestination('Wildberries FBS').tags).toEqual([]);
  });

  it('хвост услуг в скобках отрезается', () => {
    expect(destinationMain('Wildberries FBS [Услуги: Упаковка x2 (300₽)]')).toBe('Wildberries FBS');
  });

  it('несколько хвостов через палку отрезаются целиком', () => {
    const d = 'Ozon FBO Хоругвино [Доп. расходы: 1500 руб | Услуги: Стикеровка x10 (500₽)]';
    expect(destinationMain(d)).toBe('Ozon FBO Хоругвино');
    expect(parseDestination(d).tags).toHaveLength(2);
  });

  it('пометка общей поставки отрезается', () => {
    // Именно она дописывается при списании нескольких заявок Ozon одной поставкой.
    const d = 'Ozon FBO [Общая поставка: заявки № 123, № 124; доля этой заявки 5 из 10 шт., 50.00 руб. из 100.00 руб.]';
    expect(destinationMain(d)).toBe('Ozon FBO');
  });

  it('два хвоста подряд отрезаются оба', () => {
    // Так выходит, когда у операции есть и услуги, и общая поставка.
    const d = 'Wildberries FBS [Услуги: Упаковка (100₽)] [Общая поставка: заявки № 7; доля 1 из 2 шт., 1.00 руб. из 2.00 руб.]';
    expect(destinationMain(d)).toBe('Wildberries FBS');
  });

  it('хвост услуг без скобок тоже отрезается', () => {
    expect(destinationMain('Склад. Услуги: Приёмка (200₽)')).toBe('Склад');
  });

  it('пустой объект не ломает разбор', () => {
    expect(destinationMain('')).toBe('');
    expect(destinationMain(null)).toBe('');
    expect(destinationMain(undefined)).toBe('');
    expect(destinationMain('   ')).toBe('');
  });

  it('лишние пробелы по краям снимаются', () => {
    expect(destinationMain('  Склад  ')).toBe('Склад');
    expect(destinationMain('Склад   [Услуги: X]')).toBe('Склад');
  });
});

describe('список объектов для фильтра', () => {
  const rows = [
    { destination: 'Wildberries FBS' },
    { destination: 'Wildberries FBS [Услуги: Упаковка (100₽)]' },
    { destination: 'Ozon FBO [Общая поставка: заявки № 7; доля 1 из 2 шт., 1.00 руб. из 2.00 руб.]' },
    { destination: 'Списание - Брак' },
    { destination: '' },
    { destination: null }
  ];

  it('склад, которого нет в настройке, всё равно попадает в список', () => {
    // Это и есть жалоба: «Wildberries FBS» фильтр не видел совсем.
    expect(buildDestinationOptions(rows, ['Склад', 'Ozon', 'Wildberries'])).toContain('Wildberries FBS');
  });

  it('один склад с хвостом и без хвоста — одна строка списка, а не две', () => {
    const opts = buildDestinationOptions(rows, []);
    expect(opts.filter(o => o === 'Wildberries FBS')).toHaveLength(1);
  });

  it('объекты, которые приложение составляет само, тоже попадают', () => {
    const opts = buildDestinationOptions(rows, []);
    expect(opts).toContain('Ozon FBO');
    expect(opts).toContain('Списание - Брак');
  });

  it('настроенные объекты остаются, даже когда операций по ним нет', () => {
    // Порядок — русская локаль: кириллица идёт раньше латиницы.
    expect(buildDestinationOptions([], ['Склад', 'Ozon'])).toEqual(['Склад', 'Ozon']);
  });

  it('пустые объекты в список не попадают', () => {
    expect(buildDestinationOptions(rows, []).some(o => o === '')).toBe(false);
  });

  it('список отсортирован по русскому алфавиту', () => {
    const opts = buildDestinationOptions([{ destination: 'Ящик' }, { destination: 'Ёлка' }, { destination: 'Абрикос' }], []);
    expect(opts).toEqual(['Абрикос', 'Ёлка', 'Ящик']);
  });
});

/** Проверки формы кода: расчёт без подключения к экрану владельцу ничем не помогает. */
describe('фильтр «Истории» подключён к общему разбору', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const history = read('src/components/HistoryTab.tsx');

  it('фильтр сравнивает объект, а не всю строку с хвостом', () => {
    expect(history).toContain("destinationMain(t.destination) === histDestFilter");
    expect(history).not.toContain("t.destination === histDestFilter");
  });

  it('список берётся из операций, а не только из настройки браузера', () => {
    expect(history).toMatch(/buildDestinationOptions\(transactions, destinations\)/);
    expect(history).not.toMatch(/\{destinations\.map\(\(dest, idx\) => \(/);
  });

  it('у ячейки объекта больше нет своей копии разбора', () => {
    // Пока копий было две, фильтр мог не согласиться с тем, что написано в строке на экране.
    expect(history).not.toContain('const bracketMatch = destination.match');
    expect(history).toContain('const { main, tags } = parseDestination(destination);');
  });
});
