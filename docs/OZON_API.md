# OZON_API.md — разведка Ozon Seller API (пункт 6 плана)

> Живая разведка API для интеграции складского учёта с Ozon FBO.
> Все методы вызывались **только на чтение** (list / get / details / counter / analytics).
> Ни один метод, создающий/меняющий/удаляющий данные, не вызывался.

## Метаданные снятия

| Параметр | Значение |
|---|---|
| Дата снятия данных | **2026-07-07** |
| Swagger-снимок Seller | версия **2.1**, обновлён 2026-04-16, `sha256 c54962e9…dbdba5`, 420 методов |
| Swagger-снимок Performance | версия 2.0, 46 методов |
| Тариф кабинета | **PREMIUM_LITE** (`is_premium: true`) |
| Авторизация всех методов | заголовки `Client-Id` + `Api-Key` |
| Формат всех методов | `POST`, тело JSON |

> ⚠️ **Анонимизация.** Репозиторий публичный. В примерах ниже сохранены все **имена полей** и все **реальные значения статусов/enum**, но номера заявок, штрихкоды, артикулы, SKU, количества и названия складов заменены на правдоподобные плейсхолдеры (`99000001`, `TEST-ART-001`, `TEST_РФЦ_A` и т.п.). Реальные значения не разглашаются. Ключи Ozon в документ не включены.

---

## Главный вопрос плана (кратко)

**Отдаёт ли Ozon API данные пересорта (товар заявлен 0 — принят N, и наоборот) через акты приёмки?**

