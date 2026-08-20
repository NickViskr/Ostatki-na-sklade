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
- `offer_id` — артикул продавца (он же дублируется in `contractor_item_code`);
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

### 6. Список кластеров и складов — `ClusterList`

| | |
|---|---|
| Endpoint | `POST /v1/cluster/list` |
| Обязательные параметры | `cluster_type`: `CLUSTER_TYPE_OZON` (Россия, 22 кластера) или `CLUSTER_TYPE_CIS` (СНГ, 4 кластера). Без параметра метод вызвать нельзя |
| Пагинация | нет |
| Класс | read |

Назначение: готовый справочник для расшифровки `macrolocal_cluster_id` из поставок (`SupplyOrderGet` → `supplies[]`) в человекочитаемое название направления (город/регион), а также `warehouse_id` → название и тип склада.

Структура ответа:
```json
{
  "clusters": [
    {
      "id": <int64>,                    // внутренний id кластера (например 150) — НЕ равен macrolocal
      "name": <string>,                 // человекочитаемое название (город/регион)
      "type": <string>,                 // "OZON" | "CIS"
      "macrolocal_cluster_id": <int64>, // ЧЕТЫРЁХЗНАЧНЫЙ id — совпадает с macrolocal_cluster_id в поставках
      "logistic_clusters": [
        { "warehouses": [ { "warehouse_id": <int64>, "name": <string>, "type": <string> } ] }
      ]
    }
  ]
}
```

Замечания (важно для кода):
- Поле `macrolocal_cluster_id` присутствует у каждого кластера рядом с `name` — прямое соответствие подтверждено живыми данными (например 4007 → «Санкт-Петербург и СЗО», 4042 → «Самара»). Российские значения в диапазоне 4002–4077.
- Поля `type` (у кластера и у склада) реально приходят в ответе, но отсутствуют в swagger-схеме MCP-снимка — закладываться на возможное отсутствие. Типы складов: FULL_FILLMENT / CROSS_DOCK / SORTING_CENTER / ORDERS_RECEIVING_POINT.
- Для полного словаря нужно два вызова: CLUSTER_TYPE_OZON + CLUSTER_TYPE_CIS.

---

### 8. Информация о продавце — `SellerInfo` (разведка для пункта 8в, снято живым вызовом 2026-07-08)

Вопрос разведки: отдаёт ли Seller API название магазина/кабинета продавца? **Ответ: да.**

| Параметр | Значение |
|---|---|
| operation_id | `SellerAPI_SellerInfo` |
| Endpoint | `POST /v1/seller/info` |
| Тело запроса | пустое `{}` (параметров нет) |
| Класс | read (ничего не меняет) |
| Авторизация | заголовки `Client-Id` + `Api-Key` |

Ключевые поля ответа (блок `company`):

| Поле | Смысл | Примечание |
|---|---|---|
| `company.name` | Название магазина/кабинета на Ozon | ✅ это и есть название кабинета |
| `company.legal_name` | Юрлицо (для ИП — ФИО) | чувствительное, не выводить |
| `company.ownership_form` | Форма собственности (ИП/ООО) | справочно |
| `company.inn`, `company.ogrn` | ИНН, ОГРН | чувствительные, не выводить |
| `company.tax_system` | Система налогообложения (USN/OSNO/…) | справочно |
| `company.currency`, `company.country` | Валюта и страна кабинета | справочно |

Дополнительно метод возвращает `subscription` (`is_premium`, `type` — тариф) и массив `ratings[]` (рейтинги продавца).

Пример живого ответа (обезличено):

```json
{
  "company": {
    "name": "НАЗВАНИЕ_МАГАЗИНА",
    "ownership_form": "ИП",
    "legal_name": "ФИО_ИЛИ_ЮРЛИЦО",
    "inn": "XXXXXXXXXXXX",
    "ogrn": "",
    "tax_system": "USN",
    "currency": "RUB",
    "country": "RUS"
  },
  "subscription": { "is_premium": true, "type": "PREMIUM_LITE" },
  "ratings": [ { "name": "Оценка товаров", "value_type": "REVIEW_SCORE", "status": "OK" } ]
}
```

**Выводы:**
- Название кабинета автоподтягивается из `company.name` метода `POST /v1/seller/info`. Метод без параметров, read-only, годится и как проверка ключей.
- Результат кэшировать (меняется редко, TTL ≈ 3600 с).
- В списках складов названия кабинета нет: `WarehouseFboSellerList` и `WarehouseListV2` дают только названия складов продавца. Единственный источник имени кабинета — `SellerInfo`.

**Грабли:**
- Заблокированный кабинет: HTTP 403 с телом `{"code":7,"message":"Company is blocked…"}` — это блокировка кабинета, а не проблема ключа; показывать пользователю понятный текст.
- `ratings[]` может содержать `null` в `current_value`/`past_value` вопреки схеме — допускать null.
- `tax_system: "USN"` ≠ «без НДС» (с 2025 г. УСН с оборотом > 60 млн платит НДС 5/7%) — ставку НДС отсюда не выводить.
- В swagger-схеме `subscription` описан только как `{is_premium}`, но живой ответ содержит и `subscription.type`.

### 7. Остатки на складах Ozon — `AnalyticsStocks`

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
| Направление вРЦ-поставки (кластер) | `supplies[].macrolocal_cluster_id` → расшифровка через `/v1/cluster/list` (`clusters[].macrolocal_cluster_id` → `name`) |
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

---

## Разведка для пункта 17: каталог товаров и остатки складов (снято живым вызовом 2026-07-20)

### 9. Список товаров кабинета — `ProductList` (v3)

| | |
|---|---|
| Endpoint | `POST /v3/product/list` |
| Обязательные параметры | `filter` (для всех товаров: `{"visibility":"ALL"}`) |
| Пагинация | `result.last_id` → передать в `last_id` следующего запроса; конец — пустой `last_id`. Всего товаров — `result.total` |
| Лимиты | `limit` ≤ 1000; ~1000 запросов/мин |

