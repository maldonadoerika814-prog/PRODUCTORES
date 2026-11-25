/* ==========================================================================
   AgroDrone - Importador de Vuelos DJI SmartFarm (js/dji-import.js)
   Procesamiento de Excel (hoja "flight record") con SheetJS, agrupación por
   Fecha + Location, división por Plot ID, memorias y registro sin JS inline.
   ========================================================================== */

"use strict";

const DJI_REQUIRED_COLUMNS = [
  "Flight time",
  "Serial Number",
  "Plot ID",
  "Field Name",
  "Sprayed area"
];

function pad2(n) {
  return String(Math.trunc(Number(n) || 0)).padStart(2, "0");
}

function parseDjiFlightTimestamp(rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === "") {
    return { valid: false };
  }

  let y, m, d, hh = 0, mm = 0, ss = 0;
  let endHh = null, endMm = null, endSs = 0;

  if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
    if (window.XLSX && window.XLSX.SSF && typeof window.XLSX.SSF.parse_date_code === "function") {
      const parsed = window.XLSX.SSF.parse_date_code(rawVal);
      if (parsed && parsed.y && parsed.m && parsed.d) {
        y = parsed.y;
        m = parsed.m;
        d = parsed.d;
        hh = parsed.H || 0;
        mm = parsed.M || 0;
        ss = Math.round(parsed.S || 0);
      }
    }
    if (!y) {
      const ms = Math.round((rawVal - 25569) * 86400 * 1000);
      const dt = new Date(ms);
      if (!Number.isNaN(dt.getTime())) {
        y = dt.getUTCFullYear();
        m = dt.getUTCMonth() + 1;
        d = dt.getUTCDate();
        hh = dt.getUTCHours();
        mm = dt.getUTCMinutes();
        ss = dt.getUTCSeconds();
      }
    }
  } else if (rawVal instanceof Date && !Number.isNaN(rawVal.getTime())) {
    y = rawVal.getFullYear();
    m = rawVal.getMonth() + 1;
    d = rawVal.getDate();
    hh = rawVal.getHours();
    mm = rawVal.getMinutes();
    ss = rawVal.getSeconds();
  } else {
    const str = String(rawVal).trim();
    let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*[-–]\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?)?/.exec(str);
    if (match) {
      y = parseInt(match[1], 10);
      m = parseInt(match[2], 10);
      d = parseInt(match[3], 10);
      hh = parseInt(match[4] || "0", 10);
      mm = parseInt(match[5] || "0", 10);
      ss = parseInt(match[6] || "0", 10);
      if (match[7] !== undefined && match[8] !== undefined) {
        endHh = parseInt(match[7], 10);
        endMm = parseInt(match[8], 10);
        endSs = parseInt(match[9] || "0", 10);
      }
    } else {
      match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*[-–]\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?)?/.exec(str);
      if (match) {
        d = parseInt(match[1], 10);
        m = parseInt(match[2], 10);
        y = parseInt(match[3], 10);
        hh = parseInt(match[4] || "0", 10);
        mm = parseInt(match[5] || "0", 10);
        ss = parseInt(match[6] || "0", 10);
        if (match[7] !== undefined && match[8] !== undefined) {
          endHh = parseInt(match[7], 10);
          endMm = parseInt(match[8], 10);
          endSs = parseInt(match[9] || "0", 10);
        }
      }
    }
  }

  if (!y || !m || !d) return { valid: false };
  const startUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  if (Number.isNaN(startUtc.getTime())) return { valid: false };

  const fy = startUtc.getUTCFullYear();
  const fm = startUtc.getUTCMonth() + 1;
  const fd = startUtc.getUTCDate();
  const fhh = startUtc.getUTCHours();
  const fmm = startUtc.getUTCMinutes();
  const fss = startUtc.getUTCSeconds();

  const dateStr = `${fy}-${pad2(fm)}-${pad2(fd)}`;
  if (!isValidDateStr(dateStr)) return { valid: false };

  let endUtc = startUtc;
  if (endHh !== null && endMm !== null) {
    const candidateEnd = new Date(Date.UTC(y, m - 1, d, endHh, endMm, endSs));
    if (!Number.isNaN(candidateEnd.getTime())) {
      endUtc = candidateEnd.getTime() < startUtc.getTime()
        ? new Date(candidateEnd.getTime() + 86400000)
        : candidateEnd;
    }
  }

  const ehh = endUtc.getUTCHours();
  const emm = endUtc.getUTCMinutes();
  const ess = endUtc.getUTCSeconds();

  return {
    valid: true,
    dateStr,
    canonicalTime: `${dateStr} ${pad2(fhh)}:${pad2(fmm)}:${pad2(fss)}`,
    startTimeShort: `${pad2(fhh)}:${pad2(fmm)}`,
    startTimeFull: `${pad2(fhh)}:${pad2(fmm)}:${pad2(fss)}`,
    endTimeShort: `${pad2(ehh)}:${pad2(emm)}`,
    endTimeFull: `${pad2(ehh)}:${pad2(emm)}:${pad2(ess)}`,
    timestampMs: startUtc.getTime(),
    endTimestampMs: endUtc.getTime()
  };
}

