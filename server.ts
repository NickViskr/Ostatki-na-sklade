import express from "express";
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

  // API Endpoint for Gemini Invoice Parsing
  app.post("/api/parse-invoice", async (req, res) => {
    try {
      const { text, referenceArticles, modelName, feedback, apiKey: clientApiKey, customPrompt } = req.body;
      
      const apiKey = clientApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(500).json({ 
          status: "error", 
          message: "GEMINI_API_KEY is not configured on the server and no client key provided." 
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const model = modelName || "gemini-3-flash-preview";

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
