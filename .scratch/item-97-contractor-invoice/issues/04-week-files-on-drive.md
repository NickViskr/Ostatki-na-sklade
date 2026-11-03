# 04: Files of the week on Google Drive

**What to build:** plan T3. In «Поставки Озон» a week holds files (the invoice PDF and anything else):
upload, list, open/download, delete (who may delete — ask the owner). Stored in a Drive folder whose id lives
in Script Properties (never in code; dev mode uses its own folder). Upload and download go through the proxy;
the upload route gets its own body limit (≤ 10 MB per file) — the global `express.json` limit stays 1 MB.
DriveApp adds an OAuth scope: the owner re-authorizes once right after the deploy (ticket 09), otherwise every
trigger fails and mails him. Spec: `../spec.md` (decision 10). Cosmetic tier except the access rules.

**Blocked by:** 02 (the week).

**Status:** done (live 2026-11-03: Code.gs @214 + Cloud Run `sklad-00118-lkj`)

- [x] Downloaded file equals the uploaded one byte for byte (sha256); 11 MB refused with a clear message
- [x] No session → refused; the folder id never appears in a committed file
- [x] Dev mode writes to the test folder only

## Comments

- 2026-11-03 (orchestrator): built in three parts (`bba2fc2` Code.gs, `178c6ec` proxy, `5f660c7` UI) per
  `../ticket-04-design.md`. Owner: only an admin deletes (Drive trash); folder created by the app inside
  «Мой диск / Разработка / Складской учет». The spec's «no Drive scope» fact was outdated — Code.gs already used DriveApp,
  so no re-authorization was needed. Checks proven on the stand (sha256 round trip, 10 MB boundary, no session, dev folder);
  owner's live upload/download check pending.
