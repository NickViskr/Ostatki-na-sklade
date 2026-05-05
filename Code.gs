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

function doPost(e) {
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
    
    let result = {};
    
    if (action === 'archiveTransactions') {
       if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
       const monthsToKeep = payload.data && payload.data.monthsToKeep ? payload.data.monthsToKeep : 6;
       PropertiesService.getScriptProperties().setProperty('archive_monthsToKeep', String(monthsToKeep));
       ScriptApp.newTrigger('runArchiveOldTransactionsAsBackground').timeBased().after(100).create();
       return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: { async: true, message: 'Процесс запущен в фоновом режиме. Это займет около минуты.' } })).setMimeType(ContentService.MimeType.JSON);
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
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = getUsers();
        break;
      case 'addUser':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = addUser(data.username, data.password, data.role);
        break;
      case 'deleteUser':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = deleteUser(payload.username, currentUser.username);
        break;
      case 'setup':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = setupDatabase();
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
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = addService(data.name, data.cost);
        break;
      case 'updateService':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = updateService(payload.id, data.name, data.cost, data.isActive);
        break;
      case 'deleteService':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = updateService(payload.id, data.name, data.cost, false);
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
        result = commitTransaction(data, payload.type, payload.destination, payload.deliveryDate);
        break;
      case 'getGlobalSettings':
        if (sessionToken && !currentUser) {
          currentUser = verifySession(sessionToken);
        }
        result = getGlobalSettings(currentUser ? currentUser.role : null);
        break;
      case 'saveGlobalSettings':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = saveGlobalSettings(data, currentUser.role);
        break;
      case 'getArchivedItems':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = getArchivedItems();
        break;
      case 'restoreArchivedItem':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = restoreArchivedItem(payload.archiveId);
        break;
      case 'restoreMultipleArchivedItems':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = restoreMultipleArchivedItems(payload.archiveIds);
        break;
      case 'hardDeleteArchivedItems':
        if (currentUser.role !== 'admin' && currentUser.username.toLowerCase() !== 'admin' && currentUser.username.toLowerCase() !== 'админ' && currentUser.username.toLowerCase() !== 'администратор') throw new Error('Forbidden: Требуются права администратора');
        result = hardDeleteArchivedItems(payload.archiveIds);
        break;
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

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function setupDatabase() {
  const ss = getSpreadsheet();
  
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
  const transSheet1 = getSheetByNameRobust(ss, 'Транзакции');
  const transSheet2 = getSheetByNameRobust(ss, 'История');
  let transSheet = null;
  
  if (transSheet1 && transSheet2) {
    transSheet = transSheet1.getLastRow() >= transSheet2.getLastRow() ? transSheet1 : transSheet2;
  } else {
    transSheet = transSheet1 || transSheet2;
  }

  if (!transSheet) {
    transSheet = ss.insertSheet('Транзакции');
    transSheet.appendRow(['ID', 'Дата', 'Тип', 'Артикул', 'Количество', 'Цена', 'Себестоимость списания', 'Сумма', 'Объект', 'Дата поставки']);
    transSheet.getRange('A1:J1').setFontWeight('bold');
  } else {
    // Миграция Транзакции
    const data = transSheet.getDataRange().getValues();
    if (data.length > 0) {
      const headers = data[0].map(h => String(h).trim());
      const expectedHeaders = ['ID', 'Дата', 'Тип', 'Артикул', 'Количество', 'Цена', 'Себестоимость списания', 'Сумма', 'Объект', 'Дата поставки'];
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
          
          newData.push([id, date, type, article, qty, price, writeOff, total, dest, deliveryDate]);
        }
        
        transSheet.clear();
        transSheet.getRange(1, 1, newData.length, 10).setValues(newData);
        transSheet.getRange('A1:J1').setFontWeight('bold');
      }
    }
  }
  
  // Sheet: SKU
  let skuSheet = ss.getSheetByName('SKU');
  if (!skuSheet) {
    skuSheet = ss.insertSheet('SKU');
    skuSheet.appendRow(['SKU', 'ШТ/КОР', 'Упаковка', 'Коробка', 'Мин. остаток']);
    skuSheet.getRange('A1:E1').setFontWeight('bold');
  } else {
    const headers = skuSheet.getRange('A1:E1').getValues()[0];
    if (headers[0] !== 'SKU') {
      skuSheet.getRange('A1:E1').setValues([['SKU', 'ШТ/КОР', 'Упаковка', 'Коробка', 'Мин. остаток']]);
      skuSheet.getRange('A1:E1').setFontWeight('bold');
    }
  }
  
  // Sheet: Пользователи
  let usersSheet = ss.getSheetByName('Пользователи');
  if (!usersSheet) {
    usersSheet = ss.insertSheet('Пользователи');
    usersSheet.appendRow(['Username', 'Password', 'Role']);
    usersSheet.getRange('A1:C1').setFontWeight('bold');
    // Add default admin
    usersSheet.appendRow(['Админ', hashPassword('Admin_9x$K2mP'), 'admin']);
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

const TRANS_HEADERS = [
  'ID', 'Дата', 'Тип', 'Артикул', 'Количество',
  'Цена', 'Себестоимость списания', 'Сумма', 'Объект', 'Дата поставки'
];

function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const num = Number(String(val).replace(',', '.').replace(/\s/g, ''));
  return isNaN(num) ? 0 : num;
}