**Живой ответ (фрагмент):** у каждого товара есть `product_id`, `offer_id`, `sku`, `has_fbo_stocks`, `has_fbs_stocks`, `archived`, `is_discounted`, `quants[]`.

> ⚠️ Поле `items[].sku` ПРИСУТСТВУЕТ в живом ответе, но ОТСУТСТВУЕТ в swagger-схеме. Использовать можно, но с проверкой на null/0. Запасной путь получения sku — `/v3/product/info/list`.

### 10. Информация о товарах — `ProductInfoList` (v3, запасной путь для sku)

| | |
|---|---|
| Endpoint | `POST /v3/product/info/list` |
| Обязательные параметры | ровно ОДНА группа идентификаторов: `product_id` ИЛИ `offer_id` ИЛИ `sku` (смешивать нельзя — будет 400) |
| Лимиты | до 1000 идентификаторов за раз |

**Где лежит числовой sku:** `items[].sku` (основной), `items[].sources[].sku` (+ `source`: `SDS` = общий sku для FBO и FBS, либо раздельные `FBO`/`FBS`), `items[].stocks.stocks[].sku`, `items[].availabilities[].sku`. В проверенном кабинете у всех товаров `source: "sds"` — один общий sku.

**Грабли:**
- Несуществующий `product_id` даёт 200 с пустым `items`, а не 404 — проверять длину массива.
- В `stocks[].present` включён `reserved`; доступно = `present − reserved` (в `/v1/analytics/stocks` для этого есть готовое `available_stock_count`).

### Дополнение к разделу 7 (`AnalyticsStocks`, снято живым вызовом 2026-07-20)

- Параметр `skus` строго обязателен: **от 1 до 100** значений. Пустой массив → HTTP 400 `invalid_params` («value must contain between 1 and 100 items»). Запросить «все товары сразу» нельзя — сначала собрать sku из каталога, затем бить на пачки по 100.
- Подписки **PREMIUM_LITE достаточно** — метод отработал без ошибок.
- Пагинации нет: на 2 sku вернулось 60 строк одним ответом (одна строка = sku × склад, 29 полей, набор полей во всех строках идентичен).
- ⚠️ **Строки-агрегаты:** встречаются строки с `warehouse_id: 0` и пустым `warehouse_name` (иногда и `cluster_id: 0`) — это агрегаты уровня кластера без привязки к складу (например, `return_to_seller_stock_count`). При зеркалировании в лист их нужно обособлять отдельной категорией или фильтровать — иначе остаток задвоится при суммировании.
- `idc_cluster` and `ads_cluster` могут быть `null` — допускать null.
- `macrolocal_cluster_id` расшифровывается через ранее снятый `/v1/cluster/list` (раздел 6).

**Готовая цепочка для зеркала остатков (пункт 17):**
1. `/v3/product/list` (пагинация по `last_id`) → собрать все sku кабинета.
2. Разбить sku на пачки по 100.
3. По каждой пачке `/v1/analytics/stocks` → строки sku × склад.
4. Строки с `warehouse_id = 0` обособить как агрегаты кластера.
5. `macrolocal_cluster_id` → название кластера через `/v1/cluster/list`.

---

## Разведка для пункта 22 (26.07.2026): продажи FBO и черновики поставок

### Продажи FBO — `POST /v2/posting/fbo/list`

- Запрос: `filter.since` и `filter.to` (UTC, обязательны, период ≤ 1 года), `filter.status` (опционально), `limit` 1..1000 (обязателен), `offset` 0..20000, `dir` ASC/DESC, `with.analytics_data` / `with.financial_data`.
- Пагинация: offset/limit (НЕ last_id). Если за период > 20000 отправлений — сужать окно дат.
- Ответ `result[]`: `posting_number`, `order_id`, `status`, `substatus`, `created_at`, `in_process_at`, `products[]` (`sku`, `offer_id`, `name`, `quantity`, `price`), `analytics_data{}`, `financial_data{}`.
- КРИТИЧНО: склад отгрузки — `analytics_data.warehouse_id` и `analytics_data.warehouse_name`. Блок приходит ТОЛЬКО при `with.analytics_data: true`.
- КРИТИЧНО: кластер ДОСТАВКИ ПОКУПАТЕЛЮ — `financial_data.cluster_to`, кластер отгрузки — `financial_data.cluster_from`. Оба поля строковые: человекочитаемое название кластера, а не числовой идентификатор; название буквально совпадает с полем `name` справочника `/v1/cluster/list`. Блок приходит ТОЛЬКО при `with.financial_data: true`.
- Полный состав `analytics_data` (разведка 10.08.2026, 9 полей): `city`, `delivery_type`, `is_premium`, `payment_type_group_name`, `warehouse_id`, `warehouse_name`, `is_legal`, `client_delivery_date_begin`, `client_delivery_date_end`. Регион, область и почтовый индекс покупателя в API ОТСУТСТВУЮТ, география покупателя представлена только городом.
- Заполненность полей (замер 10.08.2026 на 538 отправлениях за 4 полные недели): `financial_data.cluster_to` заполнен у 538 из 538, то есть 100 %; `analytics_data.city` пуст у 89 из 538, то есть около 15 % — строить географию на городе нельзя.
- Объём ответа: 100 отправлений с обоими блоками `analytics_data` и `financial_data` весят около 168 КБ.
- Статусы: `awaiting_packaging`, `awaiting_deliver`, `delivering` — заказ в работе; `delivered` — продажа; `cancelled` — отмена.
- Глубина истории: проверено вживую, данные доступны минимум за 10–11 месяцев назад.
- Решения для листа «Продажи Ozon»: продажей считаем отправление с любым статусом, кроме `cancelled`, по дате `created_at`; при каждой синхронизации перезапрашиваются и перезаписываются последние 14 дней (подхват отмен задним числом).
- Источник кластера продажи (решение пункта 41 плана от 10.08.2026): `financial_data.cluster_to`, то есть кластер доставки покупателю. РАНЕЕ, до пункта 41, кластер определялся по `analytics_data.warehouse_id` через справочник складов, то есть по складу отгрузки. Замер 10.08.2026: 14,9 % отправлений (80 из 538 за 4 полные недели) уезжали в кластер, не совпадающий с кластером склада отгрузки, и записывались чужому кластеру.
- КАБИНЕТОВ OZON ДВА: Mercurius и MaxiStore. Синхронизация обходит оба по очереди, ключи хранятся отдельно для каждого, колонка «Кабинет» есть в листах «Остатки Ozon» и «Продажи Ozon». Объёмы сопоставимы: за неделю 27.07.2026 Mercurius дал 135 шт продаж, MaxiStore — 178 шт. Любой замер, отчёт или сверка обязаны указывать, к какому кабинету относятся.
- ⚠️ Ozon MCP в Claude Code подключён ТОЛЬКО к кабинету Mercurius. Замеры через MCP описывают примерно половину оборота, и переносить их выводы на MaxiStore нельзя. При сверке боевой таблицы с данными из MCP строки таблицы надо предварительно отфильтровать по колонке «Кабинет» со значением Mercurius, иначе суммы не сойдутся: 10.08.2026 неделя 2026-07-27 дала 313 шт в таблице против 135 шт в ответе MCP, и это не расхождение данных, а два разных кабинета.
- Справочник кластеров загружается ДВУМЯ запросами `/v1/cluster/list`: с `cluster_type: CLUSTER_TYPE_OZON` и с `cluster_type: CLUSTER_TYPE_CIS`, результаты склеиваются. Поэтому в справочнике 27 кластеров, а не 22: зарубежные Беларусь, Алматы, Астана, Армения и Узбекистан приходят вторым запросом. Замер только по первому типу даёт неполную картину.
- Проверка карты складов: кластер, вычисленный по `warehouse_id` через `/v1/cluster/list`, совпал с полем `financial_data.cluster_from` у 538 отправлений из 538. Карта складов исправна, дефект был в выборе источника, а не в сопоставлении.
- В `cluster_to` встречаются кластеры вне справочника `CLUSTER_TYPE_OZON` — Беларусь, Алматы, Астана. В приложении они попадают в строку «Без кластера (агрегат)»: входят в общую скорость продаж товара и в сигнал заказа на фабрике, но кластерных рекомендаций поставки не создают.

