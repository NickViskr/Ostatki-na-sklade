export const STATUS_DICT: Record<string, { label: string; badgeClass: string }> = {
  COMPLETED: { label: 'Завершена', badgeClass: 'bg-emerald-100 text-emerald-700' },
  IN_TRANSIT: { label: 'В пути', badgeClass: 'bg-blue-100 text-blue-700' },
  ACCEPTED_AT_SUPPLY_WAREHOUSE: { label: 'Принята на точке отгрузки', badgeClass: 'bg-indigo-100 text-indigo-700' },
  ACCEPTANCE_AT_STORAGE_WAREHOUSE: { label: 'Приёмка на складе хранения', badgeClass: 'bg-amber-100 text-amber-700' },
  REPORTS_CONFIRMATION_AWAITING: { label: 'Согласование актов', badgeClass: 'bg-amber-100 text-amber-700' },
  REPORT_REJECTED: { label: 'Спор (акт отклонён)', badgeClass: 'bg-red-100 text-red-700' },
  REJECTED_AT_SUPPLY_WAREHOUSE: { label: 'Отказано в приёмке', badgeClass: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Отменена', badgeClass: 'bg-slate-100 text-slate-600' },
  OVERDUE: { label: 'Просрочена', badgeClass: 'bg-red-100 text-red-700' },
  DATA_FILLING: { label: 'Заполнение данных', badgeClass: 'bg-slate-100 text-slate-600' },
  READY_TO_SUPPLY: { label: 'Готова к отгрузке', badgeClass: 'bg-indigo-100 text-indigo-700' },
};

export const getStatusDetails = (status?: string) => {
  if (!status) return { label: 'Без статуса', badgeClass: 'bg-slate-100 text-slate-600' };
  const upperStatus = status.toUpperCase();
  if (STATUS_DICT[upperStatus]) {
    return STATUS_DICT[upperStatus];
  }
  return { label: status, badgeClass: 'bg-slate-100 text-slate-600' };
};

export const getStatusLabel = (status?: string) => {
  return getStatusDetails(status).label;
};

export const STATUS_FUNNEL_ORDER = [
  'DATA_FILLING',
  'READY_TO_SUPPLY',
  'ACCEPTED_AT_SUPPLY_WAREHOUSE',
  'IN_TRANSIT',
  'ACCEPTANCE_AT_STORAGE_WAREHOUSE',
  'REPORTS_CONFIRMATION_AWAITING',
  'REPORT_REJECTED',
  'REJECTED_AT_SUPPLY_WAREHOUSE',
  'OVERDUE',
  'COMPLETED',
  'CANCELLED'
];

export const STOCK_DEPARTED_STATUSES = [
  'ACCEPTED_AT_SUPPLY_WAREHOUSE',
  'IN_TRANSIT',
  'ACCEPTANCE_AT_STORAGE_WAREHOUSE',
  'REPORTS_CONFIRMATION_AWAITING',
  'REPORT_REJECTED',
  'COMPLETED'
];

export const isStockDeparted = (ozonStatus?: string): boolean =>
  !!ozonStatus && STOCK_DEPARTED_STATUSES.includes(String(ozonStatus).toUpperCase().trim());
