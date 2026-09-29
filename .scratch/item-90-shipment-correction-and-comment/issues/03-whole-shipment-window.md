# 03: «Вся отгрузка» — correct the extras and the comment of a whole shipment

**What to build:** a «Вся отгрузка» button next to the pencil of every shipment row in «История»
opens one window: every order and article of the shipment with pieces, the extras fields
(packaging and other per piece or for the whole shipment, services), the comment, and a preview of
each order's new share. Saving re-spreads the new extras by pieces over every order the shipment
holds now (all rows with the same «Отгрузка», else the rows of the one operation), then over each
order's rows; rewrites the extras text and the «[Общая поставка: …]» note with the new shares;
records the corrected cost of each Ozon order in «Себестоимость Озон»; sets the comment on every
order. Quantities, stock and write-off cost never move. Any unresolvable row writes nothing. A
combined shipment without a shipment number (written off before item 90) is refused with a clear
reason. The row pencil loses its extras block. The browser preview's share arithmetic is a twin of
the server's, registered in the twin-rules parity test (ADR 0001). Spec: `../spec.md` (user stories
1–14).

**Blocked by:** 01, 02.

**Status:** ready-for-agent

- [ ] Stand, single order: same result as today's whole-operation extras correction (item-80 checks still green)
- [ ] Stand, combined shipment of 2–3 orders: shares by pieces sum to the new total to the kopeck; the extras per piece are equal across orders; each order's rows re-spread; «Себестоимость Озон» gains one corrected entry per order; quantities, stock and write-off cost unchanged
- [ ] Stand: an order deleted after the write-off — the total is spread over the remaining orders; a quantity edited — shares follow the current pieces
- [ ] Stand: no shipment number + «Общая поставка» tag → refused, nothing written; a failure on any row → nothing written
- [ ] Parity: browser preview shares = server shares on generated combined shipments
- [ ] Window: lists orders and articles, shows shares before saving, saves extras and comment; pencil shows no extras block
- [ ] Mutations: 10+ on the combined spread (new money path), 3–5 on the rest
