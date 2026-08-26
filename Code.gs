function verifyServerSignature(payloadForCheck, signature) {
  const secret = PropertiesService.getScriptProperties().getProperty('server_secret');
  if (!secret || !signature) return false;

  if (Math.abs(Date.now() - Number(payloadForCheck.timestamp)) > 300000) {
    Logger.log('Replay attack blocked');
    return false;
  }

  const expected = Utilities.computeHmacSha256Signature(
    JSON.stringify(payloadForCheck), secret
  );
  const expectedHex = expected
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');

  return expectedHex === signature;
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Google Apps Script Web App is operational. Use POST for API requests.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  _transHeadersCache = null;
  _devModeSpreadsheet = null;
  let lock;
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    
    if (action === 'getGeminiKey') {
      const payloadForCheck = {
        action: payload.action,
        timestamp: payload.timestamp
      };

      if (!verifyServerSignature(payloadForCheck, payload.signature)) {
        return ContentService
          .createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Invalid server signature'
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const key = PropertiesService.getScriptProperties().getProperty('global_geminiKey');
      if (!key) {
        return ContentService
          .createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Gemini key not configured'
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', data: { geminiKey: key } }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'getOzonKeys') {
      const payloadForCheck = {
        action: payload.action,
        timestamp: payload.timestamp
      };

      if (!verifyServerSignature(payloadForCheck, payload.signature)) {
        return ContentService
          .createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Invalid server signature'
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const cabinets = getOzonCabinets();
      const first = cabinets.length > 0 ? cabinets[0] : { clientId: '', apiKey: '' };

      return ContentService
        .createTextOutput(JSON.stringify({
          status: 'success',
          // Старые поля (первый кабинет) — обратная совместимость с текущим прокси;
          // cabinets — новый формат для мультикабинетной синхронизации
          data: { ozonClientId: first.clientId, ozonApiKey: first.apiKey, cabinets: cabinets }
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const data = payload.data;
    const sessionToken = payload.sessionToken;
    
    // Verify session for protected actions
    const publicActions = ['login'];
    let currentUser = null;
    
    // Some session caches don't need lock strictly? 
    // Actually verifySession is just reading properties mostly.
    
    if (!publicActions.includes(action)) {
      currentUser = verifySession(sessionToken);
      if (!currentUser) {
        throw new Error('Unauthorized: Недействительная сессия. Пожалуйста, войдите снова.');
      }
    }
    
    // ── Режим разработки: маршрутизация в тестовую БД ──
    const DEV_MODE_EXCLUDED_ACTIONS = ['login', 'logout', 'verifySession', 'backupDatabase', 'createOrUpdateTestDatabase'];
    if (payload.devMode === true && !DEV_MODE_EXCLUDED_ACTIONS.includes(action)) {
      if (!currentUser || !isAdminRole(currentUser.role)) {
        throw new Error('Режим разработки доступен только администратору');
      }
      if (action === 'archiveTransactions') {
        throw new Error('Архивация недоступна в режиме разработки: фоновый процесс выполнился бы на боевой БД');
      }
      const testDbId = PropertiesService.getScriptProperties().getProperty('test_dbSpreadsheetId');
      if (!testDbId) {
        throw new Error('Тестовая БД не создана. Настройки → «Создать/обновить тестовую БД»');
      }
      _devModeSpreadsheet = SpreadsheetApp.openById(testDbId);
    }
    
    let result = {};
    
    if (action === 'archiveTransactions') {
       assertAdmin(currentUser);
       const monthsToKeep = payload.data && payload.data.monthsToKeep ? payload.data.monthsToKeep : 6;
       PropertiesService.getScriptProperties().setProperty('archive_monthsToKeep', String(monthsToKeep));
       ScriptApp.newTrigger('runArchiveOldTransactionsAsBackground').timeBased().after(100).create();
       return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: { async: true, message: 'Процесс запущен в фоновом режиме. Это займет около минуты.' } })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'runOzonSyncNow') {
      assertAdmin(currentUser);
      // Запуск в фоне через одноразовый триггер: клиент получает мгновенный ответ и не падает по таймауту; сам прогон выполняется в runOzonSyncOnce вне контекста этого запроса, поэтому конфликтов с LockService нет
      const triggers = ScriptApp.getProjectTriggers();
      for (let i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === 'runOzonSyncOnce') {
          ScriptApp.deleteTrigger(triggers[i]);
        }
      }
      ScriptApp.newTrigger('runOzonSyncOnce').timeBased().after(100).create();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: { async: true, message: 'Синхронизация Ozon запущена в фоновом режиме. Статус обновится ниже через 1–2 минуты (первичная загрузка истории может занять дольше).' } })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'runOzonStocksSyncNow') {
      assertAdmin(currentUser);
      // КРИТИЧНО: без захвата LockService — прокси делает обратный запрос saveOzonStocks к этому же doPost,
      // и если внешний запрос держит замок, внутренний упрётся в waitLock (тот же дедлок, что и у runOzonSyncNow).
      const response = UrlFetchApp.fetch(PROXY_URL + '/api/ozon/stocks', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          sessionToken: sessionToken,
          devMode: payload.devMode === true
        }),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      const content = response.getContentText();
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (jsonErr) {
        throw new Error('Ошибка разбора ответа прокси при опросе остатков Ozon: ' + content);
      }
      if (code < 200 || code >= 300 || parsed.status !== 'success') {
        throw new Error('Ошибка прокси-сервера при опросе остатков Ozon: ' + (parsed.message || content));
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: parsed.data }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Читающие Ozon-экшены обслуживаются без LockService: они только читают листы,
    // а захват общего замка приводил к таймаутам при параллельной загрузке вкладки «Остатки Озон».
    //
    // Item 26 stage A1 (2026-08-20): getOzonInitialData returns the same five reads in ONE call.
    // It is served HERE, next to the single reads, and deliberately NOT from the switch below:
    // that keeps lock behaviour and permissions byte-identical to calling the five separately —
    // the session is already verified above, the global lock is not taken, and none of these five
    // reads has an assertAdmin of its own. getOzonSyncStatus stays out: the sidebar polls it on its
    // own schedule. getLastPurchasePrices stays out too: it still goes through the switch and takes
    // the lock, and moving it here would silently change that.
    if (action === 'getOzonInitialData') {
      const ozonInitial = {
        stocks: getOzonStocks(),
        sales: getOzonSales(payload.data && payload.data.weeksLimit),
        settings: getOzonSettings(),
        clusters: getOzonClusters(),
        factoryOrders: getFactoryOrders()
      };
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: ozonInitial }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getOzonStocks' || action === 'getOzonSales' || action === 'getOzonSyncStatus' || action === 'getOzonSettings' || action === 'getOzonClusters' || action === 'getFactoryOrders') {
      let readResult;
      if (action === 'getOzonStocks') readResult = getOzonStocks();
      else if (action === 'getOzonSales') readResult = getOzonSales(payload.data && payload.data.weeksLimit);
      else if (action === 'getOzonSyncStatus') readResult = getOzonSyncStatusInfo();
      else if (action === 'getOzonSettings') readResult = getOzonSettings();
      else if (action === 'getFactoryOrders') readResult = getFactoryOrders();
      else readResult = getOzonClusters();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: readResult }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Волна 1 пункта 25: читающие действия обслуживаются без LockService.
    // Глобальный замок ставил чтение в общую очередь с записями, из-за чего старт
    // приложения растягивался до 8,4 с. Проверки прав внутри switch не затрагиваются:
    // действия по-прежнему проходят через switch и его вызовы assertAdmin.
    // Список составлен поимённо по фактическому дереву вызовов, а не по префиксу get.
    // getArchivedItems намеренно НЕ включён: он вызывает cleanOldArchivedItems,
    // которая физически удаляет строки старше 60 дней, то есть является записью.
    // Волна 2 (getUsers, getGlobalSettings, getExternalShipments,
    // getOzonSupplyRequests, checkSupplyAvailability) добавляется отдельной задачей.
    const LOCK_FREE_ACTIONS = [
      'getInitialData',
      'getStock',
      'getTransactions',
      'getSkus',
      'getServices',
      'getServiceRates',
      'getUsers',
      'getGlobalSettings',
      'getExternalShipments',
      'getOzonSupplyRequests',
      'checkSupplyAvailability',
      // Волна 3 пункта 25. Замеры 06.08.2026 в логах Cloud Run показали,
      // что getFactoryOrders падает по таймауту 25 с при листе в 8 строк:
      // время уходило не на чтение, а на ожидание глобального замка.
      // Все шесть функций проверены — записи в таблицу не выполняют.
      'getOzonSettings',
      'getOzonClusters',
      'getOzonStocks',
      'getOzonSales',
      'getFactoryOrders',
      'getOzonSyncStatus'
    ];
    if (!LOCK_FREE_ACTIONS.includes(action)) {
      lock = LockService.getScriptLock();
      lock.waitLock(10000);
    }
    
    switch (action) {
      case 'verifySession':
        if (!currentUser) throw new Error('Invalid session');
        result = currentUser;
        break;
      case 'login':
        result = loginUser(payload.username, payload.password);
        break;
      case 'logout':
        result = logoutUser(sessionToken);
        break;
      case 'getUsers':
        assertAdmin(currentUser);
        result = getUsers();
        break;
      case 'addUser':
        assertAdmin(currentUser);
        result = addUser(data.username, data.password, data.role);
        break;
      case 'deleteUser':
        assertAdmin(currentUser);
        result = deleteUser(payload.username, currentUser.username);
        break;
      case 'setup':
        assertAdmin(currentUser);
        result = setupDatabase();
        break;
      case 'backupDatabase':
        assertAdmin(currentUser);
        result = backupDatabase();
        break;
      case 'createOrUpdateTestDatabase':
        assertAdmin(currentUser);
        result = createOrUpdateTestDatabase();
        break;
      case 'getInitialData':
        result = {
          stock: getStock(),
          skus: getSkus(),
          transactions: getTransactions(payload.data),
          kits: getKits(),
          services: getServices()
        };
        break;
      case 'getStock':
        result = getStock();
        break;
      case 'getTransactions':
        result = getTransactions(payload.data);
        break;
      case 'deleteTransaction':
        result = deleteTransaction(payload.id, currentUser.username);
        break;
      case 'deleteMultipleTransactions':
        result = deleteMultipleTransactions(payload.ids, currentUser.username);
        break;
      case 'updateTransaction':
        result = updateTransaction(payload.id, data, currentUser.username);
        break;
      case 'getServices':
        result = getServices();
        break;
      case 'addService':
        assertAdmin(currentUser);
        result = addService(data.name, data.cost);
        break;
      case 'updateService':
        assertAdmin(currentUser);
        result = updateService(payload.id, data.name, data.cost, data.isActive);
        break;
      case 'deleteService':
        assertAdmin(currentUser);
        result = updateService(payload.id, data.name, data.cost, false);
        break;
      case 'addServiceRate':
        assertAdmin(currentUser);
        result = addServiceRate(data.serviceId, data.cost, data.validFrom);
        break;
      case 'getServiceRates':
        result = getServiceRates();
        break;
      case 'getSkus':
        result = getSkus();
        break;
      case 'addSku':
        result = addSku(data);
        break;
      case 'updateSku':
        result = updateSku(data, payload.oldSku);
        break;
      case 'deleteSku':
        result = deleteSku(payload.sku, currentUser.username);
        break;
      case 'commit':
        result = commitTransaction(data, payload.type, payload.destination, payload.deliveryDate, currentUser.username, null, payload.opId, payload.additionalCosts);
        // Пункт 28, этап C: привязка поставок Ozon выполняется здесь же, внутри замка.
        // Ошибка привязки не отменяет уже записанный расход — она возвращается клиенту как предупреждение.
        if (result && payload.postingIds && payload.postingIds.length > 0) {
          try {
            result.postingsLink = linkPostingsToCommit(payload.postingIds, result.newTransactions);
          } catch (linkErr) {
            result.postingsLink = { linked: 0, error: String(linkErr) };
          }
        }
        break;
      case 'getGlobalSettings':
        if (sessionToken && !currentUser) {
          currentUser = verifySession(sessionToken);
        }
        result = getGlobalSettings(currentUser ? currentUser.role : null);
        break;
      case 'saveGlobalSettings':
        assertAdmin(currentUser);
        result = saveGlobalSettings(data, currentUser.role);
        break;
      case 'getArchivedItems':
        assertAdmin(currentUser);
        result = getArchivedItems();
        break;
      case 'restoreArchivedItem':
        assertAdmin(currentUser);
        result = restoreArchivedItem(payload.archiveId);
        break;
      case 'restoreMultipleArchivedItems':
        assertAdmin(currentUser);
        result = restoreMultipleArchivedItems(payload.archiveIds);
        break;
      case 'hardDeleteArchivedItems':
        assertAdmin(currentUser);
        result = hardDeleteArchivedItems(payload.archiveIds);
        break;
      case 'recalcCapFromAvg':
        assertAdmin(currentUser);
        const recalcResult = recalcCapitalizationFromAvg();
        result = {
          recalc: recalcResult,
          stock: getStock()
        };
        break;
      case 'saveKit':
        assertAdmin(currentUser);
        result = saveKit(data.kitSku, data.components, data.kitType);
        break;
      case 'deleteKit':
        assertAdmin(currentUser);
        result = deleteKit(payload.kitSku);
        break;
      case 'saveExternalShipments':
        result = saveExternalShipments(data.shipments);
        break;
      case 'applyCancelledOzonOrders':
        result = applyCancelledOzonOrders(data);
        break;
      case 'getExternalShipments':
        result = getExternalShipments();
        break;
      case 'updateExternalShipmentStatus':
        result = updateExternalShipmentStatus(data.postingId, data.status, data.transGroupInfo);
        break;
      case 'saveExternalShipmentAcceptance':
        result = saveExternalShipmentAcceptance(data.postingId, data.acceptedJSON);
        break;
      case 'saveShipmentPeresort':
        result = saveShipmentPeresort(data.postingId, data.peresortJSON);
        break;
      case 'saveShipmentShortageRecalc':
        assertAdmin(currentUser);
        result = saveShipmentShortageRecalc(data.postingId, data.recalcJSON, data.historyNotes, currentUser.username);
        break;
      case 'commitShipmentPeresort':
        assertAdmin(currentUser);
        result = commitShipmentPeresort(data.postingId, currentUser.username);
        break;
      case 'getOzonSyncStatus': result = getOzonSyncStatusInfo(); break;
      case 'setupOzonSyncTriggers': assertAdmin(currentUser); setupOzonSyncTriggers(); result = getOzonSyncStatusInfo(); break;
      case 'removeOzonSyncTriggers': assertAdmin(currentUser); removeOzonSyncTriggers(); result = getOzonSyncStatusInfo(); break;
      case 'saveOzonStocks': result = saveOzonStocks(data); break;
      case 'saveOzonSales': result = saveOzonSales(data); break;
      case 'getOzonStocks': result = getOzonStocks(); break;
      case 'getOzonSales': result = getOzonSales(data && data.weeksLimit); break;
      case 'getOzonSettings': result = getOzonSettings(); break;
      case 'saveOzonSettings': assertAdmin(currentUser); result = saveOzonSettings(data); break;
      case 'saveOzonClusters': result = saveOzonClusters(data); break;
      case 'getOzonClusters': result = getOzonClusters(); break;
      case 'markOzonClustersNotified': result = markOzonClustersNotified(); break;
      case 'saveFactoryOrder': assertAdmin(currentUser); result = saveFactoryOrder(data, currentUser.username); break;
      case 'setFactoryOrderReceived': assertAdmin(currentUser); result = setFactoryOrderReceived(data, currentUser.username); break;
      case 'getLastPurchasePrices': result = getLastPurchasePrices(); break;
      case 'cancelFactoryOrder': assertAdmin(currentUser); result = cancelFactoryOrder(data, currentUser.username); break;
      case 'checkSupplyAvailability': result = checkSupplyAvailability(data); break;
      case 'saveOzonSupplyRequest': assertAdmin(currentUser); result = saveOzonSupplyRequest(data, currentUser.username); break;
      case 'getOzonSupplyRequests': assertAdmin(currentUser); result = getOzonSupplyRequests(); break;
      case 'saveSupplyDocsToDrive': assertAdmin(currentUser); result = saveSupplyDocsToDrive(data); break;
      default:
        throw new Error('Unknown action: ' + action);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: result }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    // Освобождаем блокировку
    if (lock) lock.releaseLock();
  }
}

function isAdminRole(role) {
  if (!role) return false;
  var r = String(role).trim().toLowerCase();
  return r === 'admin' || r === 'администратор';
}

function assertAdmin(user) {
  if (!user) throw new Error('Unauthorized');
  if (!isAdminRole(user.role)) {
    throw new Error('Forbidden: Требуются права администратора');
  }
}

function getSpreadsheet() {
  if (_devModeSpreadsheet) return _devModeSpreadsheet;
  return SpreadsheetApp.getActiveSpreadsheet();
}

const EXTERNAL_SHIPMENTS_HEADERS = [
  'PostingID', 'Дата обнаружения', 'Дата отгрузки', 'Статус', 'ПозицииJSON', 'TransGroupInfo',
  'OrderID', 'Номер заявки', 'Статус Ozon', 'Дата статуса Ozon', 'Пункт отгрузки', 'Склад хранения', 'Таймслот', 'Кабинет', 'ПринятоJSON', 'ПерерасчётJSON', 'ПересортJSON', 'КластерID', 'Виртуальная', 'ИсходнаяПоставка'
];

const OZON_STOCKS_HEADERS = [
  'Кабинет', 'SKU', 'Артикул', 'Название', 'Склад', 'Кластер',
  'Доступно', 'Готовим к продаже', 'В заявках', 'В пути', 'Излишки', 'Возвраты', 'Прочее', 'Обновлено', 'КластерID'
];

const OZON_STOCK_HISTORY_HEADERS = [
  'Неделя', 'Кабинет', 'Артикул', 'КластерID', 'Кластер',
  'Дней в наличии', 'Дней наблюдений', 'Последний учтённый день', 'Обновлено'
];

const OZON_SALES_HEADERS = ['Неделя', 'Кабинет', 'Артикул', 'Кластер', 'Количество', 'Обновлено', 'Дней'];
// Item 26 (2026-08-20): the compacted 28-day blocks live in their OWN sheet.
// Reason: getOzonSales reads its sheet whole on every start-up, and 57% of «Продажи Ozon»
// was archive rows that the date window always discards — 1805 rows out of 3194 read for nothing.
// The archive is NOT frozen history: saveOzonSales rebuilds it on every sync by compacting weekly
// rows that age out of the 13-week weekly zone, so both sheets are read by the write path and
// only the weekly one is read by the start-up path.
const OZON_SALES_ARCHIVE_SHEET_NAME = 'Продажи Ozon Архив';
const OZON_SETTINGS_HEADERS = ['Ключ', 'Значение', 'Описание'];
const OZON_CLUSTERS_HEADERS = ['КластерID', 'Название', 'Добавлен', 'Уведомлён'];
const FACTORY_ORDERS_HEADERS = ['ID', 'Артикул', 'Дата заказа', 'Количество', 'Ожидаемое прибытие', 'Комментарий', 'Кто', 'Статус', 'Дата получения'];

/**
 * Item 47, stage 1. The cost of the goods sitting on Ozon, kept as a journal.
 *
 * KAN needs the cost of what lies ON OZON, while the app knows the cost of what it SHIPPED.
 * The two are bridged by a moving average: every shipment blends its own cost into whatever
 * was already there. The owner's decision of 25.08.2026 is to recompute at every shipment
 * rather than once a month — a supply arriving on the 30th then affects the cost from the
 * 30th, instead of retroactively reweighting the whole month.
 *
 * A JOURNAL, not a state table, on purpose. The current cost of an article is simply its last
 * row, so nothing has to be kept in step. It also answers the owner's requirement that the app
 * know which supply has already been counted: the operation key is written into the row, and a
 * key already present is never counted again.
 */
const OZON_COST_HEADERS = [
  'Дата', 'Кабинет', 'Артикул', 'SKU',
  'Остаток до', 'Себестоимость до', 'Отгружено', 'Себестоимость отгрузки', 'Себестоимость после',
  'OpID', 'Выгружено в КАН', 'Источник'
];
const OZON_SUPPLY_REQUESTS_HEADERS = ['ID', 'Дата', 'Кабинет', 'DraftID', 'OrderID', 'Точка отгрузки', 'Кластеры', 'Состав', 'Кто', 'Статус'];
const OZON_SETTINGS_DEFAULTS = [
  { key: 'speedWeeks',          value: 4,  desc: 'Полных недель для расчёта скорости продаж' },
  { key: 'minStockDays',        value: 7,  desc: 'Неснижаемый остаток, дней продаж' },
  { key: 'targetStockDays',     value: 30, desc: 'Целевой запас на Ozon, дней' },
  { key: 'maxClusterDays',      value: 100, desc: 'Максимальный срок продаж кластера после поставки, дней; 0 — отсекатель выключен' },
  { key: 'factoryOrderDays',    value: 60, desc: 'Объём заказа на фабрике, дней' },
  { key: 'deficitDays',         value: 7,  desc: 'Порог дефицита, дней: ниже этого запаса товар считается распроданным; 0 — коррекция скорости выключена' },
  { key: 'trendWeeks',          value: 13, desc: 'Окно тренда, недель' },
  { key: 'bestWeeks',           value: 4,  desc: 'Лучших недель для коррекции скорости' },
  { key: 'minSalesForCorrection', value: 50, desc: 'Минимум продаж за окно тренда для коррекции, шт' },
  { key: 'maxSpeedGrowth',      value: 5,  desc: 'Максимальный рост скорости при дефиците, раз' },
  { key: 'salesGrowthPct',      value: 0,  desc: 'Прирост объёма продаж, %: ручная надбавка к прогнозу заказа на фабрике' },
  { key: 'stockHistoryRetentionWeeks', value: 15, desc: 'Срок хранения истории остатков Ozon, недель' },
  { key: 'returnsToSalePct',    value: 80, desc: '% возвратов, возвращающихся в продажу' },
  { key: 'salesRetentionWeeks', value: 78, desc: 'Срок хранения продаж, недель' },
  { key: 'excludedClusters',    value: '', desc: 'КластерID без поставок, через запятую' },
  { key: 'priorityClusters',    value: '', desc: 'Приоритетные кластеры в формате КластерID:коэффициент, через запятую' },
  { key: 'maxBoxesPerCluster',  value: 30, desc: 'Максимум коробок на один кластер в одной заявке (тарифный лимит Ozon)' },
  { key: 'dropOffWarehouseId',   value: '', desc: 'ID точки отгрузки Ozon (drop-off), число' },
  { key: 'dropOffWarehouseName', value: '', desc: 'Название точки отгрузки Ozon' },
  { key: 'dropOffWarehouseType', value: '', desc: 'Тип точки отгрузки: SORTING_CENTER, CROSS_DOCK, FULL_FILLMENT, DELIVERY_POINT, ORDERS_RECEIVING_POINT' },
  { key: 'supplyDocsFolderId',    value: '1hTJPqJrkV7qC4YuUi2qm_-_9y9iDjnFe', desc: 'ID родительской папки Google Диска для документов заявок на поставку' },
  { key: 'supplyDocsLabelsFolder', value: 'ШК озон для автоматизации', desc: 'Имя папки-библиотеки с этикетками ШК товаров внутри родительской папки, файлы называются Артикул.pdf' }
];
const OZON_SETTINGS_STRING_KEYS = ['excludedClusters', 'priorityClusters', 'dropOffWarehouseId', 'dropOffWarehouseName', 'dropOffWarehouseType', 'supplyDocsFolderId', 'supplyDocsLabelsFolder'];
const OZON_DROPOFF_TYPES = ['SORTING_CENTER', 'CROSS_DOCK', 'FULL_FILLMENT', 'DELIVERY_POINT', 'ORDERS_RECEIVING_POINT'];
const OZON_SALES_RETENTION_WEEKS = 78; // дефолт ретенции продаж; действующее значение — в листе «Настройки Ozon»
const OZON_SALES_WEEKLY_ZONE_WEEKS = 13; // свежая зона: столько последних недель хранится по 7 дней
const OZON_SALES_PERIOD_ANCHOR_MS = Date.parse('2024-01-01T00:00:00Z'); // понедельник — якорь 28-дневных блоков
const OZON_SALES_PERIOD_MS = 28 * 24 * 60 * 60 * 1000;

function setupDatabase(targetSs) {
  const ss = targetSs || getSpreadsheet();
  
  // Sheet: Остатки
  let stockSheet = ss.getSheetByName('Остатки');
  if (!stockSheet) {
    stockSheet = ss.insertSheet('Остатки');
    stockSheet.appendRow(['Артикул', 'Количество на складе', 'Средняя себестоимость', 'Капитализация', 'Продажи за 120д', 'Оборачиваемость (дн)']);
    stockSheet.getRange('A1:F1').setFontWeight('bold');
  } else {
    // Миграция Остатки
    const data = stockSheet.getDataRange().getValues();
    if (data.length > 0) {
      const headers = data[0].map(h => String(h).trim());
      const expectedHeaders = ['Артикул', 'Количество на складе', 'Средняя себестоимость', 'Капитализация', 'Продажи за 120д', 'Оборачиваемость (дн)'];
      const hasNameColumn = headers.some(h => h.toLowerCase().includes('наименование'));
      const isPerfectMatch = expectedHeaders.every((h, i) => headers[i] === h);

      if (hasNameColumn || !isPerfectMatch) {
        const articleIdx = headers.findIndex(h => h.toLowerCase().includes('артикул'));
        const qtyIdx = headers.findIndex(h => h.toLowerCase().includes('количество'));
        const costIdx = headers.findIndex(h => h.toLowerCase().includes('себестоимость'));
        const capIdx = headers.findIndex(h => h.toLowerCase().includes('капитализация'));
        const salesIdx = headers.findIndex(h => h.toLowerCase().includes('продажи'));
        const turnIdx = headers.findIndex(h => h.toLowerCase().includes('оборачиваемость'));

        const newData = [expectedHeaders];
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (row.join('').trim() === '') continue;
          
          const article = articleIdx !== -1 ? String(row[articleIdx]) : String(row[0] || '');
          const qty = parseNumber(qtyIdx !== -1 ? row[qtyIdx] : row[1]);
          const cost = parseNumber(costIdx !== -1 ? row[costIdx] : row[2]);
          const cap = parseNumber(capIdx !== -1 ? row[capIdx] : row[3]);
          const sales = parseNumber(salesIdx !== -1 ? row[salesIdx] : row[4]);
          const turn = parseNumber(turnIdx !== -1 ? row[turnIdx] : row[5]);
          
          newData.push([article, qty, cost, cap, sales, turn]);
        }
        stockSheet.clear();
        stockSheet.getRange(1, 1, newData.length, 6).setValues(newData);
        stockSheet.getRange('A1:F1').setFontWeight('bold');
      }
    }
  }
  
  // Sheet: Транзакции
  let transSheet = getTransactionSheet(ss);

  if (!transSheet) {
    transSheet = ss.insertSheet('Транзакции');
    transSheet.appendRow(['ID', 'Дата', 'Тип', 'Артикул', 'Количество', 'Цена', 'Себестоимость списания', 'Сумма', 'Объект', 'Дата поставки', 'Пользователь']);
    transSheet.getRange('A1:K1').setFontWeight('bold');
  } else {
    // Миграция Транзакции
    const data = transSheet.getDataRange().getValues();
    if (data.length > 0) {
      const headers = data[0].map(h => String(h).trim());
      const expectedHeaders = ['ID', 'Дата', 'Тип', 'Артикул', 'Количество', 'Цена', 'Себестоимость списания', 'Сумма', 'Объект', 'Дата поставки', 'Пользователь'];
      const hasNameColumn = headers.some(h => h.toLowerCase().includes('наименование'));
      const isPerfectMatch = expectedHeaders.every((h, i) => headers[i] === h);

      if (hasNameColumn || !isPerfectMatch) {
        const idIdx = headers.findIndex(h => h.toLowerCase() === 'id');
        const dateIdx = headers.findIndex(h => h.toLowerCase() === 'дата');
        const typeIdx = headers.findIndex(h => h.toLowerCase() === 'тип');
        const articleIdx = headers.findIndex(h => h.toLowerCase() === 'артикул');
        const qtyIdx = headers.findIndex(h => h.toLowerCase() === 'количество');
        const priceIdx = headers.findIndex(h => h.toLowerCase() === 'цена');
        
        let writeOffIdx = headers.findIndex(h => h.toLowerCase() === 'себестоимость списания');
        if (writeOffIdx === -1) writeOffIdx = headers.findIndex(h => h.toLowerCase() === 'сумма списания');
        
        let totalIdx = headers.findIndex(h => h.toLowerCase() === 'сумма');
        if (totalIdx === -1) totalIdx = headers.findIndex(h => h.toLowerCase() === 'итого');
        
        const destIdx = headers.findIndex(h => h.toLowerCase() === 'объект');
        const deliveryDateIdx = headers.findIndex(h => h.toLowerCase() === 'дата поставки');
        const userIdx = headers.findIndex(h => h.toLowerCase() === 'пользователь');

        const newData = [expectedHeaders];
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (row.join('').trim() === '') continue;
          
          const id = idIdx !== -1 && row[idIdx] ? String(row[idIdx]) : Utilities.getUuid();
          const date = dateIdx !== -1 && row[dateIdx] ? row[dateIdx] : (row[1] || '');
          const type = typeIdx !== -1 && row[typeIdx] ? String(row[typeIdx]) : (row[2] || '');
          const article = articleIdx !== -1 && row[articleIdx] ? String(row[articleIdx]) : (row[3] || '');
          const qty = parseNumber(qtyIdx !== -1 ? row[qtyIdx] : row[4]);
          const price = parseNumber(priceIdx !== -1 ? row[priceIdx] : row[5]);
          const writeOff = parseNumber(writeOffIdx !== -1 ? row[writeOffIdx] : row[6]);
          const total = parseNumber(totalIdx !== -1 ? row[totalIdx] : row[7]);
          const dest = destIdx !== -1 && row[destIdx] ? String(row[destIdx]) : (row[8] || '');
          const deliveryDate = deliveryDateIdx !== -1 && row[deliveryDateIdx] ? String(row[deliveryDateIdx]) : (row[9] || '');
          const userObj = userIdx !== -1 && row[userIdx] ? String(row[userIdx]) : '';
          
          newData.push([id, date, type, article, qty, price, writeOff, total, dest, deliveryDate, userObj]);
        }
        
        transSheet.clear();
        transSheet.getRange(1, 1, newData.length, 11).setValues(newData);
        transSheet.getRange('A1:K1').setFontWeight('bold');
      }
    }
  }
  
  // Sheet: SKU
  let skuSheet = ss.getSheetByName('SKU');
  if (!skuSheet) {
    skuSheet = ss.insertSheet('SKU');
    skuSheet.appendRow(['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)']);
    skuSheet.getRange('A1:G1').setFontWeight('bold');
  } else {
    const data = skuSheet.getDataRange().getValues();
    if (data.length > 0) {
      const headers = data[0].map(h => String(h).trim());
      const expectedHeaders = ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)'];
      const isPerfectMatch = expectedHeaders.every((h, i) => headers[i] === h);

      if (!isPerfectMatch) {
        const skuIdx = 0; // SKU is always 0
        const pcsIdx = headers.findIndex(h => h === 'ШТ/КОР') !== -1 ? headers.findIndex(h => h === 'ШТ/КОР') : 1;
        const minStockIdx = headers.findIndex(h => h === 'Мин. остаток') !== -1 ? headers.findIndex(h => h === 'Мин. остаток') : 2;
        
        // Find existing ozon and wb barcodes (could be 'ozonBarcode', 'ШК Ozon', or just column 3/4)
        const ozonIdx = headers.findIndex(h => h === 'ozonBarcode' || h === 'ШК Ozon') !== -1 
                        ? headers.findIndex(h => h === 'ozonBarcode' || h === 'ШК Ozon') 
                        : 3;
        const wbIdx = headers.findIndex(h => h === 'wbBarcode' || h === 'Баркод WB') !== -1 
                      ? headers.findIndex(h => h === 'wbBarcode' || h === 'Баркод WB') 
                      : 4;
        const boxesPerPalletIdx = headers.findIndex(h => h === 'boxesPerPallet' || h === 'КОР/ПАЛ') !== -1
                                  ? headers.findIndex(h => h === 'boxesPerPallet' || h === 'КОР/ПАЛ')
                                  : 5;
        const volIdx = headers.findIndex(h => h === 'Литраж (л)' || h === 'volumeLiters') !== -1
          ? headers.findIndex(h => h === 'Литраж (л)' || h === 'volumeLiters') : 6;

        const newData = [expectedHeaders];
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (row.join('').trim() === '') continue;
          
          const sku = String(row[skuIdx] || '');
          const pcs = parseNumber(row[pcsIdx]);
          const minStock = parseNumber(row[minStockIdx]);
          const ozon = ozonIdx !== -1 && row[ozonIdx] && String(row[ozonIdx]) !== '0' ? String(row[ozonIdx]) : '';
          const wb = wbIdx !== -1 && row[wbIdx] && String(row[wbIdx]) !== '0' ? String(row[wbIdx]) : '';
          const bpp = boxesPerPalletIdx !== -1 && boxesPerPalletIdx < row.length ? parseNumber(row[boxesPerPalletIdx]) : 0;
          const vol = volIdx !== -1 && volIdx < row.length ? parseNumber(row[volIdx]) : 0;
          
          newData.push([sku, pcs, minStock, ozon, wb, bpp, vol]);
        }
        
        skuSheet.clear();
        skuSheet.getRange(1, 1, newData.length, 7).setValues(newData);
        skuSheet.getRange('A1:G1').setFontWeight('bold');
      }
    }
  }
  
  // Sheet: Пользователи
  let usersSheet = ss.getSheetByName('Пользователи');
  if (!usersSheet) {
    usersSheet = ss.insertSheet('Пользователи');
    usersSheet.appendRow(['Username', 'Password', 'Role']);
    usersSheet.getRange('A1:C1').setFontWeight('bold');
    // Add default admin
    usersSheet.appendRow(['Админ', hashPassword('Admin_Mercurius_2025!'), 'admin']);
  }
  
  // Sheet: Сессии
  let sessionsSheet = ss.getSheetByName('Сессии');
  if (!sessionsSheet) {
    sessionsSheet = ss.insertSheet('Сессии');
    sessionsSheet.appendRow(['Token', 'Username', 'Role', 'ExpiresAt']);
    sessionsSheet.getRange('A1:D1').setFontWeight('bold');
  }
  
  // Sheet: Удаленное
  let deletedSheet = ss.getSheetByName('Удаленное');
  if (!deletedSheet) {
    deletedSheet = ss.insertSheet('Удаленное');
    deletedSheet.appendRow(['ArchiveID', 'Type', 'DeletedAt', 'DataJSON', 'DeletedBy']);
    deletedSheet.getRange('A1:E1').setFontWeight('bold');
  } else {
    // Migrate existing sheet if missing DeletedBy
    const headers = deletedSheet.getRange('A1:E1').getValues()[0];
    if (headers[4] !== 'DeletedBy') {
      deletedSheet.getRange('A1:E1').setValues([['ArchiveID', 'Type', 'DeletedAt', 'DataJSON', 'DeletedBy']]);
    }
  }
  
  // Sheet: Услуги
  let servicesSheet = ss.getSheetByName('Услуги');
  if (!servicesSheet) {
    servicesSheet = ss.insertSheet('Услуги');
    servicesSheet.appendRow(['ID', 'Название', 'Стоимость', 'Активна']);
    servicesSheet.getRange('A1:D1').setFontWeight('bold');
    servicesSheet.setFrozenRows(1);
  }
  
  getKitSheet(ss);
  getOrCreateSheet(ss, 'Тарифы услуг', ['ServiceID', 'Стоимость', 'ДействуетС']);
  getOrCreateSheet(ss, 'Внешние отгрузки', EXTERNAL_SHIPMENTS_HEADERS);
  getOrCreateSheet(ss, 'Остатки Ozon', OZON_STOCKS_HEADERS);
  getOrCreateSheet(ss, 'История остатков Ozon', OZON_STOCK_HISTORY_HEADERS);
  getOrCreateSheet(ss, 'Продажи Ozon', OZON_SALES_HEADERS);
  getOrCreateSheet(ss, OZON_SALES_ARCHIVE_SHEET_NAME, OZON_SALES_HEADERS);
  getOrCreateSheet(ss, 'Настройки Ozon', OZON_SETTINGS_HEADERS);
  getOrCreateSheet(ss, 'Кластеры Ozon', OZON_CLUSTERS_HEADERS);
  getOrCreateSheet(ss, 'Заявки Ozon', OZON_SUPPLY_REQUESTS_HEADERS);
  getOrCreateSheet(ss, 'Себестоимость Озон', OZON_COST_HEADERS);
  return true;
}

