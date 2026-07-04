const fs = require('fs');
let code = fs.readFileSync('Code.gs', 'utf8');

// Step 1: Add ensureColumns and getOrCreateSheet
const ensureColsCode = `
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

const KIT_HEADERS = ['kitSku', 'componentSku', 'quantity'];
function getKitSheet(ss) {
  return getOrCreateSheet(ss, 'Комплекты', KIT_HEADERS);
}
`;

code = code.replace(
  '// ─── Вспомогательные функции ──────────────────────────────────────────────────',
  '// ─── Вспомогательные функции ──────────────────────────────────────────────────\n' + ensureColsCode
);

// Step 2: setupDatabase
code = code.replace(
  'return true;\n}',
  'getKitSheet(ss);\n  return true;\n}'
);

// Cache code
const cacheCode = `
let _transHeadersCache = null;
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
`;

code = code.replace(/function getTransactionSheet\(ss\) \{[\s\S]*?\n\}/, cacheCode);
code = code.replace(/_transHeadersCache = null;/g, '');
code = code.replace('function doPost(e) {', 'function doPost(e) {\n  _transHeadersCache = null;');

code = code.replace(/function parseTransactionRow\(row\) \{[\s\S]*?return \{[\s\S]*?\};\n\}/, `function parseTransactionRow(row, headers) {
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
}`);

code = code.replace(/const data = sheet\.getRange\(1, 1, lastRow, 11\)\.getValues\(\);/g, 'const lastCol = sheet.getLastColumn();\n  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();\n  const headers = data[0].map(h => String(h).trim());');
code = code.replace(/filtered\.push\(parseTransactionRow\(row\)\);/g, 'filtered.push(parseTransactionRow(row, headers));');

code = code.replace(/const oldTrans = parseTransactionRow\(oldRow\);/g, 'const headers = transSheet.getRange(1, 1, 1, transSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());\n  const oldTrans = parseTransactionRow(oldRow, headers);');

code = code.replace(/const toKeep     = \[TRANS_HEADERS\];/g, 'const toKeep     = [headers];');
code = code.replace(/archiveSheet\.getRange\(insertFrom, 1, rows\.length, 11\)\.setValues\(rows\);/g, 'archiveSheet.getRange(insertFrom, 1, rows.length, lastCol).setValues(rows);');
code = code.replace(/sheet\.getRange\(1, 1, toKeep\.length, 11\)\.setValues\(toKeep\);/g, 'sheet.getRange(1, 1, toKeep.length, lastCol).setValues(toKeep);');
code = code.replace(/archiveSheet\.appendRow\(TRANS_HEADERS\);/g, 'archiveSheet.appendRow(headers);');

const kitFunctions = `
function getKits() {
  const ss = getSpreadsheet();
  const sheet = getKitSheet(ss);
  const data = sheet.getDataRange().getValues();
  const kits = {};
  if (data.length <= 1) return kits;
  
  for (let i = 1; i < data.length; i++) {
    const kitSku = String(data[i][0]).trim();
    const componentSku = String(data[i][1]).trim();
    let qty = Number(data[i][2]);
    if (isNaN(qty) || qty <= 0) qty = 1;
    
    if (kitSku && componentSku) {
      if (!kits[kitSku]) kits[kitSku] = [];
      kits[kitSku].push({ componentSku, quantity: qty });
    }
  }
  return kits;
}

function saveKit(kitSku, components) {
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
  
  if (components && components.length > 0) {
    const newRows = components.map(c => [kitSku, c.componentSku, Number(c.quantity) || 1]);
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
  }
  
  SpreadsheetApp.flush();
  return { status: 'success', kitSku: kitSku, count: components ? components.length : 0 };
}

function deleteKit(kitSku) {
  return saveKit(kitSku, []);
}

function getKitComponents(kitSku) {
  const kits = getKits();
  return kits[kitSku] || [];
}
`;

