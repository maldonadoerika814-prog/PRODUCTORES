/* ==========================================================================
   AgroDrone - Vistas, Modales, Libro de Abonos y PDFs V5.0 (js/views.js)
   Integración completa con js/finance.js: descuentos, IVA, libro auditable de
   abonos múltiples, separación Devengado vs. Estimado y protección de estados.
   ========================================================================== */

"use strict";

// ==========================================================================
// 1. NAVEGACIÓN Y RENDERIZADO INTELIGENTE DE LA PESTAÑA ACTIVA
// ==========================================================================
function switchTab(tabId) {
  currentActiveTab = tabId;
  const tabs = ["dashboard", "daily", "dji", "producers", "sprays", "calendar", "billing", "settings"];

  tabs.forEach(t => {
    const section = document.getElementById(`tab-${t}`);
    const nav = document.getElementById(`nav-${t}`);
    if (!section || !nav) return;

    if (t === tabId) {
      section.classList.remove("hidden");
      nav.className = "w-full flex items-center space-x-2.5 lg:space-x-3 px-3 lg:px-4 py-2.5 lg:py-3 text-xs lg:text-sm rounded-xl font-medium text-left transition-all nav-active";
    } else {
      section.classList.add("hidden");
      nav.className = "w-full flex items-center space-x-2.5 lg:space-x-3 px-3 lg:px-4 py-2.5 lg:py-3 text-xs lg:text-sm rounded-xl font-medium text-left transition-all text-slate-300 hover:text-white hover:bg-slate-800/60";
    }
  });

  const titles = {
    dashboard: ["Panel Principal", "Control de pendientes, cobros exigibles (devengados), estimados y depósito al piloto"],
    daily: ["Registrar Fumigados del Día", "Marca las fincas fumigadas en una fecha, aplica descuentos opcionales y regístralas en lote"],
    dji: ["Importar vuelos DJI", "Carga el Excel de DJI SmartFarm con precisión decimal exacta y registra fumigaciones"],
    producers: ["Productores y Fincas", "Gestión de productores, múltiples fincas, validación por cédula, WhatsApp e historial PDF"],
    sprays: ["Fumigaciones", "Historial de aplicaciones, descuentos, IVA, pagos devengados vs. estimados y PDF"],
    calendar: ["Calendario de Fumigaciones", "Programación mensual con fechas base de temporada y fechas reprogramadas"],
    billing: ["Cobros y Cartera", "Libro auditable de abonos múltiples, anticipos, saldos a favor, exportación CSV y WhatsApp"],
    settings: ["Configuración y Respaldo", "Asociación, tarifas, IVA base, pilotos, drones, plantillas WhatsApp y respaldo JSON"]
  };

  if (titles[tabId]) {
    document.getElementById("pageTitle").textContent = titles[tabId][0];
    document.getElementById("pageSubtitle").textContent = titles[tabId][1];
    const mobileLabel = document.getElementById("mobileCurrentTabLabel");
    if (mobileLabel) mobileLabel.textContent = titles[tabId][0];
  }

  closeMobileSidebar();
  updateSeasonBadges();
  updateBackupIndicators();
  renderActiveTabOnly(tabId, true);
}

function syncSidebarInertState() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const isHiddenOffCanvas = window.innerWidth < 768 && sidebar.classList.contains("-translate-x-full");
  sidebar.inert = isHiddenOffCanvas;
  if (isHiddenOffCanvas) {
    sidebar.setAttribute("inert", "");
  } else {
    sidebar.removeAttribute("inert");
  }
}

function closeMobileSidebar(restoreFocus = false) {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const mobileBtn = document.getElementById("mobileMenuBtn");
  const mainEl = document.querySelector("#appShell > main") || document.querySelector("main");
  const topbarEl = mobileBtn
    ? mobileBtn.closest(".md\\:hidden")
    : document.querySelector("#appShell > .md\\:hidden");

  if (sidebar) sidebar.classList.add("-translate-x-full");
  if (overlay) overlay.classList.add("hidden");
  syncSidebarInertState();
  document.documentElement.classList.remove("drawer-open");
  document.body.classList.remove("drawer-open");

  if (mainEl) {
    mainEl.inert = false;
    mainEl.removeAttribute("inert");
  }
  if (topbarEl) {
    topbarEl.inert = false;
    topbarEl.removeAttribute("inert");
  }

  if (mobileBtn) {
    mobileBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus === true) {
      mobileBtn.focus();
    }
  }
}

function renderActiveTabOnly(tabId, isTabSwitch = false) {
  if (tabId === "dashboard") renderDashboard();
  else if (tabId === "daily") {
    if (isTabSwitch) initDailyBatchTab();
    else renderDailyBatchList();
  } else if (tabId === "dji") renderDjiTab();
  else if (tabId === "producers") {
    populateSectorFilter();
    renderProducersList();
  } else if (tabId === "sprays") renderSpraysTable();
  else if (tabId === "calendar") renderCalendar();
  else if (tabId === "billing") renderBillingTable();
  else if (tabId === "settings") populateSettingsForm();
}

function refreshAllViews() {
  applyBackgroundAppearance();
  updateSeasonBadges();
  updateBackupIndicators();
  populateSectorFilter();
  renderActiveTabOnly(currentActiveTab, false);
}

