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

  app.use(express.json());

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

  // API Endpoint to proxy GAS requests
  app.post("/api/gas", async (req, res) => {
    try {
      const gasUrl = process.env.GAS_URL;
      if (!gasUrl) {
        return res.status(500).json({ status: "error", message: "GAS_URL is not configured on the server" });
      }

      const action = req.body?.action;
      const token = req.body?.sessionToken;

      // Не пропускаем серверные action через клиентский прокси
      const forbiddenActions = ['getGeminiKey'];
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

      const gasResponse = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body)
      });
      
      const data = await gasResponse.json();

      // Если GAS ответил успехом для сессии, сохраняем токен в кэш
      if (data.status === "success") {
        if (token) cacheToken(token);
        if (isPublic && data.data?.sessionToken) cacheToken(data.data.sessionToken);
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
      const orgKey = await fetchOrgApiKey();
      const apiKey = clientApiKey || orgKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
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

  // API Endpoint for Gemini Invoice Parsing
  app.post("/api/parse-invoice", async (req, res) => {
    try {
      const { text, referenceArticles, modelName, feedback, customPrompt } = req.body;
      
      const orgKey = await fetchOrgApiKey();
      const apiKey = orgKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(500).json({ 
          status: "error", 
          message: "GEMINI_API_KEY is not configured on the server and no custom key available." 
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const model = modelName || "gemini-1.5-flash";

      let prompt = customPrompt || `
        Извлеки номенклатуру из текста накладной. 
        ГЛАВНОЕ: Сопоставь извлеченные товары с эталонным списком артикулов: {{REFERENCE_ARTICLES}}.
        Если в тексте указан артикул напрямую, используй его.
        Если артикула нет, но название похоже на товар из списка, выбери наиболее подходящий артикул. 
        Если совпадений нет совсем, укажи "UNKNOWN".
        
        Для каждого товара извлеки:
        1. Артикул (из списка или UNKNOWN)
        2. Количество (число, если не указано, используй 1)
        3. Цена (число, если указана, иначе 0)

        Верни строгий JSON массив объектов.
      `;

      if (prompt.includes("{{REFERENCE_ARTICLES}}")) {
        prompt = prompt.replace(/\{\{REFERENCE_ARTICLES\}\}/g, referenceArticles.join(", "));
      } else {
        prompt += `\n\nЭТАЛОННЫЙ СПИСОК АРТИКУЛОВ ДЛЯ СОПОСТАВЛЕНИЯ: ${referenceArticles.join(", ")}`;
      }

      prompt += `
        
        ${feedback ? `ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ОТ ПОЛЬЗОВАТЕЛЯ: ${feedback}` : ""}

        Текст накладной:
        ${text}
      `;

      const result = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
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
          }
        }
      });

      const parsed = JSON.parse(result.text || "[]");
      res.json({ status: "success", data: parsed });

    } catch (error) {
      console.error("Gemini Error:", error);
      res.status(500).json({ 
        status: "error", 
        message: (error as Error).message 
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