### Черновики заявок на поставку FBO (для кнопки «Создать поставку», пункт 22, этап H)

Флоу: создать черновик → расчёт → создать заявку. Методы:

| Метод | Путь | Класс | Ключевые поля |
|---|---|---|---|
| Черновик (прямая) | /v1/draft/direct/create | write | `cluster_info{macrolocal_cluster_id, items[]}` |
| Черновик (кросс-док) | /v1/draft/crossdock/create | write | + `delivery_info{type, drop_off_warehouse{warehouse_id, warehouse_type}}` |
| Инфо/расчёт | /v2/draft/create/info | read | `draft_id` → `clusters[].warehouses[]` (склады размещения) |
| Таймслоты | /v2/draft/timeslot/info | read | по draft_id/складу |
| Заявка по черновику | /v2/draft/supply/create | write | `draft_id`, `selected_cluster_warehouses[]{macrolocal_cluster_id, storage_warehouse_id}`, `supply_type`, `timeslot` |
| Статус создания | /v2/draft/supply/create/status | read | draft_id → id созданной заявки |

- Состав: `cluster_info.items[]` = `{sku, quantity}`, до 5000 позиций. Принимается ТОЛЬКО Ozon-SKU (int64), offer_id не принимается.
- Кластер назначения: `macrolocal_cluster_id` (4-значный id из /v1/cluster/list; он же приходит в /v1/analytics/stocks как `macrolocal_cluster_id`).
- Черновик живёт 30 минут, метода удаления FBO-черновика нет (самоуничтожается). Лимиты: 2/мин, 50/час, 500/день.
- Отмена уже созданной заявки: /v1/supply-order/cancel (+ /v1/supply-order/cancel/status).
- Вывод для этапа H: «только черновик» как отдельный шаг бессмыслен (30 минут, в ЛК не виден) — кнопка должна вести полный мастер до создания заявки, с подтверждением пользователя на каждом шаге.

## Разведка этапа H (28.07.2026): создание заявки на поставку — проверено вживую через Ozon MCP

Все формы ниже подтверждены живыми вызовами боевыми ключами. Метод /v2/draft/supply/create НЕ вызывался — его схема взята из описания.

### 1. POST /v1/cluster/list
Запрос: `{"cluster_type": "CLUSTER_TYPE_OZON"}`
В ответе у кластера ДВА разных идентификатора:
- `id` — внутренний, 1–3 знака (154, 2, 7). В черновиках НЕ используется.
- `macrolocal_cluster_id` — 4 знака, число (4002–4077). Именно он нужен для черновиков и заявок.
Также: `name`, `type`, `logistic_clusters[].warehouses[]{warehouse_id, name, type}`. Типы складов: FULL_FILLMENT, CROSS_DOCK, SORTING_CENTER.

### 2. POST /v1/draft/direct/create (один кластер)
Запрос:
`{"cluster_info": {"macrolocal_cluster_id": 4039, "items": [{"sku": 1706096599, "quantity": 1}]}, "deletion_sku_mode": "PARTIAL"}`
Ответ: `{"draft_id": 120214369, "errors": []}`

КРИТИЧНО:
- `deletion_sku_mode` обязателен де-факто, хотя в swagger помечен как необязательный с дефолтом PARTIAL. Без него Ozon отвечает HTTP 400 «value must not be in list [0]».
- `operation_id` в ответе НЕТ — метод сразу возвращает `draft_id`. Опрос по operation_id в этом флоу не применяется.
- `cluster_info` — ОБЪЕКТ, ровно один кластер. Плоский массив `cluster_ids` метод не принимает.
- Черновик живёт 30 минут, в личном кабинете НЕ виден, самоуничтожается. Записи в кабинете создаёт только /v2/draft/supply/create.

