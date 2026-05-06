import { SKUItem } from '../types';

export async function parseInvoiceWithGemini(
  text: string, 
  skus: any[], 
  opType: string,
  modelName: string = "gemini-3-flash-preview",
  feedback: string = "",
  customPrompt: string = ""
) {
  const response = await fetch("/api/parse-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, skus, opType, modelName, feedback, customPrompt })
  });

  const result = await response.json();
  if (result.status === "error") {
    throw new Error(result.message);
  }
  return result.data || { items: [], detectedMarketplace: "unknown" };
}
