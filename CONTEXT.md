# Складской учёт — Ozon stocks and supplies

Warehouse accounting for one seller on Ozon: our own warehouse («Мой склад»), goods on their way
to Ozon, and orders at the factory in China. The spreadsheet «БД Склад» is the record; the screen
and the server must read the same numbers from it.

## Language

### Stock

**Availability** («Доступно»):
Pieces of an article on «Мой склад» that can go into a new supply. For a virtual kit it is the
number of whole kits its components make; a virtual kit without components has none.
_Avoid_: free stock, остаток (that is the raw sheet quantity)

**Virtual kit** («Комплект», type `virtual`):
A kit sold on Ozon as one article but kept on the warehouse only as its components.
_Avoid_: bundle, set

**Legacy kit** («Комплект», type `legacy`):
A kit that has its own stock row, counted like any other article.

**Article** («Артикул»):
Our internal article from the «SKU» sheet. An Ozon offer is mapped to it by «ШК Ozon» first, then
by the offer id ignoring case.
_Avoid_: offer_id, SKU Ozon (those are Ozon's identifiers, not ours)

### Supplies to Ozon

**Supply reserve** («Резерв заявок»):
Pieces already promised to created supplies that Ozon has not yet taken off our books; they are
not available for a new supply.
_Avoid_: pending, зачёт

**Shipment extras** («Упаковка», «Прочее», «Услуги»):
Extra money of one shipment written into its «Объект» text and spread over the shipment's rows by
quantity into «ДопРасходы». Labels are read regardless of letter case.
_Avoid_: доп. затраты, overhead

### Coverage

**Coverage** («Покрытие, дн.»):
How many days an article's stock in an Ozon cluster lasts at its current sales speed, counting
goods already on their way there. Its colour follows the recommendation threshold.
_Avoid_: запас, остаток в днях

**Supply recommendation** («Рекомендация к поставке»):
How many pieces of an article to send to a cluster so its coverage reaches the target stock days
plus the days on the road to Ozon, in whole boxes, never above the cluster day ceiling and never
above the availability on «Мой склад».
_Avoid_: потребность (that is the need before boxes and limits)

**Factory signal** (the «Фабрика» cell):
How many pieces of an article to order at the factory so that everything we hold and have ordered
lasts the lead time, the road to Ozon, the minimum stock and the order horizon.
_Avoid_: заказ (that is an order already placed)

### Factory

**Pipeline** («Труба»):
Everything we hold or have ordered of an article: its stock on Ozon in all clusters (excluded
ones and rows without a cluster included), plus «Мой склад», plus its open factory orders. The
factory signal compares it with the pieces needed.
_Avoid_: using «Труба» for the factory orders alone

**Open factory orders** («Заказы на фабрике», not received):
Pieces ordered at the factory and not yet received, per article. A China order stays open while
late; a manual order drops out when its expected date passes, and is hidden when a China order of
the same article covers it.
_Avoid_: on order, в пути (that is Ozon's in-transit stock)