// ==========================================================================
// 2. PANEL PRINCIPAL (DASHBOARD: DEVENGADO VS. ESTIMADO)
// ==========================================================================
function renderDashboard() {
  const sampleBanner = document.getElementById("sampleDataNoticeBanner");
  if (sampleBanner) {
    sampleBanner.classList.toggle("hidden", !hasSampleData());
  }

  const farms = getAllFarms();
  const todayStr = getGuayaquilTodayStr();
  const weekLimitStr = addDaysToDateStr(todayStr, 7);
  const currentMonthPrefix = todayStr.substring(0, 7);

  const summary = computePortfolioSummary(state.sprays, state.config);

  let monthSprays = 0;
  state.sprays.forEach(sp => {
    if (sp.status === "Realizada" && sp.date && sp.date.startsWith(currentMonthPrefix)) {
      monthSprays++;
    }
  });

  document.getElementById("kpiProducersCount").textContent = state.producers.length;
  document.getElementById("kpiFarmsCount").textContent = `${farms.length} ${farms.length === 1 ? "finca registrada" : "fincas registradas"}`;
  document.getElementById("kpiTotalHectares").textContent = `${formatHectares(summary.realizedHectares)} ha`;
  document.getElementById("kpiMonthSprays").textContent = monthSprays;
  document.getElementById("kpiMonthLabel").textContent = `Realizadas en ${currentMonthPrefix}`;
  document.getElementById("kpiPendingAmount").textContent = formatMoney(summary.collectibleTotal);
  document.getElementById("kpiPendingCount").textContent =
    `${summary.collectibleOrdersCount} ${summary.collectibleOrdersCount === 1 ? "cuenta exigible" : "cuentas exigibles"}` +
    (summary.billedEstimated > 0 ? ` (+${formatMoney(summary.billedEstimated)} est.)` : "");

  let expiredCount = 0;
  const upcomingRows = [];
  const pendingItems = [];

  farms.forEach(farm => {
    const prod = getProducerByFarmId(farm.id);
    const sched = calculateFarmSchedule(farm);
    const hasEffective = Boolean(sched.effectiveDateStr);

    const isExpired = hasEffective && sched.effectiveDateStr < todayStr;
    const isToday = hasEffective && sched.effectiveDateStr === todayStr;
    const isThisWeek = hasEffective && sched.effectiveDateStr > todayStr && sched.effectiveDateStr <= weekLimitStr;

    if (isExpired) expiredCount++;

    if (isExpired || isToday || isThisWeek) {
      let urgencyRank = 2;
      let urgencyStyle = "border-brand-blue/40 bg-slate-950/75";
      let badgeHtml = `<span class="px-2 py-0.5 rounded bg-brand-blue/20 text-brand-blue font-bold text-[10px]">ESTA SEMANA</span>`;

      if (isExpired) {
        const overdueDays = Math.abs(diffDaysBetweenDates(sched.effectiveDateStr, todayStr));
        urgencyRank = 0;
        urgencyStyle = "border-rose-500/45 bg-rose-950/35";
        badgeHtml = `<span class="px-2 py-0.5 rounded bg-rose-500/25 text-rose-300 font-bold text-[10px]">ATRASADO (${overdueDays}d)</span>`;
      } else if (isToday) {
        urgencyRank = 1;
        urgencyStyle = "border-brand-accent/45 bg-emerald-950/35";
        badgeHtml = `<span class="px-2 py-0.5 rounded bg-brand-accent/25 text-brand-accent font-bold text-[10px]">HOY</span>`;
      }

      pendingItems.push({ farm, prod, sched, urgencyRank, urgencyStyle, badgeHtml });
    }

    upcomingRows.push({
      farm,
      prod,
      sched,
      isExpired,
      isToday,
      isThisWeek,
      sortKey: sched.effectiveDateStr || "9999-12-31"
    });
  });

  upcomingRows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const upcomingTableBody = document.getElementById("upcomingSpraysTableBody");
  if (upcomingRows.length === 0) {
    upcomingTableBody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-xs text-slate-400">No hay fincas registradas todavía.</td></tr>`;
  } else {
    upcomingTableBody.innerHTML = upcomingRows.map(({ farm, prod, sched, isExpired, isToday, isThisWeek }) => {
      let dateBadge = `<span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-slate-700/60 text-slate-300 border border-slate-600">Sin fumigación</span>`;
      if (sched.effectiveDateStr) {
        if (isExpired) {
          const dLate = Math.abs(diffDaysBetweenDates(sched.effectiveDateStr, todayStr));
          dateBadge = `<span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">Vencida (-${dLate}d)</span>`;
        } else if (isToday) {
          dateBadge = `<span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-brand-accent/20 text-brand-accent border border-brand-accent/40">Toca Hoy</span>`;
        } else if (isThisWeek) {
          dateBadge = `<span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">Esta semana</span>`;
        } else {
          dateBadge = `<span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-500/20 text-brand-accent border border-brand-accent/40">Al día</span>`;
        }
      }

      const waType = sched.hasReschedule ? "reschedule" : "reminder";
      const waDateLabel = sched.effectiveDateStr
        ? `${formatDisplayDate(sched.effectiveDateStr)} (${sched.effectiveDateStr})`
        : "próxima fecha por definir";

      const waBtn = renderWhatsAppButtonHtml(prod, waType, {
        nombre: prod ? prod.name : "",
        finca: farm.name,
        fecha: waDateLabel,
        motivo: sched.rescheduleDescription
      }, "WhatsApp");

      let detailText = `<span class="text-slate-400 text-xs">Sin fumigación registrada</span>`;
      if (sched.hasReschedule) {
        detailText = `<span class="text-amber-300 text-xs font-semibold">Reprogramada:</span> <span class="text-slate-200 text-xs">${escapeHtml(sched.rescheduleDescription)}</span>`;
      } else if (sched.hasLastSpray) {
        detailText = `<span class="text-slate-300 text-xs">Regla +${sched.daysToAdd} días (${sched.isRainy ? "Lluviosa" : "Seca"})</span>`;
      }

      return `
        <tr class="hover:bg-slate-900/55 transition-colors">
          <td data-label="Productor / Finca" class="py-3 px-3">
            <div class="font-bold text-white">${escapeHtml(farm.name)}</div>
            <div class="text-[11px] text-slate-300">${escapeHtml(prod ? prod.name : "")} • ${escapeHtml(farm.crop)} (${formatHectares(farm.hectares)} ha)</div>
          </td>
          <td data-label="Sector" class="py-3 px-3 text-slate-300 text-xs">${escapeHtml(farm.sector)}</td>
          <td data-label="Última Fumig." class="py-3 px-3 text-slate-300 text-xs lg:whitespace-nowrap">${sched.hasLastSpray ? formatDisplayDate(sched.lastSprayStr) : '<span class="text-slate-400 italic">Sin fumigación registrada</span>'}</td>
          <td data-label="Próxima Fecha" class="py-3 px-3 lg:whitespace-nowrap">
            <div class="font-bold ${sched.hasReschedule ? "text-amber-300" : (sched.effectiveDateStr ? "text-white" : "text-slate-400")}">${sched.effectiveDateStr ? formatDisplayDate(sched.effectiveDateStr) : "Sin fumigación registrada"}</div>
            ${sched.hasReschedule && sched.baseDateStr ? `<div class="text-[10px] text-slate-400">Base: ${formatDisplayDate(sched.baseDateStr)}</div>` : ""}
          </td>
          <td data-label="Estado Fecha" class="py-3 px-3 lg:whitespace-nowrap">${dateBadge}</td>
          <td data-label="Detalle" class="py-3 px-3 lg:max-w-xs">${detailText}</td>
          <td data-label="Acciones" data-cell-actions="true" class="py-3 px-3 lg:text-right lg:whitespace-nowrap">
            <div class="flex flex-wrap items-center justify-start lg:justify-end gap-1.5">
              <button type="button" data-action="open-reschedule-modal" data-farm-id="${escapeHtml(farm.id)}" class="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 rounded-lg text-[11px] font-bold border border-amber-500/35">
                <i data-lucide="calendar-clock" class="w-3.5 h-3.5"></i>
                <span>Reprogramar</span>
              </button>
              ${waBtn}
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  document.getElementById("kpiExpiredCount").textContent = expiredCount;
  document.getElementById("pendientesPorCobrar").textContent = formatMoney(summary.collectibleTotal);
  document.getElementById("pendientesDepositoPiloto").textContent = formatMoney(summary.pilotAccruedPending);
  const estInfoEl = document.getElementById("pendientesEstimadoInfo");
  if (estInfoEl) {
    estInfoEl.textContent = `${formatMoney(summary.billedEstimated)} cliente • ${formatMoney(summary.pilotEstimated)} piloto`;
  }

  pendingItems.sort((a, b) => a.urgencyRank - b.urgencyRank || a.sched.effectiveDateStr.localeCompare(b.sched.effectiveDateStr));
  const pendientesContainer = document.getElementById("pendientesListContainer");
  if (pendientesContainer) {
    if (pendingItems.length === 0) {
      pendientesContainer.innerHTML = `<p class="text-xs text-slate-300 italic col-span-2 py-3 text-center">No hay fincas atrasadas ni pendientes para los próximos 7 días.</p>`;
    } else {
      pendientesContainer.innerHTML = pendingItems.map(item => {
        const waType = item.sched.hasReschedule ? "reschedule" : "reminder";
        const waBtn = renderWhatsAppButtonHtml(item.prod, waType, {
          nombre: item.prod ? item.prod.name : "",
          finca: item.farm.name,
          fecha: `${formatDisplayDate(item.sched.effectiveDateStr)} (${item.sched.effectiveDateStr})`,
          motivo: item.sched.rescheduleDescription
        }, "WhatsApp");

        return `
          <div class="p-3.5 rounded-xl border ${item.urgencyStyle} flex flex-col justify-between gap-2">
            <div>
              <div class="flex items-center justify-between gap-2">
                <span class="font-bold text-white text-xs truncate">${escapeHtml(item.farm.name)} (${formatHectares(item.farm.hectares)} ha)</span>
                ${item.badgeHtml}
              </div>
              <div class="text-[11px] text-slate-300 truncate">${escapeHtml(item.prod ? item.prod.name : "")} • ${escapeHtml(item.farm.sector)}</div>
              <div class="text-[11px] text-slate-200 mt-1">
                ${item.sched.hasReschedule
                  ? `<span class="text-amber-300 font-bold">Reprogramada: ${formatDisplayDate(item.sched.effectiveDateStr)}</span> • <span class="italic text-slate-300">${escapeHtml(item.sched.rescheduleDescription)}</span>`
                  : `Próxima fecha base: <strong class="text-brand-accent">${formatDisplayDate(item.sched.baseDateStr)}</strong> (+${item.sched.daysToAdd}d)`}
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-white/10">
              <button type="button" data-action="open-reschedule-modal" data-farm-id="${escapeHtml(item.farm.id)}" class="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 text-[11px] font-bold">
                <i data-lucide="calendar-clock" class="w-3.5 h-3.5"></i>
                <span>Reprogramar</span>
              </button>
              ${waBtn}
            </div>
          </div>
        `;
      }).join("");
    }
  }

  renderDashboardCharts(summary);
  safeRefreshIcons();
}

function renderDashboardCharts(precomputedSummary = null) {
  const ctxHectaresEl = document.getElementById("chartHectaresMonth");
  const ctxPaymentEl = document.getElementById("chartPaymentMethods");
  if (!ctxHectaresEl || !ctxPaymentEl || typeof Chart === "undefined") return;

  if (chartHectaresInstance) chartHectaresInstance.destroy();
  if (chartPaymentInstance) chartPaymentInstance.destroy();

  const monthBucketsScaled = {};
  state.sprays.forEach(sp => {
    if (sp.status === "Realizada" && isValidDateStr(sp.date)) {
      const ym = sp.date.substring(0, 7);
      const haScaled = roundDecimalExact._scaleBigInt(sp.hectares, 4);
      monthBucketsScaled[ym] = (monthBucketsScaled[ym] || 0n) + haScaled;
    }
  });

  const sortedMonths = Object.keys(monthBucketsScaled).sort();
  const labels = sortedMonths.length > 0 ? sortedMonths : [getGuayaquilTodayStr().substring(0, 7)];
  const values = sortedMonths.length > 0
    ? sortedMonths.map(m => roundDecimalExact._formatBigInt(monthBucketsScaled[m], 4))
    : [0];

  chartHectaresInstance = new Chart(ctxHectaresEl.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Hectáreas Fumigadas",
        data: values,
        backgroundColor: "rgba(0, 255, 136, 0.85)",
        borderColor: "#00ff88",
        borderWidth: 1,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `Hectáreas Fumigadas: ${formatHectares(ctx.parsed.y)} ha`
          }
        }
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "#cbd5e1" } },
        y: { grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "#cbd5e1" }, beginAtZero: true }
      }
    }
  });

  const summary = precomputedSummary || computePortfolioSummary(state.sprays, state.config);

  chartPaymentInstance = new Chart(ctxPaymentEl.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: [
        "Transferencia (Cobrado)",
        "Cheque (Cobrado)",
        "Efectivo (Cobrado)",
        "Por Cobrar (Devengado)"
      ],
      datasets: [{
        data: [
          summary.collectedByMethod.Transferencia,
          summary.collectedByMethod.Cheque,
          summary.collectedByMethod.Efectivo,
          summary.collectibleTotal
        ],
        backgroundColor: ["#00d4ff", "#f59e0b", "#00ff88", "#ef4444"],
        borderColor: "#0b1324",
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: "#e2e8f0", font: { size: 11 } } }
      }
    }
  });
}

// ==========================================================================
// 3. REGISTRAR FUMIGADOS DEL DÍA (CON DESCUENTO EXACTO Y ASIENTO V5)
// ==========================================================================
function initDailyBatchTab() {
  const dateInput = document.getElementById("dailySprayDate");
  if (dateInput && !isValidDateStr(dateInput.value)) {
    dateInput.value = getGuayaquilTodayStr();
  }
  renderDailyBatchList();
}

function onDailyDateChanged() {
  const dateInput = document.getElementById("dailySprayDate");
  if (dateInput && !isValidDateStr(dateInput.value)) {
    dateInput.value = getGuayaquilTodayStr();
  }
  renderDailyBatchList();
}

function renderDailyBatchList() {
  const container = document.getElementById("dailyFarmsChecklist");
  if (!container) return;

  const farms = getAllFarms();
  if (farms.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-slate-300 rounded-2xl bg-slate-950/60 border border-brand-border">No hay fincas registradas aún. Crea un productor primero en la pestaña "Productores y Fincas".</div>`;
    updateDailySelectedCounter();
    return;
  }

  const pilotsOpts = (state.config.pilots || ["Ing. Diego Vera"])
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  const dronesOpts = (state.config.drones || ["DJI Agras T40 #1"])
    .map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");

  const clientRate = Number.isFinite(state.config.clientRatePerHa) ? state.config.clientRatePerHa : 15;
  const defaultIva = Number.isFinite(state.config.defaultIvaPct) ? state.config.defaultIvaPct : 0;

  container.innerHTML = farms.map(farm => {
    const prod = getProducerByFarmId(farm.id);
    const sched = calculateFarmSchedule(farm);
    const ha = roundHectares(farm.hectares);
    const calc = computeSprayFinancials({
      pricingMode: "v5",
      status: "Realizada",
      hectares: ha,
      unitRateHa: clientRate,
      discountPct: 0,
      ivaPct: defaultIva,
      payments: []
    }, state.config);

    return `
      <div class="daily-farm-card rounded-2xl border border-brand-border bg-slate-950/65 p-4 transition-all tabular-nums" data-farm-id="${escapeHtml(farm.id)}" data-search="${escapeHtml((farm.name + " " + (prod ? prod.name : "") + " " + farm.sector).toLowerCase())}">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label class="flex items-center space-x-3 cursor-pointer select-none flex-1">
            <input type="checkbox" data-change="daily-farm-cb" class="daily-farm-cb w-5 h-5 accent-emerald-400 rounded cursor-pointer shrink-0">
            <div class="min-w-0">
              <div class="font-bold text-white text-sm">${escapeHtml(farm.name)} <span class="text-xs font-normal text-brand-accent">(${formatHectares(ha)} ha • ${escapeHtml(farm.crop)})</span></div>
              <div class="text-xs text-slate-300 truncate">${escapeHtml(prod ? prod.name : "")} • ${escapeHtml(farm.sector)} • Próxima: <strong class="text-brand-blue">${sched.effectiveDateStr ? formatDisplayDate(sched.effectiveDateStr) : "Sin fumigación registrada"}</strong></div>
            </div>
          </label>
          <span class="daily-status-pill text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 font-semibold self-start sm:self-center shrink-0">Sin marcar</span>
        </div>

        <div class="daily-fields hidden mt-4 pt-4 border-t border-white/10 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Hectáreas *</label>
              <input type="number" step="0.0001" min="0.0001" data-input="daily-ha" class="daily-ha w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs" value="${ha}">
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Descuento (%)</label>
              <input type="number" step="0.01" min="0" max="100" data-input="daily-discount" class="daily-discount w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs" value="0">
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Piloto</label>
              <select class="daily-pilot w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs">${pilotsOpts}</select>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Dron</label>
              <select class="daily-drone w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs">${dronesOpts}</select>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Total Cliente ($) *</label>
              <input type="number" step="0.01" min="0" class="daily-amount w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-accent/40 text-white font-bold text-xs" value="${calc.totalClient.toFixed(2)}">
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Pago Piloto ($)</label>
              <input type="number" step="0.01" min="0" class="daily-pilot-pay w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-brand-blue text-xs" value="${calc.pilotPayAmount.toFixed(2)}">
            </div>
          </div>

          <div class="p-3 rounded-xl bg-slate-900/75 border border-brand-accent/25 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-bold uppercase text-brand-accent">Producto(s) y Dosis</span>
              <button type="button" data-action="add-daily-product" class="inline-flex items-center space-x-1 text-[11px] px-2.5 py-1 rounded-lg bg-brand-accent/20 text-brand-accent hover:bg-brand-accent/30 font-bold">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                <span>Producto</span>
              </button>
            </div>
            <div class="daily-products-list space-y-2">
              <div class="daily-prod-row grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
                <input type="text" class="dp-name px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Nombre comercial *" value="Fungicida Agrícola">
                <input type="text" class="dp-active px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Ing. activo (opc.)">
                <input type="text" class="dp-dose px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Dosis/ha (ej. 1 L/ha)">
                <input type="text" class="dp-vol px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Vol. total">
                <input type="text" class="dp-lot px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Lote">
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Método de Pago</label>
              <select class="daily-pay-method w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs">
                <option value="Transferencia">Transferencia</option>
                <option value="Cheque">Cheque</option>
                <option value="Efectivo">Efectivo</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Estado Pago</label>
              <select data-change="daily-pay-status" class="daily-pay-status w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs">
                <option value="Pagado">Pagado</option>
                <option value="Parcial">Parcial</option>
                <option value="Pendiente">Pendiente</option>
              </select>
            </div>
            <div class="daily-partial-wrap hidden">
              <label class="block text-[10px] font-bold text-amber-300 uppercase mb-1">Abono ($) *</label>
              <input type="number" step="0.01" min="0" class="daily-paid-amt w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-amber-500/40 text-white text-xs" value="0">
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">N.º Comprob. / Ref</label>
              <input type="text" class="daily-pay-ref w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs" placeholder="Opcional">
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Observaciones</label>
              <input type="text" class="daily-notes w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs" placeholder="Notas para PDF">
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  filterDailyCards();
  updateDailySelectedCounter();
  safeRefreshIcons();
}

function filterDailyCards() {
  const input = document.getElementById("dailySearchInput");
  const q = (input ? input.value : "").toLowerCase().trim();
  document.querySelectorAll("#dailyFarmsChecklist .daily-farm-card").forEach(card => {
    const text = card.getAttribute("data-search") || "";
    card.classList.toggle("hidden", q !== "" && !text.includes(q));
  });
}

function toggleDailyFarmFields(cb) {
  const card = cb.closest(".daily-farm-card");
  if (!card) return;
  const fields = card.querySelector(".daily-fields");
  const pill = card.querySelector(".daily-status-pill");
  if (cb.checked) {
    fields.classList.remove("hidden");
    card.classList.add("border-brand-accent/60", "bg-emerald-950/25");
    pill.textContent = "Marcada para guardar";
    pill.className = "daily-status-pill text-[11px] px-2.5 py-1 rounded-lg bg-brand-accent/20 text-brand-accent font-bold self-start sm:self-center shrink-0";
  } else {
    fields.classList.add("hidden");
    card.classList.remove("border-brand-accent/60", "bg-emerald-950/25", "border-rose-500");
    pill.textContent = "Sin marcar";
    pill.className = "daily-status-pill text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 font-semibold self-start sm:self-center shrink-0";
  }
  updateDailySelectedCounter();
}

function updateDailySelectedCounter() {
  const count = document.querySelectorAll("#dailyFarmsChecklist .daily-farm-cb:checked").length;
  const counter = document.getElementById("dailySelectedCounter");
  if (counter) {
    counter.textContent = `${count} ${count === 1 ? "finca marcada" : "fincas marcadas"}`;
  }
}

function recalcDailyCardAmounts(inputEl) {
  const card = inputEl.closest(".daily-farm-card");
  if (!card) return;
  const ha = roundHectares(Math.max(0, parseFloat(card.querySelector(".daily-ha").value) || 0));
  const disc = Math.min(100, Math.max(0, parseFloat(card.querySelector(".daily-discount").value) || 0));
  const calc = computeSprayFinancials({
    pricingMode: "v5",
    status: "Realizada",
    hectares: ha,
    unitRateHa: state.config.clientRatePerHa,
    discountPct: disc,
    ivaPct: state.config.defaultIvaPct || 0,
    payments: []
  }, state.config);
  card.querySelector(".daily-amount").value = calc.totalClient.toFixed(2);
  card.querySelector(".daily-pilot-pay").value = calc.pilotPayAmount.toFixed(2);
}

function toggleDailyPartialInput(selectEl) {
  const card = selectEl.closest(".daily-farm-card");
  if (!card) return;
  const wrap = card.querySelector(".daily-partial-wrap");
  if (selectEl.value === "Parcial") wrap.classList.remove("hidden");
  else wrap.classList.add("hidden");
}

function addDailyProductRow(btn) {
  const fields = btn.closest(".daily-fields");
  if (!fields) return;
  const list = fields.querySelector(".daily-products-list");
  const row = document.createElement("div");
  row.className = "daily-prod-row grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2";
  row.innerHTML = `
    <input type="text" class="dp-name px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Nombre comercial *">
    <input type="text" class="dp-active px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Ing. activo (opc.)">
    <input type="text" class="dp-dose px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Dosis/ha">
    <input type="text" class="dp-vol px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Vol. total">
    <div class="flex items-center space-x-1">
      <input type="text" class="dp-lot w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Lote">
      <button type="button" data-action="remove-daily-product" class="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg shrink-0" title="Quitar producto" aria-label="Quitar producto">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `;
  list.appendChild(row);
  safeRefreshIcons(row);
}

function saveDailyBatchSprays() {
  const dateStr = document.getElementById("dailySprayDate").value;
  if (!isValidDateStr(dateStr)) {
    showToast("Selecciona una fecha de fumigación válida.", "error");
    return;
  }

  const checkedBoxes = Array.from(document.querySelectorAll("#dailyFarmsChecklist .daily-farm-cb:checked"));
  if (checkedBoxes.length === 0) {
    showToast("Marca al menos una finca para registrar fumigados del día.", "warning");
    return;
  }

  const entriesToSave = [];
  for (let i = 0; i < checkedBoxes.length; i++) {
    const card = checkedBoxes[i].closest(".daily-farm-card");
    card.classList.remove("border-rose-500");
    const farmId = card.getAttribute("data-farm-id");
    const farm = getFarmById(farmId);
    if (!farm) continue;

    const hectares = parseFloat(card.querySelector(".daily-ha").value);
    const discountPct = parseFloat(card.querySelector(".daily-discount").value || "0");
    const amount = parseFloat(card.querySelector(".daily-amount").value);
    const pilotPay = parseFloat(card.querySelector(".daily-pilot-pay").value);
    const payMethod = card.querySelector(".daily-pay-method").value;
    const rawPayStatus = card.querySelector(".daily-pay-status").value;
    const payRef = card.querySelector(".daily-pay-ref").value.trim();
    const notes = card.querySelector(".daily-notes").value.trim();
    const pilot = card.querySelector(".daily-pilot").value;
    const drone = card.querySelector(".daily-drone").value;

    if (!Number.isFinite(hectares) || hectares <= 0 || hectares > 10000) {
      card.classList.add("border-rose-500");
      showToast(`Hectáreas inválidas en "${farm.name}".`, "error");
      return;
    }
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      card.classList.add("border-rose-500");
      showToast(`Descuento inválido en "${farm.name}" (debe estar entre 0% y 100%).`, "error");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      card.classList.add("border-rose-500");
      showToast(`Monto cliente inválido en "${farm.name}".`, "error");
      return;
    }
    if (!Number.isFinite(pilotPay) || pilotPay < 0) {
      card.classList.add("border-rose-500");
      showToast(`Pago al piloto inválido en "${farm.name}".`, "error");
      return;
    }

    let initialPaymentCents = 0;
    const totalCents = toSafeCents(amount);
    if (rawPayStatus === "Pagado") {
      initialPaymentCents = totalCents;
    } else if (rawPayStatus === "Parcial") {
      const rawPaid = parseFloat(card.querySelector(".daily-paid-amt").value);
      if (!Number.isFinite(rawPaid) || rawPaid <= 0) {
        card.classList.add("border-rose-500");
        showToast(`En "${farm.name}", el abono parcial debe ser mayor a $0.00.`, "error");
        return;
      }
      initialPaymentCents = toSafeCents(rawPaid);
    }

    const products = [];
    card.querySelectorAll(".daily-prod-row").forEach(r => {
      const name = r.querySelector(".dp-name").value.trim();
      if (name) {
        products.push({
          commercialName: name,
          activeIngredient: r.querySelector(".dp-active").value.trim(),
          dosePerHa: r.querySelector(".dp-dose").value.trim(),
          totalVolume: r.querySelector(".dp-vol").value.trim(),
          batchLot: r.querySelector(".dp-lot").value.trim()
        });
      }
    });
    if (products.length === 0) {
      card.classList.add("border-rose-500");
      showToast(`Ingresa al menos un producto en "${farm.name}".`, "error");
      return;
    }

    entriesToSave.push({
      farmId,
      hectares: roundHectares(hectares),
      discountPct: roundMoney(discountPct),
      pilot,
      drone,
      amount: roundMoney(amount),
      pilotPay: roundMoney(pilotPay),
      payMethod,
      initialPaymentCents,
      payRef,
      notes,
      products
    });
  }

  entriesToSave.forEach(entry => {
    const orderNum = generateNextOrderNumber(dateStr);
    const baseCalc = computeSprayFinancials({
      pricingMode: "v5",
      status: "Realizada",
      hectares: entry.hectares,
      unitRateHa: state.config.clientRatePerHa,
      discountPct: entry.discountPct,
      ivaPct: state.config.defaultIvaPct || 0,
      payments: []
    }, state.config);

    const hasManualTotal = toSafeCents(entry.amount) !== baseCalc.totalClientCents;
    const payments = entry.initialPaymentCents > 0
      ? [normalizePaymentMovement({
          id: generateUid("pay"),
          date: dateStr,
          amountCents: entry.initialPaymentCents,
          method: entry.payMethod,
          ref: entry.payRef,
          bank: "",
          note: "Pago inicial registrado en Fumigados del Día",
          voided: false,
          createdAt: new Date().toISOString()
        }, 0, dateStr)]
      : [];

    const draft = {
      id: generateUid("sp"),
      orderNumber: orderNum,
      farmId: entry.farmId,
      date: dateStr,
      status: "Realizada",
      rescheduleDescription: "",
      hectares: entry.hectares,
      pricingMode: "v5",
      unitRateHa: state.config.clientRatePerHa,
      discountPct: entry.discountPct,
      ivaPct: state.config.defaultIvaPct || 0,
      manualTotalOverride: hasManualTotal ? entry.amount : undefined,
      payments,
      product: entry.products.map(p => p.commercialName).join(", "),
      products: entry.products,
      drone: entry.drone,
      pilot: entry.pilot,
      pilotPay: entry.pilotPay,
      pilotPaid: false,
      notes: entry.notes,
      payMethod: entry.payMethod,
      payRef: entry.payRef,
      payBank: ""
    };

    const fin = computeSprayFinancials(draft, state.config);
    draft.subtotal = fin.subtotal;
    draft.discount = fin.discount;
    draft.taxableBase = fin.taxableBase;
    draft.iva = fin.iva;
    draft.amount = fin.totalClient;
    draft.amountPaid = fin.paidAmount;
    draft.payStatus = fin.payStatus;

    state.sprays.unshift(draft);
    syncFarmLastSprayFromHistory(entry.farmId);
  });

  saveState(true);
  refreshAllViews();
  showToast(`Se registraron ${entriesToSave.length} fumigación(es) del ${formatDisplayDate(dateStr)} y se recalcularon las próximas fechas.`, "success");
}

// ==========================================================================
// 4. PRODUCTORES Y FINCAS (LISTADO Y CRUD)
// ==========================================================================
function populateSectorFilter() {
  const sel = document.getElementById("filterSectorSelect");
  if (!sel) return;
  const current = sel.value || "ALL";
  const sectors = new Set();
  getAllFarms().forEach(f => sectors.add(getSectorGroupName(f.sector)));
  sel.innerHTML = `<option value="ALL">Todos los sectores</option>` +
    Array.from(sectors).sort().map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  sel.value = Array.from(sel.options).some(opt => opt.value === current) ? current : "ALL";
}

function renderProducersList() {
  const container = document.getElementById("producersCardsGrid");
  if (!container) return;

  const searchVal = (document.getElementById("searchProducerInput").value || "").toLowerCase().trim();
  const cropVal = document.getElementById("filterCropSelect").value;
  const sectorVal = document.getElementById("filterSectorSelect").value;
  const todayStr = getGuayaquilTodayStr();

  const cardsHtml = [];

  state.producers.forEach(prod => {
    const farms = Array.isArray(prod.farms) ? prod.farms : [];
    const matchesSearch =
      !searchVal ||
      prod.name.toLowerCase().includes(searchVal) ||
      prod.doc.toLowerCase().includes(searchVal) ||
      farms.some(f => f.name.toLowerCase().includes(searchVal) || f.sector.toLowerCase().includes(searchVal));

    if (!matchesSearch) return;

    const phoneInfo = parseEcuadorWhatsApp(prod.phone);
    let farmsHtml = "";

    farms.forEach(farm => {
      if (cropVal !== "ALL" && farm.crop !== cropVal) return;
      if (sectorVal !== "ALL" && getSectorGroupName(farm.sector) !== sectorVal) return;

      const sched = calculateFarmSchedule(farm);
      const isExpired = Boolean(sched.effectiveDateStr && sched.effectiveDateStr < todayStr);
      const waType = sched.hasReschedule ? "reschedule" : "reminder";
      const waBtn = renderWhatsAppButtonHtml(prod, waType, {
        nombre: prod.name,
        finca: farm.name,
        fecha: sched.effectiveDateStr ? `${formatDisplayDate(sched.effectiveDateStr)} (${sched.effectiveDateStr})` : "próxima fecha",
        motivo: sched.rescheduleDescription
      }, "WhatsApp");

      let statusPill = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700/70 text-slate-300 border border-slate-600">Sin fumigación</span>`;
      if (sched.effectiveDateStr) {
        if (isExpired) {
          statusPill = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/35">Vencida</span>`;
        } else if (sched.hasReschedule) {
          statusPill = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35">Reprogramada</span>`;
        } else {
          statusPill = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-brand-accent border border-brand-accent/35">Al día</span>`;
        }
      }

      farmsHtml += `
        <div class="p-3.5 rounded-xl bg-slate-950/70 border border-brand-border hover:border-brand-accent/35 transition-all space-y-2.5 tabular-nums">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h5 class="font-bold text-white text-sm">${escapeHtml(farm.name)}</h5>
                ${statusPill}
              </div>
              <p class="text-[11px] text-slate-300 mt-0.5">${escapeHtml(farm.crop)} • ${formatHectares(farm.hectares)} ha • ${escapeHtml(farm.sector)}</p>
            </div>
            <div class="flex flex-wrap items-center gap-1.5 shrink-0">
              <button type="button" data-action="open-reschedule-modal" data-farm-id="${escapeHtml(farm.id)}" class="inline-flex items-center space-x-1 px-2 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 text-[11px] font-bold">
                <i data-lucide="calendar-clock" class="w-3.5 h-3.5"></i>
                <span>Reprog.</span>
              </button>
              ${waBtn}
              <button type="button" data-action="open-farm-edit-modal" data-prod-id="${escapeHtml(prod.id)}" data-farm-id="${escapeHtml(farm.id)}" class="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white border border-brand-border" title="Editar finca">
                <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
              </button>
              <button type="button" data-action="delete-farm" data-prod-id="${escapeHtml(prod.id)}" data-farm-id="${escapeHtml(farm.id)}" class="p-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30" title="Eliminar finca">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-brand-border/40">
            <div>
              <span class="text-slate-400 block text-[10px]">Última Fumigación:</span>
              <span class="font-semibold text-slate-200">${sched.hasLastSpray ? formatDisplayDate(sched.lastSprayStr) : "Sin fumigación registrada"}</span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px]">${sched.hasReschedule ? "Fecha Reprogramada:" : (sched.hasLastSpray ? `Fecha Base (+${sched.daysToAdd}d):` : "Próxima Fecha:")}</span>
              <span class="font-bold ${sched.hasReschedule ? "text-amber-300" : (sched.effectiveDateStr ? "text-brand-accent" : "text-slate-400")}">${sched.effectiveDateStr ? formatDisplayDate(sched.effectiveDateStr) : "Sin fumigación registrada"}</span>
            </div>
          </div>

          ${sched.hasReschedule ? `<div class="text-[11px] text-amber-200/95 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/25">Motivo: ${escapeHtml(sched.rescheduleDescription)}</div>` : ""}
        </div>
      `;
    });

    if (farmsHtml === "" && (cropVal !== "ALL" || sectorVal !== "ALL")) return;

    cardsHtml.push(`
      <div class="glass-card glass-card-hover p-5 rounded-2xl space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h4 class="text-lg font-extrabold text-white">${escapeHtml(prod.name)}</h4>
            <p class="text-xs text-slate-300">
              CI/RUC: <span class="font-mono text-slate-100">${escapeHtml(prod.doc)}</span> • WhatsApp:
              ${phoneInfo.valid
                ? `<span class="text-brand-accent font-mono font-semibold">${escapeHtml(phoneInfo.display)}</span>`
                : `<span class="text-rose-400 font-semibold">Sin número</span>`}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 shrink-0">
            <button type="button" data-action="open-add-farm-modal" data-prod-id="${escapeHtml(prod.id)}" class="px-2.5 py-2 bg-brand-accent/15 text-brand-accent rounded-xl hover:bg-brand-accent/25 text-xs font-bold border border-brand-accent/30 flex items-center space-x-1" title="Agregar otra finca">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>Finca</span>
            </button>
            <button type="button" data-action="open-statement-modal" data-prod-id="${escapeHtml(prod.id)}" class="px-2.5 py-2 bg-slate-800 text-brand-blue rounded-xl hover:bg-slate-700 text-xs font-semibold flex items-center space-x-1 border border-brand-border" title="PDF Historial del Productor">
              <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
              <span>PDF</span>
            </button>
            <button type="button" data-action="open-producer-modal" data-prod-id="${escapeHtml(prod.id)}" class="p-2 bg-slate-800 text-slate-300 rounded-xl hover:text-white text-xs border border-brand-border" title="Editar datos del productor">
              <i data-lucide="pencil" class="w-4 h-4"></i>
            </button>
            <button type="button" data-action="delete-producer" data-prod-id="${escapeHtml(prod.id)}" class="p-2 bg-rose-500/10 text-rose-300 rounded-xl hover:bg-rose-500/25 text-xs border border-rose-500/30" title="Eliminar productor">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <div class="space-y-3">
          <h5 class="text-[11px] font-bold uppercase text-slate-400 tracking-wider">Fincas Registradas (${farms.length})</h5>
          ${farmsHtml || '<p class="text-xs text-slate-400 italic">Sin fincas registradas. Usa "+ Finca" para agregar una.</p>'}
        </div>
      </div>
    `);
  });

  if (cardsHtml.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-10 text-sm text-slate-300 glass-card rounded-2xl">No se encontraron productores con los filtros seleccionados.</div>`;
  } else {
    container.innerHTML = cardsHtml.join("");
  }

  safeRefreshIcons();
}

