import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  CheckCircle2,
  X,
  AlertCircle,
  MessageSquare,
  Loader2,
  Calculator,
  ArrowUp,
  ArrowDown,
  Layers,
  Zap,
} from "lucide-react";
import { resolveServiceCostAt } from '../lib/serviceRates';
import { useWarehouseStore } from "../store/useWarehouseStore";
import { useUIStore } from "../store/useUIStore";
import { formatCurrency, newOperationId } from "../lib/utils";
import { batchDestinationNote, buildBatchWriteOffPlan } from "../lib/ozonBatchWriteOff";
import { useSettingsStore } from "../store/useSettingsStore";
import { toast } from "sonner";

export const ConfirmModal: React.FC = () => {
  // Пункт 28, этап B: ключ операции рождается один раз при открытии окна
  // и не меняется при повторных нажатиях кнопки подтверждения.
  const opIdRef = useRef(newOperationId());
  // Пункт 28, этап C: список поставок Ozon живёт не дольше окна подтверждения.
  // Иначе он залипает и цепляется к посторонней операции: 01.08.2026 из-за этого
  // оприходование излишков привязалось к заявке Ozon и пометило две поставки из четырёх.
  useEffect(() => {
    return () => {
      useWarehouseStore.getState().setPendingOzonPostingIds([]);
      useWarehouseStore.getState().setPendingOzonBatch(null);
    };
  }, []);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const commitTransaction = useWarehouseStore(
    (state) => state.commitTransaction,
  );
  const handleProcessInvoice = useWarehouseStore(
    (state) => state.handleProcessInvoice,
  );
  const currentUser = useWarehouseStore((state) => state.currentUser);
  // Item 56. Orders of a batch write-off. One order behaves exactly as before; several
  // orders are written as several expenses sharing one set of additional costs.
  const pendingOzonBatch = useWarehouseStore((state) => state.pendingOzonBatch);
  const isMultiOrderBatch = !!pendingOzonBatch && pendingOzonBatch.length > 1;
  const isAdmin =
    currentUser?.role?.toLowerCase() === "admin" ||
    ["admin", "админ", "администратор"].includes(
      currentUser?.username?.toLowerCase() || "",
    );

  const parsedItems = useUIStore((state) => state.parsedItems);
  const setParsedItems = useUIStore((state) => state.setParsedItems);
  const updateParsedItem = useUIStore((state) => state.updateParsedItem);
  const opType = useUIStore((state) => state.opType);
  const uploadDestination = useUIStore((state) => state.uploadDestination);
  const aiFeedback = useUIStore((state) => state.aiFeedback);
  const setAiFeedback = useUIStore((state) => state.setAiFeedback);
  const setShowConfirmModal = useUIStore((state) => state.setShowConfirmModal);

  const kits = useWarehouseStore((state) => state.kits);
  const stock = useWarehouseStore((state) => state.stock);
  const skus = useWarehouseStore((state) => state.skus);
  const getEffectiveAvailability = useWarehouseStore((state) => state.getEffectiveAvailability);

  // Additional costs state for 'Расход'
  const [packagingCost, setPackagingCost] = useState<number | "">("");
  const [packagingDist, setPackagingDist] = useState<"batch" | "unit">("unit");

  const [otherCost, setOtherCost] = useState<number | "">("");
  const [otherDist, setOtherDist] = useState<"batch" | "unit">("batch");

  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [selectedCabinet, setSelectedCabinet] = useState<string>("");
  const ozonCabinetNames = useSettingsStore((state) => state.ozonCabinetNames);
  const needCabinetChoice = opType === "Расход" && uploadDestination === "Ozon" && ozonCabinetNames.length >= 2;
  const [missingFieldsError, setMissingFieldsError] = useState<string[]>([]);

  useEffect(() => {
    if (missingFieldsError.length > 0) {
      const updated: string[] = [];
      if (!deliveryDate && missingFieldsError.includes("«Дата поставки на маркетплейс»")) {
        updated.push("«Дата поставки на маркетплейс»");
      }
      if (packagingCost === "" && missingFieldsError.includes("«Стоимость упаковки»")) {
        updated.push("«Стоимость упаковки»");
      }
      if (!selectedCabinet && missingFieldsError.includes("«Магазин Ozon»")) {
        updated.push("«Магазин Ozon»");
      }
      const isDifferent = updated.length !== missingFieldsError.length || 
        updated.some((val, i) => val !== missingFieldsError[i]);
      if (isDifferent) {
        setMissingFieldsError(updated);
      }
    }
  }, [deliveryDate, packagingCost, selectedCabinet, missingFieldsError]);

  const services = useWarehouseStore((state) => state.services);
  const serviceRates = useWarehouseStore((state) => state.serviceRates);
  const serviceOrderIds = useSettingsStore((state) => state.serviceOrderIds);
  const setServiceOrderIds = useSettingsStore(
    (state) => state.setServiceOrderIds,
  );
  const boxesPerPalletGlobal = useSettingsStore((state) => state.boxesPerPalletGlobal);

  // Item 43. Cut-off date: the rate used is the one in force on the delivery date, not
  // today's. The logic lives in src/lib/serviceRates.ts and is shared with the directory.
  const getServiceCostAt = (serviceId: string, dateStr?: string) =>
    resolveServiceCostAt(serviceRates, services, serviceId, dateStr);

  const activeServices = useMemo(() => {
    let active = services.filter((s) => s.isActive);
    if (serviceOrderIds && serviceOrderIds.length > 0) {
      active.sort((a, b) => {
        const indexA = serviceOrderIds.indexOf(a.id);
        const indexB = serviceOrderIds.indexOf(b.id);
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      });
    }
    return active;
  }, [services, serviceOrderIds]);

  const moveService = (index: number, direction: "up" | "down") => {
    const newActive = [...activeServices];
    if (direction === "up" && index > 0) {
      [newActive[index - 1], newActive[index]] = [
        newActive[index],
        newActive[index - 1],
      ];
    } else if (direction === "down" && index < newActive.length - 1) {
      [newActive[index], newActive[index + 1]] = [
        newActive[index + 1],
        newActive[index],
      ];
    }

    const newOrderIds = newActive.map((s) => s.id);
    setServiceOrderIds(newOrderIds);

    // Save to global settings
    const currentModel = useSettingsStore.getState().geminiModel;
    const geminiKey = useSettingsStore.getState().geminiKey;
    useWarehouseStore
      .getState()
      .fetchGas("saveGlobalSettings", {
        data: { 
          geminiKey, 
          geminiModel: currentModel,
          serviceOrder: JSON.stringify(newOrderIds)
        },
      });
  };

  const [selectedServices, setSelectedServices] = useState<
    Record<string, number>
  >({});

  const kitPreviews = useMemo(() => {
    if (opType !== "Расход" || !parsedItems) return [];
    return parsedItems
      .filter((item) => kits.some((k) => k.kitSku === item.article))
      .map((item) => {
        const kit = kits.find((k) => k.kitSku === item.article);
        if (!kit) return null;
        return {
          article: item.article,
          quantity: item.quantity,
          components: kit.components.map((comp) => ({
            componentSku: comp.componentSku,
            needed: comp.quantity * item.quantity,
            available: stock.find((s) => s.article === comp.componentSku)?.quantity ?? 0,
          })),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [opType, parsedItems, kits, stock]);

  const hasKitShortage = useMemo(() => {
    return kitPreviews.some((p) =>
      p.components.some((c) => c.available < c.needed),
    );
  }, [kitPreviews]);

  // Пока идёт запись операции, остатки в сторе уже уменьшены, а позиции окна ещё старые.
  // Пересчёт в этот момент давал ложное «Недостаточно на складе» и красную подсветку
  // за мгновение до закрытия окна. На время записи держим последний корректный результат.
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const lastValidatedRef = useRef<any[] | null>(null);

  const validatedItems = useMemo(() => {
    if (!parsedItems) return null;
    if (opType !== "Расход") return parsedItems;
    if (isCommitting && lastValidatedRef.current) return lastValidatedRef.current;
    const validated = parsedItems.map((item) => {
      if (item.status === "unknown") return item;
      const available = getEffectiveAvailability(item.article);
      if (available < item.quantity) {
        return {
          ...item,
          status: "error" as const,
          errorMsg: `Недостаточно на складе (доступно ${available})`,
        };
      }
      return { ...item, status: "ok" as const, errorMsg: "" };
    });
    lastValidatedRef.current = validated;
    return validated;
  }, [parsedItems, opType, stock, kits, getEffectiveAvailability, isCommitting]);

  const finalItems = useMemo(() => {
    // Источник — позиции с актуальными статусами, пересчитанными по текущим остаткам
    const parsedItems = validatedItems;

    if (!parsedItems) return [];

    // Подсчитываем общую стоимость выбранных услуг
    const selectedActiveServices = activeServices.filter(
      (s) => (selectedServices[s.id] || 0) > 0,
    );
    const totalServicesCost = selectedActiveServices.reduce(
      (sum, s) => sum + getServiceCostAt(s.id, deliveryDate) * (selectedServices[s.id] || 0),
      0,
    );

    const totalQuantity = parsedItems.reduce(
      (acc, item) => acc + item.quantity,
      0,
    );

    // Item 56 (owner's decision, 25.08.2026): additional costs are divided BY PIECE COUNT,
    // never by line value. That is what the server does when it spreads them over an expense,
    // and a preview that divided them differently disagreed with the books whenever the
    // articles of one operation had different costs.
    const servicesExtraPerUnit =
      totalServicesCost === 0 || totalQuantity === 0 ? 0 : totalServicesCost / totalQuantity;

    if (opType === "Приход") {
      if (totalServicesCost === 0) return parsedItems;

      return parsedItems.map((item) => {
        return {
          ...item,
          price: item.price + servicesExtraPerUnit,
        };
      });
    }

    if (opType !== "Расход") return parsedItems;

    const pack = Number(packagingCost) || 0;
    const other = Number(otherCost) || 0;

    if (pack === 0 && other === 0 && totalServicesCost === 0)
      return parsedItems;

    return parsedItems.map((item) => {
      const packPerUnit =
        packagingDist === "unit"
          ? pack
          : totalQuantity > 0
            ? pack / totalQuantity
            : 0;
      const otherPerUnit =
        otherDist === "unit"
          ? other
          : totalQuantity > 0
            ? other / totalQuantity
            : 0;

      const extraPerUnit = packPerUnit + otherPerUnit + servicesExtraPerUnit;

      return {
        ...item,
        price: item.price + extraPerUnit,
      };
    });
  }, [
    parsedItems,
    validatedItems,
    opType,
    packagingCost,
    packagingDist,
    otherCost,
    otherDist,
    activeServices,
    selectedServices,
    deliveryDate,
    serviceRates,
  ]);

  const extraCostsTotal = useMemo(() => {
    if (opType !== "Расход" || !parsedItems) return 0;

    const pack = Number(packagingCost) || 0;
    const other = Number(otherCost) || 0;

    const totalQuantity = parsedItems.reduce(
      (acc, item) => acc + item.quantity,
      0,
    );

    const packTotal = packagingDist === "unit" ? pack * totalQuantity : pack;
    const otherTotal = otherDist === "unit" ? other * totalQuantity : other;

    const selectedActiveServices = activeServices.filter(
      (s) => (selectedServices[s.id] || 0) > 0,
    );
    const totalServicesCost = selectedActiveServices.reduce(
      (sum, s) => sum + getServiceCostAt(s.id, deliveryDate) * (selectedServices[s.id] || 0),
      0,
    );

    return packTotal + otherTotal + totalServicesCost;
  }, [
    parsedItems,
    opType,
    packagingCost,
    packagingDist,
    otherCost,
    otherDist,
    activeServices,
    selectedServices,
    deliveryDate,
    serviceRates,
  ]);

  const { totalBoxes, totalPallets } = useMemo(() => {
    if (opType !== "Расход" || !finalItems) return { totalBoxes: 0, totalPallets: 0 };
    let boxesSum = 0;
    finalItems.forEach((item) => {
      const skuData = skus.find((s) => s.sku === item.article);
      const pcsPerBox = skuData ? skuData.pcsPerBox : 0;
      const boxes = pcsPerBox > 0 ? Math.ceil(item.quantity / pcsPerBox) : 0;
      boxesSum += boxes;
    });
    const calculatedPallets = boxesSum >= 10 && boxesPerPalletGlobal > 0
      ? Math.ceil(boxesSum / boxesPerPalletGlobal)
      : 0;
    return { totalBoxes: boxesSum, totalPallets: calculatedPallets };
  }, [finalItems, skus, opType, boxesPerPalletGlobal]);

  const hasPrefilledRef = useRef(false);

  useEffect(() => {
    if (opType !== "Расход") return;
    if (hasPrefilledRef.current) return;
    if (!parsedItems || parsedItems.length === 0) return;
    if (skus.length === 0 || services.length === 0) return;

    let boxesSum = 0;
    parsedItems.forEach((item) => {
      const skuData = skus.find((s) => s.sku === item.article);
      const pcsPerBox = skuData ? skuData.pcsPerBox : 0;
      const boxes = pcsPerBox > 0 ? Math.ceil(item.quantity / pcsPerBox) : 0;
      boxesSum += boxes;
    });

    const calculatedPallets = boxesSum >= 10 && boxesPerPalletGlobal > 0
      ? Math.ceil(boxesSum / boxesPerPalletGlobal)
      : 0;

    const active = services.filter((s) => s.isActive);
    const newSelected: Record<string, number> = {};

    active.forEach((service) => {
      const nameLower = service.name.toLowerCase();
      if (nameLower.includes("паллет")) {
        newSelected[service.id] = calculatedPallets;
      } else if (nameLower.includes("короб")) {
        newSelected[service.id] = boxesSum;
      } else if (nameLower.includes("забор")) {
        newSelected[service.id] = 1;
      }
    });

    if (Object.keys(newSelected).length > 0) {
      setSelectedServices((prev) => ({ ...prev, ...newSelected }));
    }
    hasPrefilledRef.current = true;
  }, [parsedItems, skus, services, opType, boxesPerPalletGlobal]);

  // These hooks used to sit BELOW the early return «if (!parsedItems) return null».
  // It never surfaced while the window mounts with data already in place, but the moment
  // parsedItems went null on a live window React would see a different number of hooks
  // between renders and the page would go blank until a reload. That is exactly how the
  // Ozon supply window broke on 20.08.2026. See rule 11.11 in the technical brief.
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isCheckingResult, setIsCheckingResult] = useState<boolean>(false);
  // Пункт 28, этап D. Через 20 секунд ожидания показываем, что операция ещё идёт.
  // Главная причина аварии 01.08.2026 — человек не понимал, живо ли приложение, ижал второй раз.
  const [isSlowRunning, setIsSlowRunning] = useState<boolean>(false);
  useEffect(() => {
    if (!isProcessing) {
      setIsSlowRunning(false);
      return;
    }
    const slowTimer = setTimeout(() => setIsSlowRunning(true), 20000);
    return () => clearTimeout(slowTimer);
  }, [isProcessing]);

  if (!parsedItems) return null;

  // Приход с нулевой себестоимостью запрещён: количество выросло бы, а капитализация нет,
  // из-за чего средняя себестоимость артикула обрушилась бы. Проверяется базовая цена,
  // введённая пользователем; надбавка за услуги считается поверх неё и на проверку не влияет.
  const zeroPriceIndexes =
    opType === "Приход"
      ? parsedItems
          .map((item, idx) => (Number(item.price) > 0 ? -1 : idx))
          .filter((idx) => idx !== -1)
      : [];

  const isConfirmDisabled =
    isProcessing ||
    finalItems.length === 0 ||
    finalItems.some((item) => item.status === "error") ||
    hasKitShortage ||
    zeroPriceIndexes.length > 0;

  const handleConfirm = async () => {
    setCommitError(null);
    if (opType === "Приход" && zeroPriceIndexes.length > 0) {
      toast.error("Укажите себестоимость больше нуля для каждой позиции прихода");
      return;
    }

    if (opType === "Расход") {
      const missingFields = [];
      if (!deliveryDate) missingFields.push("«Дата поставки на маркетплейс»");
      if (packagingCost === "") missingFields.push("«Стоимость упаковки»");
      if (needCabinetChoice && !selectedCabinet) missingFields.push("«Магазин Ozon»");

      if (missingFields.length > 0) {
        setMissingFieldsError(missingFields);
        toast.error(
          `Необходимо заполнить следующие поля:\n${missingFields.join(", ")}`,
        );
        return;
      } else {
        setMissingFieldsError([]);
      }
    }

    let finalDestination = uploadDestination || "";

    // Магазин Ozon становится частью назначения: «Ozon (Название)».
    // При одном кабинете подставляется автоматически, при двух — из выбора пользователя.
    if (opType === "Расход" && finalDestination === "Ozon") {
      if (needCabinetChoice && selectedCabinet) {
        finalDestination = `Ozon (${selectedCabinet})`;
      } else if (ozonCabinetNames.length === 1) {
        finalDestination = `Ozon (${ozonCabinetNames[0]})`;
      }
    }

    const extraParts: string[] = [];

    if (opType === "Расход") {
      const pack = Number(packagingCost) || 0;
      if (pack > 0) {
        if (packagingDist === "unit") {
          const totalQuantity = finalItems.reduce(
            (sum, item) => sum + item.quantity,
            0,
          );
          extraParts.push(
            `Упаковка: ${totalQuantity} шт. x ${pack}₽ = ${pack * totalQuantity}₽`,
          );
        } else {
          extraParts.push(`Упаковка: ${pack}₽`);
        }
      }

      const other = Number(otherCost) || 0;
      if (other > 0) {
        if (otherDist === "unit") {
          const totalQuantity = finalItems.reduce(
            (sum, item) => sum + item.quantity,
            0,
          );
          extraParts.push(
            `Прочее: ${totalQuantity} шт. x ${other}₽ = ${other * totalQuantity}₽`,
          );
        } else {
          extraParts.push(`Прочее: ${other}₽`);
        }
      }
    }

    const selectedActiveServices = activeServices.filter(
      (s) => (selectedServices[s.id] || 0) > 0,
    );
    if (selectedActiveServices.length > 0) {
      const servicesText = selectedActiveServices
        .map(
          (s) => {
            const svcCost = getServiceCostAt(s.id, deliveryDate);
            return `${s.name} x${selectedServices[s.id]} (${Math.round(svcCost * selectedServices[s.id])}₽)`;
          }
        )
        .join(", ");
      extraParts.push(`Услуги: ${servicesText}`);
    }

    if (extraParts.length > 0) {
      const extrasStr = extraParts.join(" | ");
      finalDestination = finalDestination
        ? `${finalDestination} [${extrasStr}]`
        : `[${extrasStr}]`;
    }

    // Для Расхода отправляем базовые цены (parsedItems): долю упаковки/услуг
    // сервер распределяет сам по данным из destination. Для остальных типов — как раньше.
    // Запись пошла: с этого момента остатки в сторе могут обновиться раньше,
    // чем закроется окно — проверку замораживаем, чтобы не мигала ложная ошибка
    setIsCommitting(true);

    // Item 56. Several Ozon orders shipped as one batch are written as several expenses —
    // the owner wants one History record per order — while the additional costs were paid
    // once for the whole batch. Each order therefore states its own share of them as a
    // number, so the server does not read the batch total out of the destination text and
    // charge it to every order in full.
    //
    // A batch of one order deliberately does NOT take this path: it stays on the plain
    // commit below, byte for byte the behaviour that has been in production all along.
    if (isMultiOrderBatch && pendingOzonBatch) {
      const plan = buildBatchWriteOffPlan(pendingOzonBatch, extraCostsTotal);
      const written: string[] = [];

      for (let i = 0; i < plan.groups.length; i++) {
        const group = plan.groups[i];
        const groupDestination = `${finalDestination} ${batchDestinationNote(
          plan.groups.map((g) => g.label),
          group.quantity,
          plan.totalQuantity,
          group.extrasShare,
          plan.extrasTotal,
        )}`;

        // Every order needs its own idempotency key: with a shared one the second order
        // would be answered from the first order's already-written result.
        const ok = await commitTransaction(
          group.items as any,
          opType,
          groupDestination,
          deliveryDate,
          `${opIdRef.current}-${i + 1}`,
          {
            postingIds: group.postingIds,
            additionalCosts: group.extrasShare,
            silent: true,
            skipShipmentsRefresh: true,
          },
        );

        if (!ok) {
          setIsCommitting(false);
          setCommitError(
            written.length === 0
              ? "Ответ не получен, операция могла быть записана"
              : `Записаны заявки ${written.join(", ")}. На заявке № ${group.label} запись прервалась — оставшиеся заявки НЕ записаны.`,
          );
          await useWarehouseStore.getState().fetchExternalShipments();
          return;
        }
        written.push(`№ ${group.label}`);
      }

      await useWarehouseStore.getState().fetchExternalShipments();
      toast.success(`Записано расходов: ${plan.groups.length} — заявки ${written.join(", ")}`);
      setShowConfirmModal(false);
      setParsedItems(null);
      useUIStore.getState().setRawText("");
      return;
    }

    const success = await commitTransaction(
      opType === "Расход" ? parsedItems : finalItems,
      opType,
      finalDestination,
      deliveryDate,
      opIdRef.current,
    );
    if (success) {
      setShowConfirmModal(false);
      setParsedItems(null);
      useUIStore.getState().setRawText("");
    } else {
      setIsCommitting(false);
      setCommitError("Ответ не получен, операция могла быть записана");
    }
  };

  const handleCheckResult = async () => {
    setIsCheckingResult(true);
    try {
      await useWarehouseStore.getState().fetchStock();
      toast.info("Данные перезагружены");
      setShowConfirmModal(false);
      setParsedItems(null);
      useUIStore.getState().setRawText("");
    } catch (e) {
      toast.error("Ошибка при обновлении данных");
    } finally {
      setIsCheckingResult(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in"
    >
      <div
        className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col modal-enter"
      >
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h3 className="text-2xl font-bold">Подтверждение операции</h3>
            <p className="text-slate-500">
              Проверьте распознанные данные перед записью
            </p>
          </div>
          <button
            onClick={() => setShowConfirmModal(false)}
            className="p-3 hover:bg-white rounded-2xl transition-all shadow-sm border border-transparent hover:border-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Item 56. Несколько заявок Ozon, которые подрядчик вёз одной поставкой. */}
          {isMultiOrderBatch && pendingOzonBatch && (
            <div className="bg-sky-50 border border-sky-200 rounded-3xl p-5 space-y-3">
              <div className="flex items-center gap-2 font-bold text-sky-900">
                <Layers size={18} />
                Списание по нескольким заявкам: {pendingOzonBatch.length}
              </div>
              <div className="flex flex-wrap gap-2">
                {pendingOzonBatch.map((group) => {
                  const pieces = group.items.reduce((sum, it) => sum + it.quantity, 0);
                  return (
                    <span
                      key={group.groupId}
                      className="text-xs font-semibold px-3 py-1.5 bg-white text-sky-800 rounded-full border border-sky-200"
                    >
                      № {group.label} — {pieces} шт.
                    </span>
                  );
                })}
              </div>
              <p className="text-sm text-sky-800">
                Состав заявок сложен в один список: упаковка, прочие расходы и услуги вводятся
                один раз на всю партию и делятся по количеству штук. В «Историю» попадёт
                отдельная запись на каждую заявку, себестоимость единицы во всех одинаковая.
              </p>
              <p className="text-xs text-sky-700 font-semibold">
                Состав правке не подлежит: строки сложены из разных заявок.
              </p>
            </div>
          )}
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">
                    Статус
                  </th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">
                    Артикул
                  </th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">
                    Кол-во
                  </th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">
                    {opType === "Расход" ? "Себест." : "Цена"}
                  </th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">
                    Итого
                  </th>
                </tr>
              </thead>
              <tbody>
                {finalItems.map((item, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-slate-100 group hover:bg-slate-50/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      {item.status === "ok" ? (
                        <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg w-fit">
                          <CheckCircle2 size={14} />
                          <span className="text-[10px] font-bold uppercase">
                            {item.errorMsg || "OK"}
                          </span>
                        </div>
                      ) : (
                        <div
                          className={`flex items-center gap-2 px-2 py-1 rounded-lg w-fit ${item.status === "error" ? "text-red-600 bg-red-50" : "text-amber-600 bg-amber-50"}`}
                        >
                          <AlertCircle size={14} />
                          <span className="text-[10px] font-bold uppercase">
                            {item.errorMsg}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm font-bold text-indigo-600">
                      <input
                        type="text"
                        value={item.article}
                        readOnly={isMultiOrderBatch}
                        title={isMultiOrderBatch ? 'Состав нескольких заявок правке не подлежит: строка сложена из разных заявок' : undefined}
                        onChange={(e) =>
                          updateParsedItem(idx, { article: e.target.value })
                        }
                        className={`w-full bg-transparent border-b border-transparent outline-none transition-colors ${isMultiOrderBatch ? 'cursor-not-allowed text-slate-500' : 'hover:border-indigo-200 focus:border-indigo-500'}`}
                      />
                    </td>
                    <td className="px-6 py-4 text-right font-bold">
                      <div className="flex flex-col items-end">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity === 0 ? "" : item.quantity}
                          readOnly={isMultiOrderBatch}
                          title={isMultiOrderBatch ? 'Состав нескольких заявок правке не подлежит: строка сложена из разных заявок' : undefined}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            updateParsedItem(idx, {
                              quantity: val < 0 ? 0 : val,
                            });
                          }}
                          className={`w-24 text-right bg-transparent border-b border-transparent outline-none transition-colors ${isMultiOrderBatch ? 'cursor-not-allowed text-slate-500' : 'hover:border-indigo-200 focus:border-indigo-500'}`}
                        />
                        {opType === "Расход" && (() => {
                          const skuData = skus.find((s) => s.sku === item.article);
                          const pcsPerBox = skuData ? skuData.pcsPerBox : 0;
                          const boxes = pcsPerBox > 0 ? Math.ceil(item.quantity / pcsPerBox) : 0;
                          return (
                            <span className="text-xs text-slate-400 font-medium mt-1">
                              {boxes} кор.
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-medium whitespace-nowrap">
                      {opType === "Приход" ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={
                                parsedItems[idx].price === 0
                                  ? ""
                                  : parsedItems[idx].price
                              }
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateParsedItem(idx, {
                                  price: val < 0 ? 0 : val,
                                });
                              }}
                              className={`w-28 text-right bg-transparent border-b outline-none transition-colors ${
                                Number(parsedItems[idx].price) > 0
                                  ? "border-transparent hover:border-indigo-200 focus:border-indigo-500"
                                  : "border-red-400 bg-red-50/60 focus:border-red-500"
                              }`}
                            />
                            <span>₽</span>
                          </div>
                          {item.price > parsedItems[idx].price && (
                            <div
                              className="text-[10px] text-indigo-500 font-bold"
                              title="Цена с учетом услуг подрядчиков"
                            >
                              Итог: {formatCurrency(item.price)} ₽
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <span>
                            {formatCurrency(item.price)} ₽
                          </span>
                          {Math.abs(item.price - parsedItems[idx].price) > 0.001 && (
                            <div
                              className="text-[10px] text-slate-400 font-medium"
                              title="Базовая себестоимость"
                            >
                              базовая: {formatCurrency(parsedItems[idx].price)} ₽
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900 whitespace-nowrap">
                      {formatCurrency(item.quantity * item.price)} ₽
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {opType === "Расход" && (
            <div className="flex gap-6 p-5 bg-slate-50 border border-slate-200 rounded-3xl">
              <div className="flex-1">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block mb-1">Всего коробок</span>
                <span className="text-xl font-black text-slate-900">{totalBoxes} кор.</span>
              </div>
              <div className="w-px bg-slate-200 self-stretch" />
              <div className="flex-1">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block mb-1">Всего паллет</span>
                <span className="text-xl font-black text-slate-900">{totalPallets} пал.</span>
              </div>
            </div>
          )}

          {(opType === "Приход" || opType === "Расход") &&
            activeServices.length > 0 && (
              <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100 space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-indigo-600 font-bold">
                    <Calculator size={20} />
                    Дополнительные услуги подрядчиков
                  </div>
                  <div className="text-xs font-bold text-indigo-500 uppercase tracking-widest bg-indigo-100 px-3 py-1 rounded-full">
                    Увеличивают себестоимость
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-200">
                        {isAdmin && (
                          <th className="px-4 py-3 w-16 text-center font-bold text-slate-400 uppercase text-[10px] tracking-widest">
                            Сорт.
                          </th>
                        )}
                        <th className="px-6 py-3 font-bold text-slate-400 uppercase text-[10px] tracking-widest">
                          Услуга
                        </th>
                        <th className="px-6 py-3 w-32 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">
                          Кол-во
                        </th>
                        <th className="px-4 py-3 w-28 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">
                          Цена
                        </th>
                        <th className="px-6 py-3 w-36 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">
                          Итого
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeServices.map((service, index) => {
                        const quantity = selectedServices[service.id] || 0;
                        const currentCost = getServiceCostAt(service.id, deliveryDate);
                        const totalSum = quantity * currentCost;

                        return (
                          <tr
                            key={service.id}
                            className="border-b border-slate-100 group hover:bg-slate-50/30 transition-colors"
                          >
                            {isAdmin && (
                              <td className="px-4 py-2">
                                <div className="flex flex-col gap-1 items-center justify-center opacity-100 transition-opacity">
                                  <button
                                    onClick={() => moveService(index, "up")}
                                    disabled={index === 0}
                                    className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                                  >
                                    <ArrowUp size={14} />
                                  </button>
                                  <button
                                    onClick={() => moveService(index, "down")}
                                    disabled={
                                      index === activeServices.length - 1
                                    }
                                    className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                                  >
                                    <ArrowDown size={14} />
                                  </button>
                                </div>
                              </td>
                            )}

                            <td className="px-6 py-3 font-bold text-slate-800">
                              {service.name}
                            </td>

                            <td className="px-6 py-3 text-right font-bold w-32">
                              <input
                                type="number"
                                min="0"
                                value={quantity === 0 ? "" : quantity}
                                placeholder="0"
                                onChange={(e) => {
                                  let val = parseInt(e.target.value, 10);
                                  setSelectedServices((prev) => ({
                                    ...prev,
                                    [service.id]:
                                      isNaN(val) || val < 0 ? 0 : val,
                                  }));
                                }}
                                className="w-full text-right bg-transparent border-b border-transparent hover:border-indigo-200 focus:border-indigo-500 outline-none transition-colors"
                              />
                            </td>

                            <td className="px-4 py-3 text-right font-medium text-slate-500 whitespace-nowrap w-28">
                              {Math.round(currentCost).toLocaleString("ru-RU")}{" "}
                              ₽
                            </td>

                            <td className="px-6 py-3 text-right font-bold text-indigo-600 whitespace-nowrap w-36">
                              {Math.round(totalSum).toLocaleString("ru-RU")} ₽
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          {opType === "Расход" && (
            <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100 space-y-4">
              <div className="flex items-center gap-2 text-indigo-600 font-bold mb-4">
                <Calculator size={20} />
                Дополнительные расходы на отгрузку
              </div>

              <div className="space-y-4 md:space-y-0 md:flex md:gap-4 md:*:flex-1">
                <div className="space-y-2 bg-white p-4 rounded-2xl border border-indigo-50 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Стоимость упаковки
                    </label>
                    <select
                      value={packagingDist}
                      onChange={(e) =>
                        setPackagingDist(e.target.value as "batch" | "unit")
                      }
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-indigo-100 transition-colors"
                    >
                      <option value="batch">На партию</option>
                      <option value="unit">На единицу</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    value={packagingCost}
                    onChange={(e) =>
                      setPackagingCost(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder=""
                    className={`w-full px-4 py-3 rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium border ${
                      missingFieldsError.includes("«Стоимость упаковки»")
                        ? "border-red-400 focus:ring-red-500"
                        : "border-indigo-100"
                    }`}
                  />
                  <p className="text-[10px] text-slate-400 font-medium mt-1.5">
                    Обязательное поле. Если упаковки не было — введите 0.
                  </p>
                </div>
                <div className="space-y-2 bg-white p-4 rounded-2xl border border-indigo-50 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Прочее
                    </label>
                    <select
                      value={otherDist}
                      onChange={(e) =>
                        setOtherDist(e.target.value as "batch" | "unit")
                      }
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-indigo-100 transition-colors"
                    >
                      <option value="batch">На партию</option>
                      <option value="unit">На единицу</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    value={otherCost}
                    onChange={(e) =>
                      setOtherCost(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="0 ₽"
                    className="w-full px-4 py-3 rounded-xl border border-indigo-100 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                </div>
              </div>
              <div className="text-xs text-indigo-400 mt-2 px-2">
                Эти суммы будут прибавлены к себестоимости каждого отгружаемого
                товара согласно выбранному методу распределения.
              </div>
            </div>
          )}

          {needCabinetChoice && (
            <div className={`bg-white p-6 rounded-3xl border shadow-sm ${
              missingFieldsError.includes("«Магазин Ozon»") ? "border-red-400" : "border-indigo-100"
            }`}>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
                Магазин Ozon
              </label>
              <div className="flex flex-wrap gap-2">
                {ozonCabinetNames.map((name) => (
                  <button
                    type="button"
                    key={name}
                    onClick={() => setSelectedCabinet(name)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                      selectedCabinet === name
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white p-6 rounded-3xl border border-indigo-100 shadow-sm">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Дата поставки на маркетплейс
            </label>
            <div className="w-full md:w-1/3">
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className={`w-full px-4 py-3 rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium border ${
                  missingFieldsError.includes("«Дата поставки на маркетплейс»")
                    ? "border-red-400 focus:ring-red-500"
                    : "border-indigo-100"
                }`}
              />
            </div>
          </div>

          {/* AI Feedback Section */}
          <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100 space-y-4">
            <div className="flex items-center gap-2 text-indigo-600 font-bold">
              <MessageSquare size={20} />
              Уточнение для ИИ (если есть ошибки)
            </div>
            <div className="flex gap-4">
              <input
                type="text"
                value={aiFeedback}
                onChange={(e) => setAiFeedback(e.target.value)}
                placeholder="Например: 'Артикул A001 на самом деле Смартфон X1', 'Пропусти вторую позицию'..."
                className="flex-1 px-6 py-4 rounded-2xl border border-indigo-100 bg-white outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
              <button
                onClick={() => handleProcessInvoice(aiFeedback)}
                disabled={isProcessing || !aiFeedback.trim()}
                className="bg-indigo-600 text-white px-8 rounded-2xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
              >
                {isProcessing ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <Zap size={20} />
                )}
                Пересчитать
              </button>
            </div>
          </div>

          {kitPreviews.length > 0 && (
            <div className="bg-violet-50 border border-violet-200 rounded-3xl p-6 space-y-3">
              <div className="flex items-center gap-2 text-violet-700 font-bold text-sm">
                <Layers size={15} />
                Комплекты — из-за отгрузки будут дополнительно списаны следующие позиции:
              </div>
              {kitPreviews.map((preview) => (
                <div key={preview.article}>
                  <p className="text-xs font-bold text-slate-500 mb-1">
                    {preview.article} × {preview.quantity} шт.:
                  </p>
                  {preview.components.map((comp) => {
                    const ok = comp.available >= comp.needed;
                    return (
                      <div
                        key={comp.componentSku}
                        className={`flex items-center justify-between text-sm px-3 py-1.5 rounded-xl bg-white mb-1 ${
                          !ok ? "border border-red-200" : ""
                        }`}
                      >
                        <span className="font-mono text-slate-700">
                          {comp.componentSku}
                        </span>
                        <span className="text-slate-500">{comp.needed} шт.</span>
                        <span
                          className={`text-xs ${
                            ok ? "text-slate-400" : "text-red-500 font-bold"
                          }`}
                        >
                          склад: {comp.available} шт.
                        </span>
                        <span>{ok ? "✅" : "❌"}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {missingFieldsError.length > 0 && (
          <div className="mx-8 mb-4 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm font-medium flex items-center gap-2">
            <AlertCircle className="text-red-500 shrink-0" size={16} />
            <span>Заполните обязательные поля: {missingFieldsError.join(", ")}</span>
          </div>
        )}

        {zeroPriceIndexes.length > 0 && (
          <div className="mx-8 mb-4 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm font-medium flex items-center gap-2">
            <AlertCircle className="text-red-500 shrink-0" size={16} />
            <span>
              Укажите себестоимость: приход нельзя провести с нулевой ценой. Позиций без цены: {zeroPriceIndexes.length}.
            </span>
          </div>
        )}

        {isProcessing && isSlowRunning && !commitError && (
          <div className="mx-8 mb-4 p-4 bg-sky-50 border border-sky-200 rounded-2xl text-sky-800 text-sm font-medium flex items-center gap-2">
            <Loader2 className="animate-spin text-sky-600 shrink-0" size={18} />
            <span>Операция идёт дольше обычного. Не закрывайте окно и не нажимайте кнопку повторно — запись уже выполняется.</span>
          </div>
        )}

        {commitError && (
          <div className="mx-8 mb-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-sm font-medium flex items-center gap-2">
            <AlertCircle className="text-amber-600 shrink-0" size={18} />
            <span>{commitError}</span>
          </div>
        )}

        <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
          <div className="flex gap-8">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Всего позиций
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {parsedItems.length}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Общая сумма
              </div>
              <div className="text-2xl font-bold text-indigo-600">
                {formatCurrency(
                  finalItems.reduce(
                    (acc, item) => acc + item.quantity * item.price,
                    0,
                  ),
                )}{" "}
                ₽
              </div>
            </div>
            {opType === "Расход" && (
              <div id="additional-expenses-block">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Доп. расходы
                </div>
                <div className="text-2xl font-bold text-indigo-600">
                  {formatCurrency(extraCostsTotal)} ₽
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setShowConfirmModal(false)}
              className="px-8 py-4 rounded-2xl font-bold text-slate-500 hover:bg-white transition-all"
            >
              Отмена
            </button>
            {commitError ? (
              <button
                onClick={handleCheckResult}
                disabled={isCheckingResult}
                className="bg-amber-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-amber-700 disabled:opacity-50 transition-all shadow-xl flex items-center gap-2"
              >
                {isCheckingResult ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <Zap size={20} />
                )}
                Проверить результат
              </button>
            ) : (
              <button
                onClick={handleConfirm}
                disabled={isConfirmDisabled}
                className="bg-slate-900 text-white px-12 py-4 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-xl flex items-center gap-2"
              >
                {isProcessing ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <CheckCircle2 size={20} />
                )}
                Подтвердить и записать
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
