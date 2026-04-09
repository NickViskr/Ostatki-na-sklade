function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Ждем до 10 секунд получения блокировки
    lock.waitLock(10000);
    
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const data = payload.data;
    const token = payload.token;
    
    // Базовая авторизация (если токен задан в свойствах скрипта)
    const expectedToken = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (expectedToken && token !== expectedToken) {
      throw new Error('Unauthorized: Неверный токен доступа');
    }
    
    let result = {};
    
    switch (action) {
      case 'setup':
        result = setupDatabase();
        break;
      case 'getStock':
        result = getStock();
        break;
      case 'getTransactions':
        result = getTransactions();
        break;
      case 'deleteTransaction':
        result = deleteTransaction(payload.id);
        break;
      case 'updateTransaction':
        result = updateTransaction(payload.id, data);
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
        result = deleteSku(payload.sku);
        break;
      case 'commit':
        result = commitTransaction(data, payload.type, payload.destination);
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
    lock.releaseLock();
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
    stockSheet.appendRow(['Артикул', 'Наименование', 'Количество', 'Ср. Себестоимость', 'Капитализация', 'Продажи 120д', 'Оборачиваемость']);
    stockSheet.getRange('A1:G1').setFontWeight('bold');
  }
  
  // Sheet: Транзакции
  let transSheet = ss.getSheetByName('Транзакции');
  if (!transSheet) {
    transSheet = ss.insertSheet('Транзакции');
    transSheet.appendRow(['ID', 'Дата', 'Тип', 'Артикул', 'Наименование', 'Количество', 'Цена', 'Сумма списания', 'Итого', 'Объект']);
    transSheet.getRange('A1:J1').setFontWeight('bold');
  } else {
    // Миграция: добавление колонки ID, если ее нет
    const headers = transSheet.getRange('A1:J1').getValues()[0];
    if (headers[0] !== 'ID') {
      transSheet.insertColumnBefore(1);
      transSheet.getRange('A1').setValue('ID');
      transSheet.getRange('A1').setFontWeight('bold');
      const lastRow = transSheet.getLastRow();
      if (lastRow > 1) {
        const ids = [];
        for (let i = 2; i <= lastRow; i++) ids.push([Utilities.getUuid()]);
        transSheet.getRange(2, 1, lastRow - 1, 1).setValues(ids);
      }
    }
  }
  
  // Sheet: SKU
  let skuSheet = ss.getSheetByName('SKU');
  if (!skuSheet) {
    skuSheet = ss.insertSheet('SKU');
    skuSheet.appendRow(['SKU', 'Наименование', 'ШТ/КОР', 'Упаковка', 'Коробка', 'Мин. остаток']);
    skuSheet.getRange('A1:F1').setFontWeight('bold');
  } else {
    const headers = skuSheet.getRange('A1:F1').getValues()[0];
    if (headers[0] !== 'SKU' || headers[1] !== 'Наименование') {
      skuSheet.getRange('A1:F1').setValues([['SKU', 'Наименование', 'ШТ/КОР', 'Упаковка', 'Коробка', 'Мин. остаток']]);
      skuSheet.getRange('A1:F1').setFontWeight('bold');
    }
  }
  
  return true;
}

function getStock() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Остатки');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const rows = data.slice(1);
  
  return rows.map(row => ({
    article: row[0] ? String(row[0]) : '',
    name: row[1] ? String(row[1]) : '',
    quantity: Number(row[2]) || 0,
    avgCost: Number(row[3]) || 0,
    capitalization: Number(row[4]) || 0,
    sales120: Number(row[5]) || 0,
    turnover: Number(row[6]) || 0
  }));
}

function getTransactions() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Транзакции');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const headers = data[0];
  const hasId = headers[0] === 'ID';
  
  const rows = data.slice(1).map((row, index) => {
    const formatDate = (val) => {
      if (val instanceof Date) {
        return Utilities.formatDate(val, Session.getScriptTimeZone(), "dd-MM-yyyy");
      }
      return String(val);
    };

    if (hasId) {
      return {
        id: row[0] ? String(row[0]) : `temp_${index}`,
        date: formatDate(row[1]),
        type: row[2] ? String(row[2]) : '',
        article: row[3] ? String(row[3]) : '',
        name: row[4] ? String(row[4]) : '',
        quantity: Number(row[5]) || 0,
        price: Number(row[6]) || 0,
        writeOffCost: Number(row[7]) || 0,
        total: Number(row[8]) || 0,
        destination: row[9] ? String(row[9]) : ''
      };
    } else {
      // Старый формат без колонки ID
      return {
        id: row[0] ? `${String(row[0])}_${index}` : `temp_${index}`, // Используем дату + индекс как временный ID
        date: formatDate(row[0]),
        type: row[1] ? String(row[1]) : '',
        article: row[2] ? String(row[2]) : '',
        name: row[3] ? String(row[3]) : '',
        quantity: Number(row[4]) || 0,
        price: Number(row[5]) || 0,
        writeOffCost: Number(row[6]) || 0,
        total: Number(row[7]) || 0,
        destination: row[8] ? String(row[8]) : ''
      };
    }
  }).reverse(); 
  
  return rows;
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
    name: row[1] ? String(row[1]) : '',
    pcsPerBox: Number(row[2]) || 1,
    packagingCost: Number(row[3]) || 0,
    boxCost: Number(row[4]) || 0,
    minStock: Number(row[5]) || 0
  }));
}

function addSku(skuData) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден. Выполните инициализацию.');
  
  sheet.appendRow([
    skuData.sku,
    skuData.name,
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
      sheet.getRange(i + 1, 1, 1, 6).setValues([[
        skuData.sku,
        skuData.name,
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
            stockSheet.getRange(j + 1, 1, 1, 2).setValues([[skuData.sku, skuData.name]]);
            break;
          }
        }
      }
      break;
    }
  }
  
  return { skus: getSkus(), stock: getStock() };
}

