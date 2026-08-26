import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  availableWarehouses,
  chooseDirectWarehouse,
  directWarehouseMessage,
  isWarehouseAvailable,
  readDraftWarehouses,
  type DraftWarehouse
} from './ozonDirectDraft';

// Пункт 58, этап 4. Форма ответа взята из docs/OZON_API.md, раздел «Разведка этапа H»:
// живой прогон по кластеру Москва вернул 17 складов, доступными были два —
// ХОРУГВИНО_РФЦ (rank 1) и СОФЬИНО_РФЦ (rank 2), остальные с NOT_AVAILABLE_RANK
// или NOT_AVAILABLE_MATRIX. Боевой склад Екатеринбурга — 18044570445000.

const EKB = '18044570445000';

const raw = (over: any = {}) => ({
  storage_warehouse: {
    warehouse_id: over.id ?? EKB,
    name: over.name ?? 'ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ',
    address: over.address ?? 'Екатеринбург, Кольцовский тракт'
  },
  availability_status: {
    state: over.state ?? 'FULL_AVAILABLE',
    invalid_reason: over.reason ?? 'UNSPECIFIED'
  },
  total_rank: over.rank ?? 1,
  bundle_id: over.bundleId ?? 'bundle-1',
  restricted_bundle_id: over.restrictedBundleId ?? ''
});

const wh = (over: any = {}): DraftWarehouse => readDraftWarehouses([raw(over)])[0];

describe('разбор складов из ответа Ozon', () => {
  it('склад читается целиком', () => {
    const list = readDraftWarehouses([raw()]);
    expect(list).toHaveLength(1);
    expect(list[0].warehouseId).toBe(EKB);
    expect(list[0].name).toBe('ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ');
    expect(list[0].state).toBe('FULL_AVAILABLE');
    expect(list[0].rank).toBe(1);
    expect(list[0].bundleId).toBe('bundle-1');
  });

  it('числовой идентификатор приводится к строке', () => {
    expect(readDraftWarehouses([raw({ id: 18044570445000 })])[0].warehouseId).toBe(EKB);
  });

  it('состояние приводится к верхнему регистру', () => {
    expect(readDraftWarehouses([raw({ state: 'not_available' })])[0].state).toBe('NOT_AVAILABLE');
  });

  it('склад без идентификатора пропускается', () => {
    expect(readDraftWarehouses([{ storage_warehouse: {} }, raw()])).toHaveLength(1);
  });

  it('не массив и мусор дают пустой список, а не падение', () => {
    expect(readDraftWarehouses(null)).toEqual([]);
    expect(readDraftWarehouses({})).toEqual([]);
    expect(readDraftWarehouses([null, undefined])).toEqual([]);
  });

  it('склад без блока доступности читается без выдумок', () => {
    const list = readDraftWarehouses([{ storage_warehouse: { warehouse_id: '1', name: 'X' } }]);
    expect(list[0].state).toBe('');
    expect(list[0].rank).toBe(0);
  });
});

describe('доступность склада', () => {
  it('полная и частичная доступность годятся', () => {
    expect(isWarehouseAvailable(wh({ state: 'FULL_AVAILABLE' }))).toBe(true);
    expect(isWarehouseAvailable(wh({ state: 'PARTIAL_AVAILABLE' }))).toBe(true);
  });

  it('молчание Ozon не считается отказом', () => {
    expect(isWarehouseAvailable(wh({ state: 'UNSPECIFIED' }))).toBe(true);
    expect(isWarehouseAvailable(wh({ state: '' }))).toBe(true);
  });

  it('отказ есть отказ', () => {
    expect(isWarehouseAvailable(wh({ state: 'NOT_AVAILABLE', reason: 'NOT_AVAILABLE_RANK' }))).toBe(false);
  });

  it('доступные идут по рангу, безранговые в конце', () => {
    const list = [
      wh({ id: '3', name: 'C', rank: 0 }),
      wh({ id: '1', name: 'A', rank: 2 }),
      wh({ id: '4', name: 'D', state: 'NOT_AVAILABLE', rank: 1 }),
      wh({ id: '2', name: 'B', rank: 1 })
    ];
    expect(availableWarehouses(list).map((w) => w.name)).toEqual(['B', 'A', 'C']);
  });
});

