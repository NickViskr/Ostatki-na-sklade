# YANDEX_MARKET_API.md — Yandex Market Partner API: where the docs and tools are

> Reference sheet collected 2026-11-03 (research only, no API method was called, no key used).
> Purpose: starting point for a future Yandex Market integration. Nothing here is implemented yet.

## 1. Official sources (source of truth)

| What | Where | Notes |
|---|---|---|
| Seller API documentation (RU) | https://dev-market-partner-api.docs-viewer.yandex.ru/ru/ | Opens without VPN. Also mirrored at yandex.ru/dev/market/partner-api/doc/ru/ |
| OpenAPI spec of the Partner API | https://github.com/yandex-market/yandex-market-partner-api (folder `openapi/`) | Official, last push 2026-10-29, 40 stars. Use it as the contract for code |
| OpenAPI spec of notification API | https://github.com/yandex-market/yandex-market-notification-api | Optional: Market pushes order / return / cancel events to our URL |
| How to connect the spec | docs page `ru/concepts/openapi` | Linked from the docs home page |
| Auth | docs page «Создание и использование API-Key-токена» | API-Key token issued in the seller cabinet (Settings → API) |

Sections of the docs (left menu): cabinets and shops, products, stocks and turnover, prices,
promos, orders, FBS shipments, FBS/DBS labels, FBY/LaaS supply requests, DBS delivery,
non-redemptions and returns, reports and documents, reviews, questions and answers, sales
boost, quality index, chats, warehouses, reference data, deprecated methods; plus
API-notifications and a 1C module. The docs also have «Пошаговые инструкции» (step-by-step
guides) — check them first for any concrete task.

API access is free of charge.

## 2. Third-party MCP servers (no official MCP from Yandex exists)

| Repo | State (2026-11-03) | Notes |
|---|---|---|
| https://github.com/ilyautov/yandex-market-mcp-ru | MIT, last push 2026-09-14, 3 stars | 165 methods: 109 read, 49 write, 7 irreversible. Install via `uvx`; key in env `YANDEX_MARKET_API_KEY`. PyPI: https://pypi.org/project/yandex-market-mcp-ru/ |
| https://github.com/dontsovcmc/mcp-server-yandex-market-seller | no license, last push 2026-05-10, 1 star | 131 operations, CLI + Pydantic models, token + campaign id + business id in env |

Other repos seen (not MCP, not reviewed): `mkrvas/yandex-market-api-reference` (unofficial
reference as a Claude skill, 165 methods), `MissiaL/yandex-market-api` (skill with the official
spec, 159 ops). `A1-x-Tech/mcp-yandex-merchants` is for the Yandex Merchant feed API, NOT the
Partner API — not suitable.

Both MCP servers are tiny, unaudited third-party code that would hold our API key. Their code
has NOT been read yet.

## 3. Recommended approach (proposed, not yet approved by the owner)

A. Build the real integration directly on the official OpenAPI spec (same way as Ozon), keeping
   the key in Script Properties / `.env`, never in committed files (the repo is PUBLIC).
B. For quick method testing only: read the MCP code first, then use it with a SEPARATE
   read-only API key, so write and irreversible methods cannot fire.

## 4. Open questions

- Which scope is integrated first: stocks, orders, prices or supplies (FBY/FBS)?
- Where the key lives: Script Property (Apps Script) vs Cloud Run secret.
- Whether the owner wants the third-party MCP at all, after its code is reviewed.
