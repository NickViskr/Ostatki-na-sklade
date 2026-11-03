// Item 97 ticket 05: local check of REAL contractor invoices (never commit the output).
// Reads each PDF, sends it to Gemini with the production prompt, normalises and runs the app's checks.
// Prints only check results, totals and line counts — no INN, no bank details.
// Run from repo/: GEMINI_API_KEY=... npx vite-node .scratch/item-97-contractor-invoice/real-invoice-check.ts <pdf>...
import { readFileSync } from 'fs';
import { basename } from 'path';
import { GoogleGenAI } from '@google/genai';
import { contractorInvoicePrompt, contractorInvoiceNormalise, checkContractorInvoice } from '../../src/lib/contractorInvoice';
import { serviceWeekOfInvoice } from '../../src/lib/isoWeek';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
const ai = new GoogleGenAI({ apiKey });

for (const path of process.argv.slice(2)) {
  const result = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: 'application/pdf', data: readFileSync(path).toString('base64') } },
      { text: contractorInvoicePrompt() }
    ] }],
    config: { responseMimeType: 'application/json' }
  });
  const draft = contractorInvoiceNormalise(JSON.parse(result.text || '{}'));
  if (!draft) { console.log(`${basename(path)}: AI answer not usable`); continue; }
  const c = checkContractorInvoice(draft);
  const h = draft.header;
  console.log(`${basename(path)}: ${c.ok ? 'OK' : 'FAIL'} | № ${h.number} от ${h.date} → неделя ${serviceWeekOfInvoice(h.date)} | всего ${h.total} | НДС ${h.vat} | строк ${draft.lines.length} (в счёте ${h.itemCount || '—'})`);
  for (const l of draft.lines) console.log(`   ${l.name} | ${l.qty} ${l.unit} × ${l.price} = ${l.sum}`);
  for (const e of [...c.headerErrors, ...c.lineErrors.map((x) => x.message), ...c.notes]) console.log(`   ! ${e}`);
}