function getSheetByNameRobust(ss, name) {
  const sheets = ss.getSheets();
  const target = name.trim().toLowerCase();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === target) {
      return sheets[i];
    }
  }
  return null;
}

function getStock() {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameRobust(ss, 'Остатки');
  if (!sheet) return [];
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  
  const lastCol = sheet.getLastColumn();
  let data = sheet.getRange(1, 1, lastRow, Math.max(lastCol, 6)).getValues();

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    
    rows.push({
      article: String(row[0]),
      quantity: parseNumber(row[1]),
      avgCost: parseNumber(row[2]),
      capitalization: parseNumber(row[3]),
      sales120: parseNumber(row[4]),
      turnover: parseNumber(row[5])
    });
  }
  
  return rows;
}

// ─── Вспомогательные функции ──────────────────────────────────────────────────

function readHeaderRow(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol <= 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
}

/**
 * Adds the columns a sheet is missing.
 *
 * 25.08.2026: the «ДопРасходы» column ended up in the History sheet TWICE. The app fires
 * several requests as it loads; two of them read the header row before either had written,
 * each concluded the column was missing, and each appended it. Reading the headers and
 * appending to them therefore has to happen inside one lock.
 *
 * The lock is taken ONLY when something is actually missing. The ordinary call — every
 * column already in place, which is every call after the first — still costs a single read
 * and never waits, so the sheets this runs on before almost every operation are not slowed.
 *
 * The new column index comes from the header row we just read rather than from
 * getLastColumn(), which can still report the pre-write width inside one execution.
 */
function ensureColumns(sheet, requiredHeaders) {
  let existingHeaders = readHeaderRow(sheet);
  const missing = requiredHeaders.filter(function(h) { return existingHeaders.indexOf(h) === -1; });
  if (missing.length === 0) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    // Another execution is adding these very columns and will finish the job.
    return;
  }
  try {
    existingHeaders = readHeaderRow(sheet);
    requiredHeaders.forEach(function(header) {
      if (existingHeaders.indexOf(header) === -1) {
        sheet.getRange(1, existingHeaders.length + 1).setValue(header);
        existingHeaders.push(header);
      }
    });
    SpreadsheetApp.flush();
    // The header cache of the transactions sheet must not survive a widened header row.
    _transHeadersCache = null;
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

const KIT_HEADERS = ['kitSku', 'componentSku', 'quantity', 'kitType'];
function getKitSheet(ss) {
  const sheet = getOrCreateSheet(ss, 'Комплекты', KIT_HEADERS);
  ensureColumns(sheet, KIT_HEADERS);
  return sheet;
}


const TRANS_HEADERS = [
  'ID', 'Дата', 'Тип', 'Артикул', 'Количество',
  'Цена', 'Себестоимость списания', 'Сумма', 'Объект', 'Дата поставки', 'Пользователь'
];

/**
 * The total of one «Упаковка»/«Прочее» part of the destination text.
 *
 * The screen writes each of them in one of two shapes, depending on whether the cost was
 * entered per piece or for the batch as a whole:
 *
 *   Упаковка: 196 шт. x 5₽ = 980₽     Прочее: 196 шт. x 55₽ = 10780₽
 *   Упаковка: 500₽                    Прочее: 55₽
 *
 * 25.08.2026: each label used to be read by a pattern that fitted ONE of its two shapes.
 * «Упаковка» demanded the «= N ₽» tail, so the whole-batch shape was silently skipped and the
 * packaging the owner had paid for never reached the cost of the goods. «Прочее» had the
 * mirror image of the defect: its pattern wanted the amount right after the label, so the
 * per-piece shape was the one that went missing.
 *
 * Both shapes end with the total, so the LAST amount of the part is the one to take — the
 * earlier «x 5₽» is the price of a single piece, not a cost of its own.
 */
function parseLabelledAmount(destination, label) {
  var part = destination.match(new RegExp(label + ':([^|\\]]*)'));
  if (!part) return 0;
  var re = /([\d.,]+)\s*₽/g, m, last = 0;
  while ((m = re.exec(part[1])) !== null) last = parseNumber(m[1]);
  return last;
}

function parseAdditionalCostsFromDestination(destination) {
  if (!destination) return 0;
  var total = parseLabelledAmount(destination, 'Упаковка') + parseLabelledAmount(destination, 'Прочее');
  var servBlock = destination.match(/Услуги:([^\]]*)/);
  if (servBlock) {
    var re = /\(([\d.,]+)\s*₽\)/g, m;
    while ((m = re.exec(servBlock[1])) !== null) total += parseNumber(m[1]);
  }
  return roundToTwo(total);
}

function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const num = Number(String(val).replace(',', '.').replace(/\s/g, ''));
  return isNaN(num) ? 0 : num;
}

function roundToTwo(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function parseTransactionRow(row, headers) {
  let dateStr = '';
  const dateIdx = headers ? headers.indexOf('Дата') : 1;
  if (dateIdx !== -1 && row[dateIdx] instanceof Date) {
    try {
      dateStr = Utilities.formatDate(row[dateIdx], Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    } catch(e) { dateStr = String(row[dateIdx]); }
  } else if (dateIdx !== -1) {
    dateStr = String(row[dateIdx] || '');
  }

  let deliveryStr = '';
  const delIdx = headers ? headers.indexOf('Дата поставки') : 9;
  if (delIdx !== -1 && row[delIdx] instanceof Date) {
    try {
      deliveryStr = Utilities.formatDate(row[delIdx], Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } catch(e) { deliveryStr = String(row[delIdx]); }
  } else if (delIdx !== -1) {
    deliveryStr = String(row[delIdx] || '');
  }

  const getCol = (names, fallbackIdx) => {
    if (!headers) return row[fallbackIdx];
    for (let name of names) {
      const idx = headers.indexOf(name);
      if (idx !== -1) return row[idx];
    }
    return row[fallbackIdx];
  };

  return {
    id:           String(getCol(['ID'], 0)),
    date:         dateStr,
    type:         String(getCol(['Тип'], 2)),
    article:      String(getCol(['Артикул'], 3)),
    quantity:     parseNumber(getCol(['Количество'], 4)),
    price:        parseNumber(getCol(['Цена'], 5)),
    writeOffCost: parseNumber(getCol(['Себестоимость списания', 'Сумма списания'], 6)),
    total:        parseNumber(getCol(['Сумма', 'Итого'], 7)),
    destination:  String(getCol(['Объект'], 8) || ''),
    deliveryDate: deliveryStr,
    user:         String(getCol(['Пользователь'], 10) || ''),
    additionalCosts: (headers && headers.indexOf('ДопРасходы') !== -1 && String(row[headers.indexOf('ДопРасходы')]).trim() !== '')
                     ? parseNumber(row[headers.indexOf('ДопРасходы')])
                     : null,
    groupId:      String(headers && headers.indexOf('groupId') !== -1 ? row[headers.indexOf('groupId')] : ''),
    isComponent:  headers && headers.indexOf('isComponent') !== -1 ? Boolean(row[headers.indexOf('isComponent')]) : false
  };
}


let _transHeadersCache = null;
let _devModeSpreadsheet = null;
function getTransColIndex(sheet, headerName) {
  if (!_transHeadersCache) {
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) return -1;
    _transHeadersCache = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(h => String(h).trim());
  }
  return _transHeadersCache.indexOf(headerName);
}

function buildTransactionRow(obj) {
  const ss = getSpreadsheet();
  const sheet = getTransactionSheet(ss);
  if (!_transHeadersCache) getTransColIndex(sheet, 'ID'); // init cache
  
  const row = new Array(_transHeadersCache.length).fill('');
  
  const map = {
    'ID': obj.id,
    'Дата': obj.date,
    'Тип': obj.type,
    'Артикул': obj.article,
    'Количество': obj.quantity,
    'Цена': obj.price,
    'Себестоимость списания': obj.writeOffCost,
    'Сумма списания': obj.writeOffCost,
    'Сумма': obj.total,
    'Итого': obj.total,
    'Объект': obj.destination,
    'Дата поставки': obj.deliveryDate,
    'Пользователь': obj.user,
    'groupId': obj.groupId || '',
    'isComponent': obj.isComponent || false,
    'ДопРасходы': obj.additionalCosts
  };
  
  for (let i = 0; i < _transHeadersCache.length; i++) {
    const header = _transHeadersCache[i];
    if (map[header] !== undefined) {
      row[i] = map[header];
    }
  }
  return row;
}

function getTransactionSheet(ss) {
  const sheet1 = getSheetByNameRobust(ss, 'Транзакции');
  const sheet2 = getSheetByNameRobust(ss, 'История');
  let finalSheet = null;
  if (sheet1 && sheet2) {
    finalSheet = sheet1.getLastRow() >= sheet2.getLastRow() ? sheet1 : sheet2;
  } else {
    finalSheet = sheet1 || sheet2;
  }
  if (finalSheet) {
    ensureColumns(finalSheet, ['groupId', 'isComponent', 'OpID', 'ДопРасходы']);
  }
  return finalSheet;
}


// ─── Вариант 2: фильтрация на стороне GAS ─────────────────────────────────────

function getTransactions(params) {
  params = params || {};
  const dateFrom = params.dateFrom || null;
  const dateTo   = params.dateTo   || null;
  const article  = params.article  || null;
  const type     = params.type     || null;
  const limit    = Math.min(params.limit || 100000, 100000);
  const offset   = Math.max(params.offset || 0, 0);

  const ss    = getSpreadsheet();
  const sheet = getTransactionSheet(ss);
  if (!sheet) return { rows: [], total: 0, hasMore: false, offset, limit };

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { rows: [], total: 0, hasMore: false, offset, limit };

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const fromMs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
  const toMs   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : Infinity;

  const filtered = [];

  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    if (!row[0] || String(row[0]).trim() === '') continue;

    let rowMs = 0;
    if (row[1] instanceof Date) {
      rowMs = row[1].getTime();
    } else {
      const parsed = new Date(String(row[1]));
      rowMs = isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }

    if (dateTo   && rowMs > toMs)   { continue; }
    if (dateFrom && rowMs < fromMs) { continue; }

    if (article && String(row[3]) !== article) { continue; }
    if (type    && String(row[2]) !== type)    { continue; }

    filtered.push(parseTransactionRow(row, headers));
  }

  const total = filtered.length;
  const page  = filtered.slice(offset, offset + limit);

  return {
    rows: page,
    total: total,
    hasMore: (offset + limit) < total,
    offset: offset,
    limit: limit
  };
}

// ─── Вариант 4: архивация старых транзакций ───────────────────────────────────

function archiveOldTransactions(monthsToKeep) {
  monthsToKeep = monthsToKeep || 6;

  const ss    = getSpreadsheet();
  const sheet = getTransactionSheet(ss);
  if (!sheet) return { archived: 0, kept: 0 };

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { archived: 0, kept: 0 };

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsToKeep);
  cutoff.setHours(0, 0, 0, 0);
  const cutoffMs = cutoff.getTime();

  const archiveMap = {};
  const toKeep     = [headers];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;

    let rowMs = 0;
    let rowYear = '';
    if (row[1] instanceof Date) {
      rowMs   = row[1].getTime();
      rowYear = String(row[1].getFullYear());
    } else {
      const d = new Date(String(row[1]));
      if (!isNaN(d.getTime())) {
        rowMs   = d.getTime();
        rowYear = String(d.getFullYear());
      }
    }

    if (rowMs > 0 && rowMs < cutoffMs) {
      if (!archiveMap[rowYear]) archiveMap[rowYear] = [];
      archiveMap[rowYear].push(row);
    } else {
      toKeep.push(row);
    }
  }

  const totalArchived = Object.values(archiveMap)
    .reduce((sum, rows) => sum + rows.length, 0);

  if (totalArchived === 0) {
    return { archived: 0, kept: toKeep.length - 1, message: 'Нечего архивировать' };
  }

  for (const year in archiveMap) {
    const archiveName = 'Архив_' + year;
    let archiveSheet  = ss.getSheetByName(archiveName);

    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(archiveName);
      archiveSheet.appendRow(headers);
      archiveSheet.getRange('A1:K1').setFontWeight('bold');
      archiveSheet.hideSheet();
    }

    const insertFrom = archiveSheet.getLastRow() + 1;
    const rows       = archiveMap[year];
    archiveSheet.getRange(insertFrom, 1, rows.length, lastCol).setValues(rows);
  }

  sheet.clear();
  sheet.getRange(1, 1, toKeep.length, lastCol).setValues(toKeep);
  sheet.getRange('A1:K1').setFontWeight('bold');

  Logger.log('Архивация: ' + totalArchived + ' строк перенесено, ' + 
             (toKeep.length - 1) + ' оставлено');

  return {
    archived: totalArchived,
    kept:     toKeep.length - 1,
    years:    Object.keys(archiveMap)
  };
}

function setupArchiveTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'monthlyArchive')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('monthlyArchive')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .create();

  Logger.log('Триггер архивации установлен');
}

function monthlyArchive() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 30 sec lock
    archiveOldTransactions(6);
  } catch(err) {
    console.error('Ошибка ежемесячной архивации:', err);
  }
}

function runArchiveOldTransactionsAsBackground(e) {
  if (e && e.triggerUid) {
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t);
    });
  }
  const props = PropertiesService.getScriptProperties();
  const monthsStr = props.getProperty('archive_monthsToKeep');
  const monthsToKeep = monthsStr ? Number(monthsStr) : 6;
  
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Wait up to 30s
    archiveOldTransactions(monthsToKeep);
  } catch(err) {
    console.error('Ошибка фоновой архивации:', err);
  }
}

function getSkus() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) return [];
  
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)', 'Срок поставки (дни)', 'Название Ozon']);
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const headers = data[0].map(h => String(h).trim());
  const skuIdx = headers.indexOf('SKU') !== -1 ? headers.indexOf('SKU') : 0;
  const pcsIdx = headers.indexOf('ШТ/КОР') !== -1 ? headers.indexOf('ШТ/КОР') : 1;
  const minStockIdx = headers.indexOf('Мин. остаток') !== -1 ? headers.indexOf('Мин. остаток') : 2;
  const ozonIdx = headers.indexOf('ШК Ozon') !== -1 ? headers.indexOf('ШК Ozon') : 3;
  const wbIdx = headers.indexOf('Баркод WB') !== -1 ? headers.indexOf('Баркод WB') : 4;
  const bppIdx = headers.indexOf('КОР/ПАЛ') !== -1 ? headers.indexOf('КОР/ПАЛ') : 5;
  const volIdx = headers.indexOf('Литраж (л)') !== -1 ? headers.indexOf('Литраж (л)') : 6;
  const leadIdx = headers.indexOf('Срок поставки (дни)') !== -1 ? headers.indexOf('Срок поставки (дни)') : 7;
  // Запасного номера колонки тут быть не может: «Название Ozon» дописывается в конец листа,
  // и её позиция зависит от того, сколько колонок уже было в конкретной базе.
  const nameIdx = headers.indexOf('Название Ozon');
  
  const rows = data.slice(1);
  
  return rows.map(row => {
    const ozon = ozonIdx !== -1 && ozonIdx < row.length ? String(row[ozonIdx] || '') : '';
    const wb = wbIdx !== -1 && wbIdx < row.length ? String(row[wbIdx] || '') : '';
    return {
      sku: skuIdx !== -1 && skuIdx < row.length ? String(row[skuIdx] || '') : '',
      pcsPerBox: pcsIdx !== -1 && pcsIdx < row.length ? Number(row[pcsIdx]) || 1 : 1,
      minStock: minStockIdx !== -1 && minStockIdx < row.length ? Number(row[minStockIdx]) || 0 : 0,
      ozonBarcode: ozon === '0' ? '' : ozon,
      wbBarcode: wb === '0' ? '' : wb,
      boxesPerPallet: bppIdx !== -1 && bppIdx < row.length ? Number(row[bppIdx]) || 0 : 0,
      volumeLiters: volIdx !== -1 && volIdx < row.length ? Number(row[volIdx]) || 0 : 0,
      leadTimeDays: leadIdx !== -1 && leadIdx < row.length ? Number(row[leadIdx]) || 0 : 0,
      name: nameIdx !== -1 && nameIdx < row.length ? String(row[nameIdx] || '') : ''
    };
  });
}

function addSku(skuData) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден. Выполните инициализацию.');
  
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)', 'Срок поставки (дни)', 'Название Ozon']);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const skuIdx = headers.indexOf('SKU') !== -1 ? headers.indexOf('SKU') : 0;
  const ozonIdx = headers.indexOf('ШК Ozon') !== -1 ? headers.indexOf('ШК Ozon') : 3;
  const wbIdx = headers.indexOf('Баркод WB') !== -1 ? headers.indexOf('Баркод WB') : 4;
  const pcsIdx = headers.indexOf('ШТ/КОР') !== -1 ? headers.indexOf('ШТ/КОР') : 1;
  const minStockIdx = headers.indexOf('Мин. остаток') !== -1 ? headers.indexOf('Мин. остаток') : 2;
  const bppIdx = headers.indexOf('КОР/ПАЛ') !== -1 ? headers.indexOf('КОР/ПАЛ') : 5;
  const volIdx = headers.indexOf('Литраж (л)') !== -1 ? headers.indexOf('Литраж (л)') : 6;
  const leadIdx = headers.indexOf('Срок поставки (дни)') !== -1 ? headers.indexOf('Срок поставки (дни)') : 7;

  for (let i = 1; i < data.length; i++) {
    const existingOzon = ozonIdx !== -1 && ozonIdx < data[i].length ? String(data[i][ozonIdx]) : '';
    const existingWb = wbIdx !== -1 && wbIdx < data[i].length ? String(data[i][wbIdx]) : '';
    if (skuData.ozonBarcode && existingOzon !== '0' && existingOzon !== '' && existingOzon === String(skuData.ozonBarcode)) {
      throw new Error(`ШК ${skuData.ozonBarcode} уже привязан к артикулу ${data[i][skuIdx]}`);
    }
    if (skuData.wbBarcode && existingWb !== '0' && existingWb !== '' && existingWb === String(skuData.wbBarcode)) {
      throw new Error(`Баркод ${skuData.wbBarcode} уже привязан к артикулу ${data[i][skuIdx]}`);
    }
  }
  
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const newRow = new Array(currentHeaders.length).fill('');
  
  if (skuIdx !== -1) newRow[skuIdx] = skuData.sku;
  if (pcsIdx !== -1) newRow[pcsIdx] = skuData.pcsPerBox;
  if (minStockIdx !== -1) newRow[minStockIdx] = skuData.minStock;
  if (ozonIdx !== -1) newRow[ozonIdx] = skuData.ozonBarcode || '';
  if (wbIdx !== -1) newRow[wbIdx] = skuData.wbBarcode || '';
  if (bppIdx !== -1) newRow[bppIdx] = skuData.boxesPerPallet || 0;
  if (volIdx !== -1) newRow[volIdx] = skuData.volumeLiters || 0;
  if (leadIdx !== -1) newRow[leadIdx] = skuData.leadTimeDays || 0;
  
  sheet.appendRow(newRow);
  
  return getSkus();
}

function updateSku(skuData, oldSku) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден.');
  
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)', 'Срок поставки (дни)', 'Название Ozon']);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  
  const skuIdx = headers.indexOf('SKU') !== -1 ? headers.indexOf('SKU') : 0;
  const pcsIdx = headers.indexOf('ШТ/КОР') !== -1 ? headers.indexOf('ШТ/КОР') : 1;
  const minStockIdx = headers.indexOf('Мин. остаток') !== -1 ? headers.indexOf('Мин. остаток') : 2;
  const ozonIdx = headers.indexOf('ШК Ozon') !== -1 ? headers.indexOf('ШК Ozon') : 3;
  const wbIdx = headers.indexOf('Баркод WB') !== -1 ? headers.indexOf('Баркод WB') : 4;
  const bppIdx = headers.indexOf('КОР/ПАЛ') !== -1 ? headers.indexOf('КОР/ПАЛ') : 5;
  const volIdx = headers.indexOf('Литраж (л)') !== -1 ? headers.indexOf('Литраж (л)') : 6;
  const leadIdx = headers.indexOf('Срок поставки (дни)') !== -1 ? headers.indexOf('Срок поставки (дни)') : 7;
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][skuIdx]) !== String(oldSku)) {
      const existingOzon = ozonIdx !== -1 && ozonIdx < data[i].length ? String(data[i][ozonIdx]) : '';
      const existingWb = wbIdx !== -1 && wbIdx < data[i].length ? String(data[i][wbIdx]) : '';
      if (skuData.ozonBarcode && existingOzon !== '0' && existingOzon !== '' && existingOzon === String(skuData.ozonBarcode)) {
        throw new Error(`ШК ${skuData.ozonBarcode} уже привязан к артикулу ${data[i][skuIdx]}`);
      }
      if (skuData.wbBarcode && existingWb !== '0' && existingWb !== '' && existingWb === String(skuData.wbBarcode)) {
        throw new Error(`Баркод ${skuData.wbBarcode} уже привязан к артикулу ${data[i][skuIdx]}`);
      }
    }
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][skuIdx]) === String(oldSku)) {
      const updatedRow = [...data[i]];
      // Make sure array is long enough
      while (updatedRow.length < headers.length) {
        updatedRow.push('');
      }
      if (skuIdx !== -1) updatedRow[skuIdx] = skuData.sku;
      if (pcsIdx !== -1) updatedRow[pcsIdx] = skuData.pcsPerBox;
      if (minStockIdx !== -1) updatedRow[minStockIdx] = skuData.minStock;
      if (ozonIdx !== -1) updatedRow[ozonIdx] = skuData.ozonBarcode || '';
      if (wbIdx !== -1) updatedRow[wbIdx] = skuData.wbBarcode || '';
      if (bppIdx !== -1) updatedRow[bppIdx] = skuData.boxesPerPallet || 0;
      if (volIdx !== -1) updatedRow[volIdx] = skuData.volumeLiters || 0;
      if (leadIdx !== -1) updatedRow[leadIdx] = skuData.leadTimeDays || 0;
      
      sheet.getRange(i + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
      
      const stockSheet = ss.getSheetByName('Остатки');
      if (stockSheet) {
        const stockData = stockSheet.getDataRange().getValues();
        for (let j = 1; j < stockData.length; j++) {
          if (String(stockData[j][0]) === String(oldSku)) {
            stockSheet.getRange(j + 1, 1).setValue(skuData.sku);
            break;
          }
        }
      }
      break;
    }
  }
  
  return { skus: getSkus(), stock: getStock() };
}

function ensureSkuExists(article) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) return;
  
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)', 'Название Ozon']);
  
  const data = sheet.getDataRange().getValues();
  const exists = data.some(row => String(row[0]) === String(article));
  
  if (!exists) {
    const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const newRow = new Array(currentHeaders.length).fill('');
    
    const skuIdx = currentHeaders.indexOf('SKU') !== -1 ? currentHeaders.indexOf('SKU') : 0;
    const pcsIdx = currentHeaders.indexOf('ШТ/КОР') !== -1 ? currentHeaders.indexOf('ШТ/КОР') : 1;
    const minStockIdx = currentHeaders.indexOf('Мин. остаток') !== -1 ? currentHeaders.indexOf('Мин. остаток') : 2;
    const ozonIdx = currentHeaders.indexOf('ШК Ozon') !== -1 ? currentHeaders.indexOf('ШК Ozon') : 3;
    const wbIdx = currentHeaders.indexOf('Баркод WB') !== -1 ? currentHeaders.indexOf('Баркод WB') : 4;
    const bppIdx = currentHeaders.indexOf('КОР/ПАЛ') !== -1 ? currentHeaders.indexOf('КОР/ПАЛ') : 5;
    const volIdx = currentHeaders.indexOf('Литраж (л)') !== -1 ? currentHeaders.indexOf('Литраж (л)') : 6;
    
    if (skuIdx !== -1) newRow[skuIdx] = article;
    if (pcsIdx !== -1) newRow[pcsIdx] = 1;
    if (minStockIdx !== -1) newRow[minStockIdx] = 0;
    if (ozonIdx !== -1) newRow[ozonIdx] = '';
    if (wbIdx !== -1) newRow[wbIdx] = '';
    if (bppIdx !== -1) newRow[bppIdx] = 0;
    if (volIdx !== -1) newRow[volIdx] = 0;
    
    sheet.appendRow(newRow);
  }
}

function deleteSku(sku, deletedBy) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден.');
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sku)) {
      const rowData = data[i];
      if (typeof archiveItem === 'function') archiveItem('SKU', { sku: rowData[0], pcsPerBox: rowData[1], minStock: rowData[2], ozonBarcode: rowData[3], wbBarcode: rowData[4] }, deletedBy);
      sheet.deleteRow(i + 1);
      break;
    }
  }
  
  return getSkus();
}

function deleteTransaction(id, deletedBy, isUpdate = false) {
  const ss = getSpreadsheet();
  const transSheet = getTransactionSheet(ss);
  
  if (!transSheet) throw new Error('База данных не инициализирована');
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');
  
  if (!transSheet || !stockSheet) throw new Error('База данных не инициализирована');
  
  const transDataAll = transSheet.getDataRange().getValues();
  if (transDataAll.length <= 1) throw new Error('Нет транзакций');

  const headers = transDataAll[0].map(h => String(h).trim());
  const gIdx = headers.indexOf('groupId');
  const cIdx = headers.indexOf('isComponent');
  const wocIdx = headers.indexOf('Себестоимость списания');
  const destIdx = headers.indexOf('Объект') !== -1 ? headers.indexOf('Объект') : 8;

  let rowIndex = -1;
  let transData = null;
  
  for (let i = 1; i < transDataAll.length; i++) {
    if (String(transDataAll[i][0]) === String(id)) {
      rowIndex = i + 1;
      transData = transDataAll[i];
      break;
    }
  }
  
  if (rowIndex === -1 || !transData) throw new Error('Транзакция не найдена.');
  
  const type = transData[2];
  const article = String(transData[3]);
  const qty = Number(transData[4]);
  const price = Number(transData[5]);
  const writeOffCost = Number(transData[6]);
  const total = Number(transData[7]);
  const dest = String(transData[destIdx] || '');
  
  let dateStr = '';
  if (transData[1] instanceof Date) {
    dateStr = transData[1].toISOString();
  } else {
    dateStr = String(transData[1]);
  }
  let deliveryDateStr = '';
  if (transData[9] instanceof Date) {
    deliveryDateStr = transData[9].toISOString();
  } else {
    deliveryDateStr = String(transData[9] || '');
  }

  if (typeof archiveItem === 'function') {
    archiveItem('Transaction', {
      id: String(transData[0]),
      date: dateStr,
      type: isUpdate ? 'UpdatedVersion' : type,
      article: article,
      quantity: qty,
      price: price,
      writeOffCost: writeOffCost,
      total: total,
      destination: dest,
      deliveryDate: deliveryDateStr,
      user: String(transData[10] || '')
    }, deletedBy);
  }
  
  const stockData = stockSheet.getDataRange().getValues();
  const isVirtualKitMainRowRefund = (type === 'Расход' && writeOffCost === 0 && (gIdx !== -1 && transData[gIdx]));
  if (!isVirtualKitMainRowRefund) {
    for (let i = 1; i < stockData.length; i++) {
      // Indexes: 0=article, 1=qty, 2=avgCost, 3=cap, 4=sales, 5=turnover
      if (String(stockData[i][0]) === article) {
        let newQty = Number(stockData[i][1]);
        let newAvgCost = Number(stockData[i][2]);
        let newCap = Number(stockData[i][3]);
        
        if (type === 'Приход') {
          newQty -= qty;
          if (newQty < 0) {
            throw new Error(`Удаление этого прихода приведёт к отрицательному остатку товара "${article}". Доступно: ${newQty + qty}, нужно удалить: ${qty}. Сначала отмените расходы, ссылающиеся на этот товар.`);
          }
          newCap = roundToTwo(newCap - total);
          newAvgCost = newQty > 0 ? roundToTwo(newCap / newQty) : 0;
        } else if (type === 'Расход') {
          newQty += qty;
          if (isWriteOffDestination(dest) && !isCapitalizationZeroed(dest)) {
            // Капитализация НЕ увеличивается при удалении списания:
            // при проведении её не снимали, значит и возвращать нечего.
            // Пункт 40, этап A: если списание было проведено с меткой «себестоимость обнулена»,
            // деньги с артикула реально сняли — тогда идём в общую ветку и возвращаем их.
          } else {
            newCap = roundToTwo(newCap + writeOffCost);
          }
          newAvgCost = newQty > 0 ? roundToTwo(newCap / newQty) : 0;
        }
        
        stockSheet.getRange(i + 1, 2, 1, 3).setValues([[newQty, newAvgCost, newCap]]);
        break;
      }
    }
  }

  // Check for components of a kit
  if (gIdx !== -1 && cIdx !== -1 && type === 'Расход' && transData[gIdx]) {
    const groupId = transData[gIdx];
    for (let k = transDataAll.length - 1; k >= 1; k--) {
      if (String(transDataAll[k][gIdx]) === String(groupId) && transDataAll[k][2] === 'Расход' && (transDataAll[k][cIdx] === true || String(transDataAll[k][cIdx]).toLowerCase() === 'true')) {
        for (let j = 1; j < stockData.length; j++) {
           if (String(stockData[j][0]) === String(transDataAll[k][3])) {
              let nQty = Number(stockData[j][1]) + Number(transDataAll[k][4]);
              const componentWoc = Number(transDataAll[k][wocIdx !== -1 ? wocIdx : 6]) || 0;
              const componentDest = String(transDataAll[k][destIdx] || '');
              let nCap;
              // Пункт 40, этап A: обнулённое списание компонента забрало себестоимость,
              // поэтому при удалении она возвращается наравне с обычным расходом.
              if (isWriteOffDestination(componentDest) && !isCapitalizationZeroed(componentDest)) {
                nCap = Number(stockData[j][3]);
              } else {
                nCap = roundToTwo(Number(stockData[j][3]) + componentWoc);
              }
              let nAvg = nQty > 0 ? roundToTwo(nCap / nQty) : 0;
              stockSheet.getRange(j + 1, 2, 1, 3).setValues([[nQty, nAvg, nCap]]);
              break;
           }
        }
        transSheet.deleteRow(k + 1);
        if (k + 1 < rowIndex) { rowIndex = rowIndex - 1; }
      }
    }
  }

  transSheet.deleteRow(rowIndex);
  SpreadsheetApp.flush();
  return { stock: getStock(), transactions: getTransactions().rows };
}