code = code.replace(/default:\n\s*throw new Error\(\'Unknown action: \' \+ action\);/, `case 'saveKit':
        assertAdmin(currentUser);
        result = saveKit(data.kitSku, data.components);
        break;
      case 'deleteKit':
        assertAdmin(currentUser);
        result = deleteKit(payload.kitSku);
        break;
      default:
        throw new Error('Unknown action: ' + action);`);

code += '\n' + kitFunctions;

code = code.replace(/transactions: getTransactions\(payload\.data\),/g, 'transactions: getTransactions(payload.data),\n          kits: getKits(),');

// Step 6: commitTransaction kit logic
const commitReplacement = `
  if (type === 'Расход') {
    const requestedQty = {};
    items.forEach(item => {
      if (item.status && item.status !== 'ok') return;
      requestedQty[item.article] = (requestedQty[item.article] || 0) + Number(item.quantity);
    });
    
    // Validate main kits components
    const errors = [];
    for (const article in requestedQty) {
      const kitComponents = getKitComponents(article);
      if (kitComponents.length > 0) {
        for (const comp of kitComponents) {
          const needed = comp.quantity * requestedQty[article];
          const available = stockMap[comp.componentSku] ? stockMap[comp.componentSku].quantity : 0;
          if (available < needed) {
            errors.push('Нет ' + comp.componentSku + ': нужно ' + needed + ' шт., есть ' + available + ' шт.');
          }
        }
      } else {
        const available = stockMap[article] ? stockMap[article].quantity : 0;
        if (requestedQty[article] > available) {
          errors.push('Недостаточно товара "' + article + '". Доступно: ' + available + ', требуется: ' + requestedQty[article]);
        }
      }
    }
    if (errors.length > 0) {
      throw new Error('Недостаточно наличия на складе:\\n' + errors.join('\\n'));
    }
  }
  
  const newTransactions = [];
  
  items.forEach(item => {
    if (item.status && item.status !== 'ok') return;
    
    const article = item.article;
    const qty = Number(item.quantity);
    const price = roundToTwo(Number(item.price));
    const total = roundToTwo(qty * price);
    
    let writeOffCost = 0;
    let componentsTotal = 0;
    let kitGroupId = '';
    
    // Kit logic for Расход
    if (type === 'Расход') {
      const kitComponents = getKitComponents(article);
      if (kitComponents.length > 0) {
        kitGroupId = Utilities.getUuid();
        
        for (const comp of kitComponents) {
          const compQty = comp.quantity * qty;
          const compStock = stockMap[comp.componentSku] || { quantity: 0, avgCost: 0, capitalization: 0 };
          const compAvg = compStock.avgCost;
          const compTotal = roundToTwo(compAvg * compQty);
          componentsTotal += compTotal;
          
          const newCompQty = compStock.quantity - compQty;
          const newCompCap = roundToTwo(compStock.capitalization - compTotal);
          
          if (stockMap[comp.componentSku]) {
            stockMap[comp.componentSku].quantity = newCompQty;
            stockMap[comp.componentSku].capitalization = newCompCap;
            stockSheet.getRange(compStock.rowIdx, 2, 1, 3).setValues([[newCompQty, compAvg, newCompCap]]);
          }
          
          const compTransId = Utilities.getUuid();
          const compRow = buildTransactionRow({
            id:          compTransId,
            date:        dateStr,
            type:        'Расход',
            article:     comp.componentSku,
            quantity:    compQty,
            price:       compAvg,
            writeOffCost: compAvg,
            total:       compTotal,
            destination: destination,
            deliveryDate: '',
            comment:     'Авто: комплект ' + article,
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
            writeOffCost: compAvg,
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
      if (stockMap[article]) {
        const curr = stockMap[article];
        writeOffCost = roundToTwo(curr.avgCost * qty);
        
        const newQty = curr.quantity - qty;
        const newCap = roundToTwo(curr.capitalization - writeOffCost);
        
        stockMap[article].quantity = newQty;
        stockMap[article].capitalization = newCap;
        
        stockSheet.getRange(curr.rowIdx, 2, 1, 3).setValues([[newQty, curr.avgCost, newCap]]);
      }
    }
    
    const mainTotal = (type === 'Расход' && kitGroupId) ? (writeOffCost + componentsTotal) : total;
    
    const transId = Utilities.getUuid();
    
    const mainRow = buildTransactionRow({
      id: transId,
      date: dateStr,
      type: type,
      article: article,
      quantity: qty,
      price: price,
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
      price,
      writeOffCost,
      total: mainTotal,
      destination,
      deliveryDate,
      user: username,
      groupId: kitGroupId || '',
      isComponent: false
    });
  });
`;

code = code.replace(/if \(type === 'Расход'\) \{[\s\S]*?transSheet\.appendRow\(\[\s*transId,\s*dateStr,\s*type,\s*article,\s*qty,\s*price,\s*writeOffCost,\s*total,\s*destination,\s*deliveryDate,\s*username\s*\]\);\s*newTransactions\.push\(\{[\s\S]*?\}\);\s*\}\);/, commitReplacement);

fs.writeFileSync('Code.gs', code);
