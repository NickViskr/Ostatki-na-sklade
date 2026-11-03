# Ticket 04 — design contract (orchestrator, 2026-11-03)

Owner's answers 2026-11-03: only an admin deletes (to the Drive trash); the folder lives in
«Мой диск / Разработка / Складской учет»; the UI is a «Файлы недели» block shown when a concrete week is chosen
in the «Неделя» filter of «Поставки Озон». Orchestrator defaults: any logged-in user lists, uploads and
downloads; one file per upload, ≤ 10 MB (10 485 760 bytes decoded); same names are kept side by side.

Correction of spec «Facts»: `Code.gs` ALREADY uses DriveApp (`saveSupplyDocsToDrive`, `backupDatabase`,
`createOrUpdateTestDatabase`), so the Drive scope is already granted — no re-authorization is expected.

## Part A — Code.gs actions (+ stand checks)

Folder resolution `getWeekFilesRootFolder(create)`:
- Script Property `weekFiles_folderId`, or `weekFiles_folderId_test` when `_devModeSpreadsheet` is set.
- Property set → `DriveApp.getFolderById(id)`.
- Property empty and `create` → walk `DriveApp.getRootFolder()` → child folder named exactly `Разработка` →
  child `Складской учет` (first non-trashed match); get-or-create child `Файлы недель` (production) or
  `Файлы недель (тест)` (dev mode); store its id in the property. Path missing → error
  «Не найдена папка «Мой диск / Разработка / Складской учет» на Google Диске».
- Property empty and not `create` → null (listing never creates folders).
- Week subfolder: named exactly as the week (`2026-W44`), get-or-create on upload only.
- No folder id in any committed file.

Week validation (every action): `/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/` (same as `setExternalShipmentWeek`),
else error «Неверная неделя».

Actions (doPost `payload.data`; all need a session as every non-public action does):
- `listWeekFiles { week }` → `[{ id, name, size, mimeType, uploadedBy, uploadedAt }]`, non-trashed only,
  newest first; `uploadedAt` ISO text from the file's creation date; `uploadedBy` from the description written
  at upload. No folder → `[]`.
- `uploadWeekFile { week, name, mimeType, base64 }` → the same object for the new file. Decoded bytes empty →
  «Файл пустой»; > 10 485 760 → «Файл больше 10 МБ». Name trimmed, sanitized like `sanitizeDriveName`,
  required («Не передано имя файла»). Description stores the uploader's login.
- `getWeekFile { week, fileId }` → `{ name, mimeType, base64 }`. The file must be non-trashed and have that
  week's folder as a parent, else «Файл не найден в этой неделе» (no reading arbitrary Drive files by id).
- `deleteWeekFile { week, fileId }` → `assertAdmin`; same parent check; `setTrashed(true)`.
- None of them is in `DEV_MODE_EXCLUDED_ACTIONS`; dev mode follows `_devModeSpreadsheet`.

## Part B — proxy (`server.ts`)

- `POST /api/week-files/upload`: its own `express.json({ limit: '15mb' })` (10 MB as base64 ≈ 13.4 MB); the
  global `express.json({ limit: '1mb' })` is skipped for exactly this path and stays 1 MB everywhere else.
- No `sessionToken` → 401. Decoded size > 10 485 760 → 413 `{ status:'error', message:'Файл больше 10 МБ' }`
  without calling GAS; a body over the parser limit → the same JSON 413 message (not an HTML page).
- Forwards `uploadWeekFile` with the caller's token and devMode; returns GAS's answer as `/api/gas` does.
- `listWeekFiles`, `getWeekFile`, `deleteWeekFile` go through `/api/gas`; `getWeekFile` and `listWeekFiles`
  are never served from the read cache stale after an upload/delete (no TTL entries, or invalidated).

## Part C — store + «Поставки Озон»

- Store: `listWeekFiles(week)`, `uploadWeekFile(week, file)` (client-side 10 MB check first, base64, POST
  `/api/week-files/upload` with `{ sessionToken, devMode, data: { week, name, mimeType, base64 } }`),
  `downloadWeekFile(week, fileId)` (base64 → Blob → save under the original name), `deleteWeekFile(week, fileId)`.
  Request-body tests in the style of `src/store/setOzonAutoWriteOff.test.ts`: fields under `data`.
- `OzonSuppliesTab.tsx`: when the «Неделя» filter is a concrete week, a «Файлы недели» block above the list:
  files (name, size, who, when), «Загрузить файл», «Скачать», «Удалить» (admin only, confirm). Errors as toasts.