function updateDocValidationPreview() {
  const input = document.getElementById("producerDoc");
  const preview = document.getElementById("producerDocPreview");
  const prodId = document.getElementById("producerFormId").value;
  if (!input || !preview) return;

  const check = validateEcuadorDoc(input.value);
  if (!check.valid) {
    preview.textContent = check.message;
    preview.className = "text-[11px] text-rose-400 font-semibold mt-1";
    return;
  }

  const dup = findProducerByDoc(check.normalized, prodId);
  if (dup) {
    preview.textContent = `Duplicado: esta cédula/RUC ya pertenece a "${dup.name}".`;
    preview.className = "text-[11px] text-rose-400 font-bold mt-1";
    return;
  }

  if (check.warning) {
    preview.textContent = check.message;
    preview.className = "text-[11px] text-amber-400 font-semibold mt-1";
    return;
  }

  preview.textContent = `${check.type} válido y disponible (${check.normalized}).`;
  preview.className = "text-[11px] text-brand-accent font-semibold mt-1";
}

function updatePhoneFormatPreview() {
  const val = document.getElementById("producerPhone").value;
  const preview = document.getElementById("producerPhonePreview");
  if (!preview) return;
  const info = parseEcuadorWhatsApp(val);
  if (info.empty) {
    preview.textContent = "Sin número: el botón de WhatsApp quedará desactivado para este productor.";
    preview.className = "text-[11px] text-slate-400 mt-1";
  } else if (info.valid) {
    preview.textContent = `Formato internacional listo para wa.me: ${info.display} (${info.international})`;
    preview.className = "text-[11px] text-brand-accent font-semibold mt-1";
  } else {
    preview.textContent = info.reason || "Número inválido: ingresa 10 dígitos de Ecuador (ej. 0991234567).";
    preview.className = "text-[11px] text-rose-400 font-semibold mt-1";
  }
}

function openProducerModal(prodId = null) {
  document.getElementById("producerForm").reset();
  document.getElementById("producerFieldsGroup").classList.remove("hidden");
  const lastSprayInput = document.getElementById("farmLastSprayDate");

  if (prodId) {
    const prod = state.producers.find(p => p.id === prodId);
    if (!prod) return;
    document.getElementById("producerModalTitle").textContent = "Editar Datos del Productor";
    document.getElementById("producerFormId").value = prod.id;
    document.getElementById("editingFarmId").value = "NO_FARM";
    document.getElementById("producerName").value = prod.name;
    document.getElementById("producerDoc").value = prod.doc;
    document.getElementById("producerPhone").value = prod.phone || "";
    document.getElementById("farmFieldsGroup").classList.add("hidden");
    lastSprayInput.dataset.initialValue = "";
  } else {
    document.getElementById("producerModalTitle").textContent = "Registrar Nuevo Productor";
    document.getElementById("farmSectionTitle").textContent = "Datos de la Finca Inicial";
    document.getElementById("producerFormId").value = "";
    document.getElementById("editingFarmId").value = "";
    document.getElementById("farmFieldsGroup").classList.remove("hidden");
    lastSprayInput.value = getGuayaquilTodayStr();
    lastSprayInput.dataset.initialValue = "";
  }

  updateDocValidationPreview();
  updatePhoneFormatPreview();
  document.getElementById("producerModal").classList.remove("hidden");
  safeRefreshIcons();
}

function openAddFarmModal(prodId) {
  const prod = state.producers.find(p => p.id === prodId);
  if (!prod) return;

  document.getElementById("producerForm").reset();
  document.getElementById("producerModalTitle").textContent = `Nueva Finca para ${prod.name}`;
  document.getElementById("farmSectionTitle").textContent = "Datos de la Nueva Finca";
  document.getElementById("producerFormId").value = prod.id;
  document.getElementById("editingFarmId").value = "NEW_FARM";

  document.getElementById("producerName").value = prod.name;
  document.getElementById("producerDoc").value = prod.doc;
  document.getElementById("producerPhone").value = prod.phone || "";
  document.getElementById("producerFieldsGroup").classList.add("hidden");
  document.getElementById("farmFieldsGroup").classList.remove("hidden");
  const lastSprayInput = document.getElementById("farmLastSprayDate");
  lastSprayInput.value = "";
  lastSprayInput.dataset.initialValue = "";

  document.getElementById("producerModal").classList.remove("hidden");
  safeRefreshIcons();
}

function openFarmEditModal(prodId, farmId) {
  const prod = state.producers.find(p => p.id === prodId);
  if (!prod) return;
  const farm = (prod.farms || []).find(f => f.id === farmId);
  if (!farm) return;

  document.getElementById("producerForm").reset();
  document.getElementById("producerModalTitle").textContent = `Editar Finca de ${prod.name}`;
  document.getElementById("farmSectionTitle").textContent = `Editando: ${farm.name}`;
  document.getElementById("producerFormId").value = prod.id;
  document.getElementById("editingFarmId").value = farm.id;

  document.getElementById("producerName").value = prod.name;
  document.getElementById("producerDoc").value = prod.doc;
  document.getElementById("producerPhone").value = prod.phone || "";
  document.getElementById("producerFieldsGroup").classList.add("hidden");
  document.getElementById("farmFieldsGroup").classList.remove("hidden");

  document.getElementById("farmName").value = farm.name;
  document.getElementById("farmCrop").value = farm.crop;
  document.getElementById("farmHectares").value = farm.hectares;
  document.getElementById("farmSector").value = farm.sector;
  const lastSprayInput = document.getElementById("farmLastSprayDate");
  lastSprayInput.value = farm.lastSprayDate || "";
  lastSprayInput.dataset.initialValue = farm.lastSprayDate || "";

  document.getElementById("producerModal").classList.remove("hidden");
  safeRefreshIcons();
}

function saveProducerForm(e) {
  e.preventDefault();
  const prodId = document.getElementById("producerFormId").value;
  const editingFarmId = document.getElementById("editingFarmId").value;
  const isEditingProducerFields = !document.getElementById("producerFieldsGroup").classList.contains("hidden");
  const isEditingFarmFields = !document.getElementById("farmFieldsGroup").classList.contains("hidden");

  const name = document.getElementById("producerName").value.trim();
  const rawDoc = document.getElementById("producerDoc").value.trim();
  const rawPhone = document.getElementById("producerPhone").value.trim();

  let normalizedDoc = normalizeDoc(rawDoc);
  let normalizedPhone = "";
  let hasCedulaWarning = false;

  if (isEditingProducerFields) {
    if (name.length < 2) {
      showToast("Ingresa el nombre completo del productor (mínimo 2 caracteres).", "error");
      return;
    }
    const docCheck = validateEcuadorDoc(rawDoc);
    if (!docCheck.valid) {
      showToast(docCheck.message, "error");
      return;
    }
    normalizedDoc = docCheck.normalized;
    hasCedulaWarning = Boolean(docCheck.warning);

    const duplicate = findProducerByDoc(normalizedDoc, prodId);
    if (duplicate) {
      showToast(`Ya existe un productor con la cédula/RUC ${normalizedDoc}: "${duplicate.name}".`, "error");
      return;
    }

    const phoneInfo = parseEcuadorWhatsApp(rawPhone);
    if (!phoneInfo.empty && !phoneInfo.valid) {
      showToast(phoneInfo.reason || "Teléfono WhatsApp de Ecuador inválido.", "error");
      return;
    }
    normalizedPhone = phoneInfo.valid ? phoneInfo.international : "";
  }

  let farmName = "";
  let farmCrop = "Banano";
  let farmHectares = 0;
  let farmSector = "";
  let lastSpray = "";
  const lastSprayInput = document.getElementById("farmLastSprayDate");
  const initialLastSpray = lastSprayInput ? (lastSprayInput.dataset.initialValue || "") : "";

  if (isEditingFarmFields) {
    farmName = document.getElementById("farmName").value.trim();
    farmCrop = document.getElementById("farmCrop").value;
    farmHectares = parseFloat(document.getElementById("farmHectares").value);
    farmSector = document.getElementById("farmSector").value.trim();
    lastSpray = lastSprayInput.value.trim();

    if (farmName.length < 2) {
      showToast("Ingresa el nombre de la finca.", "error");
      return;
    }
    if (!Number.isFinite(farmHectares) || farmHectares <= 0 || farmHectares > 10000) {
      showToast("Las hectáreas de la finca deben ser mayores a 0.", "error");
      return;
    }
    if (farmSector.length < 2) {
      showToast("Ingresa el sector o ubicación de la finca.", "error");
      return;
    }
    if (lastSpray && !isValidDateStr(lastSpray)) {
      showToast("La fecha de última fumigación no es válida.", "error");
      return;
    }
    farmHectares = roundHectares(farmHectares);
  }

  if (prodId) {
    const prod = state.producers.find(p => p.id === prodId);
    if (!prod) return;

    if (isEditingProducerFields) {
      prod.name = name;
      prod.doc = normalizedDoc;
      prod.phone = normalizedPhone;
    }
    if (!Array.isArray(prod.farms)) prod.farms = [];

    if (isEditingFarmFields && editingFarmId !== "NO_FARM") {
      if (editingFarmId === "NEW_FARM") {
        prod.farms.push({
          id: generateUid("farm"),
          name: farmName,
          sector: farmSector,
          hectares: farmHectares,
          crop: farmCrop,
          lastSprayDate: lastSpray,
          manualLastSprayDate: lastSpray,
          rescheduledDate: null,
          rescheduleNote: "",
          rescheduleHistory: []
        });
      } else {
        const targetFarm = prod.farms.find(f => f.id === editingFarmId);
        if (targetFarm) {
          targetFarm.name = farmName;
          targetFarm.crop = farmCrop;
          targetFarm.hectares = farmHectares;
          targetFarm.sector = farmSector;
          if (lastSpray !== initialLastSpray) {
            targetFarm.manualLastSprayDate = lastSpray;
          } else if (lastSpray && !isValidDateStr(targetFarm.manualLastSprayDate)) {
            const hasCompleted = state.sprays.some(
              sp => sp.farmId === targetFarm.id && sp.status === "Realizada" && isValidDateStr(sp.date)
            );
            if (!hasCompleted) {
              targetFarm.manualLastSprayDate = lastSpray;
            }
          }
          syncFarmLastSprayFromHistory(targetFarm.id);
        }
      }
    }
  } else {
    state.producers.push({
      id: generateUid("prod"),
      name,
      doc: normalizedDoc,
      phone: normalizedPhone,
      farms: [{
        id: generateUid("farm"),
        name: farmName,
        sector: farmSector,
        hectares: farmHectares,
        crop: farmCrop,
        lastSprayDate: lastSpray,
        manualLastSprayDate: lastSpray,
        rescheduledDate: null,
        rescheduleNote: "",
        rescheduleHistory: []
      }]
    });
  }

  saveState(true);
  closeModal("producerModal");
  refreshAllViews();
  if (hasCedulaWarning) {
    showToast("Guardado con advertencia: el dígito verificador de la cédula no coincide (módulo 10 Ecuador).", "warning");
  } else {
    showToast("Datos guardados correctamente.", "success");
  }
}