function parseDjiNumericMu(rawVal) {
  if (typeof rawVal === "number") {
    return Number.isFinite(rawVal) && rawVal >= 0 ? rawVal : 0;
  }
  const cleaned = String(rawVal === null || rawVal === undefined ? "" : rawVal)
    .trim()
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function parseDjiOptionalNumber(rawVal) {
  if (rawVal === null || rawVal === undefined) return null;
  if (typeof rawVal === "number") {
    return Number.isFinite(rawVal) && rawVal >= 0 ? rawVal : null;
  }
  const trimmed = String(rawVal).trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(",", ".").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function makeDjiFlightKey(canonicalTime, serialNumber) {
  return `${String(canonicalTime || "").trim()}|${String(serialNumber || "").trim()}`;
}

function pickMostFrequentString(values) {
  const counts = new Map();
  let best = "";
  let bestCount = 0;
  (values || []).forEach(v => {
    const clean = String(v || "").trim();
    if (!clean) return;
    const next = (counts.get(clean) || 0) + 1;
    counts.set(clean, next);
    if (next > bestCount) {
      best = clean;
      bestCount = next;
    }
  });
  return best;
}

function buildDjiReviewRow(flights, opts) {
  let rawMuSum = 0;
  let productAmountSum = 0;
  let productAmountCount = 0;
  let minStartMs = Infinity;
  let startTimeShort = "";
  let startTimeFull = "";
  let maxEndMs = -Infinity;
  let endTimeShort = "";
  let endTimeFull = "";

  const plotIdsSet = new Set();
  const fieldNamesSet = new Set();
  const serialNumbersSet = new Set();
  const flightKeys = [];
  const pilots = [];
  const aircrafts = [];
  let noPlotFlightCount = 0;

  flights.forEach(fl => {
    rawMuSum += fl.mu;
    if (fl.totalAmount !== null && fl.totalAmount !== undefined) {
      productAmountSum += fl.totalAmount;
      productAmountCount++;
    }
    if (fl.timestampMs < minStartMs) {
      minStartMs = fl.timestampMs;
      startTimeShort = fl.startTimeShort;
      startTimeFull = fl.startTimeFull;
    }
    if (fl.endTimestampMs > maxEndMs) {
      maxEndMs = fl.endTimestampMs;
      endTimeShort = fl.endTimeShort;
      endTimeFull = fl.endTimeFull;
    }
    if (fl.plotId) plotIdsSet.add(fl.plotId);
    else noPlotFlightCount++;
    if (fl.fieldName) fieldNamesSet.add(fl.fieldName);
    if (fl.serialNumber) serialNumbersSet.add(fl.serialNumber);
    flightKeys.push(fl.flightKey);
    if (fl.pilotName) pilots.push(fl.pilotName);
    if (fl.aircraftName) aircrafts.push(fl.aircraftName);
  });

  const plotIds = Array.from(plotIdsSet).sort();
  const plotId = opts.plotIdOverride !== undefined
    ? opts.plotIdOverride
    : (plotIds.length === 1 ? plotIds[0] : "");

  const usePlotMemory = Boolean(opts.usePlotMemory);
  let rememberedFarmId = "";
  if (usePlotMemory) {
    if (plotId && state.dji.plotMemory && state.dji.plotMemory[plotId] && getFarmById(state.dji.plotMemory[plotId])) {
      rememberedFarmId = state.dji.plotMemory[plotId];
    }
  } else {
    const locKey = opts.locationKey || "";
    if (locKey && locKey !== "__sin_ubicacion__" && state.dji.locationMemory && state.dji.locationMemory[locKey] && getFarmById(state.dji.locationMemory[locKey])) {
      rememberedFarmId = state.dji.locationMemory[locKey];
    }
  }

  const totalProductAmount = productAmountCount > 0 ? roundMoney(productAmountSum) : 0;

  return {
    rowId: opts.rowId,
    groupId: opts.groupId,
    dateStr: opts.dateStr,
    locationDisplay: opts.locationDisplay || "Sin ubicación",
    locationKey: opts.locationKey || "",
    usePlotMemory,
    isSplitChild: Boolean(opts.isSplitChild),
    isNoPlotRow: Boolean(opts.isNoPlotRow),
    canSplit: Boolean(opts.canSplit),
    plotId,
    plotIds,
    noPlotFlightCount,
    fieldName: Array.from(fieldNamesSet).join(", "),
    pilotName: pickMostFrequentString(pilots),
    aircraftName: pickMostFrequentString(aircrafts),
    hasProductAmount: productAmountCount > 0 && totalProductAmount > 0,
    totalProductAmount,
    flightCount: flights.length,
    totalMu: Math.round((rawMuSum + Number.EPSILON) * 100) / 100,
    hectares: roundHectares(rawMuSum / 15),
    minStartMs: Number.isFinite(minStartMs) ? minStartMs : 0,
    startTimeShort,
    startTimeFull,
    endTimeShort,
    endTimeFull,
    flightKeys,
    serialNumbers: Array.from(serialNumbersSet),
    selectedFarmId: rememberedFarmId,
    fromMemory: Boolean(rememberedFarmId),
    included: Boolean(rememberedFarmId),
    registered: false
  };
}

function parseDjiWorkbook(workbook, fileName = "Excel DJI") {
  if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    return { ok: false, error: "El archivo Excel no contiene hojas válidas." };
  }

  const targetSheetName = workbook.SheetNames.find(
    name => String(name || "").trim().toLowerCase() === "flight record"
  );
  if (!targetSheetName) {
    return {
      ok: false,
      error: `No se encontró la hoja "flight record" en el archivo. Hojas disponibles: ${workbook.SheetNames.join(", ")}.`
    };
  }

  const sheet = workbook.Sheets[targetSheetName];
  const rawRows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { ok: false, error: 'La hoja "flight record" está vacía.' };
  }

  const headerRow = Array.isArray(rawRows[0]) ? rawRows[0] : [];
  const headerIndexMap = {};
  headerRow.forEach((cell, idx) => {
    const key = String(cell === null || cell === undefined ? "" : cell).trim().toLowerCase();
    if (key && !(key in headerIndexMap)) {
      headerIndexMap[key] = idx;
    }
  });

  const missingColumns = DJI_REQUIRED_COLUMNS.filter(
    col => !(col.toLowerCase() in headerIndexMap)
  );
  if (missingColumns.length > 0) {
    return {
      ok: false,
      missingColumns,
      error: `Faltan columna(s) requerida(s) en la primera fila de "flight record": ${missingColumns.join(", ")}.`
    };
  }

  const idxFlightTime = headerIndexMap["flight time"];
  const idxSerial = headerIndexMap["serial number"];
  const idxPlotId = headerIndexMap["plot id"];
  const idxFieldName = headerIndexMap["field name"];
  const idxSprayedArea = headerIndexMap["sprayed area"];

  const idxLocation = headerIndexMap["location"];
  const hasLocationColumn = idxLocation !== undefined;
  const idxPilotName = headerIndexMap["pliot name"] !== undefined
    ? headerIndexMap["pliot name"]
    : headerIndexMap["pilot name"];
  const idxAircraftName = headerIndexMap["aircraft name"];
  const idxTotalAmount = headerIndexMap["total amount(l/kg)"] !== undefined
    ? headerIndexMap["total amount(l/kg)"]
    : headerIndexMap["total amount (l/kg)"];

  const existingKeys = new Set(state.dji.importedFlightKeys || []);
  const seenInFile = new Set();

  let flightsRead = 0;
  let duplicatesSkipped = 0;
  let invalidRowsSkipped = 0;
  const validFlights = [];

  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;
    const hasAnyValue = row.some(v => String(v === null || v === undefined ? "" : v).trim() !== "");
    if (!hasAnyValue) continue;

    flightsRead++;

    const timeInfo = parseDjiFlightTimestamp(row[idxFlightTime]);
    const serialNumber = String(row[idxSerial] === null || row[idxSerial] === undefined ? "" : row[idxSerial]).trim();
    const plotId = String(row[idxPlotId] === null || row[idxPlotId] === undefined ? "" : row[idxPlotId]).trim();
    const fieldName = String(row[idxFieldName] === null || row[idxFieldName] === undefined ? "" : row[idxFieldName]).trim();
    const mu = parseDjiNumericMu(row[idxSprayedArea]);
    const locationDisplay = hasLocationColumn ? normalizeDjiLocationDisplay(row[idxLocation]) : "";
    const locationKey = hasLocationColumn ? normalizeDjiLocationKey(row[idxLocation]) : "";
    const pilotName = idxPilotName !== undefined
      ? String(row[idxPilotName] === null || row[idxPilotName] === undefined ? "" : row[idxPilotName]).trim()
      : "";
    const aircraftName = idxAircraftName !== undefined
      ? String(row[idxAircraftName] === null || row[idxAircraftName] === undefined ? "" : row[idxAircraftName]).trim()
      : "";
    const totalAmount = idxTotalAmount !== undefined ? parseDjiOptionalNumber(row[idxTotalAmount]) : null;

    if (!timeInfo.valid || !serialNumber) {
      invalidRowsSkipped++;
      continue;
    }

    const flightKey = makeDjiFlightKey(timeInfo.canonicalTime, serialNumber);
    if (existingKeys.has(flightKey) || seenInFile.has(flightKey)) {
      duplicatesSkipped++;
      continue;
    }
    seenInFile.add(flightKey);

    validFlights.push({
      dateStr: timeInfo.dateStr,
      canonicalTime: timeInfo.canonicalTime,
      startTimeShort: timeInfo.startTimeShort,
      startTimeFull: timeInfo.startTimeFull,
      endTimeShort: timeInfo.endTimeShort,
      endTimeFull: timeInfo.endTimeFull,
      timestampMs: timeInfo.timestampMs,
      endTimestampMs: timeInfo.endTimestampMs,
      serialNumber,
      plotId,
      fieldName,
      mu,
      locationDisplay,
      locationKey,
      pilotName,
      aircraftName,
      totalAmount,
      flightKey
    });
  }

  const groupsMap = new Map();
  const groupsById = {};
  let groupSeq = 1;
  let nextRowSeq = 1;

  if (hasLocationColumn) {
    validFlights.forEach(fl => {
      const safeLocKey = fl.locationKey || "__sin_ubicacion__";
      const safeLocDisplay = fl.locationDisplay || "Sin ubicación";
      const mapKey = `${fl.dateStr}||${safeLocKey}`;
      if (!groupsMap.has(mapKey)) {
        const groupId = `dji-grp-${groupSeq++}`;
        const grp = {
          groupId,
          dateStr: fl.dateStr,
          locationDisplay: safeLocDisplay,
          locationKey: safeLocKey,
          flights: []
        };
        groupsMap.set(mapKey, grp);
        groupsById[groupId] = grp;
      }
      groupsMap.get(mapKey).flights.push(fl);
    });
  } else {
    validFlights.forEach(fl => {
      const safePlotKey = fl.plotId || "__SIN_LOTE__";
      const mapKey = `${fl.dateStr}||${safePlotKey}`;
      if (!groupsMap.has(mapKey)) {
        const groupId = `dji-grp-${groupSeq++}`;
        const grp = {
          groupId,
          dateStr: fl.dateStr,
          locationDisplay: fl.plotId ? `Plot ID: ${fl.plotId}` : "Sin lote",
          locationKey: "",
          plotId: fl.plotId || "",
          flights: []
        };
        groupsMap.set(mapKey, grp);
        groupsById[groupId] = grp;
      }
      groupsMap.get(mapKey).flights.push(fl);
    });
  }

  const rows = Array.from(groupsMap.values())
    .map(grp => {
      const uniquePlots = Array.from(new Set(grp.flights.map(f => f.plotId).filter(Boolean)));
      const canSplit = hasLocationColumn && uniquePlots.length > 1;
      return buildDjiReviewRow(grp.flights, {
        rowId: `dji-row-${nextRowSeq++}`,
        groupId: grp.groupId,
        dateStr: grp.dateStr,
        locationDisplay: grp.locationDisplay,
        locationKey: grp.locationKey,
        usePlotMemory: !hasLocationColumn,
        isSplitChild: false,
        isNoPlotRow: !hasLocationColumn && !grp.plotId,
        plotIdOverride: !hasLocationColumn ? (grp.plotId || "") : undefined,
        canSplit
      });
    })
    .sort((a, b) =>
      a.dateStr.localeCompare(b.dateStr) ||
      a.minStartMs - b.minStartMs ||
      a.locationDisplay.localeCompare(b.locationDisplay) ||
      a.plotId.localeCompare(b.plotId)
    );

  const warning = !hasLocationColumn
    ? 'Aviso: el archivo no contiene la columna "Location". Se agruparon los vuelos por fecha y Plot ID.'
    : "";

  return {
    ok: true,
    fileName,
    hasLocationColumn,
    warning,
    flightsRead,
    duplicatesSkipped,
    invalidRowsSkipped,
    registeredRowsCount: 0,
    registeredHectares: 0,
    nextRowSeq,
    groupsById,
    rows
  };
}

function handleDjiExcelUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (typeof window.XLSX === "undefined") {
    showDjiError("No se pudo cargar la librería SheetJS (xlsx). Verifica tu conexión a internet y recarga la página.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = window.XLSX.read(data, { type: "array" });
      const parsed = parseDjiWorkbook(workbook, file.name);
      if (!parsed.ok) {
        djiImportSession = null;
        showDjiError(parsed.error);
        hideDjiWarning();
        document.getElementById("djiReviewWrapper").classList.add("hidden");
        document.getElementById("djiSummaryBox").classList.add("hidden");
        showToast(parsed.error, "error");
        return;
      }

      hideDjiError();
      djiImportSession = parsed;
      if (parsed.warning) {
        showDjiWarning(parsed.warning);
      } else {
        hideDjiWarning();
      }
      renderDjiTab();

      if (parsed.rows.length === 0) {
        showToast(
          parsed.duplicatesSkipped > 0
            ? `Todos los vuelos (${parsed.duplicatesSkipped}) ya habían sido importados anteriormente.`
            : "No se encontraron vuelos válidos para importar en el archivo.",
          "info"
        );
      } else if (parsed.warning) {
        showToast(`${parsed.warning} (${parsed.rows.length} fila(s)).`, "warning");
      } else {
        showToast(`Excel leído: ${parsed.flightsRead} vuelo(s) en ${parsed.rows.length} fila(s) agrupadas.`, "success");
      }
    } catch (err) {
      djiImportSession = null;
      showDjiError("Error al leer el archivo Excel. Verifica que sea un archivo .xlsx o .xls válido de DJI SmartFarm.");
      hideDjiWarning();
      showToast("No se pudo leer el archivo Excel.", "error");
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = "";
}

function showDjiError(message) {
  const box = document.getElementById("djiErrorBox");
  if (!box) return;
  box.innerHTML = `<div class="font-bold text-rose-300">Error al leer el Excel de vuelos DJI</div><div>${escapeHtml(message)}</div>`;
  box.classList.remove("hidden");
}

function hideDjiError() {
  const box = document.getElementById("djiErrorBox");
  if (box) {
    box.innerHTML = "";
    box.classList.add("hidden");
  }
}

function showDjiWarning(message) {
  const box = document.getElementById("djiWarningBox");
  if (!box) return;
  box.innerHTML = `<div class="font-bold text-amber-300">Advertencia de columnas</div><div>${escapeHtml(message)}</div>`;
  box.classList.remove("hidden");
}

function hideDjiWarning() {
  const box = document.getElementById("djiWarningBox");
  if (box) {
    box.innerHTML = "";
    box.classList.add("hidden");
  }
}

function clearDjiPreview() {
  djiImportSession = null;
  hideDjiError();
  hideDjiWarning();
  const prodInput = document.getElementById("djiProductNameInput");
  const doseInput = document.getElementById("djiProductDoseInput");
  if (prodInput) prodInput.value = "";
  if (doseInput) doseInput.value = "";
  renderDjiTab();
}

function splitDjiGroupByPlot(groupId) {
  if (!djiImportSession || !djiImportSession.groupsById || !djiImportSession.groupsById[groupId]) return;
  const grp = djiImportSession.groupsById[groupId];
  const rowIndex = djiImportSession.rows.findIndex(r => r.groupId === groupId && !r.isSplitChild && !r.registered);
  if (rowIndex === -1) return;

  const byPlot = new Map();
  const withoutPlot = [];
  grp.flights.forEach(fl => {
    if (fl.plotId) {
      if (!byPlot.has(fl.plotId)) byPlot.set(fl.plotId, []);
      byPlot.get(fl.plotId).push(fl);
    } else {
      withoutPlot.push(fl);
    }
  });

  const childRows = [];
  Array.from(byPlot.entries()).forEach(([plotId, fls]) => {
    childRows.push(buildDjiReviewRow(fls, {
      rowId: `dji-row-${djiImportSession.nextRowSeq++}`,
      groupId,
      dateStr: grp.dateStr,
      locationDisplay: grp.locationDisplay,
      locationKey: grp.locationKey,
      usePlotMemory: true,
      isSplitChild: true,
      isNoPlotRow: false,
      plotIdOverride: plotId,
      canSplit: false
    }));
  });
  childRows.sort((a, b) => a.minStartMs - b.minStartMs || a.plotId.localeCompare(b.plotId));

  if (withoutPlot.length > 0) {
    childRows.push(buildDjiReviewRow(withoutPlot, {
      rowId: `dji-row-${djiImportSession.nextRowSeq++}`,
      groupId,
      dateStr: grp.dateStr,
      locationDisplay: grp.locationDisplay,
      locationKey: grp.locationKey,
      usePlotMemory: true,
      isSplitChild: true,
      isNoPlotRow: true,
      plotIdOverride: "",
      canSplit: false
    }));
  }

  djiImportSession.rows.splice(rowIndex, 1, ...childRows);
  renderDjiSummary();
  renderDjiReviewTable();
  safeRefreshIcons();
}

function rejoinDjiGroup(groupId) {
  if (!djiImportSession || !djiImportSession.groupsById || !djiImportSession.groupsById[groupId]) return;
  const grp = djiImportSession.groupsById[groupId];
  const groupRows = djiImportSession.rows.filter(r => r.groupId === groupId);
  if (groupRows.length === 0) return;
  if (groupRows.some(r => r.registered)) {
    showToast("No se puede volver a unir porque al menos un lote de este grupo ya fue registrado.", "warning");
    return;
  }

  const firstIdx = djiImportSession.rows.findIndex(r => r.groupId === groupId);
  const uniquePlots = Array.from(new Set(grp.flights.map(f => f.plotId).filter(Boolean)));
  const mergedRow = buildDjiReviewRow(grp.flights, {
    rowId: `dji-row-${djiImportSession.nextRowSeq++}`,
    groupId,
    dateStr: grp.dateStr,
    locationDisplay: grp.locationDisplay,
    locationKey: grp.locationKey,
    usePlotMemory: false,
    isSplitChild: false,
    isNoPlotRow: false,
    canSplit: uniquePlots.length > 1
  });

  const remaining = djiImportSession.rows.filter(r => r.groupId !== groupId);
  remaining.splice(firstIdx, 0, mergedRow);
  djiImportSession.rows = remaining;

  renderDjiSummary();
  renderDjiReviewTable();
  safeRefreshIcons();
}

function renderDjiTab() {
  const defaultsEl = document.getElementById("djiDefaultsInfo");
  if (defaultsEl) {
    const defPilot = (state.config.pilots && state.config.pilots[0]) || "Juan Diego Cobos Anguisaca";
    const defDrone = (state.config.drones && state.config.drones[0]) || "Alfa_3";
    const clientRate = Number.isFinite(state.config.clientRatePerHa) ? state.config.clientRatePerHa : 15;
    defaultsEl.textContent = `Estado: Realizada • Pago: Pendiente • Piloto/Dron del Excel (respaldo: ${defPilot} / ${defDrone}) • Tarifa: ${formatMoney(clientRate)}/ha`;
  }

  if (djiImportSession && djiImportSession.warning) {
    showDjiWarning(djiImportSession.warning);
  } else {
    hideDjiWarning();
  }

  renderDjiSummary();
  renderDjiReviewTable();
  renderDjiMemories();
  safeRefreshIcons();
}

function renderDjiSummary() {
  const summaryBox = document.getElementById("djiSummaryBox");
  if (!summaryBox) return;

  if (!djiImportSession) {
    summaryBox.classList.add("hidden");
    return;
  }

  summaryBox.classList.remove("hidden");
  const pendingRows = djiImportSession.rows.filter(r => !r.registered);
  const unassignedCount = pendingRows.filter(r => !r.selectedFarmId).length;
  const totalHaDisplay = djiImportSession.registeredRowsCount > 0 && pendingRows.length === 0
    ? djiImportSession.registeredHectares
    : roundHectares(pendingRows.reduce((acc, r) => acc + r.hectares, 0));

  document.getElementById("djiSumFlightsRead").textContent = djiImportSession.flightsRead;
  document.getElementById("djiSumDuplicates").textContent = djiImportSession.duplicatesSkipped;
  document.getElementById("djiSumRegistered").textContent = djiImportSession.registeredRowsCount;
  document.getElementById("djiSumHectares").textContent = `${formatHectares(totalHaDisplay)} ha`;
  document.getElementById("djiSumUnassigned").textContent = unassignedCount;
}

function renderDjiReviewTable() {
  const wrapper = document.getElementById("djiReviewWrapper");
  const tbody = document.getElementById("djiReviewTableBody");
  if (!wrapper || !tbody) return;

  if (!djiImportSession) {
    wrapper.classList.add("hidden");
    tbody.innerHTML = "";
    return;
  }

  wrapper.classList.remove("hidden");
  const fileNameEl = document.getElementById("djiLoadedFileName");
  if (fileNameEl) fileNameEl.textContent = `Archivo: ${djiImportSession.fileName}`;

  const pendingRows = djiImportSession.rows.filter(r => !r.registered);
  const regBtn = document.getElementById("djiRegisterBtn");

  if (pendingRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-6 text-center text-xs text-slate-300">
          ${djiImportSession.registeredRowsCount > 0
            ? `Todas las filas asignadas fueron registradas (${djiImportSession.registeredRowsCount} fumigación(es), ${formatHectares(djiImportSession.registeredHectares)} ha).`
            : "No hay filas nuevas pendientes por registrar (todos los vuelos ya estaban importados o el archivo no tenía vuelos válidos)."}
        </td>
      </tr>
    `;
    if (regBtn) regBtn.disabled = true;
    return;
  }

  if (regBtn) regBtn.disabled = isRegisteringDjiRows;

  const farms = getAllFarms();
  const clientRate = Number.isFinite(state.config.clientRatePerHa) ? state.config.clientRatePerHa : 15;
  const farmOptionsHtml = farms.map(f => {
    const p = getProducerByFarmId(f.id);
    return `<option value="${escapeHtml(f.id)}">${escapeHtml(p ? p.name : "Productor")} — ${escapeHtml(f.name)} (${escapeHtml(f.crop)})</option>`;
  }).join("");

  const registeredGroupIds = new Set(
    djiImportSession.rows.filter(r => r.registered).map(r => r.groupId)
  );
  const seenSplitGroups = new Set();

  tbody.innerHTML = pendingRows.map(row => {
    const estAmount = roundMoney(row.hectares * clientRate);
    const isUnassigned = !row.selectedFarmId;

    const badges = [];
    if (row.isSplitChild) {
      badges.push(`<span class="px-2 py-0.5 rounded bg-brand-blue/20 text-brand-blue border border-brand-blue/35 text-[10px] font-bold">Separado por lote</span>`);
    }
    if (row.isNoPlotRow) {
      badges.push(`<span class="px-2 py-0.5 rounded bg-slate-700/80 text-slate-200 border border-slate-500 text-[10px] font-bold">Sin lote</span>`);
    }
    if (row.fromMemory && row.selectedFarmId) {
      badges.push(`<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-brand-accent border border-emerald-500/35 text-[10px] font-bold">Recordado</span>`);
    } else if (isUnassigned) {
      badges.push(`<span class="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/35 text-[10px] font-bold">Sin asignar</span>`);
    }

    let plotSummaryHtml = "";
    if (row.isNoPlotRow) {
      plotSummaryHtml = `<div class="text-[11px] text-slate-400 mt-1">Plot ID: <span class="italic text-slate-300">Sin lote (vuelos sin Plot ID)</span></div>`;
    } else if (row.plotIds && row.plotIds.length > 0) {
      const plotChips = row.plotIds.map(pid =>
        `<span class="inline-block font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-brand-blue/30 text-brand-blue" title="${escapeHtml(pid)}">${escapeHtml(pid)}</span>`
      ).join(" ");
      const extraNoPlot = row.noPlotFlightCount > 0
        ? `<span class="text-[10px] text-slate-400">(+${row.noPlotFlightCount} sin Plot ID)</span>`
        : "";
      plotSummaryHtml = `<div class="flex flex-wrap items-center gap-1 mt-1"><span class="text-[10px] text-slate-400 font-semibold">Plot ID:</span> ${plotChips} ${extraNoPlot}</div>`;
    } else {
      plotSummaryHtml = `<div class="text-[11px] text-slate-400 mt-1">Plot ID: <span class="italic">Sin Plot ID</span></div>`;
    }

    let splitActionHtml = "";
    if (row.canSplit && !row.isSplitChild) {
      splitActionHtml = `
        <button type="button" data-action="split-dji-group" data-group-id="${escapeHtml(row.groupId)}" class="mt-1.5 inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-brand-blue/15 hover:bg-brand-blue/30 text-brand-blue border border-brand-blue/40 text-[11px] font-bold">
          <i data-lucide="split" class="w-3.5 h-3.5"></i>
          <span>Separar por lote (${row.plotIds.length} lotes)</span>
        </button>
      `;
    } else if (row.isSplitChild && !registeredGroupIds.has(row.groupId) && !seenSplitGroups.has(row.groupId)) {
      seenSplitGroups.add(row.groupId);
      splitActionHtml = `
        <button type="button" data-action="rejoin-dji-group" data-group-id="${escapeHtml(row.groupId)}" class="mt-1.5 inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold">
          <i data-lucide="merge" class="w-3.5 h-3.5"></i>
          <span>Volver a unir</span>
        </button>
      `;
    }

    const pilotDroneMeta = [];
    if (row.pilotName) pilotDroneMeta.push(`Piloto: ${escapeHtml(row.pilotName)}`);
    if (row.aircraftName) pilotDroneMeta.push(`Dron: ${escapeHtml(row.aircraftName)}`);
    if (row.fieldName) pilotDroneMeta.push(`Field: ${escapeHtml(row.fieldName)}`);

    const timeRangeShort = row.startTimeShort && row.endTimeShort
      ? `${row.startTimeShort} – ${row.endTimeShort}`
      : (row.startTimeShort || "");
    const timeRangeFull = row.startTimeFull && row.endTimeFull
      ? `${row.startTimeFull} a ${row.endTimeFull}`
      : "";

    const selectHtml = `
      <select data-change="dji-row-farm" data-row-id="${escapeHtml(row.rowId)}" class="w-full min-w-[220px] px-2.5 py-2 rounded-xl bg-slate-900 border ${isUnassigned ? "border-amber-500/50 text-amber-200" : "border-brand-accent/45 text-white"} text-xs font-semibold">
        <option value="">-- Sin asignar (elegir Productor / Finca) --</option>
        ${farmOptionsHtml}
      </select>
    `;

    return `
      <tr class="hover:bg-slate-900/55 transition-colors ${row.isSplitChild ? "bg-slate-900/35" : ""}" data-dji-row="${escapeHtml(row.rowId)}">
        <td class="py-3 px-3 text-center">
          <input type="checkbox" ${row.included ? "checked" : ""} ${isUnassigned ? "disabled" : ""} data-change="dji-row-included" data-row-id="${escapeHtml(row.rowId)}" class="w-4 h-4 accent-emerald-400 cursor-pointer disabled:opacity-40">
        </td>
        <td class="py-3 px-3 whitespace-nowrap">
          <div class="font-bold text-white">${escapeHtml(row.dateStr)}</div>
          <div class="text-[11px] text-slate-400">${formatDisplayDate(row.dateStr, true)}</div>
          ${timeRangeShort ? `<div class="text-[11px] font-mono text-brand-blue mt-0.5" title="${escapeHtml(timeRangeFull)}">${escapeHtml(timeRangeShort)}</div>` : ""}
        </td>
        <td class="py-3 px-3">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="font-bold text-white">${escapeHtml(row.locationDisplay)}</span>
            ${badges.join(" ")}
          </div>
          ${plotSummaryHtml}
          ${pilotDroneMeta.length > 0 ? `<div class="text-[11px] text-slate-400 mt-1">${pilotDroneMeta.join(" • ")}</div>` : ""}
          ${splitActionHtml}
        </td>
        <td class="py-3 px-3 whitespace-nowrap">
          <div class="font-bold text-white">${row.flightCount} ${row.flightCount === 1 ? "vuelo" : "vuelos"}</div>
          <div class="text-[11px] text-slate-400">${row.totalMu.toFixed(2)} mu</div>
          ${row.hasProductAmount ? `<div class="text-[11px] text-brand-blue font-mono">${row.totalProductAmount.toFixed(2)} L/Kg</div>` : ""}
        </td>
        <td class="py-3 px-3 whitespace-nowrap">
          <div class="font-extrabold text-brand-accent">${formatHectares(row.hectares)} ha</div>
          <div class="text-[11px] text-slate-300">${formatMoney(estAmount)}</div>
        </td>
        <td class="py-3 px-3">
          ${selectHtml}
        </td>
      </tr>
    `;
  }).join("");

  pendingRows.forEach(row => {
    const tr = tbody.querySelector(`tr[data-dji-row="${row.rowId}"]`);
    if (tr) {
      const sel = tr.querySelector("select");
      if (sel) sel.value = row.selectedFarmId || "";
    }
  });
}

