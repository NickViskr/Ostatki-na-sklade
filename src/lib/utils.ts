export const formatCurrency = (value: number | undefined): string => {
  if (value === undefined || isNaN(value)) return '0,00';
  // Округляем до двух знаков и используем локаль RU
  return value.toLocaleString('ru-RU', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

export const roundToTwo = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;