function updateTransaction(id, data, username) {
  // Item 56, stage 2. The additional costs of an operation now live in their own column.
  // An edit deletes the row and writes it again, so the number has to be read BEFORE the
  // delete: for a batch write-off the destination text names the cost of the whole batch,
  // and re-parsing it would charge that whole cost to this one order.
  let storedAdditional = null;
  try {
    const priorRows = getTransactions().rows;
    for (let i = 0; i < priorRows.length; i++) {
      if (String(priorRows[i].id) === String(id)) {
        storedAdditional = priorRows[i].additionalCosts;
        break;
      }
    }
  } catch (e) {
    storedAdditional = null;
  }
  const editedAdditional = (data.additionalCosts !== null && data.additionalCosts !== undefined
    && String(data.additionalCosts).trim() !== '') ? data.additionalCosts : storedAdditional;

  deleteTransaction(id, username, true);
  const commitResult = commitTransaction(data, data.type, data.destination, data.deliveryDate || '', username, data.date || '', '', editedAdditional);
  return {
    stock: getStock(),
    newTransactions: getTransactions().rows,
    skus: getSkus()
  };
}

function isWriteOffDestination(dest) {
  return String(dest || '').indexOf('Списание') !== -1;
}

/**
 * Пункт 40, этап A. Списание бывает двух видов, и владелец выбирает вид в момент проведения:
 * либо себестоимость остаётся «долгом» на артикуле (поведение по умолчанию), либо она
 * обнуляется вместе с товаром. Метка «себестоимость обнулена» едет ВНУТРИ строки объекта
 * (например: «Склад [Списание - Брак] [себестоимость обнулена]»), а не в отдельной колонке.
 * Так выбор попадает в лист «История» вместе с операцией, и удаление, восстановление
 * и массовые операции спустя годы отличат один вид списания от другого по той же строке,
 * без миграции таблицы и без новых параметров.
 */
function isCapitalizationZeroed(dest) {
  return String(dest || '').indexOf('себестоимость обнулена') !== -1;
}

/**
 * Пункт 28, этап A. Ищет в листе истории строки с указанным ключом операции.
 * Сначала читает только колонку ключей, полные строки дочитывает лишь при совпадении.
 * Возвращает массив разобранных транзакций; пустой массив — ключ ещё не встречался.
 */
function findTransactionsByOpId(transSheet, opIdStr) {
  if (!transSheet || !opIdStr) return [];
  const lastRow = transSheet.getLastRow();
  const lastCol = transSheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];
  const headers = transSheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return String(h).trim(); });
  const opIdx = headers.indexOf('OpID');
  if (opIdx === -1) return [];
  const keys = transSheet.getRange(2, opIdx + 1, lastRow - 1, 1).getValues();
  const hitRows = [];
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === opIdStr) hitRows.push(i + 2);
  }
  if (hitRows.length === 0) return [];
  const found = [];
  for (let j = 0; j < hitRows.length; j++) {
    const row = transSheet.getRange(hitRows[j], 1, 1, lastCol).getValues()[0];
    found.push(parseTransactionRow(row, headers));
  }
  return found;
}

function commitTransaction(data, type, destination, deliveryDate, username, originalDate, opId, explicitAdditionalCosts) {
  const items = Array.isArray(data) ? data : [data];

  // Item 56, stage 2. Additional costs of the operation, stated as a number by the caller.
  // Until now they were dug out of the destination text by regex, which cannot serve a batch
  // write-off: several orders shipped together are written as several expenses, and the text
  // of each one names the cost of the whole batch. Parsing it would charge the batch in full
  // to every order. When the number is absent the old text parsing still applies, so every
  // expense written before this change, and every one written by an older client, is unaffected.
  const hasExplicitAdditional = explicitAdditionalCosts !== null
    && explicitAdditionalCosts !== undefined
    && String(explicitAdditionalCosts).trim() !== '';
  const explicitAdditional = hasExplicitAdditional ? roundToTwo(parseNumber(explicitAdditionalCosts)) : 0;
  const dateStr = originalDate || new Date().toISOString();
  const ss = getSpreadsheet();
  const transSheet = getTransactionSheet(ss);
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');

  // Пункт 28, этап A: защита от двойного проведения одной и той же операции.
  // Выполняется внутри замка, который doPost захватывает до switch.
  const opIdStr = String(opId || '').trim();
  if (opIdStr) {
    const alreadyWritten = findTransactionsByOpId(transSheet, opIdStr);
    if (alreadyWritten.length > 0) {
      return {
        stock: getStock(),
        newTransactions: alreadyWritten,
        skus: getSkus(),
        idempotentHit: true
      };
    }
  }
  
  const stockData = stockSheet.getDataRange().getValues();
  const stockMap = {};
  for (let i = 1; i < stockData.length; i++) {
    const row = stockData[i];
    stockMap[String(row[0])] = {
      rowIdx: i + 1,
      quantity: Number(row[1]),
      avgCost: Number(row[2]),
      capitalization: Number(row[3])
    };
  }

  if (type === 'Расход') {
    const requestedQty = {};
    items.forEach(item => {
      if (item.status && item.status !== 'ok') return;
      requestedQty[item.article] = (requestedQty[item.article] || 0) + Number(item.quantity);
    });
    
    // Validate main kits components
    const errors = [];
    const componentDemand = {};
    for (const article in requestedQty) {
      const kitData = getKitComponents(article);
      const isKit = kitData.components && kitData.components.length > 0;
      if (isKit) {
        for (const comp of kitData.components) {
          const needed = comp.quantity * requestedQty[article];
          componentDemand[comp.componentSku] = (componentDemand[comp.componentSku] || 0) + needed;
        }
        if (kitData.type === 'legacy') {
          const available = stockMap[article] ? stockMap[article].quantity : 0;
          if (requestedQty[article] > available) {
            errors.push('Недостаточно товара "' + article + '". Доступно: ' + available + ', требуется: ' + requestedQty[article]);
          }
        }
      } else {
        const available = stockMap[article] ? stockMap[article].quantity : 0;
        if (requestedQty[article] > available) {
          errors.push('Недостаточно товара "' + article + '". Доступно: ' + available + ', требуется: ' + requestedQty[article]);
        }
      }
    }
    
    for (const compSku in componentDemand) {
      const needed = componentDemand[compSku];
      const available = stockMap[compSku] ? stockMap[compSku].quantity : 0;
      if (available < needed) {
        errors.push('Нет ' + compSku + ': нужно ' + needed + ' шт., есть ' + available + ' шт.');
      }
    }
    if (errors.length > 0) {
      throw new Error('Недостаточно наличия на складе:\n' + errors.join('\n'));
    }
  }
  
  const newTransactions = [];
  const shipmentTotalQty = items.reduce(function(s, it){ if (it.status && it.status !== 'ok') return s; return s + (Number(it.quantity) || 0); }, 0);
  
  const rowsToAppend = [];
  items.forEach(item => {
    if (item.status && item.status !== 'ok') return;
    
    const article = item.article;
    const qty = Number(item.quantity);
    const price = roundToTwo(Number(item.price));
    const total = roundToTwo(qty * price);
    
    let writeOffCost = 0;
    let componentsTotal = 0;
    let kitGroupId = '';
    let isVirtualKit = false;
    
    // Kit logic for Расход
    if (type === 'Расход') {
      const kitData = getKitComponents(article);
      if (kitData.components && kitData.components.length > 0) {
        if (kitData.type === 'virtual') {
          isVirtualKit = true;
        }
        kitGroupId = Utilities.getUuid();
        
        for (const comp of kitData.components) {
          const compQty = comp.quantity * qty;
          const compStock = stockMap[comp.componentSku] || { quantity: 0, avgCost: 0, capitalization: 0 };
          const compAvg = compStock.avgCost;
          const compTotal = roundToTwo(compAvg * compQty);
          componentsTotal += compTotal;
          
          const newCompQty = compStock.quantity - compQty;
          let newCompCap;
          let newCompAvg;
          if (isWriteOffDestination(destination) && !isCapitalizationZeroed(destination)) {
            // Пункт 40, этап B. Списание уменьшает количество, но НЕ себестоимость:
            // стоимость брака остаётся на артикуле. При нулевом остатке капитализацию
            // тоже не обнуляем — это «долг себестоимости», который пока не нашёл носителя:
            // он ляжет на ближайший приход, а владельцу виден по бейджу «долг себестоимости»
            // на вкладке «Склад». Средняя при нулевом количестве не определена, поэтому 0.
            // Пункт 40, этап A: с меткой «себестоимость обнулена» владелец выбрал не копить долг,
            // и компонент уходит по обычным правилам расхода — капитализация уменьшается.
            newCompCap = compStock.capitalization;
            newCompAvg = newCompQty > 0 ? roundToTwo(newCompCap / newCompQty) : 0;
          } else {
            newCompCap = roundToTwo(compStock.capitalization - compTotal);
            newCompAvg = compAvg;
          }
          
          if (stockMap[comp.componentSku]) {
            stockMap[comp.componentSku].quantity = newCompQty;
            stockMap[comp.componentSku].capitalization = newCompCap;
            stockMap[comp.componentSku].avgCost = newCompAvg;
            stockSheet.getRange(compStock.rowIdx, 2, 1, 3).setValues([[newCompQty, newCompAvg, newCompCap]]);
          }
          
          const compTransId = Utilities.getUuid();
          const compRow = buildTransactionRow({
            id:          compTransId,
            date:        dateStr,
            type:        'Расход',
            article:     comp.componentSku,
            quantity:    compQty,
            price:       compAvg,
            writeOffCost: compTotal,
            total:       compTotal,
            destination: destination,
            deliveryDate: '',
            comment:     'Авто: комплект ' + article,
            user:        username,
            groupId:     kitGroupId,
            isComponent: true
          });
          
          rowsToAppend.push(compRow);
          
          newTransactions.push({
            id: compTransId,
            date: dateStr,
            type: 'Расход',
            article: comp.componentSku,
            quantity: compQty,
            price: compAvg,
            writeOffCost: compTotal,
            total: compTotal,
            destination: destination,
            deliveryDate: '',
            user: username,
            groupId: kitGroupId,
            isComponent: true
          });
        }
      }
    }
    
    if (type === 'Приход') {
      ensureSkuExists(article);
      if (stockMap[article]) {
        const curr = stockMap[article];
        const newQty = curr.quantity + qty;
        const newCap = roundToTwo(curr.capitalization + total);
        const newAvgCost = newQty > 0 ? roundToTwo(newCap / newQty) : 0;
        
        stockMap[article].quantity = newQty;
        stockMap[article].capitalization = newCap;
        stockMap[article].avgCost = newAvgCost;
        
        stockSheet.getRange(curr.rowIdx, 2, 1, 3).setValues([[newQty, newAvgCost, newCap]]);
      } else {
        stockSheet.appendRow([article, qty, price, total, 0, 0]);
        stockMap[article] = {
          rowIdx: stockSheet.getLastRow(),
          quantity: qty,
          avgCost: price,
          capitalization: total,
          sales120: 0,
          turnover: 0
        };
      }
    } else if (type === 'Расход') {
      if (isVirtualKit) {
        writeOffCost = 0;
      } else {
        if (stockMap[article]) {
          const curr = stockMap[article];
          writeOffCost = roundToTwo(curr.avgCost * qty);
          
          const newQty = curr.quantity - qty;
          let newCap;
          let newAvgCost;
          if (isWriteOffDestination(destination) && !isCapitalizationZeroed(destination)) {
            // Пункт 40, этап B. Списание уменьшает количество, но НЕ себестоимость:
            // стоимость брака остаётся на артикуле. При нулевом остатке капитализацию
            // тоже не обнуляем — это «долг себестоимости», который пока не нашёл носителя:
            // он ляжет на ближайший приход, а владельцу виден по бейджу «долг себестоимости»
            // на вкладке «Склад». Средняя при нулевом количестве не определена, поэтому 0.
            // Пункт 40, этап A: с меткой «себестоимость обнулена» владелец выбрал не копить долг,
            // и товар уходит по обычным правилам расхода — капитализация уменьшается.
            newCap = curr.capitalization;
            newAvgCost = newQty > 0 ? roundToTwo(newCap / newQty) : 0;
          } else {
            newCap = roundToTwo(curr.capitalization - writeOffCost);
            newAvgCost = curr.avgCost;
          }
          
          stockMap[article].quantity = newQty;
          stockMap[article].capitalization = newCap;
          stockMap[article].avgCost = newAvgCost;
          
          stockSheet.getRange(curr.rowIdx, 2, 1, 3).setValues([[newQty, newAvgCost, newCap]]);
        }
      }
    }
    
    const shipmentAdditional = (type !== 'Расход')
      ? 0
      : (hasExplicitAdditional ? explicitAdditional : parseAdditionalCostsFromDestination(destination));
    const additionalCosts = (shipmentAdditional > 0 && shipmentTotalQty > 0) ? roundToTwo(shipmentAdditional * qty / shipmentTotalQty) : 0;
    const mainTotal = (type === 'Расход')
      ? (kitGroupId ? roundToTwo(writeOffCost + componentsTotal + additionalCosts) : roundToTwo(total + additionalCosts))
      : total;
    const mainPrice = (type === 'Расход' && qty > 0 && (kitGroupId || additionalCosts > 0)) ? roundToTwo(mainTotal / qty) : price;
    
    const transId = Utilities.getUuid();
    
    const mainRow = buildTransactionRow({
      id: transId,
      date: dateStr,
      type: type,
      article: article,
      quantity: qty,
      price: mainPrice,
      writeOffCost: writeOffCost,
      total: mainTotal,
      destination: destination,
      deliveryDate: deliveryDate,
      user: username,
      groupId: kitGroupId || '',
      isComponent: false,
      additionalCosts: (type === 'Расход' && shipmentAdditional > 0) ? shipmentAdditional : undefined
    });
    
    rowsToAppend.push(mainRow);
    
    newTransactions.push({
      id: transId,
      date: dateStr,
      type,
      article,
      quantity: qty,
      price: mainPrice,
      writeOffCost,
      total: mainTotal,
      destination,
      deliveryDate,
      user: username,
      groupId: kitGroupId || '',
      isComponent: false
    });
  });

  if (rowsToAppend.length > 0) {
    if (opIdStr) {
      const opColIdx = getTransColIndex(transSheet, 'OpID');
      if (opColIdx >= 0) {
        for (let r = 0; r < rowsToAppend.length; r++) {
          while (rowsToAppend[r].length <= opColIdx) rowsToAppend[r].push('');
          rowsToAppend[r][opColIdx] = opIdStr;
        }
      }
    }
    const startRow = transSheet.getLastRow() + 1;
    transSheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    SpreadsheetApp.flush();
  }

  // Item 47, stage 2: a shipment to Ozon moves the cost of the goods lying there.
  // Never at the price of the expense itself — that is the operation the user asked for.
  if (type === 'Расход') {
    try {
      // ВАЖНО: берём УЖЕ ПРОВЕДЁННЫЕ строки, а не позиции клиента. Клиент присылает базовые
      // цены, а долю упаковки и услуг сервер добавляет сам чуть выше (mainPrice). На Ozon
      // товар уезжает с полной себестоимостью, и именно она должна попасть в журнал —
      // иначе в КАН уйдёт цена без расходов, ради учёта которых всё и затевалось.
      // Строки комплектующих исключены: у комплекта своя строка, и в ней они уже сидят.
      const shippedRows = newTransactions
        .filter(function(t) { return t.isComponent !== true; })
        .map(function(t) {
          return { article: t.article, quantity: t.quantity, price: t.price, status: 'ok' };
        });
      appendOzonCostForShipment(shippedRows, destination, dateStr, opIdStr, username);
    } catch (costErr) {
      Logger.log('Себестоимость Озон не обновлена: ' + costErr);
    }
  }

  return {
    stock: getStock(),
    newTransactions: newTransactions,
    skus: getSkus() // return skus explicitly since we might have added one in ensureSkuExists
  };
}

// --- User Management & Authentication ---

function verifySession(token) {
  if (!token) return null;
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Сессии');
  if (!sheet) return null;
  
  const data = sheet.getDataRange().getValues();
  const now = new Date().getTime();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(token)) {
      const expiresAt = Number(data[i][3]);
      if (now > expiresAt) {
        // Session expired
        return null;
      }
      return {
        username: String(data[i][1]).trim(),
        role: String(data[i][2]).trim().toLowerCase()
      };
    }
  }
  return null;
}

function hashPassword(password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function loginUser(username, password) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('Пользователи');
  
  // Auto-initialize if not exists
  if (!sheet) {
    setupDatabase();
    sheet = ss.getSheetByName('Пользователи');
  }
  
  let data = sheet.getDataRange().getValues();
  
  // If sheet is empty or only has headers, add default admin
  if (data.length <= 1 || (data.length === 1 && data[0].join('') === '')) {
    if (data.length === 0 || data[0].join('') === '') {
      sheet.clear();
      sheet.appendRow(['Username', 'Password', 'Role']);
    }
    sheet.appendRow(['Админ', hashPassword('Admin_Mercurius_2025!'), 'admin']);
    data = sheet.getDataRange().getValues();
  }
  
  let user = null;
  const inputUser = String(username).trim().toLowerCase();
  const inputPass = String(password).trim();
  const hashedInputPass = hashPassword(inputPass);
  
  for (let i = 1; i < data.length; i++) {
    const rowUser = String(data[i][0]).trim().toLowerCase();
    const rowPass = String(data[i][1]).trim();
    
    if (rowUser === inputUser && rowPass === hashedInputPass) {
      user = {
        username: String(data[i][0]).trim(),
        role: String(data[i][2]).trim().toLowerCase()
      };
      break;
    }
  }
  
  if (!user) {
    throw new Error('Неверное имя пользователя или пароль');
  }
  
  // Create session
  const sessionSheet = ss.getSheetByName('Сессии');
  if (!sessionSheet) throw new Error('Ошибка БД: лист Сессии не найден');
  
  // Пункт 29, этап F: прежние сессии того же логина больше НЕ удаляются.
  // Именно это удаление приводило к тому, что вторая вкладка или второй
  // клиент выбивали первого: вход стирал ещё действующий чужой токен.
  // Истёкшие сессии отсеиваются, но лист переписывается одной операцией,
  // а не циклом deleteRow, который смещал индексы строк при параллельной
  // работе и стирал живые сессии вместо просроченных.
  const now = new Date().getTime();
  const sessionData = sessionSheet.getDataRange().getValues();
  const keptSessions = [];
  for (let i = 1; i < sessionData.length; i++) {
    if (Number(sessionData[i][3]) >= now) {
      keptSessions.push([sessionData[i][0], sessionData[i][1], sessionData[i][2], sessionData[i][3]]);
    }
  }

  const token = Utilities.getUuid();
  const expiresAt = now + (24 * 60 * 60 * 1000); // 24 hours
  
  keptSessions.push([token, user.username, user.role, expiresAt]);
  if (sessionData.length > 1) {
    sessionSheet.getRange(2, 1, sessionData.length - 1, 4).clearContent();
  }
  sessionSheet.getRange(2, 1, keptSessions.length, 4).setValues(keptSessions);
  
  return {
    user: user,
    sessionToken: token
  };
}

function logoutUser(token) {
  if (!token) return { success: true };
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Сессии');
  if (!sheet) return { success: true };
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(token)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { success: true };
}

function getUsers() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Пользователи');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const rows = data.slice(1);
  return rows.map(row => ({
    username: String(row[0]),
    role: String(row[2])
  }));
}

function addUser(username, password, role) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Пользователи');
  if (!sheet) throw new Error('База данных не инициализирована');
  
  // Check if exists
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(username)) {
      throw new Error('Пользователь с таким именем уже существует');
    }
  }
  
  sheet.appendRow([username, hashPassword(password), role]);
  return getUsers();
}

function deleteUser(username, deletedBy) {
  const normalizedUser = String(username).toLowerCase();
  if (normalizedUser === 'admin' || normalizedUser === 'админ' || normalizedUser === 'администратор') throw new Error('Нельзя удалить главного администратора');
  
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Пользователи');
  if (!sheet) throw new Error('База данных не инициализирована');
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(username)) {
      const rowData = data[i];
      if (typeof archiveItem === 'function') archiveItem('User', { username: rowData[0], password: rowData[1], role: rowData[2] }, deletedBy);
      sheet.deleteRow(i + 1);
      break;
    }
  }
  
  // Also delete their sessions
  const sessionSheet = ss.getSheetByName('Сессии');
  if (sessionSheet) {
    const sessionData = sessionSheet.getDataRange().getValues();
    // Delete backwards to not mess up indices
    for (let i = sessionData.length - 1; i >= 1; i--) {
      if (String(sessionData[i][1]) === String(username)) {
        sessionSheet.deleteRow(i + 1);
      }
    }
  }
  
  return getUsers();
}

// --- Archive functionality ---

function archiveItem(type, data, deletedBy) {
  if (!deletedBy) deletedBy = 'unknown';
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('Удаленное');
  if (!sheet) {
    setupDatabase();
    sheet = ss.getSheetByName('Удаленное');
  }
  const archiveId = Utilities.getUuid();
  const deletedAt = new Date().getTime();
  sheet.appendRow([archiveId, type, deletedAt, JSON.stringify(data), deletedBy]);
}

function cleanOldArchivedItems(sheet) {
  if (!sheet) return;
  const now = new Date().getTime();
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
  
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const rawVal = data[i][2];
    if (rawVal === undefined || rawVal === null || rawVal === '') continue; // Skip empty
    const deletedAt = Number(rawVal);
    if (!isNaN(deletedAt) && deletedAt > 0 && (now - deletedAt > sixtyDaysMs)) {
      sheet.deleteRow(i + 1);
    }
  }
}

function getArchivedItems() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Удаленное');
  if (!sheet) return [];
  
  cleanOldArchivedItems(sheet);
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const rows = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    if (!row[0] || String(row[0]).trim() === '') continue;
    if (String(row[3]).indexOf('"type":"UpdatedVersion"') !== -1) continue;
    rows.push({
      archiveId: String(row[0]),
      type: String(row[1]),
      deletedAt: Number(row[2]),
      dataJSON: String(row[3]),
      deletedBy: String(row[4] || 'unknown')
    });
  }
  return rows;
}

function restoreArchivedItem(archiveId) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('Удаленное');
  if (!sheet) throw new Error('Нет листа "Удаленное"');
  
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  let archiveRecord = null;
  const targetId = String(archiveId).trim();
  
  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][0]).trim();
    if (!rowId) continue;
    if (rowId === targetId) {
      rowIndex = i + 1;
      archiveRecord = {
        type: String(data[i][1]),
        payload: JSON.parse(String(data[i][3]))
      };
      break;
    }
  }
  
  if (!archiveRecord) throw new Error('Нет данных в архиве');
  
  const { type, payload } = archiveRecord;
  
  if (type === 'SKU') {
    const skus = getSkus();
    const exists = skus.some(s => s.sku === payload.sku);
    if (!exists) {
      addSku(payload);
    } else {
      updateSku(payload, payload.sku);
    }
  } else if (type === 'User') {
    let usersSheet = ss.getSheetByName('Пользователи');
    if (usersSheet) {
      const uData = usersSheet.getDataRange().getValues();
      const exists = uData.some((r, idx) => idx > 0 && String(r[0]).trim().toLowerCase() === String(payload.username).trim().toLowerCase());
      if (!exists) {
        usersSheet.appendRow([payload.username, payload.password, payload.role]);
      }
    }
  } else if (type === 'Transaction') {
    restoreTransaction(payload);
  }
  
  sheet.deleteRow(rowIndex);
  return { status: 'ok' };
}

function restoreTransaction(payload) {
  const ss = getSpreadsheet();
  const transSheet = getTransactionSheet(ss);
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');
  
  if (!transSheet) return;

  // Проверка на дубликат. Проверяем в транзакциях
  const transData = transSheet.getDataRange().getValues();
  for (let i = 1; i < transData.length; i++) {
    if (String(transData[i][0]) === String(payload.id)) {
      throw new Error(`Транзакция ${payload.id} уже присутствует в базе. Удалите её перед восстановлением.`);
    }
  }
  
  const type = payload.type;
  const article = payload.article;
  const qty = Number(payload.quantity);
  const total = Number(payload.total);
  const writeOffCost = Number(payload.writeOffCost);
  
  ensureSkuExists(article);

  let skipStockUpdate = false;
  if (type === 'Расход') {
    const kitData = getKitComponents(payload.article);
    const kits = getKits();
    const kitExists = kits.hasOwnProperty(payload.article);
    if (kitExists && kitData && kitData.type === 'virtual' && Number(payload.writeOffCost) === 0) {
      skipStockUpdate = true;
    }
  }
  
  if (!skipStockUpdate) {
    const stockData = stockSheet.getDataRange().getValues();
    let stockFound = false;
    for (let i = 1; i < stockData.length; i++) {
      if (String(stockData[i][0]) === String(article)) {
        stockFound = true;
        let newQty = Number(stockData[i][1]);
        let newAvgCost = Number(stockData[i][2]);
        let newCap = Number(stockData[i][3]);
        let newSales = Number(stockData[i][4]);
        
        if (type === 'Приход') {
          newQty += qty;
          newCap += total;
          newAvgCost = newQty > 0 ? newCap / newQty : 0;
        } else if (type === 'Расход') {
          newQty -= qty;
          if (newQty < 0) {
            throw new Error(`Недостаточно товара "${article}" на складе. Доступно: ${newQty + qty}, откат расхода: ${qty}`);
          }
          if (isWriteOffDestination(payload.destination) && !isCapitalizationZeroed(payload.destination)) {
            // Пункт 40, этап B. Симметрично проведению: восстановленное списание снимает
            // количество, но капитализацию не трогает даже при нулевом остатке — это
            // «долг себестоимости», он перейдёт на ближайший приход.
            // Пункт 40, этап A: списание с меткой «себестоимость обнулена» при проведении
            // снимало капитализацию, поэтому при восстановлении она снимается снова.
          } else {
            newCap -= writeOffCost;
          }
          newAvgCost = newQty > 0 ? newCap / newQty : 0;
          newSales += qty;
        }
        
        stockSheet.getRange(i + 1, 2, 1, 4).setValues([[newQty, newAvgCost, newCap, newSales]]);
        break;
      }
    }
    
    if (!stockFound) {
       let newQty = 0; let newAvgCost = 0; let newCap = 0; let newSales = 0;
       if (type === 'Приход') {
           newQty = qty; newCap = total; newAvgCost = qty > 0 ? total / qty : 0;
       } else {
           newQty = -qty; newCap = -writeOffCost; newSales = qty;
       }
       stockSheet.appendRow([article, newQty, newAvgCost, newCap, newSales, 0]);
    }
  }
  
  // Даты сохраняем как есть (ISO-формат), без конвертации
  let dateStr = payload.date || '';
  let deliveryStr = payload.deliveryDate || '';
  
  transSheet.appendRow([
    payload.id,
    dateStr,
    payload.type,
    payload.article,
    payload.quantity,
    payload.price,
    payload.writeOffCost,
    payload.total,
    payload.destination || '',
    deliveryStr,
    payload.user || '',
    payload.groupId || '',
    payload.isComponent || false
  ]);
}

function deleteMultipleTransactions(ids, deletedBy) {
  if (!ids || ids.length === 0) return { stock: getStock(), transactions: getTransactions().rows };
  if (!deletedBy) deletedBy = 'unknown';

  const kits = getKits();
  const ss = getSpreadsheet();
  const spreadsheetId = ss.getId();
  
  // 1. Получаем листы
  const transSheet = getTransactionSheet(ss);
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');
  
  let archiveSheet = ss.getSheetByName('Удаленное');
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet('Удаленное');
    archiveSheet.appendRow(['ArchiveID', 'Type', 'DeletedAt', 'DataJSON', 'DeletedBy']);
    archiveSheet.getRange('A1:E1').setFontWeight('bold');
  }

  if (!transSheet || !stockSheet || !archiveSheet) throw new Error('База данных не инициализирована');

  const transSheetId = transSheet.getSheetId();
  const deletedAt = new Date().getTime();

  // 2. Читаем все данные сразу
  const transDataAll = transSheet.getDataRange().getValues();
  const stockDataAll = stockSheet.getDataRange().getValues();

  const headers = transDataAll[0] || [];
  const groupIdIdx = headers.indexOf('groupId');
  const isComponentIdx = headers.indexOf('isComponent');

  // Словари для быстрого поиска и работы
  const idsSet = new Set(ids);
  let rowsToDelete = [];
  let rowsToArchive = [];
  
  // Объект для накопления изменений остатков по артикулу
  const stockChanges = {};
  
  // Подготавливаем базу остатков
  for (let i = 1; i < stockDataAll.length; i++) {
    stockChanges[String(stockDataAll[i][0])] = {
      rowIndex: i,
      qtyDiff: 0,
      capDiff: 0,
      currentQty: Number(stockDataAll[i][1]) || 0,
      currentCap: Number(stockDataAll[i][3]) || 0,
    };
  }

  // 3. Сканируем транзакции ОДИН раз
  for (let i = 1; i < transDataAll.length; i++) {
    const rowId = String(transDataAll[i][0]);
    if (idsSet.has(rowId)) {
      // Это строка под удаление. Индекс API начинается с 0
      rowsToDelete.push(i);
      
      const type = transDataAll[i][2];
      const article = String(transDataAll[i][3]);
      const qty = Number(transDataAll[i][4]);
      const price = Number(transDataAll[i][5]);
      const writeOffCost = Number(transDataAll[i][6]);
      const total = Number(transDataAll[i][7]);
      const dest = String(transDataAll[i][8] || '');
      
      let dateStr = transDataAll[i][1] instanceof Date ? transDataAll[i][1].toISOString() : String(transDataAll[i][1]);
      let deliveryDateStr = transDataAll[i][9] instanceof Date ? transDataAll[i][9].toISOString() : String(transDataAll[i][9] || '');

      let userStr = transDataAll[i][10] ? String(transDataAll[i][10]) : '';

      const groupIdVal = (groupIdIdx !== -1) ? transDataAll[i][groupIdIdx] : '';
      const isComponentVal = (isComponentIdx !== -1) ? transDataAll[i][isComponentIdx] : '';

      // Формируем объект для архива
      const archiveObj = { 
        id: rowId, 
        date: dateStr, 
        type, 
        article, 
        quantity: qty, 
        price, 
        writeOffCost, 
        total, 
        destination: dest, 
        deliveryDate: deliveryDateStr, 
        user: userStr,
        groupId: groupIdVal !== null && groupIdVal !== undefined ? groupIdVal : '',
        isComponent: isComponentVal !== null && isComponentVal !== undefined ? isComponentVal : ''
      };
      rowsToArchive.push([Utilities.getUuid(), 'Transaction', deletedAt, JSON.stringify(archiveObj), deletedBy]);

      //  откат остатков
      if (stockChanges[article]) {
        if (type === 'Приход') {
          stockChanges[article].qtyDiff -= qty;
          stockChanges[article].capDiff -= total;
        } else if (type === 'Расход') {
          const kit = kits[article];
          const isVirtualKit = kit && kit.type === 'virtual';
          if (writeOffCost === 0 && isVirtualKit) {
            // НЕ изменяем qtyDiff и capDiff для виртуального комплекта
          } else {
            stockChanges[article].qtyDiff += qty;
            // Пункт 40, этап A: обычному списанию капитализацию не возвращаем (её и не снимали),
            // а списанию с меткой «себестоимость обнулена» — возвращаем, как обычному расходу.
            if (!isWriteOffDestination(dest) || isCapitalizationZeroed(dest)) {
              stockChanges[article].capDiff += writeOffCost;
            }
          }
        }
      }
    }
  }

  if (rowsToDelete.length === 0) return { stock: getStock(), transactions: getTransactions().rows };

  // 4. Записываем все строки в Архив одновременно
  if (rowsToArchive.length > 0) {
    archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, rowsToArchive.length, rowsToArchive[0].length).setValues(rowsToArchive);
  }

  // 5. Обновляем Остатки одновременно
  let isStockChanged = false;
  Object.keys(stockChanges).forEach(sku => {
    const change = stockChanges[sku];
    if (change.qtyDiff !== 0 || change.capDiff !== 0) {
      change.currentQty += change.qtyDiff;
      if (change.currentQty < 0) {
        throw new Error(`Массовое удаление приведёт к отрицательному остатку товара "${sku}". Отмените связанные расходы.`);
      }
      change.currentCap += change.capDiff;
      const newAvgCost = change.currentQty > 0 ? change.currentCap / change.currentQty : 0;
      
      // Обновляем массив в памяти (только первые 4 колонки Qty, AvgCost, Cap. Не трогаем Sales/Turnover)
      stockDataAll[change.rowIndex][1] = change.currentQty;
      stockDataAll[change.rowIndex][2] = newAvgCost;
      stockDataAll[change.rowIndex][3] = change.currentCap;
      isStockChanged = true;
    }
  });

  if (isStockChanged) {
    stockSheet.getRange(1, 1, stockDataAll.length, Math.max(stockDataAll[0].length, 6)).setValues(stockDataAll);
  }

  // 6. МАГИЯ SHEETS API: Удаляем все нужные строки транзакций за ОДИН запрос
  // Индексы нужно отсортировать по убыванию
  rowsToDelete.sort((a, b) => b - a);
  
  const requests = rowsToDelete.map(rowIndex => ({
    deleteDimension: {
      range: {
        sheetId: transSheetId,
        dimension: "ROWS",
        startIndex: rowIndex,     
        endIndex: rowIndex + 1    
      }
    }
  }));

    if (requests.length > 0) {
    let apiDelErrors = 0;
    try {
      Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
    } catch(e) {
      // Fallback if Sheets API is not enabled
       for (let i = 0; i < rowsToDelete.length; i++) {
        try {
          transSheet.deleteRow(rowsToDelete[i] + 1);
        } catch(err) {
          apiDelErrors++;
        }
       }
    }
    if (apiDelErrors > 0) {
      SpreadsheetApp.flush();
      return { stock: getStock(), transactions: getTransactions().rows, partial: true, message: `Удалено с ошибками: ${apiDelErrors}.` };
    }
  }

  const notFoundCount = ids.length - rowsToDelete.length;
  if (notFoundCount > 0) {
    SpreadsheetApp.flush();
    return { stock: getStock(), transactions: getTransactions().rows, partial: true, message: `Внимание! Удалено: ${rowsToDelete.length}. Не найдено в базе: ${notFoundCount}.` };
  }

  SpreadsheetApp.flush();
  return { stock: getStock(), transactions: getTransactions().rows };
}