### 3. POST /v2/draft/create/info (расчёт черновика)
Запрос: `{"draft_id": 120214369}` — ключ именно draft_id, не operation_id.
Ответ: `status` (UNSPECIFIED / IN_PROGRESS / SUCCESS / FAILED), `errors[]`, `clusters[]`.
Внутри `clusters[]`: `macrolocal_cluster_id`, `cluster_name`, `supply_type`, `warehouses[]`.
Внутри `warehouses[]`:
- `storage_warehouse.warehouse_id` — id склада размещения (int64, 14–16 знаков)
- `storage_warehouse.name`, `storage_warehouse.address`
- `availability_status.state` — FULL_AVAILABLE / PARTIAL_AVAILABLE / NOT_AVAILABLE / UNSPECIFIED
- `availability_status.invalid_reason` — вживую встречались UNSPECIFIED (когда доступен), NOT_AVAILABLE_RANK (склад не проходит по рейтингу), NOT_AVAILABLE_MATRIX (склад не принимает такие товары)
- `bundle_id` — товары попадают в поставку; `restricted_bundle_id` — не попадают
- `total_rank` (1 = лучший), `total_score` (0…1)
На живом прогоне расчёт вернул SUCCESS с первого запроса, но цикл опроса на случай IN_PROGRESS закладывать обязательно.
Пример: из 17 складов кластера Москва (4039) доступны были только два — ХОРУГВИНО_РФЦ (rank 1) и СОФЬИНО_РФЦ (rank 2).

### 4. POST /v2/draft/timeslot/info
Все пять полей обязательны:
`{"draft_id": 120214369, "date_from": "2026-07-28", "date_to": "2026-08-10", "supply_type": "DIRECT", "selected_cluster_warehouses": [{"macrolocal_cluster_id": 4039, "storage_warehouse_id": 15431806189000}]}`
- Формат дат: строгий `^\d{4}-(0[1-9]|1[0-2])-\d{2}$`, то есть YYYY-MM-DD.
- Период максимум 28 дней от текущей даты.
- `selected_cluster_warehouses` — максимум 20 элементов.
Ответ: `result.requested_date_from`, `result.requested_date_to`, `result.drop_off_warehouse_timeslots{current_time_in_timezone, warehouse_timezone, days[]{date_in_timezone, timeslots[]{from_in_timezone, to_in_timezone}}}`, `error_reason`.
Примечание: живой ответ через Ozon MCP получить не удалось — в swagger-снимке MCP поле pattern для дат записано как подсказка " YYYY-MM-DD" и локальный валидатор блокирует любую настоящую дату. Это дефект MCP, а не Ozon: прямой HTTP-запрос форму принимает.

### 5. POST /v2/draft/supply/create (схема, живьём не вызывался)
`{"draft_id": <int64>, "supply_type": "DIRECT|CROSSDOCK|MULTI_CLUSTER", "selected_cluster_warehouses": [{"macrolocal_cluster_id": <int64>, "storage_warehouse_id": <int64>}], "timeslot": {"from_in_timezone": "...", "to_in_timezone": "..."}}`
- Обязательны: `draft_id`, `supply_type`, `selected_cluster_warehouses`.
- `storage_warehouse_id` — только для DIRECT.
- `timeslot` — ОДИН объект на всю заявку, не массив и не по складу; формально необязателен.
- Для MULTI_CLUSTER передавать нужно ВСЕ кластеры из расчёта, иначе ошибка INVALID_CLUSTERS_COUNT.
Ответ: `draft_id`, `error_reasons[]`.

### 6. Один кластер против нескольких
- `/v1/draft/direct/create` — ровно ОДИН кластер (`cluster_info` — объект), `delivery_info` отсутствует как поле.
- `/v1/draft/multi-cluster/create` — `clusters_info` массив до 20 кластеров, у каждого свой `items[]` до 5000 позиций; дополнительно ОБЯЗАТЕЛЕН `delivery_info` с точкой отгрузки (`type`, `drop_off_warehouse{warehouse_id, warehouse_type}` либо `seller_warehouse_id`).
- Вывод: несколько кластеров в одной заявке возможны только через MULTI_CLUSTER и только с указанием точки отгрузки.

### 7. Прочие находки
- `/v3/product/list` с телом `{"filter": {"visibility": "ALL"}, "limit": 5}` отдаёт `result.items[]{product_id, offer_id, sku, has_fbo_stocks}` — способ получить Ozon-SKU по артикулу, если зеркала остатков недостаточно.
- Ozon MCP валидирует запросы локально по swagger до отправки; такие отказы приходят как OzonClientValidationError и до Ozon не доходят.

## Разведка пункта 24 (30.07.2026): грузоместа и этикетки — проверено вживую на заявке 120366939

Все формы ниже сняты живыми вызовами боевыми ключами. Создано одно грузоместо и одна этикетка.

### Ключ всей цепочки — supply_id, а не order_id
- `/v3/supply-order/get` принимает ТОЛЬКО `order_id`; `order_number` и `supply_id` дают HTTP 400 «Orders … not found».
- Все методы грузомест принимают ТОЛЬКО `supply_id` (в приложении это PostingID во «Внешних отгрузках»). `order_id` они не понимают.
- У заявки на один кластер `order_number` численно совпадает с `supply_id` — совпадение, полагаться нельзя.

