# 04 — never overwrite cargoes the app did not create (money-critical tier)
Status: ready-for-agent
Found 2026-10-28 after the live check (orders 135475876-1 and 135507457-1 built ok on `sklad-00110-88g`). The owner
edited the Moscow supply of 135507457-1 by hand in Ozon Seller (extra cargoes). With the ticket-03 rule, a press of
«Собрать документы» on such an order would see ids that differ from the stored ones → 'recreate' →
`/v1/cargoes/create` with `delete_current_version: true` would wipe the manual layout and invalidate labels printed
from Ozon Seller. Today the button is hidden for orders with status ok, so nothing happened.

Owner decisions 2026-10-28: the button never touches cargoes the app did not create itself; cargoes present in Ozon
but not remembered by the app (orders built before item 101, a build that died before the journal write, ids purged
after 20 days) count as manual — warning only; to let the app rebuild such a cluster the owner deletes its cargoes
in Ozon Seller first.

Rule per supply (replaces the ticket-03 decision):
- Ozon has NO cargoes → recreate (create; this is also the wizard's first run).
- Ozon cargo ids === stored ids (non-empty, record < 20 days): as ticket 03 (skip / label); if the content rules fail
  or the box count differs from the plan → recreate (the boxes are the app's own; layout comes from Ozon's current
  composition).
- Ozon has cargoes and (no stored entry, or stored ids empty/expired, or ids differ) → 'foreign': no Ozon write, no
  label request, no stale-label trash; warning «Кластер X: грузоместа изменены в Ozon вручную — документы этого
  кластера возьмите из Ozon Seller».
- `/v1/cargoes/get` failed or GAS `getSupplyDocsState` failed → no Ozon write for ANY supply; one warning
  «Не удалось проверить грузоместа в Ozon — нажмите «Собрать документы» ещё раз».
`/v1/cargoes/get` is read on every run (also when there is no record). A 'foreign' supply keeps its previous record
entry (if any). Confirmation text of the button rewritten accordingly.
Checks: decision tests per row; whole path: manual cargoes → 0 creates, 0 label calls, warning present, nothing
trashed; no record + empty Ozon → creates; cargoes/get error → 0 creates; 3–5 mutations. Cloud Run only (no Code.gs).