function restoreMultipleArchivedItems(archiveIds) {
  if (!archiveIds || archiveIds.length === 0) return { stock: getStock(), archived: getArchivedItems(), transactions: getTransactions().rows };
  
  const ss = getSpreadsheet();
  const spreadsheetId = ss.getId();
  
  const archiveSheet = getSheetByNameRobust(ss, 'Удаленное');
  if (!archiveSheet) throw new Error('Список удаленных не найден.');
  
  const archiveSheetId = archiveSheet.getSheetId();
  const archiveDataAll = archiveSheet.getDataRange().getValues();

  const idsSet = new Set(archiveIds);
  let rowsToDeleteFromArchive = [];
  let transactionsToRestore = [];
  let duplicatesCount = 0;
  
  // 1. Ищем строки в архиве
  for (let i = 1; i < archiveDataAll.length; i++) {
    const archiveId = String(archiveDataAll[i][0]);
    if (idsSet.has(archiveId)) {
      rowsToDeleteFromArchive.push(i);
      const dataJSON = String(archiveDataAll[i][3]);
      try {
        const payload = JSON.parse(dataJSON);
        // Даты сохраняем как есть (ISO-формат payload), без переформатирования
        let dateStr = payload.date ? String(payload.date) : new Date().toISOString();
        let deliveryStr = payload.deliveryDate ? String(payload.deliveryDate) : "";

        transactionsToRestore.push([
          payload.id, dateStr, payload.type, payload.article,
          payload.quantity, payload.price, payload.writeOffCost, payload.total,
          payload.destination || '', deliveryStr
        ]);
        
      } catch (e) {
        // Ошибка парсинга
      }
    }
  }

  const kits = getKits();
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');
  if (!stockSheet) throw new Error('Лист "Остатки" не найден.');
  const stockDataAll = stockSheet.getDataRange().getValues();
  
  const stockChanges = {};
  for (let i = 1; i < stockDataAll.length; i++) {
    stockChanges[String(stockDataAll[i][0])] = {
      rowIndex: i,
      qtyDiff: 0,
      capDiff: 0,
      currentQty: Number(stockDataAll[i][1]) || 0,
      currentCap: Number(stockDataAll[i][3]) || 0,
    };
  }

  if (transactionsToRestore.length > 0) {
    // 2. Добавляем восстановленные данные обратно
    const transSheet = getTransactionSheet(ss);
    
    // Проверка на дубликаты перед вставкой
    const activeTransData = transSheet.getDataRange().getValues();
    const activeIds = new Set();
    for (let i = 1; i < activeTransData.length; i++) {
       activeIds.add(String(activeTransData[i][0]));
    }
    
    let filteredToRestore = [];
    
    for (let i = 0; i < transactionsToRestore.length; i++) {
        const tId = String(transactionsToRestore[i][0]);
        if (activeIds.has(tId)) {
            duplicatesCount++;
        } else {
            filteredToRestore.push(transactionsToRestore[i]);
            activeIds.add(tId);
        }
    }
    
    if (filteredToRestore.length > 0) {
      transSheet.getRange(transSheet.getLastRow() + 1, 1, filteredToRestore.length, filteredToRestore[0].length).setValues(filteredToRestore);
    }
    
    transactionsToRestore = filteredToRestore; // for logs or info later
    
    // Инкрементально накапливаем изменения остатков
    for (let i = 0; i < filteredToRestore.length; i++) {
      const trans = filteredToRestore[i];
      const type = trans[2];
      const article = String(trans[3]);
      const qty = Number(trans[4]) || 0;
      const writeOffCost = Number(trans[6]) || 0;
      const total = Number(trans[7]) || 0;
      
      if (stockChanges[article]) {
        if (type === 'Приход') {
          stockChanges[article].qtyDiff += qty;
          stockChanges[article].capDiff += total;
        } else if (type === 'Расход') {
          const dest = String(trans[8] || '');
          const kit = kits[article];
          const isVirtualKit = kit && kit.type === 'virtual';
          if (writeOffCost === 0 && isVirtualKit) {
            // НЕ изменяем qtyDiff и capDiff для виртуального комплекта
          } else {
            // Пункт 40, этап A: обычное списание снимает только количество,
            // а списание с меткой «себестоимость обнулена» снимает и капитализацию —
            // ровно так же, как это было при его первоначальном проведении.
            if (isWriteOffDestination(dest) === true && isCapitalizationZeroed(dest) === false) {
              stockChanges[article].qtyDiff -= qty;
            } else {
              stockChanges[article].qtyDiff -= qty;
              stockChanges[article].capDiff -= writeOffCost;
            }
          }
        }
      }
    }
  }

  let restoreMsg = '';
  let apiErrors = 0;

  // 3. Удаляем строки из Архива с помощью Advanced Sheets API
  if (rowsToDeleteFromArchive.length > 0) {
    rowsToDeleteFromArchive.sort((a, b) => b - a);
    
    const requests = rowsToDeleteFromArchive.map(rowIndex => ({
      deleteDimension: {
        range: {
          sheetId: archiveSheetId,
          dimension: "ROWS",
          startIndex: rowIndex,
          endIndex: rowIndex + 1
        }
      }
    }));

    try {
      Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
    } catch (e) {
       apiErrors = 0;
       for (let i = 0; i < rowsToDeleteFromArchive.length; i++) {
         try {
           archiveSheet.deleteRow(rowsToDeleteFromArchive[i] + 1);
         } catch(err) {
           apiErrors++;
         }
       }
    }
  }

  // Применяем накопленные изменения к листу "Остатки" одной записью
  let warnings = [];
  let isStockChanged = false;
  Object.keys(stockChanges).forEach(sku => {
    const change = stockChanges[sku];
    if (change.qtyDiff !== 0 || change.capDiff !== 0) {
      change.currentQty += change.qtyDiff;
      if (change.currentQty < 0) {
        warnings.push(`Остаток товара "${sku}" ушел в минус. Установлен в 0.`);
        change.currentQty = 0;
      }
      change.currentCap += change.capDiff;
      if (change.currentQty <= 0) {
        change.currentQty = 0;
      }
      // Пункт 40, этап B. При нулевом остатке капитализацию не обнуляем: это «долг
      // себестоимости», который ещё не нашёл носителя — он ляжет на ближайший приход
      // и виден владельцу по бейджу «долг себестоимости» на вкладке «Склад».
      // Отрицательную капитализацию по-прежнему подтягиваем к нулю.
      if (change.currentCap < 0) {
        change.currentCap = 0;
      }
      const newAvgCost = change.currentQty > 0 ? change.currentCap / change.currentQty : 0;
      
      stockDataAll[change.rowIndex][1] = change.currentQty;
      stockDataAll[change.rowIndex][2] = newAvgCost;
      stockDataAll[change.rowIndex][3] = change.currentCap;
      isStockChanged = true;
    }
  });

  if (isStockChanged) {
    stockSheet.getRange(1, 1, stockDataAll.length, Math.max(stockDataAll[0].length, 6)).setValues(stockDataAll);
  }

  if (duplicatesCount > 0 || apiErrors > 0 || warnings.length > 0) {
     restoreMsg = `Восстановлено: ${transactionsToRestore.length}. `;
     if (duplicatesCount > 0) restoreMsg += `Пропущено дубликатов: ${duplicatesCount}. `;
     if (apiErrors > 0) restoreMsg += `Ошибок удаления из архива: ${apiErrors}. `;
     if (warnings.length > 0) restoreMsg += `Предупреждения: ${warnings.join('; ')}.`;
     return { stock: getStock(), archived: getArchivedItems(), transactions: getTransactions().rows, partial: true, message: restoreMsg.trim() };
  }

  return { stock: getStock(), archived: getArchivedItems(), transactions: getTransactions().rows };
}

function hardDeleteArchivedItems(archiveIds) {
  if (!archiveIds || archiveIds.length === 0) return getArchivedItems();
  
  const ss = getSpreadsheet();
  const spreadsheetId = ss.getId();
  const archiveSheet = getSheetByNameRobust(ss, 'Удаленное');
  if (!archiveSheet) return getArchivedItems();
  
  const archiveSheetId = archiveSheet.getSheetId();
  const archiveDataAll = archiveSheet.getDataRange().getValues();

  const idsSet = new Set(archiveIds);
  let rowsToDeleteFromArchive = [];
  
  for (let i = 1; i < archiveDataAll.length; i++) {
    const archiveId = String(archiveDataAll[i][0]);
    if (idsSet.has(archiveId)) {
      rowsToDeleteFromArchive.push(i);
    }
  }
  
  if (rowsToDeleteFromArchive.length > 0) {
    rowsToDeleteFromArchive.sort((a, b) => b - a);
    
    const requests = rowsToDeleteFromArchive.map(rowIndex => ({
      deleteDimension: {
        range: {
          sheetId: archiveSheetId,
          dimension: "ROWS",
          startIndex: rowIndex,
          endIndex: rowIndex + 1
        }
      }
    }));

    try {
      Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
    } catch (e) {
       for (let i = 0; i < rowsToDeleteFromArchive.length; i++) {
        archiveSheet.deleteRow(rowsToDeleteFromArchive[i] + 1);
       }
    }
  }

  return getArchivedItems();
}



// ─── Вариант 2: Динамический перерасчет аналитики ────────────────────────────

function recalculateDailyAnalytics() {
  const ss = getSpreadsheet();
  const transSheet = getTransactionSheet(ss);
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');
  
  if (!transSheet || !stockSheet) return;

  const stockData = stockSheet.getDataRange().getValues();
  if (stockData.length <= 1) return;

  const transData = transSheet.getDataRange().getValues();
  
  // Рассчитываем окно 120 дней
  const cutoffLimit = new Date();
  cutoffLimit.setDate(cutoffLimit.getDate() - 120);
  const cutoffLimitMs = cutoffLimit.getTime();

  // Собираем продажи
  const salesMap = {};
  for (let i = 1; i < transData.length; i++) {
    const row = transData[i];
    if (row.join('').trim() === '') continue;
    
    if (String(row[2]) === 'Расход') {
      let rowMs = 0;
      if (row[1] instanceof Date) {
        rowMs = row[1].getTime();
      } else {
        const d = new Date(String(row[1]));
        if (!isNaN(d.getTime())) rowMs = d.getTime();
      }

      if (rowMs >= cutoffLimitMs) {
        const sku = String(row[3]);
        const qty = Number(row[4]) || 0;
        salesMap[sku] = (salesMap[sku] || 0) + qty;
      }
    }
  }

  // Обновляем лист остатков
  for (let i = 1; i < stockData.length; i++) {
    const sku = String(stockData[i][0]);
    const currentQty = Number(stockData[i][1]) || 0;
    
    const sales120 = salesMap[sku] || 0;
    
    let turnoverDays = 0;
    if (sales120 > 0 && currentQty > 0) {
      const salesPerDay = sales120 / 120;
      turnoverDays = currentQty / salesPerDay;
    }
    
    stockData[i][4] = sales120; // Продажи
    stockData[i][5] = Number(turnoverDays.toFixed(1)); // Оборачиваемость
  }

  stockSheet.getRange(1, 1, stockData.length, Math.max(stockData[0].length, 6)).setValues(stockData);
  Logger.log('recalculateDailyAnalytics completed successfully');
}

function cleanExpiredSessions() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Сессии');
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const now = new Date().getTime();
  // Удаляем с конца чтобы не сбивать индексы
  for (let i = data.length - 1; i >= 1; i--) {
    if (Number(data[i][3]) < now) sheet.deleteRow(i + 1);
  }
}

function setupDailyAnalyticsTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'recalculateDailyAnalytics' || t.getHandlerFunction() === 'cleanExpiredSessions')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('recalculateDailyAnalytics')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();

  ScriptApp.newTrigger('cleanExpiredSessions')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  Logger.log('Ежедневная аналитика и очистка сессий установлены');
}

// ── Мультикабинет Ozon (пункт 8в) ──
// Возвращает список кабинетов [{name, clientId, apiKey}].
// Источник — Script Property global_ozonCabinets (JSON-массив).
// Автомиграция: если списка нет, но есть старая пара global_ozonClientId/global_ozonApiKey — она становится «Кабинет 1».
function getOzonCabinets() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('global_ozonCabinets') || '';
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(function(c) { return c && String(c.clientId || '').trim() && String(c.apiKey || '').trim(); })
          .map(function(c, i) {
            return {
              name: String(c.name || '').trim() || ('Кабинет ' + (i + 1)),
              clientId: String(c.clientId).trim(),
              apiKey: String(c.apiKey).trim()
            };
          });
      }
    } catch (e) { /* повреждённый JSON — падаем на миграцию ниже */ }
  }
  const oldClientId = (props.getProperty('global_ozonClientId') || '').trim();
  const oldApiKey = (props.getProperty('global_ozonApiKey') || '').trim();
  if (oldClientId && oldApiKey) {
    return [{ name: 'Кабинет 1', clientId: oldClientId, apiKey: oldApiKey }];
  }
  return [];
}

function getGlobalSettings(role) {
  const props = PropertiesService.getScriptProperties();
  const settings = {
    geminiModel: props.getProperty('global_geminiModel') || 'gemini-flash-latest',
    serviceOrder: props.getProperty('global_serviceOrder') || '',
    storageRatePerLiterDay: Number(props.getProperty('global_storageRate')) || 0,
    boxesPerPalletGlobal: Number(props.getProperty('global_boxesPerPallet')) || 0
  };
  // Ключ — только администратору
  // Названия кабинетов Ozon (без ключей) — всем пользователям,
  // нужны для выбора кабинета при оформлении отгрузки
  settings.ozonCabinetNames = getOzonCabinets().map(function(c) { return c.name; });
  
  if (isAdminRole(role)) {
    settings.geminiKey = props.getProperty('global_geminiKey') || '';
    const cabinets = getOzonCabinets();
    settings.ozonCabinets = cabinets;
    // Старые поля (первый кабинет) — обратная совместимость со старым клиентом
    settings.ozonClientId = cabinets.length > 0 ? cabinets[0].clientId : '';
    settings.ozonApiKey = cabinets.length > 0 ? cabinets[0].apiKey : '';
  }
  return settings;
}

function saveGlobalSettings(data, role) {
  const props = PropertiesService.getScriptProperties();
  if (data.geminiKey !== undefined) {
    props.setProperty('global_geminiKey', data.geminiKey);
  }
  if (data.geminiModel !== undefined) {
    props.setProperty('global_geminiModel', data.geminiModel);
  }
  if (data.serviceOrder !== undefined) {
    props.setProperty('global_serviceOrder', data.serviceOrder);
  }
  if (data.storageRatePerLiterDay !== undefined) {
    props.setProperty('global_storageRate', String(data.storageRatePerLiterDay));
  }
  if (data.boxesPerPalletGlobal !== undefined) {
    props.setProperty('global_boxesPerPallet', String(data.boxesPerPalletGlobal));
  }
  if (data.ozonCabinets !== undefined) {
    // Новый формат: массив [{name, clientId, apiKey}] — валидация и запись JSON
    let cabinets = [];
    if (Array.isArray(data.ozonCabinets)) {
      cabinets = data.ozonCabinets
        .filter(function(c) { return c && String(c.clientId || '').trim() && String(c.apiKey || '').trim(); })
        .map(function(c, i) {
          return {
            name: String(c.name || '').trim() || ('Кабинет ' + (i + 1)),
            clientId: String(c.clientId).trim(),
            apiKey: String(c.apiKey).trim()
          };
        });
    }
    props.setProperty('global_ozonCabinets', JSON.stringify(cabinets));
    // Старые свойства синхронизируем с первым кабинетом (обратная совместимость)
    props.setProperty('global_ozonClientId', cabinets.length > 0 ? cabinets[0].clientId : '');
    props.setProperty('global_ozonApiKey', cabinets.length > 0 ? cabinets[0].apiKey : '');
  } else {
    // Старый формат от старого клиента: пара ключей = первый кабинет
    if (data.ozonClientId !== undefined) {
      props.setProperty('global_ozonClientId', data.ozonClientId);
    }
    if (data.ozonApiKey !== undefined) {
      props.setProperty('global_ozonApiKey', data.ozonApiKey);
    }
    if (data.ozonClientId !== undefined || data.ozonApiKey !== undefined) {
      // Синхронизируем список кабинетов, чтобы форматы не разъехались
      const migrated = getOzonCabinets();
      const newFirst = {
        name: (migrated.length > 0 && migrated[0].name) ? migrated[0].name : 'Кабинет 1',
        clientId: (props.getProperty('global_ozonClientId') || '').trim(),
        apiKey: (props.getProperty('global_ozonApiKey') || '').trim()
      };
      const rest = migrated.slice(1);
      const updated = (newFirst.clientId && newFirst.apiKey) ? [newFirst].concat(rest) : rest;
      props.setProperty('global_ozonCabinets', JSON.stringify(updated));
    }
  }
  return getGlobalSettings(role);
}

// --- Services (Услуги) ---

function getTodayDateString() {
  try {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd");
  } catch (e) {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

function formatDateString(val) {
  if (val instanceof Date) {
    try {
      return Utilities.formatDate(val, Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd");
    } catch(e) {
      const year = val.getFullYear();
      const month = String(val.getMonth() + 1).padStart(2, '0');
      const day = String(val.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  let s = String(val).trim();
  if (!s) return '';
  if (s.includes('T')) {
    s = s.split('T')[0];
  }
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch(e) {}
  return s;
}

function getServiceRates() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Тарифы услуг');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  return data.slice(1).map(row => {
    return {
      serviceId: String(row[0]),
      cost: Number(row[1]) || 0,
      validFrom: formatDateString(row[2])
    };
  });
}

function getServiceCostAt(serviceId, dateStr, ratesArr, services) {
  const serviceRates = (ratesArr || []).filter(r => String(r.serviceId) === String(serviceId) && r.validFrom && r.validFrom <= dateStr);
  if (serviceRates.length > 0) {
    serviceRates.sort((a, b) => b.validFrom.localeCompare(a.validFrom));
    return serviceRates[0].cost;
  }
  
  if (services) {
    const svc = services.find(s => String(s.id) === String(serviceId));
    if (svc) return svc.cost;
  }
  
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Услуги');
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(serviceId)) {
        return Number(data[i][2]) || 0;
      }
    }
  }
  return 0;
}

function addServiceRate(serviceId, cost, validFrom) {
  if (!serviceId) {
    throw new Error('ID услуги не может быть пустым');
  }
  const numericCost = Number(cost);
  if (isNaN(numericCost) || numericCost < 0) {
    throw new Error('Стоимость тарифа должна быть числом не меньше 0');
  }
  
  if (!validFrom) {
    throw new Error('Дата действия тарифа не указана');
  }
  const dateObj = new Date(validFrom);
  if (isNaN(dateObj.getTime())) {
    throw new Error('Указана невалидная дата действия тарифа');
  }
  
  const formattedDate = formatDateString(dateObj);

  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('Тарифы услуг');
  if (!sheet) {
    setupDatabase();
    sheet = ss.getSheetByName('Тарифы услуг');
  }
  
  sheet.appendRow([String(serviceId), numericCost, formattedDate]);
  return getServiceRates();
}

function getServices() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Услуги');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const services = data.slice(1).map(row => ({
    id: String(row[0]),
    name: String(row[1]),
    cost: Number(row[2]) || 0,
    isActive: row[3] !== false && row[3] !== 'false' && row[3] !== 0 && String(row[3]).toLowerCase() !== 'false'
  }));

  const rates = getServiceRates();
  const todayStr = getTodayDateString();

  return services.map(s => {
    s.currentCost = getServiceCostAt(s.id, todayStr, rates, services);
    return s;
  });
}

function addService(name, cost) {
  if (!name) throw new Error('Название услуги не может быть пустым');
  if (cost < 0) throw new Error('Стоимость не может быть отрицательной');
  
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('Услуги');
  if (!sheet) {
    setupDatabase();
    sheet = ss.getSheetByName('Услуги');
  }
  
  const services = getServices();
  if (services.find(s => s.name.toLowerCase() === name.toLowerCase() && s.isActive)) {
    throw new Error('Активная услуга с таким названием уже существует');
  }
  
  const id = Utilities.getUuid();
  sheet.appendRow([id, name, cost, true]);
  
  return getServices();
}

function updateService(id, name, cost, isActive) {
  if (!name) throw new Error('Название услуги не может быть пустым');
  if (cost < 0) throw new Error('Стоимость не может быть отрицательной');
  
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Услуги');
  if (!sheet) throw new Error('Лист Услуги не найден');
  
  const data = sheet.getDataRange().getValues();
  let found = false;
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      const services = getServices();
      const duplicate = services.find(s => s.id !== id && s.name.toLowerCase() === name.toLowerCase() && s.isActive);
      if (duplicate && isActive) throw new Error('Активная услуга с таким названием уже существует');
      
      sheet.getRange(i + 1, 2, 1, 3).setValues([[name, cost, isActive]]);
      found = true;
      break;
    }
  }
  
  if (!found) throw new Error('Услуга не найдена');
  return getServices();
}


function getKits() {
  const ss = getSpreadsheet();
  const sheet = getKitSheet(ss);
  const data = sheet.getDataRange().getValues();
  const kits = {};
  if (data.length <= 1) return kits;
  
  const headers = data[0];
  const kitTypeIdx = headers.indexOf('kitType');
  
  for (let i = 1; i < data.length; i++) {
    const kitSku = String(data[i][0]).trim();
    const componentSku = String(data[i][1]).trim();
    let qty = Number(data[i][2]);
    if (isNaN(qty) || qty <= 0) qty = 1;
    
    let kitType = 'legacy';
    if (kitTypeIdx !== -1 && data[i][kitTypeIdx]) {
      const val = String(data[i][kitTypeIdx]).trim().toLowerCase();
      if (val === 'virtual') kitType = 'virtual';
    }
    
    if (kitSku && componentSku) {
      if (!kits[kitSku]) {
        kits[kitSku] = { type: kitType, components: [] };
      }
      kits[kitSku].components.push({ componentSku, quantity: qty });
    }
  }
  return kits;
}

function saveKit(kitSku, components, kitType) {
  const ss = getSpreadsheet();
  const sheet = getKitSheet(ss);
  const data = sheet.getDataRange().getValues();
  
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === kitSku) {
      rowsToDelete.push(i + 1);
    }
  }
  
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  
  const typeToWrite = kitType || 'legacy';
  
  if (components && components.length > 0) {
    const newRows = components.map(c => [kitSku, c.componentSku, Number(c.quantity) || 1, typeToWrite]);
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
  }
  
  SpreadsheetApp.flush();
  return { status: 'success', kitSku: kitSku, count: components ? components.length : 0 };
}

function deleteKit(kitSku) {
  return saveKit(kitSku, []);
}

function getKitComponents(kitSku) {
  const kits = getKits();
  return kits[kitSku] || { type: 'legacy', components: [] };
}

/**
 * Проверка наличия товара на Моём складе перед отправкой заявки в Ozon.
 * Только чтение: остатки, капитализацию и историю не трогает.
 * Для виртуальных комплектов доступность = min(остаток компонента / норма), целое вниз.
 * data.items — массив { article, quantity }.
 */
function checkSupplyAvailability(data) {
  const items = (data && Array.isArray(data.items)) ? data.items : [];
  if (items.length === 0) {
    throw new Error('Не передан список товаров для проверки наличия');
  }

  const stockRows = getStock();
  const stockMap = {};
  for (let i = 0; i < stockRows.length; i++) {
    stockMap[String(stockRows[i].article).trim()] = Number(stockRows[i].quantity) || 0;
  }

  const kits = getKits();
  const result = [];

  for (let i = 0; i < items.length; i++) {
    const article = String(items[i].article || '').trim();
    const requested = Number(items[i].quantity) || 0;
    let available = 0;

    const kit = kits[article];
    if (kit && kit.type === 'virtual' && kit.components && kit.components.length > 0) {
      available = Infinity;
      for (let c = 0; c < kit.components.length; c++) {
        const comp = kit.components[c];
        const norm = Number(comp.quantity) || 1;
        const compStock = Number(stockMap[String(comp.componentSku).trim()]) || 0;
        const possible = Math.floor(compStock / norm);
        if (possible < available) available = possible;
      }
      if (!Number.isFinite(available)) available = 0;
    } else {
      available = Number(stockMap[article]) || 0;
    }

    result.push({
      article: article,
      requested: requested,
      available: available,
      enough: available >= requested
    });
  }

  return { items: result, checkedAt: new Date().toISOString() };
}

/**
 * Закрывает строки журнала «Заявки Ozon» по фактическому состоянию поставок.
 * Если у заявки есть строки во «Внешних отгрузках» и ВСЕ они в терминальном статусе,
 * заявка больше не приведёт к поставке — журналу проставляется соответствующий статус.
 * Нужно для заявок, отменённых уже после того, как их начали отслеживать: опрос их
 * повторно не запрашивает, и без этой функции они вечно числились бы созданными.
 * Ozon не опрашивается: работаем только по данным, которые уже лежат в базе.
 * На остатки, себестоимость и капитализацию не влияет.
 */
function syncOzonJournalFromShipments() {
  const TERMINAL_LABELS = {
    'CANCELLED': 'Отменена',
    'OVERDUE': 'Просрочена',
    'REJECTED_AT_SUPPLY_WAREHOUSE': 'Отказано'
  };

  const shSheet = getExternalShipmentsSheet();
  const shLast = shSheet.getLastRow();
  if (shLast < 2) return 0;

  const shHeaders = shSheet.getRange(1, 1, 1, shSheet.getLastColumn()).getValues()[0];
  const sOrder = shHeaders.indexOf('OrderID');
  const sOzon = shHeaders.indexOf('Статус Ozon');
  if (sOrder < 0 || sOzon < 0) return 0;

  const shValues = shSheet.getRange(2, 1, shLast - 1, shSheet.getLastColumn()).getValues();
  const byOrder = {};

  for (var k = 0; k < shValues.length; k++) {
    const oid = String(shValues[k][sOrder] || '').trim();
    if (!oid) continue;
    const st = String(shValues[k][sOzon] || '').trim().toUpperCase();
    if (!byOrder[oid]) byOrder[oid] = { allTerminal: true, label: '' };
    if (!TERMINAL_LABELS[st]) {
      byOrder[oid].allTerminal = false;
    } else if (!byOrder[oid].label) {
      byOrder[oid].label = TERMINAL_LABELS[st];
    }
  }

  const ss = getSpreadsheet();
  const reqSheet = getOrCreateSheet(ss, 'Заявки Ozon', OZON_SUPPLY_REQUESTS_HEADERS);
  const reqLast = reqSheet.getLastRow();
  if (reqLast < 2) return 0;

  const reqHeaders = reqSheet.getRange(1, 1, 1, reqSheet.getLastColumn()).getValues()[0];
  const cOrder = reqHeaders.indexOf('OrderID');
  const cStatus = reqHeaders.indexOf('Статус');
  if (cOrder < 0 || cStatus < 0) return 0;

  const reqValues = reqSheet.getRange(2, 1, reqLast - 1, reqSheet.getLastColumn()).getValues();
  const statusColumn = [];
  var closed = 0;

  for (var r = 0; r < reqValues.length; r++) {
    var st2 = String(reqValues[r][cStatus] || '').trim();
    const oid2 = String(reqValues[r][cOrder] || '').trim();
    const info = oid2 ? byOrder[oid2] : null;

    if (st2 === 'Создана' && info && info.allTerminal && info.label) {
      st2 = info.label;
      closed++;
    }
    statusColumn.push([st2]);
  }

  if (closed > 0) {
    reqSheet.getRange(2, cStatus + 1, reqLast - 1, 1).setValues(statusColumn);
  }

  return closed;
}

/** Сколько дней хранить отменённые заявки, прежде чем удалить их из базы. */
const OZON_CANCELLED_KEEP_DAYS = 28;

/**
 * Обработка заявок, отменённых в Ozon Seller.
 * 1) Сразу помечает строки журнала «Заявки Ozon» статусом «Отменена». Это мгновенно
 *    возвращает забронированный остаток на «Мой склад»: логика зачёта пропускает
 *    статусы, начинающиеся на «отмен».
 * 2) Чистит базу от отменённых записей старше OZON_CANCELLED_KEEP_DAYS дней.
 *
 * БЕЗОПАСНОСТЬ УДАЛЕНИЯ. Строка «Внешних отгрузок» удаляется, только если выполнено ВСЁ:
 * статус Ozon равен CANCELLED, внутренний статус равен new, и пусты все следы обработки —
 * TransGroupInfo, ПринятоJSON, ПерерасчётJSON, ПересортJSON. Одного статуса недостаточно:
 * функция updateExternalShipmentStatus умеет возвращать строку в new, не очищая
 * TransGroupInfo, поэтому такая строка может быть связана с реальными проводками.
 * На остатки, себестоимость и капитализацию функция не влияет.
 */
function applyCancelledOzonOrders(data) {
  const rawIds = (data && Array.isArray(data.orderIds)) ? data.orderIds : [];
  const orderIds = rawIds
    .map(function (v) { return String(v || '').trim(); })
    .filter(function (v) { return v !== ''; });

  const ss = getSpreadsheet();
  const result = { updated: 0, purgedRequests: 0, purgedShipments: 0 };
  const cutoff = new Date().getTime() - OZON_CANCELLED_KEEP_DAYS * 24 * 60 * 60 * 1000;
  const notEmpty = function (v) { return String(v || '').trim() !== ''; };

  const wanted = {};
  for (var i = 0; i < orderIds.length; i++) wanted[orderIds[i]] = true;

  // --- Журнал «Заявки Ozon»: пометить отменённые и вычистить старые ---
  const reqSheet = getOrCreateSheet(ss, 'Заявки Ozon', OZON_SUPPLY_REQUESTS_HEADERS);
  const reqLast = reqSheet.getLastRow();

  if (reqLast >= 2) {
    const reqHeaders = reqSheet.getRange(1, 1, 1, reqSheet.getLastColumn()).getValues()[0];
    const cOrder = reqHeaders.indexOf('OrderID');
    const cStatus = reqHeaders.indexOf('Статус');
    const cDate = reqHeaders.indexOf('Дата');
    if (cOrder < 0 || cStatus < 0 || cDate < 0) {
      throw new Error('В листе «Заявки Ozon» не найдены колонки OrderID, Статус или Дата');
    }

    const reqValues = reqSheet.getRange(2, 1, reqLast - 1, reqSheet.getLastColumn()).getValues();
    const statusColumn = [];
    const reqRowsToDelete = [];

    for (var r = 0; r < reqValues.length; r++) {
      var st = String(reqValues[r][cStatus] || '').trim();
      const oid = String(reqValues[r][cOrder] || '').trim();

      if (oid && wanted[oid] && st !== 'Отменена') {
        st = 'Отменена';
        result.updated++;
      }
      statusColumn.push([st]);

      if (st.toLowerCase().indexOf('отмен') === 0) {
        const dv = reqValues[r][cDate];
        const ms = (dv instanceof Date) ? dv.getTime() : new Date(String(dv || '')).getTime();
        if (!isNaN(ms) && ms < cutoff) reqRowsToDelete.push(r + 2);
      }
    }

    if (result.updated > 0) {
      reqSheet.getRange(2, cStatus + 1, reqLast - 1, 1).setValues(statusColumn);
    }

    for (var d1 = reqRowsToDelete.length - 1; d1 >= 0; d1--) {
      reqSheet.deleteRow(reqRowsToDelete[d1]);
      result.purgedRequests++;
    }
  }

  // --- «Внешние отгрузки»: удалять только заведомо необработанные отменённые ---
  const shSheet = getExternalShipmentsSheet();
  const shLast = shSheet.getLastRow();

  if (shLast >= 2) {
    const shHeaders = shSheet.getRange(1, 1, 1, shSheet.getLastColumn()).getValues()[0];
    const sOzon = shHeaders.indexOf('Статус Ozon');
    const sStatus = shHeaders.indexOf('Статус');
    const sDate = shHeaders.indexOf('Дата обнаружения');
    const sTrans = shHeaders.indexOf('TransGroupInfo');
    const sAccepted = shHeaders.indexOf('ПринятоJSON');
    const sRecalc = shHeaders.indexOf('ПерерасчётJSON');
    const sPeresort = shHeaders.indexOf('ПересортJSON');

    if (sOzon >= 0 && sStatus >= 0 && sDate >= 0) {
      const shValues = shSheet.getRange(2, 1, shLast - 1, shSheet.getLastColumn()).getValues();
      const shRowsToDelete = [];

      for (var k = 0; k < shValues.length; k++) {
        const row = shValues[k];

        if (String(row[sOzon] || '').trim().toUpperCase() !== 'CANCELLED') continue;
        if (String(row[sStatus] || '').trim() !== 'new') continue;

        // Любой след обработки запрещает удаление
        if (sTrans >= 0 && notEmpty(row[sTrans])) continue;
        if (sAccepted >= 0 && notEmpty(row[sAccepted])) continue;
        if (sRecalc >= 0 && notEmpty(row[sRecalc])) continue;
        if (sPeresort >= 0 && notEmpty(row[sPeresort])) continue;

        const dv2 = row[sDate];
        const ms2 = (dv2 instanceof Date) ? dv2.getTime() : new Date(String(dv2 || '')).getTime();
        if (!isNaN(ms2) && ms2 < cutoff) shRowsToDelete.push(k + 2);
      }

      for (var d2 = shRowsToDelete.length - 1; d2 >= 0; d2--) {
        shSheet.deleteRow(shRowsToDelete[d2]);
        result.purgedShipments++;
      }
    }
  }

  // Закрываем журнал по фактическому состоянию поставок: заявки, отменённые уже
  // после начала отслеживания, опрос повторно не запрашивает
  result.closedFromShipments = syncOzonJournalFromShipments();

  return result;
}

