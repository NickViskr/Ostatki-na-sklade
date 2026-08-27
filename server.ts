import express from "express";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import * as XLSX from "xlsx";
import { chooseDirectWarehouse, directWarehouseMessage, readDraftWarehouses } from "./src/lib/ozonDirectDraft";
import { draftErrorLogLine, draftFailureHint, draftFailureTitle, readDraftErrors } from "./src/lib/ozonDraftErrors";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "1mb" }));

  // ── CORS ──────────────────────────────────────────────────────────────────────
  const ALLOWED_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";

  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === ALLOWED_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // ── Rate Limiting (без внешних пакетов) ───────────────────────────────────────
  const requestCounts = new Map<string, { count: number; resetAt: number }>();
  const RATE_WINDOW_MS = 60 * 1000; // 1 минута
  // Пункт 29: порог поднят с 60 до 300. Перед Node.js стоит nginx,
  // доверие прокси не настроено, поэтому req.ip у всех запросов один
  // и тот же внутренний адрес — ограничитель работает на всё приложение
  // целиком, а не на пользователя. Одна загрузка делает около 17 запросов.
  const RATE_LIMIT     = 300;       // 300 запросов в минуту суммарно

  function rateLimitMiddleware(req: any, res: any, next: any) {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = requestCounts.get(ip);

    if (!entry || now > entry.resetAt) {
      requestCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return next();
    }

    entry.count++;
    if (entry.count > RATE_LIMIT) {
      return res.status(429).json({
        status: "error",
        message: "Слишком много запросов. Попробуйте через минуту."
      });
    }
    next();
  }

  app.use("/api/gas", rateLimitMiddleware);
  app.use("/api/parse-invoice", rateLimitMiddleware);
  app.use("/api/models", rateLimitMiddleware);
  app.use("/api/ozon/check", rateLimitMiddleware);

  // ── In-memory кеш валидных токенов ────────────────────────────────────────────
  const sessionCache = new Map<string, { expiresAt: number }>();
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

  function isTokenCached(token: string): boolean {
    const entry = sessionCache.get(token);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      sessionCache.delete(token);
      return false;
    }
    return true;
  }

  function cacheToken(token: string) {
    sessionCache.set(token, { expiresAt: Date.now() + CACHE_TTL_MS });
    if (sessionCache.size > 1000) {
      const oldest = [...sessionCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) sessionCache.delete(oldest[0]);
    }
  }

  // ── Кэш Gemini API ключа ──────────────────────────────────────────────────────
  let cachedApiKey: { value: string; expiresAt: number } | null = null;
  const API_KEY_TTL_MS = 60 * 60 * 1000; // 1 час

  async function getApiKey(): Promise<string | null> {
    if (cachedApiKey && Date.now() < cachedApiKey.expiresAt) {
      return cachedApiKey.value;
    }

    // Приоритет 1: Ключ из GAS (настройки из UI)
    const orgKey = await fetchOrgApiKey();
    if (orgKey) {
      cachedApiKey = { value: orgKey, expiresAt: Date.now() + API_KEY_TTL_MS };
      return orgKey;
    }

    // Приоритет 2: Переменные окружения (.env.local)
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (envKey) {
      cachedApiKey = { value: envKey, expiresAt: Date.now() + API_KEY_TTL_MS };
      return envKey;
    }

    return null;
  }

  // Эндпоинт для принудительного сброса кэша извне (опционально)
  app.post("/api/invalidate-key-cache", (req, res) => {
    const secret = req.headers["x-invalidate-secret"];
    if (secret !== process.env.SERVER_SECRET) {
      return res.status(403).json({ status: "error", message: "Forbidden" });
    }
    cachedApiKey = null;
    return res.json({ status: "success", message: "Key cache cleared" });
  });

  // ── Кэш Ozon API ключей ────────────────────────────────────────────────────────
  type OzonCabinetKeys = { name: string; clientId: string; apiKey: string };
  type OzonKeysBundle = { ozonClientId: string; ozonApiKey: string; cabinets: OzonCabinetKeys[] };
  let cachedOzonKeys: { value: OzonKeysBundle; expiresAt: number } | null = null;
  const OZON_KEY_TTL_MS = 60 * 60 * 1000; // 1 час

  async function fetchOzonKeys(): Promise<OzonKeysBundle | null> {
    if (cachedOzonKeys && Date.now() < cachedOzonKeys.expiresAt) {
      return cachedOzonKeys.value;
    }

    const gasUrl = process.env.GAS_URL;
    const secret = process.env.SERVER_SECRET;
    if (!gasUrl || !secret) return null;

    const payloadObject = {
      action: "getOzonKeys",
      timestamp: Date.now().toString()
    };
    
    const signature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payloadObject))
      .digest("hex");

    try {
       const gasResponse = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payloadObject, signature })
       });
       const rawText = await gasResponse.text();
       let gasData: any;
       try {
         gasData = JSON.parse(rawText);
       } catch {
         console.warn("GAS returned non-JSON response in fetchOzonKeys:", rawText.substring(0, 200));
         return null;
       }
       if (gasData && gasData.status === "success" && gasData.data?.ozonClientId && gasData.data?.ozonApiKey) {
         const rawCabinets = Array.isArray(gasData.data.cabinets) ? gasData.data.cabinets : [];
         const cabinets: OzonCabinetKeys[] = rawCabinets
           .filter((c: any) => c && String(c.clientId || '').trim() && String(c.apiKey || '').trim())
           .map((c: any, i: number) => ({
             name: String(c.name || '').trim() || `Кабинет ${i + 1}`,
             clientId: String(c.clientId).trim(),
             apiKey: String(c.apiKey).trim()
           }));
         const keys: OzonKeysBundle = {
           ozonClientId: gasData.data.ozonClientId,
           ozonApiKey: gasData.data.ozonApiKey,
           // Старый GAS без поля cabinets: работаем с одним кабинетом
           cabinets: cabinets.length > 0
             ? cabinets
             : [{ name: 'Кабинет 1', clientId: gasData.data.ozonClientId, apiKey: gasData.data.ozonApiKey }]
         };
         cachedOzonKeys = { value: keys, expiresAt: Date.now() + OZON_KEY_TTL_MS };
         return keys;
       }
    } catch (e) {
       console.error("Failed to fetch Ozon keys Server-to-Server", e);
    }
    return null;
  }

  // Helper to fetch custom org API key from GAS (Server-to-Server)
  async function fetchOrgApiKey(): Promise<string | null> {
    const gasUrl = process.env.GAS_URL;
    const secret = process.env.SERVER_SECRET;
    if (!gasUrl || !secret) return null;

    const payloadObject = {
      action: "getGeminiKey",
      timestamp: Date.now().toString()
    };
    
    // Create HMAC signature
    const signature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payloadObject))
      .digest("hex");

    try {
       const gasResponse = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payloadObject, signature })
       });
       const rawText = await gasResponse.text();
       let gasData: any;
       try {
         gasData = JSON.parse(rawText);
       } catch {
         console.warn("GAS returned non-JSON response in fetchOrgApiKey:", rawText.substring(0, 200));
         return null;
       }
       if (gasData && gasData.status === "success" && gasData.data?.geminiKey) {
         return gasData.data.geminiKey;
       }
    } catch (e) {
       console.error("Failed to fetch org key Server-to-Server", e);
    }
    return null;
  }

  
  // ── Server-side GAS Response Cache ─────────────────────────────────────
  const gasCache = new Map<string, { data: any; cachedAt: number; action: string }>();

  // Пункт 29, этап C: точечная очистка кэша.
  // Ключ — пишущее действие, значение — список читающих действий,
  // чьи записи оно делает устаревшими. Действие, которого нет в этой
  // карте, по-прежнему очищает весь кэш целиком. Список намеренно узкий:
  // сюда попали только действия, про которые точно известно, что склад,
  // историю, SKU и комплекты они не затрагивают.
  const CACHE_INVALIDATION: Record<string, string[]> = {
    logout: [],
    saveOzonSettings: ['getOzonSettings', 'getOzonInitialData'],
    saveOzonClusters: ['getOzonClusters', 'getOzonInitialData'],
    markOzonClustersNotified: ['getOzonClusters', 'getOzonInitialData'],
    saveOzonSales: ['getOzonSales', 'getOzonInitialData'],
    saveOzonStocks: ['getOzonStocks', 'getOzonInitialData'],
    saveExternalShipments: ['getExternalShipments'],
    updateExternalShipmentStatus: ['getExternalShipments'],
    saveOzonSupplyRequest: ['getOzonSupplyRequests', 'getExternalShipments'],
    addUser: ['getUsers'],
    deleteUser: ['getUsers'],
    saveGlobalSettings: ['getGlobalSettings'],
    addService: ['getServices'],
    updateService: ['getServices'],
    deleteService: ['getServices'],
    addServiceRate: ['getServiceRates'],
    saveFactoryOrder: ['getFactoryOrders', 'getOzonInitialData'],
    // Item 47, stage 3: stamping the exported rows touches nothing any other read returns,
    // so the list is deliberately empty. It must still be present here: an action missing
    // from this map wipes the whole cache.
    markOzonCostExported: []
  };

  function invalidateCacheFor(writeAction: string): void {
    const affected = CACHE_INVALIDATION[writeAction];
    if (!affected) {
      gasCache.clear();
      return;
    }
    for (const [key, entry] of Array.from(gasCache.entries())) {
      if (affected.includes(entry.action)) {
        gasCache.delete(key);
      }
    }
  }
  // Пункт 29, этап B: раздельные сроки жизни кэша вместо общих 30 секунд.
  // Справочники почти не меняются, данные Ozon обновляются триггерами
  // дважды в сутки, а оперативные остатки должны быть свежими.
  // Любое пишущее действие по-прежнему сбрасывает весь кэш целиком,
  // поэтому длинные сроки не могут показать устаревшие данные.
  const CACHE_TTL_REFERENCE_MS = 10 * 60 * 1000; // справочники, 10 минут
  // Item 26 (2026-08-20): raised from 5 to 60 minutes. Measurement showed the whole start-up
  // is one request — getOzonSales takes 9-13 s because it reads the entire «Продажи Ozon»
  // sheet, of which 57% are archive rows the date window always discards. Served from cache
  // the same call takes 250 ms, so keeping the cache alive is worth far more than bundling
  // calls together. STALENESS TRADE-OFF, stated plainly: the twice-daily sync trigger runs
  // INSIDE Apps Script and never passes through this proxy, so it cannot invalidate this
  // cache — after a sync the app may show data up to one hour old. Three things keep that
  // acceptable: the screen always shows the data's own «Обновлено» timestamp, any write
  // action through the proxy clears the cache, and with max-instances=1 an idle night scales
  // the container to zero, so the first visit of the day starts from an empty cache anyway.
  const CACHE_TTL_OZON_MS = 60 * 60 * 1000;     // данные Ozon, 60 минут
  const CACHE_TTL_OPERATIONAL_MS = 30_000;       // оперативные данные, 30 секунд

  function getCacheTtlMs(action: string): number {
    if (['getServices', 'getServiceRates', 'getUsers', 'getOzonSettings', 'getOzonClusters'].includes(action)) {
      return CACHE_TTL_REFERENCE_MS;
    }
    // Item 26 stage A1: the composite read is cached like the Ozon data it carries.
    // It also carries settings and clusters, which on their own live 10 minutes — the
    // shorter of the two lifetimes is used deliberately, so nothing is served staler
    // than it would have been when fetched separately. LEFT OUT OF THIS LIST BY MISTAKE
    // when the action was introduced: getCacheTtlMs returns 0 for anything unknown, so the
    // composite was not cached at all and start-up got SLOWER, not faster — five cached
    // reads had been replaced by one uncached one.
    if (['getOzonStocks', 'getOzonSales', 'getFactoryOrders', 'getOzonInitialData'].includes(action)) {
      return CACHE_TTL_OZON_MS;
    }
    if (['getInitialData', 'getTransactions', 'getSkus', 'getArchivedItems', 'getStock', 'getExternalShipments', 'getOzonSupplyRequests', 'getLastPurchasePrices'].includes(action)) {
      return CACHE_TTL_OPERATIONAL_MS;
    }
    return 0;
  }

  // Пункт 29: диагностика. Счётчик запросов к Apps Script, выполняющихся
  // прямо сейчас. Нужен, чтобы проверить, связаны ли сбои с параллельностью.
  let gasInFlight = 0;

  // Пункт 29: очередь к Apps Script. Замеры показали до 12 одновременных
  // запросов, при которых скрипт деградирует и отвечает заглушкой doGet.
  // Пропускаем не более трёх одновременно, остальные ждут своей очереди.
  const GAS_MAX_PARALLEL = 8;
  let gasSlotsUsed = 0;
  const gasWaitQueue: Array<() => void> = [];

  async function acquireGasSlot(): Promise<void> {
    if (gasSlotsUsed < GAS_MAX_PARALLEL) {
      gasSlotsUsed++;
      return;
    }
    await new Promise<void>((resolve) => gasWaitQueue.push(resolve));
  }

  function releaseGasSlot(): void {
    const next = gasWaitQueue.shift();
    if (next) {
      next();
    } else {
      gasSlotsUsed--;
    }
  }

  // This list does three separate jobs, so a read missing from it misbehaves three ways:
  // an action not listed here is treated as a WRITE, which (1) invalidates the response cache —
  // and, when the action is absent from CACHE_INVALIDATION too, wipes the cache ENTIRELY,
  // (2) is never retried automatically after a transport failure, and (3) goes down the write path.
  // Item 26 stage A1: getOzonInitialData was missing here at first, so every cache miss on it
  // wiped the whole cache and made every other read on the same page load miss as well.
  const READ_ONLY_ACTIONS = [
    'getInitialData', 'getTransactions', 'getSkus', 'getServices', 'getUsers', 'getArchivedItems',
    'verifySession', 'login', 'getGlobalSettings', 'getExternalShipments', 'getOzonSupplyRequests',
    'getOzonSettings', 'getOzonClusters', 'getOzonSyncStatus', 'getFactoryOrders', 'getGeminiKey', 'getOzonKeys',
    'getStock', 'getServiceRates', 'getOzonStocks', 'getOzonSales', 'checkSupplyAvailability',
    'getOzonInitialData',
    // Item 26 (2026-08-20): getLastPurchasePrices was missing here from the day it was added.
    // It is a pure read — it only calls getValues on the history sheet — but the dashboard fires
    // it on EVERY load, so on every load the proxy treated it as a write and, finding no entry in
    // CACHE_INVALIDATION, wiped the entire response cache. That is why the cache never helped at
    // start-up, before or after the composite read was introduced.
    'getLastPurchasePrices',
    // Item 47, stage 3: a pure read of the cost journal. Deliberately NOT given a cache
    // lifetime below — the button stamps the rows it exported, so a cached answer would
    // offer the same rows twice.
    'getOzonCostExport'
  ];

  // API Endpoint to proxy GAS requests
  app.post("/api/gas", async (req, res) => {
    try {
      const gasUrl = process.env.GAS_URL;
      if (!gasUrl) {
        return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
      }

      const action = req.body?.action;
      const token = req.body?.sessionToken;
      const { sessionToken, ...cacheableBody } = req.body;
      const cacheKey = JSON.stringify(cacheableBody);
      
      const cacheTtlMs = action ? getCacheTtlMs(action) : 0;
      if (cacheTtlMs > 0 && token && isTokenCached(token)) {
        const cached = gasCache.get(cacheKey);
        if (cached && Date.now() - cached.cachedAt < cacheTtlMs) {
          return res.json(cached.data);
        }
      }

      if (action && !READ_ONLY_ACTIONS.includes(action)) {
        invalidateCacheFor(action);
      }

      // Не пропускаем серверные action через клиентский прокси
      const forbiddenActions = ['getGeminiKey', 'getOzonKeys'];
      if (forbiddenActions.includes(action)) {
        return res.status(403).json({ status: "error", message: "Forbidden action" });
      }

      // Проверяем что sessionToken присутствует для защищённых actions
      const publicActions = ['login'];
      const isPublic = publicActions.includes(action);
      
      if (!isPublic) {
        if (!token) {
          return res.status(401).json({ status: "error", message: "Missing sessionToken" });
        }
      }

      // Пункт 28, этап D:
      // 1) Распознавание заглушки doGet
      // 2) Автоповтор до 3 попыток для read-only и commit (идемпотентен по opId)
      // 3) Порог обрыва 300 с для пишущих действий
      // Пункт 28, этап D. Повтор действия commit безопасен ТОЛЬКО при наличии ключа операции:
      // именно ключ не даёт серверу записать вторую копию. Без ключа повтор запрещён —
      // иначе возвращается авария 01.08.2026 с двойным списанием.
      const opIdRaw = req.body?.opId;
      const hasOpId = typeof opIdRaw === 'string' && opIdRaw.trim() !== '';
      const canRetry = !!action && (READ_ONLY_ACTIONS.includes(action) || (action === 'commit' && hasOpId));
      const maxTries = canRetry ? 2 : 1;
      // Пункт 29, шаг 1: пауза перед повтором увеличена с 1 с до 20 с.
      // Причина: при обрыве по таймауту выполнение Apps Script продолжается
      // и продолжает держать LockService. Повтор через секунду упирался
      // в этот же замок и падал с Lock timeout, добавляя нагрузку вместо помощи.
      //
      // 27.08.2026: cut back from 20 s to 5 s. The 20 s were the whole defence against the
      // lock, and they cost the owner 20 s of staring at an open window every time a write
      // ran long. The defence now sits where the lock actually is: doPost in Code.gs gives a
      // commit 30 s to get it instead of 10 s, so the repeat waits for the aborted execution
      // to finish rather than dying on it. Measured on 21.08.2026: 90 s of timeout + 20 s of
      // pause + 5,1 s of the repeat = the 115,1 s the owner spent in front of an open form.
      const retryDelayMs = 5_000;
      const isWriteAction = action === 'commit' || (action && !READ_ONLY_ACTIONS.includes(action));
      // Пункт 28, этап D. Замеры 01.08.2026: обычная запись укладывается в 8 с,
      // самая долгая наблюдавшаяся — около 30 с. Порог 90 с даёт трёхкратный запас
      // и при этом не заставляет пользователя ждать ошибку пять минут.
      const timeoutMs = isWriteAction ? 90_000 : 25_000;

      let lastError: any = null;
      let lastRawText = "";

      for (let attempt = 1; attempt <= maxTries; attempt++) {
        // Ждём свободный слот ДО запуска таймера, чтобы ожидание в очереди
        // не съедало время, отведённое на сам запрос.
        await acquireGasSlot();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        gasInFlight++;
        const gasStartedAt = Date.now();
        try {
          // Откат правки 04.08.2026: ручная обработка редиректа с повтором POST
          // ломала авторизацию. Apps Script отдаёт результат doPost по адресу
          // редиректа только методом GET, поэтому редирект должен обрабатываться
          // автоматически, как это делает fetch по умолчанию.
          const gasResponse = await fetch(gasUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          const rawText = await gasResponse.text();
          lastRawText = rawText;

          // Пункт 29: диагностическая запись по каждому ответу Apps Script.
          const isStub = rawText.includes("Web App is operational");
          console.log(`GASDIAG action=${action} attempt=${attempt}/${maxTries} http=${gasResponse.status} ms=${Date.now() - gasStartedAt} inflight=${gasInFlight} stub=${isStub} len=${rawText.length}`);

          // Пункт 29: если ответ пришёл с ошибочным кодом или подозрительно
          // короткий, показываем его начало — иначе причина остаётся неизвестной.
          if (gasResponse.status !== 200 || rawText.length < 300) {
            const preview = rawText.replace(/\s+/g, " ").slice(0, 300);
            console.log(`GASBODY action=${action} http=${gasResponse.status} len=${rawText.length} body=${preview}`);
          }

          // Пункт 29, этап A: заглушка doGet распознаётся ТОЛЬКО в коротком
          // ответе, а HTML — только если ответ с него НАЧИНАЕТСЯ.
          // Раньше условие срабатывало на любое вхождение фразы в любом месте
          // ответа. getOzonSyncStatus отдаёт журнал прошлых прогонов, куда эта
          // фраза попала как запись о старой ошибке, поэтому исправный ответ
          // на 4835 байт постоянно отбрасывался и виджет автоопроса вечно
          // показывал спиннер.
          const trimmedText = rawText.trimStart();
          const isDoGetStub =
            rawText.length < 300 &&
            (rawText.includes("Google Apps Script Web App is operational") ||
              rawText.includes("Use POST for API requests"));
          const isHtmlPage =
            trimmedText.startsWith("<!DOCTYPE") ||
            trimmedText.startsWith("<html") ||
            trimmedText.startsWith("<HTML");
          if (isDoGetStub || isHtmlPage) {
            console.warn(`Attempt ${attempt}/${maxTries}: GAS returned doGet stub/HTML response for action '${action}'`);
            if (attempt < maxTries) {
              await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
              continue;
            }
            return res.status(502).json({
              status: "error",
              message: `Google Apps Script returned doGet stub response. Request method may have been altered during redirect.`
            });
          }

          let data;
          try {
            data = JSON.parse(rawText);
          } catch (parseErr: any) {
            console.warn(`Attempt ${attempt}/${maxTries}: GAS returned non-JSON response for action '${action}':`, rawText.substring(0, 300));
            if (attempt < maxTries) {
              await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
              continue;
            }
            return res.status(502).json({
              status: "error",
              message: `Google Apps Script returned a non-JSON response. Raw response snippet: ${rawText.substring(0, 300)}`
            });
          }

          // 27.08.2026. A write repeated by THIS proxy after its own aborted attempt comes
          // back marked idempotentHit: the record is already in the sheet, put there by the
          // attempt whose connection we dropped. That is our repeat, not the user's — and
          // showing «эта операция уже была записана ранее» over a first-ever receipt made
          // the owner believe he had created a duplicate. The flag is cleared so the client
          // reports a plain successful write; the repeat itself stays in the log above.
          // A genuine hit — the user pressing twice, the client re-sending — arrives on
          // attempt 1 and keeps the flag.
          if (attempt > 1 && data?.data?.idempotentHit === true) {
            console.log(`GASRETRY action=${action} attempt=${attempt}/${maxTries} write confirmed by idempotency key, reported as a normal success`);
            delete data.data.idempotentHit;
          }

          // Если GAS ответил успехом для сессии, сохраняем токен в кэш
          if (data && data.status === "success") {
            if (cacheTtlMs > 0) {
              gasCache.set(cacheKey, { data, cachedAt: Date.now(), action });
            }

            if (token) cacheToken(token);
            if (isPublic && data.data?.sessionToken) cacheToken(data.data.sessionToken);

            // Инвалидируем кэш ключа, если настройки были сохранены
            if (action === "saveGlobalSettings") {
              cachedApiKey = null;
              cachedOzonKeys = null;
              console.log("Кэш API ключей сброшен после сохранения настроек");
            }
          }

          return res.json(data);
        } catch (err: any) {
          clearTimeout(timeoutId);
          lastError = err;
          console.log(`GASDIAG action=${action} attempt=${attempt}/${maxTries} FAILED ms=${Date.now() - gasStartedAt} inflight=${gasInFlight} err=${err.name}`);
          if (err.name === 'AbortError') {
            console.warn(`Attempt ${attempt}/${maxTries}: GAS request timeout (${timeoutMs / 1000}s) for action '${action}'`);
            if (attempt < maxTries) {
              await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
              continue;
            }
            return res.status(504).json({ status: "error", message: `GAS request timeout (${timeoutMs / 1000}s)` });
          }
          if (attempt < maxTries) {
            await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
            continue;
          }
          throw err;
        } finally {
          gasInFlight--;
          releaseGasSlot();
        }
      }
    } catch (err: any) {
      console.error("Error proxying to GAS:", err);
      return res.status(500).json({ status: "error", message: err.message });
    }
  });

  // API Endpoint to fetch available Gemini models (flash only)
  app.post("/api/models", async (req, res) => {
    try {
      const { apiKey: clientApiKey } = req.body;
      const apiKey = clientApiKey || await getApiKey();
      
      if (!apiKey) {
        return res.status(400).json({ status: "error", message: "API Key required on server" });
      }
      
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.list();
      
      const models = [];
      for await (const model of response) {
        if (model.name && model.name.includes("flash")) {
          // Normalize the model name to strip the 'models/' prefix if present
          models.push(model.name.replace(/^models\//, ''));
        }
      }
      return res.json({ status: "success", data: models });
    } catch (err: any) {
      console.error("Error fetching models:", err);
      return res.status(500).json({ status: "error", message: err.message });
    }
  });

  // ── Ozon Seller API Integration ──────────────────────────────────────────────
  async function callOzonApi(endpoint: string, keys: { ozonClientId: string; ozonApiKey: string }, body: any) {
    const url = `https://api-seller.ozon.ru${endpoint}`;
    return fetch(url, {
      method: "POST",
      headers: {
        "Client-Id": keys.ozonClientId,
        "Api-Key": keys.ozonApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let lastOzonCallAt = 0;

  async function fetchOzonApi(endpoint: string, keys: { ozonClientId: string; ozonApiKey: string }, body: any) {
    let res: any = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const elapsed = Date.now() - lastOzonCallAt;
      if (elapsed < 400) await sleep(400 - elapsed);
      lastOzonCallAt = Date.now();

      res = await callOzonApi(endpoint, keys, body);
      if (res.status === 429) {
        if (attempt < 5) {
          await sleep(1000 * attempt);
          continue;
        }
      }
      break;
    }

    if (!res) {
      throw new Error("No response from Ozon API");
    }

    if (!res.ok) {
      const status = res.status;
      if (status === 429) {
        const errorObj: any = new Error("Ozon API: превышен лимит запросов, повторите синхронизацию через минуту");
        errorObj.stage = "ozon_api";
        errorObj.httpStatus = 429;
        throw errorObj;
      }
      const errText = await res.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch (e) {}
      const errMsg = errJson?.message || errJson?.error?.message || errText || `HTTP ${status}`;
      const errorObj: any = new Error(errMsg);
      errorObj.stage = "ozon_api";
      errorObj.httpStatus = status;
      throw errorObj;
    }
    return res.json();
  }

  // ── Ozon Cluster Сache ────────────────────────────────────────────────────────
  let cachedClusterMap = new Map<string, string>();
  let cachedWarehouseClusterMap = new Map<string, string>();
  let clusterMapLastUpdatedAt = 0;
  const CLUSTER_MAP_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

  async function loadClusterMap(keys: { ozonClientId: string; ozonApiKey: string }): Promise<Map<string, string>> {
    const now = Date.now();
    if (clusterMapLastUpdatedAt > 0 && (now - clusterMapLastUpdatedAt < CLUSTER_MAP_TTL_MS)) {
      return cachedClusterMap;
    }

    try {
      const newMap = new Map<string, string>();
      const newWhMap = new Map<string, string>();

      const ozonResponse = await fetchOzonApi("/v1/cluster/list", keys, { cluster_type: "CLUSTER_TYPE_OZON" });
      const cisResponse = await fetchOzonApi("/v1/cluster/list", keys, { cluster_type: "CLUSTER_TYPE_CIS" });

      const processClusters = (data: any) => {
        if (data && Array.isArray(data.clusters)) {
          for (const cluster of data.clusters) {
            if (cluster && cluster.macrolocal_cluster_id !== undefined && cluster.macrolocal_cluster_id !== null && cluster.name) {
              newMap.set(String(cluster.macrolocal_cluster_id), String(cluster.name));
            }
            if (cluster && cluster.name && Array.isArray(cluster.logistic_clusters)) {
              for (const logCluster of cluster.logistic_clusters) {
                if (logCluster && Array.isArray(logCluster.warehouses)) {
                  for (const wh of logCluster.warehouses) {
                    if (wh && wh.warehouse_id !== undefined && wh.warehouse_id !== null && String(wh.warehouse_id).trim() !== "") {
                      newWhMap.set(String(wh.warehouse_id), String(cluster.name));
                    }
                  }
                }
              }
            }
          }
        }
      };

      processClusters(ozonResponse);
      processClusters(cisResponse);

      cachedClusterMap = newMap;
      cachedWarehouseClusterMap = newWhMap;
      clusterMapLastUpdatedAt = now;
      return cachedClusterMap;
    } catch (err: any) {
      console.error("Ошибка при загрузке справочника кластеров Ozon:", err);
      return cachedClusterMap;
    }
  }

  async function loadWarehouseClusterMap(keys: { ozonClientId: string; ozonApiKey: string }): Promise<Map<string, string>> {
    await loadClusterMap(keys);
    return cachedWarehouseClusterMap;
  }

  // Проверка ключей Ozon и получение названия кабинета (пункт 8в плана).
  async function verifyGasSession(token: string): Promise<boolean> {
    if (!token) return false;
    if (isTokenCached(token)) return true;
    const gasUrl = process.env.GAS_URL;
    if (!gasUrl) return false;
    try {
      const gasResponse = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: 'verifySession', sessionToken: token })
      });
      const rawText = await gasResponse.text();
      let gasData: any;
      try {
        gasData = JSON.parse(rawText);
      } catch {
        return false;
      }
      if (gasData && gasData.status === "success") {
        cacheToken(token);
        return true;
      }
    } catch (e: any) {
      console.error("Session verification failed:", e);
    }
    return false;
  }

  // Ключи приходят в теле запроса — Настройки проверяют их до сохранения.
  app.post("/api/ozon/seller-info", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const clientId = String(req.body?.clientId || '').trim();
      const apiKey = String(req.body?.apiKey || '').trim();
      if (!clientId || !apiKey) {
        return res.status(400).json({ status: "error", message: "Укажите Client-Id и Api-Key" });
      }

      const ozRes = await callOzonApi('/v1/seller/info', { ozonClientId: clientId, ozonApiKey: apiKey }, {});

      if (ozRes.status === 403) {
        let bodyText = '';
        try { bodyText = await ozRes.text(); } catch {}
        // Разведка (docs/OZON_API.md): 403 с code 7 — кабинет заблокирован, а не проблема ключа
        if (bodyText.includes('"code":7') || bodyText.toLowerCase().includes('blocked')) {
          return res.status(400).json({ status: "error", message: "Кабинет Ozon заблокирован — обратитесь в поддержку Ozon" });
        }
        return res.status(400).json({ status: "error", message: "Ozon не принял ключи: доступ запрещён. Проверьте Client-Id и Api-Key" });
      }

      if (ozRes.status === 401) {
        return res.status(400).json({ status: "error", message: "Ozon не принял ключи: неверный Client-Id или Api-Key" });
      }

      if (!ozRes.ok) {
        const errText = await ozRes.text().catch(() => '');
        return res.status(502).json({ status: "error", message: `Ozon API вернул ошибку ${ozRes.status}: ${errText.slice(0, 200)}` });
      }

      const data: any = await ozRes.json();
      const name = String(data?.company?.name || '').trim();
      if (!name) {
        return res.status(502).json({ status: "error", message: "Ozon ответил без названия кабинета (company.name пуст)" });
      }

      return res.json({ status: "success", data: { name } });
    } catch (e: any) {
      console.error("seller-info error:", e);
      return res.status(500).json({ status: "error", message: "Ошибка проверки ключей: " + (e?.message || String(e)) });
    }
  });

  app.post("/api/ozon/check", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const devMode = req.body?.devMode === true;

      // Get keys
      const keys = await fetchOzonKeys();
      if (!keys) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }

      const cabinets = keys.cabinets;

      // Step 2. Active orders list — по каждому кабинету отдельно:
      // order_id одного кабинета нельзя запрашивать ключами другого
      const activeOrderIdsByCabinet: Array<Set<string>> = cabinets.map(() => new Set<string>());
      
      for (let ci = 0; ci < cabinets.length; ci++) {
        const cabKeys = { ozonClientId: cabinets[ci].clientId, ozonApiKey: cabinets[ci].apiKey };
        let lastId = "";
        let pageCount = 0;
        
        while (pageCount < 20) {
          const body: any = {
            filter: {
              states: [
                "DATA_FILLING",
                "READY_TO_SUPPLY",
                "ACCEPTED_AT_SUPPLY_WAREHOUSE",
                "IN_TRANSIT",
                "ACCEPTANCE_AT_STORAGE_WAREHOUSE",
                "REPORTS_CONFIRMATION_AWAITING",
                "REPORT_REJECTED"
              ]
            },
            limit: 100,
            sort_by: "ORDER_CREATION",
            sort_dir: "DESC"
          };
          if (lastId) {
            body.last_id = lastId;
          }
          
          const listData = await fetchOzonApi("/v3/supply-order/list", cabKeys, body);
          const orderIds = listData.order_ids || [];
          for (const oid of orderIds) {
            if (oid !== undefined && oid !== null) {
              activeOrderIdsByCabinet[ci].add(String(oid));
            }
          }
          
          lastId = listData.last_id || "";
          if (!lastId) {
            break;
          }
          pageCount++;
        }
      }

      // Step 3. Already tracked shipments
      const gasUrl = process.env.GAS_URL;
      if (!gasUrl) {
        return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
      }

      const gasResponse1 = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getExternalShipments",
          sessionToken: token,
          ...(devMode ? { devMode: true } : {})
        })
      });
      const rawText1 = await gasResponse1.text();
      let gasResult1: any;
      try {
        gasResult1 = JSON.parse(rawText1);
      } catch {
        return res.status(502).json({ status: "error", message: "GAS returned non-JSON response when getting external shipments" });
      }
      if (gasResult1.status !== "success") {
        return res.status(500).json({ status: "error", message: gasResult1.message || "Failed to get external shipments from GAS" });
      }
      
      const existingShipments = gasResult1.data || [];
      const existingByPostingId = new Map<string, { status: string; ozonStatus: string; hasItems: boolean }>();
      
      for (const s of existingShipments) {
        const postingIdVal = String(s.postingId || '').trim();
        if (postingIdVal) {
          const itemsJsonVal = String(s.itemsJSON || '').trim();
          existingByPostingId.set(postingIdVal, {
            status: String(s.status || '').trim(),
            ozonStatus: String(s.ozonStatus || '').trim(),
            hasItems: itemsJsonVal !== '' && itemsJsonVal !== '[]'
          });
        }
      }
      
      // Уже отслеживаемые заявки допрашиваем ключами их кабинета.
      // Кабинет строки определяем по названию; пустой кабинет (старые строки) = первый кабинет.
      const cabinetIndexByName = new Map<string, number>();
      cabinets.forEach((c, i) => cabinetIndexByName.set(c.name, i));
      
      for (const s of existingShipments) {
        const oId = String(s.orderId || '').trim();
        const oStatus = String(s.ozonStatus || '').trim();
        if (oId && !["COMPLETED", "CANCELLED", "REJECTED_AT_SUPPLY_WAREHOUSE", "OVERDUE"].includes(oStatus)) {
          const rowCabinet = String(s.cabinet || '').trim();
          const ci = rowCabinet && cabinetIndexByName.has(rowCabinet) ? (cabinetIndexByName.get(rowCabinet) as number) : 0;
          activeOrderIdsByCabinet[ci].add(oId);
        }
      }

      // Журнал «Заявки Ozon» — третий источник идентификаторов для опроса.
      // Нужен для заявок, удалённых в Ozon Seller до первого опроса: строк во
      // «Внешних отгрузках» по ним нет, в листинге активных статусов их тоже нет,
      // поэтому статус CANCELLED без этого шага никогда не доедет, а локальный
      // резерв под такую заявку продолжает висеть.
      try {
        const gasResponseReq = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getOzonSupplyRequests",
            sessionToken: token,
            ...(devMode ? { devMode: true } : {})
          })
        });
        const rawTextReq = await gasResponseReq.text();
        const gasResultReq: any = JSON.parse(rawTextReq);

        if (gasResultReq.status === "success") {
          const FINAL_OZON_STATES = ["COMPLETED", "CANCELLED", "REJECTED_AT_SUPPLY_WAREHOUSE", "OVERDUE"];
          const finalOrderIds = new Set<string>();
          for (const s of existingShipments) {
            const oId = String(s.orderId || '').trim();
            const oSt = String(s.ozonStatus || '').trim().toUpperCase();
            if (oId && FINAL_OZON_STATES.includes(oSt)) finalOrderIds.add(oId);
          }

          const JOURNAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
          const nowMs = Date.now();
          let addedFromJournal = 0;

          for (const r of (gasResultReq.data || [])) {
            const oId = String(r?.orderId || '').trim();
            if (!oId || finalOrderIds.has(oId)) continue;

            const rStatus = String(r?.status || '').trim().toLowerCase();
            if (rStatus.indexOf('отмен') === 0) continue;

            const rawDate = String(r?.date || '').trim();
            const t = new Date(rawDate.indexOf('T') < 0 ? rawDate.replace(' ', 'T') : rawDate).getTime();
            if (!isNaN(t) && nowMs - t > JOURNAL_MAX_AGE_MS) continue;

            const rowCabinet = String(r?.cabinet || '').trim();
            const ci = rowCabinet && cabinetIndexByName.has(rowCabinet) ? (cabinetIndexByName.get(rowCabinet) as number) : 0;
            if (!activeOrderIdsByCabinet[ci].has(oId)) addedFromJournal++;
            activeOrderIdsByCabinet[ci].add(oId);
          }

          console.log("Журнал «Заявки Ozon»: добавлено к опросу заявок — " + addedFromJournal);
        }
      } catch (e: any) {
        console.error("Не удалось прочитать журнал «Заявки Ozon» при опросе:", e?.message || e);
      }

      // Step 4. Details of orders — ключами соответствующего кабинета
      const ordersDetailsList: Array<{ order: any; cabinetIndex: number }> = [];
      const batchSize = 50;
      for (let ci = 0; ci < cabinets.length; ci++) {
        const cabKeys = { ozonClientId: cabinets[ci].clientId, ozonApiKey: cabinets[ci].apiKey };
        const cabOrderIds = Array.from(activeOrderIdsByCabinet[ci]);
        for (let i = 0; i < cabOrderIds.length; i += batchSize) {
          const batchIds = cabOrderIds.slice(i, i + batchSize);
          if (batchIds.length === 0) continue;
          
          const detailResponse = await fetchOzonApi("/v3/supply-order/get", cabKeys, { order_ids: batchIds });
          const orders = detailResponse.orders || [];
          for (const order of orders) {
            if (order) {
              ordersDetailsList.push({ order, cabinetIndex: ci });
            }
          }
        }
      }

      // Заявки, отменённые в Ozon Seller, строк во «Внешних отгрузках» не получают:
      // ниже они сознательно пропускаются, потому что поставка не отгружалась.
      // Поэтому возвращаем забронированный остаток через журнал «Заявки Ozon».
      // Вызов делается всегда, даже с пустым списком: на той стороне он ещё и чистит
      // отменённые записи старше 28 дней.
      try {
        const cancelledOrderIds: string[] = [];
        for (const entry of ordersDetailsList) {
          const st = String(entry?.order?.state || '').trim().toUpperCase();
          if (st !== 'CANCELLED') continue;
          const oId = String(entry?.order?.order_id || '').trim();
          if (oId && cancelledOrderIds.indexOf(oId) < 0) cancelledOrderIds.push(oId);
        }

        const gasResponseCancel = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "applyCancelledOzonOrders",
            sessionToken: token,
            data: { orderIds: cancelledOrderIds },
            ...(devMode ? { devMode: true } : {})
          })
        });
        const rawTextCancel = await gasResponseCancel.text();
        const gasResultCancel: any = JSON.parse(rawTextCancel);

        if (gasResultCancel.status === "success") {
          const st = gasResultCancel.data || {};
          console.log(
            "Отменённые заявки: помечено " + (st.updated ?? 0) +
            ", удалено записей журнала " + (st.purgedRequests ?? 0) +
            ", удалено строк отгрузок " + (st.purgedShipments ?? 0)
          );
        } else {
          console.error("Не удалось обработать отменённые заявки:", gasResultCancel.message);
        }
      } catch (e: any) {
        console.error("Ошибка при обработке отменённых заявок:", e?.message || e);
      }

      // Step 5. Forming records on supply
      const clusterMap = await loadClusterMap({ ozonClientId: cabinets[0].clientId, ozonApiKey: cabinets[0].apiKey });

      // Обратный справочник: название кластера → macrolocal_cluster_id.
      // Нужен, когда Ozon не отдаёт идентификатор кластера в поставке.
      const clusterIdByName = new Map<string, string>();
      clusterMap.forEach((clusterName, clusterIdValue) => {
        const nameKey = String(clusterName).trim();
        if (nameKey && !clusterIdByName.has(nameKey)) {
          clusterIdByName.set(nameKey, String(clusterIdValue));
        }
      });

      const clusterStats = { fromApi: 0, fromName: 0, unresolved: 0 };
      const finalShipments: any[] = [];
      
      for (const entry of ordersDetailsList) {
        const order = entry.order;
        const cabinetIndex = entry.cabinetIndex;
        const orderId = String(order.order_id);
        const orderNumber = String(order.order_number || '');
        const ozonStatusDate = String(order.state_updated_date || '');
        const dropOffWarehouse = order.drop_off_warehouse?.name || '';

        // Пункт 31. Виртуальная заявка создана самим Ozon: оприходование найденного
        // товара либо допоставка после отказа в приёмке. Товар уже находится у Ozon,
        // наш склад в операции не участвует, поэтому под такую заявку не строится
        // резерв и не проводится списание. Единственный признак — order_tags.is_virtual.
        // Поле original_supply_id хранится только для справки и в логику не заложено.
        const orderTags = order.order_tags || {};
        const isVirtual = orderTags.is_virtual === true;
        const originalSupplyIdRaw = orderTags.original_supply_id;
        const originalSupplyId = (originalSupplyIdRaw === undefined || originalSupplyIdRaw === null || String(originalSupplyIdRaw).trim() === '' || String(originalSupplyIdRaw).trim() === '0')
          ? ''
          : String(originalSupplyIdRaw).trim();
        
        let timeslotStr = '';
        let shipmentDate = '';
        if (order.timeslot?.timeslot?.from) {
          const fromVal = String(order.timeslot.timeslot.from);
          const toVal = order.timeslot.timeslot.to ? String(order.timeslot.timeslot.to) : '';
          timeslotStr = `${fromVal} — ${toVal}`;
          shipmentDate = fromVal.substring(0, 10); // First 10 chars, YYYY-MM-DD
        }
        
        const supplies = order.supplies || [];
        for (const supply of supplies) {
          if (!supply || !supply.supply_id) continue;
          
          const postingId = String(supply.supply_id);
          const ozonStatus = String(supply.state || '');
          
          // Отменённые и просроченные поставки, которые ещё не отслеживаются,
          // в базу не заносим — они не отгружались на Ozon.
          // Уже отслеживаемые обновляются как обычно, чтобы статус корректно закрылся.
          if ((ozonStatus === 'CANCELLED' || ozonStatus === 'OVERDUE') && !existingByPostingId.has(postingId)) {
            continue;
          }
          
          const hasMacrolocal = supply.macrolocal_cluster_id !== null && supply.macrolocal_cluster_id !== undefined && String(supply.macrolocal_cluster_id).trim() !== '';
          const macrolocalStr = hasMacrolocal ? String(supply.macrolocal_cluster_id).trim() : '';

          let storageWarehouse = '';
          if (supply.storage_warehouse?.name) {
            storageWarehouse = supply.storage_warehouse.name;
          } else if (hasMacrolocal && clusterMap.has(macrolocalStr)) {
            storageWarehouse = clusterMap.get(macrolocalStr) || '';
          } else if (hasMacrolocal) {
            storageWarehouse = `Кластер ${supply.macrolocal_cluster_id}`;
          }

          const bundleId = supply.bundle_id || '';

          // Идентификатор кластера: сначала из ответа Ozon, затем по названию склада хранения
          let clusterIdOut = macrolocalStr;
          if (clusterIdOut) {
            clusterStats.fromApi++;
          } else {
            const byName = clusterIdByName.get(String(storageWarehouse).trim());
            if (byName) {
              clusterIdOut = byName;
              clusterStats.fromName++;
            } else {
              clusterStats.unresolved++;
            }
          }
          
          finalShipments.push({
            postingId,
            orderId,
            orderNumber,
            ozonStatus,
            ozonStatusDate,
            dropOffWarehouse,
            storageWarehouse,
            timeslot: timeslotStr,
            shipmentDate,
            bundleId,
            clusterId: clusterIdOut,
            isVirtual,
            originalSupplyId,
            cabinetIndex,
            cabinet: cabinets[cabinetIndex].name
          });
        }
      }

      // Step 6. Composition of supply
      const shipmentsForGas: any[] = [];
      
      for (const s of finalShipments) {
        const postingId = s.postingId;
        const bundleId = s.bundleId;
        
        let shouldFetchBundle = false;
        const existInfo = existingByPostingId.get(postingId);
        if (!existInfo) {
          // Новая поставка — состав нужен всегда
          shouldFetchBundle = true;
        } else if (existInfo.status === 'new') {
          // Состав поставки можно менять в Ozon Seller без смены статуса заявки,
          // поэтому у всех ещё не оформленных поставок состав перезапрашивается
          // на каждом опросе — иначе локальный резерв товара остаётся устаревшим
          shouldFetchBundle = true;
        }
        
        let items: any[] = [];
        
        if (shouldFetchBundle && bundleId) {
          let hasNext = true;
          let lastId = "";
          let bundlePageCount = 0;
          
          while (hasNext && bundlePageCount < 20) {
            const body: any = {
              bundle_ids: [bundleId],
              limit: 100
            };
            if (lastId) {
              body.last_id = lastId;
            }
            
            const bundleResult = await fetchOzonApi("/v1/supply-order/bundle", { ozonClientId: cabinets[s.cabinetIndex].clientId, ozonApiKey: cabinets[s.cabinetIndex].apiKey }, body);
            const rawItems = bundleResult.items || [];
            
            for (const item of rawItems) {
              items.push({
                offerId: String(item.offer_id || '').trim(),
                barcode: String(item.barcode || '').trim(),
                quantity: Number(item.quantity || 0)
              });
            }
            
            lastId = bundleResult.last_id || "";
            hasNext = bundleResult.has_next === true;
            bundlePageCount++;
          }
        }
        
        // Непустой состав, уже записанный в лист, не затирается пустым ответом Ozon:
        // пустой ответ означает сбой запроса, а не «в поставке нет товара»
        const itemsAreEmpty = items.length === 0;
        const sheetHasItems = !!(existInfo && existInfo.hasItems);
        const itemsJSON = (shouldFetchBundle && !(itemsAreEmpty && sheetHasItems))
          ? JSON.stringify(items)
          : "";
        
        shipmentsForGas.push({
          postingId: s.postingId,
          shipmentDate: s.shipmentDate,
          itemsJSON,
          transGroupInfo: "",
          orderId: s.orderId,
          orderNumber: s.orderNumber,
          ozonStatus: s.ozonStatus,
          ozonStatusDate: s.ozonStatusDate,
          dropOffWarehouse: s.dropOffWarehouse,
          storageWarehouse: s.storageWarehouse,
          timeslot: s.timeslot,
          clusterId: s.clusterId || '',
          isVirtual: s.isVirtual === true,
          originalSupplyId: s.originalSupplyId || '',
          cabinet: s.cabinet
        });
      }

      // Step 7. Saving to GAS
      const gasResponse2 = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveExternalShipments",
          sessionToken: token,
          ...(devMode ? { devMode: true } : {}),
          data: {
            shipments: shipmentsForGas
          }
        })
      });

      const rawText2 = await gasResponse2.text();
      let gasData: any;
      try {
        gasData = JSON.parse(rawText2);
      } catch {
        return res.status(502).json({ status: "error", message: "GAS returned non-JSON response when saving external shipments" });
      }
      if (gasData.status !== "success") {
        return res.status(500).json({ status: "error", message: gasData.message || "Failed to save external shipments in GAS" });
      }

      // Step 8. Response to client
      return res.json({
        status: "success",
        data: {
          found: shipmentsForGas.length,
          added: gasData.data?.addedCount || 0,
          updated: gasData.data?.updatedCount || 0,
          clusterStats
        }
      });

    } catch (error: any) {
      console.error("Ozon check endpoint failed:", error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.message || String(error)
      });
    }
  });

  app.post("/api/ozon/stocks", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const devMode = req.body?.devMode === true;

      // Get keys
      const keys = await fetchOzonKeys();
      if (!keys) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }

      const cabinets = keys.cabinets;
      const okCabinets: string[] = [];
      const allRows: any[] = [];
      const cabinetsReport: any[] = [];
      let firstErrorMessage = "";

      for (const cab of cabinets) {
        const name = cab.name;
        try {
          const cabKeys = { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey };
          const collectedSkus: string[] = [];
          let lastId = "";
          let pageCount = 0;

          while (pageCount < 20) {
            const body: any = {
              filter: { visibility: "ALL" },
              limit: 1000
            };
            if (lastId) {
              body.last_id = lastId;
            }

            const listData = await fetchOzonApi("/v3/product/list", cabKeys, body);
            const items = listData.result?.items || [];
            for (const item of items) {
              if (item && item.sku !== undefined && item.sku !== null && item.sku !== 0) {
                collectedSkus.push(String(item.sku));
              }
            }

            lastId = listData.result?.last_id || "";
            if (!lastId) {
              break;
            }
            pageCount++;
          }

          if (collectedSkus.length === 0) {
            okCabinets.push(name);
            cabinetsReport.push({ name, ok: true, rows: 0 });
            continue;
          }

          const cabRows: any[] = [];
          const batchSize = 100;
          for (let i = 0; i < collectedSkus.length; i += batchSize) {
            const batch = collectedSkus.slice(i, i + batchSize);
            const stocksData = await fetchOzonApi("/v1/analytics/stocks", cabKeys, { skus: batch });
            const items = stocksData.items || [];
            for (const item of items) {
              const available = Number(item.available_stock_count || 0);
              const preparing = Number(item.valid_stock_count || 0);
              const requested = Number(item.requested_stock_count || 0);
              const transit = Number(item.transit_stock_count || 0);
              const excess = Number(item.excess_stock_count || 0);
              const returns = Number(item.return_from_customer_stock_count || 0) + Number(item.return_to_seller_stock_count || 0);
              const other = Number(item.waiting_docs_stock_count || 0) + Number(item.expiring_stock_count || 0) + Number(item.transit_defect_stock_count || 0) + Number(item.stock_defect_stock_count || 0) + Number(item.other_stock_count || 0);

              if (available === 0 && preparing === 0 && requested === 0 && transit === 0 && excess === 0 && returns === 0 && other === 0) {
                continue;
              }

              cabRows.push({
                cabinet: name,
                sku: String(item.sku || ''),
                offerId: String(item.offer_id || ''),
                name: String(item.name || ''),
                warehouseName: (item.warehouse_id && item.warehouse_name) ? String(item.warehouse_name) : 'Без склада (агрегат кластера)',
                clusterName: String(item.cluster_name || ''),
                clusterId: String(item.macrolocal_cluster_id || ''),
                available,
                preparing,
                requested,
                transit,
                excess,
                returns,
                other
              });
            }
          }

          okCabinets.push(name);
          allRows.push(...cabRows);
          cabinetsReport.push({ name, ok: true, rows: cabRows.length });

        } catch (err: any) {
          console.error(`Ошибка при опросе кабинета Ozon ${name}:`, err);
          let message = err.message || String(err);
          if (err.httpStatus === 403 || message.includes("403") || message.toLowerCase().includes("forbidden")) {
            message = "Кабинет пропущен: нет доступа (проверьте ключи или подписку Premium)";
          }
          if (!firstErrorMessage) {
            firstErrorMessage = message;
          }
          cabinetsReport.push({ name, ok: false, message });
        }
      }

      if (okCabinets.length === 0) {
        return res.status(502).json({
          status: "error",
          stage: "ozon_api",
          message: firstErrorMessage || "Не удалось получить остатки ни по одному кабинету Ozon"
        });
      }

      const gasUrl = process.env.GAS_URL;
      if (!gasUrl) {
        return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
      }

      const gasResponse2 = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveOzonStocks",
          sessionToken: token,
          ...(devMode ? { devMode: true } : {}),
          data: {
            okCabinets,
            rows: allRows
          }
        })
      });

      const rawText2 = await gasResponse2.text();
      let gasData: any;
      try {
        gasData = JSON.parse(rawText2);
      } catch {
        return res.status(502).json({ status: "error", message: "GAS returned non-JSON response when saving Ozon stocks" });
      }
      if (gasData.status !== "success") {
        return res.status(500).json({ status: "error", message: gasData.message || "Failed to save Ozon stocks in GAS" });
      }

      return res.json({
        status: "success",
        data: {
          savedRows: gasData.data?.savedRows || 0,
          keptRows: gasData.data?.keptRows || 0,
          cabinets: cabinetsReport
        }
      });

    } catch (error: any) {
      console.error("Ozon stocks endpoint failed:", error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.message || String(error)
      });
    }
  });

  app.post("/api/ozon/clusters", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const devMode = req.body?.devMode === true;

      const keys = await fetchOzonKeys();
      if (!keys || !keys.cabinets || keys.cabinets.length === 0) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }

      const cab = keys.cabinets[0];

      await loadClusterMap({ ozonClientId: cab.clientId, ozonApiKey: cab.apiKey });
      const clusters = Array.from(cachedClusterMap.entries()).map(([clusterId, clusterName]) => ({ clusterId, clusterName }));

      if (clusters.length === 0) {
        return res.status(500).json({ status: "error", message: "Справочник кластеров Ozon пуст — не удалось загрузить /v1/cluster/list" });
      }

      const gasUrl = process.env.GAS_URL;
      if (!gasUrl) {
        return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
      }

      const gasResponse = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveOzonClusters",
          sessionToken: token,
          ...(devMode ? { devMode: true } : {}),
          data: {
            clusters
          }
        })
      });

      const rawText = await gasResponse.text();
      let gasData: any;
      try {
        gasData = JSON.parse(rawText);
      } catch {
        return res.status(502).json({ status: "error", message: "GAS returned non-JSON response when saving Ozon clusters" });
      }
      if (gasData.status !== "success") {
        return res.status(500).json({ status: "error", message: gasData.message || "Failed to save Ozon clusters in GAS" });
      }

      return res.json({
        status: "success",
        data: {
          totalClusters: clusters.length,
          newClusters: gasData.data?.newClusters || 0
        }
      });

    } catch (error: any) {
      console.error("Ozon clusters endpoint failed:", error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.message || String(error)
      });
    }
  });

  // ── Этап H: оформление заявки на поставку ────────────────────────────────────

  /** Выбор кабинета по имени; без имени — первый в списке. */
  /**
   * Пункт 59. Кабинет для операций С ЗАЯВКОЙ. В отличие от pickCabinet, пустое или
   * неизвестное имя НЕ подменяется первым кабинетом: заявка на поставку принадлежит
   * одному магазину, ключи у кабинетов разные, и молчаливая подмена отправляла бы
   * заявку от чужого юрлица. Возвращает null — вызывающий отвечает ошибкой.
   */
  function requireCabinet(keys: OzonKeysBundle, name?: string): OzonCabinetKeys | null {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    return keys.cabinets.find(c => String(c.name || '').trim().toLowerCase() === wanted) || null;
  }

  const CABINET_REQUIRED_MESSAGE =
    'Не указан магазин: заявка на поставку принадлежит одному кабинету, и подставлять первый попавшийся нельзя';

  // Пункт 62. Ozon разрешает создавать не больше 2 черновиков в минуту (50 в час, 500 в день).
  // Повтор сразу после отказа упирается в лимит, и общий текст про «синхронизацию» сбивает с толку.
  const DRAFT_RATE_LIMIT_MESSAGE =
    'Ozon разрешает не больше 2 проверок черновика в минуту. Подождите 30 секунд и нажмите «Проверить в Ozon» ещё раз.';

  function pickCabinet(keys: OzonKeysBundle, name?: string): OzonCabinetKeys {
    const wanted = String(name || '').trim().toLowerCase();
    if (wanted) {
      const found = keys.cabinets.find(c => String(c.name || '').trim().toLowerCase() === wanted);
      if (found) return found;
    }
    return keys.cabinets[0];
  }

  /**
   * Товарный состав по bundle_id. Метод читающий, несмотря на POST.
   * Ozon отдаёт не больше 100 позиций за страницу и сигналит о продолжении через has_next + last_id.
   * По документации за один вызов передаётся ровно один bundle_id.
   */
  async function loadBundleItems(bundleId: string, cab: OzonCabinetKeys): Promise<any[]> {
    if (!bundleId) return [];
    const out: any[] = [];
    let lastId = '';
    try {
      for (let page = 0; page < 10; page++) {
        const body: any = {
          bundle_ids: [String(bundleId)],
          limit: 100,
          sort_field: "QUANTITY",
          is_asc: false
        };
        if (lastId) body.last_id = lastId;

        const data: any = await fetchOzonApi("/v1/supply-order/bundle",
          { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, body);

        const items = Array.isArray(data?.items) ? data.items : [];
        for (const it of items) {
          out.push({
            sku: String(it?.sku ?? ''),
            offerId: String(it?.offer_id ?? ''),
            name: String(it?.name ?? ''),
            barcode: String(it?.barcode ?? ''),
            quantity: Number(it?.quantity) || 0,
            volumeInLitres: Number(it?.volume_in_litres) || 0,
            totalVolumeInLitres: Number(it?.total_volume_in_litres) || 0,
            placementZone: String(it?.placement_zone ?? '')
          });
        }

        if (data?.has_next !== true) break;
        lastId = String(data?.last_id || '');
        if (!lastId) break;
      }
    } catch (e: any) {
      console.error("loadBundleItems failed for bundle " + bundleId + ":", e?.message || e);
    }
    return out;
  }

  // Поиск точки отгрузки по подстроке названия (минимум 4 символа — требование Ozon)
  app.post("/api/ozon/dropoff/search", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const search = String(req.body?.search || '').trim();
      if (search.length < 4) {
        return res.status(400).json({ status: "error", message: "Для поиска точки отгрузки нужно минимум 4 символа" });
      }

      // Пункт 58. Тот же метод Ozon отдаёт два разных списка складов: кросс-докинговые точки
      // отгрузки и склады прямой поставки, куда продавец везёт груз сам. Без параметра
      // поведение прежнее — кросс-докинг, чтобы старые вызовы не изменились.
      const supplyType = String(req.body?.supplyType || 'CROSSDOCK').trim().toUpperCase();
      if (supplyType !== 'CROSSDOCK' && supplyType !== 'DIRECT') {
        return res.status(400).json({ status: "error", message: "Неизвестный тип поставки: " + supplyType });
      }
      const filterBySupplyType = supplyType === 'DIRECT' ? "CREATE_TYPE_DIRECT" : "CREATE_TYPE_CROSSDOCK";

      const keys = await fetchOzonKeys();
      if (!keys || !keys.cabinets || keys.cabinets.length === 0) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }
      const cab = pickCabinet(keys, req.body?.cabinet);

      const data: any = await fetchOzonApi("/v1/warehouse/fbo/list",
        { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey },
        { filter_by_supply_type: [filterBySupplyType], search });

      const found = Array.isArray(data?.search) ? data.search : [];
      const warehouses = found.map((w: any) => ({
        warehouseId: String(w?.warehouse_id ?? ''),
        name: String(w?.name ?? ''),
        address: String(w?.address ?? ''),
        // В ответе тип приходит с префиксом WAREHOUSE_TYPE_, а методы черновика ждут значение без него
        warehouseType: String(w?.warehouse_type ?? '').replace(/^WAREHOUSE_TYPE_/, '')
      }));

      return res.json({ status: "success", data: { warehouses } });

    } catch (error: any) {
      console.error("Ozon dropoff search failed:", error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.message || String(error)
      });
    }
  });

  // Черновик поставки: создание + расчёт + вердикт Ozon по каждому кластеру
  app.post("/api/ozon/supply/draft", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const dropOffId = String(req.body?.dropOffWarehouseId || '').trim();
      const dropOffType = String(req.body?.dropOffWarehouseType || '').trim().toUpperCase();
      const clustersIn = Array.isArray(req.body?.clusters) ? req.body.clusters : [];

      // Пункт 58, этап 4. Прямая поставка идёт другим методом Ozon: продавец везёт груз сам,
      // поэтому точки отгрузки у неё нет вовсе, зато нужен склад размещения.
      const supplyType = String(req.body?.supplyType || 'CROSSDOCK').trim().toUpperCase();
      if (supplyType !== 'CROSSDOCK' && supplyType !== 'DIRECT') {
        return res.status(400).json({ status: "error", message: "Неизвестный тип поставки: " + supplyType });
      }
      const storageWarehouseId = String(req.body?.storageWarehouseId || '').trim();
      const storageWarehouseName = String(req.body?.storageWarehouseName || '').trim();

      if (supplyType === 'CROSSDOCK' && (!dropOffId || !dropOffType)) {
        return res.status(400).json({ status: "error", message: "Не указана точка отгрузки — заполните её в настройках Ozon" });
      }
      if (supplyType === 'DIRECT' && !storageWarehouseId) {
        return res.status(400).json({ status: "error", message: "Не указан склад прямой поставки — выберите его в настройках Ozon" });
      }
      if (clustersIn.length === 0) {
        return res.status(400).json({ status: "error", message: "Не передан ни один кластер" });
      }
      if (clustersIn.length > 20) {
        return res.status(400).json({ status: "error", message: "Ozon принимает не больше 20 кластеров в одной заявке" });
      }

      const keys = await fetchOzonKeys();
      if (!keys || !keys.cabinets || keys.cabinets.length === 0) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }
      const cab = requireCabinet(keys, req.body?.cabinet);
      if (!cab) {
        return res.status(400).json({ status: "error", stage: "no_cabinet", message: CABINET_REQUIRED_MESSAGE });
      }

      const clustersInfo = clustersIn.map((c: any) => ({
        macrolocal_cluster_id: Number(c?.clusterId),
        items: (Array.isArray(c?.items) ? c.items : []).map((i: any) => ({
          sku: Number(i?.sku),
          quantity: Number(i?.quantity) || 0
        })).filter((i: any) => i.sku > 0 && i.quantity > 0)
      })).filter((c: any) => c.macrolocal_cluster_id > 0 && c.items.length > 0);

      if (clustersInfo.length === 0) {
        return res.status(400).json({ status: "error", message: "Состав поставки пуст: проверьте, что у артикулов заполнен ШК Ozon" });
      }

      // Прямая поставка едет ОДНИМ кластером: cluster_info в /v1/draft/direct/create — объект,
      // а не массив, и смешанного черновика в Ozon не существует.
      if (supplyType === 'DIRECT' && clustersInfo.length !== 1) {
        return res.status(400).json({
          status: "error",
          message: "Прямой поставкой едет один кластер за заявку, а передано: " + clustersInfo.length
        });
      }

      // deletion_sku_mode обязателен де-факто, без него Ozon отвечает 400
      const createData: any = supplyType === 'DIRECT'
        ? await fetchOzonApi("/v1/draft/direct/create",
            { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey },
            {
              cluster_info: clustersInfo[0],
              deletion_sku_mode: "PARTIAL"
            })
        : await fetchOzonApi("/v1/draft/multi-cluster/create",
            { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey },
            {
              clusters_info: clustersInfo,
              delivery_info: {
                type: "DROPOFF",
                drop_off_warehouse: { warehouse_id: Number(dropOffId), warehouse_type: dropOffType }
              },
              deletion_sku_mode: "PARTIAL"
            });

      const draftId = createData?.draft_id;
      if (!draftId) {
        // Пункт 62. Ozon отказал ещё на создании черновика и назвал причину в errors[].
        const createFailures = readDraftErrors(createData?.errors);
        console.error(draftErrorLogLine('CREATE_REJECTED', createFailures));
        return res.status(502).json({
          status: "error",
          stage: "ozon_draft_failed",
          message: createFailures.length > 0
            ? draftFailureTitle('CREATE_REJECTED', createFailures)
            : "Ozon не принял черновик и не назвал причину",
          hint: draftFailureHint(createFailures, clustersInfo.length),
          draftStatus: 'CREATE_REJECTED',
          failures: createFailures,
          details: createData?.errors || null
        });
      }

      // Расчёт черновика асинхронный: опрашиваем до готовности
      let info: any = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        info = await fetchOzonApi("/v2/draft/create/info",
          { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey },
          { draft_id: draftId });
        const st = String(info?.status || '');
        if (st === 'SUCCESS' || st === 'FAILED') break;
        await sleep(2000);
      }

      if (String(info?.status || '') !== 'SUCCESS') {
        // Пункт 62. Причина отказа приходит в errors[]: код, виноватые кластеры и
        // отклонённые SKU. Раньше она молча ложилась в details, и владелец видел одно
        // слово FAILED. Теперь она пишется в лог Cloud Run и доезжает до экрана.
        const draftStatus = String(info?.status || '');
        const failures = readDraftErrors(info?.errors);
        console.error(draftErrorLogLine(draftStatus, failures));
        return res.status(502).json({
          status: "error",
          stage: "ozon_draft_failed",
          message: draftFailureTitle(draftStatus, failures),
          hint: draftFailureHint(failures, clustersInfo.length),
          draftStatus,
          failures,
          details: info?.errors || null
        });
      }

      // Отклонённые SKU привязаны к кластеру
      const rejectedItems: any[] = [];
      const rawErrors = Array.isArray(info?.errors) ? info.errors : [];
      for (const err of rawErrors) {
        const validations = Array.isArray(err?.items_validation) ? err.items_validation : [];
        for (const v of validations) {
          const items = Array.isArray(v?.rejected_items) ? v.rejected_items : [];
          for (const it of items) {
            rejectedItems.push({
              clusterId: String(v?.macrolocal_cluster_id ?? ''),
              sku: String(it?.sku ?? ''),
              reasons: Array.isArray(it?.reasons) ? it.reasons.map((r: any) => String(r)) : []
            });
          }
        }
      }

      const clustersOut: any[] = [];
      const rawClusters = Array.isArray(info?.clusters) ? info.clusters : [];
      // Пункт 58, этап 4. У прямой поставки склад размещения выбирает продавец, поэтому
      // ответ несёт итог выбора: подошёл ли склад из настроек и чем его заменить.
      let directWarehouseOut: any = null;

      for (const cl of rawClusters) {
        const warehouses = Array.isArray(cl?.warehouses) ? cl.warehouses : [];

        // bundle_id и restricted_bundle_id могут лежать в РАЗНЫХ элементах warehouses[],
        // поэтому сканируем весь массив, а не только первый элемент
        let bundleId = '';
        let restrictedBundleId = '';
        let mainWh: any = null;
        for (const wh of warehouses) {
          if (!bundleId && wh?.bundle_id) {
            bundleId = String(wh.bundle_id);
            mainWh = wh;
          }
          if (!restrictedBundleId && wh?.restricted_bundle_id) {
            restrictedBundleId = String(wh.restricted_bundle_id);
          }
        }
        if (!mainWh && warehouses.length > 0) mainWh = warehouses[0];

        // У прямой поставки состав берётся из бандла ВЫБРАННОГО склада, а не первого
        // попавшегося: бандл свой у каждого склада, и чужой описал бы другую поставку.
        let directChoice: any = null;
        if (supplyType === 'DIRECT') {
          directChoice = chooseDirectWarehouse(readDraftWarehouses(warehouses), storageWarehouseId);
          if (directChoice.chosen) {
            bundleId = directChoice.chosen.bundleId;
            restrictedBundleId = directChoice.chosen.restrictedBundleId;
            mainWh = warehouses.find((w: any) => String(w?.storage_warehouse?.warehouse_id ?? '') === directChoice.chosen.warehouseId) || mainWh;
          }
          directWarehouseOut = {
            requestedId: storageWarehouseId,
            requestedName: storageWarehouseName,
            chosen: directChoice.chosen,
            problem: directChoice.problem,
            alternatives: directChoice.alternatives,
            message: directWarehouseMessage(directChoice, storageWarehouseName)
          };
        }

        const accepted = await loadBundleItems(bundleId, cab);
        const rejected = await loadBundleItems(restrictedBundleId, cab);

        clustersOut.push({
          clusterId: String(cl?.macrolocal_cluster_id ?? ''),
          clusterName: String(cl?.cluster_name || ''),
          supplyType: String(cl?.supply_type || ''),
          state: String(mainWh?.availability_status?.state || ''),
          invalidReason: String(mainWh?.availability_status?.invalid_reason || ''),
          bundleId,
          restrictedBundleId,
          accepted,
          rejected
        });
      }

      return res.json({
        status: "success",
        data: { draftId: String(draftId), clusters: clustersOut, rejectedItems, supplyType, directWarehouse: directWarehouseOut }
      });

    } catch (error: any) {
      console.error("Ozon supply draft failed:", error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.httpStatus === 429 ? DRAFT_RATE_LIMIT_MESSAGE : (error.message || String(error))
      });
    }
  });

  // Создание заявки из черновика. Необратимо: заявка появляется в кабинете Ozon.
  app.post("/api/ozon/supply/create", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const devMode = req.body?.devMode === true;
      const draftId = Number(req.body?.draftId);
      const clusterIds = Array.isArray(req.body?.clusterIds) ? req.body.clusterIds : [];
      const availabilityCheck = Array.isArray(req.body?.availabilityCheck) ? req.body.availabilityCheck : [];

      if (!draftId || clusterIds.length === 0) {
        return res.status(400).json({ status: "error", message: "Не передан draftId или список кластеров" });
      }

      // Повторная проверка наличия на Моём складе — последний рубеж перед необратимым действием
      if (availabilityCheck.length > 0) {
        const gasUrl = process.env.GAS_URL;
        if (!gasUrl) {
          return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
        }
        const checkResponse = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "checkSupplyAvailability",
            sessionToken: token,
            ...(devMode ? { devMode: true } : {}),
            data: { items: availabilityCheck }
          })
        });
        const checkText = await checkResponse.text();
        let checkData: any;
        try {
          checkData = JSON.parse(checkText);
        } catch {
          return res.status(502).json({ status: "error", message: "GAS вернул не-JSON при проверке наличия" });
        }
        if (checkData.status !== "success") {
          return res.status(500).json({ status: "error", message: checkData.message || "Не удалось проверить наличие товара" });
        }
        const shortage = (checkData.data?.items || []).filter((i: any) => i.enough === false);
        if (shortage.length > 0) {
          return res.status(409).json({
            status: "error",
            stage: "not_enough_stock",
            message: "На Моём складе не хватает товара — заявка в Ozon не отправлена",
            data: { shortage }
          });
        }
      }

      const keys = await fetchOzonKeys();
      if (!keys || !keys.cabinets || keys.cabinets.length === 0) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }
      const cab = requireCabinet(keys, req.body?.cabinet);
      if (!cab) {
        return res.status(400).json({ status: "error", stage: "no_cabinet", message: CABINET_REQUIRED_MESSAGE });
      }

      // Пункт 58, этап 5. Прямая поставка создаётся тем же методом, но другим типом,
      // и ТОЛЬКО у неё в selected_cluster_warehouses идёт storage_warehouse_id: продавец
      // сам называет склад, куда повезёт груз.
      const createSupplyType = String(req.body?.supplyType || 'CROSSDOCK').trim().toUpperCase() === 'DIRECT'
        ? 'DIRECT'
        : 'MULTI_CLUSTER';
      const createStorageWarehouseId = String(req.body?.storageWarehouseId || '').trim();

      if (createSupplyType === 'DIRECT') {
        if (clusterIds.length !== 1) {
          return res.status(400).json({
            status: "error",
            message: "Прямой поставкой едет один кластер за заявку, а передано: " + clusterIds.length
          });
        }
        if (!createStorageWarehouseId) {
          return res.status(400).json({
            status: "error",
            message: "Не указан склад прямой поставки — заявка в Ozon не отправлена"
          });
        }
      }

      // Для MULTI_CLUSTER передаются все кластеры расчёта; storage_warehouse_id только для DIRECT
      await fetchOzonApi("/v2/draft/supply/create",
        { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey },
        {
          draft_id: draftId,
          supply_type: createSupplyType,
          selected_cluster_warehouses: createSupplyType === 'DIRECT'
            ? [{ macrolocal_cluster_id: Number(clusterIds[0]), storage_warehouse_id: Number(createStorageWarehouseId) }]
            : clusterIds.map((id: any) => ({ macrolocal_cluster_id: Number(id) }))
        });

      let statusData: any = null;
      let orderId = '';
      for (let attempt = 0; attempt < 20; attempt++) {
        statusData = await fetchOzonApi("/v2/draft/supply/create/status",
          { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey },
          { draft_id: draftId });
        const st = String(statusData?.status || '');
        if (st === 'SUCCESS') {
          orderId = String(statusData?.order_id ?? '');
          break;
        }
        if (st === 'FAILED') break;
        await sleep(2000);
      }

      if (!orderId) {
        return res.status(502).json({
          status: "error",
          stage: "ozon_api",
          message: "Ozon не подтвердил создание заявки: статус " + String(statusData?.status || 'нет ответа'),
          details: statusData?.error_reasons || null
        });
      }

      return res.json({ status: "success", data: { orderId, draftId: String(draftId) } });

    } catch (error: any) {
      console.error("Ozon supply create failed:", error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.message || String(error)
      });
    }
  });

  // ── Грузоместа и документы заявки (пункт 24 плана) ────────────────────────────
  // Разведка и формы ответов Ozon: docs/OZON_API.md, секции «Разведка пункта 24»
  // и «Разведка A2 пункта 24». Ключ всей цепочки — supply_id, а не order_id.

  const CARGO_POLL_ATTEMPTS = 15;
  const CARGO_POLL_DELAY_MS = 2000;

  function sanitizeFileName(name: string): string {
    const cleaned = String(name || '')
      .replace(/[\/\\:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'Без названия';
  }

  function zoneToRussian(zone: string): string {
    const z = String(zone || '').toUpperCase();
    if (z === 'SORT') return 'Сортируемый товар';
    if (z === 'NON_SORT') return 'Несортируемый товар';
    if (z === 'KGT') return 'Крупногабаритный товар';
    return String(zone || '');
  }

  // Файл «Состав ГМ поставки»: семь колонок в том же порядке, что отдаёт кабинет Ozon.
  // Одна строка = один артикул в одном грузоместе.
  function buildCompositionXlsxBase64(
    boxes: any[],
    cargoIdByKey: Record<string, string>,
    zones: Record<string, string>
  ): string {
    const rows: any[][] = [[
      'ШК товара',
      'Артикул товара',
      'Кол-во товаров',
      'Зона размещения',
      'Срок годности ДО в формате YYYY-MM-DD (необязательно)',
      'ШК ГМ',
      'Тип ГМ (не обязательно)'
    ]];

    for (const box of boxes) {
      const cargoId = cargoIdByKey[String(box?.key || '')] || '';
      const items = Array.isArray(box?.items) ? box.items : [];
      for (const it of items) {
        const barcode = String(it?.barcode || '');
        rows.push([
          barcode,
          String(it?.offerId || ''),
          Number(it?.quantity) || 0,
          zoneToRussian(zones[barcode] || ''),
          '',
          cargoId,
          'Коробка'
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Состав ГМ поставки');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
  }

  // Создание грузомест одной поставки с полной перезаписью прежней раскладки
  async function createCargoesForSupply(cab: any, supplyId: string, boxes: any[]): Promise<Record<string, string>> {
    const payload = {
      supply_id: Number(supplyId),
      delete_current_version: true,
      cargoes: boxes.map((b: any) => ({
        key: String(b?.key || ''),
        value: {
          type: 'BOX',
          items: (Array.isArray(b?.items) ? b.items : []).map((it: any) => ({
            barcode: String(it?.barcode || ''),
            offer_id: String(it?.offerId || ''),
            quantity: Number(it?.quantity) || 0,
            quant: Number(it?.quant) || 1
          }))
        }
      }))
    };

    const created: any = await fetchOzonApi("/v1/cargoes/create",
      { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, payload);

    const operationId = String(created?.operation_id || '');
    if (!operationId) {
      const reasons = created?.errors?.error_reasons || [];
      throw new Error('Ozon не принял грузоместа: ' + (reasons.length ? reasons.join(', ') : 'нет operation_id'));
    }

    const cargoIdByKey: Record<string, string> = {};
    for (let attempt = 0; attempt < CARGO_POLL_ATTEMPTS; attempt++) {
      const info: any = await fetchOzonApi("/v2/cargoes/create/info",
        { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, { operation_id: operationId });
      const st = String(info?.status || '');
      if (st === 'SUCCESS') {
        const list = Array.isArray(info?.result?.cargoes) ? info.result.cargoes : [];
        // Порядок элементов у Ozon произвольный — сопоставляем только по key
        for (const c of list) {
          const k = String(c?.key || '').trim();
          const id = String(c?.value?.cargo_id ?? '').trim();
          if (k && id) cargoIdByKey[k] = id;
        }
        return cargoIdByKey;
      }
      if (st === 'FAILED') {
        const reasons = info?.errors?.error_reasons || [];
        throw new Error('Ozon отклонил грузоместа: ' + (reasons.length ? reasons.join(', ') : 'FAILED'));
      }
      await sleep(CARGO_POLL_DELAY_MS);
    }
    throw new Error('Ozon не ответил о создании грузомест за отведённое время');
  }

  // Этикетки грузомест генерируются только покластерно: один вызов на один supply_id
  async function createCargoLabelUrl(cab: any, supplyId: string): Promise<string> {
    const created: any = await fetchOzonApi("/v1/cargoes-label/create",
      { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, { supply_id: Number(supplyId) });

    const operationId = String(created?.operation_id || '');
    if (!operationId) {
      const reasons = created?.errors?.error_reasons || [];
      throw new Error('Ozon не принял запрос этикеток: ' + (reasons.length ? reasons.join(', ') : 'нет operation_id'));
    }

    for (let attempt = 0; attempt < CARGO_POLL_ATTEMPTS; attempt++) {
      const info: any = await fetchOzonApi("/v1/cargoes-label/get",
        { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, { operation_id: operationId });
      const st = String(info?.status || '');
      if (st === 'SUCCESS') {
        const url = String(info?.result?.file_url || '');
        if (!url) throw new Error('Ozon вернул успех без ссылки на этикетки');
        return url;
      }
      if (st === 'FAILED') {
        const reasons = info?.errors?.error_reasons || [];
        throw new Error('Ozon отклонил генерацию этикеток: ' + (reasons.length ? reasons.join(', ') : 'FAILED'));
      }
      await sleep(CARGO_POLL_DELAY_MS);
    }
    throw new Error('Ozon не отдал этикетки за отведённое время');
  }

  // Полный цикл после создания заявки: грузоместа, этикетки, файлы состава, чек-листы
  app.post("/api/ozon/supply/finalize", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const orderId = String(req.body?.orderId || '').trim();
      const clusters = Array.isArray(req.body?.clusters) ? req.body.clusters : [];
      const zones: Record<string, string> =
        (req.body?.zones && typeof req.body.zones === 'object') ? req.body.zones : {};

      if (!orderId || clusters.length === 0) {
        return res.status(400).json({ status: "error", message: "Не передан orderId или список кластеров" });
      }

      const keys = await fetchOzonKeys();
      if (!keys || !keys.cabinets || keys.cabinets.length === 0) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }
      const cab = requireCabinet(keys, req.body?.cabinet);
      if (!cab) {
        return res.status(400).json({ status: "error", stage: "no_cabinet", message: CABINET_REQUIRED_MESSAGE });
      }

      const warnings: string[] = [];
      const files: any[] = [];
      const supplyIds: string[] = [];

      // Шаг 1. Ждём, пока Ozon разложит заявку по поставкам-кластерам
      let orderNumber = '';
      let supplies: any[] = [];
      for (let attempt = 0; attempt < CARGO_POLL_ATTEMPTS; attempt++) {
        const detail: any = await fetchOzonApi("/v3/supply-order/get",
          { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, { order_ids: [orderId] });
        const orders = Array.isArray(detail?.orders) ? detail.orders : [];
        const order = orders.find((o: any) => String(o?.order_id) === orderId) || orders[0];
        if (order) {
          orderNumber = String(order?.order_number || '');
          supplies = Array.isArray(order?.supplies) ? order.supplies : [];
        }
        if (supplies.length > 0) break;
        await sleep(CARGO_POLL_DELAY_MS);
      }

      if (supplies.length === 0) {
        return res.status(502).json({
          status: "error",
          stage: "ozon_api",
          message: "Ozon не показал поставки заявки " + orderId + " за отведённое время"
        });
      }

      // Шаг 2. По каждому кластеру: грузоместа, файл состава, этикетки
      for (const cluster of clusters) {
        const clusterId = String(cluster?.clusterId || '').trim();
        const clusterName = String(cluster?.clusterName || '').trim() || clusterId;
        const boxes = Array.isArray(cluster?.boxes) ? cluster.boxes : [];

        const supply = supplies.find((s: any) => String(s?.macrolocal_cluster_id || '') === clusterId);
        if (!supply) {
          warnings.push('Кластер ' + clusterName + ': Ozon не создал поставку, грузоместа не отправлены');
          continue;
        }

        const supplyId = String(supply?.supply_id || '');
        if (!supplyId) {
          warnings.push('Кластер ' + clusterName + ': у поставки нет номера');
          continue;
        }
        supplyIds.push(supplyId);

        if (boxes.length === 0) {
          warnings.push('Кластер ' + clusterName + ': пустая раскладка, грузоместа не отправлены');
          continue;
        }

        let cargoIdByKey: Record<string, string> = {};
        try {
          cargoIdByKey = await createCargoesForSupply(cab, supplyId, boxes);
        } catch (e: any) {
          warnings.push('Кластер ' + clusterName + ': ' + (e?.message || String(e)));
          continue;
        }

        const missingKeys = boxes
          .map((b: any) => String(b?.key || ''))
          .filter((k: string) => !cargoIdByKey[k]);
        if (missingKeys.length > 0) {
          warnings.push('Кластер ' + clusterName + ': Ozon не вернул номера для коробок ' + missingKeys.join(', '));
        }

        try {
          files.push({
            kind: 'base64',
            name: sanitizeFileName(clusterName) + '.xlsx',
            content: buildCompositionXlsxBase64(boxes, cargoIdByKey, zones)
          });
        } catch (e: any) {
          warnings.push('Кластер ' + clusterName + ': не удалось собрать файл состава — ' + (e?.message || String(e)));
        }

        try {
          const labelUrl = await createCargoLabelUrl(cab, supplyId);
          files.push({
            kind: 'url',
            url: labelUrl,
            fallbackName: 'tags-cargoes-by-supply-' + supplyId
          });
        } catch (e: any) {
          warnings.push('Кластер ' + clusterName + ': этикетки грузомест не получены — ' + (e?.message || String(e)));
        }
      }

      // Шаг 3. Чек-листы готовности по всем поставкам заявки
      let checkLists: any[] = [];
      if (supplyIds.length > 0) {
        try {
          const rules: any = await fetchOzonApi("/v1/cargoes/rules/get",
            { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, { supply_ids: supplyIds });
          checkLists = Array.isArray(rules?.supply_check_lists) ? rules.supply_check_lists : [];
        } catch (e: any) {
          warnings.push('Не удалось получить чек-лист готовности: ' + (e?.message || String(e)));
        }
      }

      return res.json({
        status: "success",
        data: {
          orderId,
          orderNumber,
          folderName: 'Озон ' + (orderNumber || orderId),
          files,
          checkLists,
          warnings
        }
      });

    } catch (error: any) {
      console.error("Ozon supply finalize failed:", error?.message || error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.message || String(error)
      });
    }
  });

  // Только чтение: текущие грузоместа и чек-лист готовности поставок
  app.post("/api/ozon/cargoes/state", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const supplyIds = (Array.isArray(req.body?.supplyIds) ? req.body.supplyIds : [])
        .map((v: any) => String(v || '').trim())
        .filter((v: string) => v !== '');

      if (supplyIds.length === 0) {
        return res.status(400).json({ status: "error", message: "Не передан список supplyIds" });
      }

      const keys = await fetchOzonKeys();
      if (!keys || !keys.cabinets || keys.cabinets.length === 0) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }
      const cab = pickCabinet(keys, req.body?.cabinet);

      const cargoesData: any = await fetchOzonApi("/v1/cargoes/get",
        { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, { supply_ids: supplyIds });
      const rulesData: any = await fetchOzonApi("/v1/cargoes/rules/get",
        { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey }, { supply_ids: supplyIds });

      return res.json({
        status: "success",
        data: {
          supply: Array.isArray(cargoesData?.supply) ? cargoesData.supply : [],
          checkLists: Array.isArray(rulesData?.supply_check_lists) ? rulesData.supply_check_lists : []
        }
      });

    } catch (error: any) {
      console.error("Ozon cargoes state failed:", error?.message || error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.message || String(error)
      });
    }
  });

  function getMskWeekMonday(dateStr: string): string {
    const shifted = new Date(new Date(dateStr).getTime() + 3 * 60 * 60 * 1000);
    const day = shifted.getUTCDay();
    const diff = (day + 6) % 7;
    const monday = new Date(shifted.getTime() - diff * 24 * 60 * 60 * 1000);
    const yyyy = monday.getUTCFullYear();
    const mm = String(monday.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(monday.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  app.post("/api/ozon/sales", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      const devMode = req.body?.devMode === true;
      const modeParam = String(req.body?.mode || '').toLowerCase();
      const mode = modeParam === 'full' ? 'full' : 'recent';

      const keys = await fetchOzonKeys();
      if (!keys) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }

      const now = new Date();
      const nowIso = now.toISOString();

      let since: string;
      let to: string;
      let replacedWeeks: string[] = [];

      if (mode === 'recent') {
        const currentWeekMon = getMskWeekMonday(nowIso);
        const prev1WeekMon = getMskWeekMonday(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
        const prev2WeekMon = getMskWeekMonday(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString());
        replacedWeeks = [currentWeekMon, prev1WeekMon, prev2WeekMon];

        const earliestMon = prev2WeekMon;
        since = new Date(`${earliestMon}T00:00:00+03:00`).toISOString();
        to = nowIso;
      } else {
        since = new Date(now.getTime() - 380 * 24 * 60 * 60 * 1000).toISOString();
        to = nowIso;
      }

      const sinceMs = new Date(since).getTime();
      const toMs = new Date(to).getTime();
      const WINDOW_MS = 56 * 24 * 60 * 60 * 1000;

      const windows: Array<{ since: string; to: string }> = [];
      let windowStartMs = sinceMs;
      while (windowStartMs < toMs) {
        const windowEndMs = Math.min(windowStartMs + WINDOW_MS, toMs);
        windows.push({
          since: new Date(windowStartMs).toISOString(),
          to: new Date(windowEndMs).toISOString()
        });
        windowStartMs = windowEndMs;
      }

      const cabinets = keys.cabinets;
      const okCabinets: string[] = [];
      const allRows: any[] = [];
      const cabinetsReport: any[] = [];
      let firstErrorMessage = "";

      for (const cab of cabinets) {
        const name = cab.name;
        try {
          const cabKeys = { ozonClientId: cab.clientId, ozonApiKey: cab.apiKey };
          const whClusterMap = await loadWarehouseClusterMap(cabKeys);
          const salesMap = new Map<string, { week: string; offerId: string; cluster: string; qty: number }>();

          for (const win of windows) {
            let offset = 0;
            while (offset <= 19000) {
              const body = {
                dir: 'ASC',
                filter: {
                  since: win.since,
                  to: win.to
                },
                limit: 1000,
                offset,
                with: { analytics_data: true, financial_data: true }
              };

              const apiRes = await fetchOzonApi("/v2/posting/fbo/list", cabKeys, body);
              const postings = Array.isArray(apiRes?.result) ? apiRes.result : [];

              for (const posting of postings) {
                if (!posting || posting.status === 'cancelled') {
                  continue;
                }

                const week = getMskWeekMonday(posting.created_at);
                if (mode === 'recent' && !replacedWeeks.includes(week)) {
                  continue;
                }

                // Пункт 41. Кластер продажи — место доставки ПОКУПАТЕЛЮ, а не склад отгрузки.
                // Ozon отгружает заказ из соседнего кластера, если в кластере покупателя товара нет,
                // поэтому прежний источник analytics_data.warehouse_id записывал спрос чужому кластеру:
                // замер 10.08.2026 показал 14,9 % таких отправлений (80 из 538 за 4 полные недели).
                // Поле cluster_to заполнено у 100 % отправлений и приходит только при with.financial_data.
                const cluster = String(posting.financial_data?.cluster_to || '').trim() || 'Без кластера';

                const products = Array.isArray(posting.products) ? posting.products : [];
                for (const p of products) {
                  const offerId = String(p?.offer_id || '').trim();
                  if (!offerId) {
                    continue;
                  }
                  const quantity = Number(p?.quantity || 0);

                  const key = `${week}|${offerId}|${cluster}`;
                  const existing = salesMap.get(key);
                  if (existing) {
                    existing.qty += quantity;
                  } else {
                    salesMap.set(key, { week, offerId, cluster, qty: quantity });
                  }
                }
              }

              if (postings.length < 1000) {
                break;
              }
              offset += 1000;
            }
          }

          const cabRows: any[] = [];
          for (const item of salesMap.values()) {
            cabRows.push({
              cabinet: name,
              week: item.week,
              offerId: item.offerId,
              cluster: item.cluster,
              qty: item.qty
            });
          }

          // Пункт 41, этап B. Имена кластеров приходят от Ozon строкой и сопоставляются
          // со справочником по названию. Незнакомое имя не проглатывается молча:
          // это либо переименование кластера у Ozon, либо кластер СНГ вне справочника
          // (Беларусь, Алматы, Астана) — оба случая надо видеть.
          const knownClusterNames = new Set(whClusterMap.values());
          const unknownClusters: Record<string, number> = {};
          for (const item of salesMap.values()) {
            if (item.cluster === 'Без кластера') continue;
            if (knownClusterNames.has(item.cluster)) continue;
            unknownClusters[item.cluster] = (unknownClusters[item.cluster] || 0) + item.qty;
          }
          const unknownNames = Object.keys(unknownClusters).sort();
          if (unknownNames.length > 0) {
            const detail = unknownNames.map((n) => `${n}=${unknownClusters[n]}`).join('; ');
            console.warn(`SALESGEO cabinet=${name} unknownClusters=${unknownNames.length} ${detail}`);
          }

          okCabinets.push(name);
          allRows.push(...cabRows);
          cabinetsReport.push({ name, ok: true, rows: cabRows.length, unknownClusters: unknownNames });

        } catch (err: any) {
          console.error(`Ошибка при опросе продаж кабинета Ozon ${name}:`, err);
          let message = err.message || String(err);
          if (err.httpStatus === 403 || message.includes("403") || message.toLowerCase().includes("forbidden")) {
            message = "Кабинет пропущен: нет доступа (проверьте ключи или подписку Premium)";
          }
          if (!firstErrorMessage) {
            firstErrorMessage = message;
          }
          cabinetsReport.push({ name, ok: false, message });
        }
      }

      if (okCabinets.length === 0) {
        return res.status(502).json({
          status: "error",
          stage: "ozon_api",
          message: firstErrorMessage || "Не удалось получить продажи ни по одному кабинету Ozon"
        });
      }

      const gasUrl = process.env.GAS_URL;
      if (!gasUrl) {
        return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
      }

      const gasResponse2 = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveOzonSales",
          sessionToken: token,
          ...(devMode ? { devMode: true } : {}),
          data: {
            mode,
            replacedWeeks: mode === 'recent' ? replacedWeeks : [],
            okCabinets,
            rows: allRows
          }
        })
      });

      const rawText2 = await gasResponse2.text();
      let gasData: any;
      try {
        gasData = JSON.parse(rawText2);
      } catch {
        return res.status(502).json({ status: "error", message: "GAS returned non-JSON response when saving Ozon sales" });
      }
      if (gasData.status !== "success") {
        return res.status(500).json({ status: "error", message: gasData.message || "Failed to save Ozon sales in GAS" });
      }

      return res.json({
        status: "success",
        data: {
          savedRows: gasData.data?.savedRows || 0,
          deletedRows: gasData.data?.deletedRows || 0,
          cabinets: cabinetsReport
        }
      });

    } catch (error: any) {
      console.error("Ozon sales endpoint failed:", error);
      return res.status(error.httpStatus || 500).json({
        status: "error",
        stage: error.stage || "ozon_api",
        httpStatus: error.httpStatus || 500,
        message: error.message || String(error)
      });
    }
  });

  // API Endpoint for Gemini Invoice Parsing
  app.post("/api/parse-invoice", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token || !(await verifyGasSession(token))) {
        return res.status(401).json({ status: "error", message: "Missing or invalid sessionToken" });
      }

      // Receive full SKU list to build mapping dictionary and table
      const { text, skus, opType, modelName, feedback, customPrompt } = req.body;
      
      const apiKey = await getApiKey();
      
      if (!apiKey) {
        const err = new Error("GEMINI_API_KEY is not configured on the server and no custom key available.");
        (err as any).stage = "no_api_key";
        throw err;
      }

      const ai = new GoogleGenAI({ apiKey });
      const model = modelName || "gemini-flash-latest";

      // Build mapping dictionaries to embed in the prompt
      const ozonBarcodeMap: Record<string, string> = {};
      const wbBarcodeMap: Record<string, string> = {};
      const referenceArticles = new Set<string>();

      if (Array.isArray(skus)) {
        skus.forEach((sku: any) => {
          const article = String(sku.sku || '').trim();
          if (!article) return;
          referenceArticles.add(article);

          // Normalize barcodes: remove spaces, convert to string
          const ozon = String(sku.ozonBarcode || '').replace(/\s/g, '').trim();
          const wb = String(sku.wbBarcode || '').replace(/\s/g, '').trim();

          if (ozon) ozonBarcodeMap[ozon] = article;
          if (wb) wbBarcodeMap[wb] = article;
        });
      }

      const ozonDictStr = JSON.stringify(ozonBarcodeMap, null, 2);
      const wbDictStr = JSON.stringify(wbBarcodeMap, null, 2);

      const mappingDictionariesText = `СЛОВАРЬ БАРКОДОВ OZON (баркод → артикул):
${ozonDictStr}

СЛОВАРЬ БАРКОДОВ WILDBERRIES (баркод → артикул):
${wbDictStr}`;

      let prompt = customPrompt || `Ты — система распознавания накладных для складского учёта.
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

      if (prompt.includes("{{MAPPING_DICTIONARIES}}")) {
        prompt = prompt.replace(/\{\{MAPPING_DICTIONARIES\}\}/g, mappingDictionariesText);
      } else {
        prompt = prompt.replace(/\${mappingTableText}/g, mappingDictionariesText); // For backwards compatibility with old custom prompts
      }

      const referenceArticlesStr = Array.from(referenceArticles).join(", ");
      if (prompt.includes("{{REFERENCE_ARTICLES}}")) {
        prompt = prompt.replace(/\{\{REFERENCE_ARTICLES\}\}/g, referenceArticlesStr);
      } else {
        prompt += `\n\nЭТАЛОННЫЙ СПИСОК АРТИКУЛОВ ДЛЯ СОПОСТАВЛЕНИЯ: ${referenceArticlesStr}`;
      }

      if (prompt.includes("{{OP_TYPE}}")) {
        prompt = prompt.replace(/\{\{OP_TYPE\}\}/g, opType || 'Неизвестная операция');
      }

      if (prompt.includes("{{TEXT}}")) {
        prompt = prompt.replace(/\{\{TEXT\}\}/g, text);
      } else {
        prompt += `\n\nТекст накладной:\n${text}`;
      }

      const feedbackStr = feedback ? `ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${feedback}\n════════════════════════════════════════` : '';
      if (prompt.includes("{{FEEDBACK}}")) {
        prompt = prompt.replace(/\{\{FEEDBACK\}\}/g, feedbackStr);
      } else if (feedback) {
        prompt += `\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ОТ ПОЛЬЗОВАТЕЛЯ: ${feedback}`;
      }

      let result: any;
      let retries = 5;
      while (retries > 0) {
        try {
          result = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        article: { type: Type.STRING, description: "Артикул из эталонного списка или UNKNOWN" },
                        quantity: { type: Type.NUMBER, description: "Количество" },
                        price: { type: Type.NUMBER, description: "Цена за единицу (только для прихода, иначе 0)" }
                      },
                      required: ["article", "quantity", "price"]
                    }
                  },
                  detectedMarketplace: {
                    type: Type.STRING,
                    description: "Ozon, Wildberries или unknown"
                  }
                },
                required: ["items", "detectedMarketplace"]
              }
            }
          });
          break; // success
        } catch (error: any) {
          retries--;
          const errorMessage = error?.message || String(error);
          console.error(`Gemini Error (retries left: ${retries}):`, errorMessage);
          
          const isTransient = errorMessage.includes("503") || 
                              errorMessage.includes("UNAVAILABLE") || 
                              errorMessage.includes("429") || 
                              errorMessage.includes("high demand") ||
                              errorMessage.includes("Too Many Requests");
                              
          if (retries === 0 || !isTransient) {
            throw error;
          }
          
          const delayTimeout = 3000 * (5 - retries); // 3s, 6s, 9s, 12s
          console.log(`Waiting for ${delayTimeout}ms before retrying...`);
          await new Promise(r => setTimeout(r, delayTimeout));
        }
      }

      let parsed;
      try {
        parsed = JSON.parse(result?.text || "{}");
      } catch (parseErr: any) {
        const err = new Error("Failed to parse Gemini response as JSON: " + parseErr.message);
        (err as any).stage = "json_parse";
        (err as any).rawError = (result?.text || "").substring(0, 500);
        throw err;
      }

      if (!parsed.items) {
        parsed.items = [];
      }
      res.json({ status: "success", data: parsed });

    } catch (error: any) {
      console.error("Gemini Error:", error);
      
      const message = error.message || String(error);
      const model = req.body?.modelName || "gemini-flash-latest";
      const stage = error.stage || "gemini_request";
      let httpStatus: number | undefined = undefined;
      const rawError = error.rawError;

      if (stage === "gemini_request") {
        const statusMatch = message.match(/\b(404|429|503)\b/);
        if (statusMatch) {
          httpStatus = parseInt(statusMatch[1], 10);
        }
      }

      res.status(500).json({ 
        status: "error", 
        message,
        details: {
          stage,
          model,
          httpStatus,
          rawError
        }
      });
    }
  });

  // Метка версии прокси для диагностики развёртывания. Секретов не отдаёт.
  app.get("/api/version", (req, res) => {
    // Имя редакции Cloud Run подставляет сам в переменную окружения K_REVISION,
    // а время запуска считается от старта процесса. Вместе они однозначно отвечают
    // на вопрос «какой код сейчас живой», без ручного обновления строки версии.
    const startedAt = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
    res.json({
      status: "success",
      version: "2026-07-31-cargoes",
      revision: process.env.K_REVISION || "local",
      startedAt,
      uptimeSec: Math.round(process.uptime()),
      features: {
        clusterIdInShipments: true,
        cargoesAndDocs: true,
        salesClusterTo: true,
        salesGeoLogging: true
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  console.log("Прогрев API ключа...");
  getApiKey().then(key => {
    if (key) console.log("API ключ загружен в кэш");
    else console.warn("API ключ не найден — проверьте .env или настройки GAS");
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