**Нет.** По FBO-поставкам API возвращает только **заявленное** количество (`quantity` в составе поставки). Поля «принято» на уровне товара нет ни в одном читающем методе. Факт приёмки виден только как **статус поставки целиком** (`COMPLETED` / `REJECTED_AT_SUPPLY_WAREHOUSE` и т.д.), но не поштучно. Структурированных актов расхождений по FBO в API нет — есть только PDF-акты по FBS и FBP. Подробный разбор — в разделе [«Акты приёмки и пересорт»](#акты-приёмки-и-пересорт-что-отдаёт-api).

---

## Справочник статусов заявки на поставку

Машинное имя → смысл. Полный набор из `SupplyOrderList.filter.states` и `SupplyOrderGet.orders[].state`:

| Статус (enum) | Смысл |
|---|---|
| `DATA_FILLING` | Заполнение данных |
| `READY_TO_SUPPLY` | Готова к отгрузке |
| `ACCEPTED_AT_SUPPLY_WAREHOUSE` | Принята на точке отгрузки |
| `IN_TRANSIT` | В пути |
| `ACCEPTANCE_AT_STORAGE_WAREHOUSE` | Приёмка на складе хранения |
| `REPORTS_CONFIRMATION_AWAITING` | Согласование актов |
| `REPORT_REJECTED` | Спор (акт отклонён) |
| `COMPLETED` | Завершена |
| `REJECTED_AT_SUPPLY_WAREHOUSE` | Отказано в приёмке |
| `CANCELLED` | Отменена |
| `OVERDUE` | Просрочена |
| `UNSPECIFIED` | Не определён (техническое значение) |

**Замеченные расхождения в enum (важно для кода):**
- Счётчик `SupplyOrderStatusCounter` возвращает статусы с **префиксом** `ORDER_STATE_` (например `ORDER_STATE_COMPLETED`) и **не содержит** `OVERDUE`, но содержит `ORDER_STATE_UNSPECIFIED`.
- Метод `SupplyOrderDetails` использует на уровне поставки `ACCEPTED_AT_STORAGE_WAREHOUSE` («принята на складе хранения»), тогда как `SupplyOrderList`/`SupplyOrderGet` используют `ACCEPTANCE_AT_STORAGE_WAREHOUSE` («приёмка на складе»). Это **разные строки** — сравнивать статусы нужно с учётом источника.

### Живой счётчик по статусам (снят 2026-07-07)

`POST /v1/supply-order/status/counter`, тело `{}`:

```json
{
  "items": [
    { "order_state": "ORDER_STATE_DATA_FILLING", "count": 1 },
    { "order_state": "ORDER_STATE_READY_TO_SUPPLY", "count": 1 },
    { "order_state": "ORDER_STATE_ACCEPTANCE_AT_STORAGE_WAREHOUSE", "count": 1 },
    { "order_state": "ORDER_STATE_REPORTS_CONFIRMATION_AWAITING", "count": 1 },
    { "order_state": "ORDER_STATE_COMPLETED", "count": 770 },
    { "order_state": "ORDER_STATE_REJECTED_AT_SUPPLY_WAREHOUSE", "count": 2 },
    { "order_state": "ORDER_STATE_CANCELLED", "count": 106 },
    { "order_state": "ORDER_STATE_UNSPECIFIED", "count": 37 },
    { "order_state": "ORDER_STATE_ACCEPTED_AT_SUPPLY_WAREHOUSE", "count": 0 },
    { "order_state": "ORDER_STATE_IN_TRANSIT", "count": 0 },
    { "order_state": "ORDER_STATE_REPORT_REJECTED", "count": 0 }
  ]
}
```

---

## Методы

### 1. Количество заявок по статусам — `SupplyOrderStatusCounter`

| | |
|---|---|
| Endpoint | `POST /v1/supply-order/status/counter` |
| Обязательные параметры | нет (тело `{}`) |
| Пагинация | нет |
| Класс | read |

Пример ответа — см. [живой счётчик](#живой-счётчик-по-статусам-снят-2026-07-07) выше. Удобен для «воронки поставок» на дашборде (пункт 8 плана) — одним вызовом даёт распределение по всем статусам.

---

### 2. Список заявок на поставку — `SupplyOrderList` (актуальная версия v3)

| | |
|---|---|
| Endpoint | `POST /v3/supply-order/list` |
| Обязательные параметры | `filter.states` (массив статусов), `limit` (1–100), `sort_by` |
| Пагинация | **`last_id`**: при первом запросе пусто; в ответе приходит `last_id` для следующей страницы; **пустой `last_id` в ответе = страниц больше нет** |
| Класс | read |

`sort_by`: `ORDER_CREATION` / `ORDER_STATE_UPDATED_AT` / `TIMESLOT_FROM_UTC` / `TIMESLOT_FROM_LOCAL`. `sort_dir`: `ASC` / `DESC`.
Дополнительные фильтры: `order_number_search` (поиск по номеру), `dropoff_warehouse_ids`, `timeslot_from_range`.

**Пример запроса:**
```json
{
  "filter": { "states": ["COMPLETED"] },
  "limit": 5,
  "sort_by": "ORDER_CREATION",
  "sort_dir": "DESC"
}
```

**Пример живого ответа (значения анонимизированы):**
```json
{
  "order_ids": ["99000001", "99000002", "99000003", "99000004", "99000005"],
  "last_id": "CKPD2zMSDAip8/nQBhDI25/SAg=="
}
```

> ⚠️ Метод возвращает **только идентификаторы** заявок. Детали — отдельным вызовом `SupplyOrderGet`.

---

### 3. Информация о заявке — `SupplyOrderGet` (актуальная версия v3)

| | |
|---|---|
| Endpoint | `POST /v3/supply-order/get` |
| Обязательные параметры | `order_ids` — массив **строк**, максимум 50 |
| Пагинация | нет (батч до 50 заявок за вызов) |
| Класс | read |

> ⚠️ **Грабли:** `order_ids` должны быть **строками**. Числовые id (`112104096`) заваливают валидацию — только `"112104096"`.

> ⚠️ **Ключевая структурная особенность (важно для учёта):** одна заявка (`order_id`) содержит массив `supplies[]`. У заявок через **виртуальный распределительный центр (вРЦ, crossdock)** одна заявка **разворачивается в несколько поставок** — каждая со своим `supply_id`, `bundle_id`, `state` и `macrolocal_cluster_id` (кластером). В снятых данных одна заявка дала **11 поставок** с разными статусами (часть `COMPLETED`, одна `REJECTED_AT_SUPPLY_WAREHOUSE`, одна `IN_TRANSIT`). Значит, статус и состав нужно вести **на уровне поставки (`supply_id`), а не заявки**.

> ⚠️ **Связь допоставок:** при отказе в приёмке Ozon создаёт новую **виртуальную** заявку (`order_tags.is_virtual: true`) с `order_tags.original_supply_id`, указывающим на исходную отклонённую поставку. Это готовый ключ для склейки «повторная поставка → исходная».

**Пример запроса:**
```json
{ "order_ids": ["99000001", "99000010"] }
```

**Пример живого ответа — завершённая заявка (значения анонимизированы, состав поставок сокращён):**
```json
{
  "orders": [
    {
      "order_id": 99000001,
      "order_number": "2000090000001",
      "created_date": "2026-06-19T05:44:59.803829Z",
      "state": "COMPLETED",
      "state_updated_date": "2026-06-22T18:56:32.096084Z",
      "drop_off_warehouse": {
        "warehouse_id": 1020000000000001,
        "address": "—",
        "name": "ТЕСТ_РФЦ_A"
      },
      "order_tags": {
        "product_super_fbo": false, "is_quant": false, "is_econom": false,
        "is_virtual": true, "original_supply_id": 2000090000900,
        "is_super_fbo": false, "is_pickup": false, "seller_warehouse_id": 0
      },
      "timeslot": {
        "timeslot": { "from": "2026-06-20T05:00:00Z", "to": "2026-06-20T06:00:00Z" },
        "timezone_info": { "offset": "18000s", "iana_name": "Asia/Yekaterinburg" }
      },
      "supplies": [
        {
          "state": "COMPLETED",
          "supply_id": 2000090000001,
          "storage_warehouse": { "warehouse_id": 1020000000000001, "address": "—", "name": "ТЕСТ_РФЦ_A" },
          "supply_tags": {
            "freeze_stock_for_marking": false, "is_ettn_required": false,
            "is_evsd_required": false, "is_jewelry": false,
            "is_marking_possible": false, "is_marking_required": false, "is_utd": false
          },
          "is_crossdock": false,
          "bundle_id": "019eeee0-0000-7000-a000-000000000001",
          "macrolocal_cluster_id": null
        }
      ]
    }
  ]
}
```

**Фрагмент вРЦ-заявки — одна заявка → много поставок с разными статусами (анонимизировано):**
```json
{
  "order_id": 99000010,
  "order_number": "117000010-1",
  "state": "ACCEPTANCE_AT_STORAGE_WAREHOUSE",
  "order_tags": { "is_virtual": false, "is_super_fbo": true, "original_supply_id": 0 },
  "supplies": [
    { "state": "COMPLETED",                    "supply_id": 2000090001001, "is_crossdock": true, "bundle_id": "019eeee0-0000-7000-b000-000000000001", "macrolocal_cluster_id": "4007" },
    { "state": "ACCEPTANCE_AT_STORAGE_WAREHOUSE","supply_id": 2000090001002, "is_crossdock": true, "bundle_id": "019eeee0-0000-7000-b000-000000000002", "macrolocal_cluster_id": "4065" },
    { "state": "REJECTED_AT_SUPPLY_WAREHOUSE",  "supply_id": 2000090001003, "is_crossdock": true, "bundle_id": "019eeee0-0000-7000-b000-000000000003", "macrolocal_cluster_id": "4039" }
  ]
}
```

**Ключевые идентификаторы из ответа:** `order_id`, `order_number`, `supply_id`, `bundle_id` (ключ к составу), `drop_off_warehouse.warehouse_id/name` (пункт отгрузки), `storage_warehouse.warehouse_id/name` (склад хранения), `macrolocal_cluster_id`, `timeslot` (окно отгрузки), `original_supply_id` (связь допоставки).
**Полей «принято» на уровне заявки/поставки НЕТ.**

---

### 4. Состав поставки — `SupplyOrderBundle`

| | |
|---|---|
| Endpoint | `POST /v1/supply-order/bundle` |
| Обязательные параметры | `bundle_ids` (массив, 1–100), `limit` (1–100) |
| Пагинация | **`last_id` + `has_next`** (постранично по SKU); `total_count` — всего товаров |
| Класс | фактически **read** (см. примечание) |

> ⚠️ **Примечание о безопасности.** MCP-сервер помечает метод `safety: "write"` по эвристике *«POST без слов get/list в пути → считаем write»* (`safety_reason: "POST without read indicators (default-to-write)"`). Фактически метод **только читает** товарный состав: в его схеме нет ни одного изменяющего параметра, а описание гласит «Используйте метод, чтобы **получить** товарный состав». Вызывался с техническим флагом `confirm_write=true`, **никакие данные не менялись**. В коде интеграции это чистый read-эндпоинт.

**Пример запроса:**
```json
{ "bundle_ids": ["019eeee0-0000-7000-a000-000000000001"], "limit": 100 }
```

**Пример живого ответа (значения анонимизированы):**
```json
{
  "items": [
    {
      "sku": 900000001,
      "quantity": 18,
      "offer_id": "TEST-ART-001",
      "name": "Тестовый товар 1",
      "barcode": "TEST-BC-0000001",
      "product_id": 800000001,
      "quant": 1,
      "is_quant_editable": true,
      "volume_in_litres": 8.64,
      "total_volume_in_litres": 156,
      "icon_path": "https://…",
      "sfbo_attribute": "ITEM_SFBO_ATTRIBUTE_NONE",
      "shipment_type": "BUNDLE_ITEM_SHIPMENT_TYPE_GENERAL",
      "tags": [],
      "placement_zone": "SORT"
    },
    {
      "sku": 900000002,
      "quantity": 80,
      "offer_id": "TEST-ART-002",
      "name": "Тестовый товар 2",
      "barcode": "TEST-BC-0000002",
      "product_id": 800000002,
      "quant": 1, "is_quant_editable": true,
      "sfbo_attribute": "ITEM_SFBO_ATTRIBUTE_NONE",
      "shipment_type": "BUNDLE_ITEM_SHIPMENT_TYPE_GENERAL",
      "tags": [], "placement_zone": "SORT"
    }
  ],
  "total_count": 5,
  "last_id": "900000002",
  "has_next": false
}
```

**Все идентификаторы товара, которые отдаёт метод:**
- `offer_id` — артикул продавца (он же дублируется в `contractor_item_code`);
- `sku` — идентификатор товара в Ozon;
- `product_id` — внутренний id товара в Ozon;
- `barcode` — штрихкод (одна строка на позицию);
- `name`, `icon_path` — название и картинка.

**Поля количества:** только **`quantity`** — это **заявленное** количество в составе. Поля «принято»/`accepted`/`received`/`fact` **НЕТ**. Проверено в том числе на поставке со статусом `REJECTED_AT_SUPPLY_WAREHOUSE` — там тоже отдаётся только `quantity` (заявленное), без признака фактической приёмки.

> ⚠️ Одна заявка через вРЦ разбивает **один и тот же товар** на разные `bundle_id` по кластерам (в снятых данных один SKU встречался с `quantity` 18 в одной поставке и распределялся по разным составам). Итоговое заявленное количество товара по заявке = сумма `quantity` по всем `bundle_id` этой заявки.

---

### 5. Подробная информация о заявке — `SupplyOrderDetails` (справочно)

| | |
|---|---|
| Endpoint | `POST /v1/supply-order/details` |
| Обязательные параметры | `order_id` — одно число (int64) |
| Пагинация | нет |
| Класс | read |

Структура задокументирована по схеме MCP (в основном флоу разведки не был ключевым). Даёт по каждой поставке служебные признаки редактируемости: `content.can_set`/`can_not_set_reasons` (можно ли менять состав), `timeslot.can_set`, `vehicle.can_set`, `cancellation_allowability.can_set`, а также `overdue_reason` (причина просрочки) и `supply_state`. **Полей «принято» по товарам здесь тоже нет** — только `content.bundle_id` как ссылка на состав.

---

### 6. Остатки на складах Ozon — `AnalyticsStocks`

| | |
|---|---|
| Endpoint | `POST /v1/analytics/stocks` |
| Обязательные параметры | `skus` — массив (до 100 SKU) |
| Пагинация | нет (возвращает все склады/кластеры по переданным SKU одним ответом) |
| Лимиты | Premium-метод; аналитика **обновляется 2 раза в сутки** (~07:00 и ~16:00 UTC); в запросе нельзя одновременно `cluster_ids` и `macrolocal_cluster_ids` |
| Класс | read (курированный override MCP) |

Соответствует разделу ЛК **FBO → Управление остатками**. Опциональные фильтры: `cluster_ids` **или** `macrolocal_cluster_ids`, `warehouse_ids`, `item_tags`, `turnover_grades`.

**Пример запроса:**
```json
{ "skus": ["900000001", "900000002"] }
```

**Пример живого ответа — одна строка на пару SKU × склад (значения анонимизированы):**
```json
{
  "items": [
    {
      "sku": 900000001,
      "offer_id": "TEST-ART-001",
      "name": "Тестовый товар 1",
      "warehouse_id": 20000000000001,
      "warehouse_name": "ТЕСТ_РФЦ_A",
      "cluster_id": 150,
      "cluster_name": "Кластер A",
      "macrolocal_cluster_id": 4042,
      "item_tags": [],
      "available_stock_count": 4,
      "valid_stock_count": 0,
      "waiting_docs_stock_count": 0,
      "expiring_stock_count": 0,
      "excess_stock_count": 0,
      "other_stock_count": 0,
      "requested_stock_count": 0,
      "transit_stock_count": 0,
      "transit_defect_stock_count": 0,
      "stock_defect_stock_count": 0,
      "return_from_customer_stock_count": 0,
      "return_to_seller_stock_count": 0,
      "ads": 3.82, "idc": 17, "days_without_sales": 0,
      "turnover_grade": "DEFICIT",
      "ads_cluster": 0.07, "idc_cluster": 56, "days_without_sales_cluster": 18,
      "turnover_grade_cluster": "POPULAR"
    }
  ]
}
```

**Смысл ключевых полей остатков:**
- `available_stock_count` — «Доступно к продаже»;
- `valid_stock_count` — «Готовим к продаже»;
- `expiring_stock_count` — с истекающим сроком годности;
- `excess_stock_count` — излишки к вывозу (риск платного хранения);
- `requested_stock_count` — уже в заявках на поставку;
- `transit_stock_count` — в поставках в пути;
- `turnover_grade` / `idc` — статус ликвидности и на сколько дней хватит остатка.

> Это **единственный** способ увидеть остаток **по каждому складу FBO** отдельно, а не суммарно. Для пункта 17 («Зеркало остатков складов Ozon») — основной источник.

---

## Акты приёмки и пересорт: что отдаёт API

**Однозначный вывод: структурированных данных приёмки и пересорта по FBO-поставкам Ozon API НЕ отдаёт.**

Что проверено:

1. **Поиск по всем методам** (слова: акт, приёмка, расхождение, discrepancy, acceptance, принято, недостача, излишки) — в разделе **«Доставка FBO»** нет ни одного метода про акт приёмки или расхождения. Найденные акты относятся к **другим схемам**:
   - `CarriageActDiscrepancyPDF` (`/v1/carriage/act-discrepancy/pdf`) — акт о расхождениях, но по **FBS**-отгрузке и только **PDF**;
   - `FbpAPI_FbpCreateAct` / `FbpAPI_FbpCheckActState` (`/v1/fbp/act-from/*`) — генерация **PDF**-акта приёмки для схемы **FBP**.
   - Ни один не возвращает машиночитаемое «заявлено X — принято Y» по FBO-поставке.

2. **Состав поставки `SupplyOrderBundle`** отдаёт только заявленное `quantity`. Поля «принято» нет. Подтверждено в том числе на поставке `REJECTED_AT_SUPPLY_WAREHOUSE` — там тоже только заявленное количество.

3. **`SupplyOrderGet` / `SupplyOrderDetails`** не содержат поштучной приёмки. Максимум, что есть, — **статус поставки целиком**: `COMPLETED`, `REJECTED_AT_SUPPLY_WAREHOUSE`, `REPORTS_CONFIRMATION_AWAITING` («согласование актов»), `REPORT_REJECTED` («спор»). Это статус процесса согласования акта, **но не его содержимое**.

**Что это значит для учёта (пересорт и недостача, пункты 13–16):**
- Признак «заявлено 0 — принято N» и «заявлено X — принято меньше» из API **получить нельзя**. Данные пересорта в машинном виде отсутствуют.
- Разница «отгружено − принято» на уровне API видна только как **факт отказа поставки** (`REJECTED_AT_SUPPLY_WAREHOUSE`) или **косвенно** — сопоставлением заявленного состава (`SupplyOrderBundle.quantity`) с последующим приростом остатков (`AnalyticsStocks`), что ненадёжно.
- Значит, **сценарий из плана подтверждается**: пункт 15 прямо предусматривал «или **форма ручного ввода акта**, если API актов не отдаёт». Разведка показывает — **нужен ручной ввод акта приёмки** (пересорт/недостача вводит пользователь, API их не даёт). Автоматически из API можно взять только сам факт и статус завершения/отказа поставки.

---

## Выводы для пункта 7 плана

Пункт 7 — перевод `/api/ozon/check` на `/v3/supply-order/list` и запись статуса в лист **«Внешние отгрузки»**.

**Цепочка вызовов для эндпоинта `/api/ozon/check`:**
1. `SupplyOrderStatusCounter` — быстрый снимок воронки (для пункта 8, дашборд).
2. `SupplyOrderList` (v3) — по нужным `filter.states`, пагинация по `last_id` до пустого `last_id`. Даёт `order_ids`.
3. `SupplyOrderGet` (v3) — батчами до 50 **строковых** `order_ids`. Даёт статус, поставки (`supplies[]`), `bundle_id`, склады, таймслот, связь допоставок.
4. `SupplyOrderBundle` — по `bundle_id` из шага 3. Даёт позиции: `offer_id`, `sku`, `barcode`, `quantity`.
5. `AnalyticsStocks` — отдельно, для зеркала остатков (пункт 17), не для `/check`.

**Раскладка на колонки листа «Внешние отгрузки»:**

| Колонка листа | Источник (метод → поле) |
|---|---|
| Номер заявки Ozon | `SupplyOrderGet` → `order_number` |
| ID заявки | `SupplyOrderGet` → `order_id` |
| ID поставки | `SupplyOrderGet` → `supplies[].supply_id` |
| Статус | `SupplyOrderGet` → `state` (заявка) и/или `supplies[].state` (поставка) |
| Дата обновления статуса | `SupplyOrderGet` → `state_updated_date` |
| Пункт отгрузки | `SupplyOrderGet` → `drop_off_warehouse.name` |
| Склад хранения | `SupplyOrderGet` → `supplies[].storage_warehouse.name` |
| Окно отгрузки (таймслот) | `SupplyOrderGet` → `timeslot.timeslot.from/to` |
| Артикул позиции | `SupplyOrderBundle` → `offer_id` |
| SKU / штрихкод | `SupplyOrderBundle` → `sku` / `barcode` |
| Заявленное количество | `SupplyOrderBundle` → `quantity` |
| Принятое количество | **из API недоступно** — только ручной ввод акта (пункты 15–16) |

**Критичные предупреждения для реализации:**
- **`order_ids` — строки**, не числа (иначе 400 на валидации).
- **Момент ухода остатка** (по реестру решений) — статус `ACCEPTED_AT_SUPPLY_WAREHOUSE`. Отслеживать переход в него.
- **Вести учёт на уровне `supply_id`, а не заявки**: вРЦ-заявка разворачивается в несколько поставок с разными статусами и кластерами. «Отпечаток» для дедупа (артикулы+количества+дата+назначение) считать по составу поставки.
- **Заявленное количество товара по заявке** = сумма `quantity` по всем `bundle_id` этой заявки (один SKU может быть в нескольких составах).
- **Допоставки после отказа** склеивать по `order_tags.original_supply_id`.
- **`quantity` — это «заявлено», не «принято».** Никогда не трактовать его как принятое: приёмка/пересорт/недостача в API отсутствуют и вводятся вручную.