/** Журнал созданных заявок на поставку. На остатки и себестоимость не влияет. */
function saveOzonSupplyRequest(data, username) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Заявки Ozon', OZON_SUPPLY_REQUESTS_HEADERS);
  const id = 'SUP-' + new Date().getTime();
  sheet.appendRow([
    id,
    new Date(),
    String((data && data.cabinet) || ''),
    String((data && data.draftId) || ''),
    String((data && data.orderId) || ''),
    String((data && data.dropOffName) || ''),
    String((data && data.clusters) || ''),
    String((data && data.itemsJSON) || ''),
    String(username || ''),
    String((data && data.status) || 'Создана')
  ]);
  return { id: id };
}

/**
 * Вспомогательная функция очистки символов из названия папки.
 */
function sanitizeDriveName(name) {
  return String(name || '').replace(/[\/\\:\*\?"<>\|]/g, '_').trim();
}

/**
 * Возвращает существующую подпапку или создаёт её.
 */
function getOrCreateChildFolder(parent, name) {
  const cleanName = sanitizeDriveName(name);
  if (!cleanName) return parent;
  const folders = parent.getFoldersByName(cleanName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(cleanName);
}

/**
 * Заменяет файл в подпапке (удаляет старые с таким именем, создаёт новый).
 */
function replaceFileInFolder(folder, fileName, blob) {
  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
  const newBlob = blob.setName(fileName);
  return folder.createFile(newBlob);
}

/**
 * Достаёт имя файла из заголовка Content-Disposition или возвращает fallbackName.
 */
function nameFromDisposition(dispHeader, fallbackName) {
  if (!dispHeader) return fallbackName;
  const match = String(dispHeader).match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
  if (!match) return fallbackName;
  let raw = match[1].replace(/^["']|["']$/g, '').trim();
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {}
  return raw || fallbackName;
}

/**
 * Приводит имя файла этикетки к сопоставимому виду.
 * NFC чинит декомпозированную кириллицу с macOS: «и» + U+0306 становится «й».
 * Расширение и регистр отбрасываются, чтобы ручное переименование на Диске
 * не ломало поиск.
 */
function normalizeLabelKey(name) {
  let s = String(name || '');
  try {
    s = s.normalize('NFC');
  } catch (e) {}
  s = s.replace(/\.pdf$/i, '');
  return s.trim().toLowerCase();
}

/**
 * Определяет расширение по MIME-типу, если имя файла его не имеет.
 */
function extFromContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.indexOf('application/pdf') !== -1) return '.pdf';
  if (ct.indexOf('image/png') !== -1) return '.png';
  if (ct.indexOf('image/jpeg') !== -1) return '.jpg';
  if (ct.indexOf('application/zip') !== -1) return '.zip';
  return '.bin';
}

/**
 * Собирает папку документов заявки на поставку на Google Диске (пункт 24 плана).
 * Прокси уже сходил в Ozon: собрал файлы состава и получил ссылки на этикетки
 * грузомест. Apps Script только раскладывает готовое по папкам, сам в Ozon не ходит.
 * Структура: [Родительская папка]/Озон <номер заявки>/
 *   - <Кластер>.xlsx — состав грузомест, приходит в base64
 *   - файл этикеток грузомест — качается по ссылке Ozon, имя даёт Ozon, не переименовывать
 *   - <Артикул>.pdf — этикетки ШК товаров, копируются из папки-библиотеки
 * Папка-библиотека лежит в РОДИТЕЛЬСКОЙ папке, а не внутри папки заявки.
 * Ссылки Ozon действуют 24 часа и открываются без ключей — в журналы их не писать.
 *
 * @param {Object} data { folderName, files, articles }
 * @returns {Object} { folderName, folderUrl, saved, missingLabels, problems }
 */
function saveSupplyDocsToDrive(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Данные для сборки папки не переданы');
  }

  const folderName = sanitizeDriveName(data.folderName);
  if (!folderName) {
    throw new Error('Не передано имя папки заявки');
  }

  const files = Array.isArray(data.files) ? data.files : [];
  const articles = Array.isArray(data.articles) ? data.articles : [];

  const settings = getOzonSettings();
  const rootFolderId = String(settings.supplyDocsFolderId || '').trim();
  if (!rootFolderId) {
    throw new Error('Не настроен ID родительской папки Google Диска (supplyDocsFolderId)');
  }

  let rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(rootFolderId);
  } catch (e) {
    throw new Error('Не удалось открыть родительскую папку Google Диска ID ' + rootFolderId + ': ' + e.toString());
  }

  const targetFolder = getOrCreateChildFolder(rootFolder, folderName);
  const saved = [];
  const problems = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i] || {};
    const label = String(f.name || f.fallbackName || 'файл');
    try {
      if (f.kind === 'base64') {
        const xlsName = sanitizeDriveName(f.name);
        if (!xlsName) {
          problems.push('Файл состава без имени пропущен');
          continue;
        }
        const xlsBlob = Utilities.newBlob(Utilities.base64Decode(String(f.content || '')), MimeType.MICROSOFT_EXCEL, xlsName);
        replaceFileInFolder(targetFolder, xlsName, xlsBlob);
        saved.push(xlsName);
      } else if (f.kind === 'url') {
        const response = UrlFetchApp.fetch(String(f.url || ''), { muteHttpExceptions: true, followRedirects: true });
        const code = response.getResponseCode();
        if (code < 200 || code >= 300) {
          problems.push('Этикетки грузомест (' + label + '): Ozon ответил HTTP ' + code);
          continue;
        }
        const blob = response.getBlob();
        const headers = response.getAllHeaders();
        const disp = headers['Content-Disposition'] || headers['content-disposition'] || '';
        const ct = headers['Content-Type'] || headers['content-type'] || blob.getContentType();
        const fallback = sanitizeDriveName(f.fallbackName) + extFromContentType(ct);
        const fileName = sanitizeDriveName(nameFromDisposition(disp, fallback));
        if (!fileName) {
          problems.push('Этикетки грузомест: не удалось определить имя файла');
          continue;
        }
        replaceFileInFolder(targetFolder, fileName, blob);
        saved.push(fileName);
      } else {
        problems.push('Неизвестный тип файла: ' + String(f.kind));
      }
    } catch (e) {
      problems.push('Файл ' + label + ': ' + e.toString());
    }
  }

  const labelsFolderName = String(settings.supplyDocsLabelsFolder || '').trim() || 'ШК озон для автоматизации';
  const missingLabels = [];
  const libIt = rootFolder.getFoldersByName(labelsFolderName);

  if (!libIt.hasNext()) {
    problems.push('Папка «' + labelsFolderName + '» не найдена в родительской папке — этикетки ШК товаров не скопированы');
  } else {
    const lib = libIt.next();

    // Читаем библиотеку один раз и строим указатель по нормализованному имени.
    // Прямой getFilesByName не годится: он требует побайтового совпадения.
    const libIndex = {};
    const allFiles = lib.getFiles();
    while (allFiles.hasNext()) {
      const lf = allFiles.next();
      const key = normalizeLabelKey(lf.getName());
      if (key && !libIndex[key]) libIndex[key] = lf;
    }

    for (let a = 0; a < articles.length; a++) {
      const art = sanitizeDriveName(articles[a]);
      if (!art) continue;
      const wanted = art.normalize ? art.normalize('NFC') + '.pdf' : art + '.pdf';
      const src = libIndex[normalizeLabelKey(art)];
      if (!src) {
        missingLabels.push(wanted);
        continue;
      }
      try {
        replaceFileInFolder(targetFolder, wanted, src.getBlob());
        saved.push(wanted);
      } catch (e2) {
        problems.push('Этикетка ' + wanted + ': ' + e2.toString());
      }
    }
  }

  return {
    folderName: folderName,
    folderUrl: targetFolder.getUrl(),
    saved: saved,
    missingLabels: missingLabels,
    problems: problems
  };
}

function getOzonCostSheet(ss) {
  return getOrCreateSheet(ss, 'Себестоимость Озон', OZON_COST_HEADERS);
}

/** Every row of the journal, oldest first — the order they were written in. */
function getOzonCostJournal() {
  const ss = getSpreadsheet();
  const sheet = getOzonCostSheet(ss);
  ensureColumns(sheet, OZON_COST_HEADERS);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(function(h) { return String(h).trim(); });
  const idx = {};
  OZON_COST_HEADERS.forEach(function(h) { idx[h] = headers.indexOf(h); });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.join('').trim() === '') continue;
    let dateStr = '';
    const rawDate = row[idx['Дата']];
    if (rawDate instanceof Date) {
      try { dateStr = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
      catch (e) { dateStr = String(rawDate); }
    } else {
      dateStr = String(rawDate || '');
    }
    rows.push({
      date: dateStr,
      cabinet: String(row[idx['Кабинет']] || '').trim(),
      article: String(row[idx['Артикул']] || '').trim(),
      sku: String(row[idx['SKU']] || '').trim(),
      stockBefore: parseNumber(row[idx['Остаток до']]),
      costBefore: parseNumber(row[idx['Себестоимость до']]),
      shipped: parseNumber(row[idx['Отгружено']]),
      shippedCost: parseNumber(row[idx['Себестоимость отгрузки']]),
      costAfter: parseNumber(row[idx['Себестоимость после']]),
      opId: String(row[idx['OpID']] || '').trim(),
      exported: String(row[idx['Выгружено в КАН']] || '').trim(),
      source: String(row[idx['Источник']] || '').trim()
    });
  }
  return rows;
}

/**
 * The cost in force right now, per cabinet and article: the LAST row wins.
 * Rows are read in sheet order, so a later row simply overwrites an earlier one.
 */
function getOzonCostState() {
  const state = {};
  getOzonCostJournal().forEach(function(r) {
    if (!r.cabinet || !r.article) return;
    state[r.cabinet + '|' + r.article] = {
      cabinet: r.cabinet,
      article: r.article,
      sku: r.sku,
      cost: r.costAfter,
      date: r.date,
      opId: r.opId,
      exported: r.exported
    };
  });
  return state;
}

/**
 * Item 47: the guard the owner asked for — a supply whose operation is already in the journal
 * must never be counted into the cost a second time.
 */
function isOzonCostCounted(journal, opId, cabinet, article) {
  const key = String(opId || '').trim();
  if (!key) return false;
  for (let i = 0; i < journal.length; i++) {
    const r = journal[i];
    if (r.opId === key && r.cabinet === String(cabinet).trim() && r.article === String(article).trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Item 47, stage 2. Goods Ozon has actually taken onto stock: «Доступно» + «Возвраты».
 *
 * «В пути» is deliberately NOT read here. The owner's rule (26.08.2026) is that Ozon puts a
 * supply onto stock only at the destination cluster, when that cluster's supply is COMPLETED;
 * handing the goods over at the drop-off point means Ozon took them for carriage, nothing more.
 * The column itself is ambiguous and not ours to control — on 25.08 the 294 pieces of a supply
 * still IN_TRANSIT sat in it as 252 «В пути» plus 42 «В заявках» — so the goods in flight are
 * counted from OUR OWN records instead, by getOzonShippedNotAcceptedForCost.
 */
function getOzonAcceptedStockForCost(cabinet, article) {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameRobust(ss, 'Остатки Ozon');
  if (!sheet) return 0;
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return 0;
  const headers = values[0].map(function(h) { return String(h).trim(); });
  const ci = headers.indexOf('Кабинет'), ai = headers.indexOf('Артикул');
  const parts = ['Доступно', 'Возвраты'].map(function(n) { return headers.indexOf(n); });
  if (ci === -1 || ai === -1) return 0;
  const cab = String(cabinet).trim(), art = String(article).trim();
  let total = 0;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[ci]).trim() !== cab || String(row[ai]).trim() !== art) continue;
    parts.forEach(function(idx) { if (idx !== -1) total += parseNumber(row[idx]); });
  }
  return total;
}

/**
 * Supplies whose goods must NOT be counted as «in flight» any more.
 *
 * 26.08.2026, выведено сверкой с боевыми данными. Сначала сюда входили только COMPLETED и
 * CANCELLED — и получилось задвоение: поставка, доехавшая до склада хранения, уже лежит в
 * «Доступно», а мы продолжали считать её в пути. По «Полке выдвижной 27 см» это давало +78
 * штук к основанию, по «Набору полок» +36, по «Органайзеру 2 пол PureWhite» +8.
 *
 * Граница проходит по прибытию на склад хранения: с этого момента товар у Озона на остатке,
 * даже если бумаги ещё не закрыты. Ровно этот набор статусов приложение уже называет этапом
 * приёмки (ACCEPTANCE_STAGE_STATUSES в src/lib/ozonStatus.ts) — держим одно понятие на две
 * стороны. CANCELLED добавлен отдельно: такой товар не приедет никогда.
 *
 * После правки расхождение с озоновскими колонками «В пути» + «В заявках» стало ±6 штук
 * вместо +78, и остаток объясняется тем, что снимок остатков и статусы поставок снимаются
 * не в одну и ту же секунду.
 */
const OZON_SUPPLY_SETTLED_STATUSES = [
  'ACCEPTANCE_AT_STORAGE_WAREHOUSE',
  'REPORTS_CONFIRMATION_AWAITING',
  'REPORT_REJECTED',
  'COMPLETED',
  'CANCELLED'
];

/** offerId/штрихкод позиции Ozon -> наш артикул. */
function buildOzonArticleResolver() {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameRobust(ss, 'SKU');
  const byBarcode = {}, byLower = {};
  if (sheet) {
    const values = sheet.getDataRange().getValues();
    if (values.length > 1) {
      const headers = values[0].map(function(h) { return String(h).trim(); });
      const si = headers.indexOf('SKU'), bi = headers.indexOf('ШК Ozon');
      for (let i = 1; i < values.length; i++) {
        const sku = String(values[i][si] || '').trim();
        if (!sku) continue;
        byLower[sku.toLowerCase()] = sku;
        if (bi !== -1) {
          const bc = String(values[i][bi] || '').trim();
          if (bc) byBarcode[bc] = sku;
        }
      }
    }
  }
  return function(item) {
    const bc = String((item && item.barcode) || '').trim();
    if (bc && byBarcode[bc]) return byBarcode[bc];
    const offer = String((item && (item.offerId || item.offer_id)) || '').trim();
    if (!offer) return '';
    return byLower[offer.toLowerCase()] || offer;
  };
}

/**
 * Item 47, stage 2. Goods we have already written off but Ozon has not finished accepting.
 *
 * Их себестоимость уже подмешана в среднюю, поэтому они обязаны быть в основании — иначе
 * следующая поставка будет считаться от заниженного остатка. Считаем по СВОИМ записям, а не
 * по колонке «В пути»: поставка помечена обработанной ровно тогда, когда мы её списали.
 *
 * Поставка, которую списывают ПРЯМО СЕЙЧАС, сюда не попадает: её поставки помечаются
 * обработанными уже после проведения расхода. Поэтому вычитать её из основания не нужно —
 * задвоения не возникает по построению.
 */
function getOzonShippedNotAcceptedForCost(cabinet, resolveArticle) {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameRobust(ss, 'Внешние отгрузки');
  const byArticle = {};
  if (!sheet) return byArticle;
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return byArticle;
  const headers = values[0].map(function(h) { return String(h).trim(); });
  const ci = headers.indexOf('Кабинет'), sti = headers.indexOf('Статус');
  const osi = headers.indexOf('Статус Ozon'), ii = headers.indexOf('ПозицииJSON');
  if (sti === -1 || osi === -1 || ii === -1) return byArticle;
  const cab = String(cabinet).trim();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (ci !== -1 && String(row[ci]).trim() !== cab) continue;
    if (String(row[sti]).trim().toLowerCase() !== 'processed') continue;
    const ozonStatus = String(row[osi]).trim().toUpperCase();
    if (OZON_SUPPLY_SETTLED_STATUSES.indexOf(ozonStatus) !== -1) continue;
    let items;
    try { items = JSON.parse(String(row[ii] || '[]')); } catch (e) { continue; }
    if (!Array.isArray(items)) continue;
    items.forEach(function(it) {
      const article = resolveArticle(it);
      if (!article) return;
      byArticle[article] = (byArticle[article] || 0) + (Number(it.quantity) || 0);
    });
  }
  return byArticle;
}

/** «Ozon (Магазин) [расходы]» -> «Магазин». Пустая строка, если это не отгрузка на Ozon. */
function ozonCabinetFromDestination(destination) {
  const m = String(destination || '').match(/Ozon\s*\(([^)]+)\)/);
  return m ? m[1].trim() : '';
}

/**
 * Item 47, stage 2. Blends a shipment into the cost of the goods already on Ozon and writes
 * the result as a new row of the journal.
 *
 * The base is the stock MINUS this very shipment. A write-off only becomes available once Ozon
 * has accepted the goods at the drop-off point, so by this moment they are already inside the
 * stock figures — leaving them in would blend the shipment into itself. The base actually used
 * is written into the row, so a wrong reading is visible instead of silently distorting money.
 *
 * A supply already in the journal is never counted again: the guard is the triple of operation
 * key, cabinet and article, because one operation ships several articles at once.
 *
 * Failures here must never break the write-off itself — the expense is the operation the user
 * asked for, the cost journal is bookkeeping on top of it. The caller wraps this in try/catch.
 */
function appendOzonCostForShipment(items, destination, dateStr, opId, username) {
  const cabinet = ozonCabinetFromDestination(destination);
  if (!cabinet) return { written: 0, skipped: 0 };

  const ss = getSpreadsheet();
  const sheet = getOzonCostSheet(ss);
  ensureColumns(sheet, OZON_COST_HEADERS);
  const journal = getOzonCostJournal();
  const state = getOzonCostState();

  let day = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  // Одинаковые артикулы одной операции складываются: иначе вторая строка того же артикула
  // сочла бы себя уже посчитанной и потерялась.
  const byArticle = {};
  items.forEach(function(item) {
    if (!item || !item.article) return;
    if (item.status && item.status !== 'ok') return;
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    if (qty <= 0) return;
    const key = String(item.article).trim();
    if (!byArticle[key]) byArticle[key] = { qty: 0, value: 0 };
    byArticle[key].qty += qty;
    byArticle[key].value += qty * price;
  });

  // Оба справочника строятся один раз на всю операцию: она может везти несколько артикулов.
  const resolveArticle = buildOzonArticleResolver();
  const inFlight = getOzonShippedNotAcceptedForCost(cabinet, resolveArticle);

  const rows = [];
  let skipped = 0;
  Object.keys(byArticle).forEach(function(article) {
    if (isOzonCostCounted(journal, opId, cabinet, article)) { skipped += 1; return; }
    const shipped = byArticle[article].qty;
    const shippedCost = roundToTwo(byArticle[article].value / shipped);
    const prior = state[cabinet + '|' + article];
    // Основание: принятое Озоном плюс наши поставки в пути. Текущую поставку не вычитаем —
    // её ещё нет ни в одном из двух слагаемых.
    const base = Math.max(0, getOzonAcceptedStockForCost(cabinet, article) + (inFlight[article] || 0));

    let costAfter, source;
    if (!prior) {
      // Прежней себестоимости нет: смешивать не с чем, берём себестоимость самой отгрузки.
      costAfter = shippedCost;
      source = 'первая отгрузка, прежней себестоимости нет';
    } else if (base + shipped <= 0) {
      costAfter = shippedCost;
      source = 'отгрузка';
    } else {
      costAfter = roundToTwo((base * prior.cost + shipped * shippedCost) / (base + shipped));
      source = 'отгрузка';
    }

    rows.push([
      day, cabinet, article, (prior && prior.sku) || '',
      base, prior ? prior.cost : '', shipped, shippedCost, costAfter,
      String(opId || ''), '', source
    ]);
  });

  if (rows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, OZON_COST_HEADERS.length).setValues(rows);
    SpreadsheetApp.flush();
  }
  return { written: rows.length, skipped: skipped };
}

function getOzonSupplyRequests() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Заявки Ozon', OZON_SUPPLY_REQUESTS_HEADERS);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(function(h) { return String(h).trim(); });
  const idx = {};
  OZON_SUPPLY_REQUESTS_HEADERS.forEach(function(h) { idx[h] = headers.indexOf(h); });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.join('').trim() === '') continue;
    rows.push({
      id: String(row[idx['ID']] || ''),
      date: row[idx['Дата']] ? new Date(row[idx['Дата']]).toISOString() : '',
      cabinet: String(row[idx['Кабинет']] || ''),
      draftId: String(row[idx['DraftID']] || ''),
      orderId: String(row[idx['OrderID']] || ''),
      dropOffName: String(row[idx['Точка отгрузки']] || ''),
      clusters: String(row[idx['Кластеры']] || ''),
      itemsJSON: String(row[idx['Состав']] || ''),
      who: String(row[idx['Кто']] || ''),
      status: String(row[idx['Статус']] || '')
    });
  }
  return rows;
}



function getExternalShipmentsSheet() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Внешние отгрузки', EXTERNAL_SHIPMENTS_HEADERS);
  ensureColumns(sheet, EXTERNAL_SHIPMENTS_HEADERS);
  return sheet;
}

function getOzonStocksSheet() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Остатки Ozon', OZON_STOCKS_HEADERS);
  ensureColumns(sheet, OZON_STOCKS_HEADERS);
  return sheet;
}

function getOzonStockHistorySheet() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'История остатков Ozon', OZON_STOCK_HISTORY_HEADERS);
  ensureColumns(sheet, OZON_STOCK_HISTORY_HEADERS);
  return sheet;
}

function getOzonSalesArchiveSheet() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, OZON_SALES_ARCHIVE_SHEET_NAME, OZON_SALES_HEADERS);
  ensureColumns(sheet, OZON_SALES_HEADERS);
  return sheet;
}

function getOzonSalesSheet() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Продажи Ozon', OZON_SALES_HEADERS);
  ensureColumns(sheet, OZON_SALES_HEADERS);
  return sheet;
}

function getOzonSettingsSheet() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Настройки Ozon', OZON_SETTINGS_HEADERS);
  ensureColumns(sheet, OZON_SETTINGS_HEADERS);
  return sheet;
}

function getOzonSettings() {
  const sheet = getOzonSettingsSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), OZON_SETTINGS_HEADERS.length);

  ensureColumns(sheet, OZON_SETTINGS_HEADERS);
  const data = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const keyIdx = headers.indexOf('Ключ');
  const valIdx = headers.indexOf('Значение');
  const descIdx = headers.indexOf('Описание');

  if (keyIdx === -1 || valIdx === -1 || descIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "Настройки Ozon"');
  }

  const result = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    const k = String(row[keyIdx] || '').trim();
    if (!k) continue;
    const rawVal = row[valIdx];
    if (OZON_SETTINGS_STRING_KEYS.includes(k)) {
      result[k] = String(rawVal || '').trim();
    } else {
      const numVal = Number(rawVal);
      if (!isNaN(numVal) && rawVal !== '' && rawVal !== null) {
        result[k] = numVal;
      }
    }
  }

  let appended = false;
  for (let d = 0; d < OZON_SETTINGS_DEFAULTS.length; d++) {
    const def = OZON_SETTINGS_DEFAULTS[d];
    if (result[def.key] === undefined) {
      sheet.appendRow([def.key, def.value, def.desc]);
      result[def.key] = def.value;
      appended = true;
    }
  }

  if (appended) {
    SpreadsheetApp.flush();
  }

  return result;
}

function saveOzonSettings(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Некорректные данные для сохранения настроек Ozon');
  }

  const validKeys = OZON_SETTINGS_DEFAULTS.map(d => d.key);
  const defaultsMap = {};
  OZON_SETTINGS_DEFAULTS.forEach(d => { defaultsMap[d.key] = d; });

  const keysToSave = {};
  for (const k in data) {
    if (!validKeys.includes(k)) continue;
    const rawVal = data[k];

    if (k === 'dropOffWarehouseId') {
      const idVal = String(rawVal == null ? '' : rawVal).trim();
      if (idVal && !/^\d+$/.test(idVal)) {
        throw new Error('Настройка "dropOffWarehouseId" должна быть числом или пустой строкой');
      }
      keysToSave[k] = idVal;
      continue;
    }
    if (k === 'dropOffWarehouseName') {
      keysToSave[k] = String(rawVal == null ? '' : rawVal).trim();
      continue;
    }
    if (k === 'dropOffWarehouseType') {
      const typeVal = String(rawVal == null ? '' : rawVal).trim().toUpperCase();
      if (typeVal && OZON_DROPOFF_TYPES.indexOf(typeVal) === -1) {
        throw new Error('Настройка "dropOffWarehouseType": недопустимое значение "' + typeVal + '"');
      }
      keysToSave[k] = typeVal;
      continue;
    }

    if (OZON_SETTINGS_STRING_KEYS.includes(k)) {
      const strVal = String(rawVal || '').trim();
      if (!strVal) {
        keysToSave[k] = '';
        continue;
      }
      const parts = strVal.split(',').map(s => s.trim()).filter(Boolean);
      if (k === 'priorityClusters') {
        // Формат элемента: «КластерID:коэффициент», коэффициент — число не меньше 1
        const normalized = [];
        for (let p = 0; p < parts.length; p++) {
          const pair = parts[p].split(':');
          const id = String(pair[0] || '').trim();
          const coef = Number(String(pair[1] || '').trim());
          if (!/^\d+$/.test(id)) {
            throw new Error('Настройка "priorityClusters": КластерID должен быть числом, получено "' + parts[p] + '"');
          }
          if (!Number.isFinite(coef) || coef < 1) {
            throw new Error('Настройка "priorityClusters": коэффициент должен быть числом не меньше 1, получено "' + parts[p] + '"');
          }
          normalized.push(id + ':' + coef);
        }
        keysToSave[k] = normalized.join(',');
        continue;
      }
      for (let p = 0; p < parts.length; p++) {
        if (!/^\d+$/.test(parts[p])) {
          throw new Error('Значение настройки "' + k + '" должно быть списком числовых КластерID через запятую');
        }
      }
      keysToSave[k] = parts.join(',');
      continue;
    }

    const numVal = Number(rawVal);

    if (!Number.isFinite(numVal) || numVal < 0) {
      throw new Error('Значение настройки "' + k + '" должно быть числом не меньше 0');
    }

    if (k === 'speedWeeks' || k === 'salesRetentionWeeks' || k === 'trendWeeks' || k === 'bestWeeks' || k === 'stockHistoryRetentionWeeks') {
      if (!Number.isInteger(numVal) || numVal < 1) {
        throw new Error('Значение настройки "' + k + '" должно быть целым числом не меньше 1');
      }
    }

    keysToSave[k] = numVal;
  }

  const sheet = getOzonSettingsSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), OZON_SETTINGS_HEADERS.length);

  ensureColumns(sheet, OZON_SETTINGS_HEADERS);
  const sheetData = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = sheetData[0].map(h => String(h).trim());

  const keyIdx = headers.indexOf('Ключ');
  const valIdx = headers.indexOf('Значение');

  if (keyIdx === -1 || valIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "Настройки Ozon"');
  }

  const keyToRowIndex = {};
  for (let i = 1; i < sheetData.length; i++) {
    const keyVal = String(sheetData[i][keyIdx] || '').trim();
    if (keyVal) {
      keyToRowIndex[keyVal] = i + 1;
    }
  }

  for (const k in keysToSave) {
    const val = keysToSave[k];
    if (keyToRowIndex[k]) {
      const rowIndex = keyToRowIndex[k];
      sheet.getRange(rowIndex, valIdx + 1).setValue(val);
    } else {
      const def = defaultsMap[k];
      sheet.appendRow([k, val, def ? def.desc : '']);
    }
  }

  SpreadsheetApp.flush();
  return getOzonSettings();
}

function getOzonClustersSheet() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Кластеры Ozon', OZON_CLUSTERS_HEADERS);
  ensureColumns(sheet, OZON_CLUSTERS_HEADERS);
  return sheet;
}

function saveOzonClusters(payload) {
  if (!payload || !Array.isArray(payload.clusters)) {
    throw new Error('Некорректный payload: ожидается объект с массивом clusters');
  }

  const sheet = getOzonClustersSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), OZON_CLUSTERS_HEADERS.length);

  ensureColumns(sheet, OZON_CLUSTERS_HEADERS);
  const data = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const clusterIdIdx = headers.indexOf('КластерID');
  const nameIdx = headers.indexOf('Название');
  const addedIdx = headers.indexOf('Добавлен');
  const notifiedIdx = headers.indexOf('Уведомлён');

  if (clusterIdIdx === -1 || nameIdx === -1 || addedIdx === -1 || notifiedIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "Кластеры Ozon"');
  }

  const isInitialFill = lastRow <= 1;
  const existingMap = new Map();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    const cid = String(row[clusterIdIdx] || '').trim();
    if (cid) {
      existingMap.set(cid, { rowNum: i + 1, name: String(row[nameIdx] || '').trim() });
    }
  }

  let newClusters = 0;
  const todayStr = getTodayDateString();
  const clusters = payload.clusters;

  for (let c = 0; c < clusters.length; c++) {
    const item = clusters[c];
    if (!item) continue;
    const cid = String(item.clusterId || '').trim();
    if (!cid) continue;
    const cname = String(item.clusterName || '').trim();

    if (existingMap.has(cid)) {
      const existing = existingMap.get(cid);
      if (existing.name !== cname) {
        sheet.getRange(existing.rowNum, nameIdx + 1).setValue(cname);
        existing.name = cname;
      }
    } else {
      const notifiedVal = isInitialFill ? 1 : 0;
      sheet.appendRow([cid, cname, todayStr, notifiedVal]);
      existingMap.set(cid, { rowNum: sheet.getLastRow(), name: cname });
      newClusters++;
    }
  }

  SpreadsheetApp.flush();
  return {
    totalClusters: existingMap.size,
    newClusters: isInitialFill ? 0 : newClusters
  };
}

function getOzonClusters() {
  const sheet = getOzonClustersSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), OZON_CLUSTERS_HEADERS.length);

  ensureColumns(sheet, OZON_CLUSTERS_HEADERS);
  const data = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const clusterIdIdx = headers.indexOf('КластерID');
  const nameIdx = headers.indexOf('Название');
  const addedIdx = headers.indexOf('Добавлен');
  const notifiedIdx = headers.indexOf('Уведомлён');

  if (clusterIdIdx === -1 || nameIdx === -1 || addedIdx === -1 || notifiedIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "Кластеры Ozon"');
  }

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    const cid = String(row[clusterIdIdx] || '').trim();
    if (!cid) continue;

    const cname = String(row[nameIdx] || '').trim();
    const addedAt = row[addedIdx] ? String(row[addedIdx]).trim() : '';
    const notified = Number(row[notifiedIdx]) === 1;

    result.push({
      clusterId: cid,
      clusterName: cname,
      addedAt: addedAt,
      notified: notified
    });
  }

  return result;
}

function markOzonClustersNotified() {
  const sheet = getOzonClustersSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), OZON_CLUSTERS_HEADERS.length);

  ensureColumns(sheet, OZON_CLUSTERS_HEADERS);
  const data = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const notifiedIdx = headers.indexOf('Уведомлён');
  if (notifiedIdx === -1) {
    throw new Error('Колонка "Уведомлён" не найдена в листе "Кластеры Ozon"');
  }

  let marked = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    if (Number(row[notifiedIdx]) !== 1) {
      sheet.getRange(i + 1, notifiedIdx + 1).setValue(1);
      marked++;
    }
  }

  if (marked > 0) {
    SpreadsheetApp.flush();
  }

  return { marked: marked };
}

