# Базовый образ — Node.js 22 (облегчённая версия Debian)
FROM node:22-slim

# Рабочая директория внутри контейнера
WORKDIR /app

# Сначала копируем только файлы с зависимостями.
# Это нужно для кэширования: пока package.json/package-lock.json не меняются,
# Docker переиспользует слой с уже установленными зависимостями и не переустанавливает их
# при каждой правке кода.
COPY package.json package-lock.json ./
RUN npm ci

# Теперь копируем весь остальной код проекта
COPY . .

# Собираем фронтенд (React/Vite) — результат кладётся в папку dist,
# её раздаёт сервер (server.ts)
RUN npm run build

# Переменные окружения по умолчанию.
# PORT=8080 — стандартный порт, который ожидает Google Cloud Run.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Запуск сервера. devDependencies (tsx, vite) намеренно не вырезаны —
# сервер запускается через tsx и без них не стартует.
CMD ["npm", "start"]