function onDjiRowFarmChanged(rowId, farmId) {
  if (!djiImportSession) return;
  const row = djiImportSession.rows.find(r => r.rowId === rowId);
  if (!row) return;

  row.selectedFarmId = farmId || "";
  row.included = Boolean(farmId);
  row.fromMemory = false;

  if (farmId) {
    if (row.usePlotMemory) {
      if (row.plotId) {
        state.dji.plotMemory[row.plotId] = farmId;
        djiImportSession.rows.forEach(other => {
          if (!other.registered && other.rowId !== rowId && other.usePlotMemory && other.plotId === row.plotId && !other.selectedFarmId) {
            other.selectedFarmId = farmId;
            other.included = true;
            other.fromMemory = true;
          }
        });
        saveState(true);
      }
    } else if (row.locationKey && row.locationKey !== "__sin_ubicacion__") {
      state.dji.locationMemory[row.locationKey] = farmId;
      djiImportSession.rows.forEach(other => {
        if (!other.registered && other.rowId !== rowId && !other.usePlotMemory && other.locationKey === row.locationKey && !other.selectedFarmId) {
          other.selectedFarmId = farmId;
          other.included = true;
          other.fromMemory = true;
        }
      });
      saveState(true);
    }
  }

  renderDjiSummary();
  renderDjiReviewTable();
  renderDjiMemories();
  safeRefreshIcons();
}