function requestDeleteProducer(prodId) {
  const prod = state.producers.find(p => p.id === prodId);
  if (!prod) return;
  const farmIds = (prod.farms || []).map(f => f.id);
  const linkedSprays = state.sprays.filter(sp => farmIds.includes(sp.farmId));
  const linkedSpraysCount = linkedSprays.length;

  openConfirmModal(
    "Eliminar productor",
    `¿Seguro que deseas eliminar a "${prod.name}" (CI/RUC ${prod.doc})? Se eliminarán también sus ${farmIds.length} finca(s) y ${linkedSpraysCount} fumigación(es) asociadas. Esta acción no se puede deshacer.`,
    () => {
      releaseSprayDjiFlightKeys(linkedSprays);
      state.producers = state.producers.filter(p => p.id !== prodId);
      state.sprays = state.sprays.filter(sp => !farmIds.includes(sp.farmId));
      saveState(true);
      refreshAllViews();
      showToast(`Productor "${prod.name}" eliminado.`, "info");
    },
    "Sí, eliminar productor",
    true
  );
}

function requestDeleteFarm(prodId, farmId) {
  const prod = state.producers.find(p => p.id === prodId);
  if (!prod) return;
  const farm = (prod.farms || []).find(f => f.id === farmId);
  if (!farm) return;
  const linkedSprays = state.sprays.filter(sp => sp.farmId === farmId);
  const linkedSpraysCount = linkedSprays.length;

  openConfirmModal(
    "Eliminar finca",
    `¿Seguro que deseas eliminar la finca "${farm.name}" de ${prod.name}? También se eliminarán ${linkedSpraysCount} fumigación(es) registradas en esta finca.`,
    () => {
      releaseSprayDjiFlightKeys(linkedSprays);
      prod.farms = prod.farms.filter(f => f.id !== farmId);
      state.sprays = state.sprays.filter(sp => sp.farmId !== farmId);
      saveState(true);
      refreshAllViews();
      showToast(`Finca "${farm.name}" eliminada.`, "info");
    },
    "Sí, eliminar finca",
    true
  );
}

// ==========================================================================
// 5. TABLA Y CRUD DE FUMIGACIONES (DEVENGADO VS ESTIMADO + TRANSICIONES)
// ==========================================================================
function renderPayStatusBadgeHtml(fin) {
  if (fin.payStatus === "Pagado") {
    return `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-brand-accent">Pagado</span>`;
  }
  if (fin.payStatus === "Parcial") {
    return `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300">Parcial (${formatMoney(fin.paidAmount)})</span>`;
  }
  if (fin.payStatus === "Saldo a favor") {
    return `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-brand-blue/20 text-brand-blue">Saldo a favor (+${formatMoney(fin.creditFavor)})</span>`;
  }
  if (fin.payStatus === "Anticipo") {
    return `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-brand-blue/20 text-brand-blue">Anticipo (${formatMoney(fin.creditFavor)})</span>`;
  }
  if (fin.payStatus === "No exigible") {
    return `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-700/70 text-slate-300">Estimado (no exigible)</span>`;
  }
  return `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-300">Pendiente</span>`;
}