function roundToTwo(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function parseTransactionRow(row) {
  let dateStr = '';
  if (row[1] instanceof Date) {
    try {
      dateStr = Utilities.formatDate(
        row[1], Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"
      );
    } catch(e) { dateStr = String(row[1]); }
  } else {
    dateStr = String(row[1] || '');
  }

  let deliveryStr = '';
  if (row[9] instanceof Date) {
    try {
      deliveryStr = Utilities.formatDate(
        row[9], Session.getScriptTimeZone(), 'yyyy-MM-dd'
      );
    } catch(e) { deliveryStr = String(row[9]); }
  } else {
    deliveryStr = String(row[9] || '');
  }

  return {
    id:           String(row[0]),
    date:         dateStr,
    type:         String(row[2]),
    article:      String(row[3]),
    quantity:     parseNumber(row[4]),
    price:        parseNumber(row[5]),
    writeOffCost: parseNumber(row[6]),
    total:        parseNumber(row[7]),
    destination:  String(row[8] || ''),
    deliveryDate: deliveryStr
  };
}

function getTransactionSheet(ss) {
  const sheet1 = getSheetByNameRobust(ss, 'Транзакции');
  const sheet2 = getSheetByNameRobust(ss, 'История');
  if (sheet1 && sheet2) {
    return sheet1.getLastRow() >= sheet2.getLastRow() ? sheet1 : sheet2;
  }
  return sheet1 || sheet2;
}

// ─── Вариант 2: фильтрация на стороне GAS ─────────────────────────────────────

function getTransactions(params) {
  params = params || {};
  const dateFrom = params.dateFrom || null;
  const dateTo   = params.dateTo   || null;
  const article  = params.article  || null;
  const type     = params.type     || null;
  const limit    = Math.min(params.limit || 500, 1000);

  const ss    = getSpreadsheet();
  const sheet = getTransactionSheet(ss);
  if (!sheet) return { rows: [], total: 0, hasMore: false };

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { rows: [], total: 0, hasMore: false };

  const data = sheet.getRange(1, 1, lastRow, 10).getValues();

  const fromMs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
  const toMs   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : Infinity;

  const rows   = [];
  let skipped  = 0;
  let tooOld   = 0;

  for (let i = data.length - 1; i >= 1; i--) {
    if (rows.length >= limit) break;

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

    if (dateTo   && rowMs > toMs)   { skipped++; continue; }
    if (dateFrom && rowMs < fromMs) {
      tooOld++;
      if (tooOld > 5) break; // допускаем 5 нарушений порядка
      continue;
    }

    if (article && String(row[3]) !== article) { skipped++; continue; }
    if (type    && String(row[2]) !== type)    { skipped++; continue; }

    rows.push(parseTransactionRow(row));
  }

  return {
    rows,
    total:   lastRow - 1,
    hasMore: rows.length >= limit
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

  const data = sheet.getRange(1, 1, lastRow, 10).getValues();

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsToKeep);
  cutoff.setHours(0, 0, 0, 0);
  const cutoffMs = cutoff.getTime();

  const archiveMap = {};
  const toKeep     = [TRANS_HEADERS];

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
      archiveSheet.appendRow(TRANS_HEADERS);
      archiveSheet.getRange('A1:J1').setFontWeight('bold');
      archiveSheet.hideSheet();
    }

    const insertFrom = archiveSheet.getLastRow() + 1;
    const rows       = archiveMap[year];
    archiveSheet.getRange(insertFrom, 1, rows.length, 10).setValues(rows);
  }

  sheet.clear();
  sheet.getRange(1, 1, toKeep.length, 10).setValues(toKeep);
  sheet.getRange('A1:J1').setFontWeight('bold');

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
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const rows = data.slice(1);
  
  return rows.map(row => ({
    sku: row[0] ? String(row[0]) : '',
    pcsPerBox: Number(row[1]) || 1,
    packagingCost: Number(row[2]) || 0,
    boxCost: Number(row[3]) || 0,
    minStock: Number(row[4]) || 0
  }));
}