function onDjiRowIncludedChanged(rowId, checked) {
  if (!djiImportSession) return;
  const row = djiImportSession.rows.find(r => r.rowId === rowId);
  if (!row) return;
  row.included = Boolean(checked && row.selectedFarmId);
}

function registerDjiImportedRows() {
  if (isRegisteringDjiRows) return;
  if (!djiImportSession) {
    showToast("Primero carga un archivo Excel de vuelos DJI.", "warning");
    return;
  }

  const rowsToRegister = djiImportSession.rows.filter(
    r => !r.registered && r.included && r.selectedFarmId && getFarmById(r.selectedFarmId)
  );

  if (rowsToRegister.length === 0) {
    showToast("Asigna al menos una fila a un Productor/Finca antes de registrar.", "warning");
    return;
  }

  const duplicateAlerts = [];
  rowsToRegister.forEach(row => {
    const hasSameDaySpray = state.sprays.some(
      sp => sp.farmId === row.selectedFarmId && sp.date === row.dateStr && sp.status === "Realizada"
    );
    if (hasSameDaySpray) {
      const farm = getFarmById(row.selectedFarmId);
      duplicateAlerts.push(`${farm ? farm.name : row.selectedFarmId} (${row.dateStr})`);
    }
  });

  if (duplicateAlerts.length > 0) {
    openConfirmModal(
      "Posible fumigación duplicada",
      `Las siguientes fincas ya tienen una fumigación "Realizada" ese mismo día: ${duplicateAlerts.join(", ")}. ¿Deseas registrar estas filas de todas formas?`,
      () => executeDjiRegistration(rowsToRegister),
      "Sí, registrar de todas formas",
      false
    );
    return;
  }

  executeDjiRegistration(rowsToRegister);
}