function renderSpraysTable() {
  const tbody = document.getElementById("spraysTableBody");
  if (!tbody) return;

  const statusFilterEl = document.getElementById("filterSprayStatusSelect");
  const statusFilter = statusFilterEl ? statusFilterEl.value : "ALL";

  const filtered = state.sprays
    .filter(sp => statusFilter === "ALL" || sp.status === statusFilter)
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-xs text-slate-400">No hay fumigaciones registradas para este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(sp => {
    const farm = getFarmById(sp.farmId);
    const prod = farm ? getProducerByFarmId(farm.id) : null;
    const fin = getSprayFinancials(sp);

    let sprayStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-brand-accent border border-brand-accent/35">Realizada</span>`;
    if (sp.status === "Pendiente") {
      sprayStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-brand-blue/20 text-brand-blue border border-brand-blue/35">Pendiente</span>`;
    } else if (sp.status === "Reprogramada") {
      sprayStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35">Reprogramada</span>`;
    }

    const productsSummary = Array.isArray(sp.products) && sp.products.length > 0
      ? sp.products.map(pr => pr.commercialName).filter(Boolean).join(", ")
      : (sp.product || "N/A");

    // Regla estricta: solo órdenes Realizadas devengan pago al piloto
    let pilotDepositHtml = "";
    if (!fin.isRealized) {
      pilotDepositHtml = `<span class="text-[10px] text-slate-400 italic">Estimado ${formatMoney(fin.pilotPayEstimated)} (no devengado)</span>`;
    } else if (fin.pilotPaid) {
      pilotDepositHtml = `
        <span class="inline-flex items-center space-x-1 text-[10px] text-emerald-400 font-semibold">
          <i data-lucide="circle-check" class="w-3 h-3"></i>
          <span>Depositado (${formatMoney(fin.pilotPayAccrued)})</span>
        </span>
        <button type="button" data-action="unmark-pilot-paid" data-spray-id="${escapeHtml(sp.id)}" class="inline-flex items-center space-x-0.5 ml-1 text-[10px] text-slate-400 underline hover:text-rose-300" title="Revertir pago al piloto">
          <i data-lucide="undo-2" class="w-3 h-3"></i>
          <span>Revertir</span>
        </button>
      `;
    } else {
      pilotDepositHtml = `
        <button type="button" data-action="mark-pilot-paid" data-spray-id="${escapeHtml(sp.id)}" class="inline-flex items-center space-x-1 text-[10px] text-brand-blue underline hover:text-white font-semibold">
          <i data-lucide="banknote" class="w-3.5 h-3.5"></i>
          <span>Depositar ${formatMoney(fin.pilotPayAccrued)}</span>
        </button>
      `;
    }

    const discountOrIvaMeta = [];
    if (fin.discountPct > 0) discountOrIvaMeta.push(`Desc. ${fin.discountPct}%`);
    if (fin.ivaPct > 0) discountOrIvaMeta.push(`IVA ${fin.ivaPct}%`);

    return `
      <tr class="hover:bg-slate-900/55 transition-colors">
        <td data-label="Fecha / Orden" class="py-3 px-3 font-semibold text-white lg:whitespace-nowrap">
          <div>${escapeHtml(sp.date)}</div>
          <div class="text-[10px] font-mono text-brand-blue">${escapeHtml(sp.orderNumber || "")}</div>
        </td>
        <td data-label="Productor / Finca" class="py-3 px-3">
          <div class="font-bold text-white">${escapeHtml(farm ? farm.name : "Finca eliminada")}</div>
          <div class="text-[11px] text-slate-300">${escapeHtml(prod ? prod.name : "")}</div>
        </td>
        <td data-label="Hectáreas" class="py-3 px-3 font-bold text-brand-accent lg:whitespace-nowrap">${formatHectares(fin.hectares)} ha</td>
        <td data-label="Producto / Dron" class="py-3 px-3">
          <div class="text-slate-100">${escapeHtml(productsSummary)}</div>
          <div class="text-[11px] text-brand-blue">${escapeHtml(sp.drone)}</div>
        </td>
        <td data-label="Piloto" class="py-3 px-3 text-slate-200">
          <div>${escapeHtml(sp.pilot)}</div>
          <div>${pilotDepositHtml}</div>
        </td>
        <td data-label="Monto / Abonos" class="py-3 px-3">
          <div class="font-bold text-white">
            ${formatMoney(fin.totalClient)}
            ${fin.collectibleBalance > 0 ? `<span class="text-[10px] text-amber-300">(Saldo ${formatMoney(fin.collectibleBalance)})</span>` : ""}
          </div>
          ${discountOrIvaMeta.length > 0 ? `<div class="text-[10px] text-emerald-300">${discountOrIvaMeta.join(" • ")}</div>` : ""}
          <div class="text-[11px] text-slate-300">${escapeHtml(fin.primaryMethodDisplay)}${fin.activePaymentsCount > 1 ? ` (${fin.activePaymentsCount} abonos)` : ""}</div>
          <div class="mt-0.5">${renderPayStatusBadgeHtml(fin)}</div>
        </td>
        <td data-label="Estado / Motivo" class="py-3 px-3">
          <div>${sprayStatusBadge}</div>
          ${sp.rescheduleDescription ? `<div class="text-[11px] text-amber-200 mt-1 lg:max-w-[180px]">${escapeHtml(sp.rescheduleDescription)}</div>` : ""}
        </td>
        <td data-label="Acciones" data-cell-actions="true" class="py-3 px-3 lg:text-right lg:whitespace-nowrap">
          <div class="flex flex-wrap items-center justify-start lg:justify-end gap-1.5">
            ${sp.status !== "Realizada" && farm ? `<button type="button" data-action="open-reschedule-modal" data-farm-id="${escapeHtml(sp.farmId)}" data-spray-id="${escapeHtml(sp.id)}" class="inline-flex items-center space-x-1 px-2 py-1.5 bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 rounded-lg text-[11px] font-bold border border-amber-500/35"><i data-lucide="calendar-clock" class="w-3.5 h-3.5"></i><span>Reprog.</span></button>` : ""}
            <button type="button" data-action="open-payment-modal" data-spray-id="${escapeHtml(sp.id)}" class="inline-flex items-center space-x-1 px-2 py-1.5 bg-emerald-500/15 text-brand-accent hover:bg-emerald-500/30 rounded-lg text-[11px] font-bold border border-brand-accent/35" title="Ver o registrar abonos">
              <i data-lucide="wallet" class="w-3.5 h-3.5"></i>
              <span>Abonos</span>
            </button>
            <button type="button" data-action="open-spray-pdf-modal" data-spray-id="${escapeHtml(sp.id)}" class="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-brand-blue/20 text-brand-blue hover:bg-brand-blue/35 rounded-lg text-xs font-bold border border-brand-blue/35" title="Generar PDF de esta fumigación">
              <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
              <span>PDF</span>
            </button>
            <button type="button" data-action="open-spray-modal" data-spray-id="${escapeHtml(sp.id)}" class="p-1.5 bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-brand-border align-middle" title="Editar fumigación">
              <i data-lucide="pencil" class="w-4 h-4"></i>
            </button>
            <button type="button" data-action="delete-spray" data-spray-id="${escapeHtml(sp.id)}" class="p-1.5 bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 rounded-lg border border-rose-500/30 align-middle" title="Eliminar fumigación">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  safeRefreshIcons();
}

function requestMarkPilotAsPaid(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  if (sp.status !== "Realizada") {
    showToast("No se puede registrar depósito al piloto en una orden que aún no está Realizada.", "error");
    return;
  }
  const fin = getSprayFinancials(sp);
  openConfirmModal(
    "Confirmar depósito devengado al piloto",
    `¿Marcar como depositado el pago devengado de ${formatMoney(fin.pilotPayAccrued)} al piloto ${sp.pilot} (Orden ${sp.orderNumber})?`,
    () => {
      sp.pilotPaid = true;
      saveState(true);
      refreshAllViews();
      showToast("Depósito al piloto marcado como pagado.", "success");
    },
    "Sí, marcar depositado",
    false
  );
}

function requestUnmarkPilotAsPaid(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp || !sp.pilotPaid) return;
  const fin = getSprayFinancials(sp);
  openConfirmModal(
    "Revertir depósito al piloto",
    `¿Revertir a "Pendiente de depositar" el pago de ${formatMoney(fin.pilotPayAmount)} del piloto ${sp.pilot} en la orden ${sp.orderNumber}?`,
    () => {
      sp.pilotPaid = false;
      saveState(true);
      refreshAllViews();
      showToast("El pago al piloto volvió a estado pendiente de depositar.", "info");
    },
    "Sí, revertir pago",
    true
  );
}

function populatePilotAndDroneSelects(selectedPilot = "", selectedDrone = "") {
  const pilotSel = document.getElementById("sprayPilot");
  const droneSel = document.getElementById("sprayDrone");
  const pilots = [...(state.config.pilots || ["Ing. Diego Vera"])];
  const drones = [...(state.config.drones || ["DJI Agras T40 #1"])];
  if (selectedPilot && !pilots.includes(selectedPilot)) pilots.push(selectedPilot);
  if (selectedDrone && !drones.includes(selectedDrone)) drones.push(selectedDrone);

  pilotSel.innerHTML = pilots.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  droneSel.innerHTML = drones.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  if (selectedPilot) pilotSel.value = selectedPilot;
  if (selectedDrone) droneSel.value = selectedDrone;
}

function addProductRowToSprayForm(prodItem = {}) {
  const container = document.getElementById("sprayProductsContainer");
  const row = document.createElement("div");
  row.className = "spray-product-row grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 p-2 rounded-xl bg-slate-900/90 border border-brand-border items-center";
  row.innerHTML = `
    <input type="text" class="prod-name sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Nombre comercial *" value="${escapeHtml(prodItem.commercialName || "")}" required>
    <input type="text" class="prod-active px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Ing. activo (opc.)" value="${escapeHtml(prodItem.activeIngredient || "")}">
    <input type="text" class="prod-dose px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Dosis/ha" value="${escapeHtml(prodItem.dosePerHa || "")}">
    <input type="text" class="prod-vol px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Vol. total" value="${escapeHtml(prodItem.totalVolume || "")}">
    <div class="flex items-center space-x-1">
      <input type="text" class="prod-lot w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Lote" value="${escapeHtml(prodItem.batchLot || "")}">
      <button type="button" data-action="remove-spray-product" class="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg shrink-0" title="Quitar producto">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `;
  container.appendChild(row);
  safeRefreshIcons();
}

function removeProductRow(btn) {
  const container = document.getElementById("sprayProductsContainer");
  if (container.querySelectorAll(".spray-product-row").length > 1) {
    const row = btn.closest(".spray-product-row");
    if (row) row.remove();
  } else {
    showToast("Debe existir al menos un producto en la fumigación.", "warning");
  }
}

function updateSprayPricingBreakdownLabel(calc) {
  const lbl = document.getElementById("sprayPricingBreakdown");
  if (!lbl) return;
  const parts = [`Subtotal: ${formatMoney(calc.subtotal)}`];
  if (calc.discount > 0) parts.push(`Desc (${calc.discountPct}%): -${formatMoney(calc.discount)}`);
  if (calc.iva > 0) parts.push(`IVA (${calc.ivaPct}%): +${formatMoney(calc.iva)}`);
  parts.push(`Total: ${formatMoney(calc.totalClient)}`);
  lbl.textContent = parts.join(" • ");
}

function onSprayPricingChanged() {
  const ha = Math.max(0, parseFloat(document.getElementById("sprayHectares").value) || 0);
  const rawRate = document.getElementById("sprayUnitRateHa").value;
  const unitRate = rawRate === "" ? state.config.clientRatePerHa : Math.max(0, parseFloat(rawRate) || 0);
  const disc = Math.min(100, Math.max(0, parseFloat(document.getElementById("sprayDiscountPct").value) || 0));
  const iva = Math.min(100, Math.max(0, parseFloat(document.getElementById("sprayIvaPct").value) || 0));

  const calc = computeSprayFinancials({
    pricingMode: "v5",
    status: "Realizada",
    hectares: ha,
    unitRateHa: unitRate,
    discountPct: disc,
    ivaPct: iva,
    payments: []
  }, state.config);

  document.getElementById("sprayAmount").value = calc.totalClient.toFixed(2);
  document.getElementById("sprayPilotPay").value = calc.pilotPayAmount.toFixed(2);
  updateSprayPricingBreakdownLabel(calc);
}

function openSprayModal(sprayId = null) {
  const farms = getAllFarms();
  if (farms.length === 0) {
    showToast("Primero debes registrar al menos un productor y una finca.", "warning");
    return;
  }

  const select = document.getElementById("sprayFarmSelect");
  select.innerHTML = farms.map(f => {
    const p = getProducerByFarmId(f.id);
    return `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)} (${escapeHtml(p ? p.name : "")} - ${escapeHtml(f.crop)})</option>`;
  }).join("");

  const productsContainer = document.getElementById("sprayProductsContainer");
  productsContainer.innerHTML = "";
  const existingNotice = document.getElementById("sprayExistingPaymentsNotice");
  const initialPaySec = document.getElementById("sprayInitialPaymentSection");

  if (sprayId) {
    const sp = state.sprays.find(s => s.id === sprayId);
    if (!sp) return;
    const fin = getSprayFinancials(sp);

    document.getElementById("sprayModalTitle").textContent = "Editar Fumigación";
    document.getElementById("sprayEditId").value = sp.id;
    select.value = sp.farmId;
    document.getElementById("sprayOrderNumber").value = sp.orderNumber || "";
    document.getElementById("sprayStatus").value = sp.status || "Realizada";
    document.getElementById("sprayDate").value = sp.date;
    document.getElementById("sprayHectares").value = fin.hectares;
    populatePilotAndDroneSelects(sp.pilot, sp.drone);

    const prods = Array.isArray(sp.products) && sp.products.length > 0
      ? sp.products
      : [{ commercialName: sp.product || "", activeIngredient: "", dosePerHa: "", totalVolume: "", batchLot: "" }];
    prods.forEach(pr => addProductRowToSprayForm(pr));

    document.getElementById("sprayNotes").value = sp.notes || "";
    document.getElementById("sprayUnitRateHa").value = fin.unitRateHa.toFixed(2);
    document.getElementById("sprayDiscountPct").value = fin.discountPct;
    document.getElementById("sprayIvaPct").value = fin.ivaPct;
    document.getElementById("sprayAmount").value = fin.totalClient.toFixed(2);
    document.getElementById("sprayPilotPay").value = fin.pilotPayAmount.toFixed(2);
    document.getElementById("sprayPilotPaid").value = sp.pilotPaid ? "true" : "false";
    updateSprayPricingBreakdownLabel(fin);

    if (fin.payments && fin.payments.length > 0) {
      existingNotice.innerHTML = `Esta orden ya cuenta con <strong>${fin.activePaymentsCount} abono(s) vigente(s) (${formatMoney(fin.paidAmount)})</strong> en su libro auditable. Los abonos existentes se conservarán intactos al guardar; para agregar o anular pagos usa el botón <strong>Abonos</strong>.`;
      existingNotice.classList.remove("hidden");
      initialPaySec.classList.add("hidden");
    } else {
      existingNotice.classList.add("hidden");
      initialPaySec.classList.remove("hidden");
      document.getElementById("sprayPayMethod").value = sp.payMethod || "Transferencia";
      document.getElementById("sprayPayRef").value = sp.payRef || "";
      document.getElementById("sprayPayBank").value = sp.payBank || "";
      document.getElementById("sprayPayStatus").value = "Pendiente";
      document.getElementById("sprayAmountPaid").value = "0.00";
    }
  } else {
    document.getElementById("sprayForm").reset();
    document.getElementById("sprayModalTitle").textContent = "Registrar Nueva Fumigación";
    document.getElementById("sprayEditId").value = "";
    document.getElementById("sprayStatus").value = "Realizada";
    const todayStr = getGuayaquilTodayStr();
    document.getElementById("sprayDate").value = todayStr;
    document.getElementById("sprayOrderNumber").value = generateNextOrderNumber(todayStr);
    document.getElementById("sprayUnitRateHa").value = (state.config.clientRatePerHa ?? 15).toFixed(2);
    document.getElementById("sprayDiscountPct").value = "0";
    document.getElementById("sprayIvaPct").value = String(state.config.defaultIvaPct ?? 0);
    document.getElementById("sprayPayStatus").value = "Pendiente";
    existingNotice.classList.add("hidden");
    initialPaySec.classList.remove("hidden");
    populatePilotAndDroneSelects();
    addProductRowToSprayForm({});
    onSprayFarmSelected();
  }

  togglePaymentRefFields();
  togglePartialPaidField();
  document.getElementById("sprayModal").classList.remove("hidden");
  safeRefreshIcons();
}

function onSprayFarmSelected() {
  const editId = document.getElementById("sprayEditId").value;
  if (editId) return;
  const farmId = document.getElementById("sprayFarmSelect").value;
  const farm = getFarmById(farmId);
  if (farm) {
    document.getElementById("sprayHectares").value = roundHectares(farm.hectares);
    onSprayPricingChanged();
  }
}

function togglePaymentRefFields() {
  const method = document.getElementById("sprayPayMethod").value;
  const refLabel = document.getElementById("payRefLabel");
  const bankGroup = document.getElementById("payBankGroup");

  if (method === "Transferencia") {
    refLabel.textContent = "N.º Comprobante Transferencia";
    bankGroup.classList.remove("hidden");
  } else if (method === "Cheque") {
    refLabel.textContent = "N.º Cheque";
    bankGroup.classList.remove("hidden");
  } else {
    refLabel.textContent = "Referencia / Recibo Efectivo";
    bankGroup.classList.add("hidden");
  }
}

function togglePartialPaidField() {
  const status = document.getElementById("sprayPayStatus").value;
  const group = document.getElementById("partialPaidGroup");
  if (status === "Parcial") group.classList.remove("hidden");
  else group.classList.add("hidden");
}

function saveSprayForm(e) {
  e.preventDefault();
  const editId = document.getElementById("sprayEditId").value;
  const farmId = document.getElementById("sprayFarmSelect").value;
  const date = document.getElementById("sprayDate").value;
  const orderNumber = document.getElementById("sprayOrderNumber").value.trim() || generateNextOrderNumber(date);
  const status = document.getElementById("sprayStatus").value;
  const hectares = parseFloat(document.getElementById("sprayHectares").value);
  const unitRateRaw = document.getElementById("sprayUnitRateHa").value;
  const unitRateHa = unitRateRaw === "" ? state.config.clientRatePerHa : parseFloat(unitRateRaw);
  const discountPct = parseFloat(document.getElementById("sprayDiscountPct").value || "0");
  const ivaPct = parseFloat(document.getElementById("sprayIvaPct").value || "0");
  const drone = document.getElementById("sprayDrone").value;
  const pilot = document.getElementById("sprayPilot").value;
  const notes = document.getElementById("sprayNotes").value.trim();
  const amount = parseFloat(document.getElementById("sprayAmount").value);
  const pilotPayRaw = parseFloat(document.getElementById("sprayPilotPay").value);
  let pilotPaid = document.getElementById("sprayPilotPaid").value === "true";

  if (!getFarmById(farmId)) {
    showToast("Selecciona una finca válida.", "error");
    return;
  }
  if (!isValidDateStr(date)) {
    showToast("Ingresa una fecha de fumigación válida.", "error");
    return;
  }
  if (!Number.isFinite(hectares) || hectares <= 0 || hectares > 10000) {
    showToast("Las hectáreas deben ser mayores a 0.", "error");
    return;
  }
  if (!Number.isFinite(unitRateHa) || unitRateHa < 0) {
    showToast("La tarifa por hectárea debe ser mayor o igual a $0.00.", "error");
    return;
  }
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    showToast("El descuento debe estar entre 0% y 100%.", "error");
    return;
  }
  if (!Number.isFinite(ivaPct) || ivaPct < 0 || ivaPct > 100) {
    showToast("El IVA debe estar entre 0% y 100%.", "error");
    return;
  }
  if (!Number.isFinite(amount) || amount < 0) {
    showToast("El monto total del cliente debe ser mayor o igual a $0.00.", "error");
    return;
  }
  if (status !== "Realizada" && pilotPaid) {
    showToast("No puedes marcar como depositado el pago al piloto en una orden que aún no está Realizada.", "error");
    return;
  }

  const pilotPay = Number.isFinite(pilotPayRaw) && pilotPayRaw >= 0 ? roundMoney(pilotPayRaw) : 0;

  const products = [];
  document.querySelectorAll("#sprayProductsContainer .spray-product-row").forEach(row => {
    const commercialName = row.querySelector(".prod-name").value.trim();
    if (commercialName) {
      products.push({
        commercialName,
        activeIngredient: row.querySelector(".prod-active").value.trim(),
        dosePerHa: row.querySelector(".prod-dose").value.trim(),
        totalVolume: row.querySelector(".prod-vol").value.trim(),
        batchLot: row.querySelector(".prod-lot").value.trim()
      });
    }
  });

  if (products.length === 0) {
    showToast("Agrega al menos un producto con nombre comercial.", "error");
    return;
  }

  const existingSpray = editId ? state.sprays.find(s => s.id === editId) : null;
  if (existingSpray) {
    const guard = canTransitionSprayStatus(existingSpray, status, state.config);
    if (!guard.allowed) {
      showToast(guard.reason, "error");
      return;
    }
    if (guard.requiresConfirm) {
      openConfirmModal(
        "Confirmar cambio de estado con abonos",
        guard.message,
        () => commitSprayFormSave({
          existingSpray, farmId, date, orderNumber, status, hectares,
          unitRateHa, discountPct, ivaPct, drone, pilot, notes, amount, pilotPay, pilotPaid, products
        }),
        "Sí, conservar anticipo y cambiar",
        false
      );
      return;
    }
  }

  commitSprayFormSave({
    existingSpray, farmId, date, orderNumber, status, hectares,
    unitRateHa, discountPct, ivaPct, drone, pilot, notes, amount, pilotPay, pilotPaid, products
  });
}

function commitSprayFormSave(payload) {
  const {
    existingSpray, farmId, date, orderNumber, status, hectares,
    unitRateHa, discountPct, ivaPct, drone, pilot, notes, amount, pilotPay, pilotPaid, products
  } = payload;

  const hasExistingPayments = Boolean(existingSpray && Array.isArray(existingSpray.payments) && existingSpray.payments.length > 0);
  let payments = hasExistingPayments ? existingSpray.payments : [];
  let payMethod = existingSpray ? existingSpray.payMethod : document.getElementById("sprayPayMethod").value;
  let payRef = existingSpray ? existingSpray.payRef : document.getElementById("sprayPayRef").value.trim();
  let payBank = existingSpray ? existingSpray.payBank : (payMethod === "Efectivo" ? "" : document.getElementById("sprayPayBank").value.trim());

  if (!hasExistingPayments) {
    payMethod = document.getElementById("sprayPayMethod").value;
    payRef = document.getElementById("sprayPayRef").value.trim();
    payBank = payMethod === "Efectivo" ? "" : document.getElementById("sprayPayBank").value.trim();
    const initialStatus = document.getElementById("sprayPayStatus").value;
    let initialCents = 0;
    if (initialStatus === "Pagado") {
      initialCents = toSafeCents(amount);
    } else if (initialStatus === "Parcial") {
      const rawPaid = parseFloat(document.getElementById("sprayAmountPaid").value);
      if (!Number.isFinite(rawPaid) || rawPaid <= 0) {
        showToast("En pago parcial o anticipo, el monto abonado debe ser mayor a $0.00.", "error");
        return;
      }
      initialCents = toSafeCents(rawPaid);
    }
    if (initialCents > 0) {
      payments = [normalizePaymentMovement({
        id: generateUid("pay"),
        date,
        amountCents: initialCents,
        method: payMethod,
        ref: payRef,
        bank: payBank,
        note: "Pago inicial al registrar la orden",
        voided: false,
        createdAt: new Date().toISOString()
      }, 0, date)];
    }
  }

  const formulaCalc = computeSprayFinancials({
    pricingMode: "v5",
    status,
    hectares: roundHectares(hectares),
    unitRateHa: roundMoney(unitRateHa),
    discountPct: roundMoney(discountPct),
    ivaPct: roundMoney(ivaPct),
    payments
  }, state.config);

  const manualOverride = toSafeCents(amount) !== formulaCalc.totalClientCents
    ? roundMoney(amount)
    : undefined;

  const updatedFields = {
    orderNumber,
    status,
    farmId,
    date,
    hectares: roundHectares(hectares),
    pricingMode: "v5",
    unitRateHa: roundMoney(unitRateHa),
    discountPct: roundMoney(discountPct),
    ivaPct: roundMoney(ivaPct),
    manualTotalOverride: manualOverride,
    payments,
    product: products.map(p => p.commercialName).join(", "),
    products,
    drone,
    pilot,
    pilotPay,
    pilotPaid: status === "Realizada" ? pilotPaid : false,
    notes,
    payMethod,
    payRef,
    payBank
  };

  let previousFarmId = null;
  if (existingSpray) {
    previousFarmId = existingSpray.farmId;
    Object.assign(existingSpray, updatedFields);
    if (manualOverride === undefined) delete existingSpray.manualTotalOverride;
    const fin = computeSprayFinancials(existingSpray, state.config);
    existingSpray.subtotal = fin.subtotal;
    existingSpray.discount = fin.discount;
    existingSpray.taxableBase = fin.taxableBase;
    existingSpray.iva = fin.iva;
    existingSpray.amount = fin.totalClient;
    existingSpray.amountPaid = fin.paidAmount;
    existingSpray.payStatus = fin.payStatus;
  } else {
    const newSp = {
      id: generateUid("sp"),
      rescheduleDescription: "",
      ...updatedFields
    };
    if (manualOverride === undefined) delete newSp.manualTotalOverride;
    const fin = computeSprayFinancials(newSp, state.config);
    newSp.subtotal = fin.subtotal;
    newSp.discount = fin.discount;
    newSp.taxableBase = fin.taxableBase;
    newSp.iva = fin.iva;
    newSp.amount = fin.totalClient;
    newSp.amountPaid = fin.paidAmount;
    newSp.payStatus = fin.payStatus;
    state.sprays.unshift(newSp);
  }

  syncFarmLastSprayFromHistory(farmId);
  if (previousFarmId && previousFarmId !== farmId) {
    syncFarmLastSprayFromHistory(previousFarmId);
  }

  saveState(true);
  closeModal("sprayModal");
  refreshAllViews();
  showToast("Fumigación guardada correctamente.", "success");
}

function requestDeleteSpray(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  const farm = getFarmById(sp.farmId);

  openConfirmModal(
    "Eliminar fumigación",
    `¿Seguro que deseas eliminar la fumigación ${sp.orderNumber || ""} (${sp.date}) de ${farm ? farm.name : "esta finca"}? Se recalculará la última fecha de fumigación de la finca.`,
    () => {
      const targetFarmId = sp.farmId;
      releaseSprayDjiFlightKeys([sp]);
      state.sprays = state.sprays.filter(s => s.id !== sprayId);
      syncFarmLastSprayFromHistory(targetFarmId);
      saveState(true);
      refreshAllViews();
      showToast("Fumigación eliminada correctamente.", "info");
    },
    "Sí, eliminar",
    true
  );
}

// ==========================================================================
// 6. CALENDARIO MENSUAL
// ==========================================================================
function renderCalendar() {
  const year = state.calendarYear;
  const month = state.calendarMonth;

  document.getElementById("calendarMonthTitle").textContent = `${MONTH_NAMES_FULL[month]} ${year}`;

  const firstDayIdx = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const grid = document.getElementById("calendarGrid");
  const summaryList = document.getElementById("calendarMonthSummaryList");
  const todayStr = getGuayaquilTodayStr();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const farms = getAllFarms();
  const schedules = farms.map(f => ({
    farm: f,
    prod: getProducerByFarmId(f.id),
    sched: calculateFarmSchedule(f)
  }));

  let gridHtml = "";
  for (let i = 0; i < firstDayIdx; i++) {
    gridHtml += `<div class="p-1 sm:p-2 bg-slate-950/30 rounded-lg sm:rounded-xl border border-brand-border/20 opacity-40 min-w-0"></div>`;
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${monthPrefix}-${String(day).padStart(2, "0")}`;
    const isToday = dateStr === todayStr;
    let itemsHtml = "";

    schedules.forEach(({ farm, sched }) => {
      if (sched.hasReschedule) {
        if (sched.rescheduledDate === dateStr) {
          itemsHtml += `<button type="button" data-action="open-reschedule-modal" data-farm-id="${escapeHtml(farm.id)}" class="w-full text-left cursor-pointer text-[9px] sm:text-[10px] leading-tight px-1 sm:px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-200 border border-amber-400/50 font-bold truncate hover:bg-amber-500/35" title="Reprogramada: ${escapeHtml(farm.name)} (${escapeHtml(sched.rescheduleDescription)})">Reprog: ${escapeHtml(farm.name)}</button>`;
        }
      } else if (sched.baseDateStr === dateStr) {
        itemsHtml += `<button type="button" data-action="open-reschedule-modal" data-farm-id="${escapeHtml(farm.id)}" class="w-full text-left cursor-pointer text-[9px] sm:text-[10px] leading-tight px-1 sm:px-1.5 py-0.5 rounded bg-emerald-500/20 text-brand-accent border border-brand-accent/40 font-semibold truncate hover:bg-emerald-500/30" title="Fecha Base: ${escapeHtml(farm.name)}">${escapeHtml(farm.name)}</button>`;
      }
    });

    gridHtml += `
      <div class="p-1 sm:p-2 rounded-lg sm:rounded-xl border min-h-[58px] sm:min-h-[78px] min-w-0 overflow-hidden flex flex-col justify-start ${isToday ? "bg-brand-accent/15 border-brand-accent/65 shadow-inner" : "bg-slate-900/55 border-brand-border/60"}">
        <div class="flex items-center justify-between gap-0.5 mb-1">
          <span class="text-[11px] sm:text-xs font-bold ${isToday ? "text-brand-accent" : "text-white"}">${day}</span>
          ${isToday ? '<span class="hidden sm:inline-block text-[9px] font-extrabold text-black bg-brand-accent px-1.5 rounded">HOY</span><span class="sm:hidden w-1.5 h-1.5 rounded-full bg-brand-accent shrink-0" title="Hoy"></span>' : ""}
        </div>
        <div class="space-y-1 min-w-0">${itemsHtml}</div>
      </div>
    `;
  }

  grid.innerHTML = gridHtml;

  if (summaryList) {
    const monthEvents = schedules
      .filter(({ sched }) => sched.effectiveDateStr && sched.effectiveDateStr.startsWith(monthPrefix))
      .sort((a, b) => a.sched.effectiveDateStr.localeCompare(b.sched.effectiveDateStr));

    if (monthEvents.length === 0) {
      summaryList.innerHTML = `<p class="text-xs text-slate-400 italic col-span-2">No hay fumigaciones programadas para ${MONTH_NAMES_FULL[month]} ${year}.</p>`;
    } else {
      summaryList.innerHTML = monthEvents.map(({ farm, prod, sched }) => `
        <div class="p-3 rounded-xl bg-slate-950/70 border ${sched.hasReschedule ? "border-amber-500/40" : "border-brand-border"} flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-xs font-bold text-white truncate">${formatDisplayDate(sched.effectiveDateStr)} • ${escapeHtml(farm.name)}</div>
            <div class="text-[11px] text-slate-300 truncate">${escapeHtml(prod ? prod.name : "")} • ${sched.hasReschedule ? `Reprogramada: ${escapeHtml(sched.rescheduleDescription)}` : `Base (+${sched.daysToAdd}d)`}</div>
          </div>
          <button type="button" data-action="open-reschedule-modal" data-farm-id="${escapeHtml(farm.id)}" class="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 text-[11px] font-bold shrink-0">
            <i data-lucide="calendar-clock" class="w-3.5 h-3.5"></i>
            <span>Reprog.</span>
          </button>
        </div>
      `).join("");
    }
  }

  safeRefreshIcons();
}