### 1. POST /v1/cargoes/create — запись
Запрос: `supply_id` (int64, обяз.), `cargoes[]` (обяз., не более 30 коробок или 40 палет), `delete_current_version` (bool, необяз.).
Внутри `cargoes[]`: `key` (ваш уникальный ключ, обяз.), `value` (обяз.), `value.type` (обяз.), `value.items[]` (до 5000).
Внутри `items[]`: `barcode`, `offer_id`, `quantity`, `quant`, `expires_at` — все необязательные.
КРИТИЧНО:
- `value.type` объявлен обязательным, но в swagger не описан вообще — ни типа, ни enum. Вживую принято значение `BOX`.
- `delete_current_version: true` заменяет ВСЮ раскладку поставки. Это единственный способ исправить состав: удалить единственную коробку методом `/v1/cargoes/delete` нельзя, он отвечает `CANT_DELETE_ALL_CARGOES`. ПРОВЕРЕНО ВЖИВУЮ 30.07.2026: на перезапись это ограничение НЕ распространяется — вызов с `delete_current_version: true` штатно снёс единственное грузоместо поставки и создал вместо него три новых.
- Ответ при успехе: только `operation_id`, блок `errors` ОТСУТСТВУЕТ целиком, а не приходит пустым.
- При ошибке: `errors.error_reasons[]` (INVALID_STATE, VALIDATION_FAILED, WAREHOUSE_LIMITS_EXCEED, SUPPLY_NOT_BELONG_CONTRACTOR, SUPPLY_NOT_BELONG_COMPANY, IS_FINALIZED, SKU_DISTRIBUTION_DISABLED, SUPPLY_IS_NOT_EMPTY, OPERATION_NOT_FOUND, OPERATION_FAILED) и `errors.items_validation[]{barcode, cargo_key, quant}`.
Пример живого запроса, принятого с первой попытки:
`{"supply_id": 2000061478681, "cargoes": [{"key": "recon-box-1", "value": {"type": "BOX", "items": [{"barcode": "OZN2128609943", "offer_id": "Органайзер_3_пол_белый", "quantity": 1, "quant": 1}]}}]}`

### 2. POST /v2/cargoes/create/info — чтение
Запрос: `operation_id` (string, единственное поле).
Ответ: `status` (STATUS_UNSPECIFIED / SUCCESS / IN_PROGRESS / FAILED), `result.cargoes[].key` (ваш ключ), `result.cargoes[].value.cargo_id` (int64, номер коробки от Ozon).
Сопоставление своих коробок с номерами Ozon — ТОЛЬКО по полю `key`. ПРОВЕРЕНО ВЖИВУЮ 30.07.2026: порядок элементов в `result.cargoes[]` произвольный, на живом прогоне он пришёл обратным (box-3, box-2, box-1), и номера `cargo_id` присвоены тоже наоборот — box-1 получил наибольший номер. Полагаться на порядок массива запрещено.
`bundle_id` коробки этот метод НЕ возвращает.
Вживую SUCCESS пришёл с первого опроса, но цикл опроса закладывать обязательно.
Версия v1 этого метода (`/v1/cargoes/create/info`) отключена 07.11.2025 — не использовать.

### 3. POST /v1/cargoes/get — чтение
Запрос: `supply_ids[]` (до 100).
Ответ: `supply[]{supply_id, bundle_id, cargoes[]}`; внутри `cargoes[]`: `cargo_id`, `type`, `bundle_id` (СВОЙ у коробки, отличается от bundle_id поставки), `content_type` (вживую MONO), `placement_zone_type` (вживую SINGLE), `tracking_info{date, status, type}`.
Единственный источник bundle_id коробки. Состава коробки метод не отдаёт — состав раскрывается вызовом `/v1/supply-order/bundle` по bundle_id коробки.
Это делает хранение грузомест в базе приложения ненужным: текущее состояние всегда читается из Ozon по supply_id.

### 4. POST /v1/cargoes-label/create — запись
Запрос: `supply_id` (обяз.), `cargoes[].cargo_id` (необяз.). Без `cargoes[]` этикетки печатаются на все грузоместа поставки.
Ответ: `operation_id`; ошибки `errors.error_reasons[]`: INVALID_STATE, OPERATION_NOT_FOUND, OPERATION_FAILED, SUPPLY_NOT_BELONG_CONTRACTOR, SUPPLY_NOT_BELONG_COMPANY, SUPPLY_IS_EMPTY, CARGOES_NOT_FOUND.

### 5. POST /v1/cargoes-label/get — чтение
Запрос: `operation_id`.
Ответ: `status` (SUCCESS / IN_PROGRESS / FAILED), `result.file_url`, `result.file_guid` (deprecated).
БЕЗОПАСНОСТЬ: `file_url` — pre-signed ссылка на S3 с подписью внутри URL. Открывается БЕЗ ключей Ozon кем угодно, живёт 24 часа (`X-Amz-Expires=86400`). Имя файла зависит от запроса: если `cargoes[]` передан, файл называется `tag_<cargo_id>.pdf`; если `cargoes[]` не передан и этикетки печатаются на всю поставку, файл называется `<supply_id>.pdf`. Проверено вживую 30.07.2026: на трёх грузоместах пришёл один PDF на 3 страницы, 83 874 байта, по одной этикетке на коробку. Ссылку нельзя сохранять в базу, писать в журналы и передавать в переписке — она сама себе пропуск.
Старый метод `GET /v1/cargoes-label/file/{file_guid}` отключён 10.04.2026 — не использовать.

### 6. POST /v1/cargoes/rules/get — чтение
Запрос: `supply_ids[]` (до 100). Ключ `order_id` метод не принимает.
Ответ: `supply_check_lists[]`, у каждого `supply_id` и шесть правил, у каждого правила `satisfied`:
- `cargoes_presents_rule` — грузоместа указаны; `count`, `cargo_count_per_type[]{type, count}`
- `package_units_with_distribution_rule` — у всех коробок непустой состав; `count_with_distribution`, `count_all`
- `is_valid_distribution_rule` — состав грузомест совпадает с составом поставки; `count_sku_total`, `count_distributed_sku`, `percents_int`
- `expire_dates_presented_rule` — сроки годности; `is_applicable` вживую false
- `placement_zones_rule` — зоны размещения; `count_cargoes_with_mono_placement_zone`, `count_cargoes_all`
- `edit_deadline_expire_rule` — крайний срок редактирования
КРИТИЧНО: `is_valid_distribution_rule` считает АРТИКУЛЫ, а не штуки, и бинарно. При 1 разложенной штуке из 18 `count_distributed_sku` = 0 и `percents_int` = 0; при 17 из 18 будет ровно то же самое. Строить по этому полю прогресс-бар нельзя, только признак «да/нет».
Не путать с `package_units_with_distribution_rule`: он отвечает на другой вопрос — все ли созданные коробки непустые, и при одной заполненной коробке уже даёт true.
Наблюдение: `edit_deadline_expire_rule.satisfied` остаётся false на свежей заявке, пока не выбран таймслот. В схеме это не описано.