function addSku(skuData) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден. Выполните инициализацию.');
  
  sheet.appendRow([
    skuData.sku,
    skuData.pcsPerBox,
    skuData.packagingCost,
    skuData.boxCost,
    skuData.minStock
  ]);
  
  return getSkus();
}

function updateSku(skuData, oldSku) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден.');
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(oldSku)) {
      sheet.getRange(i + 1, 1, 1, 5).setValues([[
        skuData.sku,
        skuData.pcsPerBox,
        skuData.packagingCost,
        skuData.boxCost,
        skuData.minStock
      ]]);
      
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
  
  const data = sheet.getDataRange().getValues();
  const exists = data.some(row => String(row[0]) === String(article));
  
  if (!exists) {
    sheet.appendRow([article, 1, 0, 0, 0]);
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
      if (typeof archiveItem === 'function') archiveItem('SKU', { sku: rowData[0], pcsPerBox: rowData[1], packagingCost: rowData[2], boxCost: rowData[3], minStock: rowData[4] }, deletedBy);
      sheet.deleteRow(i + 1);
      break;
    }
  }
  
  return getSkus();
}

function deleteTransaction(id, deletedBy, isUpdate = false) {
  const ss = getSpreadsheet();
  const transSheet1 = getSheetByNameRobust(ss, 'Транзакции');
  const transSheet2 = getSheetByNameRobust(ss, 'История');
  let transSheet = null;
  if (transSheet1 && transSheet2) {
    transSheet = transSheet1.getLastRow() >= transSheet2.getLastRow() ? transSheet1 : transSheet2;
  } else {
    transSheet = transSheet1 || transSheet2;
  }
  
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');
  
  if (!transSheet || !stockSheet) throw new Error('База данных не инициализирована');
  
  const transDataAll = transSheet.getDataRange().getValues();
  if (transDataAll.length <= 1) throw new Error('Нет транзакций');

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
  const dest = String(transData[8] || '');
  
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
      deliveryDate: deliveryDateStr
    }, deletedBy);
  }
  
      const stockData = stockSheet.getDataRange().getValues();
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
        newCap = roundToTwo(newCap + writeOffCost);
      }
      
      stockSheet.getRange(i + 1, 2, 1, 3).setValues([[newQty, newAvgCost, newCap]]);
      break;
    }
  }
  
  transSheet.deleteRow(rowIndex);
  SpreadsheetApp.flush();
  return { stock: getStock(), transactions: getTransactions().rows };
}

function updateTransaction(id, newData, deletedBy) {
  deleteTransaction(id, deletedBy, true);
  return commitTransaction([newData], newData.type, newData.destination, newData.deliveryDate);
}

