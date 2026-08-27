// ===== Item 62. Why Ozon refused to calculate the draft =====
// A multi-cluster draft is all-or-nothing: /v1/draft/multi-cluster/create accepts the
// request and hands out a draft_id, and only then /v2/draft/create/info answers FAILED
// if a SINGLE cluster does not pass. That is why "all clusters" fails while a short
// list of the same article goes through.
//
// Ozon does name the culprit — errors[].error_message, errors[].error_reasons and
// errors[].items_validation carry the code, the guilty clusters and the rejected SKUs.
// Until item 62 the proxy put that answer into `details` and nobody ever looked at it,
// so every refusal reached the owner as the bare word FAILED.
//
// The module has no imports on purpose: the proxy (Node), the screen (React) and the
// tests all read the same dictionaries.

/** Одна ошибка из ответа Ozon, разобранная по-русски. */
export interface DraftFailure {
  /** Код Ozon, например NOT_AVAILABLE_CLUSTERS. Пустая строка — кода не было. */
  code: string;
  /** Расшифровка кода. */
  text: string;
  /** Уточняющие причины из error_reasons, уже по-русски. */
  reasons: string[];
  /** Кластеры, на которые Ozon показал пальцем. */
  clusterIds: string[];
  /** Отклонённые товары с причинами. */
  items: { clusterId: string; sku: string; reasons: string[] }[];
  /** Текст message от Ozon, если он был. */
  message: string;
}

const str = (value: any): string => String(value === null || value === undefined ? '' : value).trim();

const upper = (value: any): string => str(value).toUpperCase();

/** errors[].error_message — что именно не получилось. */
export const DRAFT_ERROR_RU: Record<string, string> = {
  UNSPECIFIED: 'Ozon не назвал причину',
  EMPTY_ITEMS_LIST: 'Ozon получил пустой список товаров',
  ITEMS_COUNT_MORE_THAN_MAX: 'В заявке слишком много товаров',
  UNKNOWN_CLUSTER_IDS: 'Ozon не знает такой кластер',
  ITEMS_VALIDATION: 'Ozon отклонил товары в заявке',
  DROP_OFF_POINT_DOES_NOT_EXIST: 'Точка отгрузки не существует — проверьте её в настройках Ozon',
  DROP_OFF_POINT_HAS_NO_TIMESLOTS: 'На точке отгрузки нет свободных таймслотов',
  TOTAL_VOLUME_IN_LITRES_INVALID: 'Объём поставки слишком большой для этой точки отгрузки',
  SKU_DISTRIBUTION_REQUIRED_BUT_NOT_POSSIBLE: 'Ozon не смог распределить товары по складам',
  CROSS_DOCK_IN_DELIVERY_POINT_DISABLED_FOR_SELLER: 'Кросс-докинг через пункт выдачи для вас отключён',
  DUPLICATE_SKUS_IN_REQUEST: 'В заявке один и тот же товар передан дважды',
  CAN_NOT_CREATE_DRAFT: 'Ozon не смог создать черновик',
  DRAFT_TOTALS_INVALID_ERROR: 'Ozon посчитал итоги черновика некорректными',
  CAN_NOT_START_CALCULATION: 'Ozon не смог запустить расчёт',
  PICKUP_IS_NOT_AVAILABLE: 'Самовывоз недоступен',
  DROP_OFF_NOT_COMPATIBLE_WITH_PICKUP: 'Точка отгрузки несовместима с самовывозом',
  UNDEFINED: 'Ozon вернул неизвестную ошибку'
};

/** errors[].error_reasons — уточнение к коду. */
export const DRAFT_REASON_RU: Record<string, string> = {
  UNSPECIFIED: 'причина не указана',
  ORDER_CREATION_NOT_AVAILABLE_FOR_SELLER: 'создание заявок недоступно для продавца',
  ALL_ITEMS_REJECTED: 'все товары отклонены',
  NOT_AVAILABLE_CLUSTERS: 'кластер не принимает поставку',
  ALL_ITEMS_COUNT_INVALID: 'в составе больше 5000 SKU',
  ALL_ITEMS_VOLUME_INVALID: 'объём состава больше 100 000 литров',
  ALL_BUNDLES_EMPTY: 'товарные составы пустые',
  HAS_EMPTY_BUNDLE: 'хотя бы у одного кластера пустой состав',
  DISABLED_FOR_SELLER: 'отгрузка курьером отключена для продавца',
  NO_ACTIVE_SELLER_WAREHOUSE: 'нет ни одного активного склада продавца',
  INVALID_SELLER_WAREHOUSE: 'склад продавца недоступен',
  MINIMUM_VOLUME_IN_LITRES_INVALID: 'состав слишком маленький для точки отгрузки',
  UNDEFINED: 'неизвестная причина'
};

