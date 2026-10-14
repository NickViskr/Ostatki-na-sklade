# 05: Browser — the send step after a save, toasts with buttons, the KAN marker in «История»

**What to build:** after a successful save that can move the Ozon cost (a shipment to an Ozon
cabinet, a pencil edit / delete / restore of one, «Вся отгрузка», a receipt price edit) the browser
calls the sender of ticket 03 as a separate step and shows: green «КАН принял себестоимость:
Артикул — 233,67 ₽ с 13.10» (one line per group), or red «КАН не принял: <причина>» with buttons
«Отправить снова» and «Отправлю сам». «Отправлю сам» builds the CSV with the existing
`kanCostExport.ts` (collapse + BOM + «;»), downloads it, and calls ticket 04's switch-to-manual
action — it must NOT call `markOzonCostExported`. «История» shows on each Ozon shipment row a marker
from the journal status (✓ КАН accepted / ✗ red error with the two buttons / ⏳ manual, waiting)
for the user who saved the shipment and the admin; rows written before item 93 show nothing. The
«Себестоимость КАН» button stays as it is. Spec: `../spec.md` (answers 1, 4, 5, 7). Cosmetic tier
for the toasts and markers; the «Отправлю сам» path is money-adjacent (what gets stamped).

**Blocked by:** 03, 04.

**Status:** ready-for-agent

- [ ] The save is never slowed or failed by the KAN step; a KAN failure leaves the saved shipment intact
- [ ] Toast texts and buttons per outcome; one toast per save, not per row
- [ ] «Отправлю сам»: file equals what the «Себестоимость КАН» button would build for the same rows; switch-to-manual called; no export stamp
- [ ] Marker per shipment row (combined shipment: each order's rows by OpID); visibility author + admin
- [ ] vitest on the pure helpers (outcome → toast text, journal status → marker, access rule)

## Comments
