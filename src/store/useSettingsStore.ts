import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  gasUrl: string;
  geminiModel: string;
  geminiKey: string;
  notificationEmail: string;
  destinations: string[];
  customPrompt: string;
  serviceOrderIds: string[];
  storageRatePerLiterDay: number;
  ozonClientId: string;
  ozonApiKey: string;
  setGasUrl: (url: string) => void;
  setGeminiModel: (model: string) => void;
  setGeminiKey: (key: string) => void;
  setNotificationEmail: (email: string) => void;
  addDestination: (dest: string) => void;
  setCustomPrompt: (prompt: string) => void;
  setServiceOrderIds: (ids: string[]) => void;
  setStorageRatePerLiterDay: (rate: number) => void;
  setOzonClientId: (id: string) => void;
  setOzonApiKey: (key: string) => void;
}

const DEFAULT_PROMPT = `Ты — система распознавания накладных для складского учёта.
Твоя единственная задача: извлечь товары из текста и вернуть строгий JSON.

════════════════════════════════════════
СПРАВОЧНЫЕ ДАННЫЕ
════════════════════════════════════════

{{MAPPING_DICTIONARIES}}

ПОЛНЫЙ СПИСОК АРТИКУЛОВ:
{{REFERENCE_ARTICLES}}

════════════════════════════════════════
ПРАВИЛО 1 — ОПРЕДЕЛЕНИЕ АРТИКУЛА
════════════════════════════════════════

Для каждого товара в тексте определи артикул строго по следующему
приоритету (переходи к следующему шагу только если предыдущий не дал результата):

ШАГ 1. Прямое совпадение.
  Если в строке товара есть значение, которое точно совпадает
  с одним из артикулов в ПОЛНОМ СПИСКЕ → используй этот артикул.

ШАГ 2. Поиск по словарям баркодов.
  Найди в строке товара любое числовое значение (последовательность
  от 8 до 20 цифр, без учёта пробелов и дефисов).
  - Проверь это значение в СЛОВАРЕ БАРКОДОВ OZON.
  - Проверь это значение в СЛОВАРЕ БАРКОДОВ WILDBERRIES.
  - Если найдено совпадение → используй соответствующий артикул.
  ВАЖНО: Не ищи баркоды в значениях: количество (обычно 1–9999),
  цена (обычно содержит точку/запятую или меньше 7 цифр),
  номер строки/порядковый номер (обычно 1–3 цифры).

ШАГ 3. Сопоставление по названию.
  Если название товара в тексте однозначно соответствует
  одному из артикулов в ПОЛНОМ СПИСКЕ → используй этот артикул.
  "Однозначно" означает: совпадение без сомнений, не угадывание.

ШАГ 4. Ничего не подошло.
  Верни артикул "UNKNOWN".

В итоговом ответе ВСЕГДА указывай только артикул из ПОЛНОГО СПИСКА
или "UNKNOWN". Никогда не возвращай баркод, ШК или название товара
в поле article.

════════════════════════════════════════
ПРАВИЛО 2 — ОПРЕДЕЛЕНИЕ МАРКЕТПЛЕЙСА
════════════════════════════════════════

Определи маркетплейс строго по приоритету:

ПРИОРИТЕТ 1. Заголовки колонок (самый надёжный признак).
  - В тексте есть колонка "ШК товара" или "ШК" → "Ozon"
  - В тексте есть колонка "Баркод товара" или "Баркод" → "Wildberries"

ПРИОРИТЕТ 2. Совпадения баркодов в словарях (если заголовков нет).
  - Нашёл числовой код из текста в СЛОВАРЕ БАРКОДОВ OZON → "Ozon"
  - Нашёл числовой код из текста в СЛОВАРЕ БАРКОДОВ WILDBERRIES → "Wildberries"
  При конфликте (нашёл в обоих словарях) → вернуть "unknown".

ПРИОРИТЕТ 3. Явные текстовые маркеры.
  - В тексте есть слова "Ozon", "OZON", "Озон" → "Ozon"
  - В тексте есть слова "Wildberries", "WB", "ВБ", "Вайлдберриз" → "Wildberries"

Если ни один из трёх приоритетов не дал однозначного ответа → "unknown".

════════════════════════════════════════
ПРАВИЛО 3 — СУММИРОВАНИЕ
════════════════════════════════════════

Если один и тот же артикул встречается в тексте несколько раз —
сложи все количества в одну строку.
Пример: АРТ-001 × 5 и АРТ-001 × 3 → одна запись АРТ-001, quantity: 8.

════════════════════════════════════════
ПРАВИЛО 4 — КОЛИЧЕСТВО И ЦЕНА
════════════════════════════════════════

Количество (quantity):
  - Извлеки числовое значение количества товара.
  - Если количество не указано → используй 1.
  - Количество всегда целое положительное число.

Цена (price):
  - Извлеки цену за единицу товара если она указана.
  - Если цена не указана → используй 0.
  - Цена — число, может быть дробным (например: 199.90).

════════════════════════════════════════
ТЕКСТ НАКЛАДНОЙ ДЛЯ АНАЛИЗА:
════════════════════════════════════════

{{TEXT}}

════════════════════════════════════════
{{FEEDBACK}}

Верни ТОЛЬКО валидный JSON объект без пояснений и markdown-блоков.
Структура ответа:
{
  "items": [
    { "article": "АРТ-001", "quantity": 10, "price": 199.90 },
    { "article": "UNKNOWN", "quantity": 2,  "price": 0 }
  ],
  "detectedMarketplace": "Ozon"
}`;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasUrl: '',
      geminiModel: 'gemini-2.5-flash',
      geminiKey: '',
      notificationEmail: '',
      destinations: ['Ozon', 'Wildberries'],
      customPrompt: DEFAULT_PROMPT,
      serviceOrderIds: [],
      storageRatePerLiterDay: 0,
      ozonClientId: '',
      ozonApiKey: '',
      setGasUrl: (gasUrl) => set({ gasUrl }),
      setGeminiModel: (geminiModel) => set({ geminiModel }),
      setGeminiKey: (geminiKey) => set({ geminiKey }),
      setNotificationEmail: (notificationEmail) => set({ notificationEmail }),
      addDestination: (dest) => set((state) => {
        if (state.destinations.includes(dest)) return state;
        return { destinations: [...state.destinations, dest] };
      }),
      setCustomPrompt: (customPrompt) => set({ customPrompt }),
      setServiceOrderIds: (serviceOrderIds) => set({ serviceOrderIds }),
      setStorageRatePerLiterDay: (storageRatePerLiterDay) => set({ storageRatePerLiterDay }),
      setOzonClientId: (ozonClientId) => set({ ozonClientId }),
      setOzonApiKey: (ozonApiKey) => set({ ozonApiKey }),
    }),
    {
      name: 'warehouse-settings',
      version: 5,
      migrate: (persistedState: any, version: number) => {
        if ([0, 1, 2, 3].includes(version) || !version) {
          // If migrating from an older version, update the customPrompt to our new DEFAULT_PROMPT
          // We assume they didn't really write a custom one if it starts with the old string, 
          // or we just force it to fix the current issue
          persistedState.customPrompt = DEFAULT_PROMPT;
        }
        return persistedState as SettingsState;
      },
      partialize: (state) => ({ ...state }),
    }
  )
);