function commitTransaction(items, type, destination, deliveryDate = '') {
  const ss = getSpreadsheet();
  const transSheet1 = getSheetByNameRobust(ss, 'Транзакции');
  const transSheet2 = getSheetByNameRobust(ss, 'История');
  let transSheet = null;
  if (transSheet1 && transSheet2) {
    transSheet = transSheet1.getLastRow() >= transSheet2.getLastRow() ? transSheet1 : transSheet2;
  } else {
    transSheet = transSheet1 || transSheet2;
  }
  
  const stockSheet = getSheetByNameRobust(ss, 'Остатки');
  
  if (!transSheet || !stockSheet) {
    throw new Error('База данных не инициализирована');
  }
  
  // Формат даты: день-месяц-год
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
  
  const stockData = stockSheet.getDataRange().getValues();
  const stockMap = {};
  for (let i = 1; i < stockData.length; i++) {
    const article = String(stockData[i][0]);
    stockMap[article] = {
      rowIdx: i + 1,
      quantity: Number(stockData[i][1]) || 0,
      avgCost: Number(stockData[i][2]) || 0,
      capitalization: Number(stockData[i][3]) || 0,
      sales120: Number(stockData[i][4]) || 0,
      turnover: Number(stockData[i][5]) || 0
    };
  }
  
  if (type === 'Расход') {
    const requestedQty = {};
    items.forEach(item => {
      if (item.status && item.status !== 'ok') return;
      requestedQty[item.article] = (requestedQty[item.article] || 0) + Number(item.quantity);
    });
    
    for (const article in requestedQty) {
      const available = stockMap[article] ? stockMap[article].quantity : 0;
      if (requestedQty[article] > available) {
        throw new Error(`Недостаточно товара "${article}". Доступно: ${available}, требуется: ${requestedQty[article]}`);
      }
    }
  }
  
  items.forEach(item => {
    if (item.status && item.status !== 'ok') return;
    
    const article = item.article;
    const qty = Number(item.quantity);
    const price = roundToTwo(Number(item.price));
    const total = roundToTwo(qty * price);
    
    let writeOffCost = 0;
    
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
      if (stockMap[article]) {
        const curr = stockMap[article];
        writeOffCost = roundToTwo(curr.avgCost * qty);
        
        const newQty = curr.quantity - qty;
        const newCap = roundToTwo(curr.capitalization - writeOffCost);
        const newSales = curr.sales120 + qty;
        
        stockMap[article].quantity = newQty;
        stockMap[article].capitalization = newCap;
        stockMap[article].sales120 = newSales;
        
        stockSheet.getRange(curr.rowIdx, 2, 1, 4).setValues([[newQty, curr.avgCost, newCap, newSales]]);
      }
    }
    
    transSheet.appendRow([
      Utilities.getUuid(),
      dateStr,
      type,
      article,
      qty,
      price,
      writeOffCost,
      total,
      destination,
      deliveryDate
    ]);
  });
  
  return getStock();
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
    sheet.appendRow(['Админ', hashPassword('Admin_9x$K2mP'), 'admin']);
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
  
  const token = Utilities.getUuid();
  const expiresAt = new Date().getTime() + (24 * 60 * 60 * 1000); // 24 hours
  
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
  if (username === 'admin') throw new Error('Нельзя удалить главного администратора');
  
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
        addUser(payload.username, payload.password, payload.role);
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
  const transSheet1 = getSheetByNameRobust(ss, 'Транзакции');
  const transSheet2 = getSheetByNameRobust(ss, 'История');
  let transSheet = transSheet1 || transSheet2;
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
        newCap -= writeOffCost;
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
  
  let dateStr = payload.date || '';
  if (dateStr.includes('T')) {
      dateStr = Utilities.formatDate(new Date(dateStr), Session.getScriptTimeZone(), "dd-MM-yyyy");
  }

  let deliveryStr = payload.deliveryDate || '';
  if (deliveryStr.includes('T')) {
      try {
        deliveryStr = Utilities.formatDate(new Date(deliveryStr), Session.getScriptTimeZone(), "yyyy-MM-dd");
      } catch(e) {
        // ignore
      }
  }
  
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
    deliveryStr
  ]);
}