/** items_validation[].rejected_items[].reasons — за что выбросили конкретный товар. */
export const DRAFT_ITEM_REASON_RU: Record<string, string> = {
  UNSPECIFIED: 'причина не указана',
  OUT_OF_ASSORTMENT: 'товар не входит в ассортимент склада',
  INVALID: 'недействительный товар',
  INCOMPATIBLE_WAREHOUSE: 'товар нельзя разместить на этом складе',
  EMPTY_BARCODE: 'у товара нет штрихкода',
  EMPTY_PS_ATTRIBUTE: 'у товара нет обязательного атрибута',
  MULTIPLICITY: 'количество не кратно продаваемой партии',
  NO_PRICE: 'у товара нет цены',
  INVALID_ITEM_COUNT_MAX: 'количество больше максимального',
  INVALID_ITEM_COUNT_ZERO: 'количество равно нулю',
  SKU_REJECTED_BY_ACCEPTANCE_RESTRICTIONS: 'товар отклонён ограничениями на приёмку',
  SKU_WITH_ETTN_REQUIRED_TAG_NOT_ALLOWED: 'товар с электронной ТТН здесь не принимают',
  SKU_WITHOUT_ETTN_REQUIRED_TAG_NOT_ALLOWED: 'товар без электронной ТТН здесь не принимают',
  SKU_WITH_TRACEABLE_TAG_NOT_ALLOWED: 'прослеживаемый товар здесь не принимают',
  SKU_IS_RESTRICTED: 'товар ограничен к приёмке',
  EMPTY_CLUSTER: 'у товара нет кластера',
  SKU_WITH_UTD_REQUIRED_TAG_NOT_ALLOWED: 'товар с обязательным УПД здесь не принимают',
  CORRUPTED_ASSORTMENT: 'не получилось добавить товар в заявку',
  STORAGE_BELARUS_SKU_HAS_NO_ANY_FEACN: 'нет кода ТН ВЭД для хранения в Беларуси',
  STORAGE_BELARUS_SKU_HAS_NO_SELLER_FEACN: 'нет кода ТН ВЭД продавца для хранения в Беларуси',
  TRACEABLE_SKU_HAS_NO_GTIN_BARCODE: 'у прослеживаемого товара нет штрихкода GTIN',
  TRACEABLE_SKU_HAS_NO_MEASUREMENT_UNIT_QUANTITY: 'у товара не указано количество в единицах измерения',
  SKU_HAS_INVALID_HS_CODE: 'у товара некорректный HS-код',
  SKU_HAS_STORAGE_COUNTRY_RESTRICTIONS: 'у товара ограничения по стране хранения',
  UNDEFINED: 'неизвестная причина'
};

/** Незнакомый код показываем как есть: молчать о нём хуже, чем показать латиницу. */
const translate = (dict: Record<string, string>, code: string): string => {
  const key = upper(code);
  if (!key) return '';
  return dict[key] || key;
};