describe('пункт 58: выбор склада прямой поставки', () => {
  it('склад из настроек доступен — берётся он', () => {
    const list = [wh(), wh({ id: '999', name: 'ДРУГОЙ', rank: 2 })];
    const choice = chooseDirectWarehouse(list, EKB);
    expect(choice.problem).toBe('');
    expect(choice.chosen!.warehouseId).toBe(EKB);
  });

  it('берётся ИМЕННО склад из настроек, даже когда Ozon считает лучшим другой', () => {
    // Ловушка: если фикстура даёт нужному складу ранг 1, подмена «возьмём лучшего»
    // проходит незамеченной. Здесь нужный склад ХУЖЕ по рангу — и всё равно должен победить.
    const list = [
      wh({ id: '777', name: 'ЛУЧШИЙ_ПО_РАНГУ', rank: 1 }),
      wh({ rank: 5 })
    ];
    const choice = chooseDirectWarehouse(list, EKB);
    expect(choice.chosen!.warehouseId).toBe(EKB);
    expect(choice.chosen!.name).toBe('ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ');
    expect(choice.alternatives[0].name).toBe('ЛУЧШИЙ_ПО_РАНГУ');
  });

  it('склад из настроек Ozon не дал — предлагаются доступные', () => {
    const list = [wh({ id: '111', name: 'ПЕРВЫЙ', rank: 2 }), wh({ id: '222', name: 'ВТОРОЙ', rank: 1 })];
    const choice = chooseDirectWarehouse(list, EKB);
    expect(choice.problem).toBe('not_offered');
    expect(choice.chosen).toBeNull();
    expect(choice.alternatives.map((w) => w.name)).toEqual(['ВТОРОЙ', 'ПЕРВЫЙ']);
  });

  it('склад из настроек недоступен — он сам в замены не попадает', () => {
    const list = [
      wh({ state: 'NOT_AVAILABLE', reason: 'NOT_AVAILABLE_MATRIX' }),
      wh({ id: '222', name: 'ВТОРОЙ', rank: 3 })
    ];
    const choice = chooseDirectWarehouse(list, EKB);
    expect(choice.problem).toBe('not_available');
    expect(choice.chosen).toBeNull();
    expect(choice.alternatives.map((w) => w.warehouseId)).toEqual(['222']);
  });

  it('замен нет вовсе — список пуст, но ответ не падает', () => {
    const choice = chooseDirectWarehouse([wh({ state: 'NOT_AVAILABLE' })], EKB);
    expect(choice.problem).toBe('not_available');
    expect(choice.alternatives).toEqual([]);
  });

  it('склад не задан в настройках — приложение само его НЕ подставляет', () => {
    const choice = chooseDirectWarehouse([wh()], '');
    expect(choice.problem).toBe('not_offered');
    expect(choice.chosen).toBeNull();
    expect(choice.alternatives).toHaveLength(1);
  });

  it('пустой ответ Ozon', () => {
    const choice = chooseDirectWarehouse([], EKB);
    expect(choice.problem).toBe('not_offered');
    expect(choice.alternatives).toEqual([]);
  });
});

describe('текст для человека', () => {
  it('склад подошёл — текста нет', () => {
    expect(directWarehouseMessage(chooseDirectWarehouse([wh()], EKB), 'ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ')).toBe('');
  });

  it('склад не предложен — названы замены', () => {
    const choice = chooseDirectWarehouse([wh({ id: '222', name: 'ВТОРОЙ' })], EKB);
    const text = directWarehouseMessage(choice, 'ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ');
    expect(text).toContain('не предложил склад');
    expect(text).toContain('ВТОРОЙ');
  });

  it('замен нет — сказано прямо', () => {
    const choice = chooseDirectWarehouse([wh({ state: 'NOT_AVAILABLE' })], EKB);
    expect(directWarehouseMessage(choice, 'ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ')).toContain('других доступных складов');
  });

  it('перечисляются не больше трёх замен', () => {
    const many = ['A', 'B', 'C', 'D'].map((n, i) => wh({ id: String(i + 10), name: n, rank: i + 1 }));
    const text = directWarehouseMessage(chooseDirectWarehouse(many, EKB), 'НЕТ');
    expect(text).toContain('A, B, C');
    expect(text).not.toContain('D');
  });
});

describe('подключение прямого черновика к прокси', () => {
  const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');

  it('прямой черновик создаётся своим методом Ozon', () => {
    expect(server).toContain('/v1/draft/direct/create');
    expect(server).toContain('cluster_info');
  });

  it('выбор метода привязан к типу поставки, а не просто присутствует в файле', () => {
    // Ловушка: проверка «в файле есть /v1/draft/direct/create» переживает подмену
    // условия ветвления на false, и прямая поставка молча уходит мультикластерным методом.
    expect(server).toMatch(/createData: any = supplyType === 'DIRECT'\s*\?\s*await fetchOzonApi\("\/v1\/draft\/direct\/create"/);
  });

  it('прямой черновик берёт РОВНО один кластер', () => {
    expect(server).toMatch(/DIRECT[\s\S]{0,400}clustersInfo\.length !== 1/);
  });

  it('у прямого черновика нет точки отгрузки', () => {
    expect(server).toMatch(/supplyType === 'DIRECT'[\s\S]{0,600}deletion_sku_mode/);
  });

  it('склад выбирается правилом, а не первым попавшимся', () => {
    expect(server).toContain('chooseDirectWarehouse(');
    expect(server).toContain('directWarehouseMessage(');
  });

  it('состав прямой поставки читается из бандла ВЫБРАННОГО склада', () => {
    expect(server).toContain('directChoice.chosen.bundleId');
  });
});