### 7. POST /v1/cargoes/delete и /v1/cargoes/delete/status — приложением НЕ используются
`delete`: запрос `supply_id`, `cargo_ids[]` (до 70); ответ `operation_id`, `errors.supply_error_reasons[]` (SUPPLY_NOT_FOUND, CANT_DELETE_ALL_CARGOES, SUPPLY_DOES_NOT_BELONG_TO_THE_CONTRACTOR, SUPPLY_DOES_NOT_BELONG_TO_THE_COMPANY, SUPPLY_CARGOES_IS_FINALIZED, SUPPLY_CARGOES_LOCKED, OPERATION_NOT_FOUND).
`delete/status`: запрос `operation_id`, ответ `status` (SUCCESS / IN_PROGRESS / ERROR).
Ловушка: финальный статус ошибки у удаления называется ERROR, а у создания грузомест и этикеток — FAILED.
Исправление состава делается перезаписью через `delete_current_version: true`, поэтому удаление приложению не нужно.

### 8. Вывод для архитектуры пункта 24
Хранение грузомест в Google Sheets не требуется: `supply_id` уже лежит во «Внешних отгрузках» (PostingID), состав поставки — там же в itemsJSON, а текущее состояние коробок и готовность читаются из Ozon двумя вызовами. УТОЧНЕНИЕ от 31.07.2026: вывод про хранение остаётся в силе, но утверждение «правок в Code.gs пункт 24 не требует» отменено — складывание документов заявки на Google Диск выполняет Apps Script, см. секцию разведки A2 ниже.

## Разведка A2 пункта 24 (31.07.2026): документы заявки — чего в API НЕТ

Задача разведки: найти методы для трёх кнопок скачивания в личном кабинете — «Состав через xls», «Этикетки всех товаров», «Этикетки грузомест поставок». Результат в основном отрицательный, и это ценный факт: не искать заново.

### Отрицательные результаты
- **«Состав через xls» — метода в API НЕТ.** Три независимых обоснования: сплошной листинг 44 методов разделов поставок FBO (FboSupplyRequest — 30 методов, Доставка FBO — 14) показал, что файл или ссылку на файл отдают только три метода этикеток грузомест; закрытый enum `report_type` в `/v1/report/info` содержит 12 типов, состава поставки среди них нет; полнотекстовый поиск по xls, xlsx, excel, document, docs, report, file, download не дал ни одного метода, принимающего order_id, supply_id или bundle_id.
- **«Этикетки всех товаров» — метода в API НЕТ.** Печать этикеток товаров Ozon реализовал только для схемы FBS (`/v2/posting/fbs/package-label` и родственные), они работают по `posting_number` — сущности, которой у заявки FBO не существует. Методы `/v1/barcode/generate` и `/v1/barcode/add` заводят и привязывают значение штрихкода в карточке товара и не возвращают ни файла, ни ссылки, только массив ошибок.
- **Этикеток грузомест уровня заявки в API НЕТ.** ПРОВЕРЕНО ВЫЗОВОМ 31.07.2026: `/v1/cargoes-label/create` с телом `{"supply_id": 120366939}` (подставлен order_id) отвечает HTTP 400 «Order snapshot with orderId: 120366939 not exist». Внутри Ozon сервис этикеток называет supply_id полем orderId, то есть уровня всей заявки в этом API просто нет. Для заявки на N кластеров нужно N вызовов по каждому supply_id из supplies[] и на выходе будет N отдельных файлов.
- **Акта приёмки и транспортной накладной для FBO в API нет.** Для схемы FBP такие методы существуют (`/v1/fbp/act-from/create`, `/v1/fbp/act-to/create`), для FBO Ozon их не сделал.
- **Имя скачиваемого файла API не задаёт.** Полей для имени нет ни в одной схеме. Ozon формирует имя сам и передаёт его в заголовке content-disposition pre-signed ссылки.

### Ловушка поиска по индексу MCP
Метод `GET /v1/cargoes-label/file/{file_guid}` не находится полнотекстовым поиском ни по слову file, ни по слову label, хотя лежит ровно в нужном разделе. Он виден только в полном листинге раздела. Вывод: искать методы поиском по индексу недостаточно, нужен сплошной листинг разделов.

### Структура файла «Состав через xls» (снята с ручной выгрузки кабинета)
Файл содержит два листа. Рабочий — «Состав ГМ поставки», семь колонок в таком порядке:
`ШК товара` | `Артикул товара` | `Кол-во товаров` | `Зона размещения` | `Срок годности ДО в формате YYYY-MM-DD (необязательно)` | `ШК ГМ` | `Тип ГМ (не обязательно)`
Одна строка = один артикул в одном грузоместе. Пример живой строки:
`OZN1706096599` | `Органайзер_2_пол_белый` | `8` | `Сортируемый товар` | (пусто) | `1022094724078000` | `Коробка`
Второй лист — «Инструкция», шесть строк текста для продавца, приложению не нужен.
ИСТОЧНИКИ ПОЛЕЙ, все данные у приложения уже есть:
- ШК товара = `barcode` из `/v1/supply-order/bundle`
- Артикул товара = `offer_id` оттуда же
- Кол-во товаров = количество из раскладки приложения (модуль src/lib/ozonCargo.ts)
- Зона размещения = `placement_zone` из bundle; значение `SORT` в файле записано как «Сортируемый товар»
- Срок годности = пусто, у товаров этого продавца не применяется
- ШК ГМ = `cargo_id` из `/v2/cargoes/create/info`
- Тип ГМ = «Коробка», соответствует `type: BOX`
ВЫВОД: файл не нужно скачивать, его нужно СОБИРАТЬ на своей стороне. В кабинете он двусторонний (Ozon отдаёт шаблон, продавец заполняет и грузит обратно), но при создании грузомест через API обратная загрузка не требуется — файл остаётся спецификацией для сборщика.