function changeCalendarMonth(offset) {
  let m = state.calendarMonth + offset;
  let y = state.calendarYear;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  state.calendarMonth = m;
  state.calendarYear = y;
  saveState(false);
  renderCalendar();
}

function resetCalendarToToday() {
  const [yStr, mStr] = getGuayaquilTodayStr().split("-");
  state.calendarYear = parseInt(yStr, 10);
  state.calendarMonth = parseInt(mStr, 10) - 1;
  saveState(false);
  renderCalendar();
}

// ==========================================================================
// 7. COBROS, CARTERA Y LIBRO AUDITABLE DE ABONOS MÚLTIPLES
// ==========================================================================
function renderBillingTable() {
  const tbody = document.getElementById("billingTableBody");
  const summaryEl = document.getElementById("billingSummaryCards");
  if (!tbody || !summaryEl) return;

  const filterEl = document.getElementById("filterBillingStatusSelect");
  const filterVal = filterEl ? filterEl.value : "ALL";

  const summary = computePortfolioSummary(state.sprays, state.config);
  const totalCreditsAndAdvances = roundMoney(summary.creditFavorTotal + summary.advancesOnPendingTotal);

  summaryEl.innerHTML = `
    <div class="glass-card p-4 rounded-2xl border border-brand-blue/35">
      <div class="text-[11px] text-slate-300 uppercase font-bold">Transferencias (Cobrado)</div>
      <div class="text-2xl font-black text-brand-blue mt-1">${formatMoney(summary.collectedByMethod.Transferencia)}</div>
    </div>
    <div class="glass-card p-4 rounded-2xl border border-amber-500/35">
      <div class="text-[11px] text-slate-300 uppercase font-bold">Cheques (Cobrado)</div>
      <div class="text-2xl font-black text-amber-400 mt-1">${formatMoney(summary.collectedByMethod.Cheque)}</div>
    </div>
    <div class="glass-card p-4 rounded-2xl border border-brand-accent/35">
      <div class="text-[11px] text-slate-300 uppercase font-bold">Efectivo (Cobrado)</div>
      <div class="text-2xl font-black text-brand-accent mt-1">${formatMoney(summary.collectedByMethod.Efectivo)}</div>
    </div>
    <div class="glass-card p-4 rounded-2xl border border-rose-500/35">
      <div class="text-[11px] text-slate-300 uppercase font-bold">Por Cobrar (Devengado)</div>
      <div class="text-2xl font-black text-rose-400 mt-1">${formatMoney(summary.collectibleTotal)}</div>
      <div class="text-[10px] text-slate-300 mt-0.5">
        ${summary.billedEstimated > 0 ? `Est. no exigible: ${formatMoney(summary.billedEstimated)}` : "Sin órdenes estimadas"}
        ${totalCreditsAndAdvances > 0 ? ` • A favor/Anticipos: ${formatMoney(totalCreditsAndAdvances)}` : ""}
      </div>
    </div>
  `;

  const visibleSprays = state.sprays
    .filter(sp => {
      const fin = getSprayFinancials(sp);
      if (filterVal === "OPEN") return fin.isRealized && fin.collectibleBalance > 0;
      if (filterVal === "PAID") return fin.isRealized && fin.payStatus === "Pagado";
      if (filterVal === "CREDIT") return fin.creditFavor > 0;
      return true;
    })
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  if (visibleSprays.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-xs text-slate-400">No hay registros de cobro para este filtro.</td></tr>`;
    safeRefreshIcons();
    return;
  }

  tbody.innerHTML = visibleSprays.map(sp => {
    const farm = getFarmById(sp.farmId);
    const prod = farm ? getProducerByFarmId(farm.id) : null;
    const fin = getSprayFinancials(sp);

    const waBtn = fin.collectibleBalance > 0
      ? renderWhatsAppButtonHtml(prod, "payment", {
          nombre: prod ? prod.name : "",
          finca: farm ? farm.name : "",
          fecha: formatDisplayDate(sp.date, true),
          saldo: formatMoney(fin.collectibleBalance),
          monto: formatMoney(fin.totalClient)
        }, "Cobrar WA")
      : renderWhatsAppButtonHtml(prod, "reminder", {
          nombre: prod ? prod.name : "",
          finca: farm ? farm.name : "",
          fecha: farm && calculateFarmSchedule(farm).effectiveDateStr
            ? formatDisplayDate(calculateFarmSchedule(farm).effectiveDateStr)
            : "próxima fecha"
        }, "WhatsApp");

    let balanceSubHtml = `<div class="text-[11px] text-emerald-400">Liquidado</div>`;
    if (!fin.isRealized) {
      balanceSubHtml = fin.paidAmount > 0
        ? `<div class="text-[11px] text-brand-blue font-semibold">Anticipo: ${formatMoney(fin.paidAmount)}</div>`
        : `<div class="text-[11px] text-slate-400">Estimado (${escapeHtml(sp.status)})</div>`;
    } else if (fin.collectibleBalance > 0) {
      balanceSubHtml = `<div class="text-[11px] text-amber-400 font-semibold">Saldo: ${formatMoney(fin.collectibleBalance)}</div>`;
    } else if (fin.creditFavor > 0) {
      balanceSubHtml = `<div class="text-[11px] text-brand-blue font-semibold">A favor: +${formatMoney(fin.creditFavor)}</div>`;
    }

    const activePaymentsDesc = fin.activePaymentsCount === 0
      ? `<span class="text-slate-400">Sin abonos</span>`
      : `<div><strong class="text-brand-accent">${formatMoney(fin.paidAmount)}</strong> (${fin.activePaymentsCount} ${fin.activePaymentsCount === 1 ? "abono" : "abonos"})</div>
         <div class="text-[11px] text-brand-blue">${escapeHtml(fin.primaryMethodDisplay)}${fin.lastActivePayment && fin.lastActivePayment.ref ? ` • Ref: ${escapeHtml(fin.lastActivePayment.ref)}` : ""}</div>`;

    return `
      <tr class="hover:bg-slate-900/55 transition-colors">
        <td data-label="Fecha / Orden" class="py-3 px-3 font-medium text-white lg:whitespace-nowrap">
          <div>${escapeHtml(sp.date)}</div>
          <div class="text-[10px] font-mono text-brand-blue">${escapeHtml(sp.orderNumber || "")}</div>
        </td>
        <td data-label="Productor" class="py-3 px-3 font-bold text-white">${escapeHtml(prod ? prod.name : "N/A")}</td>
        <td data-label="Finca" class="py-3 px-3 text-slate-300">
          <div>${escapeHtml(farm ? farm.name : "N/A")}</div>
          ${!fin.isRealized ? `<span class="text-[10px] text-amber-300 font-semibold">${escapeHtml(sp.status)}</span>` : ""}
        </td>
        <td data-label="Total / Saldo" class="py-3 px-3">
          <div class="font-bold text-white">${formatMoney(fin.totalClient)}</div>
          ${balanceSubHtml}
        </td>
        <td data-label="Abonos / Métodos" class="py-3 px-3 text-xs text-slate-300">
          ${activePaymentsDesc}
        </td>
        <td data-label="Estado" class="py-3 px-3">${renderPayStatusBadgeHtml(fin)}</td>
        <td data-label="Acciones" data-cell-actions="true" class="py-3 px-3 lg:text-right lg:whitespace-nowrap">
          <div class="flex flex-wrap items-center justify-start lg:justify-end gap-1.5">
            <button type="button" data-action="open-payment-modal" data-spray-id="${escapeHtml(sp.id)}" class="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-brand-blue/20 text-brand-blue border border-brand-blue/40 font-bold rounded-lg text-xs hover:bg-brand-blue/35">
              <i data-lucide="wallet" class="w-3.5 h-3.5"></i>
              <span>${fin.collectibleBalance > 0 ? "Abonar" : "Historial / Abono"}</span>
            </button>
            ${fin.isRealized && fin.collectibleBalance > 0 ? `<button type="button" data-action="mark-spray-paid" data-spray-id="${escapeHtml(sp.id)}" class="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-brand-accent text-black font-bold rounded-lg text-xs hover:bg-emerald-300"><i data-lucide="circle-check" class="w-3.5 h-3.5"></i><span>Liquidar</span></button>` : ""}
            ${waBtn}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  safeRefreshIcons();
}

function toggleQuickPaymentBankField() {
  const method = document.getElementById("paymentMethod").value;
  const bankWrap = document.getElementById("paymentBankGroupModal");
  if (bankWrap) {
    bankWrap.classList.toggle("hidden", method === "Efectivo");
  }
}

function renderPaymentHistoryInsideModal(sp, fin) {
  const listEl = document.getElementById("paymentHistoryList");
  if (!listEl) return;

  const movements = Array.isArray(sp.payments) ? sp.payments : [];
  if (movements.length === 0) {
    listEl.innerHTML = `<p class="text-slate-400 italic py-1">Aún no hay abonos registrados en esta orden.</p>`;
    return;
  }

  listEl.innerHTML = movements.map(mov => {
    const isVoid = Boolean(mov.voided);
    return `
      <div class="p-2.5 rounded-xl border ${isVoid ? "bg-rose-950/20 border-rose-500/30 opacity-65" : "bg-slate-900/90 border-brand-border"} flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="font-bold ${isVoid ? "line-through text-slate-400" : "text-white"}">${formatMoney(mov.amount)}</span>
            <span class="px-1.5 py-0.5 rounded bg-slate-800 text-brand-blue font-semibold text-[10px]">${escapeHtml(mov.method)}</span>
            <span class="text-[11px] text-slate-400">${escapeHtml(mov.date)}</span>
            ${mov.migratedFromV4 ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">Migrado V4</span>` : ""}
            ${isVoid ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">Anulado</span>` : ""}
          </div>
          <div class="text-[11px] text-slate-300 truncate">
            ${mov.ref ? `Ref: <strong>${escapeHtml(mov.ref)}</strong>` : "Sin ref."}${mov.bank ? ` • ${escapeHtml(mov.bank)}` : ""}${mov.note ? ` • ${escapeHtml(mov.note)}` : ""}
          </div>
        </div>
        ${!isVoid ? `
          <button type="button" data-action="void-payment" data-spray-id="${escapeHtml(sp.id)}" data-payment-id="${escapeHtml(mov.id)}" class="inline-flex items-center space-x-1 px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] font-bold shrink-0" title="Anular este abono conservando auditoría">
            <i data-lucide="ban" class="w-3 h-3"></i>
            <span>Anular</span>
          </button>
        ` : ""}
      </div>
    `;
  }).join("");

  safeRefreshIcons(listEl);
}

function syncSpraySummaryFieldsFromLedger(sp) {
  const fin = computeSprayFinancials(sp, state.config);
  sp.amount = fin.totalClient;
  sp.amountPaid = fin.paidAmount;
  sp.payStatus = fin.payStatus;
  if (fin.lastActivePayment) {
    sp.payMethod = fin.lastActivePayment.method;
    sp.payRef = fin.lastActivePayment.ref;
    sp.payBank = fin.lastActivePayment.bank;
  }
  return fin;
}

function openPaymentModal(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  const farm = getFarmById(sp.farmId);
  const prod = farm ? getProducerByFarmId(farm.id) : null;
  const fin = getSprayFinancials(sp);

  document.getElementById("paymentForm").reset();
  document.getElementById("paymentSprayId").value = sp.id;
  document.getElementById("paymentDate").value = getGuayaquilTodayStr();
  document.getElementById("paymentModalSubtitle").textContent =
    `${prod ? prod.name : "Productor"} • ${farm ? farm.name : ""} (${sp.orderNumber || sp.date} • ${sp.status})`;
  document.getElementById("paymentInfoTotal").textContent = formatMoney(fin.totalClient);
  document.getElementById("paymentInfoPaid").textContent = formatMoney(fin.paidAmount);

  const balLabel = document.getElementById("paymentInfoBalanceLabel");
  const balEl = document.getElementById("paymentInfoBalance");
  if (!fin.isRealized) {
    balLabel.textContent = "Estado";
    balEl.textContent = fin.creditFavor > 0 ? `Anticipo ${formatMoney(fin.creditFavor)}` : "Estimado";
    balEl.className = "font-bold text-brand-blue";
  } else if (fin.creditFavor > 0) {
    balLabel.textContent = "Saldo a Favor";
    balEl.textContent = `+${formatMoney(fin.creditFavor)}`;
    balEl.className = "font-bold text-brand-blue";
  } else {
    balLabel.textContent = "Saldo Exigible";
    balEl.textContent = formatMoney(fin.collectibleBalance);
    balEl.className = fin.collectibleBalance > 0 ? "font-bold text-amber-400" : "font-bold text-brand-accent";
  }

  const addInput = document.getElementById("paymentAddAmount");
  const remaining = Math.max(0, roundMoney(fin.totalClient - fin.paidAmount));
  addInput.value = remaining > 0 ? remaining.toFixed(2) : "";
  addInput.removeAttribute("max");

  document.getElementById("paymentMethod").value = "Transferencia";
  toggleQuickPaymentBankField();
  renderPaymentHistoryInsideModal(sp, fin);

  document.getElementById("paymentModal").classList.remove("hidden");
  safeRefreshIcons();
}

function appendPaymentMovementToSpray(sp, movementData) {
  if (!Array.isArray(sp.payments)) {
    migrateSprayPaymentsFromV4(sp, 0);
  }
  const mov = normalizePaymentMovement(movementData, sp.payments.length, getGuayaquilTodayStr());
  sp.payments.push(mov);
  const fin = syncSpraySummaryFieldsFromLedger(sp);
  saveState(true);
  renderPaymentHistoryInsideModal(sp, fin);
  closeModal("paymentModal");
  refreshAllViews();

  if (fin.payStatus === "Pagado") {
    showToast(`Abono de ${formatMoney(mov.amount)} registrado. Orden liquidada en su totalidad.`, "success");
  } else if (fin.payStatus === "Saldo a favor" || fin.payStatus === "Anticipo") {
    showToast(`Abono de ${formatMoney(mov.amount)} registrado (${fin.payStatus}: ${formatMoney(fin.creditFavor)}).`, "info");
  } else {
    showToast(`Abono de ${formatMoney(mov.amount)} registrado. Nuevo saldo: ${formatMoney(fin.collectibleBalance)}.`, "success");
  }
}

function saveQuickPaymentForm(e) {
  e.preventDefault();
  const sprayId = document.getElementById("paymentSprayId").value;
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;

  const rawAmount = parseFloat(document.getElementById("paymentAddAmount").value);
  const payDate = document.getElementById("paymentDate").value;
  const method = document.getElementById("paymentMethod").value;
  const ref = document.getElementById("paymentRef").value.trim();
  const bank = method === "Efectivo" ? "" : document.getElementById("paymentBank").value.trim();
  const note = document.getElementById("paymentNote").value.trim();

  if (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > 1e8) {
    showToast("Ingresa un monto de abono válido mayor a $0.00.", "error");
    return;
  }
  if (!isValidDateStr(payDate)) {
    showToast("Selecciona una fecha válida para el abono.", "error");
    return;
  }

  const addCents = toSafeCents(rawAmount);
  const fin = getSprayFinancials(sp);
  const movementData = {
    id: generateUid("pay"),
    date: payDate,
    amountCents: addCents,
    method,
    ref,
    bank,
    note,
    voided: false,
    createdAt: new Date().toISOString()
  };

  if (!fin.isRealized) {
    openConfirmModal(
      "Registrar anticipo en orden no realizada",
      `Esta orden está en estado "${sp.status}". El pago de ${formatMoney(fromCents(addCents))} se guardará como Anticipo del cliente sin marcar la fumigación como realizada. ¿Deseas continuar?`,
      () => appendPaymentMovementToSpray(sp, movementData),
      "Sí, registrar anticipo",
      false
    );
    return;
  }

  if (fin.paidCents + addCents > fin.totalClientCents) {
    const excess = fromCents((fin.paidCents + addCents) - fin.totalClientCents);
    openConfirmModal(
      "Confirmar sobrepago / saldo a favor",
      `El abono ingresado (${formatMoney(fromCents(addCents))}) supera el saldo pendiente y generará un Saldo a favor del cliente por ${formatMoney(excess)}. ¿Confirmas que el monto es correcto?`,
      () => appendPaymentMovementToSpray(sp, movementData),
      "Sí, registrar saldo a favor",
      false
    );
    return;
  }

  appendPaymentMovementToSpray(sp, movementData);
}

function requestVoidPaymentMovement(sprayId, paymentId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp || !Array.isArray(sp.payments)) return;
  const mov = sp.payments.find(p => p.id === paymentId && !p.voided);
  if (!mov) return;

  openConfirmModal(
    "Anular abono registrado",
    `¿Seguro que deseas anular el abono de ${formatMoney(mov.amount)} (${mov.method} del ${mov.date})? El registro quedará marcado como Anulado en el historial por auditoría y se recalculará el saldo de la orden.`,
    () => {
      mov.voided = true;
      mov.voidedAt = new Date().toISOString();
      mov.voidReason = "Anulado por usuario";
      syncSpraySummaryFieldsFromLedger(sp);
      saveState(true);
      openPaymentModal(sp.id);
      refreshAllViews();
      showToast(`Abono de ${formatMoney(mov.amount)} anulado correctamente.`, "info");
    },
    "Sí, anular abono",
    true
  );
}

function requestMarkSprayAsPaid(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  const fin = getSprayFinancials(sp);
  if (!fin.isRealized || fin.collectibleBalanceCents <= 0) return;

  openConfirmModal(
    "Liquidar saldo exigible",
    `¿Registrar un abono por el saldo restante de ${formatMoney(fin.collectibleBalance)} (${sp.payMethod || "Transferencia"}) para dejar pagada la orden ${sp.orderNumber || sp.date}?`,
    () => {
      appendPaymentMovementToSpray(sp, {
        id: generateUid("pay"),
        date: getGuayaquilTodayStr(),
        amountCents: fin.collectibleBalanceCents,
        method: ["Transferencia", "Cheque", "Efectivo"].includes(sp.payMethod) ? sp.payMethod : "Transferencia",
        ref: "",
        bank: "",
        note: "Liquidación directa de saldo",
        voided: false,
        createdAt: new Date().toISOString()
      });
    },
    "Sí, liquidar saldo",
    false
  );
}

function exportBillingCSV() {
  const header = [
    "Fecha", "Orden", "EstadoFumigacion", "Productor", "CedulaRUC", "Finca",
    "Hectareas", "TarifaHa", "Subtotal", "DescuentoPct", "IVA_Pct", "MontoTotal",
    "AbonadoVigente", "SaldoExigible", "SaldoAFavor_Anticipo", "MetodosAbono",
    "CantidadAbonos", "EstadoCobro", "PagoPilotoDevengado", "PagoPilotoEstimado"
  ].map(csvCell).join(",");

  const lines = [header];
  state.sprays.forEach(sp => {
    const farm = getFarmById(sp.farmId);
    const prod = farm ? getProducerByFarmId(farm.id) : null;
    const fin = getSprayFinancials(sp);

    lines.push([
      sp.date,
      sp.orderNumber || "",
      sp.status || "Realizada",
      prod ? prod.name : "",
      prod ? prod.doc : "",
      farm ? farm.name : "",
      formatHectares(fin.hectares),
      fin.unitRateHa.toFixed(2),
      fin.subtotal.toFixed(2),
      fin.discountPct.toFixed(2),
      fin.ivaPct.toFixed(2),
      fin.totalClient.toFixed(2),
      fin.paidAmount.toFixed(2),
      fin.collectibleBalance.toFixed(2),
      fin.creditFavor.toFixed(2),
      fin.primaryMethodDisplay,
      String(fin.activePaymentsCount),
      fin.payStatus,
      fin.pilotPayAccrued.toFixed(2),
      fin.pilotPayEstimated.toFixed(2)
    ].map(csvCell).join(","));
  });

  const csvContent = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `AgroDrone_Cobros_${getGuayaquilTodayStr()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Archivo CSV exportado correctamente.", "success");
}

// ==========================================================================
// 8. REPROGRAMACIONES CON PROTECCIÓN DE ABONOS Y PAGOS A PILOTO
// ==========================================================================
function renderRescheduleHistoryInsideModal(farm) {
  const histBox = document.getElementById("rescheduleHistoryBox");
  const histList = document.getElementById("rescheduleHistoryList");
  const history = Array.isArray(farm.rescheduleHistory) ? farm.rescheduleHistory : [];
  if (history.length > 0) {
    histBox.classList.remove("hidden");
    histList.innerHTML = history.map(h => `
      <div class="p-2 rounded-lg bg-slate-900/90 border border-brand-border/50">
        <strong>${escapeHtml(h.oldDate || "Sin fecha")} → ${escapeHtml(h.newDate)}</strong> • ${escapeHtml(h.description || h.reason || "")}
      </div>
    `).join("");
  } else {
    histBox.classList.add("hidden");
  }
}

function openRescheduleModal(farmId, sprayId = null) {
  const farm = getFarmById(farmId);
  if (!farm) return;
  const prod = getProducerByFarmId(farm.id);
  const sched = calculateFarmSchedule(farm);

  document.getElementById("rescheduleForm").reset();
  document.getElementById("rescheduleFarmId").value = farm.id;
  document.getElementById("rescheduleSprayId").value = sprayId || "";
  document.getElementById("rescheduleOldDate").value = sched.effectiveDateStr || getGuayaquilTodayStr();
  document.getElementById("rescheduleNewDate").value = addDaysToDateStr(getGuayaquilTodayStr(), 1);
  document.getElementById("rescheduleFarmSubtitle").textContent =
    `${farm.name} (${prod ? prod.name : ""}) • Fecha actual: ${sched.effectiveDateStr ? formatDisplayDate(sched.effectiveDateStr, true) : "Sin fecha"}`;
  document.getElementById("rescheduleWaReadyBox").classList.add("hidden");

  const clearBtn = document.getElementById("clearRescheduleBtn");
  if (clearBtn) {
    clearBtn.classList.toggle("hidden", !sched.hasReschedule);
  }

  renderRescheduleHistoryInsideModal(farm);
  document.getElementById("rescheduleModal").classList.remove("hidden");
  safeRefreshIcons();
}

function applyRescheduleConfirmed(farm, prod, sp, oldDate, newDate, description) {
  if (sp) {
    const wasRealizada = sp.status === "Realizada";
    sp.status = "Reprogramada";
    sp.date = newDate;
    sp.rescheduleDescription = description;
    sp.pilotPaid = false;
    syncSpraySummaryFieldsFromLedger(sp);
    if (wasRealizada) {
      syncFarmLastSprayFromHistory(farm.id);
    }
  }

  if (!Array.isArray(farm.rescheduleHistory)) farm.rescheduleHistory = [];
  farm.rescheduleHistory.unshift({
    oldDate: oldDate || "Sin fecha",
    newDate,
    description,
    timestamp: new Date().toISOString()
  });
  farm.rescheduledDate = newDate;
  farm.rescheduleNote = description;

  saveState(true);
  refreshAllViews();
  renderRescheduleHistoryInsideModal(farm);

  const clearBtn = document.getElementById("clearRescheduleBtn");
  if (clearBtn) clearBtn.classList.remove("hidden");

  const waBtnContainer = document.getElementById("rescheduleWaBtnContainer");
  waBtnContainer.innerHTML = renderWhatsAppButtonHtml(prod, "reschedule", {
    nombre: prod ? prod.name : "",
    finca: farm.name,
    fecha: `${formatDisplayDate(newDate, true)} (${newDate})`,
    motivo: description
  }, "Abrir WhatsApp para Revisar y Enviar", "w-full justify-center py-2.5 text-xs");

  document.getElementById("rescheduleWaReadyBox").classList.remove("hidden");
  showToast("Reprogramación guardada en el historial.", "success");
  safeRefreshIcons();
}

function saveRescheduleForm(e) {
  e.preventDefault();
  const farmId = document.getElementById("rescheduleFarmId").value;
  const sprayId = document.getElementById("rescheduleSprayId").value;
  const oldDate = document.getElementById("rescheduleOldDate").value;
  const newDate = document.getElementById("rescheduleNewDate").value;
  const description = document.getElementById("rescheduleDescription").value.trim();

  if (!isValidDateStr(newDate)) {
    showToast("Selecciona una nueva fecha válida para la reprogramación.", "error");
    return;
  }
  if (description.length < 3) {
    showToast("Escribe el motivo o descripción de la reprogramación (mínimo 3 caracteres).", "error");
    return;
  }

  const farm = getFarmById(farmId);
  if (!farm) return;
  const prod = getProducerByFarmId(farm.id);
  const sp = sprayId ? state.sprays.find(s => s.id === sprayId) : null;

  if (sp) {
    const guard = canTransitionSprayStatus(sp, "Reprogramada", state.config);
    if (!guard.allowed) {
      showToast(guard.reason, "error");
      return;
    }
    if (guard.requiresConfirm) {
      openConfirmModal(
        "Reprogramar orden con abonos registrados",
        guard.message,
        () => applyRescheduleConfirmed(farm, prod, sp, oldDate, newDate, description),
        "Sí, conservar anticipo y reprogramar",
        false
      );
      return;
    }
  }

  applyRescheduleConfirmed(farm, prod, sp, oldDate, newDate, description);
}

function requestClearReschedule() {
  const farmId = document.getElementById("rescheduleFarmId").value;
  const farm = getFarmById(farmId);
  if (!farm) return;

  openConfirmModal(
    "Volver a fecha base",
    `¿Quitar la fecha reprogramada de "${farm.name}" y restaurar su cálculo automático por temporada?`,
    () => {
      farm.rescheduledDate = null;
      farm.rescheduleNote = "";
      saveState(true);
      closeModal("rescheduleModal");
      refreshAllViews();
      showToast("Se restauró la fecha base por temporada.", "info");
    },
    "Sí, restaurar fecha base",
    false
  );
}

// ==========================================================================
// 9. GENERACIÓN DE PDFs A4 CON DESGLOSE DE DESCUENTO, IVA Y ABONOS
// ==========================================================================
function printCurrentPdf() {
  window.print();
}

function getAssociationHeaderPdfHtml(docTitle, rightMetaHtml) {
  const cfg = state.config;
  const safeLogo = isSafeImageDataUrl(cfg.assocLogoDataUrl) ? escapeHtml(cfg.assocLogoDataUrl) : "";
  const logoHtml = safeLogo
    ? `<img src="${safeLogo}" alt="Logo" class="pdf-logo-img">`
    : `<div class="pdf-brand-badge">AD</div>`;

  return `
    <div class="pdf-header pdf-avoid-break">
      <div class="flex items-center space-x-3">
        ${logoHtml}
        <div>
          <h2 class="text-xl font-black tracking-tight">${escapeHtml(cfg.assocName || "Asociación AgroDrone")}</h2>
          <p class="text-xs text-slate-600 font-medium">${escapeHtml(docTitle)}</p>
          <p class="text-[11px] text-slate-500">Tel/WhatsApp: ${escapeHtml(cfg.assocPhone || "N/A")} • RUC: ${escapeHtml(cfg.assocRuc || "N/A")}</p>
        </div>
      </div>
      <div class="text-left sm:text-right text-xs text-slate-700 space-y-0.5 shrink-0">
        ${rightMetaHtml}
      </div>
    </div>
  `;
}

function getPdfPayPillClass(payStatus) {
  if (payStatus === "Pagado") return "is-ok";
  if (payStatus === "Saldo a favor" || payStatus === "Anticipo") return "is-info";
  if (payStatus === "Parcial") return "is-warn";
  if (payStatus === "No exigible") return "";
  return "is-danger";
}

function openSprayPdfModal(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  const farm = getFarmById(sp.farmId);
  const prod = farm ? getProducerByFarmId(farm.id) : null;
  const fin = getSprayFinancials(sp);

  const orderNextRule = calculateScheduleForDate(sp.date);
  const products = Array.isArray(sp.products) && sp.products.length > 0
    ? sp.products
    : [{ commercialName: sp.product || "N/A", activeIngredient: "-", dosePerHa: "-", totalVolume: "-", batchLot: "-" }];

  const productsRows = products.map(pr => `
    <tr>
      <td class="font-semibold">${escapeHtml(pr.commercialName || "-")}</td>
      <td>${escapeHtml(pr.activeIngredient || "-")}</td>
      <td>${escapeHtml(pr.dosePerHa || "-")}</td>
      <td>${escapeHtml(pr.totalVolume || "-")}</td>
      <td class="font-mono">${escapeHtml(pr.batchLot || "-")}</td>
    </tr>
  `).join("");

  const activeMovements = fin.payments.filter(m => !m.voided && m.amountCents > 0);
  const paymentsTableHtml = activeMovements.length > 0
    ? `
      <div class="space-y-1.5 pdf-avoid-break">
        <div class="pdf-section-title">Detalle de Abonos / Pagos Registrados</div>
        <div class="pdf-table-scroll">
          <table class="pdf-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Método</th>
                <th>Referencia / Banco</th>
                <th class="text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              ${activeMovements.map(m => `
                <tr>
                  <td>${escapeHtml(m.date)}</td>
                  <td>${escapeHtml(m.method)}</td>
                  <td>${escapeHtml([m.ref, m.bank, m.note].filter(Boolean).join(" • ") || "-")}</td>
                  <td class="text-right font-semibold">${formatMoney(m.amount)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `
    : "";

  const statusPillClass = sp.status === "Realizada" ? "is-ok" : (sp.status === "Reprogramada" ? "is-warn" : "");
  const payPillClass = getPdfPayPillClass(fin.payStatus);

  document.getElementById("sprayPdfModalContent").innerHTML = `
    ${getAssociationHeaderPdfHtml(
      "Orden de Servicio y Certificado de Fumigación con Dron",
      `
        <div class="text-sm font-black text-slate-900">Orden N.º ${escapeHtml(sp.orderNumber || sp.id)}</div>
        <div>Fecha: <strong>${formatDisplayDate(sp.date, true)} (${escapeHtml(sp.date)})</strong></div>
        <div>Estado: <span class="pdf-status-pill ${statusPillClass}">${escapeHtml(sp.status || "Realizada")}</span></div>
      `
    )}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pdf-avoid-break">
      <div class="pdf-section-box space-y-1">
        <div class="pdf-section-title">Datos del Productor y Finca</div>
        <div>Productor: <strong>${escapeHtml(prod ? prod.name : "N/A")}</strong></div>
        <div>Cédula / RUC: <strong>${escapeHtml(prod ? prod.doc : "N/A")}</strong></div>
        <div>Finca: <strong>${escapeHtml(farm ? farm.name : "N/A")}</strong> (${escapeHtml(farm ? farm.crop : "N/A")})</div>
        <div>Sector: <strong>${escapeHtml(farm ? farm.sector : "N/A")}</strong></div>
        <div>Superficie aplicada: <strong>${formatHectares(fin.hectares)} hectáreas</strong></div>
      </div>

      <div class="pdf-section-box space-y-1">
        <div class="pdf-section-title">Operación Aérea y Observaciones</div>
        <div>Piloto responsable: <strong>${escapeHtml(sp.pilot || "N/A")}</strong></div>
        <div>Equipo / Dron: <strong>${escapeHtml(sp.drone || "N/A")}</strong></div>
        <div>Observaciones: <strong>${escapeHtml(sp.notes || "Sin novedades")}</strong></div>
        ${sp.rescheduleDescription ? `<div>Motivo de reprogramación: <strong>${escapeHtml(sp.rescheduleDescription)}</strong></div>` : ""}
      </div>
    </div>

    <div class="space-y-2">
      <div class="pdf-section-title">Detalle de Producto(s) Aplicados y Dosis</div>
      <div class="pdf-table-scroll">
        <table class="pdf-table">
          <thead>
            <tr>
              <th>Nombre Comercial</th>
              <th>Ingrediente Activo</th>
              <th>Dosis / ha</th>
              <th>Volumen Total</th>
              <th>Lote</th>
            </tr>
          </thead>
          <tbody>${productsRows}</tbody>
        </table>
      </div>
    </div>

    ${paymentsTableHtml}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pdf-avoid-break">
      <div class="pdf-section-box space-y-1">
        <div class="pdf-section-title">Próxima Programación y Condición</div>
        <div>Próxima fecha tentativa: <strong>${orderNextRule.nextDateStr ? `${formatDisplayDate(orderNextRule.nextDateStr, true)} (${orderNextRule.nextDateStr})` : "Por definir"}</strong></div>
        <div class="text-[11px] text-slate-600">Regla aplicada: +${orderNextRule.daysToAdd} días (Temporada ${orderNextRule.isRainy ? "Lluviosa" : "Seca"})</div>
        <div>Modalidad de pago: <strong>${escapeHtml(fin.primaryMethodDisplay)}</strong></div>
      </div>

      <div class="pdf-section-box space-y-1 tabular-nums">
        <div class="pdf-section-title">Resumen Económico (${fin.isRealized ? "Devengado" : "Estimado no exigible"})</div>
        ${(fin.discount > 0 || fin.iva > 0) ? `<div class="flex justify-between"><span>Subtotal (${formatHectares(fin.hectares)} ha × ${formatMoney(fin.unitRateHa)}):</span><strong>${formatMoney(fin.subtotal)}</strong></div>` : ""}
        ${fin.discount > 0 ? `<div class="flex justify-between text-emerald-800"><span>Descuento (${fin.discountPct}%):</span><strong>-${formatMoney(fin.discount)}</strong></div>` : ""}
        ${fin.iva > 0 ? `<div class="flex justify-between"><span>IVA (${fin.ivaPct}%):</span><strong>+${formatMoney(fin.iva)}</strong></div>` : ""}
        <div class="flex justify-between"><span>Total del servicio:</span><strong>${formatMoney(fin.totalClient)}</strong></div>
        <div class="flex justify-between"><span>Total abonado vigente:</span><strong>${formatMoney(fin.paidAmount)}</strong></div>
        <div class="flex justify-between"><span>Estado de cobro:</span><span class="pdf-status-pill ${payPillClass}">${escapeHtml(fin.payStatus)}</span></div>
        <div class="flex justify-between pt-1 border-t border-slate-300 font-extrabold text-sm">
          <span>${fin.creditFavor > 0 ? "Saldo a favor / Anticipo:" : "Saldo exigible:"}</span>
          <span>${fin.creditFavor > 0 ? `+${formatMoney(fin.creditFavor)}` : formatMoney(fin.collectibleBalance)}</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-10 pt-12 text-center text-xs pdf-avoid-break">
      <div>
        <div class="border-t border-slate-700 pt-2 font-bold text-slate-900">${escapeHtml(sp.pilot || "Piloto de Dron")}</div>
        <div class="text-slate-600">Firma del Piloto</div>
      </div>
      <div>
        <div class="border-t border-slate-700 pt-2 font-bold text-slate-900">${escapeHtml(prod ? prod.name : "Productor")}</div>
        <div class="text-slate-600">Firma del Productor • CI/RUC: ${escapeHtml(prod ? prod.doc : "")}</div>
      </div>
    </div>

    <div class="pt-3 border-t border-slate-200 text-[10px] text-slate-500 flex justify-between">
      <span>Documento emitido por ${escapeHtml(state.config.assocName || "AgroDrone")}</span>
      <span>Emisión: ${getGuayaquilTodayStr()}</span>
    </div>
  `;

  document.getElementById("printableSprayPdfModal").classList.remove("hidden");
  safeRefreshIcons();
}

function openStatementModal(prodId) {
  const prod = state.producers.find(p => p.id === prodId);
  if (!prod) return;

  const modal = document.getElementById("printableStatementModal");
  const content = document.getElementById("statementModalContent");
  const phoneInfo = parseEcuadorWhatsApp(prod.phone);
  const farmIds = new Set((prod.farms || []).map(f => f.id));

  const prodSprays = state.sprays
    .filter(sp => farmIds.has(sp.farmId))
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const prodSummary = computePortfolioSummary(prodSprays, state.config);

  const rowsHtml = prodSprays.map(sp => {
    const farm = getFarmById(sp.farmId);
    const fin = getSprayFinancials(sp);
    const payPillClass = getPdfPayPillClass(fin.payStatus);

    return `
      <tr>
        <td class="whitespace-nowrap">
          <div class="font-semibold">${escapeHtml(sp.date)}</div>
          <div class="text-[10px] font-mono text-slate-500">${escapeHtml(sp.orderNumber || "")}</div>
        </td>
        <td class="font-medium">${escapeHtml(farm ? farm.name : "N/A")}</td>
        <td>
          ${escapeHtml(sp.product)}
          <span class="text-slate-500">(${formatHectares(fin.hectares)} ha • ${escapeHtml(sp.status)})</span>
          ${fin.discountPct > 0 ? `<span class="text-emerald-700 font-semibold"> • Desc. ${fin.discountPct}%</span>` : ""}
        </td>
        <td class="text-right font-semibold">${formatMoney(fin.totalClient)}</td>
        <td class="text-right">${formatMoney(fin.paidAmount)}</td>
        <td class="text-right font-bold">${fin.creditFavor > 0 ? `+${formatMoney(fin.creditFavor)}` : formatMoney(fin.collectibleBalance)}</td>
        <td>
          <div>${escapeHtml(fin.primaryMethodDisplay)}</div>
          <span class="pdf-status-pill ${payPillClass}">${escapeHtml(fin.payStatus)}</span>
        </td>
      </tr>
    `;
  }).join("");

  const totalCredit = roundMoney(prodSummary.creditFavorTotal + prodSummary.advancesOnPendingTotal);

  content.innerHTML = `
    ${getAssociationHeaderPdfHtml(
      "Historial de Fumigaciones y Estado de Cuenta",
      `
        <div class="text-sm font-black text-slate-900">Estado de Cuenta</div>
        <div>Fecha de emisión: <strong>${formatDisplayDate(getGuayaquilTodayStr(), true)} (${getGuayaquilTodayStr()})</strong></div>
      `
    )}

    <div class="pdf-section-box space-y-1.5 text-xs pdf-avoid-break">
      <div class="pdf-section-title">Datos del Productor</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">
        <div>Nombre: <strong>${escapeHtml(prod.name)}</strong></div>
        <div>Cédula / RUC: <strong>${escapeHtml(prod.doc)}</strong></div>
        <div>WhatsApp: <strong>${escapeHtml(phoneInfo.valid ? phoneInfo.display : "No registrado")}</strong></div>
        <div>Fincas registradas: <strong>${(prod.farms || []).length}</strong> • Hectáreas realizadas: <strong>${formatHectares(prodSummary.realizedHectares)} ha</strong></div>
      </div>
    </div>

    <div class="space-y-2">
      <div class="pdf-section-title">Detalle Cronológico de Servicios</div>
      <div class="pdf-table-scroll">
        <table class="pdf-table">
          <thead>
            <tr>
              <th>Fecha / Orden</th>
              <th>Finca</th>
              <th>Detalle Servicio</th>
              <th class="text-right">Total</th>
              <th class="text-right">Abonado</th>
              <th class="text-right">Saldo / A Favor</th>
              <th>Pago / Estado</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="7" class="text-center text-slate-500 py-4">Sin fumigaciones registradas para este productor.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="flex justify-end pt-2 pdf-avoid-break">
      <div class="pdf-section-box w-full sm:w-80 space-y-1.5 text-xs tabular-nums">
        <div class="flex justify-between"><span>Facturado Devengado (Realizadas):</span><strong>${formatMoney(prodSummary.billedAccrued)}</strong></div>
        ${prodSummary.billedEstimated > 0 ? `<div class="flex justify-between text-slate-600"><span>Programado Estimado (No exigible):</span><strong>${formatMoney(prodSummary.billedEstimated)}</strong></div>` : ""}
        <div class="flex justify-between text-emerald-800"><span>Total Abonado Vigente:</span><strong>${formatMoney(prodSummary.totalCashCollected)}</strong></div>
        ${totalCredit > 0 ? `<div class="flex justify-between text-blue-800"><span>Anticipos / Saldo a Favor:</span><strong>+${formatMoney(totalCredit)}</strong></div>` : ""}
        <div class="flex justify-between text-sm font-black pt-1.5 border-t border-slate-300 ${prodSummary.collectibleTotal > 0 ? "text-rose-800" : "text-emerald-800"}">
          <span>Saldo Exigible Actual:</span><span>${formatMoney(prodSummary.collectibleTotal)}</span>
        </div>
      </div>
    </div>

    <div class="pt-3 border-t border-slate-200 text-[10px] text-slate-500 flex justify-between">
      <span>${escapeHtml(state.config.assocName || "AgroDrone")} • Gestión Empresarial</span>
      <span>Emisión: ${getGuayaquilTodayStr()}</span>
    </div>
  `;

  modal.classList.remove("hidden");
  safeRefreshIcons();
}

// ==========================================================================
// 10. CONFIGURACIÓN Y LOGO AISLADO
// ==========================================================================
function populateSettingsForm() {
  const cfg = state.config;
  document.getElementById("settingAssocName").value = cfg.assocName || "AgroDrone";
  document.getElementById("settingAssocPhone").value = cfg.assocPhone || "";
  document.getElementById("settingAssocRuc").value = cfg.assocRuc || "";
  document.getElementById("settingClientRatePerHa").value = cfg.clientRatePerHa !== undefined ? cfg.clientRatePerHa : 15.0;
  document.getElementById("settingPilotRatePerHa").value = cfg.pilotRatePerHa !== undefined ? cfg.pilotRatePerHa : 4.5;
  document.getElementById("settingDefaultIvaPct").value = cfg.defaultIvaPct !== undefined ? cfg.defaultIvaPct : 0;
  document.getElementById("settingPilotsList").value = (cfg.pilots || []).join(", ");
  document.getElementById("settingDronesList").value = (cfg.drones || []).join(", ");
  document.getElementById("settingWaTemplateReminder").value = cfg.waTemplateReminder || DEFAULT_WA_REMINDER_TEMPLATE;
  document.getElementById("settingWaTemplateReschedule").value = cfg.waTemplateReschedule || DEFAULT_WA_RESCHEDULE_TEMPLATE;
  document.getElementById("settingWaTemplatePayment").value = cfg.waTemplatePayment || DEFAULT_WA_PAYMENT_TEMPLATE;

  const logoImg = document.getElementById("settingLogoPreview");
  if (isSafeImageDataUrl(cfg.assocLogoDataUrl)) {
    logoImg.src = cfg.assocLogoDataUrl;
    logoImg.classList.remove("hidden");
  } else {
    logoImg.src = "";
    logoImg.classList.add("hidden");
  }

  const opVal = cfg.bgOverlayOpacity || 62;
  document.getElementById("settingOverlayOpacity").value = opVal;
  document.getElementById("settingOverlayOpacityVal").textContent = `${opVal}%`;

  document.querySelectorAll('input[name="rainyMonths"]').forEach(cb => {
    cb.checked = cfg.rainyMonths.includes(parseInt(cb.value, 10));
  });
  document.getElementById("settingDaysRainy").value = cfg.daysRainy;
  document.getElementById("settingDaysDry").value = cfg.daysDry;
  document.getElementById("settingBackupReminderDays").value = cfg.backupReminderDays || 3;
  document.getElementById("settingAutoBackupOnClose").checked = cfg.autoBackupOnClose !== false;

  const linkBtn = document.getElementById("linkAutoBackupFileBtn");
  if (linkBtn && typeof window.showSaveFilePicker === "function") {
    linkBtn.classList.remove("hidden");
  }

  updateBackupIndicators();
}

function handleAssocLogoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("Selecciona un archivo de imagen válido (PNG o JPG).", "error");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const maxDim = 320;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/png", 0.85);

      if (!isSafeImageDataUrl(dataUrl)) {
        showToast("Formato de imagen no válido.", "error");
        return;
      }

      state.config.assocLogoDataUrl = dataUrl;
      const logoImg = document.getElementById("settingLogoPreview");
      logoImg.src = dataUrl;
      logoImg.classList.remove("hidden");
      saveState(true);
      showToast("Logo optimizado y guardado en clave aislada.", "success");
    };
    img.onerror = function () {
      showToast("No se pudo procesar la imagen del logo.", "error");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = "";
}

function clearAssocLogo() {
  state.config.assocLogoDataUrl = "";
  localStorage.removeItem(LOGO_STORAGE_KEY);
  const logoImg = document.getElementById("settingLogoPreview");
  if (logoImg) {
    logoImg.src = "";
    logoImg.classList.add("hidden");
  }
  saveState(true);
  showToast("Logo removido.", "info");
}

function previewOverlayOpacity(val) {
  document.getElementById("settingOverlayOpacityVal").textContent = `${val}%`;
  document.documentElement.style.setProperty("--bg-overlay-opacity", (Number(val) / 100).toFixed(2));
}

function saveSettings(e) {
  e.preventDefault();

  const assocName = document.getElementById("settingAssocName").value.trim();
  const assocPhone = document.getElementById("settingAssocPhone").value.trim();
  const assocRuc = document.getElementById("settingAssocRuc").value.trim();
  const clientRate = parseFloat(document.getElementById("settingClientRatePerHa").value);
  const pilotRate = parseFloat(document.getElementById("settingPilotRatePerHa").value);
  const defaultIva = parseFloat(document.getElementById("settingDefaultIvaPct").value || "0");
  const pilotsRaw = document.getElementById("settingPilotsList").value.split(",").map(s => s.trim()).filter(Boolean);
  const dronesRaw = document.getElementById("settingDronesList").value.split(",").map(s => s.trim()).filter(Boolean);
  const daysRainy = parseInt(document.getElementById("settingDaysRainy").value, 10);
  const daysDry = parseInt(document.getElementById("settingDaysDry").value, 10);
  const reminderDays = parseInt(document.getElementById("settingBackupReminderDays").value, 10);
  const overlayOp = parseInt(document.getElementById("settingOverlayOpacity").value, 10);

  if (assocName.length < 2) {
    showToast("Ingresa el nombre de la asociación.", "error");
    return;
  }
  if (!Number.isFinite(clientRate) || clientRate < 0) {
    showToast("La tarifa por hectárea al cliente debe ser mayor o igual a 0.", "error");
    return;
  }
  if (!Number.isFinite(pilotRate) || pilotRate < 0) {
    showToast("El pago por hectárea al piloto debe ser mayor o igual a 0.", "error");
    return;
  }
  if (!Number.isFinite(defaultIva) || defaultIva < 0 || defaultIva > 100) {
    showToast("El IVA predeterminado debe estar entre 0% y 100%.", "error");
    return;
  }
  if (pilotsRaw.length === 0) {
    showToast("Debe haber al menos un piloto registrado.", "error");
    return;
  }
  if (dronesRaw.length === 0) {
    showToast("Debe haber al menos un dron registrado.", "error");
    return;
  }
  if (!Number.isInteger(daysRainy) || daysRainy < 1 || daysRainy > 90) {
    showToast("Los días en temporada lluviosa deben estar entre 1 y 90.", "error");
    return;
  }
  if (!Number.isInteger(daysDry) || daysDry < 1 || daysDry > 90) {
    showToast("Los días en temporada seca deben estar entre 1 y 90.", "error");
    return;
  }
  if (!Number.isInteger(reminderDays) || reminderDays < 1 || reminderDays > 60) {
    showToast("Los días para recordar el respaldo deben estar entre 1 y 60.", "error");
    return;
  }

  const selectedMonths = [];
  document.querySelectorAll('input[name="rainyMonths"]:checked').forEach(cb => {
    selectedMonths.push(parseInt(cb.value, 10));
  });

  state.config.assocName = assocName;
  state.config.assocPhone = assocPhone;
  state.config.assocRuc = assocRuc;
  state.config.clientRatePerHa = roundMoney(clientRate);
  state.config.pilotRatePerHa = roundMoney(pilotRate);
  state.config.defaultIvaPct = roundMoney(defaultIva);
  state.config.pilots = pilotsRaw;
  state.config.drones = dronesRaw;
  state.config.waTemplateReminder = document.getElementById("settingWaTemplateReminder").value.trim() || DEFAULT_WA_REMINDER_TEMPLATE;
  state.config.waTemplateReschedule = document.getElementById("settingWaTemplateReschedule").value.trim() || DEFAULT_WA_RESCHEDULE_TEMPLATE;
  state.config.waTemplatePayment = document.getElementById("settingWaTemplatePayment").value.trim() || DEFAULT_WA_PAYMENT_TEMPLATE;
  state.config.bgOverlayOpacity = Number.isInteger(overlayOp) ? Math.min(80, Math.max(45, overlayOp)) : 62;
  state.config.rainyMonths = selectedMonths;
  state.config.daysRainy = daysRainy;
  state.config.daysDry = daysDry;
  state.config.backupReminderDays = reminderDays;
  state.config.autoBackupOnClose = document.getElementById("settingAutoBackupOnClose").checked;

  saveState(true);
  refreshAllViews();
  showToast("Configuración guardada y frecuencias recalculadas.", "success");
}
