import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  gasUrl: string;
  gasToken: string;
  geminiModel: string;
  geminiKey: string;
  notificationEmail: string;
  destinations: string[];
  customPrompt: string;
  setGasUrl: (url: string) => void;
  setGasToken: (token: string) => void;
  setGeminiModel: (model: string) => void;
  setGeminiKey: (key: string) => void;
  setNotificationEmail: (email: string) => void;
  addDestination: (dest: string) => void;
  setCustomPrompt: (prompt: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasUrl: '',
      gasToken: '',
      geminiModel: 'gemini-3-flash-preview',
      geminiKey: '',
      notificationEmail: '',
      destinations: ['Ozon', 'Wildberries'],
      customPrompt: `Извлеки номенклатуру из текста накладной. 
ГЛАВНОЕ: Сопоставь извлеченные товары с эталонным списком артикулов: {{REFERENCE_ARTICLES}}.
Если в тексте указан артикул напрямую, используй его.
Если артикула нет, но название похоже на товар из списка, выбери наиболее подходящий артикул. 
Если совпадений нет совсем, укажи "UNKNOWN".

Для каждого товара извлеки:
1. Артикул (из списка или UNKNOWN)
2. Количество (число, если не указано, используй 1)
3. Цена (число, если указана, иначе 0)

Верни строгий JSON массив объектов.`,
      setGasUrl: (gasUrl) => set({ gasUrl }),
      setGasToken: (gasToken) => set({ gasToken }),
      setGeminiModel: (geminiModel) => set({ geminiModel }),
      setGeminiKey: (geminiKey) => set({ geminiKey }),
      setNotificationEmail: (notificationEmail) => set({ notificationEmail }),
      addDestination: (dest) => set((state) => {
        if (state.destinations.includes(dest)) return state;
        return { destinations: [...state.destinations, dest] };
      }),
      setCustomPrompt: (customPrompt) => set({ customPrompt }),
    }),
    {
      name: 'warehouse-settings',
    }
  )
);
