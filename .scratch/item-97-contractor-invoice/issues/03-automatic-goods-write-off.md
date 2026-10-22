# 03: Automatic goods write-off at handover

**What to build:** plan T2. When ticket 02 detects a handover, the server writes the GOODS of that Ozon order
off «Мой склад» by itself — one expense operation per order as today, operation key = the order, no services,
no packaging, delivery date = handover day — and appends the Ozon cost journal row at once (the goods are not
yet in Ozon «Доступно», so the base is right; this also avoids 96.4 and 96.8 for these supplies). The supply
gets the status «ждёт счёта». Anything unclear — an unknown offer, a kit without components, short stock, a
virtual order, a dev-mode run — is NOT written off: flagged «спишите вручную» in «Поставки Озон» and mailed
to the owner. Production DB only, under the lock. Spec: `../spec.md` (decision 1, «Why not remember the
price»). Money tier.

**Blocked by:** 01 (96.10 — the automatic path retries by itself), 02.

**Status:** ready-for-agent

- [ ] Whole path on the stand: detection → write-off → journal row; stock, «История», reserve released
- [ ] A repeat (next poll, retry after an injected failure) writes nothing twice
- [ ] Each refusal case flagged and mailed, nothing written
- [ ] The receipt-in-between example (100 @ 300, A 50, receipt 100 @ 100, B 100) gives A 15 000, B 16 666.67
- [ ] A manual write-off of the same order before the poll → the poll does not write it again

## Comments
