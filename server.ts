import express from "express";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

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
  const RATE_LIMIT     = 60;        // 60 запросов в минуту с одного IP

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
  let cachedOzonKeys: { value: { ozonClientId: string; ozonApiKey: string }; expiresAt: number } | null = null;
  const OZON_KEY_TTL_MS = 60 * 60 * 1000; // 1 час

  async function fetchOzonKeys(): Promise<{ ozonClientId: string; ozonApiKey: string } | null> {
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
       const gasData = await gasResponse.json();
       if (gasData.status === "success" && gasData.data?.ozonClientId && gasData.data?.ozonApiKey) {
         const keys = {
           ozonClientId: gasData.data.ozonClientId,
           ozonApiKey: gasData.data.ozonApiKey
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
       const gasData = await gasResponse.json();
       if (gasData.status === "success" && gasData.data?.geminiKey) {
         return gasData.data.geminiKey;
       }
    } catch (e) {
       console.error("Failed to fetch org key Server-to-Server", e);
    }
    return null;
  }

  
  // ── Server-side GAS Response Cache ─────────────────────────────────────
  const gasCache = new Map<string, { data: any; cachedAt: number }>();
  const GAS_CACHE_TTL_MS = 30_000; // 30 секунд

  function isCacheable(action: string): boolean {
    return ['getInitialData', 'getTransactions', 'getSkus', 'getServices', 'getUsers', 'getArchivedItems'].includes(action);
  }

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
      
      if (action && isCacheable(action) && token && isTokenCached(token)) {
        const cached = gasCache.get(cacheKey);
        if (cached && Date.now() - cached.cachedAt < GAS_CACHE_TTL_MS) {
          return res.json(cached.data);
        }
      }

      if (action && !isCacheable(action) && action !== 'verifySession' && action !== 'login' && action !== 'getGlobalSettings') {
        gasCache.clear();
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
        // Опционально: если токена нет в кэше, он будет проверен в GAS. Если он в кэше — круто.
        // Если фейковый токен спамит и его нет в кэше, он пойдет в GAS, но мы ограничим IP через rate-limit
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      let gasResponse;
      try {
        gasResponse = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          return res.status(504).json({ status: "error", message: "GAS request timeout (30s)" });
        }
        throw err;
      }
      
      let data;
      const rawText = await gasResponse.text();
      try {
        data = JSON.parse(rawText);
      } catch (parseErr: any) {
        console.error("GAS returned non-JSON response:", rawText.substring(0, 1000));
        return res.status(502).json({
          status: "error",
          message: `Google Apps Script returned a non-JSON response. Raw response snippet: ${rawText.substring(0, 300)}`
        });
      }

      
      // Если GAS ответил успехом для сессии, сохраняем токен в кэш
      if (data.status === "success") {
        if (action && isCacheable(action)) {
          gasCache.set(cacheKey, { data, cachedAt: Date.now() });
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

  app.post("/api/ozon/check", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token) {
        return res.status(401).json({ status: "error", message: "Missing sessionToken" });
      }

      if (!isTokenCached(token)) {
        const gasUrl = process.env.GAS_URL;
        if (!gasUrl) {
          return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
        }
        try {
          const gasResponse = await fetch(gasUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: 'verifySession', sessionToken: token })
          });
          const gasData = await gasResponse.json();
          if (gasData.status === "success") {
            cacheToken(token);
          } else {
            return res.status(401).json({ status: "error", message: "Invalid sessionToken" });
          }
        } catch (e: any) {
          console.error("Session verification failed:", e);
          return res.status(401).json({ status: "error", message: "Session verification failed: " + e.message });
        }
      }

      const devMode = req.body?.devMode === true;

      // Get keys
      const keys = await fetchOzonKeys();
      if (!keys) {
        return res.status(400).json({ status: "error", stage: "no_keys", message: "Ключи Ozon не настроены" });
      }

      // Step 2. Active orders list
      const activeOrderIdsSet = new Set<string>();
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
              "REPORT_REJECTED",
              "OVERDUE"
            ]
          },
          limit: 100,
          sort_by: "ORDER_CREATION",
          sort_dir: "DESC"
        };
        if (lastId) {
          body.last_id = lastId;
        }
        
        const listData = await fetchOzonApi("/v3/supply-order/list", keys, body);
        const orderIds = listData.order_ids || [];
        for (const oid of orderIds) {
          if (oid !== undefined && oid !== null) {
            activeOrderIdsSet.add(String(oid));
          }
        }
        
        lastId = listData.last_id || "";
        if (!lastId) {
          break;
        }
        pageCount++;
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
      const gasResult1 = await gasResponse1.json();
      if (gasResult1.status !== "success") {
        return res.status(500).json({ status: "error", message: gasResult1.message || "Failed to get external shipments from GAS" });
      }
      
      const existingShipments = gasResult1.data || [];
      const existingByPostingId = new Map<string, { status: string; ozonStatus: string }>();
      
      for (const s of existingShipments) {
        const postingIdVal = String(s.postingId || '').trim();
        if (postingIdVal) {
          existingByPostingId.set(postingIdVal, {
            status: String(s.status || '').trim(),
            ozonStatus: String(s.ozonStatus || '').trim()
          });
        }
      }
      
      for (const s of existingShipments) {
        const oId = String(s.orderId || '').trim();
        const oStatus = String(s.ozonStatus || '').trim();
        if (oId && !["COMPLETED", "CANCELLED", "REJECTED_AT_SUPPLY_WAREHOUSE"].includes(oStatus)) {
          activeOrderIdsSet.add(oId);
        }
      }
      
      const allOrderIds = Array.from(activeOrderIdsSet);

      // Step 4. Details of orders
      const ordersDetailsList: any[] = [];
      const batchSize = 50;
      for (let i = 0; i < allOrderIds.length; i += batchSize) {
        const batchIds = allOrderIds.slice(i, i + batchSize);
        if (batchIds.length === 0) continue;
        
        const detailResponse = await fetchOzonApi("/v3/supply-order/get", keys, { order_ids: batchIds });
        const orders = detailResponse.orders || [];
        for (const order of orders) {
          if (order) {
            ordersDetailsList.push(order);
          }
        }
      }

      // Step 5. Forming records on supply
      const finalShipments: any[] = [];
      
      for (const order of ordersDetailsList) {
        const orderId = String(order.order_id);
        const orderNumber = String(order.order_number || '');
        const ozonStatusDate = String(order.state_updated_date || '');
        const dropOffWarehouse = order.drop_off_warehouse?.name || '';
        
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
          const storageWarehouse = supply.storage_warehouse?.name
            ? supply.storage_warehouse.name
            : (supply.macrolocal_cluster_id !== null && supply.macrolocal_cluster_id !== undefined && String(supply.macrolocal_cluster_id).trim() !== '')
              ? `Кластер ${supply.macrolocal_cluster_id}`
              : '';
          const bundleId = supply.bundle_id || '';
          
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
            bundleId
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
          shouldFetchBundle = true;
        } else if (existInfo.status === 'new') {
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
            
            const bundleResult = await fetchOzonApi("/v1/supply-order/bundle", keys, body);
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
        
        const itemsJSON = shouldFetchBundle ? JSON.stringify(items) : "";
        
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
          timeslot: s.timeslot
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

      const gasData = await gasResponse2.json();
      if (gasData.status !== "success") {
        return res.status(500).json({ status: "error", message: gasData.message || "Failed to save external shipments in GAS" });
      }

      // Step 8. Response to client
      return res.json({
        status: "success",
        data: {
          found: shipmentsForGas.length,
          added: gasData.data?.addedCount || 0,
          updated: gasData.data?.updatedCount || 0
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

  // API Endpoint for Gemini Invoice Parsing
  app.post("/api/parse-invoice", async (req, res) => {
    try {
      const token = req.body?.sessionToken;
      if (!token) {
        return res.status(401).json({ status: "error", message: "Missing sessionToken" });
      }

      if (!isTokenCached(token)) {
        const gasUrl = process.env.GAS_URL;
        if (!gasUrl) {
          return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
        }
        try {
          const gasResponse = await fetch(gasUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: 'verifySession', sessionToken: token })
          });
          const gasData = await gasResponse.json();
          if (gasData.status === "success") {
            cacheToken(token);
          } else {
            return res.status(401).json({ status: "error", message: "Invalid sessionToken" });
          }
        } catch (e: any) {
          console.error("Session verification failed:", e);
          return res.status(401).json({ status: "error", message: "Session verification failed: " + e.message });
        }
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
