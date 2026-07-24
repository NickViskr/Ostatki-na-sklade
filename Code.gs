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
      // КРИТИЧНО: этот action обязан выполняться БЕЗ захвата LockService. Внутри scheduledOzonCheck прокси делает
      // обратные запросы к этому же doPost (saveExternalShipments), и если внешний запрос держит замок — внутренние
      // упрутся в waitLock и всё упадёт по таймауту.
      const syncResult = scheduledOzonCheck();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: syncResult })).setMimeType(ContentService.MimeType.JSON);
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
    
    // For other actions, acquire the script lock
    lock = LockService.getScriptLock();
    lock.waitLock(10000);
    
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
        result = commitTransaction(data, payload.type, payload.destination, payload.deliveryDate, currentUser.username);
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
      case 'getOzonSyncStatus': assertAdmin(currentUser); result = getOzonSyncStatusInfo(); break;
      case 'setupOzonSyncTriggers': assertAdmin(currentUser); setupOzonSyncTriggers(); result = getOzonSyncStatusInfo(); break;
      case 'removeOzonSyncTriggers': assertAdmin(currentUser); removeOzonSyncTriggers(); result = getOzonSyncStatusInfo(); break;
      case 'saveOzonStocks': result = saveOzonStocks(data); break;
      case 'getOzonStocks': result = getOzonStocks(); break;
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
  'OrderID', 'Номер заявки', 'Статус Ozon', 'Дата статуса Ozon', 'Пункт отгрузки', 'Склад хранения', 'Таймслот', 'Кабинет', 'ПринятоJSON', 'ПерерасчётJSON', 'ПересортJSON'
];

const OZON_STOCKS_HEADERS = [
  'Кабинет', 'SKU', 'Артикул', 'Название', 'Склад', 'Кластер',
  'Доступно', 'Готовим к продаже', 'В заявках', 'В пути', 'Излишки', 'Возвраты', 'Прочее', 'Обновлено'
];

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

function ensureColumns(sheet, requiredHeaders) {
  const lastCol = sheet.getLastColumn();
  let existingHeaders = [];
  if (lastCol > 0) {
    existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(h => String(h).trim());
  }
  requiredHeaders.forEach(function(header) {
    if (!existingHeaders.includes(header)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(header);
      existingHeaders.push(header);
    }
  });
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

function parseAdditionalCostsFromDestination(destination) {
  if (!destination) return 0;
  var total = 0;
  var pack = destination.match(/Упаковка:[^|\]]*=\s*([\d.,]+)\s*₽/);
  if (pack) total += parseNumber(pack[1]);
  var other = destination.match(/Прочее:\s*([\d.,]+)\s*₽/);
  if (other) total += parseNumber(other[1]);
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
    'isComponent': obj.isComponent || false
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
    ensureColumns(finalSheet, ['groupId', 'isComponent']);
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
  
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)']);
  
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
      volumeLiters: volIdx !== -1 && volIdx < row.length ? Number(row[volIdx]) || 0 : 0
    };
  });
}

function addSku(skuData) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден. Выполните инициализацию.');
  
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)']);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const skuIdx = headers.indexOf('SKU') !== -1 ? headers.indexOf('SKU') : 0;
  const ozonIdx = headers.indexOf('ШК Ozon') !== -1 ? headers.indexOf('ШК Ozon') : 3;
  const wbIdx = headers.indexOf('Баркод WB') !== -1 ? headers.indexOf('Баркод WB') : 4;
  const pcsIdx = headers.indexOf('ШТ/КОР') !== -1 ? headers.indexOf('ШТ/КОР') : 1;
  const minStockIdx = headers.indexOf('Мин. остаток') !== -1 ? headers.indexOf('Мин. остаток') : 2;
  const bppIdx = headers.indexOf('КОР/ПАЛ') !== -1 ? headers.indexOf('КОР/ПАЛ') : 5;
  const volIdx = headers.indexOf('Литраж (л)') !== -1 ? headers.indexOf('Литраж (л)') : 6;

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
  
  sheet.appendRow(newRow);
  
  return getSkus();
}

