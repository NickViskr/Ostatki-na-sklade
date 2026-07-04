import { SKUItem } from '../types';

export async function parseInvoiceWithGemini(
  sessionToken: string,
  text: string, 
  skus: any[], 
  opType: string,
  modelName: string = "gemini-flash-latest",
  feedback: string = "",
  customPrompt: string = ""
) {
  const response = await fetch("/api/parse-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, text, skus, opType, modelName, feedback, customPrompt })
  });

  const result = await response.json();
  if (result.status === "error") {
    const error = new Error(result.message);
    (error as any).details = result.details;
    throw error;
  }
  return result.data || { items: [], detectedMarketplace: "unknown" };
}