/** Разбор errors[] из ответа Ozon. Пустые элементы пропускаются. */
export function readDraftErrors(rawErrors: any): DraftFailure[] {
  const list = Array.isArray(rawErrors) ? rawErrors : [];
  const out: DraftFailure[] = [];
  for (const err of list) {
    if (!err) continue;

    const code = upper(err.error_message);
    const reasons: string[] = [];
    const rawReasons = Array.isArray(err.error_reasons) ? err.error_reasons : [];
    for (const r of rawReasons) {
      const text = translate(DRAFT_REASON_RU, r);
      if (text && reasons.indexOf(text) < 0) reasons.push(text);
    }

    const clusterIds: string[] = [];
    const rawClusters = Array.isArray(err.macrolocal_cluster_ids) ? err.macrolocal_cluster_ids : [];
    for (const c of rawClusters) {
      const id = str(c);
      if (id && clusterIds.indexOf(id) < 0) clusterIds.push(id);
    }

    const items: { clusterId: string; sku: string; reasons: string[] }[] = [];
    const validations = Array.isArray(err.items_validation) ? err.items_validation : [];
    for (const v of validations) {
      if (!v) continue;
      const clusterId = str(v.macrolocal_cluster_id);
      // Кластер из items_validation тоже виноват, даже если Ozon не назвал его отдельно.
      if (clusterId && clusterIds.indexOf(clusterId) < 0) clusterIds.push(clusterId);
      const rejected = Array.isArray(v.rejected_items) ? v.rejected_items : [];
      for (const it of rejected) {
        if (!it) continue;
        const itemReasons: string[] = [];
        const rawItemReasons = Array.isArray(it.reasons) ? it.reasons : [];
        for (const r of rawItemReasons) {
          const text = translate(DRAFT_ITEM_REASON_RU, r);
          if (text && itemReasons.indexOf(text) < 0) itemReasons.push(text);
        }
        items.push({ clusterId, sku: str(it.sku), reasons: itemReasons });
      }
    }

    out.push({
      code,
      text: code ? translate(DRAFT_ERROR_RU, code) : '',
      reasons,
      clusterIds,
      items,
      message: str(err.message)
    });
  }
  return out;
}

/** Все кластеры, которых Ozon коснулся в ошибках, без повторов. */
export function blamedClusterIds(failures: DraftFailure[]): string[] {
  const out: string[] = [];
  for (const f of failures || []) {
    for (const id of f.clusterIds || []) {
      if (id && out.indexOf(id) < 0) out.push(id);
    }
  }
  return out;
}

/** Одна строка для тоста и для журнала: что ответил Ozon. */
export function draftFailureTitle(status: string, failures: DraftFailure[]): string {
  const list = failures || [];
  if (list.length === 0) {
    return 'Ozon не рассчитал черновик: статус ' + (str(status) || 'нет ответа');
  }
  const first = list[0];
  const head = first.text || first.message || first.code || 'Ozon не рассчитал черновик';
  const tail = first.reasons.length > 0 ? ' (' + first.reasons.join('; ') + ')' : '';
  const more = list.length > 1 ? ' и ещё ' + (list.length - 1) : '';
  return head + tail + more;
}

/**
 * Что делать владельцу. Главный случай: заявка на несколько кластеров считается
 * целиком, поэтому один закрытый кластер валит весь расчёт — лечится удалением
 * этого кластера, а не повтором той же заявки.
 */
export function draftFailureHint(failures: DraftFailure[], clusterCount: number): string {
  const blamed = blamedClusterIds(failures);
  if (blamed.length > 0 && clusterCount > blamed.length) {
    return 'Заявка на несколько кластеров считается целиком: одного закрытого кластера хватает, '
      + 'чтобы Ozon отказал по всей заявке. Уберите указанные кластеры и пересчитайте — остальные пройдут.';
  }
  if (clusterCount > 1) {
    return 'Заявка на несколько кластеров считается целиком: одного закрытого кластера хватает, '
      + 'чтобы Ozon отказал по всей заявке. Пересчитайте заявку по частям, чтобы найти проблемный кластер.';
  }
  return 'Уберите этот кластер из заявки или дождитесь, пока Ozon откроет приём.';
}

/** Компактная строка для логов Cloud Run — по ней отказ находится без повторения сценария. */
export function draftErrorLogLine(status: string, failures: DraftFailure[]): string {
  const list = failures || [];
  const parts = list.map((f) => {
    const bits = [f.code || 'NO_CODE'];
    if (f.reasons.length > 0) bits.push(f.reasons.join('/'));
    if (f.clusterIds.length > 0) bits.push('clusters=' + f.clusterIds.join(','));
    if (f.items.length > 0) bits.push('items=' + f.items.map((i) => i.sku + ':' + i.reasons.join('/')).join(','));
    if (f.message) bits.push('message=' + f.message);
    return bits.join(' ');
  });
  return 'OZON DRAFT ' + (str(status) || 'NO_STATUS') + (parts.length > 0 ? ' | ' + parts.join(' | ') : ' | без errors[]');
}