function executeDjiRegistration(rowsToRegister) {
  if (isRegisteringDjiRows || !djiImportSession) return;
  isRegisteringDjiRows = true;

  const regBtn = document.getElementById("djiRegisterBtn");
  if (regBtn) regBtn.disabled = true;

  try {
    const pendingToSave = (rowsToRegister || []).filter(
      r => !r.registered && r.included && r.selectedFarmId && getFarmById(r.selectedFarmId)
    );
    if (pendingToSave.length === 0) return;

    const defaultPilot = (state.config.pilots && state.config.pilots[0]) || "Juan Diego Cobos Anguisaca";
    const defaultDrone = (state.config.drones && state.config.drones[0]) || "Alfa_3";
    const clientRate = Number.isFinite(state.config.clientRatePerHa) ? state.config.clientRatePerHa : 15;
    const pilotRate = Number.isFinite(state.config.pilotRatePerHa) ? state.config.pilotRatePerHa : 4.5;

    const customProductInput = document.getElementById("djiProductNameInput");
    const customDoseInput = document.getElementById("djiProductDoseInput");
    const customProduct = customProductInput ? customProductInput.value.trim() : "";
    const customDose = customDoseInput ? customDoseInput.value.trim() : "";
    const productName = customProduct || "Aplicación DJI SmartFarm";

    const existingKeysSet = new Set(state.dji.importedFlightKeys || []);
    const touchedFarmIds = new Set();
    let newlyRegisteredCount = 0;
    let newlyRegisteredHa = 0;

    pendingToSave.forEach(row => {
      const farm = getFarmById(row.selectedFarmId);
      if (!farm) return;

      const ha = roundHectares(row.hectares);
      const amount = roundMoney(ha * clientRate);
      const pilotPay = roundMoney(ha * pilotRate);
      const orderNumber = generateNextOrderNumber(row.dateStr);

      const pilot = row.pilotName || defaultPilot;
      const drone = row.aircraftName || defaultDrone;

      if (row.pilotName && !state.config.pilots.includes(row.pilotName)) {
        state.config.pilots.push(row.pilotName);
      }
      if (row.aircraftName && !state.config.drones.includes(row.aircraftName)) {
        state.config.drones.push(row.aircraftName);
      }

      const totalVolume = row.hasProductAmount
        ? `${row.totalProductAmount.toFixed(2)} L/Kg`
        : "";

      const noteParts = [
        "Importado DJI SmartFarm",
        row.locationDisplay && row.locationDisplay !== "Sin ubicación" ? `Ubicación: ${row.locationDisplay}` : "",
        row.startTimeShort && row.endTimeShort ? `Horario: ${row.startTimeShort}-${row.endTimeShort}` : "",
        row.plotIds && row.plotIds.length > 0 ? `Plot ID: ${row.plotIds.join(", ")}` : "Sin lote",
        `${row.flightCount} vuelo(s) (${row.totalMu.toFixed(2)} mu)`
      ].filter(Boolean);
      if (row.fieldName) noteParts.push(`Lote: ${row.fieldName}`);

      const flightKeysCopy = Array.from(row.flightKeys || []);

      state.sprays.unshift({
        id: generateUid("sp-dji"),
        orderNumber,
        farmId: row.selectedFarmId,
        date: row.dateStr,
        status: "Realizada",
        rescheduleDescription: "",
        hectares: ha,
        product: productName,
        products: [{
          commercialName: productName,
          activeIngredient: "",
          dosePerHa: customDose,
          totalVolume,
          batchLot: ""
        }],
        drone,
        pilot,
        pilotPay,
        pilotPaid: false,
        notes: noteParts.join(" • "),
        amount,
        amountPaid: 0,
        payMethod: "Transferencia",
        payRef: "",
        payBank: "",
        payStatus: "Pendiente",
        djiFlightKeys: flightKeysCopy
      });

      if (row.usePlotMemory) {
        if (row.plotId) {
          state.dji.plotMemory[row.plotId] = row.selectedFarmId;
        }
      } else if (row.locationKey && row.locationKey !== "__sin_ubicacion__") {
        state.dji.locationMemory[row.locationKey] = row.selectedFarmId;
      }

      flightKeysCopy.forEach(k => existingKeysSet.add(k));

      row.registered = true;
      touchedFarmIds.add(row.selectedFarmId);
      newlyRegisteredCount++;
      newlyRegisteredHa = roundHectares(newlyRegisteredHa + ha);
    });

    state.dji.importedFlightKeys = Array.from(existingKeysSet);

    touchedFarmIds.forEach(farmId => {
      syncFarmLastSprayFromHistory(farmId);
    });

    djiImportSession.registeredRowsCount += newlyRegisteredCount;
    djiImportSession.registeredHectares = roundHectares(djiImportSession.registeredHectares + newlyRegisteredHa);

    saveState(true);
    refreshAllViews();

    const stillUnassigned = djiImportSession.rows.filter(r => !r.registered && !r.selectedFarmId).length;
    showToast(
      `Registradas ${newlyRegisteredCount} fumigación(es) (${formatHectares(newlyRegisteredHa)} ha).` +
        (stillUnassigned > 0 ? ` Quedan ${stillUnassigned} fila(s) sin asignar.` : ""),
      "success"
    );
  } finally {
    isRegisteringDjiRows = false;
    if (djiImportSession) {
      renderDjiReviewTable();
    }
  }
}

