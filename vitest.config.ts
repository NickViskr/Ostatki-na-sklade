import { defineConfig } from 'vitest/config';

// Отдельный конфиг для тестов: НЕ трогает vite.config.ts (боевая сборка).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
