# 01: Operation comment — typed when recording, editable from the pencil, 💬 in «История»

**What to build:** every receipt and shipment can carry an operation comment. The owner types it in
«Ручной ввод», in the confirmation window (used by «Загрузка» and by Ozon write-off — a combined
shipment copies one comment to every order) and in the China «Оприходовать» window; edits it later
from the row pencil, old operations included. «История» shows a 💬 icon on rows with a comment, the
text on hover, and the History search matches the comment. The comment lives in its own column
«Комментарий» of «История», never inside «Объект», and is never read as money. It survives a row
edit (which deletes and rewrites the row), a deletion to «Удаленное» and its restore. Spec:
`../spec.md` (user stories 15–25, Implementation and Testing decisions).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Stand: a commit with a comment writes it to «Комментарий» on every row of the operation (incl. kit component rows); without one the cell stays empty; a sheet without the column gains it at the end
- [ ] Stand: a comment containing «500₽» changes no «ДопРасходы», «Цена» or «Сумма»
- [ ] Stand: China posting writes the comment; the row edit keeps or replaces it; delete → «Удаленное» → restore keeps it
- [ ] Browser: the three recording windows send the comment; the pencil edits it; a combined Ozon write-off sends the same comment with every order
- [ ] «История»: 💬 with the text on hover only on rows with a comment; search finds a row by its comment
- [ ] Old rows (no column or empty cell) read and render exactly as before
- [ ] Mutations 3–5 on the server path (money-adjacent: sheet writes)