function saveOzonStocks(payload) {
  if (!payload || !payload.rows || !Array.isArray(payload.rows)) {
    throw new Error('Некорректный payload: список строк rows обязателен и должен быть массивом');
  }
  const okCabinets = payload.okCabinets || [];
  if (!Array.isArray(okCabinets)) {
    throw new Error('Некорректный payload: okCabinets должен быть массивом');
  }

  const sheet = getOzonStocksSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), OZON_STOCKS_HEADERS.length);
  
  ensureColumns(sheet, OZON_STOCKS_HEADERS);
  const data = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const cabinetIdx = headers.indexOf('Кабинет');
  const skuIdx = headers.indexOf('SKU');
  const articleIdx = headers.indexOf('Артикул');
  const nameIdx = headers.indexOf('Название');
  const warehouseIdx = headers.indexOf('Склад');
  const clusterIdx = headers.indexOf('Кластер');
  const availableIdx = headers.indexOf('Доступно');
  const preparingIdx = headers.indexOf('Готовим к продаже');
  const requestedIdx = headers.indexOf('В заявках');
  const transitIdx = headers.indexOf('В пути');
  const excessIdx = headers.indexOf('Излишки');
  const returnsIdx = headers.indexOf('Возвраты');
  const otherIdx = headers.indexOf('Прочее');
  const updatedIdx = headers.indexOf('Обновлено');
  const clusterIdIdx = headers.indexOf('КластерID');

  if (cabinetIdx === -1 || skuIdx === -1 || articleIdx === -1 || nameIdx === -1 || warehouseIdx === -1 || clusterIdx === -1 || availableIdx === -1 || preparingIdx === -1 || requestedIdx === -1 || transitIdx === -1 || excessIdx === -1 || returnsIdx === -1 || otherIdx === -1 || updatedIdx === -1 || clusterIdIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "Остатки Ozon"');
  }

  const keptRows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    const cabinetVal = String(row[cabinetIdx] || '').trim();
    if (!okCabinets.includes(cabinetVal)) {
      keptRows.push(row);
    }
  }

  const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const newRows = payload.rows.map(item => {
    const row = new Array(headers.length).fill('');
    row[cabinetIdx] = item.cabinet || '';
    row[skuIdx] = item.sku || '';
    row[articleIdx] = item.offerId || '';
    row[nameIdx] = item.name || '';
    row[warehouseIdx] = item.warehouseName || '';
    row[clusterIdx] = item.clusterName || '';
    row[availableIdx] = item.available !== undefined ? item.available : 0;
    row[preparingIdx] = item.preparing !== undefined ? item.preparing : 0;
    row[requestedIdx] = item.requested !== undefined ? item.requested : 0;
    row[transitIdx] = item.transit !== undefined ? item.transit : 0;
    row[excessIdx] = item.excess !== undefined ? item.excess : 0;
    row[returnsIdx] = item.returns !== undefined ? item.returns : 0;
    row[otherIdx] = item.other !== undefined ? item.other : 0;
    row[updatedIdx] = nowStr;
    row[clusterIdIdx] = item.clusterId || '';
    return row;
  });

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }

  const combinedRows = keptRows.concat(newRows);
  if (combinedRows.length > 0) {
    sheet.getRange(2, 1, combinedRows.length, headers.length).setValues(combinedRows);
  }

  // Накопление истории остатков (п.42) — вспомогательная задача, не должна срывать сохранение остатков.
  try {
    updateOzonStockHistory(combinedRows, headers);
  } catch (e) {
    Logger.log('Не удалось обновить историю остатков Ozon: ' + e);
  }

  // Дублирование названий в лист SKU — тоже вспомогательная задача и тоже не должна срывать сохранение.
  try {
    updateSkuNamesFromOzonStocks(payload.rows);
  } catch (e) {
    Logger.log('Не удалось обновить названия Ozon в листе SKU: ' + e);
  }

  return {
    savedRows: newRows.length,
    keptRows: keptRows.length,
    cabinets: okCabinets
  };
}

// Сохраняет актуальные названия товаров Ozon в лист SKU.
// Зачем: лист "Остатки Ozon" перезаписывается целиком при каждой синхронизации, и у распроданного
// в ноль товара строк остатков нет вообще — вместе с ними пропадает и название. В листе SKU название
// живёт постоянно и распродажу переживает.
// rows — payload.rows функции saveOzonStocks (поля offerId, sku, name).
function updateSkuNamesFromOzonStocks(rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) return;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) return;
  // Колонка создаётся здесь же: автоопрос по расписанию вызывает сохранение остатков раньше,
  // чем кто-либо откроет приложение, и без этого первый прогон прошёл бы вхолостую.
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)', 'Срок поставки (дни)', 'Название Ozon']);

  // Названия по двум ключам связывания: артикул Ozon и ШК Ozon. Берётся первое непустое —
  // по одному товару приходит много строк (склады, кабинеты) с одинаковым названием.
  const nameByArticle = {};
  const nameByOzonSku = {};
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    if (!item) continue;
    const name = String(item.name || '').trim();
    if (!name) continue;
    const article = String(item.offerId || '').trim().toLowerCase();
    if (article && !nameByArticle[article]) nameByArticle[article] = name;
    // ШК Ozon приходит числом, а из таблицы читается то числом, то строкой — только String().
    const ozonSku = String(item.sku || '').trim();
    if (ozonSku && ozonSku !== '0' && !nameByOzonSku[ozonSku]) nameByOzonSku[ozonSku] = name;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  const headers = data[0].map(h => String(h).trim());
  const skuIdx = headers.indexOf('SKU') !== -1 ? headers.indexOf('SKU') : 0;
  const ozonIdx = headers.indexOf('ШК Ozon');
  const nameIdx = headers.indexOf('Название Ozon');
  if (nameIdx === -1) return;

  // Готовится весь столбец названий целиком: построчная запись в Apps Script слишком дорога.
  const nameColumn = [];
  let hasChanges = false;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const currentName = nameIdx < row.length ? String(row[nameIdx] || '') : '';
    const article = String(row[skuIdx] || '').trim().toLowerCase();
    // В листе SKU пустой ШК Ozon хранится как '0' — такой ключ ничего не связывает.
    const ozonSku = ozonIdx !== -1 && ozonIdx < row.length ? String(row[ozonIdx] || '').trim() : '';
    let freshName = article && nameByArticle[article] ? nameByArticle[article] : '';
    if (!freshName && ozonSku && ozonSku !== '0' && nameByOzonSku[ozonSku]) freshName = nameByOzonSku[ozonSku];
    // Пустое название не затирает старое: товара просто нет в этой выгрузке остатков — он распродан.
    if (freshName && freshName !== currentName) {
      nameColumn.push([freshName]);
      hasChanges = true;
    } else {
      nameColumn.push([currentName]);
    }
  }

  if (!hasChanges) return;
  sheet.getRange(2, nameIdx + 1, nameColumn.length, 1).setValues(nameColumn);
}

// Понедельник ISO-недели, к которой относится дата dateStr (yyyy-MM-dd).
// Неделя начинается с понедельника: воскресенье относится к начавшейся в понедельник неделе, а не к следующей.
function getIsoWeekMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0 = воскресенье, 1 = понедельник, ..., 6 = суббота
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

// Сдвигает дату-строку yyyy-MM-dd на заданное число недель (может быть отрицательным).
function shiftIsoWeek(dateStr, deltaWeeks) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

// Копит недельную историю наличия остатков Ozon по сочетанию Кабинет+Артикул+КластерID (п.42 плана):
// сколько дней на неделе товар реально был в наличии и сколько дней автоопрос вообще отработал.
// Количество остатков здесь не хранится — только счётчики дней, они нужны будущему расчёту скорости продаж.
// finalRows/headers — итоговые данные листа "Остатки Ozon" после его перезаписи в saveOzonStocks (лист повторно не читается).
function updateOzonStockHistory(finalRows, headers) {
  const cabinetIdx = headers.indexOf('Кабинет');
  const articleIdx = headers.indexOf('Артикул');
  const clusterIdx = headers.indexOf('Кластер');
  const availableIdx = headers.indexOf('Доступно');
  const transitIdx = headers.indexOf('В пути');
  const clusterIdIdx = headers.indexOf('КластерID');

  if (cabinetIdx === -1 || articleIdx === -1 || clusterIdx === -1 || availableIdx === -1 || transitIdx === -1 || clusterIdIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в данных остатков Ozon');
  }

  // Сегодняшняя дата и понедельник текущей ISO-недели по московскому времени.
  const todayStr = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  const currentWeekStr = getIsoWeekMonday(todayStr);

  // Сворачиваем строки остатков по Кабинет+Артикул+КластерID: суммируем Доступно и В пути по складам кластера.
  const combos = {};
  finalRows.forEach(function(row) {
    const cabinet = String(row[cabinetIdx] || '').trim();
    const article = String(row[articleIdx] || '').trim();
    const clusterId = String(row[clusterIdIdx] || '').trim();
    if (!cabinet || !article || !clusterId) return;
    const key = cabinet + '|' + article + '|' + clusterId;
    if (!combos[key]) {
      combos[key] = {
        cabinet: cabinet,
        article: article,
        clusterId: clusterId,
        clusterName: String(row[clusterIdx] || '').trim(),
        available: 0,
        transit: 0
      };
    }
    combos[key].available += Number(row[availableIdx]) || 0;
    combos[key].transit += Number(row[transitIdx]) || 0;
  });

  // Срок хранения истории — из настроек, при ошибке используем дефолт 15 недель.
  let retentionWeeks = 15;
  try {
    const settings = getOzonSettings();
    const val = Number(settings.stockHistoryRetentionWeeks);
    if (Number.isFinite(val) && val >= 1) retentionWeeks = val;
  } catch (e) {
    // используем дефолт
  }
  const oldestKeptWeek = shiftIsoWeek(currentWeekStr, -(retentionWeeks - 1));

  const sheet = getOzonStockHistorySheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), OZON_STOCK_HISTORY_HEADERS.length);
  const data = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const hdrs = data[0].map(h => String(h).trim());

  const weekIdx = hdrs.indexOf('Неделя');
  const hCabinetIdx = hdrs.indexOf('Кабинет');
  const hArticleIdx = hdrs.indexOf('Артикул');
  const hClusterIdIdx = hdrs.indexOf('КластерID');
  const hClusterIdx = hdrs.indexOf('Кластер');
  const daysAvailIdx = hdrs.indexOf('Дней в наличии');
  const daysObsIdx = hdrs.indexOf('Дней наблюдений');
  const lastDayIdx = hdrs.indexOf('Последний учтённый день');
  const hUpdatedIdx = hdrs.indexOf('Обновлено');

  if (weekIdx === -1 || hCabinetIdx === -1 || hArticleIdx === -1 || hClusterIdIdx === -1 || hClusterIdx === -1 || daysAvailIdx === -1 || daysObsIdx === -1 || lastDayIdx === -1 || hUpdatedIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "История остатков Ozon"');
  }

  // Google Sheets возвращает даты-ячейки как объект Date, а не как записанную строку yyyy-MM-dd.
  // Приводим к строке ровно как normWeek() в saveOzonSales.
  function normDateCell(v) {
    if (v instanceof Date) {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return String(v || '').trim();
  }

  // Отбрасываем строки старше срока хранения.
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    const weekVal = normDateCell(row[weekIdx]);
    if (weekVal && weekVal < oldestKeptWeek) continue;
    rows.push(row);
  }

  // Индекс существующих строк текущей недели по ключу сочетания.
  const rowIndexByKey = {};
  rows.forEach(function(row, idx) {
    const weekVal = normDateCell(row[weekIdx]);
    if (weekVal !== currentWeekStr) return;
    const key = String(row[hCabinetIdx] || '').trim() + '|' + String(row[hArticleIdx] || '').trim() + '|' + String(row[hClusterIdIdx] || '').trim();
    rowIndexByKey[key] = idx;
  });

  const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

  // Применяем сегодняшний опрос к каждому сочетанию: создаём строку недели либо докручиваем счётчики.
  Object.keys(combos).forEach(function(key) {
    const combo = combos[key];
    const inStock = (combo.available + combo.transit) > 0;
    const existingIdx = rowIndexByKey[key];

    if (existingIdx === undefined) {
      const newRow = new Array(hdrs.length).fill('');
      newRow[weekIdx] = currentWeekStr;
      newRow[hCabinetIdx] = combo.cabinet;
      newRow[hArticleIdx] = combo.article;
      newRow[hClusterIdIdx] = combo.clusterId;
      newRow[hClusterIdx] = combo.clusterName;
      newRow[daysAvailIdx] = inStock ? 1 : 0;
      newRow[daysObsIdx] = 1;
      newRow[lastDayIdx] = todayStr;
      newRow[hUpdatedIdx] = nowStr;
      rows.push(newRow);
      rowIndexByKey[key] = rows.length - 1;
      return;
    }

    const row = rows[existingIdx];
    const lastDay = normDateCell(row[lastDayIdx]);
    if (lastDay === todayStr) return; // опрос уже учтён сегодня, второй запуск ничего не меняет

    row[daysObsIdx] = (Number(row[daysObsIdx]) || 0) + 1;
    if (inStock) {
      row[daysAvailIdx] = (Number(row[daysAvailIdx]) || 0) + 1;
    }
    row[lastDayIdx] = todayStr;
    row[hUpdatedIdx] = nowStr;
    row[hClusterIdx] = combo.clusterName;
  });

  // Порядок строк сохраняем: старые недели выше, новые ниже.
  rows.sort(function(a, b) {
    const wa = normDateCell(a[weekIdx]);
    const wb = normDateCell(b[weekIdx]);
    return wa < wb ? -1 : wa > wb ? 1 : 0;
  });

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, hdrs.length).setValues(rows);
  }
}

function saveOzonSales(payload) {
  if (!payload || !payload.rows || !Array.isArray(payload.rows)) {
    throw new Error('Некорректный payload: список строк rows обязателен и должен быть массивом');
  }
  const okCabinets = payload.okCabinets || [];
  if (!Array.isArray(okCabinets)) {
    throw new Error('Некорректный payload: okCabinets должен быть массивом');
  }
  const mode = payload.mode === 'full' ? 'full' : 'recent';
  const replacedWeeks = Array.isArray(payload.replacedWeeks) ? payload.replacedWeeks : [];

  function normWeek(v) {
    if (v instanceof Date) {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return String(v || '').trim();
  }

  const sheet = getOzonSalesSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), OZON_SALES_HEADERS.length);

  ensureColumns(sheet, OZON_SALES_HEADERS);
  const data = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const weekIdx = headers.indexOf('Неделя');
  const cabinetIdx = headers.indexOf('Кабинет');
  const articleIdx = headers.indexOf('Артикул');
  const clusterIdx = headers.indexOf('Кластер');
  const qtyIdx = headers.indexOf('Количество');
  const updatedIdx = headers.indexOf('Обновлено');
  const daysIdx = headers.indexOf('Дней');

  if (weekIdx === -1 || cabinetIdx === -1 || articleIdx === -1 || clusterIdx === -1 || qtyIdx === -1 || updatedIdx === -1 || daysIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "Продажи Ozon"');
  }

  let retentionWeeks = OZON_SALES_RETENTION_WEEKS;
  try {
    const ozonSettings = getOzonSettings();
    if (Number.isFinite(ozonSettings.salesRetentionWeeks) && ozonSettings.salesRetentionWeeks >= 1) {
      retentionWeeks = ozonSettings.salesRetentionWeeks;
    }
  } catch (e) {
    Logger.log('Не удалось прочитать Настройки Ozon, использую дефолт ретенции: ' + e);
  }
  const cutoffMs = Date.now() - retentionWeeks * 7 * 24 * 60 * 60 * 1000;

  // Item 26 (2026-08-20): the compacted blocks now live in their own sheet, but the write path
  // must still see them — every sync re-aggregates old rows into their 28-day block, so an
  // archive row left unread would simply vanish. Rows are read from BOTH sheets here and split
  // again at write time. Legacy layout migrates itself: on the first run after deployment the
  // archive rows are still sitting in the main sheet, get read here like any other row, and are
  // written back to the archive sheet. No manual data migration is needed.
  const archiveSheet = getOzonSalesArchiveSheet();
  const archiveLastRow = archiveSheet.getLastRow();
  const archiveData = archiveLastRow > 1
    ? archiveSheet.getRange(2, 1, archiveLastRow - 1, lastCol).getValues()
    : [];

  const keptRows = [];
  let existingNonEmptyCount = 0;

  const scanRows = data.slice(1).concat(archiveData);
  for (let i = 0; i < scanRows.length; i++) {
    const row = scanRows[i];
    if (row.join('').trim() === '') continue;
    existingNonEmptyCount++;

    const week = normWeek(row[weekIdx]);
    const cabinet = String(row[cabinetIdx] || '').trim();

    let deleteRow = false;

    if (week) {
      const weekDate = new Date(week + 'T00:00:00Z');
      if (!isNaN(weekDate.getTime()) && weekDate.getTime() < cutoffMs) {
        deleteRow = true;
      }
    }

    if (!deleteRow) {
      if (mode === 'full') {
        if (okCabinets.includes(cabinet)) {
          deleteRow = true;
        }
      } else if (mode === 'recent') {
        if (okCabinets.includes(cabinet) && replacedWeeks.includes(week)) {
          deleteRow = true;
        }
      }
    }

    if (!deleteRow) {
      keptRows.push(row);
    }
  }

  const deletedRows = existingNonEmptyCount - keptRows.length;

  const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const newRows = [];

  for (const item of payload.rows) {
    if (!item) continue;
    const itemWeek = String(item.week || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(itemWeek)) {
      continue;
    }
    const itemWeekDate = new Date(itemWeek + 'T00:00:00Z');
    if (isNaN(itemWeekDate.getTime()) || itemWeekDate.getTime() < cutoffMs) {
      continue;
    }

    const row = new Array(headers.length).fill('');
    row[weekIdx] = itemWeek;
    row[cabinetIdx] = item.cabinet || '';
    row[articleIdx] = item.offerId || '';
    row[clusterIdx] = item.cluster || '';
    row[qtyIdx] = Number(item.qty || 0);
    row[updatedIdx] = nowStr;
    row[daysIdx] = 7;

    newRows.push(row);
  }

  // 4.1. Граница уплотнения, выровненная по блокам
  const nowShifted = new Date(Date.now() + 3 * 60 * 60 * 1000); // МСК
  const day = nowShifted.getUTCDay();
  const diff = (day + 6) % 7;
  const currentMondayMs = Date.UTC(nowShifted.getUTCFullYear(), nowShifted.getUTCMonth(), nowShifted.getUTCDate()) - diff * 24 * 60 * 60 * 1000;
  const weeklyZoneStartMs = currentMondayMs - OZON_SALES_WEEKLY_ZONE_WEEKS * 7 * 24 * 60 * 60 * 1000;
  const alignedCutoffMs = OZON_SALES_PERIOD_ANCHOR_MS + Math.floor((weeklyZoneStartMs - OZON_SALES_PERIOD_ANCHOR_MS) / OZON_SALES_PERIOD_MS) * OZON_SALES_PERIOD_MS;

  // 4.2. Объединение keptRows и newRows, разделение на passRows и уплотнение старых в Map
  const passRows = [];
  const aggMap = new Map();

  const allRows = keptRows.concat(newRows);
  for (const row of allRows) {
    const week = normWeek(row[weekIdx]);
    const weekMs = (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) ? new Date(week + 'T00:00:00Z').getTime() : NaN;

    if (!week || isNaN(weekMs) || weekMs >= alignedCutoffMs) {
      if (row[daysIdx] === '' || row[daysIdx] === null || row[daysIdx] === undefined) {
        row[daysIdx] = 7;
      }
      passRows.push(row);
    } else {
      const periodStartMs = OZON_SALES_PERIOD_ANCHOR_MS + Math.floor((weekMs - OZON_SALES_PERIOD_ANCHOR_MS) / OZON_SALES_PERIOD_MS) * OZON_SALES_PERIOD_MS;
      const periodKey = Utilities.formatDate(new Date(periodStartMs), 'UTC', 'yyyy-MM-dd');
      const cabinet = String(row[cabinetIdx] || '').trim();
      const article = String(row[articleIdx] || '').trim();
      const cluster = String(row[clusterIdx] || '').trim();
      const qty = Number(row[qtyIdx] || 0);

      const aggKey = periodKey + '|' + cabinet + '|' + article + '|' + cluster;
      if (!aggMap.has(aggKey)) {
        aggMap.set(aggKey, { periodKey, cabinet, article, cluster, sum: qty });
      } else {
        aggMap.get(aggKey).sum += qty;
      }
    }
  }

  // 4.3. Сборка compactedRows из Map
  const compactedRows = [];
  aggMap.forEach(item => {
    const row = new Array(headers.length).fill('');
    row[weekIdx] = item.periodKey;
    row[cabinetIdx] = item.cabinet;
    row[articleIdx] = item.article;
    row[clusterIdx] = item.cluster;
    row[qtyIdx] = item.sum;
    row[updatedIdx] = nowStr;
    row[daysIdx] = 28;
    compactedRows.push(row);
  });

  // 4.4. Запись в два листа: недельная зона в основной, 28-дневные блоки в архивный.
  // Порядок важен только тем, что оба листа полностью перезаписываются: сначала чистим,
  // потом пишем. Основной лист после этого содержит ТОЛЬКО недельные строки — ровно то,
  // что читает getOzonSales при старте приложения.
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
  if (archiveLastRow > 1) {
    archiveSheet.getRange(2, 1, archiveLastRow - 1, lastCol).clearContent();
  }

  if (passRows.length > 0) {
    sheet.getRange(2, 1, passRows.length, headers.length).setValues(passRows);
  }
  if (compactedRows.length > 0) {
    archiveSheet.getRange(2, 1, compactedRows.length, headers.length).setValues(compactedRows);
  }

  return {
    savedRows: newRows.length,
    deletedRows: deletedRows,
    keptRows: keptRows.length,
    compactedRows: compactedRows.length,
    totalRows: passRows.length + compactedRows.length,
    weeklyRows: passRows.length,
    archiveRows: compactedRows.length
  };
}

// Пункт 29: необязательный параметр weeksLimit ограничивает выдачу
// последними N неделями. Без параметра поведение прежнее — отдаётся
// вся история, поэтому существующие вызовы не ломаются.
function getOzonSales(weeksLimit) {
  const sheet = getOzonSalesSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const weekIdx = headers.indexOf('Неделя');
  const cabinetIdx = headers.indexOf('Кабинет');
  const articleIdx = headers.indexOf('Артикул');
  const clusterIdx = headers.indexOf('Кластер');
  const qtyIdx = headers.indexOf('Количество');
  const updatedIdx = headers.indexOf('Обновлено');
  const daysIdx = headers.indexOf('Дней');

  if (weekIdx === -1 || cabinetIdx === -1 || articleIdx === -1 || clusterIdx === -1 || qtyIdx === -1 || updatedIdx === -1 || daysIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "Продажи Ozon"');
  }

  const tz = Session.getScriptTimeZone();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;

    let weekVal = '';
    if (row[weekIdx] instanceof Date) {
      try {
        weekVal = Utilities.formatDate(row[weekIdx], tz, 'yyyy-MM-dd');
      } catch (e) {
        weekVal = String(row[weekIdx] || '');
      }
    } else {
      weekVal = String(row[weekIdx] || '').trim();
    }

    let updatedVal = '';
    if (row[updatedIdx] instanceof Date) {
      try {
        updatedVal = Utilities.formatDate(row[updatedIdx], tz, 'yyyy-MM-dd HH:mm:ss');
      } catch (e) {
        updatedVal = String(row[updatedIdx] || '');
      }
    } else {
      updatedVal = String(row[updatedIdx] || '');
    }

    rows.push({
      week: weekVal,
      cabinet: String(row[cabinetIdx] || ''),
      offerId: String(row[articleIdx] || ''),
      clusterName: String(row[clusterIdx] || ''),
      qty: parseNumber(row[qtyIdx]),
      updatedAt: updatedVal,
      days: parseNumber(row[daysIdx])
    });
  }

  // Пункт 29: отдаём не всю историю, а только нужное окно недель.
  //
  // Пункт 22, этап I (19.08.2026). ДВЕ ПРАВКИ ПО ИТОГАМ ЖИВОГО РЕГРЕССА.
  // ПЕРВАЯ: окно отбирается ПО ДАТЕ, а не по числу различных значений колонки
  // «Неделя». Счётчик различных недель включал ТЕКУЩУЮ НЕЗАВЕРШЁННУЮ неделю, и из
  // 12 запрошенных недель полных до расчёта доходило 11, тогда как окно тренда
  // настроено на 13: тренд и коррекция скорости считались по укороченному ряду.
  // Отбор по дате заодно снимает вторую ловушку того же счётчика: в листе продаж
  // две зоны хранения — недельная и архивная по 28 дней, — архивные строки стоят
  // на той же сетке понедельников и тоже считались бы отдельными неделями.
  // ВТОРАЯ: если окно не задано вызывающей стороной, оно берётся ИЗ НАСТРОЕК —
  // самое длинное из окон расчёта плюс запас в две недели. Иначе увеличение
  // настройки «Окно тренда» молча упиралось бы в жёсткое число на клиенте.
  let limit = Number(weeksLimit);
  if (!(limit > 0)) {
    const s = getOzonSettings();
    const trend = Number(s.trendWeeks) > 0 ? Number(s.trendWeeks) : 13;
    const speed = Number(s.speedWeeks) > 0 ? Number(s.speedWeeks) : 4;
    limit = Math.max(trend, speed) + 2;
  }

  const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const todayParts = todayStr.split('-');
  const monday = new Date(Number(todayParts[0]), Number(todayParts[1]) - 1, Number(todayParts[2]));
  const dow = monday.getDay() === 0 ? 7 : monday.getDay();
  monday.setDate(monday.getDate() - (dow - 1) - limit * 7);
  const keepFrom = Utilities.formatDate(monday, tz, 'yyyy-MM-dd');

  const filtered = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].week && rows[i].week >= keepFrom) filtered.push(rows[i]);
  }
  return filtered;
}

function getOzonStocks() {
  const sheet = getOzonStocksSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0].map(h => String(h).trim());

  const cabinetIdx = headers.indexOf('Кабинет');
  const skuIdx = headers.indexOf('SKU');
  const articleIdx = headers.indexOf('Артикул');
  const nameIdx = headers.indexOf('Название');
  const warehouseIdx = headers.indexOf('Склад');
  const clusterIdx = headers.indexOf('Кластер');
  const availableIdx = headers.indexOf('Доступно');
  const preparingIdx = headers.indexOf('Готовим к продаже');
  const requestedIdx = headers.indexOf('В заявках');
  const transitIdx = headers.indexOf('В пути');
  const excessIdx = headers.indexOf('Излишки');
  const returnsIdx = headers.indexOf('Возвраты');
  const otherIdx = headers.indexOf('Прочее');
  const updatedIdx = headers.indexOf('Обновлено');
  const clusterIdIdx = headers.indexOf('КластерID');

  if (cabinetIdx === -1 || skuIdx === -1 || articleIdx === -1 || nameIdx === -1 || warehouseIdx === -1 || clusterIdx === -1 || availableIdx === -1 || preparingIdx === -1 || requestedIdx === -1 || transitIdx === -1 || excessIdx === -1 || returnsIdx === -1 || otherIdx === -1 || updatedIdx === -1 || clusterIdIdx === -1) {
    throw new Error('Некоторые обязательные колонки не найдены в листе "Остатки Ozon"');
  }

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;

    let updatedVal = '';
    if (row[updatedIdx] instanceof Date) {
      try {
        updatedVal = Utilities.formatDate(row[updatedIdx], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      } catch (e) {
        updatedVal = String(row[updatedIdx] || '');
      }
    } else {
      updatedVal = String(row[updatedIdx] || '');
    }

    rows.push({
      cabinet: String(row[cabinetIdx] || ''),
      sku: String(row[skuIdx] || ''),
      offerId: String(row[articleIdx] || ''),
      name: String(row[nameIdx] || ''),
      warehouseName: String(row[warehouseIdx] || ''),
      clusterName: String(row[clusterIdx] || ''),
      clusterId: String(row[clusterIdIdx] || ''),
      available: parseNumber(row[availableIdx]),
      preparing: parseNumber(row[preparingIdx]),
      requested: parseNumber(row[requestedIdx]),
      transit: parseNumber(row[transitIdx]),
      excess: parseNumber(row[excessIdx]),
      returns: parseNumber(row[returnsIdx]),
      other: parseNumber(row[otherIdx]),
      updatedAt: updatedVal
    });
  }

  return rows;
}

function saveExternalShipments(shipments) {
  if (!shipments || !Array.isArray(shipments)) {
    throw new Error('Invalid shipments data: must be an array');
  }
  const sheet = getExternalShipmentsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  
  const postingIdIdx = headers.indexOf('PostingID');
  const detectedAtIdx = headers.indexOf('Дата обнаружения');
  const shipmentDateIdx = headers.indexOf('Дата отгрузки');
  const statusIdx = headers.indexOf('Статус');
  const itemsJsonIdx = headers.indexOf('ПозицииJSON');
  const transGroupInfoIdx = headers.indexOf('TransGroupInfo');
  
  const orderIdIdx = headers.indexOf('OrderID');
  const orderNumberIdx = headers.indexOf('Номер заявки');
  const ozonStatusIdx = headers.indexOf('Статус Ozon');
  const ozonStatusDateIdx = headers.indexOf('Дата статуса Ozon');
  const dropOffWarehouseIdx = headers.indexOf('Пункт отгрузки');
  const storageWarehouseIdx = headers.indexOf('Склад хранения');
  const timeslotIdx = headers.indexOf('Таймслот');
  const cabinetIdx = headers.indexOf('Кабинет');
  const colClusterId = headers.indexOf('КластерID');
  // Пункт 31. Виртуальная заявка создана самим Ozon, наш склад в ней не участвует.
  const colIsVirtual = headers.indexOf('Виртуальная');
  const colOriginalSupply = headers.indexOf('ИсходнаяПоставка');
  
  if (postingIdIdx === -1) {
    throw new Error('PostingID column not found in Внешние отгрузки');
  }
  
  // Нормализация значения ячейки для сравнения: даты приводятся к строке, остальное — trim
  const normCell = function(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      const tz = Session.getScriptTimeZone() || 'GMT';
      // Дата без времени (00:00:00) сравнивается в формате yyyy-MM-dd,
      // иначе строка «2026-07-10» от прокси никогда не совпадёт с ячейкой-датой
      if (v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0) {
        return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      }
      return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
    }
    return String(v).trim();
  };
  
  const existingPostingIdToRowIndex = {};
  for (let i = 1; i < data.length; i++) {
    const pId = String(data[i][postingIdIdx]).trim();
    if (pId) {
      existingPostingIdToRowIndex[pId] = i;
    }
  }
  
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd HH:mm:ss");
  
  const rowsToAdd = [];
  const processedPostingIds = new Set();
  
  for (let i = 0; i < shipments.length; i++) {
    const s = shipments[i];
    if (!s) continue;
    const postingId = String(s.postingId || '').trim();
    if (!postingId) continue;
    
    if (processedPostingIds.has(postingId)) continue;
    processedPostingIds.add(postingId);
    
    const rawClusterId = (s.clusterId !== undefined && s.clusterId !== null && s.clusterId !== '') ? s.clusterId : (s.cluster_id !== undefined && s.cluster_id !== null ? s.cluster_id : '');
    const clusterIdVal = String(rawClusterId).trim();
    
    if (existingPostingIdToRowIndex[postingId] !== undefined) {
      const rowIndex = existingPostingIdToRowIndex[postingId];
      const sheetRow = rowIndex + 1;
      const currentStatus = statusIdx >= 0 ? String(data[rowIndex][statusIdx]).trim() : '';
      
      let rowChanged = false;
      
      // Записывает значение в ячейку только если оно реально отличается от текущего
      const setIfChanged = function(colIdx, newValue) {
        if (colIdx < 0) return;
        const newStr = (newValue === null || newValue === undefined) ? '' : String(newValue).trim();
        const curStr = normCell(data[rowIndex][colIdx]);
        if (curStr !== newStr) {
          sheet.getRange(sheetRow, colIdx + 1).setValue(newStr);
          rowChanged = true;
        }
      };
      
      setIfChanged(orderIdIdx, s.orderId || '');
      setIfChanged(orderNumberIdx, s.orderNumber || '');
      setIfChanged(ozonStatusIdx, s.ozonStatus || '');
      setIfChanged(ozonStatusDateIdx, s.ozonStatusDate || '');
      setIfChanged(dropOffWarehouseIdx, s.dropOffWarehouse || '');
      setIfChanged(storageWarehouseIdx, s.storageWarehouse || '');
      setIfChanged(timeslotIdx, s.timeslot || '');
      
      // Пункт 31. Признак виртуальной заявки приходит от прокси булевым значением.
      // Старый прокси его не присылает, поэтому отсутствующее значение = не виртуальная.
      setIfChanged(colIsVirtual, s.isVirtual === true ? 'ДА' : '');
      
      // Ссылка на исходную поставку хранится только для справки и в логику не заходит.
      // Обновляется только непустым значением, чтобы не затирать уже записанное.
      const newOriginalSupply = String(s.originalSupplyId || '').trim();
      if (newOriginalSupply) {
        setIfChanged(colOriginalSupply, newOriginalSupply);
      }
      
      // КластерID обновляется только непустым значением: старый прокси его не присылает,
      // а у прямых поставок macrolocal_cluster_id пустой — затирать записанный кластер нельзя
      if (clusterIdVal) {
        setIfChanged(colClusterId, clusterIdVal);
      }
      
      // Кабинет обновляется только непустым значением — старый прокси его не присылает,
      // пустым значением затирать уже записанный кабинет нельзя
      const newCabinet = String(s.cabinet || '').trim();
      if (newCabinet) {
        setIfChanged(cabinetIdx, newCabinet);
      }
      
      if (currentStatus === 'new') {
        // Дата отгрузки и состав перезаписываются ТОЛЬКО непустым значением —
        // пустой itemsJSON от прокси означает «состав не запрашивался», затирать им нельзя
        const newShipmentDate = String(s.shipmentDate || '').trim();
        if (newShipmentDate) {
          setIfChanged(shipmentDateIdx, newShipmentDate);
        }
        const newItemsJSON = String(s.itemsJSON || '').trim();
        if (newItemsJSON) {
          setIfChanged(itemsJsonIdx, newItemsJSON);
        }
      }
      
      if (rowChanged) {
        updatedCount++;
      } else {
        unchangedCount++;
      }
    } else {
      const newRow = new Array(headers.length).fill('');
      if (postingIdIdx >= 0) newRow[postingIdIdx] = postingId;
      if (detectedAtIdx >= 0) newRow[detectedAtIdx] = nowStr;
      if (shipmentDateIdx >= 0) newRow[shipmentDateIdx] = s.shipmentDate || '';
      if (statusIdx >= 0) newRow[statusIdx] = 'new';
      if (itemsJsonIdx >= 0) newRow[itemsJsonIdx] = s.itemsJSON || '';
      if (transGroupInfoIdx >= 0) newRow[transGroupInfoIdx] = s.transGroupInfo || '';
      
      if (orderIdIdx >= 0) newRow[orderIdIdx] = s.orderId || '';
      if (orderNumberIdx >= 0) newRow[orderNumberIdx] = s.orderNumber || '';
      if (ozonStatusIdx >= 0) newRow[ozonStatusIdx] = s.ozonStatus || '';
      if (ozonStatusDateIdx >= 0) newRow[ozonStatusDateIdx] = s.ozonStatusDate || '';
      if (dropOffWarehouseIdx >= 0) newRow[dropOffWarehouseIdx] = s.dropOffWarehouse || '';
      if (storageWarehouseIdx >= 0) newRow[storageWarehouseIdx] = s.storageWarehouse || '';
      if (timeslotIdx >= 0) newRow[timeslotIdx] = s.timeslot || '';
      if (cabinetIdx >= 0) newRow[cabinetIdx] = s.cabinet || '';
      if (colClusterId >= 0) newRow[colClusterId] = clusterIdVal;
      if (colIsVirtual >= 0) newRow[colIsVirtual] = (s.isVirtual === true ? 'ДА' : '');
      if (colOriginalSupply >= 0) newRow[colOriginalSupply] = String(s.originalSupplyId || '').trim();
      
      rowsToAdd.push(newRow);
      addedCount++;
    }
  }
  
  if (rowsToAdd.length > 0) {
    sheet.getRange(data.length + 1, 1, rowsToAdd.length, headers.length).setValues(rowsToAdd);
  }
  
  SpreadsheetApp.flush();
  return { addedCount: addedCount, updatedCount: updatedCount, unchangedCount: unchangedCount };
}