function deleteMultipleTransactions(ids, deletedBy) {
  if (!ids || ids.length === 0) return { stock: getStock(), transactions: getTransactions().rows };
  if (!deletedBy) deletedBy = 'unknown';

  const ss = getSpreadsheet();
  const spreadsheetId = ss.getId();
  
  // 1. Получаем листы
  const transSheet1 = getSheetByNameRobust(ss, 'Транзакции');
  const transSheet2 = getSheetByNameRobust(ss, 'История');
  const transSheet = (transSheet1 && transSheet2) ? (transSheet1.getLastRow() >= transSheet2.getLastRow() ? transSheet1 : transSheet2) : (transSheet1 || transSheet2);
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

      // Формируем объект для архива
      const archiveObj = { id: rowId, date: dateStr, type, article, quantity: qty, price, writeOffCost, total, destination: dest, deliveryDate: deliveryDateStr };
      rowsToArchive.push([Utilities.getUuid(), 'Transaction', deletedAt, JSON.stringify(archiveObj), deletedBy]);

      // Аккумулируем откат остатков
      if (stockChanges[article]) {
        if (type === 'Приход') {
          stockChanges[article].qtyDiff -= qty;
          stockChanges[article].capDiff -= total;
        } else if (type === 'Расход') {
          stockChanges[article].qtyDiff += qty;
          stockChanges[article].capDiff += writeOffCost;
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
        const dateObj = payload.date ? new Date(payload.date) : new Date();
        let dateStr = "";
        try { dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"); } catch (e) { dateStr = String(payload.date); }
        
        let deliveryStr = "";
        if (payload.deliveryDate) {
          const dObj = new Date(payload.deliveryDate);
          try { deliveryStr = Utilities.formatDate(dObj, Session.getScriptTimeZone(), "yyyy-MM-dd"); } catch (e) { deliveryStr = String(payload.deliveryDate); }
        }

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

  if (transactionsToRestore.length > 0) {
    // 2. Добавляем восстановленные данные обратно
    const transSheet1 = getSheetByNameRobust(ss, 'Транзакции');
    const transSheet2 = getSheetByNameRobust(ss, 'История');
    const transSheet = (transSheet1 && transSheet2) ? (transSheet1.getLastRow() >= transSheet2.getLastRow() ? transSheet1 : transSheet2) : (transSheet1 || transSheet2);
    
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

  // Единоразово пересчитываем весь склад
  recalculateStockFully(ss);

  if (duplicatesCount > 0 || apiErrors > 0) {
     restoreMsg = `Восстановлено: ${transactionsToRestore.length}. `;
     if (duplicatesCount > 0) restoreMsg += `Пропущено дубликатов: ${duplicatesCount}. `;
     if (apiErrors > 0) restoreMsg += `Ошибок удаления из архива: ${apiErrors}.`;
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
  const transSheet1 = getSheetByNameRobust(ss, 'Транзакции');
  const transSheet2 = getSheetByNameRobust(ss, 'История');
  const transSheet = (transSheet1 && transSheet2) ? (transSheet1.getLastRow() >= transSheet2.getLastRow() ? transSheet1 : transSheet2) : (transSheet1 || transSheet2);
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

function getGlobalSettings(role) {
  const props = PropertiesService.getScriptProperties();
  const settings = {
    geminiModel: props.getProperty('global_geminiModel') || 'gemini-1.5-flash'
  };
  // Ключ — только администратору
  if (role === 'admin') {
    settings.geminiKey = props.getProperty('global_geminiKey') || '';
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
  return getGlobalSettings(role);
}

// --- Services (Услуги) ---

function getServices() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Услуги');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  return data.slice(1).map(row => ({
    id: String(row[0]),
    name: String(row[1]),
    cost: Number(row[2]) || 0,
    isActive: row[3] !== false && row[3] !== 'false' && row[3] !== 0 && String(row[3]).toLowerCase() !== 'false'
  }));
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