### Структура файла «Этикетки всех товаров»
Кабинет отдаёт архив `barcode_<order_id>-1.zip`, внутри по одному PDF на Ozon-SKU с именем `<sku>.pdf` (например `1706096599.pdf`). Содержимое не зависит от конкретной заявки: этикетка привязана к товару, а не к поставке. Поэтому такие PDF имеет смысл хранить один раз как библиотеку и переиспользовать во всех заявках.

### Формат выдачи этикеток грузомест
Кабинет отдаёт `tags-cargoes-by-supply-<supply_id>.zip`, внутри одноимённый PDF. Через API при вызове без списка `cargoes` приходил PDF с именем `<supply_id>.pdf`. Ozon может отдать и архив, и одиночный PDF — сохранять файл как пришло, не распаковывая.

### Итог для пункта 24
Из трёх кнопок кабинета через API закрывается одна — этикетки грузомест, и то покластерно. Состав xls приложение собирает само из данных, которые у него уже есть. Этикетки товаров через API недоступны в принципе и хранятся библиотекой PDF на Google Диске.

## Отменённые заявки на поставку (31.07.2026): проверено вживую

Продавец удаляет заявку в личном кабинете — API не удаляет её, а переводит в `CANCELLED`. Проверено на пяти заявках: 120494337, 120495760, 120501010, 120501606 и контрольной 119933495.

### Что отдаёт API
- `POST /v3/supply-order/get` возвращает удалённую заявку ПОЛНЫМ объектом: `state: "CANCELLED"`, и у каждого элемента `supplies[]` тоже `state: "CANCELLED"`. Согласованно, без исключений. Данные не урезаются: точка отгрузки, метки, `bundle_id`, кластеры — всё на месте.
- Пакетный запрос НЕ падает из-за отменённой заявки: пять идентификаторов вернулись все. Лимит — 50 за вызов.
- ВНИМАНИЕ: порядок элементов в ответе не совпадает с порядком в запросе — Ozon сортирует по возрастанию `order_id`. Сопоставлять только по полю `order_id`.
- Несуществующий (а не отменённый) идентификатор даёт жёсткую ошибку 400 `RpcException(InvalidArgument): Orders … not found`. В пакете такой идентификатор, предположительно, уронит весь запрос — вживую не проверялось.
- `POST /v3/supply-order/list` умеет отдавать отменённые: достаточно добавить `CANCELLED` в `filter.states`. Поле `filter.states` обязательное и не может быть пустым массивом. Полный enum: `DATA_FILLING`, `READY_TO_SUPPLY`, `ACCEPTED_AT_SUPPLY_WAREHOUSE`, `IN_TRANSIT`, `ACCEPTANCE_AT_STORAGE_WAREHOUSE`, `REPORTS_CONFIRMATION_AWAITING`, `REPORT_REJECTED`, `COMPLETED`, `REJECTED_AT_SUPPLY_WAREHOUSE`, `CANCELLED`, `OVERDUE`. Отдельного состояния «удалена» в API нет.
- ЛОВУШКА: `CANCELLED` смешивает два разных события — «продавец удалил черновик» и «поставка отменена по ходу дела». Различить их по самому `state` нельзя. Косвенный признак удалённого черновика — `timeslot: null` и малый разрыв между `created_date` и `state_updated_date`, но это эвристика, а не гарантия.

### Почему CANCELLED в фильтр листинга ДОБАВЛЯТЬ НЕЛЬЗЯ
В кабинете больше сотни исторических отменённых заявок: запрос с этим состоянием вернул ровно 100 идентификаторов и `last_id` для следующей страницы. Добавление `CANCELLED` в опрос заставило бы приложение перебирать всю историю при каждом прогоне. Вместо этого опрос берёт идентификаторы из журнала «Заявки Ozon» — см. ниже.

### Как приложение обрабатывает отмену (решения 31.07.2026)
1. Строки во «Внешние отгрузки» по отменённым и просроченным поставкам, которые ещё не отслеживаются, НЕ создаются: поставка не отгружалась, засорять учётный лист нечем. Правило существовало и раньше, оно сохранено.
2. Опрос берёт идентификаторы заявок из ТРЁХ источников: листинг активных статусов, уже отслеживаемые строки «Внешних отгрузок» и журнал «Заявки Ozon». Третий источник добавлен 31.07.2026 и нужен как раз для заявок, удалённых до первого опроса. Из журнала берутся строки не старше 30 дней, у которых нет строки отгрузки в терминальном статусе.
3. Заявкам, которые Ozon вернул в `CANCELLED`, действие `applyCancelledOzonOrders` проставляет в журнале статус «Отменена». Это МГНОВЕННО возвращает забронированный остаток на «Мой склад»: логика зачёта (`src/lib/ozonPending.ts`) пропускает журнальные статусы, начинающиеся на «отмен».
4. Заявки, отменённые уже ПОСЛЕ начала отслеживания, опрос повторно не запрашивает. Их журнальные строки закрывает функция `syncOzonJournalFromShipments` — локально, без обращения к Ozon: если у заявки есть строки во «Внешних отгрузках» и ВСЕ они терминальные, журналу проставляется «Отменена», «Просрочена» или «Отказано».
5. Отменённые записи хранятся 28 дней (`OZON_CANCELLED_KEEP_DAYS`), затем удаляются из базы.

### Семь условий безопасного удаления строки «Внешних отгрузок»
Строка удаляется, ТОЛЬКО если выполнено всё сразу:
1. `Статус Ozon` = `CANCELLED`
2. внутренний `Статус` = `new` — поставка никогда не оформлялась
3. `TransGroupInfo` пусто — нет ни одной проводки в «Истории»
4. `ПринятоJSON` пусто — не было приёмки
5. `ПерерасчётJSON` пусто — не было перерасчёта
6. `ПересортJSON` пусто — не было пересорта
7. `Дата обнаружения` старше 28 дней

ПОЧЕМУ ОДНОГО СТАТУСА МАЛО: функция `updateExternalShipmentStatus` умеет возвращать строку в статус `new`, НЕ очищая при этом `TransGroupInfo`. То есть строка может быть одновременно `new` и связанной с реальными проводками. Условия 3–6 закрывают именно этот случай. Ослаблять их нельзя.