function getExternalShipments() {
  const sheet = getExternalShipmentsSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const headers = data[0].map(h => String(h).trim());
  const postingIdIdx = headers.indexOf('PostingID');
  const detectedAtIdx = headers.indexOf('Дата обнаружения');
  const shipmentDateIdx = headers.indexOf('Дата отгрузки');
  const statusIdx = headers.indexOf('Статус');
  const itemsJsonIdx = headers.indexOf('ПозицииJSON');
  const transGroupInfoIdx = headers.indexOf('TransGroupInfo');
  
  const orderIdIdx = headers.indexOf('OrderID');
  const orderNumberIdx = headers.indexOf('Номер заявки');
  const ozonStatusIdx = headers.indexOf('Статус Ozon');
  const ozonStatusDateIdx = headers.indexOf('Дата статуса Ozon');
  const dropOffWarehouseIdx = headers.indexOf('Пункт отгрузки');
  const storageWarehouseIdx = headers.indexOf('Склад хранения');
  const timeslotIdx = headers.indexOf('Таймслот');
  const cabinetIdx = headers.indexOf('Кабинет');
  const acceptedJsonIdx = headers.indexOf('ПринятоJSON');
  const recalcJsonIdx = headers.indexOf('ПерерасчётJSON');
  const peresortJsonIdx = headers.indexOf('ПересортJSON');
  const colClusterId = headers.indexOf('КластерID');
  const colIsVirtual = headers.indexOf('Виртуальная');
  const colOriginalSupply = headers.indexOf('ИсходнаяПоставка');
  
  if (postingIdIdx === -1) return [];
  
  const shipments = [];
  const tz = Session.getScriptTimeZone() || "GMT";
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.length <= postingIdIdx) continue;
    const postingIdVal = String(row[postingIdIdx]).trim();
    if (postingIdVal === '') continue;
    
    const getVal = (idx, isDate, dateFormat) => {
      if (idx === -1 || idx >= row.length) return '';
      const val = row[idx];
      if (isDate && val instanceof Date) {
        try {
          return Utilities.formatDate(val, tz, dateFormat);
        } catch (e) {
          return String(val);
        }
      }
      return val !== undefined && val !== null ? String(val) : '';
    };
    
    shipments.push({
      postingId: postingIdVal,
      detectedAt: getVal(detectedAtIdx, true, "yyyy-MM-dd HH:mm:ss"),
      shipmentDate: getVal(shipmentDateIdx, true, "yyyy-MM-dd"),
      status: getVal(statusIdx, false),
      itemsJSON: getVal(itemsJsonIdx, false),
      transGroupInfo: getVal(transGroupInfoIdx, false),
      orderId: getVal(orderIdIdx, false),
      orderNumber: getVal(orderNumberIdx, false),
      ozonStatus: getVal(ozonStatusIdx, false),
      ozonStatusDate: getVal(ozonStatusDateIdx, true, "yyyy-MM-dd HH:mm:ss"),
      dropOffWarehouse: getVal(dropOffWarehouseIdx, false),
      storageWarehouse: getVal(storageWarehouseIdx, false),
      timeslot: getVal(timeslotIdx, false),
      cabinet: getVal(cabinetIdx, false),
      acceptedJSON: getVal(acceptedJsonIdx, false),
      recalcJSON: getVal(recalcJsonIdx, false),
      peresortJSON: getVal(peresortJsonIdx, false),
      clusterId: getVal(colClusterId, false).trim(),
      isVirtual: getVal(colIsVirtual, false).trim().toUpperCase() === 'ДА',
      originalSupplyId: getVal(colOriginalSupply, false).trim()
    });
  }
  return shipments;
}

/**
 * Пункт 28, этап C. Помечает поставки Ozon обработанными и записывает им привязку
 * к транзакциям только что проведённого расхода. Вызывается внутри той же операции
 * commit, поэтому связь не теряется при обрыве связи с клиентом.
 * Лист читается один раз на все поставки, а не по разу на каждую.
 */
function linkPostingsToCommit(postingIds, newTransactions) {
  const ids = (postingIds || [])
    .map(function(p) { return String(p).trim(); })
    .filter(function(p) { return p !== ''; });
  if (ids.length === 0) return null;

  const txIds = [];
  (newTransactions || []).forEach(function(t) {
    if (t && !t.isComponent && t.id && txIds.indexOf(String(t.id)) === -1) {
      txIds.push(String(t.id));
    }
  });
  const linkInfo = JSON.stringify(txIds);

  const sheet = getExternalShipmentsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function(h) { return String(h).trim(); });
  const postingIdIdx = headers.indexOf('PostingID');
  const statusIdx = headers.indexOf('Статус');
  const transGroupInfoIdx = headers.indexOf('TransGroupInfo');
  if (postingIdIdx === -1 || statusIdx === -1) {
    return { linked: 0, notFound: ids, txIds: txIds };
  }

  const pending = {};
  ids.forEach(function(p) { pending[p.toLowerCase()] = p; });

  let linked = 0;
  for (let i = 1; i < data.length; i++) {
    const cur = String(data[i][postingIdIdx]).trim().toLowerCase();
    if (pending[cur]) {
      sheet.getRange(i + 1, statusIdx + 1).setValue('processed');
      if (transGroupInfoIdx >= 0) {
        sheet.getRange(i + 1, transGroupInfoIdx + 1).setValue(linkInfo);
      }
      linked++;
      delete pending[cur];
    }
  }
  SpreadsheetApp.flush();

  const notFound = Object.keys(pending).map(function(k) { return pending[k]; });
  return { linked: linked, notFound: notFound, txIds: txIds };
}

function updateExternalShipmentStatus(postingId, status, transGroupInfo) {
  if (!postingId) {
    throw new Error('PostingID is required');
  }
  if (status !== 'processed' && status !== 'ignored' && status !== 'new') {
    throw new Error('Invalid status. Allowed values: processed, ignored, new');
  }
  const sheet = getExternalShipmentsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function(h) { return String(h).trim(); });
  const postingIdIdx = headers.indexOf('PostingID');
  const statusIdx = headers.indexOf('Статус');
  const transGroupInfoIdx = headers.indexOf('TransGroupInfo');
  if (postingIdIdx === -1 || statusIdx === -1) {
    throw new Error('Required columns not found in Внешние отгрузки');
  }
  
  const targetId = String(postingId).trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    const currentId = String(data[i][postingIdIdx]).trim().toLowerCase();
    if (currentId === targetId) {
      sheet.getRange(i + 1, statusIdx + 1).setValue(status);
      // Привязка к транзакциям: пишется только если параметр передан
      if (transGroupInfo !== undefined && transGroupInfo !== null && transGroupInfoIdx >= 0) {
        sheet.getRange(i + 1, transGroupInfoIdx + 1).setValue(String(transGroupInfo));
      }
      SpreadsheetApp.flush();
      return { success: true };
    }
  }
  throw new Error('Shipment with PostingID ' + postingId + ' not found');
}

function saveExternalShipmentAcceptance(postingId, acceptedJSON) {
  if (!postingId) {
    throw new Error('PostingID is required');
  }
  
  // Валидация acceptedJSON
  if (acceptedJSON !== undefined && acceptedJSON !== null && acceptedJSON !== '') {
    if (typeof acceptedJSON !== 'string') {
      throw new Error('acceptedJSON must be a string');
    }
    let parsed;
    try {
      parsed = JSON.parse(acceptedJSON);
    } catch (e) {
      throw new Error('Invalid JSON format in acceptedJSON: ' + e.toString());
    }
    if (!Array.isArray(parsed)) {
      throw new Error('acceptedJSON must represent an array of items');
    }
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || typeof item !== 'object') {
        throw new Error('Each item in acceptedJSON must be an object');
      }
      if (typeof item.offerId !== 'string' || !item.offerId.trim()) {
        throw new Error('Each item in acceptedJSON must have a non-empty string field offerId');
      }
      if (typeof item.accepted !== 'number' || !Number.isInteger(item.accepted) || item.accepted < 0) {
        throw new Error('Each item in acceptedJSON must have an integer accepted field >= 0');
      }
    }
  }

  const sheet = getExternalShipmentsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function(h) { return String(h).trim(); });
  const postingIdIdx = headers.indexOf('PostingID');
  const acceptedJsonIdx = headers.indexOf('ПринятоJSON');
  if (postingIdIdx === -1 || acceptedJsonIdx === -1) {
    throw new Error('Required columns not found in Внешние отгрузки');
  }
  
  const targetId = String(postingId).trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    const currentId = String(data[i][postingIdIdx]).trim().toLowerCase();
    if (currentId === targetId) {
      sheet.getRange(i + 1, acceptedJsonIdx + 1).setValue(acceptedJSON || '');
      SpreadsheetApp.flush();
      return { success: true };
    }
  }
  throw new Error('Shipment with PostingID ' + postingId + ' not found');
}

function saveShipmentPeresort(postingId, peresortJSON) {
  if (!postingId) {
    throw new Error('PostingID is required');
  }
  
  // Валидация peresortJSON
  if (peresortJSON !== undefined && peresortJSON !== null && peresortJSON !== '') {
    if (typeof peresortJSON !== 'string') {
      throw new Error('peresortJSON must be a string');
    }
    let parsed;
    try {
      parsed = JSON.parse(peresortJSON);
    } catch (e) {
      throw new Error('Invalid JSON format in peresortJSON: ' + e.toString());
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('peresortJSON must represent an object');
    }
    if (!Array.isArray(parsed.pairs)) {
      throw new Error('peresortJSON must contain a "pairs" array');
    }
    for (let i = 0; i < parsed.pairs.length; i++) {
      const pair = parsed.pairs[i];
      if (!pair || typeof pair !== 'object') {
        throw new Error('Each pair in peresortJSON must be an object');
      }
      if (typeof pair.fromOfferId !== 'string' || !pair.fromOfferId.trim()) {
        throw new Error('Each pair must have a non-empty string field fromOfferId');
      }
      if (typeof pair.fromArticle !== 'string' || !pair.fromArticle.trim()) {
        throw new Error('Each pair must have a non-empty string field fromArticle');
      }
      if (typeof pair.toOfferId !== 'string' || !pair.toOfferId.trim()) {
        throw new Error('Each pair must have a non-empty string field toOfferId');
      }
      if (typeof pair.toArticle !== 'string' || !pair.toArticle.trim()) {
        throw new Error('Each pair must have a non-empty string field toArticle');
      }
      if (typeof pair.qty !== 'number' || !Number.isInteger(pair.qty) || pair.qty < 1) {
        throw new Error('Each pair must have an integer qty field >= 1');
      }
    }
    if (parsed.confirmedAt !== undefined && parsed.confirmedAt !== null && typeof parsed.confirmedAt !== 'string') {
      throw new Error('confirmedAt must be a string');
    }
    if (parsed.confirmedBy !== undefined && parsed.confirmedBy !== null && typeof parsed.confirmedBy !== 'string') {
      throw new Error('confirmedBy must be a string');
    }
  }

  const sheet = getExternalShipmentsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function(h) { return String(h).trim(); });
  const postingIdIdx = headers.indexOf('PostingID');
  const peresortJsonIdx = headers.indexOf('ПересортJSON');
  if (postingIdIdx === -1 || peresortJsonIdx === -1) {
    throw new Error('Required columns not found in Внешние отгрузки');
  }
  
  const targetId = String(postingId).trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    const currentId = String(data[i][postingIdIdx]).trim().toLowerCase();
    if (currentId === targetId) {
      sheet.getRange(i + 1, peresortJsonIdx + 1).setValue(peresortJSON || '');
      SpreadsheetApp.flush();
      return { success: true };
    }
  }
  throw new Error('Shipment with PostingID ' + postingId + ' not found');
}

/**
 * Строит новый состав поставки (itemsJSON) с учётом подтверждённого пересорта.
 * 
 * @param {string} itemsJSON - исходный состав поставки (JSON-строка массива items)
 * @param {string} peresortJSON - подтверждённый пересорт (JSON-строка объекта с pairs)
 * @returns {string} новый состав поставки в формате JSON-строки
 */
function buildPeresortAdjustedItemsJSON(itemsJSON, peresortJSON) {
  let items;
  try {
    items = JSON.parse(itemsJSON);
  } catch (e) {
    throw new Error('Ошибка парсинга исходного состава поставки (itemsJSON): ' + e.toString());
  }
  if (!Array.isArray(items)) {
    throw new Error('Исходный состав поставки (itemsJSON) должен быть массивом');
  }

  let peresort;
  try {
    if (!peresortJSON || peresortJSON.trim() === '') {
      peresort = { pairs: [] };
    } else {
      peresort = JSON.parse(peresortJSON);
    }
  } catch (e) {
    throw new Error('Ошибка парсинга пересорта (peresortJSON): ' + e.toString());
  }
  if (!peresort || typeof peresort !== 'object' || Array.isArray(peresort)) {
    throw new Error('Данные пересорта должны представлять объект');
  }
  if (!Array.isArray(peresort.pairs)) {
    throw new Error('Данные пересорта должны содержать массив pairs');
  }

  for (let i = 0; i < peresort.pairs.length; i++) {
    const pair = peresort.pairs[i];
    if (!pair || typeof pair !== 'object') {
      throw new Error('Каждая пара пересорта должна быть объектом');
    }
    const qty = pair.qty;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) {
      throw new Error('Количество в паре пересорта должно быть целым числом >= 1');
    }

    let fromItemIdx = -1;
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const currentOfferId = String(item.offerId || item.offer_id || '').trim().toLowerCase();
      if (currentOfferId === String(pair.fromOfferId).trim().toLowerCase()) {
        fromItemIdx = j;
        break;
      }
    }

    if (fromItemIdx === -1) {
      throw new Error('Пересорт: позиция "' + pair.fromOfferId + '" не найдена в составе поставки');
    }

    const fromItem = items[fromItemIdx];
    const currentQty = Number(fromItem.quantity !== undefined ? fromItem.quantity : fromItem.qty) || 0;
    if (qty > currentQty) {
      throw new Error('Пересорт: по позиции "' + pair.fromOfferId + '" нельзя перенести ' + qty + ' шт — в составе только ' + currentQty + ' шт');
    }

    const newQty = currentQty - qty;
    if (newQty === 0) {
      items.splice(fromItemIdx, 1);
    } else {
      if (fromItem.quantity !== undefined) {
        fromItem.quantity = newQty;
      }
      if (fromItem.qty !== undefined) {
        fromItem.qty = newQty;
      }
    }

    let toItemIdx = -1;
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const currentOfferId = String(item.offerId || item.offer_id || '').trim().toLowerCase();
      if (currentOfferId === String(pair.toOfferId).trim().toLowerCase()) {
        toItemIdx = j;
        break;
      }
    }

    if (toItemIdx !== -1) {
      const toItem = items[toItemIdx];
      if (toItem.quantity !== undefined) {
        toItem.quantity = (Number(toItem.quantity) || 0) + qty;
      }
      if (toItem.qty !== undefined) {
        toItem.qty = (Number(toItem.qty) || 0) + qty;
      }
      if (toItem.quantity === undefined && toItem.qty === undefined) {
        toItem.quantity = qty;
      }
    } else {
      items.push({ offerId: pair.toOfferId, quantity: qty });
    }
  }

  return JSON.stringify(items);
}

/**
 * Строит новый состав транзакций отгрузки для пере-проведения с учётом пересорта.
 * 
 * @param {Array<Object>} mainTxItems - массив объектов {article, quantity, price} (главные строки транзакций отгрузки)
 * @param {string} peresortJSON - подтверждённый пересорт (JSON-строка)
 * @param {Object} stockAvgMap - объект {артикул: текущая средняя себестоимость}
 * @returns {Array<Object>} новый состав транзакций
 */
function buildPeresortRecommitComposition(mainTxItems, peresortJSON, stockAvgMap) {
  let peresort;
  try {
    if (!peresortJSON || peresortJSON.trim() === '') {
      peresort = { pairs: [] };
    } else {
      peresort = JSON.parse(peresortJSON);
    }
  } catch (e) {
    throw new Error('Ошибка парсинга пересорта (peresortJSON): ' + e.toString());
  }
  if (!peresort || typeof peresort !== 'object' || Array.isArray(peresort)) {
    throw new Error('Данные пересорта должны представлять объект');
  }
  if (!Array.isArray(peresort.pairs)) {
    throw new Error('Данные пересорта должны содержать массив pairs');
  }

  // Глубокая копия mainTxItems
  const copy = mainTxItems.map(function(item) {
    return {
      article: item.article,
      quantity: Number(item.quantity) || 0,
      price: Number(item.price) || 0
    };
  });

  // Уменьшаем quantity последовательно
  for (let i = 0; i < peresort.pairs.length; i++) {
    const pair = peresort.pairs[i];
    const targetQty = pair.qty;
    if (typeof targetQty !== 'number' || !Number.isInteger(targetQty) || targetQty < 1) {
      throw new Error('Количество в паре пересорта должно быть целым числом >= 1');
    }
    let remainingToSubtract = targetQty;
    const targetArticle = String(pair.fromArticle).trim().toLowerCase();
    
    for (let j = 0; j < copy.length; j++) {
      const row = copy[j];
      if (String(row.article || '').trim().toLowerCase() === targetArticle) {
        if (row.quantity >= remainingToSubtract) {
          row.quantity -= remainingToSubtract;
          remainingToSubtract = 0;
          break;
        } else {
          remainingToSubtract -= row.quantity;
          row.quantity = 0;
        }
      }
    }
    if (remainingToSubtract > 0) {
      throw new Error('Пересорт: в транзакциях отгрузки не найдено ' + pair.qty + ' шт «' + pair.fromArticle + '»');
    }
  }

  // Удаляем строки с quantity === 0
  const filteredCopy = copy.filter(function(row) {
    return row.quantity > 0;
  });

  function getAvgPrice(map, article) {
    if (!map || typeof map !== 'object') return 0;
    if (map[article] !== undefined) {
      return Number(map[article]) || 0;
    }
    const normArt = String(article).trim().toLowerCase();
    for (const key in map) {
      if (String(key).trim().toLowerCase() === normArt) {
        return Number(map[key]) || 0;
      }
    }
    return 0;
  }

  // Пересчитываем price у оставшихся исходных строк
  for (let j = 0; j < filteredCopy.length; j++) {
    const row = filteredCopy[j];
    const avgPrice = getAvgPrice(stockAvgMap, row.article);
    if (avgPrice > 0) {
      row.price = avgPrice;
    }
  }

  // Суммируем qty по toArticle
  const toArticleSums = {};
  for (let i = 0; i < peresort.pairs.length; i++) {
    const pair = peresort.pairs[i];
    const displayKey = pair.toArticle;
    const normKey = displayKey.toLowerCase();
    if (!toArticleSums[normKey]) {
      toArticleSums[normKey] = { article: displayKey, quantity: 0 };
    }
    toArticleSums[normKey].quantity += pair.qty;
  }

  // Добавляем строки для toArticle в конец копии
  for (const normKey in toArticleSums) {
    const sumObj = toArticleSums[normKey];
    const art = sumObj.article;
    const qty = sumObj.quantity;
    const avgPrice = getAvgPrice(stockAvgMap, art);
    filteredCopy.push({
      article: art,
      quantity: qty,
      price: avgPrice > 0 ? avgPrice : 0
    });
  }

  return filteredCopy;
}

/**
 * Вычисляет итоговое изменение остатка склада по каждому артикулу при пере-проведении.
 * Возвращает объект delta: { артикул: количество_изменения } (возврат старого состава минус списание нового).
 * 
 * @param {Array<Object>} mainTxItems - массив объектов {article, quantity, price} (исходный состав)
 * @param {Array<Object>} newComposition - массив объектов {article, quantity, price} (новый состав)
 * @returns {Object} объект delta, где delta[артикул] = (returned[артикул] || 0) - (writtenOff[артикул] || 0)
 */
function computePeresortNetDeltas(mainTxItems, newComposition) {
  function expand(items) {
    var counts = {};
    if (!items || !Array.isArray(items)) return counts;
    
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item) continue;
      var art = String(item.article || '').trim();
      if (!art) continue;
      var qty = Number(item.quantity) || 0;
      if (qty === 0) continue;
      
      var kitData = getKitComponents(art);
      var hasComponents = kitData && kitData.components && kitData.components.length > 0;
      
      if (hasComponents) {
        if (kitData.type === 'virtual') {
          // components непустой и type === 'virtual' — добавь в результат ТОЛЬКО компоненты: componentSku += comp.quantity * item.quantity;
          for (var j = 0; j < kitData.components.length; j++) {
            var comp = kitData.components[j];
            var compSku = String(comp.componentSku || '').trim();
            if (compSku) {
              counts[compSku] = (counts[compSku] || 0) + (Number(comp.quantity) || 0) * qty;
            }
          }
        } else if (kitData.type === 'legacy') {
          // components непустой и type === 'legacy' — добавь и сам артикул (+= item.quantity), и компоненты (как выше);
          counts[art] = (counts[art] || 0) + qty;
          for (var j = 0; j < kitData.components.length; j++) {
            var comp = kitData.components[j];
            var compSku = String(comp.componentSku || '').trim();
            if (compSku) {
              counts[compSku] = (counts[compSku] || 0) + (Number(comp.quantity) || 0) * qty;
            }
          }
        } else {
          // fallback if type is unknown but components exist
          counts[art] = (counts[art] || 0) + qty;
        }
      } else {
        // components пустой — добавь только сам артикул (+= item.quantity)
        counts[art] = (counts[art] || 0) + qty;
      }
    }
    return counts;
  }

  var returned = expand(mainTxItems);
  var writtenOff = expand(newComposition);

  var delta = {};
  var allKeys = {};
  for (var k1 in returned) {
    allKeys[k1] = true;
  }
  for (var k2 in writtenOff) {
    allKeys[k2] = true;
  }

  for (var sku in allKeys) {
    delta[sku] = (returned[sku] || 0) - (writtenOff[sku] || 0);
  }

  return delta;
}

/**
 * Проводит подтверждённый пересорт: пере-проводит транзакции отгрузки с новым фактическим составом.
 * 
 * @param {string} postingId - ID поставки Ozon
 * @param {string} username - имя текущего пользователя
 * @returns {Object} результат операции { success: true, stock: ..., transactions: ... }
 */
function commitShipmentPeresort(postingId, username) {
  // Шаг 1. Если !postingId — throw new Error('PostingID is required').
  if (!postingId) {
    throw new Error('PostingID is required');
  }

  // Шаг 2. Лист «Внешние отгрузки» через getExternalShipmentsSheet().
  var sheet = getExternalShipmentsSheet();
  if (!sheet) {
    throw new Error('Лист "Внешние отгрузки" не найден');
  }
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  if (values.length <= 1) {
    throw new Error('Лист "Внешние отгрузки" пуст');
  }
  
  var headers = values[0].map(function(h) {
    return String(h).trim();
  });
  
  var postingIdIdx = headers.indexOf('PostingID');
  var statusIdx = headers.indexOf('Статус');
  var itemsJsonIdx = headers.indexOf('ПозицииJSON');
  var transGroupInfoIdx = headers.indexOf('TransGroupInfo');
  var orderIdIdx = headers.indexOf('OrderID');
  var orderNoIdx = headers.indexOf('Номер заявки');
  var peresortJsonIdx = headers.indexOf('ПересортJSON');
  
  if (postingIdIdx === -1 || statusIdx === -1 || itemsJsonIdx === -1 || 
      transGroupInfoIdx === -1 || orderIdIdx === -1 || orderNoIdx === -1 || peresortJsonIdx === -1) {
    throw new Error('Не найдены необходимые колонки в листе "Внешние отгрузки"');
  }

  // Найди строку, где String(PostingID).trim().toLowerCase() === String(postingId).trim().toLowerCase().
  var rowIndex = -1;
  var targetPostingIdLower = String(postingId).trim().toLowerCase();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][postingIdIdx]).trim().toLowerCase() === targetPostingIdLower) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) {
    throw new Error('Поставка ' + postingId + ' не найдена');
  }

  var rowValues = values[rowIndex - 1];

  // Шаг 3. Прочитай из строки ПересортJSON. Пустая — Error('Пересорт по поставке не подтверждён').
  var peresortJSONStr = String(rowValues[peresortJsonIdx] || '').trim();
  if (!peresortJSONStr) {
    throw new Error('Пересорт по поставке не подтверждён');
  }
  
  var peresortObj;
  try {
    peresortObj = JSON.parse(peresortJSONStr);
  } catch (e) {
    throw new Error('Ошибка парсинга ПересортJSON: ' + e.toString());
  }
  
  if (!peresortObj || typeof peresortObj !== 'object' || Array.isArray(peresortObj)) {
    throw new Error('Данные пересорта должны представлять объект');
  }
  
  if (peresortObj.committedAt) {
    throw new Error('Пересорт по этой поставке уже проведён');
  }
  
  if (!Array.isArray(peresortObj.pairs) || peresortObj.pairs.length === 0) {
    throw new Error('В пересорте нет ни одной пары');
  }

  // Шаг 4. Прочитай из строки: ПозицииJSON (в переменную originalItemsJSON), OrderID, Номер заявки, TransGroupInfo.
  var originalItemsJSON = String(rowValues[itemsJsonIdx] || '').trim();
  var orderId = String(rowValues[orderIdIdx] || '').trim();
  var orderNo = String(rowValues[orderNoIdx] || '').trim();
  var transGroupInfoStr = String(rowValues[transGroupInfoIdx] || '').trim();

  // Распарси TransGroupInfo как JSON-массив ID транзакций; если пусто, не массив или массив пуст — Error('Заявка не оформлена: у поставки нет привязанных транзакций').
  if (!transGroupInfoStr) {
    throw new Error('Заявка не оформлена: у поставки нет привязанных транзакций');
  }
  var transGroupIds;
  try {
    transGroupIds = JSON.parse(transGroupInfoStr);
  } catch (e) {
    throw new Error('Ошибка парсинга TransGroupInfo: ' + e.toString());
  }
  if (!Array.isArray(transGroupIds) || transGroupIds.length === 0) {
    throw new Error('Заявка не оформлена: у поставки нет привязанных транзакций');
  }

  // Шаг 5. Получи allTx = getTransactions().rows. Отбери mainTxRows: транзакции, чей String(id) входит в множество ID из TransGroupInfo, type === 'Расход' и isComponent !== true.
  var allTx = getTransactions().rows;
  var transGroupIdsStrSet = transGroupIds.map(String);
  var mainTxRows = allTx.filter(function(tx) {
    return transGroupIdsStrSet.indexOf(String(tx.id)) !== -1 && 
           tx.type === 'Расход' && 
           tx.isComponent !== true;
  });
  if (mainTxRows.length === 0) {
    throw new Error('Транзакции отгрузки не найдены в Истории');
  }

  // Из ПЕРВОЙ строки mainTxRows возьми: originalDate = date, destination, deliveryDate (пустые значения заменяй на '').
  var firstTx = mainTxRows[0];
  var originalDate = firstTx.date || '';
  var destination = firstTx.destination || '';
  var deliveryDate = firstTx.deliveryDate || '';

  // Построй mainTxItems = mainTxRows.map: {article, quantity: Number(quantity), price: Number(price)}.
  var mainTxItems = mainTxRows.map(function(tx) {
    return {
      article: tx.article,
      quantity: Number(tx.quantity) || 0,
      price: Number(tx.price) || 0
    };
  });

  // Шаг 6. Построй stockAvgMap из листа «Остатки»: ключ — String(колонка A).trim(), значение — Number(колонка C) (средняя себестоимость). Также построй stockQtyMap: ключ тот же, значение — Number(колонка B).
  var stockSheet = getSheetByNameRobust(getSpreadsheet(), 'Остатки');
  if (!stockSheet) {
    throw new Error('Лист "Остатки" не найден');
  }
  var stockData = stockSheet.getDataRange().getValues();
  var stockAvgMap = {};
  var stockQtyMap = {};
  for (var k = 1; k < stockData.length; k++) {
    var articleKey = String(stockData[k][0]).trim();
    if (articleKey) {
      stockQtyMap[articleKey] = Number(stockData[k][1]) || 0;
      stockAvgMap[articleKey] = Number(stockData[k][2]) || 0;
    }
  }

  // Шаг 7. const peresortJSONStr = строковое значение ПересортJSON из шага 3; const newComposition = buildPeresortRecommitComposition(mainTxItems, peresortJSONStr, stockAvgMap);
  var newComposition = buildPeresortRecommitComposition(mainTxItems, peresortJSONStr, stockAvgMap);

  // Шаг 8. Предварительная проверка остатков: const deltas = computePeresortNetDeltas(mainTxItems, newComposition).
  var deltas = computePeresortNetDeltas(mainTxItems, newComposition);
  var errors = [];
  for (var art in deltas) {
    var deltaVal = deltas[art];
    if (deltaVal < 0) {
      var currentQty = Number(stockQtyMap[art]) || 0;
      if (currentQty + deltaVal < 0) {
        errors.push('Не хватает «' + art + '»: нужно дополнительно ' + Math.abs(deltaVal) + ' шт, на складе ' + currentQty + ' шт');
      }
    }
  }
  // Если массив ошибок непуст — Error('Проведение пересорта невозможно:\n' + ошибки.join('\n')). До этой проверки НИЧЕГО в таблицах не изменять.
  if (errors.length > 0) {
    throw new Error('Проведение пересорта невозможно:\n' + errors.join('\n'));
  }

  // Шаг 9. Пере-проведение: для каждого id из mainTxRows вызови deleteTransaction(String(id), username, true). Затем вызови const commitResult = commitTransaction(newComposition, 'Расход', destination, deliveryDate, username, originalDate).
  for (var j = 0; j < mainTxRows.length; j++) {
    deleteTransaction(String(mainTxRows[j].id), username, true);
  }
  // Item 56, stage 2: the additional costs come from the stored column of the original
  // expense, so a batch write-off is not re-charged the cost of the whole batch.
  var commitResult = commitTransaction(newComposition, 'Расход', destination, deliveryDate, username, originalDate, '', firstTx.additionalCosts);

  // Шаг 10. Собери newTxIds: из commitResult.newTransactions возьми элементы с isComponent !== true, их String(id). const linkInfo = JSON.stringify(newTxIds).
  var newTxIds = commitResult.newTransactions
    .filter(function(tx) {
      return tx.isComponent !== true;
    })
    .map(function(tx) {
      return String(tx.id);
    });
  var linkInfo = JSON.stringify(newTxIds);

  // Шаг 11. Обнови TransGroupInfo: если OrderID текущей строки непустой — пройди по ВСЕМ строкам листа «Внешние отгрузки» и в каждой строке, где String(OrderID).trim().toLowerCase() совпадает с текущим, Статус === 'processed' и TransGroupInfo непустой, запиши linkInfo. Если OrderID пустой — запиши linkInfo только в текущую строку.
  if (orderId) {
    var targetOrderIdLower = orderId.trim().toLowerCase();
    for (var i = 1; i < values.length; i++) {
      var currentRowValues = values[i];
      var currentOrderId = String(currentRowValues[orderIdIdx] || '').trim().toLowerCase();
      var currentStatus = String(currentRowValues[statusIdx] || '').trim();
      var currentTransGroupInfo = String(currentRowValues[transGroupInfoIdx] || '').trim();
      if (currentOrderId === targetOrderIdLower && currentStatus === 'processed' && currentTransGroupInfo) {
        sheet.getRange(i + 1, transGroupInfoIdx + 1).setValue(linkInfo);
      }
    }
  } else {
    sheet.getRange(rowIndex, transGroupInfoIdx + 1).setValue(linkInfo);
  }

  // Шаг 12. Обнови ПозицииJSON текущей строки: значением buildPeresortAdjustedItemsJSON(originalItemsJSON, peresortJSONStr).
  var newItemsJSON = buildPeresortAdjustedItemsJSON(originalItemsJSON, peresortJSONStr);
  sheet.getRange(rowIndex, itemsJsonIdx + 1).setValue(newItemsJSON);

  // Шаг 13. Обнови ПересортJSON текущей строки: возьми peresortObj, добавь поля committedAt = new Date().toISOString(), committedBy = username, originalItemsJSON = originalItemsJSON; запиши JSON.stringify(peresortObj).
  peresortObj.committedAt = new Date().toISOString();
  peresortObj.committedBy = username;
  peresortObj.originalItemsJSON = originalItemsJSON;
  sheet.getRange(rowIndex, peresortJsonIdx + 1).setValue(JSON.stringify(peresortObj));

  // Шаг 14. След в Истории: для каждой пары pairs добавь через getTransactionSheet(getSpreadsheet()).appendRow(buildTransactionRow({...})) строку: id = Utilities.getUuid(), date = new Date().toISOString(), type = 'Корректировка', article = pair.fromArticle, quantity = 0, price = 0, writeOffCost = 0, total = 0, destination = 'Пересорт Ozon: заявка № ' + (orderNo || orderId || '-') + ', поставка ' + postingId + ': вместо «' + pair.fromArticle + '» ×' + pair.qty + ' уехал «' + pair.toArticle + '» ×' + pair.qty, deliveryDate = '', user = username, groupId = '', isComponent = false.
  var transSheet = getTransactionSheet(getSpreadsheet());
  var pairs = peresortObj.pairs;
  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i];
    var correctedRow = buildTransactionRow({
      id: Utilities.getUuid(),
      date: new Date().toISOString(),
      type: 'Корректировка',
      article: pair.fromArticle,
      quantity: 0,
      price: 0,
      writeOffCost: 0,
      total: 0,
      destination: 'Пересорт Ozon: заявка № ' + (orderNo || orderId || '-') + ', поставка ' + postingId + ': вместо «' + pair.fromArticle + '» ×' + pair.qty + ' уехал «' + pair.toArticle + '» ×' + pair.qty,
      deliveryDate: '',
      user: username,
      groupId: '',
      isComponent: false
    });
    transSheet.appendRow(correctedRow);
  }

  // Шаг 15. SpreadsheetApp.flush(); верни { success: true, stock: getStock(), transactions: getTransactions().rows }.
  SpreadsheetApp.flush();
  return {
    success: true,
    stock: getStock(),
    transactions: getTransactions().rows
  };
}

