# 03 — keep collected files, finish the Drive folder
Status: ready-for-agent, after 02
Merge the previous journal record «Документы» (saved / missing) into the new run so a run with fewer
labels never drops earlier ones; check `saveSupplyDocsToDrive` (Code.gs ~6067) overwrites by name and
does not duplicate (fix there only if it does — then Code.gs deploy first, owner runs clasp);
message: «Не хватает этикеток по кластерам: … Нажмите ещё раз».
Checks: Drive stand/fake test — a repeat run creates no duplicates; 3 mutations.
