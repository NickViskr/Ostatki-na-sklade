# 04: Files of the week on Google Drive

**What to build:** plan T3. In «Поставки Озон» a week holds files (the invoice PDF and anything else):
upload, list, open/download, delete (who may delete — ask the owner). Stored in a Drive folder whose id lives
in Script Properties (never in code; dev mode uses its own folder). Upload and download go through the proxy;
the upload route gets its own body limit (≤ 10 MB per file) — the global `express.json` limit stays 1 MB.
DriveApp adds an OAuth scope: the owner re-authorizes once right after the deploy (ticket 09), otherwise every
trigger fails and mails him. Spec: `../spec.md` (decision 10). Cosmetic tier except the access rules.

**Blocked by:** 02 (the week).

**Status:** ready-for-agent

- [ ] Downloaded file equals the uploaded one byte for byte (sha256); 11 MB refused with a clear message
- [ ] No session → refused; the folder id never appears in a committed file
- [ ] Dev mode writes to the test folder only

## Comments
