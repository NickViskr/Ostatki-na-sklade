// ===== Пункт 58. Прямая поставка: свой склад и запрет на смешивание кластеров =====
// Ozon знает два способа сдать поставку:
//   кросс-докинг — коробки везутся в одну точку отгрузки, Ozon сам развозит по кластерам;
//   прямая       — продавец везёт груз сам на склад размещения нужного кластера.
// Заявка целиком принадлежит одному способу: /v1/draft/direct/create принимает РОВНО ОДИН
// кластер (cluster_info — объект, а не массив), а /v1/draft/multi-cluster/create обязательно
// требует точку отгрузки. Поэтому «прямой» кластер может ехать только один и только сам по себе.
//
// Какие кластеры прямые — решает владелец в «Настройках Ozon» (решение 26.08.2026):
// список, а не один зашитый Екатеринбург, чтобы второй такой кластер не требовал правки кода.
// Все функции чистые: без обращения к стору и без побочных эффектов.

/** Один прямой кластер и склад, на который продавец везёт груз сам. */
export interface DirectClusterRule {
  clusterId: string;
  clusterName: string;
  /** Склад размещения Ozon (storage_warehouse_id). Пустой — правило заведено не до конца. */
  warehouseId: string;
  warehouseName: string;
}

/** Способ сдачи заявки. */
export type SupplyMode = 'direct' | 'crossdock';

/** Разбор настройки. Настройки хранятся строками, поэтому вход — строка или готовый массив. */
export function parseDirectClusters(raw: unknown): DirectClusterRule[] {
  let parsed: any = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const out: DirectClusterRule[] = [];
  const seen: Record<string, true> = {};
  for (const item of parsed) {
    if (!item) continue;
    const clusterId = String(item.clusterId ?? '').trim();
    if (!clusterId || seen[clusterId]) continue;
    seen[clusterId] = true;
    out.push({
      clusterId,
      clusterName: String(item.clusterName ?? '').trim(),
      warehouseId: String(item.warehouseId ?? '').trim(),
      warehouseName: String(item.warehouseName ?? '').trim()
    });
  }
  return out;
}

/** Правило по кластеру или null. */
export function findDirectRule(rules: DirectClusterRule[], clusterId: string): DirectClusterRule | null {
  const id = String(clusterId ?? '').trim();
  if (!id) return null;
  const found = (rules || []).find(r => r.clusterId === id);
  return found || null;
}

/** Кластер сдаётся прямой поставкой. */
export function isDirectCluster(rules: DirectClusterRule[], clusterId: string): boolean {
  return findDirectRule(rules, clusterId) !== null;
}

/**
 * Способ сдачи для текущего выбора. Пустой выбор — кросс-докинг: это способ по умолчанию,
 * и до первой галочки ни один кластер блокировать нельзя.
 */
export function supplyModeFor(rules: DirectClusterRule[], selectedClusterIds: string[]): SupplyMode {
  const ids = normalizeIds(selectedClusterIds);
  return ids.some(id => isDirectCluster(rules, id)) ? 'direct' : 'crossdock';
}

/**
 * Можно ли отметить этот кластер при уже сделанном выборе.
 * Уже отмеченный кластер остаётся доступным всегда — иначе снять свою же галочку было бы нечем.
 */
export function isClusterSelectable(
  rules: DirectClusterRule[],
  selectedClusterIds: string[],
  clusterId: string
): boolean {
  const id = String(clusterId ?? '').trim();
  if (!id) return false;
  const ids = normalizeIds(selectedClusterIds);
  if (ids.indexOf(id) >= 0) return true;
  if (ids.length === 0) return true;

  const selectionIsDirect = ids.some(x => isDirectCluster(rules, x));
  // В прямой заявке кластер только один: любой добавочный запрещён, включая другой прямой.
  if (selectionIsDirect) return false;
  // Выбран кросс-докинг: прямой кластер к нему не присоединить.
  return !isDirectCluster(rules, id);
}

/** Почему галочка недоступна. Пустая строка — доступна. Текст видит пользователь. */
export function disabledReason(
  rules: DirectClusterRule[],
  selectedClusterIds: string[],
  clusterId: string
): string {
  if (isClusterSelectable(rules, selectedClusterIds, clusterId)) return '';
  const ids = normalizeIds(selectedClusterIds);
  const directSelected = ids.map(id => findDirectRule(rules, id)).find(r => r !== null) || null;
  if (directSelected) {
    const name = directSelected.clusterName || directSelected.clusterId;
    return name + ' отгружается прямой поставкой и едет отдельной заявкой — другие кластеры к ней не добавляются';
  }
  const rule = findDirectRule(rules, clusterId);
  const name = (rule && rule.clusterName) || clusterId;
  return name + ' отгружается прямой поставкой: снимите остальные кластеры, чтобы отправить его отдельной заявкой';
}

/** Что не так с выбором. Пустая строка — всё в порядке. Текст видит пользователь. */
export function validateSelection(rules: DirectClusterRule[], selectedClusterIds: string[]): string {
  const ids = normalizeIds(selectedClusterIds);
  if (ids.length === 0) return '';

  const directIds = ids.filter(id => isDirectCluster(rules, id));
  if (directIds.length === 0) return '';

  if (directIds.length > 1) {
    const names = directIds.map(id => {
      const r = findDirectRule(rules, id);
      return (r && r.clusterName) || id;
    });
    return 'Прямой поставкой едет один кластер за заявку, а выбрано несколько: ' + names.join(', ');
  }
  if (ids.length > 1) {
    const rule = findDirectRule(rules, directIds[0]);
    const name = (rule && rule.clusterName) || directIds[0];
    return name + ' отгружается прямой поставкой и не совмещается с другими кластерами в одной заявке';
  }

  const rule = findDirectRule(rules, directIds[0]);
  if (rule && !rule.warehouseId) {
    const name = rule.clusterName || rule.clusterId;
    return 'Для кластера ' + name + ' не выбран склад прямой поставки — укажите его в настройках Ozon';
  }
  return '';
}

/**
 * Склад прямой поставки для выбора. null — заявка кросс-докинговая и склад ей не нужен.
 * Вызывать только после validateSelection: на негодном выборе результат смысла не имеет.
 */
export function directWarehouseFor(
  rules: DirectClusterRule[],
  selectedClusterIds: string[]
): DirectClusterRule | null {
  const ids = normalizeIds(selectedClusterIds);
  for (const id of ids) {
    const rule = findDirectRule(rules, id);
    if (rule) return rule;
  }
  return null;
}

/** Непустые уникальные идентификаторы в порядке первого появления. */
function normalizeIds(selectedClusterIds: string[]): string[] {
  const out: string[] = [];
  for (const raw of selectedClusterIds || []) {
    const id = String(raw ?? '').trim();
    if (id && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}