function updateSku(skuData, oldSku) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден.');
  
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)']);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  
  const skuIdx = headers.indexOf('SKU') !== -1 ? headers.indexOf('SKU') : 0;
  const pcsIdx = headers.indexOf('ШТ/КОР') !== -1 ? headers.indexOf('ШТ/КОР') : 1;
  const minStockIdx = headers.indexOf('Мин. остаток') !== -1 ? headers.indexOf('Мин. остаток') : 2;
  const ozonIdx = headers.indexOf('ШК Ozon') !== -1 ? headers.indexOf('ШК Ozon') : 3;
  const wbIdx = headers.indexOf('Баркод WB') !== -1 ? headers.indexOf('Баркод WB') : 4;
  const bppIdx = headers.indexOf('КОР/ПАЛ') !== -1 ? headers.indexOf('КОР/ПАЛ') : 5;
  const volIdx = headers.indexOf('Литраж (л)') !== -1 ? headers.indexOf('Литраж (л)') : 6;
  
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
  
  ensureColumns(sheet, ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)']);
  
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
          if (isWriteOffDestination(dest)) {
            // Капитализация НЕ увеличивается при удалении списания
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
              const compone  const newTransactions = [];
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
          if (isWriteOffDestination(destination)) {
            newCompCap = newCompQty === 0 ? 0 : compStock.capitalization;
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
          if (isWriteOffDestination(destination)) {
            newCap = newQty === 0 ? 0 : curr.capitalization;
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
    
    const shipmentAdditional = (type === 'Расход') ? parseAdditionalCostsFromDestination(destination) : 0;
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
      isComponent: false
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
    const startRow = transSheet.getLastRow() + 1;
    transSheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    SpreadsheetApp.flush();
  }

  return {�омплект ' + article,
            user:        username,
            groupId:     kitGroupId,
            isComponent: true
          });
          
          transSheet.appendRow(compRow);
          
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
          if (isWriteOffDestination(destination)) {
            newCap = newQty === 0 ? 0 : curr.capitalization;
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
    
    const shipmentAdditional = (type === 'Расход') ? parseAdditionalCostsFromDestination(destination) : 0;
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
      isComponent: false
    });
    
    transSheet.appendRow(mainRow);
    
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
        sheet.deleteRow(i + 1);
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
  
  // Очистка старых сессий текущего пользователя или истёкших сессий
  const now = new Date().getTime();
  const sessionData = sessionSheet.getDataRange().getValues();
  for (let i = sessionData.length - 1; i >= 1; i--) {
     // Удалить если сессия истекла или принадлежит тому же пользователю (чтобы не копить дубли сессий на одного)
     if (Number(sessionData[i][3]) < now || String(sessionData[i][1]) === user.username) {
        sessionSheet.deleteRow(i + 1);
     }
  }

  const token = Utilities.getUuid();
  const expiresAt = now + (24 * 60 * 60 * 1000); // 24 hours
  
  sessionSheet.appendRow([token, user.username, user.role, expiresAt]);
  
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
          if (isWriteOffDestination(payload.destination)) {
            if (newQty === 0) {
              newCap = 0;
            }
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
            if (!isWriteOffDestination(dest)) {
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
            if (isWriteOffDestination(dest) === true) {
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
        change.currentCap = 0;
      } else if (change.currentCap < 0) {
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

function recalculateStockFully(ss) {
  const transSheet = getTransactionSheet(ss);
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');
  
  if (!transSheet || !stockSheet) return;

  const transData = transSheet.getDataRange().getValues();
  const stockData = stockSheet.getDataRange().getValues();
  
  const stockMap = {};
  for (let i = 1; i < stockData.length; i++) {
    const sku = String(stockData[i][0]);
    if(sku) stockMap[sku] = { qty: 0, cap: 0, rowIndex: i };
  }

  for (let i = 1; i < transData.length; i++) {
    const type = transData[i][2];
    const sku = String(transData[i][3]);
    const qty = Number(transData[i][4]) || 0;
    const writeOff = Number(transData[i][6]) || 0;
    const total = Number(transData[i][7]) || 0;
    
    if (stockMap[sku]) {
      if (type === 'Приход') {
        stockMap[sku].qty += qty;
        stockMap[sku].cap = roundToTwo(stockMap[sku].cap + total);
      } else if (type === 'Расход') {
        stockMap[sku].qty -= qty;
        stockMap[sku].cap = roundToTwo(stockMap[sku].cap - writeOff);
      }
    }
  }

  for(let sku in stockMap) {
    const item = stockMap[sku];
    stockData[item.rowIndex][1] = item.qty;
    stockData[item.rowIndex][2] = item.qty > 0 ? roundToTwo(item.cap / item.qty) : 0;
    stockData[item.rowIndex][3] = roundToTwo(item.cap);
    // We don't touch [4] (sales) and [5] (turnover)
  }
  
  stockSheet.getRange(1, 1, stockData.length, Math.max(stockData[0].length, 6)).setValues(stockData);
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

function migrateKitCosts() {
  var ss = getSpreadsheet();
  var sheet = getTransactionSheet(ss);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idx = function(name) { return headers.indexOf(name); };

  var cDate = 1, cType = 2, cQty = 4, cPrice = 5;
  var cWriteOff = idx('Себестоимость списания'); if (cWriteOff === -1) cWriteOff = idx('Сумма списания');
  var cTotal = idx('Сумма'); if (cTotal === -1) cTotal = idx('Итого');
  var cDest = idx('Объект');
  var cGroup = idx('groupId');
  var cComp = idx('isComponent');

  var isCompOf = function(row){ return row[cComp] === true || String(row[cComp]).toLowerCase() === 'true'; };
  var shipKey = function(row){ return String(row[cDate]) + '||' + String(row[cDest] || ''); };

  // 1) сумма total компонентов по groupId
  var compSum = {};
  for (var i = 1; i < data.length; i++) {
    var g = String(data[i][cGroup] || '');
    if (g && isCompOf(data[i])) compSum[g] = (compSum[g] || 0) + (Number(data[i][cTotal]) || 0);
  }

  // 2) суммарное количество главных строк по отгрузке (Дата+Объект)
  var shipQty = {};
  for (var k = 1; k < data.length; k++) {
    if (isCompOf(data[k])) continue;
    if (String(data[k][cType]) !== 'Расход') continue;
    var key = shipKey(data[k]);
    shipQty[key] = (shipQty[key] || 0) + (Number(data[k][cQty]) || 0);
  }

  // 3) пересчёт главных транзакций комплектов
  var updated = 0;
  for (var j = 1; j < data.length; j++) {
    var gid = String(data[j][cGroup] || '');
    if (!gid || isCompOf(data[j])) continue;
    if (String(data[j][cType]) !== 'Расход') continue;
    if (!(gid in compSum)) continue;

    var writeOff = Number(data[j][cWriteOff]) || 0;
    var qty = Number(data[j][cQty]) || 0;
    var totalShip = shipQty[shipKey(data[j])] || qty;
    var shipAdd = parseAdditionalCostsFromDestination(String(data[j][cDest] || ''));
    var add = (shipAdd > 0 && totalShip > 0) ? roundToTwo(shipAdd * qty / totalShip) : 0;

    var newTotal = roundToTwo(writeOff + compSum[gid] + add);
    var newPrice = qty > 0 ? roundToTwo(newTotal / qty) : Number(data[j][cPrice]) || 0;

    sheet.getRange(j + 1, cTotal + 1).setValue(newTotal);
    sheet.getRange(j + 1, cPrice + 1).setValue(newPrice);
    updated++;
  }
  Logger.log('Обновлено главных транзакций комплектов: ' + updated);
  return updated;
}

function cleanupZeroCostRows() {
  var ss = getSpreadsheet();
  var sheet = getTransactionSheet(ss);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idx = function(name){ return headers.indexOf(name); };
  var cTotal = idx('Сумма'); if (cTotal === -1) cTotal = 7;

  var junkIds = {
    '4a85ceab-31f6-4a76-a724-6408d89bff81': true,
    '81dd00aa-39bf-4f6f-98f1-ed1dcb94b7a1': true
  };

  var deleted = 0;
  // идём снизу вверх, чтобы индексы строк не съезжали при удалении
  for (var i = data.length - 1; i >= 1; i--) {
    var id = String(data[i][0]);
    if (junkIds[id] === true) {
      if (Number(data[i][cTotal]) === 0) {
        sheet.deleteRow(i + 1);
        deleted++;
        Logger.log('Удалена мусорная строка id=' + id + ' (строка листа ' + (i + 1) + ')');
      } else {
        Logger.log('ПРОПУЩЕНО (Сумма != 0) id=' + id + ' Сумма=' + data[i][cTotal]);
      }
    }
  }
  Logger.log('Итого удалено строк: ' + deleted);
  return deleted;
}

function migrateDatesToISO() {
  var ss = getSpreadsheet();
  var sheet = getTransactionSheet(ss);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idx = function(name){ return headers.indexOf(name); };
  var tz = Session.getScriptTimeZone();

  var cDate = idx('Дата'); if (cDate === -1) cDate = 1;
  var cDelivery = idx('Дата поставки'); if (cDelivery === -1) cDelivery = 9;

  function toIsoZ(val) {
    if (val instanceof Date) {
      return Utilities.formatDate(val, tz, 'yyyy-MM-dd') + 'T12:00:00.000Z';
    }
    var s = String(val).trim();
    if (!s) return null;                                   // пусто — пропуск
    if (s.indexOf('T') !== -1 && s.indexOf('Z') !== -1) return null; // уже ISO-Z — пропуск
    var head = s.split(',')[0].trim();
    var dmy = head.match(/^(\d{2})[.\-](\d{2})[.\-](\d{4})$/); // DD-MM-YYYY / DD.MM.YYYY
    if (dmy) return dmy[3] + '-' + dmy[2] + '-' + dmy[1] + 'T12:00:00.000Z';
    var ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);          // YYYY-MM-DD (с временем без Z или без него)
    if (ymd) return ymd[1] + '-' + ymd[2] + '-' + ymd[3] + 'T12:00:00.000Z';
    var d = new Date(s);                                    // запасной вариант: JS-toString и пр.
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd') + 'T12:00:00.000Z';
    Logger.log('Не распознана дата: "' + s + '"');
    return null;
  }

  var countB = 0, countJ = 0;
  for (var i = 1; i < data.length; i++) {
    var nb = toIsoZ(data[i][cDate]);
    if (nb !== null) {
      sheet.getRange(i + 1, cDate + 1).setNumberFormat('@');
      sheet.getRange(i + 1, cDate + 1).setValue(nb);
      countB++;
    }
    var nj = toIsoZ(data[i][cDelivery]);
    if (nj !== null) {
      sheet.getRange(i + 1, cDelivery + 1).setNumberFormat('@');
      sheet.getRange(i + 1, cDelivery + 1).setValue(nj);
      countJ++;
    }
  }
  Logger.log('Дата (B) обновлено: ' + countB + '; Дата поставки (J) обновлено: ' + countJ);
  return { date: countB, delivery: countJ };
}

function migrateBowlKitsToVirtual() {
  var ss = getSpreadsheet();
  var MIGRATIONS = [
    { kit: 'BowlGrayMini_01', newComponent: 'Миска серая' },
    { kit: 'BowlBlueMini_01', newComponent: 'Миска бирюзовая' }
  ];
  
  var report = {};
  
  for (var m = 0; m < MIGRATIONS.length; m++) {
    var kit = MIGRATIONS[m].kit;
    var newComponent = MIGRATIONS[m].newComponent;
    
    // Check if already migrated
    var currentKitInfo = getKitComponents(kit);
    var isVirtual = currentKitInfo.type === 'virtual';
    var hasNewComponent = currentKitInfo.components && currentKitInfo.components.some(function(c) {
      return c.componentSku === newComponent;
    });
    
    // Read current kit qty from Остатки
    var stockSheet = getSheetByNameRobust(ss, 'Остатки');
    var stockData = stockSheet.getDataRange().getValues();
    var qty = 0;
    var avgCost = 0;
    var cap = 0;
    var kitRowIdx = -1;
    var componentRowIdx = -1;
    var componentQty = 0;
    var componentAvgCost = 0;
    var componentCap = 0;
    
    for (var i = 1; i < stockData.length; i++) {
      var art = String(stockData[i][0]).trim();
      if (art === kit) {
        qty = Number(stockData[i][1]) || 0;
        avgCost = Number(stockData[i][2]) || 0;
        cap = Number(stockData[i][3]) || 0;
        kitRowIdx = i + 1;
      } else if (art === newComponent) {
        componentQty = Number(stockData[i][1]) || 0;
        componentAvgCost = Number(stockData[i][2]) || 0;
        componentCap = Number(stockData[i][3]) || 0;
        componentRowIdx = i + 1;
      }
    }
    
    if (qty <= 0 && isVirtual && hasNewComponent) {
      Logger.log(kit + ': уже мигрировано');
      report[kit] = 'already migrated';
      continue;
    }
    
    // 1. SKU sheet check/addition
    var skuSheet = ss.getSheetByName('SKU');
    var skuData = skuSheet.getDataRange().getValues();
    var skuExists = false;
    for (var i = 1; i < skuData.length; i++) {
      if (String(skuData[i][0]).trim() === newComponent) {
        skuExists = true;
        break;
      }
    }
    if (!skuExists) {
      skuSheet.appendRow([newComponent, 18, 0, '', '', 0]);
      Logger.log('Добавлен новый артикул в SKU: ' + newComponent);
    }
    
    // 2. Transfer stock if qty > 0
    if (qty > 0) {
      var transSheet = getTransactionSheet(ss);
      var nowStr = new Date().toISOString();
      
      // a) Расход для kit
      var refundRowObj = {
        id: Utilities.getUuid(),
        date: nowStr,
        type: 'Расход',
        article: kit,
        quantity: qty,
        price: avgCost,
        writeOffCost: cap,
        total: cap,
        destination: 'Склад [Миграция комплектов]',
        user: 'миграция'
      };
      var refundRow = buildTransactionRow(refundRowObj);
      transSheet.appendRow(refundRow);
      
      // b) Приход для newComponent
      var receiveRowObj = {
        id: Utilities.getUuid(),
        date: nowStr,
        type: 'Приход',
        article: newComponent,
        quantity: qty,
        price: avgCost,
        writeOffCost: 0,
        total: cap,
        destination: 'Склад [Миграция комплектов]',
        user: 'миграция'
      };
      var receiveRow = buildTransactionRow(receiveRowObj);
      transSheet.appendRow(receiveRow);
      
      // c) Остатки sheet updates
      if (kitRowIdx !== -1) {
        stockSheet.getRange(kitRowIdx, 2, 1, 3).setValues([[0, 0, 0]]);
      }
      
      if (componentRowIdx !== -1) {
        var finalQty = componentQty + qty;
        var finalCap = roundToTwo(componentCap + cap);
        var finalAvgCost = finalQty > 0 ? roundToTwo(finalCap / finalQty) : 0;
        stockSheet.getRange(componentRowIdx, 2, 1, 3).setValues([[finalQty, finalAvgCost, finalCap]]);
      } else {
        stockSheet.appendRow([newComponent, qty, avgCost, cap, 0, 0]);
      }
      Logger.log('Перенесено остатков с ' + kit + ' на ' + newComponent + ': ' + qty + ' шт.');
    }
    
    // 3. Комплекты sheet updates
    var kitSheet = getKitSheet(ss);
    var kitDataRaw = kitSheet.getDataRange().getValues();
    var rowsToDelete = [];
    for (var i = kitDataRaw.length - 1; i >= 1; i--) {
      if (String(kitDataRaw[i][0]).trim() === kit) {
        rowsToDelete.push(i + 1);
      }
    }
    for (var i = 0; i < rowsToDelete.length; i++) {
      kitSheet.deleteRow(rowsToDelete[i]);
    }
    
    var newRows = [
      [kit, newComponent, 1, 'virtual'],
      [kit, 'Бутылки', 1, 'virtual'],
      [kit, 'Пакеты', 1, 'virtual']
    ];
    kitSheet.getRange(kitSheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
    
    SpreadsheetApp.flush();
    Logger.log('Состав комплекта ' + kit + ' обновлен на виртуальный.');
    report[kit] = 'migrated (transferred ' + qty + ' qty)';
  }
  
  Logger.log('Отчёт о миграции: ' + JSON.stringify(report, null, 2));
  return report;
}

function migrateComponentWriteOffCosts() {
  var ss = getSpreadsheet();
  var transSheet = getTransactionSheet(ss);
  if (!transSheet) {
    Logger.log('Лист :Транзакции не найден.');
    return 0;
  }
  
  var range = transSheet.getDataRange();
  var values = range.getValues();
  if (values.length <= 1) {
    Logger.log('Нет транзакций для миграции.');
    return 0;
  }
  
  var headers = values[0].map(function(h) { return String(h).trim(); });
  var cIdx = headers.indexOf('isComponent');
  var wocIdx = headers.indexOf('Себестоимость списания');
  var totalIdx = headers.indexOf('Сумма');
  
  if (cIdx === -1 || wocIdx === -1 || totalIdx === -1) {
    Logger.log('Не удалось найти необходимые колонки: isComponent, Себестоимость списания или Сумма.');
    return 0;
  }
  
  var correctedCount = 0;
  
  for (var i = 1; i < values.length; i++) {
    var isComp = values[i][cIdx];
    var isCompBool = isComp === true || String(isComp).toLowerCase() === 'true';
    if (isCompBool) {
      var wocVal = Number(values[i][wocIdx]) || 0;
      var totalVal = Number(values[i][totalIdx]) || 0;
      
      if (Math.abs(wocVal - totalVal) > 0.01) {
        transSheet.getRange(i + 1, wocIdx + 1).setValue(totalVal);
        correctedCount++;
      }
    }
  }
  
  SpreadsheetApp.flush();
  Logger.log('Количество исправленных строк компонентов: ' + correctedCount);
  return correctedCount;
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

  if (cabinetIdx === -1 || skuIdx === -1 || articleIdx === -1 || nameIdx === -1 || warehouseIdx === -1 || clusterIdx === -1 || availableIdx === -1 || preparingIdx === -1 || requestedIdx === -1 || transitIdx === -1 || excessIdx === -1 || returnsIdx === -1 || otherIdx === -1 || updatedIdx === -1) {
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
    return row;
  });

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }

  const combinedRows = keptRows.concat(newRows);
  if (combinedRows.length > 0) {
    sheet.getRange(2, 1, combinedRows.length, headers.length).setValues(combinedRows);
  }

  return {
    savedRows: newRows.length,
    keptRows: keptRows.length,
    cabinets: okCabinets
  };
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

  if (cabinetIdx === -1 || skuIdx === -1 || articleIdx === -1 || nameIdx === -1 || warehouseIdx === -1 || clusterIdx === -1 || availableIdx === -1 || preparingIdx === -1 || requestedIdx === -1 || transitIdx === -1 || excessIdx === -1 || returnsIdx === -1 || otherIdx === -1 || updatedIdx === -1) {
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
      peresortJSON: getVal(peresortJsonIdx, false)
    });
  }
  return shipments;
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
  var commitResult = commitTransaction(newComposition, 'Расход', destination, deliveryDate, username, originalDate);

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

const PROXY_URL = 'https://service-415081166309.us-west1.run.app';

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
      props.setProperty('ozon_lastAutoSync', JSON.stringify(result));
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

    if (result.ok) {
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

  props.setProperty('ozon_lastAutoSync', JSON.stringify(result));
  return result;
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

  return {
    enabled: enabled,
    triggersCount: triggersCount,
    target: target,
    lastRun: lastRun
  };
}


