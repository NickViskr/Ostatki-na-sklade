import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    // Метка версии сборки: дата и время в московском времени.
    // Считается без Intl, чтобы не зависеть от локалей в среде сборки.
    define: {
      __APP_BUILD__: JSON.stringify(
        new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' МСК'
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