function saveShipmentShortageRecalc(postingId, recalcJSON, historyNotes, username) {
  if (!postingId) {
    throw new Error('PostingID is required');
  }
  
  // Валидация recalcJSON
  if (recalcJSON !== undefined && recalcJSON !== null && recalcJSON !== '') {
    if (typeof recalcJSON !== 'string') {
      throw new Error('recalcJSON must be a string');
    }
    let parsed;
    try {
      parsed = JSON.parse(recalcJSON);
    } catch (e) {
      throw new Error('Invalid JSON format in recalcJSON: ' + e.toString());
    }
    if (!Array.isArray(parsed)) {
      throw new Error('recalcJSON must represent an array of items');
    }
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || typeof item !== 'object') {
        throw new Error('Each item in recalcJSON must be an object');
      }
      if (typeof item.article !== 'string' || !item.article.trim()) {
        throw new Error('Each item in recalcJSON must have a non-empty string field article');
      }
      if (typeof item.declared !== 'number' || !Number.isInteger(item.declared) || item.declared < 0) {
        throw new Error('Each item in recalcJSON must have an integer declared field >= 0');
      }
      if (typeof item.accepted !== 'number' || !Number.isInteger(item.accepted) || item.accepted < 0) {
        throw new Error('Each item in recalcJSON must have an integer accepted field >= 0');
      }
      if (typeof item.baseUnitCost !== 'number' || isNaN(item.baseUnitCost) || item.baseUnitCost < 0) {
        throw new Error('Each item in recalcJSON must have a number field baseUnitCost >= 0');
      }
      if (typeof item.adjustedUnitCost !== 'number' || isNaN(item.adjustedUnitCost) || item.adjustedUnitCost < 0) {
        throw new Error('Each item in recalcJSON must have a number field adjustedUnitCost >= 0');
      }
      if (typeof item.redistributedCost !== 'number' || isNaN(item.redistributedCost) || item.redistributedCost < 0) {
        throw new Error('Each item in recalcJSON must have a number field redistributedCost >= 0');
      }
    }
  }

  // Валидация historyNotes
  if (historyNotes !== undefined && historyNotes !== null) {
    if (!Array.isArray(historyNotes)) {
      throw new Error('historyNotes must be an array');
    }
    for (let i = 0; i < historyNotes.length; i++) {
      const hn = historyNotes[i];
      if (!hn || typeof hn !== 'object') {
        throw new Error('Each item in historyNotes must be an object');
      }
      if (typeof hn.article !== 'string' || !hn.article.trim()) {
        throw new Error('Each item in historyNotes must have a non-empty string field article');
      }
      if (typeof hn.note !== 'string' || !hn.note.trim()) {
        throw new Error('Each item in historyNotes must have a non-empty string field note');
      }
    }
  }

  const sheet = getExternalShipmentsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function(h) { return String(h).trim(); });
  const postingIdIdx = headers.indexOf('PostingID');
  const recalcJsonIdx = headers.indexOf('ПерерасчётJSON');
  if (postingIdIdx === -1 || recalcJsonIdx === -1) {
    throw new Error('Required columns not found in Внешние отгрузки');
  }
  
  const targetId = String(postingId).trim().toLowerCase();
  let foundRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    const currentId = String(data[i][postingIdIdx]).trim().toLowerCase();
    if (currentId === targetId) {
      foundRowIndex = i + 1;
      break;
    }
  }
  
  if (foundRowIndex === -1) {
    throw new Error('Shipment with PostingID ' + postingId + ' not found');
  }
  
  sheet.getRange(foundRowIndex, recalcJsonIdx + 1).setValue(recalcJSON || '');
  
  let historyRowsAdded = 0;
  if (historyNotes && historyNotes.length > 0) {
    const transSheet = getTransactionSheet(getSpreadsheet());
    for (let i = 0; i < historyNotes.length; i++) {
      const element = historyNotes[i];
      const row = buildTransactionRow({
        id: Utilities.getUuid(),
        date: new Date().toISOString(),
        type: 'Корректировка',
        article: element.article,
        quantity: 0,
        price: 0,
        writeOffCost: 0,
        total: 0,
        destination: element.note,
        deliveryDate: '',
        user: username,
        groupId: '',
        isComponent: false
      });
      transSheet.appendRow(row);
      historyRowsAdded++;
    }
  }
  
  SpreadsheetApp.flush();
  return { success: true, historyRowsAdded: historyRowsAdded };
}

// ОСТОРОЖНО. Функция пересчитывает капитализацию как количество × среднюю себестоимость,
// то есть СТИРАЕТ «долг себестоимости» (пункт 40): у артикула с нулевым остатком средняя равна
// нулю, и накопленная стоимость брака после пересчёта пропадёт безвозвратно. Из интерфейса
// функция не вызывается, только прямым обращением к API. Запускать её можно лишь тогда, когда
// на складе заведомо нет ни одного артикула с бейджем «долг себестоимости».
function recalcCapitalizationFromAvg() {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameRobust(ss, 'Остатки');
  if (!sheet) throw new Error('Лист Остатки не найден.');
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { updated: 0, details: [] };
  
  const lastCol = sheet.getLastColumn();
  const range = sheet.getRange(1, 1, lastRow, Math.max(lastCol, 6));
  const data = range.getValues();
  
  let updatedCount = 0;
  const details = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join('').trim() === '') continue;
    
    const article = String(row[0]);
    if (!article) continue;
    
    const qty = parseNumber(row[1]);
    const avgCost = parseNumber(row[2]);
    const oldCap = parseNumber(row[3]);
    const newCap = roundToTwo(qty * avgCost);
    
    if (Math.abs(oldCap - newCap) > 0.01) {
      sheet.getRange(i + 1, 4).setValue(newCap);
      updatedCount++;
      details.push({
        article: article,
        oldCap: oldCap,
        newCap: newCap
      });
    }
  }
  
  if (updatedCount > 0) {
    SpreadsheetApp.flush();
  }
  
  return {
    updated: updatedCount,
    details: details
  };
}

function backupDatabase() {
  const ss = getSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const now = new Date();
  const tz = Session.getScriptTimeZone() || "GMT";
  const dateString = Utilities.formatDate(now, tz, "yyyy-MM-dd HH-mm");
  const copyName = ss.getName() + " — резервная копия " + dateString;
  
  const folderName = "Резервные копии БД Склад";
  let folder;
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
  }
  
  const copy = file.makeCopy(copyName, folder);
  return {
    name: copy.getName(),
    url: copy.getUrl()
  };
}

function createOrUpdateTestDatabase() {
  const props = PropertiesService.getScriptProperties();
  
  const ss = getSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const now = new Date();
  const tz = Session.getScriptTimeZone() || "GMT";
  const dateString = Utilities.formatDate(now, tz, "yyyy-MM-dd HH-mm");
  const copyName = ss.getName() + " — ТЕСТОВАЯ (" + dateString + ")";
  
  const folderName = "Тестовая БД Склад";
  let folder;
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
  }
  
  const copy = file.makeCopy(copyName, folder);
  const testSs = SpreadsheetApp.openById(copy.getId());
  
  const usersSheet = testSs.getSheetByName('Пользователи');
  if (usersSheet) {
    usersSheet.clearContents();
    usersSheet.getRange('A1:C1').setValues([['Username', 'Password', 'Role']]).setFontWeight('bold');
  }
  
  const sessionsSheet = testSs.getSheetByName('Сессии');
  if (sessionsSheet) {
    sessionsSheet.clearContents();
    sessionsSheet.getRange('A1:D1').setValues([['Token', 'Username', 'Role', 'ExpiresAt']]).setFontWeight('bold');
  }
  
  setupDatabase(testSs);
  
  props.setProperty('test_dbSpreadsheetId', copy.getId());
  props.setProperty('test_dbSpreadsheetUrl', testSs.getUrl());
  
  let trashedCount = 0;
  const filesIter = folder.getFiles();
  while (filesIter.hasNext()) {
    const f = filesIter.next();
    if (f.getId() === copy.getId()) continue;
    try {
      f.setTrashed(true);
      trashedCount++;
    } catch (err) {
      Logger.log('Не удалось убрать в корзину старую тестовую БД: ' + f.getName() + ' — ' + err);
    }
  }
  
  return {
    name: copy.getName(),
    url: testSs.getUrl(),
    trashedOld: trashedCount
  };
}

const PROXY_URL = 'https://sklad-415081166309.europe-central2.run.app';

/**
 * Единая точка записи результата прогона автоопроса Ozon.
 * Пишет последний прогон в свойство ozon_lastAutoSync (как раньше) и дополнительно
 * дозаписывает компактную запись в журнал ozon_syncHistory — последние 20 прогонов.
 * Журнал нужен, чтобы разовая осечка одного шага не исчезала при следующем удачном прогоне.
 * Ошибка записи журнала намеренно не прерывает прогон: журнал вторичен по отношению к статусу.
 */
function saveOzonSyncResult(result) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ozon_lastAutoSync', JSON.stringify(result));

  try {
    const cut = function (text) {
      const str = String(text === undefined || text === null ? '' : text).trim();
      return str.length > 150 ? str.slice(0, 150) + '…' : str;
    };

    const entry = {
      time: result.time || new Date().toISOString(),
      target: result.target || '',
      ok: result.ok === true,
      stocksOk: result.stocksOk,
      salesOk: result.salesOk,
      clustersOk: result.clustersOk,
      errors: []
    };

    if (result.ok !== true) entry.errors.push('Заявки: ' + cut(result.message));
    if (result.stocksOk === false) entry.errors.push('Остатки: ' + cut(result.stocksMessage));
    if (result.salesOk === false) entry.errors.push('Продажи: ' + cut(result.salesMessage));
    if (result.clustersOk === false) entry.errors.push('Кластеры: ' + cut(result.clustersMessage));

    let history = [];
    const raw = props.getProperty('ozon_syncHistory');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) history = parsed;
      } catch (parseErr) {
        history = [];
      }
    }

    history.push(entry);
    while (history.length > 20) {
      history.shift();
    }

    let serialized = JSON.stringify(history);
    while (serialized.length > 8000 && history.length > 1) {
      history.shift();
      serialized = JSON.stringify(history);
    }

    props.setProperty('ozon_syncHistory', serialized);
  } catch (historyErr) {
    Logger.log('Ошибка записи журнала ozon_syncHistory: ' + historyErr.toString());
  }

  scheduleOzonSyncRetryIfNeeded(result);
}

/**
 * Планирует один повторный прогон автоопроса Ozon, если хотя бы один шаг упал.
 * Разовые причины сбоя (429 от Ozon, ошибка кабинета code:2, занятый LockService)
 * лечатся простым повтором, поэтому ждать 12 часов до планового прогона незачем.
 *
 * Защита от бесконечной цепочки: свойство ozon_retryPending хранит метку времени
 * запланированного повтора. Прогон, запущенный как повтор, новый повтор не планирует.
 * Метка старше 30 минут считается протухшей (повтор не сработал) и не блокирует
 * будущие попытки — иначе один пропущенный Google триггер отключил бы механизм навсегда.
 */
function scheduleOzonSyncRetryIfNeeded(result) {
  const props = PropertiesService.getScriptProperties();

  const retryStamp = Number(props.getProperty('ozon_retryPending') || 0);
  const isFreshRetry = retryStamp > 0 && (Date.now() - retryStamp) < 30 * 60 * 1000;
  if (retryStamp > 0) {
    props.deleteProperty('ozon_retryPending');
  }
  if (isFreshRetry) {
    return;
  }

  const failed = result.ok !== true
    || result.stocksOk === false
    || result.salesOk === false
    || result.clustersOk === false;
  if (!failed) {
    return;
  }

  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'runOzonSyncRetry') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    ScriptApp.newTrigger('runOzonSyncRetry').timeBased().after(2 * 60 * 1000).create();
    props.setProperty('ozon_retryPending', String(Date.now()));
    Logger.log('Автоопрос Ozon: запланирован повторный прогон через 2 минуты.');
  } catch (retryErr) {
    props.deleteProperty('ozon_retryPending');
    Logger.log('Автоопрос Ozon: не удалось запланировать повторный прогон: ' + retryErr.toString());
  }
}

/**
 * Обработчик одноразового триггера повторного прогона.
 * Самоочистка триггеров обязательна: иначе они накапливаются и упираются в лимит проекта.
 */
function runOzonSyncRetry() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runOzonSyncRetry') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  scheduledOzonCheck();
}

function scheduledOzonCheck() {
  // ВАЖНО: Работает только через SpreadsheetApp.getActiveSpreadsheet() для листа «Сессии» (НЕ через getSpreadsheet()!).
  // Причина: сессии всегда живут в боевой таблице, прокси проверяет токен именно там.
  const activeSs = SpreadsheetApp.getActiveSpreadsheet();
  const sessionsSheet = activeSs.getSheetByName('Сессии');
  if (!sessionsSheet) {
    throw new Error('Лист «Сессии» не найден в активной таблице.');
  }

  const token = Utilities.getUuid();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  
  // Шаг 1: Удалить старые строки 'Автоопрос Ozon'
  const data = sessionsSheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]).trim() === 'Автоопрос Ozon') {
      sessionsSheet.deleteRow(i + 1);
    }
  }

  // Шаг 2: Создать временную сессию
  sessionsSheet.appendRow([token, 'Автоопрос Ozon', 'admin', expiresAt]);
  SpreadsheetApp.flush();

  // Шаг 3: Прочитать Script Property 'ozon_autoSyncTarget'
  const props = PropertiesService.getScriptProperties();
  const targetProperty = props.getProperty('ozon_autoSyncTarget');
  const target = targetProperty === 'prod' ? 'prod' : 'test';
  const devMode = target !== 'prod';

  const result = {
    time: new Date().toISOString(),
    ok: false,
    target: target,
    found: 0,
    added: 0,
    updated: 0,
    message: ''
  };

  try {
    // Шаг 4: Вызвать UrlFetchApp.fetch
    const payload = JSON.stringify({
      sessionToken: token,
      devMode: devMode
    });

    let response;
    try {
      response = UrlFetchApp.fetch(PROXY_URL + '/api/ozon/check', {
        method: 'post',
        contentType: 'application/json',
        payload: payload,
        muteHttpExceptions: true
      });
    } catch (fetchErr) {
      result.ok = false;
      result.message = 'Ошибка вызова прокси: ' + fetchErr.toString() + '. Если это таймаут — данные, скорее всего, записаны, проверьте лист.';
      saveOzonSyncResult(result);
      return result;
    }

    const code = response.getResponseCode();
    const content = response.getContentText();

    if (code >= 200 && code < 300) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.status === 'success') {
          result.ok = true;
          result.found = (parsed.data && parsed.data.found) || 0;
          result.added = (parsed.data && parsed.data.added) || 0;
          result.updated = (parsed.data && parsed.data.updated) || 0;
          result.message = (parsed.data && parsed.data.message) || 'Синхронизация успешно завершена';
        } else {
          result.ok = false;
          result.message = parsed.message || 'Ошибка API: статус неуспешен';
        }
      } catch (jsonErr) {
        result.ok = false;
        result.message = 'Не удалось разобрать JSON ответа. Ошибка: ' + jsonErr.toString() + ' (Ответ: ' + content.slice(0, 200) + ')';
      }
    } else {
      result.ok = false;
      result.message = 'HTTP ' + code + ': ' + content.slice(0, 200);
    }

    // Остатки складов Ozon опрашиваются ВСЕГДА, независимо от результата опроса заявок:
    // сбой /api/ozon/check не должен отменять обновление зеркала остатков.
    {
      try {
        const stocksResponse = UrlFetchApp.fetch(PROXY_URL + '/api/ozon/stocks', {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            sessionToken: token,
            devMode: devMode
          }),
          muteHttpExceptions: true
        });
        const stocksCode = stocksResponse.getResponseCode();
        const stocksContent = stocksResponse.getContentText();
        if (stocksCode >= 200 && stocksCode < 300) {
          const stocksParsed = JSON.parse(stocksContent);
          if (stocksParsed.status === 'success') {
            result.stocksOk = true;
            result.stocksRows = (stocksParsed.data && stocksParsed.data.savedRows) || 0;
            result.stocksMessage = 'Остатки Ozon успешно синхронизированы';
          } else {
            result.stocksOk = false;
            result.stocksMessage = stocksParsed.message || 'Ошибка прокси при опросе остатков Ozon';
          }
        } else {
          result.stocksOk = false;
          result.stocksMessage = 'HTTP ' + stocksCode + ': ' + stocksContent.slice(0, 200);
        }
      } catch (stocksErr) {
        result.stocksOk = false;
        result.stocksMessage = 'Ошибка вызова /api/ozon/stocks: ' + stocksErr.toString();
      }
    }

    // Синхронизация FBO-продаж Ozon
    {
      let salesMode = 'recent';
      try {
        let targetSs = null;
        if (devMode) {
          const testDbId = props.getProperty('test_dbSpreadsheetId');
          if (testDbId) targetSs = SpreadsheetApp.openById(testDbId);
        } else {
          targetSs = activeSs;
        }
        if (targetSs) {
          const salesSheet = targetSs.getSheetByName('Продажи Ozon');
          if (!salesSheet || salesSheet.getLastRow() <= 1) {
            salesMode = 'full'; // лист пуст или отсутствует — первичная загрузка всей истории
          }
        }
      } catch (modeErr) {
        salesMode = 'recent';
      }

      try {
        const salesResponse = UrlFetchApp.fetch(PROXY_URL + '/api/ozon/sales', {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            sessionToken: token,
            devMode: devMode,
            mode: salesMode
          }),
          muteHttpExceptions: true
        });
        const salesCode = salesResponse.getResponseCode();
        const salesContent = salesResponse.getContentText();
        if (salesCode >= 200 && salesCode < 300) {
          const salesParsed = JSON.parse(salesContent);
          if (salesParsed.status === 'success') {
            result.salesOk = true;
            result.salesMode = salesMode;
            result.salesRows = (salesParsed.data && salesParsed.data.savedRows) || 0;
            result.salesDeleted = (salesParsed.data && salesParsed.data.deletedRows) || 0;
            result.salesTotal = (salesParsed.data && salesParsed.data.totalRows) || 0;
            result.salesCompacted = (salesParsed.data && salesParsed.data.compactedRows) || 0;
            result.salesMessage = 'Продажи Ozon успешно синхронизированы';
          } else {
            result.salesOk = false;
            result.salesMessage = salesParsed.message || 'Ошибка прокси при опросе продаж Ozon';
          }
        } else {
          result.salesOk = false;
          result.salesMessage = 'HTTP ' + salesCode + ': ' + salesContent.slice(0, 200);
        }
      } catch (salesErr) {
        result.salesOk = false;
        result.salesMessage = 'Ошибка вызова /api/ozon/sales: ' + salesErr.toString() + '. Если это таймаут при первичной загрузке — данные, скорее всего, записаны, проверьте лист.';
      }
    }

    // Синхронизация справочника кластеров Ozon
    {
      try {
        const clustersResponse = UrlFetchApp.fetch(PROXY_URL + '/api/ozon/clusters', {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            sessionToken: token,
            devMode: devMode
          }),
          muteHttpExceptions: true
        });
        const clustersCode = clustersResponse.getResponseCode();
        const clustersContent = clustersResponse.getContentText();
        if (clustersCode >= 200 && clustersCode < 300) {
          const clustersParsed = JSON.parse(clustersContent);
          if (clustersParsed.status === 'success') {
            result.clustersOk = true;
            result.clustersTotal = (clustersParsed.data && clustersParsed.data.totalClusters) || 0;
            result.clustersNew = (clustersParsed.data && clustersParsed.data.newClusters) || 0;
            result.clustersMessage = 'Справочник кластеров Ozon синхронизирован';
          } else {
            result.clustersOk = false;
            result.clustersMessage = clustersParsed.message || 'Ошибка прокси при опросе справочника кластеров Ozon';
          }
        } else {
          result.clustersOk = false;
          result.clustersMessage = 'HTTP ' + clustersCode + ': ' + clustersContent.slice(0, 200);
        }
      } catch (clustersErr) {
        result.clustersOk = false;
        result.clustersMessage = 'Ошибка вызова /api/ozon/clusters: ' + clustersErr.toString();
      }
    }

  } catch (globalErr) {
    result.ok = false;
    result.message = globalErr.toString();
  } finally {
    // Шаг 6: Удалить временную сессию из листа «Сессии»
    try {
      const finalData = sessionsSheet.getDataRange().getValues();
      for (let i = finalData.length - 1; i >= 1; i--) {
        if (String(finalData[i][0]).trim() === token) {
          sessionsSheet.deleteRow(i + 1);
          break;
        }
      }
      SpreadsheetApp.flush();
    } catch (cleanupErr) {
      Logger.log('Ошибка при удалении временной сессии: ' + cleanupErr.toString());
    }
  }

  saveOzonSyncResult(result);
  return result;
}

function runOzonSyncOnce() {
  // Самоочистка: удалить все одноразовые триггеры этого обработчика, чтобы они не накапливались
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runOzonSyncOnce') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  scheduledOzonCheck();
}

function setupOzonSyncTriggers() {
  removeOzonSyncTriggers();
  ScriptApp.newTrigger('scheduledOzonCheck')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .inTimezone('Europe/Moscow')
    .create();
  ScriptApp.newTrigger('scheduledOzonCheck')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .inTimezone('Europe/Moscow')
    .create();
}

function removeOzonSyncTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scheduledOzonCheck') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function getOzonSyncStatusInfo() {
  const triggers = ScriptApp.getProjectTriggers();
  let triggersCount = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scheduledOzonCheck') {
      triggersCount++;
    }
  }
  const enabled = triggersCount > 0;

  const props = PropertiesService.getScriptProperties();
  const targetProperty = props.getProperty('ozon_autoSyncTarget');
  const target = targetProperty === 'prod' ? 'prod' : 'test';

  const lastRunStr = props.getProperty('ozon_lastAutoSync');
  let lastRun = null;
  if (lastRunStr) {
    try {
      lastRun = JSON.parse(lastRunStr);
    } catch (e) {
      Logger.log('Error parsing ozon_lastAutoSync property: ' + e.toString());
    }
  }

  let history = [];
  const historyStr = props.getProperty('ozon_syncHistory');
  if (historyStr) {
    try {
      const parsedHistory = JSON.parse(historyStr);
      if (Array.isArray(parsedHistory)) history = parsedHistory;
    } catch (e) {
      Logger.log('Error parsing ozon_syncHistory property: ' + e.toString());
    }
  }

  return {
    enabled: enabled,
    triggersCount: triggersCount,
    target: target,
    lastRun: lastRun,
    history: history
  };
}

// ===== Заказы на фабрике (пункт 22, этап F) =====
// Лист хранит факт размещения заказа у производителя. На остатки и себестоимость
// не влияет: заказанный товар физически не лежит ни на Ozon, ни на своём складе.

function getFactoryOrdersSheet() {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Заказы на фабрике', FACTORY_ORDERS_HEADERS);
  ensureColumns(sheet, FACTORY_ORDERS_HEADERS);
  return sheet;
}

function readFactoryOrdersSheet() {
  const sheet = getFactoryOrdersSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), FACTORY_ORDERS_HEADERS.length);
  const values = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const idx = {};
  FACTORY_ORDERS_HEADERS.forEach(function (h) {
    idx[h] = headers.indexOf(h);
    if (idx[h] === -1) {
      throw new Error('Колонка "' + h + '" не найдена в листе "Заказы на фабрике"');
    }
  });
  return { sheet: sheet, values: values, idx: idx };
}

function normalizeFactoryDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd');
  }
  const str = String(value).trim();
  if (!str) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД, получено "' + str + '"');
  }
  return str;
}

function getFactoryOrders() {
  const ctx = readFactoryOrdersSheet();
  const result = [];
  for (let i = 1; i < ctx.values.length; i++) {
    const row = ctx.values[i];
    if (row.join('').trim() === '') continue;
    const id = String(row[ctx.idx['ID']] || '').trim();
    if (!id) continue;
    result.push({
      id: id,
      article: String(row[ctx.idx['Артикул']] || '').trim(),
      orderedAt: normalizeFactoryDate(row[ctx.idx['Дата заказа']]),
      qty: Number(row[ctx.idx['Количество']]) || 0,
      expectedAt: normalizeFactoryDate(row[ctx.idx['Ожидаемое прибытие']]),
      comment: String(row[ctx.idx['Комментарий']] || '').trim(),
      user: String(row[ctx.idx['Кто']] || '').trim(),
      status: String(row[ctx.idx['Статус']] || '').trim() || 'active',
      receivedAt: normalizeFactoryDate(row[ctx.idx['Дата получения']])
    });
  }
  return result;
}

function saveFactoryOrder(data, username) {
  if (!data || typeof data !== 'object') throw new Error('Некорректные данные заказа на фабрике');
  const article = String(data.article || '').trim();
  if (!article) throw new Error('Не указан артикул заказа на фабрике');
  const qty = Number(data.qty);
  if (!isFinite(qty) || qty <= 0) throw new Error('Количество заказа должно быть больше нуля');
  const expectedAt = normalizeFactoryDate(data.expectedAt);
  const orderedAt = normalizeFactoryDate(data.orderedAt) || getTodayDateString();
  const comment = String(data.comment || '').trim();
  const requestedId = String(data.id || '').trim();

  const ctx = readFactoryOrdersSheet();
  let targetRow = -1;
  for (let i = 1; i < ctx.values.length; i++) {
    const row = ctx.values[i];
    if (row.join('').trim() === '') continue;
    const rowId = String(row[ctx.idx['ID']] || '').trim();
    if (!rowId) continue;
    if (requestedId) {
      if (rowId === requestedId) { targetRow = i + 1; break; }
    } else {
      const rowArticle = String(row[ctx.idx['Артикул']] || '').trim();
      const rowStatus = String(row[ctx.idx['Статус']] || '').trim() || 'active';
      if (rowArticle === article && rowStatus === 'active') { targetRow = i + 1; break; }
    }
  }

  if (requestedId && targetRow === -1) throw new Error('Заказ на фабрике не найден: ' + requestedId);

  if (targetRow === -1) {
    const width = Math.max(ctx.values[0].length, FACTORY_ORDERS_HEADERS.length);
    const newRow = [];
    for (let c = 0; c < width; c++) newRow.push('');
    newRow[ctx.idx['ID']] = Utilities.getUuid();
    newRow[ctx.idx['Артикул']] = article;
    newRow[ctx.idx['Дата заказа']] = orderedAt;
    newRow[ctx.idx['Количество']] = qty;
    newRow[ctx.idx['Ожидаемое прибытие']] = expectedAt;
    newRow[ctx.idx['Комментарий']] = comment;
    newRow[ctx.idx['Кто']] = username || '';
    newRow[ctx.idx['Статус']] = 'active';
    newRow[ctx.idx['Дата получения']] = '';
    ctx.sheet.appendRow(newRow);
  } else {
    ctx.sheet.getRange(targetRow, ctx.idx['Артикул'] + 1).setValue(article);
    ctx.sheet.getRange(targetRow, ctx.idx['Дата заказа'] + 1).setValue(orderedAt);
    ctx.sheet.getRange(targetRow, ctx.idx['Количество'] + 1).setValue(qty);
    ctx.sheet.getRange(targetRow, ctx.idx['Ожидаемое прибытие'] + 1).setValue(expectedAt);
    ctx.sheet.getRange(targetRow, ctx.idx['Комментарий'] + 1).setValue(comment);
    ctx.sheet.getRange(targetRow, ctx.idx['Кто'] + 1).setValue(username || '');
    ctx.sheet.getRange(targetRow, ctx.idx['Статус'] + 1).setValue('active');
    ctx.sheet.getRange(targetRow, ctx.idx['Дата получения'] + 1).setValue('');
  }

  SpreadsheetApp.flush();
  return getFactoryOrders();
}

/**
 * Пункт 35. Отмена заказа на фабрике: строка удаляется из листа безвозвратно.
 * Применяется к просроченным заказам, которые фабрика не выполнила.
 * Полученные заказы (статус received) отменять нельзя: партия уже пришла,
 * её удаление исказит историю. Такую запись надо править вручную в таблице.
 * Складских остатков и листа «История» отмена НЕ касается: заказ на фабрике —
 * это намерение, а не движение товара.
 */
function cancelFactoryOrder(data, username) {
  const id = data ? String(data.id || '').trim() : '';
  if (!id) throw new Error('Не указан идентификатор заказа на фабрике');
  const ctx = readFactoryOrdersSheet();
  let targetRow = -1;
  let status = '';
  for (let i = 1; i < ctx.values.length; i++) {
    const rowId = String(ctx.values[i][ctx.idx['ID']] || '').trim();
    if (rowId === id) {
      targetRow = i + 1;
      status = String(ctx.values[i][ctx.idx['Статус']] || '').trim();
      break;
    }
  }
  if (targetRow === -1) throw new Error('Заказ на фабрике не найден: ' + id);
  if (status === 'received') throw new Error('Полученный заказ отменить нельзя: партия уже пришла на склад');
  ctx.sheet.deleteRow(targetRow);
  SpreadsheetApp.flush();
  return getFactoryOrders();
}

/**
 * Пункт 35. Цена последнего поступления по каждому артикулу.
 * Поступлением считается операция типа «Приход», кроме оприходования излишков,
 * корректировки остатка и услуг: это не закупка, и их цена не отражает стоимость партии.
 * Миграция комплектов поступлением СЧИТАЕТСЯ: она несёт реальную себестоимость компонента.
 * Возвращает объект вида { "Артикул": { price: 128.2, date: "2026-07-04" } }.
 */
function getLastPurchasePrices() {
  const ss = getSpreadsheet();
  const sheet = getTransactionSheet(ss);
  if (!sheet) return {};
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const iType = headers.indexOf('Тип');
  const iArticle = headers.indexOf('Артикул');
  const iPrice = headers.indexOf('Цена');
  const iDate = headers.indexOf('Дата');
  const iObject = headers.indexOf('Объект');
  if (iType === -1 || iArticle === -1 || iPrice === -1 || iDate === -1) return {};
  const SKIP = ['Излишки', 'Корректировка', 'Услуги'];
  const result = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[iType] || '').trim() !== 'Приход') continue;
    const article = String(row[iArticle] || '').trim();
    if (!article) continue;
    const price = Number(row[iPrice]) || 0;
    if (!(price > 0)) continue;
    if (iObject !== -1) {
      const obj = String(row[iObject] || '');
      let skip = false;
      for (let k = 0; k < SKIP.length; k++) { if (obj.indexOf(SKIP[k]) !== -1) { skip = true; break; } }
      if (skip) continue;
    }
    let ms = 0;
    if (row[iDate] instanceof Date) {
      ms = row[iDate].getTime();
    } else {
      const parsed = new Date(String(row[iDate]));
      ms = isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }
    const prev = result[article];
    if (!prev || ms >= prev.ms) {
      result[article] = { ms: ms, price: price, date: ms ? Utilities.formatDate(new Date(ms), 'Europe/Moscow', 'yyyy-MM-dd') : '' };
    }
  }
  const out = {};
  for (const key in result) {
    if (!result.hasOwnProperty(key)) continue;
    out[key] = { price: result[key].price, date: result[key].date };
  }
  return out;
}

function setFactoryOrderReceived(data, username) {
  const id = data ? String(data.id || '').trim() : '';
  if (!id) throw new Error('Не указан идентификатор заказа на фабрике');
  const ctx = readFactoryOrdersSheet();
  let targetRow = -1;
  for (let i = 1; i < ctx.values.length; i++) {
    const rowId = String(ctx.values[i][ctx.idx['ID']] || '').trim();
    if (rowId === id) { targetRow = i + 1; break; }
  }
  if (targetRow === -1) throw new Error('Заказ на фабрике не найден: ' + id);
  ctx.sheet.getRange(targetRow, ctx.idx['Статус'] + 1).setValue('received');
  ctx.sheet.getRange(targetRow, ctx.idx['Дата получения'] + 1).setValue(getTodayDateString());
  SpreadsheetApp.flush();
  return getFactoryOrders();
}


