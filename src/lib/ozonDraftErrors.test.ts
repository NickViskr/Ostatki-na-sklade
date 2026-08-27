import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  blamedClusterIds,
  draftErrorLogLine,
  draftFailureHint,
  draftFailureTitle,
  readDraftErrors
} from './ozonDraftErrors';

// Пункт 62. Боевой случай 27.08.2026: BowlGrayMini_01, все рекомендованные кластеры —
// Ozon отвечает FAILED за 0,46 секунды; те же товары на Москву и Санкт-Петербург
// проходят за 9,5 секунды. Заявка на несколько кластеров считается целиком, поэтому
// один закрытый кластер валит расчёт целиком.

describe('разбор errors[] из ответа Ozon', () => {
  it('кластер не принимает поставку: код, причина и виноватые кластеры', () => {
    const failures = readDraftErrors([
      {
        error_message: 'ITEMS_VALIDATION',
        error_reasons: ['NOT_AVAILABLE_CLUSTERS'],
        macrolocal_cluster_ids: ['4066', '4039']
      }
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe('ITEMS_VALIDATION');
    expect(failures[0].text).toBe('Ozon отклонил товары в заявке');
    expect(failures[0].reasons).toEqual(['кластер не принимает поставку']);
    expect(failures[0].clusterIds).toEqual(['4066', '4039']);
  });

  it('отклонённые товары разбираются вместе с их причинами', () => {
    const failures = readDraftErrors([
      {
        error_message: 'ITEMS_VALIDATION',
        items_validation: [
          {
            macrolocal_cluster_id: 4041,
            rejected_items: [
              { sku: 123456, reasons: ['SKU_REJECTED_BY_ACCEPTANCE_RESTRICTIONS'] },
              { sku: 789, reasons: ['INCOMPATIBLE_WAREHOUSE', 'OUT_OF_ASSORTMENT'] }
            ]
          }
        ]
      }
    ]);
    expect(failures[0].items).toEqual([
      { clusterId: '4041', sku: '123456', reasons: ['товар отклонён ограничениями на приёмку'] },
      { clusterId: '4041', sku: '789', reasons: ['товар нельзя разместить на этом складе', 'товар не входит в ассортимент склада'] }
    ]);
  });

  it('кластер из items_validation тоже попадает в список виноватых', () => {
    // Ozon не обязан дублировать его в macrolocal_cluster_ids, а владельцу нужно имя.
    const failures = readDraftErrors([
      { error_message: 'ITEMS_VALIDATION', items_validation: [{ macrolocal_cluster_id: 4041, rejected_items: [] }] }
    ]);
    expect(failures[0].clusterIds).toEqual(['4041']);
  });

  it('повторы кластеров и причин схлопываются', () => {
    const failures = readDraftErrors([
      {
        error_message: 'ITEMS_VALIDATION',
        error_reasons: ['NOT_AVAILABLE_CLUSTERS', 'NOT_AVAILABLE_CLUSTERS'],
        macrolocal_cluster_ids: ['4066', '4066'],
        items_validation: [{ macrolocal_cluster_id: 4066, rejected_items: [] }]
      }
    ]);
    expect(failures[0].reasons).toEqual(['кластер не принимает поставку']);
    expect(failures[0].clusterIds).toEqual(['4066']);
  });

  it('незнакомый код показывается как есть, а не проглатывается', () => {
    const failures = readDraftErrors([{ error_message: 'SOME_NEW_OZON_CODE', error_reasons: ['BRAND_NEW_REASON'] }]);
    expect(failures[0].text).toBe('SOME_NEW_OZON_CODE');
    expect(failures[0].reasons).toEqual(['BRAND_NEW_REASON']);
  });

  it('мусор на входе не роняет разбор', () => {
    expect(readDraftErrors(null)).toEqual([]);
    expect(readDraftErrors('failed')).toEqual([]);
    expect(readDraftErrors([null, undefined])).toEqual([]);
  });

  it('message от Ozon сохраняется', () => {
    const failures = readDraftErrors([{ error_message: 'CAN_NOT_START_CALCULATION', message: 'calculation is busy' }]);
    expect(failures[0].message).toBe('calculation is busy');
  });

  it('виноватые кластеры собираются по всем ошибкам без повторов', () => {
    const failures = readDraftErrors([
      { error_message: 'ITEMS_VALIDATION', macrolocal_cluster_ids: ['4066'] },
      { error_message: 'UNKNOWN_CLUSTER_IDS', macrolocal_cluster_ids: ['4066', '4075'] }
    ]);
    expect(blamedClusterIds(failures)).toEqual(['4066', '4075']);
  });
});

describe('текст отказа', () => {
  it('без errors[] остаётся статус — иначе владелец не поймёт, что вообще произошло', () => {
    expect(draftFailureTitle('FAILED', [])).toBe('Ozon не рассчитал черновик: статус FAILED');
    expect(draftFailureTitle('', [])).toBe('Ozon не рассчитал черновик: статус нет ответа');
  });

  it('с errors[] показывается расшифровка, а не слово FAILED', () => {
    const failures = readDraftErrors([
      { error_message: 'ITEMS_VALIDATION', error_reasons: ['NOT_AVAILABLE_CLUSTERS'] }
    ]);
    const title = draftFailureTitle('FAILED', failures);
    expect(title).toContain('Ozon отклонил товары в заявке');
    expect(title).toContain('кластер не принимает поставку');
    expect(title).not.toContain('FAILED');
  });

  it('несколько ошибок: первая целиком, остальные счётчиком', () => {
    const failures = readDraftErrors([
      { error_message: 'ITEMS_VALIDATION' },
      { error_message: 'UNKNOWN_CLUSTER_IDS' },
      { error_message: 'CAN_NOT_CREATE_DRAFT' }
    ]);
    expect(draftFailureTitle('FAILED', failures)).toBe('Ozon отклонил товары в заявке и ещё 2');
  });

  it('код без словаря всё равно доезжает до заголовка', () => {
    const failures = readDraftErrors([{ error_message: 'BRAND_NEW' }]);
    expect(draftFailureTitle('FAILED', failures)).toBe('BRAND_NEW');
  });
});

describe('подсказка, что делать', () => {
  it('виноваты не все кластеры — предлагаем убрать именно их', () => {
    const failures = readDraftErrors([{ error_message: 'ITEMS_VALIDATION', macrolocal_cluster_ids: ['4066'] }]);
    const hint = draftFailureHint(failures, 9);
    expect(hint).toContain('Уберите указанные кластеры');
    expect(hint).toContain('считается целиком');
  });

  it('Ozon не назвал кластер — предлагаем считать по частям', () => {
    const hint = draftFailureHint(readDraftErrors([{ error_message: 'CAN_NOT_START_CALCULATION' }]), 9);
    expect(hint).toContain('по частям');
  });

  it('кластер в заявке один — убирать нечего, кроме него самого', () => {
    const failures = readDraftErrors([{ error_message: 'ITEMS_VALIDATION', macrolocal_cluster_ids: ['4066'] }]);
    expect(draftFailureHint(failures, 1)).toBe('Уберите этот кластер из заявки или дождитесь, пока Ozon откроет приём.');
  });

  it('виноваты все кластеры заявки — «убрать указанные» бессмысленно', () => {
    const failures = readDraftErrors([{ error_message: 'ITEMS_VALIDATION', macrolocal_cluster_ids: ['4066', '4039'] }]);
    expect(draftFailureHint(failures, 2)).toContain('по частям');
  });
});

describe('строка для журнала Cloud Run', () => {
  it('несёт статус, код, кластеры и SKU — по ней отказ находится без повтора сценария', () => {
    const failures = readDraftErrors([
      {
        error_message: 'ITEMS_VALIDATION',
        error_reasons: ['NOT_AVAILABLE_CLUSTERS'],
        macrolocal_cluster_ids: ['4066'],
        items_validation: [{ macrolocal_cluster_id: 4066, rejected_items: [{ sku: 555, reasons: ['SKU_IS_RESTRICTED'] }] }]
      }
    ]);
    const line = draftErrorLogLine('FAILED', failures);
    expect(line).toContain('OZON DRAFT FAILED');
    expect(line).toContain('ITEMS_VALIDATION');
    expect(line).toContain('clusters=4066');
    expect(line).toContain('items=555:товар ограничен к приёмке');
  });

  it('пустой errors[] честно сообщает, что причины не было', () => {
    expect(draftErrorLogLine('FAILED', [])).toBe('OZON DRAFT FAILED | без errors[]');
  });
});

describe('причина отказа доезжает до владельца', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const server = read('server.ts');
  const modal = read('src/components/OzonSupplyModal.tsx');

  it('прокси пишет причину в журнал на обеих ветках отказа', () => {
    // Отказ бывает двух видов: Ozon не выдал draft_id либо выдал и завалил расчёт.
    expect(server).toContain("console.error(draftErrorLogLine('CREATE_REJECTED', createFailures));");
    expect(server).toContain('console.error(draftErrorLogLine(draftStatus, failures));');
  });

  it('прокси отдаёт разобранные причины и подсказку, а не только статус', () => {
    expect(server).toContain('message: draftFailureTitle(draftStatus, failures),');
    expect(server).toContain('hint: draftFailureHint(failures, clustersInfo.length),');
    expect(server).toMatch(/\n\s+failures,\n/);
  });

  it('прокси объясняет лимит Ozon на 429, а не показывает общий текст', () => {
    expect(server).toContain('не больше 2 проверок черновика в минуту');
    expect(server).toContain('message: error.httpStatus === 429 ? DRAFT_RATE_LIMIT_MESSAGE');
  });

  it('окно поставки сохраняет причину в состоянии, а не только в тосте', () => {
    expect(modal).toContain('setDraftFailures(Array.isArray(result.failures) ? result.failures : []);');
    expect(modal).toContain("setDraftHint(String(result.hint || ''));");
  });

  it('окно поставки показывает причину и названия кластеров', () => {
    expect(modal).toContain('Ozon не рассчитал заявку');
    expect(modal).toContain('{f.clusterIds.map(clusterLabel).join(\', \')}');
    expect(modal).toContain('{draftHint}');
  });

  it('успешный пересчёт стирает старую причину', () => {
    expect(modal).toMatch(/setDraftFailures\(\[\]\);\s*\n\s*setDraftFailureText\(''\);\s*\n\s*setDraftHint\(''\);\s*\n\s*setDraftId/);
  });
});