Записи журнала «Заявки Ozon» учётными не являются и удаляются по статусу «отмен…» и возрасту.

## Виртуальные заявки на поставку (`order_tags.is_virtual`)

Разведка проведена 07–08.08.2026. Закрыт пункт 31 плана.

### Что это такое
Ozon создаёт заявку на поставку **сам**, без участия продавца, в двух известных случаях:
1. нашёл потерянный товар и оприходует его обратно на свой склад;
2. после отказа в приёмке формирует допоставку по уже отгруженному товару.

В обоих случаях товар **физически уже находится у Ozon**, склад продавца в операции не участвует. Резерв под такую заявку строить нельзя, списание проводить нельзя — иначе один и тот же товар уйдёт со склада дважды.

### Признак в API
Метод `POST /v3/supply-order/get`, объект `order.order_tags`:

| Поле | Тип | Значение |
| :---- | :---- | :---- |
| `is_virtual` | boolean | `true` у заявок, созданных Ozon. **Единственный признак виртуальности** |
| `original_supply_id` | number | Идентификатор исходной поставки. У виртуальных отличен от нуля, у обычных равен нулю. Хранится только для справки, в логику не заложен |

Прокси разбирает `order_tags` в блоке Step 5 обработчика `/api/ozon/check` и прокидывает `isVirtual` и `originalSupplyId` в Apps Script. В листе «Внешние отгрузки» им соответствуют колонки «Виртуальная» (строка `ДА` либо пусто) и «ИсходнаяПоставка».

### Замер на боевых данных 07.08.2026
Из 63 строк листа «Внешние отгрузки» значение `ДА` получили ровно 4 — те самые заявки, что висели на вкладке «Поставки Озон» с ложным резервом.

| PostingID | Статус Ozon | Исходная поставка |
| :---- | :---- | :---- |
| 2000062273648 | `REPORTS_CONFIRMATION_AWAITING` | 2000061291551 |
| 2000062273936 | `REPORTS_CONFIRMATION_AWAITING` | 2000061291551 |
| 2000062278039 | `REPORTS_CONFIRMATION_AWAITING` | 2000061291551 |
| 2000062282731 | `REPORTS_CONFIRMATION_AWAITING` | 2000061291551 |

Все четыре указывают на одну исходную поставку заявки № 120361763-1, по которой списание было проведено 29.07.2026. Флаг `is_virtual` покрыл все случаи, второго признака не потребовалось. `КластерID` у виртуальных заявок пуст.

Ложный резерв, который они создавали: Органайзер_2_пол_PureWhite — 16 шт (2 заявки по 8), Органайзер_3_пол_PureWhite — 12 шт (2 заявки по 6).

### Ловушки
- **Числовой `order_number` виртуальность НЕ означает.** Номер вида `2000058667455` встречается и у обычных заявок; заявки продавца могут иметь как номер с суффиксом `-1`, так и чисто числовой. Использовать только `is_virtual`.
- **Виртуальные заявки доходят до статуса `ACCEPTED_AT_SUPPLY_WAREHOUSE` и дальше**, то есть обычная проверка `isStockDeparted` для них срабатывает и требует списания. Отсекать надо именно по флагу, а не по статусу.
- **В журнал «Заявки Ozon» они не попадают** — его ведёт приложение при создании собственных заявок.
- Разведку через Ozon MCP 07.08.2026 провести не удалось: TCP-соединение до `api-seller.ozon.ru` обрывалось по таймауту при работающем интернете и открывающемся сайте `ozon.ru`. Замер снят чтением боевой таблицы через коннектор Google Drive.

## Стоимость логистики поставки до кластера (20.08.2026): в API её НЕТ

Вопрос владельца: Ozon показывает стоимость логистики до каждого кластера при оформлении заявки — можно ли получить её ДО финального оформления, чтобы подсказывать цену доставки одной единицы товара.

**Ответ: нет. Ни до создания заявки, ни после.** Проверено по индексу Ozon API (466 методов) — ни в одной схеме ответа методов поставки нет ни одного денежного поля.

Что именно проверено:

| Метод | Что отдаёт | Деньги |
|---|---|---|
| `/v1/draft/multi-cluster/create` → `/v2/draft/create/info` (`DraftCreateInfo`) — **это те самые методы, которые вызывает наш прокси** в `server.ts` при нажатии «Оформить заявку в Ozon» | кластеры → склады: `availability_status` (`state`, `invalid_reason`), `bundle_id`, `restricted_bundle_id`, `storage_warehouse`, `supply_tags`, `total_rank`, `total_score` | нет |
| `/v1/cluster/list` (`SupplyDraftAPI_DraftClusterList`) | id и названия кластеров, склады внутри | нет |
| `/v2/draft/timeslot/info` (`DraftTimeslotInfo`, помечен deprecated) | только таймслоты и часовой пояс | нет |
| `/v3/supply-order/get`, `/v1/supply-order/details` (`SupplyOrderAPI_SupplyOrderDetails`) — уже СОЗДАННАЯ заявка | статусы, состав, таймслот, водитель и машина, метки | нет |

Поиск по всему индексу по запросам «стоимость / тариф / логистика / цена доставки» в разделе поставок даёт **ноль** методов.

`total_score` и `total_rank` из `DraftCreateInfo` — это рейтинг и ранг склада, а не деньги. Спутать их с ценой легко, но они безразмерные.

**Единственное место, где появляются реальные деньги за логистику, — постфактум в финансовых отчётах:** `/v3/finance/transaction/list` (`FinanceAPI_FinanceTransactionListV3`) и `/v3/finance/transaction/totals`. Это фактически списанные суммы после обработки поставки, а не прогноз на момент решения.

Не путать с `/v5/product/info/prices` (`ProductAPI_GetProductInfoPrices`): там есть тарифы логистики, но это логистика ПРОДАЖИ — доставка товара покупателю, — а не доставка поставки на склад кластера.