function ensureSkuExists(article, name) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  const exists = data.some(row => String(row[0]) === String(article));
  
  if (!exists) {
    sheet.appendRow([article, name, 1, 0, 0, 0]);
  }
}

function deleteSku(sku) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('SKU');
  if (!sheet) throw new Error('Лист SKU не найден.');
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sku)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  
  return getSkus();
}

function deleteTransaction(id) {
  const ss = getSpreadsheet();
  const transSheet = ss.getSheetByName('Транзакции');
  const stockSheet = ss.getSheetByName('Остатки');
  
  if (!transSheet || !stockSheet) throw new Error('База данных не инициализирована');
  
  const transDataAll = transSheet.getDataRange().getValues();
  if (transDataAll.length <= 1) throw new Error('Нет транзакций');

  const headers = transDataAll[0];
  const hasId = headers[0] === 'ID';

  let rowIndex = -1;
  let transData = null;
  
  if (hasId) {
    for (let i = 1; i < transDataAll.length; i++) {
      if (String(transDataAll[i][0]) === String(id)) {
        rowIndex = i + 1;
        transData = transDataAll[i];
        break;
      }
    }
  } else {
    // Старый формат: id имеет вид "Date_index"
    const match = String(id).match(/^(.*)_(\d+)$/);
    if (match) {
      const idx = parseInt(match[2], 10);
      if (idx >= 0 && idx < transDataAll.length - 1) {
        rowIndex = idx + 2; // +1 for header, +1 for 1-based index
        transData = transDataAll[idx + 1];
      }
    }
  }
  
  if (rowIndex === -1 || !transData) throw new Error('Транзакция не найдена. Пожалуйста, инициализируйте БД в настройках.');
  
  const type = hasId ? transData[2] : transData[1];
  const article = String(hasId ? transData[3] : transData[2]);
  const qty = Number(hasId ? transData[5] : transData[4]);
  const price = Number(hasId ? transData[6] : transData[5]);
  const writeOffCost = Number(hasId ? transData[7] : transData[6]);
  const total = Number(hasId ? transData[8] : transData[7]);
  
  const stockData = stockSheet.getDataRange().getValues();
  for (let i = 1; i < stockData.length; i++) {
    if (String(stockData[i][0]) === article) {
      let newQty = Number(stockData[i][2]);
      let newAvgCost = Number(stockData[i][3]);
      let newCap = Number(stockData[i][4]);
      let newSales = Number(stockData[i][5]);
      
      if (type === 'Приход') {
        newQty -= qty;
        newCap -= total;
        newAvgCost = newQty > 0 ? newCap / newQty : 0;
      } else if (type === 'Расход') {
        newQty += qty;
        newCap += writeOffCost;
        newSales -= qty;
      }
      
      stockSheet.getRange(i + 1, 3, 1, 3).setValues([[newQty, newAvgCost, newCap]]);
      stockSheet.getRange(i + 1, 6).setValue(newSales);
      break;
    }
  }
  
  transSheet.deleteRow(rowIndex);
  return { stock: getStock(), transactions: getTransactions() };
}

function updateTransaction(id, newData) {
  deleteTransaction(id);
  return commitTransaction([newData], newData.type, newData.destination);
}

function commitTransaction(items, type, destination) {
  const ss = getSpreadsheet();
  const transSheet = ss.getSheetByName('Транзакции');
  const stockSheet = ss.getSheetByName('Остатки');
  
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
      name: stockData[i][1],
      quantity: Number(stockData[i][2]) || 0,
      avgCost: Number(stockData[i][3]) || 0,
      capitalization: Number(stockData[i][4]) || 0,
      sales120: Number(stockData[i][5]) || 0,
      turnover: Number(stockData[i][6]) || 0
    };
  }
  
  items.forEach(item => {
    if (item.status && item.status !== 'ok') return;
    
    const article = item.article;
    const qty = Number(item.quantity);
    const price = Number(item.price);
    const total = qty * price;
    
    let writeOffCost = 0;
    
    if (type === 'Приход') {
      ensureSkuExists(article, item.name);
      if (stockMap[article]) {
        const curr = stockMap[article];
        const newQty = curr.quantity + qty;
        const newCap = curr.capitalization + total;
        const newAvgCost = newQty > 0 ? newCap / newQty : 0;
        
        stockMap[article].quantity = newQty;
        stockMap[article].capitalization = newCap;
        stockMap[article].avgCost = newAvgCost;
        
        stockSheet.getRange(curr.rowIdx, 3, 1, 3).setValues([[newQty, newAvgCost, newCap]]);
      } else {
        stockSheet.appendRow([article, item.name, qty, price, total, 0, 0]);
        stockMap[article] = {
          rowIdx: stockSheet.getLastRow(),
          name: item.name,
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
        writeOffCost = curr.avgCost * qty;
        
        const newQty = curr.quantity - qty;
        const newCap = curr.capitalization - writeOffCost;
        const newSales = curr.sales120 + qty;
        
        stockMap[article].quantity = newQty;
        stockMap[article].capitalization = newCap;
        stockMap[article].sales120 = newSales;
        
        stockSheet.getRange(curr.rowIdx, 3, 1, 4).setValues([[newQty, curr.avgCost, newCap, newSales]]);
      }
    }
    
    transSheet.appendRow([
      Utilities.getUuid(),
      dateStr,
      type,
      article,
      item.name,
      qty,
      price,
      writeOffCost,
      total,
      destination
    ]);
  });
  
  return getStock();
}