function renderDjiMemories() {
  const counterEl = document.getElementById("djiImportedKeysCounter");
  if (counterEl) {
    const totalKeys = (state.dji.importedFlightKeys || []).length;
    counterEl.textContent = `${totalKeys} ${totalKeys === 1 ? "vuelo" : "vuelos"} en historial`;
  }

  const locContainer = document.getElementById("djiLocationMemoryList");
  if (locContainer) {
    const locEntries = Object.entries(state.dji.locationMemory || {}).filter(([, farmId]) => Boolean(getFarmById(farmId)));
    if (locEntries.length === 0) {
      locContainer.innerHTML = `<p class="text-xs text-slate-400 italic col-span-full">Todavía no hay ubicaciones (Location) guardadas. Al asignar una fila agrupada se recordará aquí automáticamente.</p>`;
    } else {
      locContainer.innerHTML = locEntries
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([locKey, farmId]) => {
          const farm = getFarmById(farmId);
          const prod = farm ? getProducerByFarmId(farm.id) : null;
          return `
            <div class="p-3 rounded-xl bg-slate-950/70 border border-brand-accent/30 flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-xs font-bold text-brand-accent truncate" title="${escapeHtml(locKey)}">${escapeHtml(locKey)}</div>
                <div class="text-[11px] text-slate-200 truncate">${escapeHtml(farm ? farm.name : "Finca")} • ${escapeHtml(prod ? prod.name : "")}</div>
              </div>
              <button type="button" data-action="delete-loc-memory" data-loc-key="${escapeHtml(locKey)}" class="p-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 shrink-0" title="Olvidar esta ubicación">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          `;
        }).join("");
    }
  }

  const plotContainer = document.getElementById("djiPlotMemoryList");
  if (plotContainer) {
    const plotEntries = Object.entries(state.dji.plotMemory || {}).filter(([, farmId]) => Boolean(getFarmById(farmId)));
    if (plotEntries.length === 0) {
      plotContainer.innerHTML = `<p class="text-xs text-slate-400 italic col-span-full">Todavía no hay Plot IDs guardados. Se guardan al asignar filas separadas por lote o archivos sin columna Location.</p>`;
    } else {
      plotContainer.innerHTML = plotEntries
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([plotId, farmId]) => {
          const farm = getFarmById(farmId);
          const prod = farm ? getProducerByFarmId(farm.id) : null;
          return `
            <div class="p-3 rounded-xl bg-slate-950/70 border border-brand-border flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="font-mono text-xs font-bold text-brand-blue truncate" title="${escapeHtml(plotId)}">${escapeHtml(plotId)}</div>
                <div class="text-[11px] text-slate-200 truncate">${escapeHtml(farm ? farm.name : "Finca")} • ${escapeHtml(prod ? prod.name : "")}</div>
              </div>
              <button type="button" data-action="delete-plot-memory" data-plot-id="${escapeHtml(plotId)}" class="p-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 shrink-0" title="Olvidar este Plot ID">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          `;
        }).join("");
    }
  }
}

function requestDeleteLocationMemory(locKey) {
  if (!state.dji || !state.dji.locationMemory || !state.dji.locationMemory[locKey]) return;
  openConfirmModal(
    "Olvidar ubicación",
    `¿Eliminar la asignación guardada de la ubicación "${locKey}"? La próxima vez que aparezca en un Excel deberás elegir su finca nuevamente.`,
    () => {
      delete state.dji.locationMemory[locKey];
      saveState(true);
      renderDjiTab();
      showToast(`Ubicación "${locKey}" eliminada de la memoria.`, "info");
    },
    "Sí, olvidar",
    true
  );
}

function requestDeletePlotMemory(plotId) {
  if (!state.dji || !state.dji.plotMemory || !state.dji.plotMemory[plotId]) return;
  openConfirmModal(
    "Olvidar Plot ID",
    `¿Eliminar la asignación guardada del Plot ID "${plotId}"? La próxima vez que aparezca en un Excel deberás elegir su finca nuevamente.`,
    () => {
      delete state.dji.plotMemory[plotId];
      saveState(true);
      renderDjiTab();
      showToast(`Plot ID "${plotId}" eliminado de la memoria.`, "info");
    },
    "Sí, olvidar",
    true
  );
}
