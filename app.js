/* ==========================================================================
   AgroDrone - Motor de Aplicación (app.js)
   Control de secretaría y piloto: productores, fincas, fumigados del día,
   frecuencias por temporada (lluviosa/seca sin clima), reprogramaciones,
   cobros, PDFs en blanco, WhatsApp Ecuador (+593) y respaldos JSON.
   ========================================================================== */

"use strict";

// ==========================================================================
// 1. CONSTANTES, CLAVES DE ALMACENAMIENTO Y ESTADO GLOBAL
// ==========================================================================
const STORAGE_KEY = "agrodrone_saas_data_v4_0";
const AUTO_BACKUP_KEY = "agrodrone_saas_autobackup_v4";
const TODAY_TIMEZONE = "America/Guayaquil";

const DEFAULT_WA_REMINDER_TEMPLATE =
  "Hola {nombre}, le escribimos de {asociacion}. Le recordamos que la próxima fumigación de su finca {finca} está programada para el {fecha}. Quedamos atentos para confirmar.";

const DEFAULT_WA_RESCHEDULE_TEMPLATE =
  "Hola {nombre}, le saludamos de {asociacion}. Le informamos que la fumigación de su finca {finca} fue reprogramada para el {fecha}. Motivo: {motivo}. Gracias por su comprensión.";

const DEFAULT_WA_PAYMENT_TEMPLATE =
  "Hola {nombre}, le saludamos de {asociacion}. Le recordamos que mantiene un saldo pendiente de {saldo} correspondiente a la fumigación de su finca {finca} ({fecha}). Agradecemos su confirmación de pago.";

const MONTH_NAMES_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
const MONTH_NAMES_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic"
];
const DAY_NAMES_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const SAMPLE_PRODUCER_IDS = new Set(["prod-1", "prod-2", "prod-3", "prod-4", "prod-5", "prod-6"]);
const SAMPLE_SPRAY_IDS = new Set(["sp-1", "sp-2", "sp-3", "sp-4", "sp-5", "sp-6", "sp-7", "sp-8"]);

let state = null;
let chartHectaresInstance = null;
let chartPaymentInstance = null;
let pendingConfirmCallback = null;
let backupBannerDismissed = false;
let linkedBackupFileHandle = null;
let currentActiveTab = "dashboard";
let djiImportSession = null;
let isRegisteringDjiRows = false;

function hasSampleData() {
  if (!state) return false;
  const hasSampleProd = (state.producers || []).some(p => SAMPLE_PRODUCER_IDS.has(p.id));
  const hasSampleSpray = (state.sprays || []).some(sp => SAMPLE_SPRAY_IDS.has(sp.id));
  return hasSampleProd || hasSampleSpray;
}

function normalizeDjiLocationDisplay(rawLoc) {
  return String(rawLoc === null || rawLoc === undefined ? "" : rawLoc)
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function normalizeDjiLocationKey(rawLoc) {
  return normalizeDjiLocationDisplay(rawLoc)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function releaseSprayDjiFlightKeys(spraysToRemove) {
  if (!state || !state.dji || !Array.isArray(state.dji.importedFlightKeys)) return;
  const keysToRemove = new Set();
  (spraysToRemove || []).forEach(sp => {
    if (sp && Array.isArray(sp.djiFlightKeys)) {
      sp.djiFlightKeys.forEach(k => {
        const clean = String(k || "").trim();
        if (clean) keysToRemove.add(clean);
      });
    }
  });
  if (keysToRemove.size === 0) return;
  state.dji.importedFlightKeys = state.dji.importedFlightKeys.filter(k => !keysToRemove.has(k));
}

// ==========================================================================
// 2. UTILIDADES DE SEGURIDAD, NÚMEROS Y FECHAS (UTC / America/Guayaquil)
// ==========================================================================
function roundMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function roundHectares(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function formatHectares(value) {
  return roundHectares(value).toFixed(2);
}

function formatMoney(value) {
  return `$${roundMoney(value).toFixed(2)}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvCell(val) {
  const cleaned = String(val === null || val === undefined ? "" : val)
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '""');
  return `"${cleaned}"`;
}

function safeRefreshIcons() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  } catch (err) {
    // Ignorar errores de iconos si no hay internet
  }
}

function getGuayaquilTodayStr() {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: TODAY_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const formatted = formatter.format(new Date());
    if (isValidDateStr(formatted)) return formatted;
  } catch (err) {
    // Fallback abajo
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isValidDateStr(dateStr) {
  if (typeof dateStr !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return false;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function parseDateStrToUtcMs(dateStr) {
  if (!isValidDateStr(dateStr)) return NaN;
  const [y, m, d] = dateStr.split("-").map(n => parseInt(n, 10));
  return Date.UTC(y, m - 1, d);
}

function addDaysToDateStr(dateStr, days) {
  const safeDate = isValidDateStr(dateStr) ? dateStr : getGuayaquilTodayStr();
  const safeDays = Number.isFinite(Number(days)) ? Math.trunc(Number(days)) : 0;
  const [y, m, d] = safeDate.split("-").map(n => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + safeDays));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diffDaysBetweenDates(fromDateStr, toDateStr) {
  const fromMs = parseDateStrToUtcMs(fromDateStr);
  const toMs = parseDateStrToUtcMs(toDateStr);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.round((toMs - fromMs) / 86400000);
}

function formatDisplayDate(dateStr, includeYear = false) {
  if (!isValidDateStr(dateStr)) return "Sin fecha";
  const [y, m, d] = dateStr.split("-").map(n => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const currentYear = parseInt(getGuayaquilTodayStr().substring(0, 4), 10);
  const yearSuffix = includeYear || y !== currentYear ? ` ${y}` : "";
  return `${DAY_NAMES_SHORT[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTH_NAMES_SHORT[dt.getUTCMonth()]}${yearSuffix}`;
}

function formatIsoDateTimeLocal(isoStr) {
  if (!isoStr) return "Nunca";
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return "Nunca";
  try {
    return new Intl.DateTimeFormat("es-EC", {
      timeZone: TODAY_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(dt);
  } catch (err) {
    return dt.toLocaleString();
  }
}

function getSectorGroupName(sectorStr) {
  if (!sectorStr) return "Otros Sectores";
  const s = sectorStr.toLowerCase();
  if (s.includes("barbones")) return "Barbones";
  if (s.includes("el guabo") || s.includes("guabo")) return "El Guabo";
  if (s.includes("pasaje")) return "Pasaje";
  if (s.includes("machala")) return "Machala";
  if (s.includes("santa rosa")) return "Santa Rosa";
  if (s.includes("arenillas")) return "Arenillas";
  return sectorStr.split(",")[0].trim() || "Otros Sectores";
}

// ==========================================================================
// 3. VALIDACIÓN DE CÉDULA / RUC Y TELÉFONO ECUADOR (+593) + WHATSAPP
// ==========================================================================
function normalizeDoc(rawDoc) {
  return String(rawDoc || "").replace(/[\s\-]/g, "").trim();
}

function isValidEcuadorCedulaMod10(cedula) {
  if (!/^\d{10}$/.test(cedula)) return false;
  const province = parseInt(cedula.substring(0, 2), 10);
  const validProvince = (province >= 1 && province <= 24) || province === 30;
  const thirdDigit = parseInt(cedula.charAt(2), 10);
  if (!validProvince || thirdDigit >= 6) return false;

  const coeffs = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let prod = parseInt(cedula.charAt(i), 10) * coeffs[i];
    if (prod >= 10) prod -= 9;
    sum += prod;
  }
  const mod = sum % 10;
  const expectedCheck = mod === 0 ? 0 : 10 - mod;
  return expectedCheck === parseInt(cedula.charAt(9), 10);
}

function validateEcuadorDoc(rawDoc) {
  const norm = normalizeDoc(rawDoc);
  if (!norm) {
    return { valid: false, warning: false, normalized: "", message: "Ingresa la cédula (10 dígitos) o RUC (13 dígitos)." };
  }
  if (!/^\d+$/.test(norm)) {
    return { valid: false, warning: false, normalized: norm, message: "La cédula o RUC solo debe contener números." };
  }
  if (norm.length === 10) {
    if (!isValidEcuadorCedulaMod10(norm)) {
      return {
        valid: true,
        warning: true,
        normalized: norm,
        type: "Cédula",
        message: "Advertencia: el dígito verificador de la cédula no coincide (módulo 10 Ecuador). Puedes guardar de todas formas."
      };
    }
    return {
      valid: true,
      warning: false,
      normalized: norm,
      type: "Cédula",
      message: `Cédula válida (${norm}).`
    };
  }
  if (norm.length === 13) {
    return {
      valid: true,
      warning: false,
      normalized: norm,
      type: "RUC",
      message: `RUC válido (${norm}).`
    };
  }
  return { valid: false, warning: false, normalized: norm, message: "Debe tener 10 dígitos (cédula) o 13 dígitos (RUC)." };
}

function findProducerByDoc(rawDoc, excludeProdId = "") {
  const target = normalizeDoc(rawDoc);
  if (!target) return null;
  return (state.producers || []).find(
    p => p.id !== excludeProdId && normalizeDoc(p.doc) === target
  ) || null;
}

/**
 * Normaliza y valida teléfonos celulares de Ecuador para WhatsApp (wa.me):
 * - 09XXXXXXXX (10 dígitos) -> 5939XXXXXXXX
 * - 5939XXXXXXXX (12 dígitos) -> 5939XXXXXXXX
 * - 59309XXXXXXXX (13 dígitos, error común con 0 extra) -> 5939XXXXXXXX
 * - 005939XXXXXXXX (14 dígitos) o 0059309XXXXXXXX (15 dígitos) -> 5939XXXXXXXX
 * - 9XXXXXXXX (9 dígitos) -> 5939XXXXXXXX
 */
function parseEcuadorWhatsApp(rawPhone) {
  const trimmed = String(rawPhone || "").trim();
  if (!trimmed) {
    return { valid: false, empty: true, international: "", display: "Sin número", reason: "" };
  }

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return { valid: false, empty: false, international: "", display: trimmed, reason: "Solo se permiten números." };
  }

  // Quitar prefijo internacional 00 si existe (ej. 005939...)
  if (digits.startsWith("00593")) {
    digits = digits.substring(2);
  }

  let intl = "";
  if (digits.startsWith("09") && digits.length === 10) {
    intl = "593" + digits.substring(1);
  } else if (digits.startsWith("5939") && digits.length === 12) {
    intl = digits;
  } else if (digits.startsWith("59309") && digits.length === 13) {
    intl = "593" + digits.substring(4);
  } else if (digits.startsWith("9") && digits.length === 9) {
    intl = "593" + digits;
  }

  if (intl && /^5939\d{8}$/.test(intl)) {
    const pretty = `+593 ${intl.substring(3, 5)} ${intl.substring(5, 8)} ${intl.substring(8)}`;
    return { valid: true, empty: false, international: intl, display: pretty, reason: "" };
  }

  const isLandline = /^(0[2-7]\d{7}|593[2-7]\d{7})$/.test(digits);
  return {
    valid: false,
    empty: false,
    international: "",
    display: trimmed,
    reason: isLandline
      ? "Parece un teléfono fijo; WhatsApp requiere celular de Ecuador (09... de 10 dígitos)."
      : "Ingresa un celular válido de Ecuador (10 dígitos iniciando en 09, ej. 0991234567)."
  };
}

function buildWhatsAppMessage(templateType, vars) {
  let tpl = state.config.waTemplateReminder || DEFAULT_WA_REMINDER_TEMPLATE;
  if (templateType === "reschedule") {
    tpl = state.config.waTemplateReschedule || DEFAULT_WA_RESCHEDULE_TEMPLATE;
  } else if (templateType === "payment") {
    tpl = state.config.waTemplatePayment || DEFAULT_WA_PAYMENT_TEMPLATE;
  }

  return tpl
    .replace(/\{nombre\}/gi, vars.nombre || "Productor")
    .replace(/\{finca\}/gi, vars.finca || "")
    .replace(/\{fecha\}/gi, vars.fecha || "")
    .replace(/\{motivo\}/gi, vars.motivo || "Reprogramación operativa")
    .replace(/\{saldo\}/gi, vars.saldo || "$0.00")
    .replace(/\{monto\}/gi, vars.monto || "$0.00")
    .replace(/\{asociacion\}/gi, state.config.assocName || "AgroDrone");
}

function renderWhatsAppButtonHtml(prod, templateType, vars, label = "WhatsApp", extraClass = "") {
  const phoneInfo = parseEcuadorWhatsApp(prod ? prod.phone : "");
  if (!phoneInfo.valid) {
    return `
      <span class="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-800/70 text-slate-400 border border-slate-700 text-[11px] font-semibold cursor-not-allowed ${extraClass}" title="Este productor no tiene un número de WhatsApp válido registrado">
        <i data-lucide="message-circle-off" class="w-3.5 h-3.5"></i>
        <span>Sin WhatsApp</span>
      </span>
    `;
  }
  const msg = buildWhatsAppMessage(templateType, vars);
  const waUrl = `https://wa.me/${phoneInfo.international}?text=${encodeURIComponent(msg)}`;
  return `
    <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/25 text-brand-accent hover:bg-emerald-600/40 border border-brand-accent/40 text-[11px] font-bold transition-colors ${extraClass}" title="Abrir WhatsApp (${escapeHtml(phoneInfo.display)}) para revisar y enviar">
      <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
      <span>${escapeHtml(label)}</span>
    </a>
  `;
}

// ==========================================================================
// 4. NOTIFICACIONES TOAST Y MODAL DE CONFIRMACIÓN
// ==========================================================================
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const styles = {
    success: "bg-slate-950/95 border-brand-accent/60 text-brand-accent shadow-brand-accent/20",
    error: "bg-slate-950/95 border-rose-500/60 text-rose-300 shadow-rose-500/20",
    info: "bg-slate-950/95 border-brand-blue/60 text-brand-blue shadow-brand-blue/20",
    warning: "bg-slate-950/95 border-amber-500/60 text-amber-300 shadow-amber-500/20"
  };

  const toast = document.createElement("div");
  toast.className = `pointer-events-auto px-4 py-3 rounded-xl border text-xs font-semibold shadow-xl backdrop-blur-md transition-all duration-200 ${styles[type] || styles.info}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function openConfirmModal(title, message, onConfirm, confirmLabel = "Confirmar", isDanger = true) {
  document.getElementById("confirmModalTitle").textContent = title;
  document.getElementById("confirmModalMessage").textContent = message;
  pendingConfirmCallback = onConfirm;

  const actionBtn = document.getElementById("confirmModalActionBtn");
  actionBtn.textContent = confirmLabel;
  actionBtn.className = isDanger
    ? "px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-black font-bold text-xs"
    : "px-4 py-2 rounded-xl bg-brand-accent hover:bg-emerald-300 text-black font-bold text-xs";

  actionBtn.onclick = () => {
    const cb = pendingConfirmCallback;
    closeConfirmModal();
    if (typeof cb === "function") cb();
  };

  document.getElementById("confirmModal").classList.remove("hidden");
  safeRefreshIcons();
}

function closeConfirmModal() {
  pendingConfirmCallback = null;
  document.getElementById("confirmModal").classList.add("hidden");
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add("hidden");
}

// ==========================================================================
// 5. DATOS DE EJEMPLO (6 PRODUCTORES Y 8 FINCAS DE EL ORO)
// ==========================================================================
function getInitialData() {
  const todayStr = getGuayaquilTodayStr();
  const [yStr, mStr] = todayStr.split("-");
  const nowIso = new Date().toISOString();

  return {
    meta: {
      version: "4.1",
      createdAt: nowIso,
      lastBackupAt: null,
      lastAutoBackupAt: null,
      hasUnexportedChanges: false
    },
    config: {
      rainyMonths: [12, 1, 2, 3, 4, 5],
      daysRainy: 15,
      daysDry: 21,
      assocName: "AgroDrone",
      assocPhone: "099-123-4567",
      assocRuc: "0791234567001",
      assocLogoDataUrl: "",
      pilots: ["Juan Diego Cobos Anguisaca"],
      drones: ["Alfa_3"],
      clientRatePerHa: 15.0,
      pilotRatePerHa: 4.5,
      bgOverlayOpacity: 62,
      backupReminderDays: 3,
      autoBackupOnClose: true,
      waTemplateReminder: DEFAULT_WA_REMINDER_TEMPLATE,
      waTemplateReschedule: DEFAULT_WA_RESCHEDULE_TEMPLATE,
      waTemplatePayment: DEFAULT_WA_PAYMENT_TEMPLATE
    },
    producers: [
      {
        id: "prod-1",
        name: "Carlos Mendoza",
        doc: "0704123456",
        phone: "593991234567",
        farms: [
          {
            id: "farm-1",
            name: "Hacienda Oro Verde",
            sector: "Barbones, El Guabo, El Oro",
            hectares: 18.5,
            crop: "Banano",
            lastSprayDate: "2026-10-28",
            rescheduledDate: null,
            rescheduleNote: "",
            rescheduleHistory: []
          },
          {
            id: "farm-2",
            name: "San José Norte",
            sector: "El Guabo, El Oro",
            hectares: 12.0,
            crop: "Cacao",
            lastSprayDate: "2026-11-05",
            rescheduledDate: null,
            rescheduleNote: "",
            rescheduleHistory: []
          }
        ]
      },
      {
        id: "prod-2",
        name: "María Fernanda Paredes",
        doc: "0703891234001",
        phone: "593987654321",
        farms: [
          {
            id: "farm-3",
            name: "La Esperanza",
            sector: "Pasaje, El Oro",
            hectares: 25.0,
            crop: "Banano",
            lastSprayDate: "2026-11-02",
            rescheduledDate: null,
            rescheduleNote: "",
            rescheduleHistory: []
          },
          {
            id: "farm-4",
            name: "El Mirador",
            sector: "Machala, El Oro",
            hectares: 10.0,
            crop: "Cacao",
            lastSprayDate: "2026-11-19",
            rescheduledDate: null,
            rescheduleNote: "",
            rescheduleHistory: []
          }
        ]
      },
      {
        id: "prod-3",
        name: "Jorge Luis Zambrano",
        doc: "0705567890",
        phone: "593994455667",
        farms: [
          {
            id: "farm-5",
            name: "Santa Clara",
            sector: "Santa Rosa, El Oro",
            hectares: 22.0,
            crop: "Banano",
            lastSprayDate: "2026-11-04",
            rescheduledDate: null,
            rescheduleNote: "",
            rescheduleHistory: []
          }
        ]
      },
      {
        id: "prod-4",
        name: "Elena Torres",
        doc: "0702345678",
        phone: "593982233445",
        farms: [
          {
            id: "farm-6",
            name: "Frontera Sur",
            sector: "Arenillas, El Oro",
            hectares: 15.0,
            crop: "Arroz",
            lastSprayDate: "2026-11-01",
            rescheduledDate: null,
            rescheduleNote: "",
            rescheduleHistory: []
          }
        ]
      },
      {
        id: "prod-5",
        name: "Roberto Armijos",
        doc: "0706789012001",
        phone: "593995511223",
        farms: [
          {
            id: "farm-7",
            name: "Finca Río Jubones",
            sector: "Pasaje, El Oro",
            hectares: 30.0,
            crop: "Banano",
            lastSprayDate: "2026-11-03",
            rescheduledDate: null,
            rescheduleNote: "",
            rescheduleHistory: []
          }
        ]
      },
      {
        id: "prod-6",
        name: "Lucía Valarezo",
        doc: "0704987654",
        phone: "",
        farms: [
          {
            id: "farm-8",
            name: "Hacienda La Iberia",
            sector: "El Guabo, El Oro",
            hectares: 16.5,
            crop: "Banano",
            lastSprayDate: "2026-10-30",
            rescheduledDate: "2026-11-24",
            rescheduleNote: "Llovió, se debe fumigar otro día",
            rescheduleHistory: [
              {
                oldDate: "2026-11-20",
                newDate: "2026-11-24",
                description: "Llovió, se debe fumigar otro día",
                timestamp: "2026-11-20T10:00:00Z"
              }
            ]
          }
        ]
      }
    ],
    sprays: [
      {
        id: "sp-1",
        orderNumber: "ORD-2026-001",
        farmId: "farm-1",
        date: "2026-10-28",
        status: "Realizada",
        hectares: 18.5,
        product: "Mancozeb Plus 80",
        products: [
          { commercialName: "Mancozeb Plus 80", activeIngredient: "Mancozeb", dosePerHa: "1.5 kg/ha", totalVolume: "27.75 kg", batchLot: "LT-2601" }
        ],
        drone: "DJI Agras T40 #1",
        pilot: "Ing. Diego Vera",
        pilotPay: 83.25,
        pilotPaid: true,
        notes: "Aplicación uniforme en bloque norte",
        amount: 277.50,
        amountPaid: 277.50,
        payMethod: "Transferencia",
        payRef: "TR-99821A",
        payBank: "Banco Machala",
        payStatus: "Pagado"
      },
      {
        id: "sp-2",
        orderNumber: "ORD-2026-002",
        farmId: "farm-2",
        date: "2026-11-05",
        status: "Realizada",
        hectares: 12.0,
        product: "AgroStim Cacao",
        products: [
          { commercialName: "AgroStim Cacao", activeIngredient: "Aminoácidos + Algas", dosePerHa: "1.0 L/ha", totalVolume: "12.0 L", batchLot: "LT-2604" }
        ],
        drone: "DJI Agras T30 #1",
        pilot: "Carlos Ruiz",
        pilotPay: 54.00,
        pilotPaid: true,
        notes: "Sin novedades",
        amount: 180.00,
        amountPaid: 180.00,
        payMethod: "Cheque",
        payRef: "CH-00412",
        payBank: "Banco Pichincha",
        payStatus: "Pagado"
      },
      {
        id: "sp-3",
        orderNumber: "ORD-2026-003",
        farmId: "farm-3",
        date: "2026-11-02",
        status: "Realizada",
        hectares: 25.0,
        product: "Propiconazol EC",
        products: [
          { commercialName: "Propiconazol EC", activeIngredient: "Propiconazol", dosePerHa: "0.4 L/ha", totalVolume: "10.0 L", batchLot: "LT-2611" }
        ],
        drone: "DJI Agras T40 #2",
        pilot: "Ing. Diego Vera",
        pilotPay: 112.50,
        pilotPaid: false,
        notes: "Cobertura completa bloque central",
        amount: 375.00,
        amountPaid: 200.00,
        payMethod: "Transferencia",
        payRef: "TR-10293",
        payBank: "Banco Guayaquil",
        payStatus: "Parcial"
      },
      {
        id: "sp-4",
        orderNumber: "ORD-2026-004",
        farmId: "farm-4",
        date: "2026-11-19",
        status: "Realizada",
        hectares: 10.0,
        product: "Foliar Max NPK",
        products: [
          { commercialName: "Foliar Max NPK", activeIngredient: "NPK + Microelementos", dosePerHa: "1.5 L/ha", totalVolume: "15.0 L", batchLot: "LT-2619" }
        ],
        drone: "DJI Agras T40 #1",
        pilot: "Carlos Ruiz",
        pilotPay: 45.00,
        pilotPaid: false,
        notes: "Lote 2 completo",
        amount: 150.00,
        amountPaid: 0,
        payMethod: "Efectivo",
        payRef: "EF-2026-11-19",
        payBank: "",
        payStatus: "Pendiente"
      },
      {
        id: "sp-5",
        orderNumber: "ORD-2026-005",
        farmId: "farm-5",
        date: "2026-11-04",
        status: "Realizada",
        hectares: 22.0,
        product: "Clorpirifos Pro",
        products: [
          { commercialName: "Clorpirifos Pro", activeIngredient: "Clorpirifos", dosePerHa: "0.6 L/ha", totalVolume: "13.2 L", batchLot: "LT-2607" }
        ],
        drone: "DJI Agras T40 #2",
        pilot: "Ing. Diego Vera",
        pilotPay: 99.00,
        pilotPaid: true,
        notes: "Sin incidentes",
        amount: 330.00,
        amountPaid: 330.00,
        payMethod: "Cheque",
        payRef: "CH-88210",
        payBank: "Banco del Pacífico",
        payStatus: "Pagado"
      },
      {
        id: "sp-6",
        orderNumber: "ORD-2026-006",
        farmId: "farm-6",
        date: "2026-11-01",
        status: "Realizada",
        hectares: 15.0,
        product: "Lambda Guard",
        products: [
          { commercialName: "Lambda Guard", activeIngredient: "Lambda-cihalotrina", dosePerHa: "0.3 L/ha", totalVolume: "4.5 L", batchLot: "LT-2603" }
        ],
        drone: "DJI Agras T30 #1",
        pilot: "Carlos Ruiz",
        pilotPay: 67.50,
        pilotPaid: true,
        notes: "Parcela 5 completa",
        amount: 225.00,
        amountPaid: 225.00,
        payMethod: "Transferencia",
        payRef: "TR-44812",
        payBank: "Banco Machala",
        payStatus: "Pagado"
      },
      {
        id: "sp-7",
        orderNumber: "ORD-2026-007",
        farmId: "farm-7",
        date: "2026-11-03",
        status: "Realizada",
        hectares: 30.0,
        product: "Azoxistrobina Ultra",
        products: [
          { commercialName: "Azoxistrobina Ultra", activeIngredient: "Azoxistrobina", dosePerHa: "0.5 L/ha", totalVolume: "15.0 L", batchLot: "LT-2609" }
        ],
        drone: "DJI Agras T50 #1",
        pilot: "Ing. Diego Vera",
        pilotPay: 135.00,
        pilotPaid: false,
        notes: "Finca completa en 3 baterías",
        amount: 450.00,
        amountPaid: 450.00,
        payMethod: "Transferencia",
        payRef: "TR-77401",
        payBank: "Banco Pichincha",
        payStatus: "Pagado"
      },
      {
        id: "sp-8",
        orderNumber: "ORD-2026-008",
        farmId: "farm-8",
        date: "2026-11-24",
        status: "Reprogramada",
        rescheduleDescription: "Llovió, se debe fumigar otro día",
        hectares: 16.5,
        product: "Potasio Foliar 30",
        products: [
          { commercialName: "Potasio Foliar 30", activeIngredient: "K2O Quelatado", dosePerHa: "2.0 L/ha", totalVolume: "33.0 L", batchLot: "LT-2602" }
        ],
        drone: "DJI Agras T40 #1",
        pilot: "Carlos Ruiz",
        pilotPay: 74.25,
        pilotPaid: false,
        notes: "Reprogramada por solicitud en campo",
        amount: 247.50,
        amountPaid: 0,
        payMethod: "Cheque",
        payRef: "CH-55190",
        payBank: "Banco Machala",
        payStatus: "Pendiente"
      }
    ],
    dji: {
      plotMemory: {},
      locationMemory: {},
      importedFlightKeys: []
    },
    calendarYear: parseInt(yStr, 10) || 2026,
    calendarMonth: (parseInt(mStr, 10) || 11) - 1
  };
}

// ==========================================================================
// 6. INTEGRIDAD DE ESTADO, ALMACENAMIENTO Y AUTO-RESPALDO
// ==========================================================================
function ensureStateIntegrity() {
  const defaults = getInitialData();
  if (!state || typeof state !== "object") {
    state = defaults;
  }

  state.meta = { ...defaults.meta, ...(state.meta && typeof state.meta === "object" ? state.meta : {}) };

  if (!state.config || typeof state.config !== "object") {
    state.config = defaults.config;
  } else {
    state.config = { ...defaults.config, ...state.config };
    // Eliminar cualquier fondo base64 heredado de versiones anteriores para usar siempre fondo.jpg
    delete state.config.customBgDataUrl;

    if (!Array.isArray(state.config.rainyMonths)) {
      state.config.rainyMonths = defaults.config.rainyMonths;
    } else {
      state.config.rainyMonths = Array.from(
        new Set(
          state.config.rainyMonths
            .map(m => parseInt(m, 10))
            .filter(m => Number.isInteger(m) && m >= 1 && m <= 12)
        )
      ).sort((a, b) => a - b);
    }

    const dRainy = parseInt(state.config.daysRainy, 10);
    state.config.daysRainy = Number.isInteger(dRainy) && dRainy >= 1 && dRainy <= 90 ? dRainy : 15;

    const dDry = parseInt(state.config.daysDry, 10);
    state.config.daysDry = Number.isInteger(dDry) && dDry >= 1 && dDry <= 90 ? dDry : 21;

    if (!Array.isArray(state.config.pilots) || state.config.pilots.length === 0) {
      state.config.pilots = defaults.config.pilots;
    }
    if (!Array.isArray(state.config.drones) || state.config.drones.length === 0) {
      state.config.drones = defaults.config.drones;
    }

    const clientRate = Number(state.config.clientRatePerHa);
    state.config.clientRatePerHa = Number.isFinite(clientRate) && clientRate >= 0 ? roundMoney(clientRate) : 15.0;

    const pilotRate = Number(state.config.pilotRatePerHa);
    state.config.pilotRatePerHa = Number.isFinite(pilotRate) && pilotRate >= 0 ? roundMoney(pilotRate) : 4.5;

    const op = parseInt(state.config.bgOverlayOpacity, 10);
    state.config.bgOverlayOpacity = Number.isInteger(op) && op >= 45 && op <= 80 ? op : 62;

    const remDays = parseInt(state.config.backupReminderDays, 10);
    state.config.backupReminderDays = Number.isInteger(remDays) && remDays >= 1 && remDays <= 60 ? remDays : 3;

    if (typeof state.config.autoBackupOnClose !== "boolean") {
      state.config.autoBackupOnClose = true;
    }

    if (!state.config.waTemplateReminder) state.config.waTemplateReminder = DEFAULT_WA_REMINDER_TEMPLATE;
    if (!state.config.waTemplateReschedule) state.config.waTemplateReschedule = DEFAULT_WA_RESCHEDULE_TEMPLATE;
    if (!state.config.waTemplatePayment) state.config.waTemplatePayment = DEFAULT_WA_PAYMENT_TEMPLATE;
  }

  if (!Array.isArray(state.producers)) state.producers = defaults.producers;
  if (!Array.isArray(state.sprays)) state.sprays = defaults.sprays;

  // Normalizar productores y fincas
  state.producers = state.producers
    .filter(p => p && typeof p === "object")
    .map((p, idx) => {
      const phoneParsed = parseEcuadorWhatsApp(p.phone);
      const farms = Array.isArray(p.farms)
        ? p.farms
            .filter(f => f && typeof f === "object")
            .map((f, fIdx) => ({
              id: f.id || `farm-${idx}-${fIdx}-${Date.now()}`,
              name: String(f.name || "Finca sin nombre").trim(),
              sector: String(f.sector || "El Oro").trim(),
              hectares: Math.max(0.01, roundHectares(Number(f.hectares) || 1)),
              crop: String(f.crop || "Banano"),
              lastSprayDate: isValidDateStr(f.lastSprayDate) ? f.lastSprayDate : "",
              manualLastSprayDate: isValidDateStr(f.manualLastSprayDate) ? f.manualLastSprayDate : "",
              rescheduledDate: isValidDateStr(f.rescheduledDate) ? f.rescheduledDate : null,
              rescheduleNote: String(f.rescheduleNote || "").trim(),
              rescheduleHistory: Array.isArray(f.rescheduleHistory) ? f.rescheduleHistory : []
            }))
        : [];

      return {
        id: p.id || `prod-${idx}-${Date.now()}`,
        name: String(p.name || "Productor").trim(),
        doc: normalizeDoc(p.doc || ""),
        phone: phoneParsed.valid ? phoneParsed.international : "",
        farms
      };
    });

  // Normalizar fumigaciones y consistencia de pagos
  state.sprays = state.sprays
    .filter(sp => sp && typeof sp === "object")
    .map((sp, idx) => {
      const amount = Math.max(0, roundMoney(Number(sp.amount) || 0));
      const hectares = Math.max(0.01, roundHectares(Number(sp.hectares) || 1));
      let payStatus = ["Pagado", "Parcial", "Pendiente"].includes(sp.payStatus) ? sp.payStatus : "Pendiente";
      let amountPaid = Math.max(0, roundMoney(Number(sp.amountPaid) || 0));

      if (payStatus === "Pagado") {
        amountPaid = amount;
      } else if (payStatus === "Pendiente") {
        amountPaid = 0;
      } else if (payStatus === "Parcial") {
        if (amountPaid >= amount && amount > 0) {
          payStatus = "Pagado";
          amountPaid = amount;
        } else if (amountPaid <= 0) {
          payStatus = "Pendiente";
          amountPaid = 0;
        }
      }

      const rawPilotPay = Number(sp.pilotPay);
      const pilotPay = Number.isFinite(rawPilotPay) && rawPilotPay >= 0
        ? roundMoney(rawPilotPay)
        : roundMoney(hectares * state.config.pilotRatePerHa);

      const products = Array.isArray(sp.products) && sp.products.length > 0
        ? sp.products.map(pr => ({
            commercialName: String(pr.commercialName || sp.product || "Aplicación agrícola").trim(),
            activeIngredient: String(pr.activeIngredient || "").trim(),
            dosePerHa: String(pr.dosePerHa || "").trim(),
            totalVolume: String(pr.totalVolume || "").trim(),
            batchLot: String(pr.batchLot || "").trim()
          }))
        : [{
            commercialName: String(sp.product || "Aplicación agrícola").trim(),
            activeIngredient: "",
            dosePerHa: "",
            totalVolume: "",
            batchLot: ""
          }];

      const status = ["Realizada", "Pendiente", "Reprogramada"].includes(sp.status)
        ? sp.status
        : "Realizada";

      const djiFlightKeys = Array.isArray(sp.djiFlightKeys)
        ? Array.from(new Set(sp.djiFlightKeys.map(k => String(k || "").trim()).filter(Boolean)))
        : [];

      const normalizedSpray = {
        id: sp.id || `sp-${idx}-${Date.now()}`,
        orderNumber: String(sp.orderNumber || `ORD-${getGuayaquilTodayStr().substring(0, 4)}-${String(idx + 1).padStart(3, "0")}`).trim(),
        farmId: sp.farmId || "",
        date: isValidDateStr(sp.date) ? sp.date : getGuayaquilTodayStr(),
        status,
        rescheduleDescription: String(sp.rescheduleDescription || "").trim(),
        hectares,
        product: products.map(pr => pr.commercialName).join(", "),
        products,
        drone: String(sp.drone || state.config.drones[0] || "Alfa_3"),
        pilot: String(sp.pilot || state.config.pilots[0] || "Juan Diego Cobos Anguisaca"),
        pilotPay,
        pilotPaid: Boolean(sp.pilotPaid),
        notes: String(sp.notes !== undefined ? sp.notes : (sp.manualWeather && sp.manualWeather.notes ? sp.manualWeather.notes : "")).trim(),
        amount,
        amountPaid,
        payMethod: ["Transferencia", "Cheque", "Efectivo"].includes(sp.payMethod) ? sp.payMethod : "Efectivo",
        payRef: String(sp.payRef || "").trim(),
        payBank: sp.payBank === "N/A" ? "" : String(sp.payBank || "").trim(),
        payStatus
      };

      if (djiFlightKeys.length > 0) {
        normalizedSpray.djiFlightKeys = djiFlightKeys;
      }

      return normalizedSpray;
    });

  // Migración de fecha manual: si una finca tiene lastSprayDate y ninguna fumigación Realizada, tomarla como manual
  state.producers.forEach(p => {
    (p.farms || []).forEach(f => {
      if (!isValidDateStr(f.manualLastSprayDate) && isValidDateStr(f.lastSprayDate)) {
        const hasCompletedSpray = state.sprays.some(
          sp => sp.farmId === f.id && sp.status === "Realizada" && isValidDateStr(sp.date)
        );
        if (!hasCompletedSpray) {
          f.manualLastSprayDate = f.lastSprayDate;
        }
      }
    });
  });

  if (!state.dji || typeof state.dji !== "object") {
    state.dji = { plotMemory: {}, locationMemory: {}, importedFlightKeys: [] };
  } else {
    const validFarmIds = new Set();
    state.producers.forEach(p => (p.farms || []).forEach(f => validFarmIds.add(f.id)));
    const cleanedMemory = {};
    if (state.dji.plotMemory && typeof state.dji.plotMemory === "object") {
      Object.entries(state.dji.plotMemory).forEach(([plotId, farmId]) => {
        const cleanPlot = String(plotId || "").trim();
        if (cleanPlot && validFarmIds.has(farmId)) {
          cleanedMemory[cleanPlot] = farmId;
        }
      });
    }
    const cleanedLocationMemory = {};
    if (state.dji.locationMemory && typeof state.dji.locationMemory === "object") {
      Object.entries(state.dji.locationMemory).forEach(([locKey, farmId]) => {
        const cleanLoc = normalizeDjiLocationKey(locKey);
        if (cleanLoc && validFarmIds.has(farmId)) {
          cleanedLocationMemory[cleanLoc] = farmId;
        }
      });
    }
    const cleanedKeys = Array.isArray(state.dji.importedFlightKeys)
      ? Array.from(new Set(state.dji.importedFlightKeys.map(k => String(k || "").trim()).filter(Boolean)))
      : [];
    state.dji = {
      plotMemory: cleanedMemory,
      locationMemory: cleanedLocationMemory,
      importedFlightKeys: cleanedKeys
    };
  }

  if (!Number.isInteger(state.calendarYear)) state.calendarYear = defaults.calendarYear;
  if (!Number.isInteger(state.calendarMonth) || state.calendarMonth < 0 || state.calendarMonth > 11) {
    state.calendarMonth = defaults.calendarMonth;
  }
}

function applyBackgroundAppearance() {
  const op = (state.config && state.config.bgOverlayOpacity) ? state.config.bgOverlayOpacity : 62;
  document.documentElement.style.setProperty("--bg-overlay-opacity", (op / 100).toFixed(2));
}

function updateSeasonBadges() {
  const todayMonth = parseInt(getGuayaquilTodayStr().split("-")[1], 10);
  const isRainyNow = state.config.rainyMonths.includes(todayMonth);
  const seasonName = isRainyNow
    ? `Temporada Lluviosa (${state.config.daysRainy}d)`
    : `Temporada Seca (${state.config.daysDry}d)`;

  const topText = document.getElementById("topSeasonText");
  const sideText = document.getElementById("sidebarSeasonText");
  if (topText) {
    topText.textContent = `Regla activa: ${state.config.daysRainy}d lluviosa / ${state.config.daysDry}d seca`;
  }
  if (sideText) {
    sideText.textContent = seasonName;
  }
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      state = JSON.parse(saved);
    } catch (err) {
      state = getInitialData();
    }
  } else {
    state = getInitialData();
  }
  ensureStateIntegrity();
  persistStateToStorage(false);
}

function persistStateToStorage(markUnexported = true, skipAutoBackup = false) {
  ensureStateIntegrity();
  if (markUnexported) {
    state.meta.hasUnexportedChanges = true;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    showToast("Error: espacio local lleno. Exporta un respaldo JSON y quita logos pesados.", "error");
    return false;
  }
  if (!skipAutoBackup) {
    writeAutoBackupSnapshot(false);
  }
  if (linkedBackupFileHandle) {
    writeLinkedBackupFile().catch(() => {});
  }
  updateBackupIndicators();
  return true;
}

function saveState(markUnexported = true) {
  return persistStateToStorage(markUnexported);
}

function writeAutoBackupSnapshot(silent = true) {
  try {
    const nowIso = new Date().toISOString();
    const snapshot = {
      savedAt: nowIso,
      data: state
    };
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(snapshot));
    state.meta.lastAutoBackupAt = nowIso;
    if (!silent) {
      updateBackupIndicators();
    }
  } catch (err) {
    // Si la cuota está al límite, no bloquear el guardado principal
  }
}

async function writeLinkedBackupFile() {
  if (!linkedBackupFileHandle) return;
  const writable = await linkedBackupFileHandle.createWritable();
  await writable.write(JSON.stringify(buildExportPayload(), null, 2));
  await writable.close();
  state.meta.lastBackupAt = new Date().toISOString();
  state.meta.hasUnexportedChanges = false;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateBackupIndicators();
}

async function linkAutoBackupFile() {
  if (typeof window.showSaveFilePicker !== "function") {
    showToast("Tu navegador no soporta guardado directo en archivo. Usa 'Exportar Respaldo JSON'.", "info");
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `AgroDrone_AutoBackup_${getGuayaquilTodayStr()}.json`,
      types: [
        {
          description: "Archivo de respaldo AgroDrone (JSON)",
          accept: { "application/json": [".json"] }
        }
      ]
    });
    linkedBackupFileHandle = handle;
    await writeLinkedBackupFile();
    const lbl = document.getElementById("linkAutoBackupFileLabel");
    if (lbl) lbl.textContent = `Archivo vinculado: ${handle.name}`;
    showToast(`Respaldo automático en disco vinculado a "${handle.name}".`, "success");
  } catch (err) {
    if (err && err.name !== "AbortError") {
      showToast("No se pudo vincular el archivo de respaldo.", "error");
    }
  }
}

function getBackupStatusInfo() {
  const todayStr = getGuayaquilTodayStr();
  const limitDays = state.config.backupReminderDays || 3;
  const lastBackupIso = state.meta.lastBackupAt;

  if (lastBackupIso) {
    const backupDateStr = lastBackupIso.substring(0, 10);
    const daysElapsed = Math.max(0, diffDaysBetweenDates(backupDateStr, todayStr));
    return {
      hasBackup: true,
      daysElapsed,
      isOverdue: daysElapsed >= limitDays,
      label: daysElapsed === 0 ? "Hoy" : `Hace ${daysElapsed} día(s)`,
      fullText: `${formatIsoDateTimeLocal(lastBackupIso)} (${daysElapsed === 0 ? "hoy" : `hace ${daysElapsed} día(s)`})`
    };
  }

  const createdDateStr = (state.meta.createdAt || new Date().toISOString()).substring(0, 10);
  const daysSinceStart = Math.max(0, diffDaysBetweenDates(createdDateStr, todayStr));
  const shouldWarn = daysSinceStart >= limitDays || state.meta.hasUnexportedChanges;
  return {
    hasBackup: false,
    daysElapsed: daysSinceStart,
    isOverdue: shouldWarn,
    label: "Sin respaldo",
    fullText: "Aún no se ha descargado un respaldo JSON"
  };
}

function updateBackupIndicators() {
  const info = getBackupStatusInfo();
  const sideText = document.getElementById("sidebarBackupDateText");
  if (sideText) {
    sideText.textContent = info.label;
    sideText.className = info.isOverdue
      ? "font-bold text-amber-300"
      : "font-semibold text-brand-accent";
  }

  const settingsMeta = document.getElementById("settingsBackupMetaInfo");
  if (settingsMeta) {
    const autoText = state.meta.lastAutoBackupAt
      ? ` • Último auto-respaldo local: ${formatIsoDateTimeLocal(state.meta.lastAutoBackupAt)}`
      : "";
    settingsMeta.textContent = `Último respaldo JSON: ${info.fullText}${autoText}`;
  }

  const banner = document.getElementById("backupReminderBanner");
  const bannerText = document.getElementById("backupReminderText");
  if (banner && bannerText) {
    if (info.isOverdue && !backupBannerDismissed) {
      if (!info.hasBackup) {
        bannerText.textContent = state.meta.hasUnexportedChanges
          ? "Tienes cambios registrados y todavía no has descargado un respaldo JSON. Guarda una copia para proteger tu información."
          : `Han pasado ${info.daysElapsed} día(s) sin descargar tu primer respaldo JSON.`;
      } else {
        bannerText.textContent = `Han pasado ${info.daysElapsed} día(s) desde tu último respaldo JSON (${formatIsoDateTimeLocal(state.meta.lastBackupAt)}). Se recomienda respaldar cada ${state.config.backupReminderDays} día(s).`;
      }
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }
}

function dismissBackupBannerForSession() {
  backupBannerDismissed = true;
  const banner = document.getElementById("backupReminderBanner");
  if (banner) banner.classList.add("hidden");
}

// ==========================================================================
// 7. MOTOR DE FRECUENCIAS (SOLO TEMPORADA CONFIGURADA, SIN CLIMA)
// ==========================================================================
function calculateScheduleForDate(dateStr) {
  if (!isValidDateStr(dateStr)) {
    return {
      valid: false,
      sourceDateStr: "",
      isRainy: false,
      daysToAdd: state.config.daysDry,
      nextDateStr: null
    };
  }
  const month = parseInt(dateStr.split("-")[1], 10);
  const isRainy = state.config.rainyMonths.includes(month);
  const daysToAdd = isRainy ? state.config.daysRainy : state.config.daysDry;
  const nextDateStr = addDaysToDateStr(dateStr, daysToAdd);

  return {
    valid: true,
    sourceDateStr: dateStr,
    isRainy,
    daysToAdd,
    nextDateStr
  };
}

function calculateFarmSchedule(farm) {
  const hasLastSpray = Boolean(farm && isValidDateStr(farm.lastSprayDate));
  const lastSprayStr = hasLastSpray ? farm.lastSprayDate : "";
  const rule = hasLastSpray ? calculateScheduleForDate(lastSprayStr) : null;
  const baseDateStr = rule ? rule.nextDateStr : null;

  const hasReschedule = Boolean(farm && isValidDateStr(farm.rescheduledDate));
  const effectiveDateStr = hasReschedule ? farm.rescheduledDate : baseDateStr;
  const rescheduleDescription = hasReschedule
    ? (farm.rescheduleNote ||
        (Array.isArray(farm.rescheduleHistory) && farm.rescheduleHistory[0]
          ? farm.rescheduleHistory[0].description
          : "Reprogramada"))
    : "";

  return {
    hasLastSpray,
    lastSprayStr,
    daysToAdd: rule ? rule.daysToAdd : state.config.daysDry,
    isRainy: rule ? rule.isRainy : false,
    baseDateStr,
    hasReschedule,
    rescheduledDate: hasReschedule ? farm.rescheduledDate : null,
    effectiveDateStr,
    rescheduleDescription
  };
}

function syncFarmLastSprayFromHistory(farmId) {
  const farm = getFarmById(farmId);
  if (!farm) return;

  const candidateDates = state.sprays
    .filter(sp => sp.farmId === farmId && sp.status === "Realizada" && isValidDateStr(sp.date))
    .map(sp => sp.date);

  if (isValidDateStr(farm.manualLastSprayDate)) {
    candidateDates.push(farm.manualLastSprayDate);
  }

  candidateDates.sort();

  if (candidateDates.length > 0) {
    const latestDate = candidateDates[candidateDates.length - 1];
    farm.lastSprayDate = latestDate;
    if (farm.rescheduledDate && farm.rescheduledDate <= latestDate) {
      farm.rescheduledDate = null;
      farm.rescheduleNote = "";
    }
  } else {
    farm.lastSprayDate = "";
    farm.rescheduledDate = null;
    farm.rescheduleNote = "";
  }
}

// ==========================================================================
// 8. CÁLCULOS FINANCIEROS CONSISTENTES
// ==========================================================================
function getSprayPaidAmount(sp) {
  const total = Math.max(0, roundMoney(Number(sp.amount) || 0));
  if (sp.payStatus === "Pagado") return total;
  if (sp.payStatus === "Parcial") {
    const paid = Math.max(0, roundMoney(Number(sp.amountPaid) || 0));
    return Math.min(total, paid);
  }
  return 0;
}

function getSprayPendingBalance(sp) {
  const total = Math.max(0, roundMoney(Number(sp.amount) || 0));
  const paid = getSprayPaidAmount(sp);
  return roundMoney(Math.max(0, total - paid));
}

function generateNextOrderNumber(dateStr) {
  const year = isValidDateStr(dateStr) ? dateStr.substring(0, 4) : getGuayaquilTodayStr().substring(0, 4);
  const prefix = `ORD-${year}-`;
  let maxSeq = 0;
  state.sprays.forEach(sp => {
    if (typeof sp.orderNumber === "string" && sp.orderNumber.startsWith(prefix)) {
      const seq = parseInt(sp.orderNumber.substring(prefix.length), 10);
      if (Number.isInteger(seq) && seq > maxSeq) maxSeq = seq;
    }
  });
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

// ==========================================================================
// 9. NAVEGACIÓN Y RENDERIZADO GENERAL
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
      nav.className = "w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-medium text-left transition-all nav-active";
    } else {
      section.classList.add("hidden");
      nav.className = "w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-medium text-left transition-all text-slate-300 hover:text-white hover:bg-slate-800/60";
    }
  });

  const titles = {
    dashboard: ["Panel Principal", "Control de pendientes, cobros, depósito al piloto y próximas fumigaciones"],
    daily: ["Registrar Fumigados del Día", "Marca las fincas fumigadas en una fecha y regístralas todas a la vez"],
    dji: ["Importar vuelos DJI", "Carga el Excel semanal de DJI SmartFarm (Task History), asigna lotes y registra fumigaciones"],
    producers: ["Productores y Fincas", "Gestión de productores, múltiples fincas, validación por cédula, WhatsApp e historial PDF"],
    sprays: ["Fumigaciones", "Historial de aplicaciones (Realizada, Pendiente, Reprogramada), dosis y PDF"],
    calendar: ["Calendario de Fumigaciones", "Programación mensual con fechas base de temporada y fechas reprogramadas"],
    billing: ["Cobros y Cartera", "Cobros reales por método de pago, abonos parciales, exportación CSV y WhatsApp"],
    settings: ["Configuración y Respaldo", "Asociación, tarifas, pilotos, drones, plantillas WhatsApp, temporadas y respaldo JSON"]
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

  if (tabId === "dashboard") renderDashboard();
  if (tabId === "daily") initDailyBatchTab();
  if (tabId === "dji") renderDjiTab();
  if (tabId === "producers") {
    populateSectorFilter();
    renderProducersList();
  }
  if (tabId === "sprays") renderSpraysTable();
  if (tabId === "calendar") renderCalendar();
  if (tabId === "billing") renderBillingTable();
  if (tabId === "settings") populateSettingsForm();
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (sidebar) sidebar.classList.add("-translate-x-full");
  if (overlay) overlay.classList.add("hidden");
}

function refreshAllViews() {
  applyBackgroundAppearance();
  updateSeasonBadges();
  updateBackupIndicators();
  populateSectorFilter();
  renderDashboard();
  renderProducersList();
  renderSpraysTable();
  renderBillingTable();
  renderCalendar();
  if (currentActiveTab === "daily") {
    renderDailyBatchList();
  }
  if (currentActiveTab === "dji") {
    renderDjiTab();
  }
  if (currentActiveTab === "settings") {
    populateSettingsForm();
  }
}

// ==========================================================================
// 10. PANEL PRINCIPAL (DASHBOARD Y GRÁFICOS)
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

  document.getElementById("kpiProducersCount").textContent = state.producers.length;
  document.getElementById("kpiFarmsCount").textContent = `${farms.length} ${farms.length === 1 ? "finca registrada" : "fincas registradas"}`;

  let totalHa = 0;
  let monthSprays = 0;
  let pendingAmount = 0;
  let pendingCount = 0;
  let expiredCount = 0;
  let totalPilotPending = 0;

  state.sprays.forEach(sp => {
    if (sp.status === "Realizada") {
      totalHa = roundHectares(totalHa + (Number(sp.hectares) || 0));
      if (sp.date && sp.date.startsWith(currentMonthPrefix)) monthSprays++;
      if (!sp.pilotPaid) {
        totalPilotPending = roundMoney(totalPilotPending + (Number(sp.pilotPay) || 0));
      }
    }
    const saldo = getSprayPendingBalance(sp);
    if (saldo > 0) {
      pendingAmount = roundMoney(pendingAmount + saldo);
      pendingCount++;
    }
  });

  document.getElementById("kpiTotalHectares").textContent = `${formatHectares(totalHa)} ha`;
  document.getElementById("kpiMonthSprays").textContent = monthSprays;
  document.getElementById("kpiMonthLabel").textContent = `Realizadas en ${currentMonthPrefix}`;
  document.getElementById("kpiPendingAmount").textContent = formatMoney(pendingAmount);
  document.getElementById("kpiPendingCount").textContent = `${pendingCount} ${pendingCount === 1 ? "cuenta con saldo" : "cuentas con saldo"}`;

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
          <td class="py-3 px-3">
            <div class="font-bold text-white">${escapeHtml(farm.name)}</div>
            <div class="text-[11px] text-slate-300">${escapeHtml(prod ? prod.name : "")} • ${escapeHtml(farm.crop)} (${formatHectares(farm.hectares)} ha)</div>
          </td>
          <td class="py-3 px-3 text-slate-300 text-xs">${escapeHtml(farm.sector)}</td>
          <td class="py-3 px-3 text-slate-300 text-xs whitespace-nowrap">${sched.hasLastSpray ? formatDisplayDate(sched.lastSprayStr) : '<span class="text-slate-400 italic">Sin fumigación registrada</span>'}</td>
          <td class="py-3 px-3 whitespace-nowrap">
            <div class="font-bold ${sched.hasReschedule ? "text-amber-300" : (sched.effectiveDateStr ? "text-white" : "text-slate-400")}">${sched.effectiveDateStr ? formatDisplayDate(sched.effectiveDateStr) : "Sin fumigación registrada"}</div>
            ${sched.hasReschedule && sched.baseDateStr ? `<div class="text-[10px] text-slate-400">Base: ${formatDisplayDate(sched.baseDateStr)}</div>` : ""}
          </td>
          <td class="py-3 px-3 whitespace-nowrap">${dateBadge}</td>
          <td class="py-3 px-3 max-w-xs">${detailText}</td>
          <td class="py-3 px-3 text-right whitespace-nowrap space-x-1">
            <button type="button" onclick="openRescheduleModal('${farm.id}')" class="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 rounded-lg text-[11px] font-bold border border-amber-500/35">
              Reprogramar
            </button>
            ${waBtn}
          </td>
        </tr>
      `;
    }).join("");
  }

  document.getElementById("kpiExpiredCount").textContent = expiredCount;
  document.getElementById("pendientesPorCobrar").textContent = formatMoney(pendingAmount);
  document.getElementById("pendientesDepositoPiloto").textContent = formatMoney(totalPilotPending);

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
            <div class="flex items-center justify-end space-x-1.5 pt-2 border-t border-white/10">
              <button type="button" onclick="openRescheduleModal('${item.farm.id}')" class="px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 text-[11px] font-bold">
                Reprogramar
              </button>
              ${waBtn}
            </div>
          </div>
        `;
      }).join("");
    }
  }

  renderDashboardCharts();
  safeRefreshIcons();
}

function renderDashboardCharts() {
  const ctxHectaresEl = document.getElementById("chartHectaresMonth");
  const ctxPaymentEl = document.getElementById("chartPaymentMethods");
  if (!ctxHectaresEl || !ctxPaymentEl || typeof Chart === "undefined") return;

  if (chartHectaresInstance) chartHectaresInstance.destroy();
  if (chartPaymentInstance) chartPaymentInstance.destroy();

  const monthBuckets = {};
  state.sprays.forEach(sp => {
    if (sp.status === "Realizada" && isValidDateStr(sp.date)) {
      const ym = sp.date.substring(0, 7);
      monthBuckets[ym] = roundHectares((monthBuckets[ym] || 0) + (Number(sp.hectares) || 0));
    }
  });

  const sortedMonths = Object.keys(monthBuckets).sort();
  const labels = sortedMonths.length > 0 ? sortedMonths : [getGuayaquilTodayStr().substring(0, 7)];
  const values = sortedMonths.length > 0 ? sortedMonths.map(m => monthBuckets[m]) : [0];

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

  // Sumar ÚNICAMENTE montos realmente cobrados por método de pago + saldo pendiente aparte
  let transferCollected = 0;
  let checkCollected = 0;
  let cashCollected = 0;
  let totalPending = 0;

  state.sprays.forEach(sp => {
    const paid = getSprayPaidAmount(sp);
    const pending = getSprayPendingBalance(sp);
    totalPending = roundMoney(totalPending + pending);

    if (sp.payMethod === "Transferencia") transferCollected = roundMoney(transferCollected + paid);
    else if (sp.payMethod === "Cheque") checkCollected = roundMoney(checkCollected + paid);
    else cashCollected = roundMoney(cashCollected + paid);
  });

  chartPaymentInstance = new Chart(ctxPaymentEl.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: ["Transferencia (Cobrado)", "Cheque (Cobrado)", "Efectivo (Cobrado)", "Por Cobrar"],
      datasets: [{
        data: [transferCollected, checkCollected, cashCollected, totalPending],
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
// 11. REGISTRAR FUMIGADOS DEL DÍA (REGISTRO EN LOTE)
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

  const pilotsOpts = (state.config.pilots || ["Juan Diego Cobos Anguisaca"])
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  const dronesOpts = (state.config.drones || ["Alfa_3"])
    .map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");

  const clientRate = Number.isFinite(state.config.clientRatePerHa) ? state.config.clientRatePerHa : 15;
  const pilotRate = Number.isFinite(state.config.pilotRatePerHa) ? state.config.pilotRatePerHa : 4.5;

  container.innerHTML = farms.map(farm => {
    const prod = getProducerByFarmId(farm.id);
    const sched = calculateFarmSchedule(farm);
    const ha = roundHectares(farm.hectares);
    const defaultAmt = roundMoney(ha * clientRate).toFixed(2);
    const defaultPilotPay = roundMoney(ha * pilotRate).toFixed(2);

    return `
      <div class="daily-farm-card rounded-2xl border border-brand-border bg-slate-950/65 p-4 transition-all" data-farm-id="${farm.id}" data-search="${escapeHtml((farm.name + " " + (prod ? prod.name : "") + " " + farm.sector).toLowerCase())}">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label class="flex items-center space-x-3 cursor-pointer select-none flex-1">
            <input type="checkbox" class="daily-farm-cb w-5 h-5 accent-emerald-400 rounded cursor-pointer shrink-0" onchange="toggleDailyFarmFields(this)">
            <div class="min-w-0">
              <div class="font-bold text-white text-sm">${escapeHtml(farm.name)} <span class="text-xs font-normal text-brand-accent">(${formatHectares(ha)} ha • ${escapeHtml(farm.crop)})</span></div>
              <div class="text-xs text-slate-300 truncate">${escapeHtml(prod ? prod.name : "")} • ${escapeHtml(farm.sector)} • Próxima: <strong class="text-brand-blue">${sched.effectiveDateStr ? formatDisplayDate(sched.effectiveDateStr) : "Sin fumigación registrada"}</strong></div>
            </div>
          </label>
          <span class="daily-status-pill text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 font-semibold self-start sm:self-center shrink-0">Sin marcar</span>
        </div>

        <div class="daily-fields hidden mt-4 pt-4 border-t border-white/10 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Hectáreas *</label>
              <input type="number" step="0.01" min="0.01" class="daily-ha w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs" value="${formatHectares(ha)}" oninput="recalcDailyCardAmounts(this)">
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
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Monto Cliente ($) *</label>
              <input type="number" step="0.01" min="0" class="daily-amount w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs" value="${defaultAmt}">
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-300 uppercase mb-1">Depósito Piloto ($)</label>
              <input type="number" step="0.01" min="0" class="daily-pilot-pay w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-brand-blue text-xs" value="${defaultPilotPay}">
            </div>
          </div>

          <div class="p-3 rounded-xl bg-slate-900/75 border border-brand-accent/25 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold uppercase text-brand-accent">Producto(s) y Dosis</span>
              <button type="button" onclick="addDailyProductRow(this)" class="text-[11px] px-2.5 py-1 rounded bg-brand-accent/20 text-brand-accent hover:bg-brand-accent/30 font-bold">+ Producto</button>
            </div>
            <div class="daily-products-list space-y-2">
              <div class="daily-prod-row grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                <input type="text" class="dp-name px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Nombre comercial *" value="Fungicida Agrícola">
                <input type="text" class="dp-active px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Ing. activo (opc.)">
                <input type="text" class="dp-dose px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Dosis/ha (ej. 1 L/ha)">
                <input type="text" class="dp-vol px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Vol. total">
                <input type="text" class="dp-lot px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Lote">
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
              <select class="daily-pay-status w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-brand-border text-white text-xs" onchange="toggleDailyPartialInput(this)">
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

function recalcDailyCardAmounts(haInput) {
  const card = haInput.closest(".daily-farm-card");
  const ha = roundHectares(Math.max(0, parseFloat(haInput.value) || 0));
  const clientRate = Number.isFinite(state.config.clientRatePerHa) ? state.config.clientRatePerHa : 15;
  const pilotRate = Number.isFinite(state.config.pilotRatePerHa) ? state.config.pilotRatePerHa : 4.5;
  card.querySelector(".daily-amount").value = roundMoney(ha * clientRate).toFixed(2);
  card.querySelector(".daily-pilot-pay").value = roundMoney(ha * pilotRate).toFixed(2);
}

function toggleDailyPartialInput(selectEl) {
  const card = selectEl.closest(".daily-farm-card");
  const wrap = card.querySelector(".daily-partial-wrap");
  if (selectEl.value === "Parcial") wrap.classList.remove("hidden");
  else wrap.classList.add("hidden");
}

function addDailyProductRow(btn) {
  const list = btn.closest(".daily-fields").querySelector(".daily-products-list");
  const row = document.createElement("div");
  row.className = "daily-prod-row grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2";
  row.innerHTML = `
    <input type="text" class="dp-name px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Nombre comercial *">
    <input type="text" class="dp-active px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Ing. activo (opc.)">
    <input type="text" class="dp-dose px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Dosis/ha">
    <input type="text" class="dp-vol px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Vol. total">
    <div class="flex items-center space-x-1">
      <input type="text" class="dp-lot w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Lote">
      <button type="button" onclick="this.closest('.daily-prod-row').remove()" class="text-rose-400 px-2 py-1 hover:bg-rose-500/20 rounded-lg font-bold" title="Quitar producto">×</button>
    </div>
  `;
  list.appendChild(row);
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

  // Fase 1: Validar todas las tarjetas marcadas antes de guardar cualquier registro
  const entriesToSave = [];
  for (let i = 0; i < checkedBoxes.length; i++) {
    const card = checkedBoxes[i].closest(".daily-farm-card");
    card.classList.remove("border-rose-500");
    const farmId = card.getAttribute("data-farm-id");
    const farm = getFarmById(farmId);
    if (!farm) continue;

    const hectares = parseFloat(card.querySelector(".daily-ha").value);
    const amount = parseFloat(card.querySelector(".daily-amount").value);
    const pilotPay = parseFloat(card.querySelector(".daily-pilot-pay").value);
    const payMethod = card.querySelector(".daily-pay-method").value;
    let payStatus = card.querySelector(".daily-pay-status").value;
    const payRef = card.querySelector(".daily-pay-ref").value.trim();
    const notes = card.querySelector(".daily-notes").value.trim();
    const pilot = card.querySelector(".daily-pilot").value;
    const drone = card.querySelector(".daily-drone").value;

    if (!Number.isFinite(hectares) || hectares <= 0 || hectares > 10000) {
      card.classList.add("border-rose-500");
      showToast(`Hectáreas inválidas en "${farm.name}".`, "error");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      card.classList.add("border-rose-500");
      showToast(`Monto cliente inválido en "${farm.name}".`, "error");
      return;
    }
    if (!Number.isFinite(pilotPay) || pilotPay < 0) {
      card.classList.add("border-rose-500");
      showToast(`Depósito al piloto inválido en "${farm.name}".`, "error");
      return;
    }

    let amountPaid = 0;
    if (payStatus === "Pagado") {
      amountPaid = roundMoney(amount);
    } else if (payStatus === "Parcial") {
      const rawPaid = parseFloat(card.querySelector(".daily-paid-amt").value);
      if (!Number.isFinite(rawPaid) || rawPaid <= 0) {
        card.classList.add("border-rose-500");
        showToast(`En "${farm.name}", el abono parcial debe ser mayor a $0.00.`, "error");
        return;
      }
      if (rawPaid > amount) {
        card.classList.add("border-rose-500");
        showToast(`En "${farm.name}", el abono ($${rawPaid.toFixed(2)}) no puede superar el monto total ($${amount.toFixed(2)}).`, "error");
        return;
      }
      if (roundMoney(rawPaid) === roundMoney(amount)) {
        payStatus = "Pagado";
        amountPaid = roundMoney(amount);
      } else {
        amountPaid = roundMoney(rawPaid);
      }
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
      farm,
      farmId,
      hectares: roundHectares(hectares),
      pilot,
      drone,
      amount: roundMoney(amount),
      pilotPay: roundMoney(pilotPay),
      payMethod,
      payStatus,
      amountPaid,
      payRef,
      notes,
      products
    });
  }

  // Fase 2: Guardar todas las fumigaciones validadas
  entriesToSave.forEach((entry, i) => {
    const orderNum = generateNextOrderNumber(dateStr);
    state.sprays.unshift({
      id: `sp-${Date.now()}-${i}`,
      orderNumber: orderNum,
      farmId: entry.farmId,
      date: dateStr,
      status: "Realizada",
      rescheduleDescription: "",
      hectares: entry.hectares,
      product: entry.products.map(p => p.commercialName).join(", "),
      products: entry.products,
      drone: entry.drone,
      pilot: entry.pilot,
      pilotPay: entry.pilotPay,
      pilotPaid: false,
      notes: entry.notes,
      amount: entry.amount,
      amountPaid: entry.amountPaid,
      payMethod: entry.payMethod,
      payRef: entry.payRef,
      payBank: "",
      payStatus: entry.payStatus
    });

    syncFarmLastSprayFromHistory(entry.farmId);
  });

  saveState(true);
  refreshAllViews();
  showToast(`Se registraron ${entriesToSave.length} fumigación(es) del ${formatDisplayDate(dateStr)} y se recalcularon las próximas fechas.`, "success");
}

// ==========================================================================
// 12. PRODUCTORES Y FINCAS
// ==========================================================================
function populateSectorFilter() {
  const sel = document.getElementById("filterSectorSelect");
  if (!sel) return;
  const current = sel.value || "ALL";
  const sectors = new Set();
  getAllFarms().forEach(f => sectors.add(getSectorGroupName(f.sector)));
  sel.innerHTML = `<option value="ALL">Todos los sectores</option>`;
  Array.from(sectors).sort().forEach(s => {
    sel.innerHTML += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
  });
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
        <div class="p-3.5 rounded-xl bg-slate-950/70 border border-brand-border hover:border-brand-accent/35 transition-all space-y-2.5">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h5 class="font-bold text-white text-sm">${escapeHtml(farm.name)}</h5>
                ${statusPill}
              </div>
              <p class="text-[11px] text-slate-300 mt-0.5">${escapeHtml(farm.crop)} • ${formatHectares(farm.hectares)} ha • ${escapeHtml(farm.sector)}</p>
            </div>
            <div class="flex flex-wrap items-center gap-1.5 shrink-0">
              <button type="button" onclick="openRescheduleModal('${farm.id}')" class="px-2 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 text-[11px] font-bold">
                Reprog.
              </button>
              ${waBtn}
              <button type="button" onclick="openFarmEditModal('${prod.id}', '${farm.id}')" class="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white border border-brand-border" title="Editar finca">
                <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
              </button>
              <button type="button" onclick="requestDeleteFarm('${prod.id}', '${farm.id}')" class="p-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30" title="Eliminar finca">
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
            <button type="button" onclick="openAddFarmModal('${prod.id}')" class="px-2.5 py-2 bg-brand-accent/15 text-brand-accent rounded-xl hover:bg-brand-accent/25 text-xs font-bold border border-brand-accent/30 flex items-center space-x-1" title="Agregar otra finca">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>Finca</span>
            </button>
            <button type="button" onclick="openStatementModal('${prod.id}')" class="px-2.5 py-2 bg-slate-800 text-brand-blue rounded-xl hover:bg-slate-700 text-xs font-semibold flex items-center space-x-1 border border-brand-border" title="PDF Historial del Productor">
              <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
              <span>PDF</span>
            </button>
            <button type="button" onclick="openProducerModal('${prod.id}')" class="p-2 bg-slate-800 text-slate-300 rounded-xl hover:text-white text-xs border border-brand-border" title="Editar productor">
              <i data-lucide="edit-2" class="w-4 h-4"></i>
            </button>
            <button type="button" onclick="requestDeleteProducer('${prod.id}')" class="p-2 bg-rose-500/10 text-rose-300 rounded-xl hover:bg-rose-500/25 text-xs border border-rose-500/30" title="Eliminar productor">
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
    container.innerHTML = `<div class="col-span-1 lg:col-span-2 text-center py-10 text-sm text-slate-300 glass-card rounded-2xl">No se encontraron productores con los filtros seleccionados.</div>`;
  } else {
    container.innerHTML = cardsHtml.join("");
  }

  safeRefreshIcons();
}

// ==========================================================================
// 13. TABLA DE FUMIGACIONES
// ==========================================================================
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
    const paid = getSprayPaidAmount(sp);
    const saldo = getSprayPendingBalance(sp);

    let payStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-brand-accent">Pagado</span>`;
    if (sp.payStatus === "Parcial") {
      payStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300">Parcial (${formatMoney(paid)})</span>`;
    } else if (sp.payStatus === "Pendiente") {
      payStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-300">Pendiente</span>`;
    }

    let sprayStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-brand-accent border border-brand-accent/35">Realizada</span>`;
    if (sp.status === "Pendiente") {
      sprayStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-brand-blue/20 text-brand-blue border border-brand-blue/35">Pendiente</span>`;
    } else if (sp.status === "Reprogramada") {
      sprayStatusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35">Reprogramada</span>`;
    }

    const productsSummary = Array.isArray(sp.products) && sp.products.length > 0
      ? sp.products.map(pr => pr.commercialName).filter(Boolean).join(", ")
      : (sp.product || "N/A");

    const pilotDepositBadge = sp.pilotPaid
      ? `<span class="text-[10px] text-emerald-400 font-semibold">Dep. piloto OK (${formatMoney(sp.pilotPay)})</span>`
      : `<button type="button" onclick="requestMarkPilotAsPaid('${sp.id}')" class="text-[10px] text-brand-blue underline hover:text-white font-semibold">Depositar ${formatMoney(sp.pilotPay)}</button>`;

    return `
      <tr class="hover:bg-slate-900/55 transition-colors">
        <td class="py-3 px-3 font-semibold text-white whitespace-nowrap">
          <div>${escapeHtml(sp.date)}</div>
          <div class="text-[10px] font-mono text-brand-blue">${escapeHtml(sp.orderNumber || "")}</div>
        </td>
        <td class="py-3 px-3">
          <div class="font-bold text-white">${escapeHtml(farm ? farm.name : "Finca eliminada")}</div>
          <div class="text-[11px] text-slate-300">${escapeHtml(prod ? prod.name : "")}</div>
        </td>
        <td class="py-3 px-3 font-bold text-brand-accent whitespace-nowrap">${formatHectares(sp.hectares)} ha</td>
        <td class="py-3 px-3">
          <div class="text-slate-100">${escapeHtml(productsSummary)}</div>
          <div class="text-[11px] text-brand-blue">${escapeHtml(sp.drone)}</div>
        </td>
        <td class="py-3 px-3 text-slate-200">
          <div>${escapeHtml(sp.pilot)}</div>
          <div>${pilotDepositBadge}</div>
        </td>
        <td class="py-3 px-3">
          <div class="font-bold text-white">${formatMoney(sp.amount)} ${saldo > 0 ? `<span class="text-[10px] text-amber-300">(Saldo ${formatMoney(saldo)})</span>` : ""}</div>
          <div class="text-[11px] text-slate-300">${escapeHtml(sp.payMethod)} (${escapeHtml(sp.payRef || "S/R")})</div>
          <div class="mt-0.5">${payStatusBadge}</div>
        </td>
        <td class="py-3 px-3">
          <div>${sprayStatusBadge}</div>
          ${sp.rescheduleDescription ? `<div class="text-[11px] text-amber-200 mt-1 max-w-[180px]">${escapeHtml(sp.rescheduleDescription)}</div>` : ""}
        </td>
        <td class="py-3 px-3 text-right whitespace-nowrap space-x-1">
          ${sp.status !== "Realizada" && farm ? `<button type="button" onclick="openRescheduleModal('${sp.farmId}', '${sp.id}')" class="px-2 py-1.5 bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 rounded-lg text-[11px] font-bold border border-amber-500/35">Reprog.</button>` : ""}
          <button type="button" onclick="openSprayPdfModal('${sp.id}')" class="px-2.5 py-1.5 bg-brand-blue/20 text-brand-blue hover:bg-brand-blue/35 rounded-lg text-xs font-bold border border-brand-blue/35" title="Generar PDF de esta fumigación">
            PDF
          </button>
          <button type="button" onclick="openSprayModal('${sp.id}')" class="p-1.5 bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-brand-border align-middle" title="Editar fumigación">
            <i data-lucide="edit-2" class="w-4 h-4"></i>
          </button>
          <button type="button" onclick="requestDeleteSpray('${sp.id}')" class="p-1.5 bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 rounded-lg border border-rose-500/30 align-middle" title="Eliminar fumigación">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  safeRefreshIcons();
}

function requestMarkPilotAsPaid(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  openConfirmModal(
    "Confirmar depósito al piloto",
    `¿Marcar como depositado el pago de ${formatMoney(sp.pilotPay)} al piloto ${sp.pilot} (Orden ${sp.orderNumber})?`,
    () => {
      sp.pilotPaid = true;
      saveState(true);
      renderSpraysTable();
      renderDashboard();
      showToast("Depósito al piloto marcado como pagado.", "success");
    },
    "Sí, marcar depositado",
    false
  );
}

// ==========================================================================
// 14. CALENDARIO (SIN DUPLICADOS EN REPROGRAMACIONES + RESUMEN MÓVIL)
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
    gridHtml += `<div class="p-2 bg-slate-950/30 rounded-xl border border-brand-border/20 opacity-40"></div>`;
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${monthPrefix}-${String(day).padStart(2, "0")}`;
    const isToday = dateStr === todayStr;
    let itemsHtml = "";

    schedules.forEach(({ farm, sched }) => {
      // Mostrar SOLO la fecha activa (reprogramada si existe; si no, fecha base) para evitar duplicados
      if (sched.hasReschedule) {
        if (sched.rescheduledDate === dateStr) {
          itemsHtml += `<div onclick="openRescheduleModal('${farm.id}')" class="cursor-pointer text-[10px] px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-200 border border-amber-400/50 font-bold truncate hover:bg-amber-500/35" title="Reprogramada: ${escapeHtml(farm.name)} (${escapeHtml(sched.rescheduleDescription)})">Reprog: ${escapeHtml(farm.name)}</div>`;
        }
      } else if (sched.baseDateStr === dateStr) {
        itemsHtml += `<div onclick="openRescheduleModal('${farm.id}')" class="cursor-pointer text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-brand-accent border border-brand-accent/40 font-semibold truncate hover:bg-emerald-500/30" title="Fecha Base: ${escapeHtml(farm.name)}">${escapeHtml(farm.name)}</div>`;
      }
    });

    gridHtml += `
      <div class="p-2 rounded-xl border min-h-[78px] flex flex-col justify-start ${isToday ? "bg-brand-accent/15 border-brand-accent/65 shadow-inner" : "bg-slate-900/55 border-brand-border/60"}">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-bold ${isToday ? "text-brand-accent" : "text-white"}">${day}</span>
          ${isToday ? '<span class="text-[9px] font-extrabold text-black bg-brand-accent px-1.5 rounded">HOY</span>' : ""}
        </div>
        <div class="space-y-1">${itemsHtml}</div>
      </div>
    `;
  }

  grid.innerHTML = gridHtml;

  // Resumen mensual legible en celular y escritorio
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
          <button type="button" onclick="openRescheduleModal('${farm.id}')" class="px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 text-[11px] font-bold shrink-0">
            Reprog.
          </button>
        </div>
      `).join("");
    }
  }
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
// 15. COBROS Y CARTERA (COBROS REALES, ABONOS, CSV Y WHATSAPP)
// ==========================================================================
function renderBillingTable() {
  const tbody = document.getElementById("billingTableBody");
  const summaryEl = document.getElementById("billingSummaryCards");
  if (!tbody || !summaryEl) return;

  const filterEl = document.getElementById("filterBillingStatusSelect");
  const filterVal = filterEl ? filterEl.value : "ALL";

  let collectedTransfer = 0;
  let collectedCheque = 0;
  let collectedEfectivo = 0;
  let totalPorCobrar = 0;

  state.sprays.forEach(sp => {
    const paid = getSprayPaidAmount(sp);
    const saldo = getSprayPendingBalance(sp);
    totalPorCobrar = roundMoney(totalPorCobrar + saldo);

    if (sp.payMethod === "Transferencia") collectedTransfer = roundMoney(collectedTransfer + paid);
    else if (sp.payMethod === "Cheque") collectedCheque = roundMoney(collectedCheque + paid);
    else collectedEfectivo = roundMoney(collectedEfectivo + paid);
  });

  summaryEl.innerHTML = `
    <div class="glass-card p-4 rounded-2xl border border-brand-blue/35">
      <div class="text-[11px] text-slate-300 uppercase font-bold">Transferencias (Cobrado)</div>
      <div class="text-2xl font-black text-brand-blue mt-1">${formatMoney(collectedTransfer)}</div>
    </div>
    <div class="glass-card p-4 rounded-2xl border border-amber-500/35">
      <div class="text-[11px] text-slate-300 uppercase font-bold">Cheques (Cobrado)</div>
      <div class="text-2xl font-black text-amber-400 mt-1">${formatMoney(collectedCheque)}</div>
    </div>
    <div class="glass-card p-4 rounded-2xl border border-brand-accent/35">
      <div class="text-[11px] text-slate-300 uppercase font-bold">Efectivo (Cobrado)</div>
      <div class="text-2xl font-black text-brand-accent mt-1">${formatMoney(collectedEfectivo)}</div>
    </div>
    <div class="glass-card p-4 rounded-2xl border border-rose-500/35">
      <div class="text-[11px] text-slate-300 uppercase font-bold">Total Por Cobrar</div>
      <div class="text-2xl font-black text-rose-400 mt-1">${formatMoney(totalPorCobrar)}</div>
    </div>
  `;

  const visibleSprays = state.sprays
    .filter(sp => {
      const saldo = getSprayPendingBalance(sp);
      if (filterVal === "OPEN") return saldo > 0;
      if (filterVal === "PAID") return saldo === 0;
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
    const amt = roundMoney(sp.amount);
    const paid = getSprayPaidAmount(sp);
    const saldo = getSprayPendingBalance(sp);

    let payBadge = `<span class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-brand-accent font-bold text-xs">Pagado</span>`;
    if (sp.payStatus === "Parcial") {
      payBadge = `<span class="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-bold text-xs">Parcial (${formatMoney(paid)})</span>`;
    } else if (sp.payStatus === "Pendiente") {
      payBadge = `<span class="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 font-bold text-xs">Pendiente</span>`;
    }

    const waBtn = saldo > 0
      ? renderWhatsAppButtonHtml(prod, "payment", {
          nombre: prod ? prod.name : "",
          finca: farm ? farm.name : "",
          fecha: formatDisplayDate(sp.date, true),
          saldo: formatMoney(saldo),
          monto: formatMoney(amt)
        }, "Cobrar WA")
      : renderWhatsAppButtonHtml(prod, "reminder", {
          nombre: prod ? prod.name : "",
          finca: farm ? farm.name : "",
          fecha: farm && calculateFarmSchedule(farm).effectiveDateStr
            ? formatDisplayDate(calculateFarmSchedule(farm).effectiveDateStr)
            : "próxima fecha"
        }, "WhatsApp");

    return `
      <tr class="hover:bg-slate-900/55 transition-colors">
        <td class="py-3 px-3 font-medium text-white whitespace-nowrap">
          <div>${escapeHtml(sp.date)}</div>
          <div class="text-[10px] font-mono text-brand-blue">${escapeHtml(sp.orderNumber || "")}</div>
        </td>
        <td class="py-3 px-3 font-bold text-white">${escapeHtml(prod ? prod.name : "N/A")}</td>
        <td class="py-3 px-3 text-slate-300">
          <div>${escapeHtml(farm ? farm.name : "N/A")}</div>
          ${sp.status !== "Realizada" ? `<span class="text-[10px] text-amber-300 font-semibold">${escapeHtml(sp.status)}</span>` : ""}
        </td>
        <td class="py-3 px-3">
          <div class="font-bold text-white">${formatMoney(amt)}</div>
          ${saldo > 0 ? `<div class="text-[11px] text-amber-400 font-semibold">Saldo: ${formatMoney(saldo)}</div>` : `<div class="text-[11px] text-emerald-400">Liquidado</div>`}
        </td>
        <td class="py-3 px-3 text-xs text-slate-300">
          <div class="text-brand-blue font-semibold">${escapeHtml(sp.payMethod)}</div>
          <div>Ref: <strong>${escapeHtml(sp.payRef || "S/R")}</strong>${sp.payBank ? " • " + escapeHtml(sp.payBank) : ""}</div>
        </td>
        <td class="py-3 px-3">${payBadge}</td>
        <td class="py-3 px-3 text-right whitespace-nowrap space-x-1">
          ${saldo > 0 ? `<button type="button" onclick="openPaymentModal('${sp.id}')" class="px-2.5 py-1.5 bg-brand-blue/20 text-brand-blue border border-brand-blue/40 font-bold rounded-lg text-xs hover:bg-brand-blue/35">Abonar</button>` : ""}
          ${saldo > 0 ? `<button type="button" onclick="requestMarkSprayAsPaid('${sp.id}')" class="px-2.5 py-1.5 bg-brand-accent text-black font-bold rounded-lg text-xs hover:bg-emerald-300">Pagado</button>` : ""}
          ${waBtn}
        </td>
      </tr>
    `;
  }).join("");

  safeRefreshIcons();
}

function openPaymentModal(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  const farm = getFarmById(sp.farmId);
  const prod = farm ? getProducerByFarmId(farm.id) : null;
  const total = roundMoney(sp.amount);
  const paid = getSprayPaidAmount(sp);
  const balance = getSprayPendingBalance(sp);

  document.getElementById("paymentForm").reset();
  document.getElementById("paymentSprayId").value = sp.id;
  document.getElementById("paymentModalSubtitle").textContent =
    `${prod ? prod.name : "Productor"} • ${farm ? farm.name : ""} (${sp.orderNumber || sp.date})`;
  document.getElementById("paymentInfoTotal").textContent = formatMoney(total);
  document.getElementById("paymentInfoPaid").textContent = formatMoney(paid);
  document.getElementById("paymentInfoBalance").textContent = formatMoney(balance);

  const addInput = document.getElementById("paymentAddAmount");
  addInput.value = balance.toFixed(2);
  addInput.max = balance.toFixed(2);

  document.getElementById("paymentMethod").value = sp.payMethod || "Transferencia";
  document.getElementById("paymentRef").value = sp.payRef || "";
  document.getElementById("paymentBank").value = sp.payBank || "";

  document.getElementById("paymentModal").classList.remove("hidden");
  safeRefreshIcons();
}

function saveQuickPaymentForm(e) {
  e.preventDefault();
  const sprayId = document.getElementById("paymentSprayId").value;
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;

  const balance = getSprayPendingBalance(sp);
  const addAmount = roundMoney(parseFloat(document.getElementById("paymentAddAmount").value));

  if (!Number.isFinite(addAmount) || addAmount <= 0) {
    showToast("Ingresa un monto de abono mayor a $0.00.", "error");
    return;
  }
  if (addAmount > balance) {
    showToast(`El abono (${formatMoney(addAmount)}) no puede superar el saldo pendiente (${formatMoney(balance)}).`, "error");
    return;
  }

  const newPaid = roundMoney(getSprayPaidAmount(sp) + addAmount);
  sp.amountPaid = Math.min(roundMoney(sp.amount), newPaid);
  sp.payStatus = sp.amountPaid >= roundMoney(sp.amount) ? "Pagado" : "Parcial";
  sp.payMethod = document.getElementById("paymentMethod").value;
  const ref = document.getElementById("paymentRef").value.trim();
  const bank = document.getElementById("paymentBank").value.trim();
  if (ref) sp.payRef = ref;
  sp.payBank = sp.payMethod === "Efectivo" ? "" : bank;

  saveState(true);
  closeModal("paymentModal");
  refreshAllViews();
  showToast(
    sp.payStatus === "Pagado"
      ? `Saldo liquidado (${formatMoney(addAmount)}). Cuenta marcada como Pagada.`
      : `Abono de ${formatMoney(addAmount)} registrado. Nuevo saldo: ${formatMoney(getSprayPendingBalance(sp))}.`,
    "success"
  );
}

function requestMarkSprayAsPaid(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  const saldo = getSprayPendingBalance(sp);
  openConfirmModal(
    "Confirmar pago completo",
    `¿Confirmas liquidar el saldo pendiente de ${formatMoney(saldo)} de la orden ${sp.orderNumber || sp.date}?`,
    () => {
      sp.payStatus = "Pagado";
      sp.amountPaid = roundMoney(sp.amount);
      saveState(true);
      refreshAllViews();
      showToast("Pago marcado como completado.", "success");
    },
    "Sí, marcar pagado",
    false
  );
}

function exportBillingCSV() {
  const header = [
    "Fecha", "Orden", "EstadoFumigacion", "Productor", "CedulaRUC", "Finca",
    "Hectareas", "Producto", "Piloto", "Dron", "MontoTotal", "Abonado",
    "Saldo", "MetodoPago", "Referencia", "Banco", "EstadoPago"
  ].map(csvCell).join(",");

  const lines = [header];
  state.sprays.forEach(sp => {
    const farm = getFarmById(sp.farmId);
    const prod = farm ? getProducerByFarmId(farm.id) : null;
    const paid = getSprayPaidAmount(sp);
    const saldo = getSprayPendingBalance(sp);

    lines.push([
      sp.date,
      sp.orderNumber || "",
      sp.status || "Realizada",
      prod ? prod.name : "",
      prod ? prod.doc : "",
      farm ? farm.name : "",
      formatHectares(sp.hectares),
      sp.product || "",
      sp.pilot || "",
      sp.drone || "",
      roundMoney(sp.amount).toFixed(2),
      paid.toFixed(2),
      saldo.toFixed(2),
      sp.payMethod || "",
      sp.payRef || "",
      sp.payBank || "",
      sp.payStatus || ""
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
// 16. CRUD DE PRODUCTORES Y FINCAS (CON DUPLICADO POR CÉDULA Y BORRADO)
// ==========================================================================
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
  document.getElementById("farmFieldsGroup").classList.remove("hidden");
  document.getElementById("editingFarmId").value = "";
  const lastSprayInput = document.getElementById("farmLastSprayDate");

  if (prodId) {
    const prod = state.producers.find(p => p.id === prodId);
    if (!prod) return;
    document.getElementById("producerFormId").value = prod.id;
    document.getElementById("producerName").value = prod.name;
    document.getElementById("producerDoc").value = prod.doc;
    document.getElementById("producerPhone").value = prod.phone || "";

    if (prod.farms && prod.farms.length > 0) {
      const f = prod.farms[0];
      document.getElementById("producerModalTitle").textContent = "Editar Productor y Finca Principal";
      document.getElementById("farmSectionTitle").textContent = "Datos de la Finca Principal";
      document.getElementById("editingFarmId").value = f.id;
      document.getElementById("farmName").value = f.name;
      document.getElementById("farmCrop").value = f.crop;
      document.getElementById("farmHectares").value = formatHectares(f.hectares);
      document.getElementById("farmSector").value = f.sector;
      lastSprayInput.value = f.lastSprayDate || "";
      lastSprayInput.dataset.initialValue = f.lastSprayDate || "";
    } else {
      document.getElementById("producerModalTitle").textContent = "Editar Productor";
      document.getElementById("editingFarmId").value = "NO_FARM";
      document.getElementById("farmFieldsGroup").classList.add("hidden");
      lastSprayInput.dataset.initialValue = "";
    }
  } else {
    document.getElementById("producerModalTitle").textContent = "Registrar Nuevo Productor";
    document.getElementById("farmSectionTitle").textContent = "Datos de la Finca Inicial";
    document.getElementById("producerFormId").value = "";
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
  document.getElementById("farmHectares").value = formatHectares(farm.hectares);
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

    // Evitar productores duplicados por cédula / RUC
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

    if (isEditingFarmFields) {
      if (editingFarmId === "NEW_FARM") {
        prod.farms.push({
          id: `farm-${Date.now()}`,
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
        const targetFarm = prod.farms.find(f => f.id === editingFarmId) || prod.farms[0];
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
      id: `prod-${Date.now()}`,
      name,
      doc: normalizedDoc,
      phone: normalizedPhone,
      farms: [{
        id: `farm-${Date.now() + 1}`,
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
    showToast("Productor y finca guardados correctamente.", "success");
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
// 17. CRUD DE FUMIGACIONES INDIVIDUALES (CON VALIDACIÓN Y BORRADO)
// ==========================================================================
function populatePilotAndDroneSelects(selectedPilot = "", selectedDrone = "") {
  const pilotSel = document.getElementById("sprayPilot");
  const droneSel = document.getElementById("sprayDrone");
  const pilots = [...(state.config.pilots || ["Juan Diego Cobos Anguisaca"])];
  const drones = [...(state.config.drones || ["Alfa_3"])];
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
  row.className = "spray-product-row grid grid-cols-1 sm:grid-cols-6 gap-2 p-2 rounded-xl bg-slate-900/90 border border-brand-border items-center";
  row.innerHTML = `
    <input type="text" class="prod-name sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Nombre comercial *" value="${escapeHtml(prodItem.commercialName || "")}" required>
    <input type="text" class="prod-active px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Ing. activo (opc.)" value="${escapeHtml(prodItem.activeIngredient || "")}">
    <input type="text" class="prod-dose px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Dosis/ha" value="${escapeHtml(prodItem.dosePerHa || "")}">
    <input type="text" class="prod-vol px-2.5 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Vol. total" value="${escapeHtml(prodItem.totalVolume || "")}">
    <div class="flex items-center space-x-1">
      <input type="text" class="prod-lot w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-brand-border text-white text-xs" placeholder="Lote" value="${escapeHtml(prodItem.batchLot || "")}">
      <button type="button" onclick="removeProductRow(this)" class="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg shrink-0" title="Quitar producto">
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
    btn.closest(".spray-product-row").remove();
  } else {
    showToast("Debe existir al menos un producto en la fumigación.", "warning");
  }
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
    return `<option value="${f.id}">${escapeHtml(f.name)} (${escapeHtml(p ? p.name : "")} - ${escapeHtml(f.crop)})</option>`;
  }).join("");

  const productsContainer = document.getElementById("sprayProductsContainer");
  productsContainer.innerHTML = "";

  if (sprayId) {
    const sp = state.sprays.find(s => s.id === sprayId);
    if (!sp) return;
    document.getElementById("sprayModalTitle").textContent = "Editar Fumigación";
    document.getElementById("sprayEditId").value = sp.id;
    select.value = sp.farmId;
    document.getElementById("sprayOrderNumber").value = sp.orderNumber || "";
    document.getElementById("sprayStatus").value = sp.status || "Realizada";
    document.getElementById("sprayDate").value = sp.date;
    document.getElementById("sprayHectares").value = formatHectares(sp.hectares);
    populatePilotAndDroneSelects(sp.pilot, sp.drone);

    const prods = Array.isArray(sp.products) && sp.products.length > 0
      ? sp.products
      : [{ commercialName: sp.product || "", activeIngredient: "", dosePerHa: "", totalVolume: "", batchLot: "" }];
    prods.forEach(pr => addProductRowToSprayForm(pr));

    document.getElementById("sprayNotes").value = sp.notes || "";
    document.getElementById("sprayAmount").value = roundMoney(sp.amount).toFixed(2);
    document.getElementById("sprayPilotPay").value = roundMoney(sp.pilotPay).toFixed(2);
    document.getElementById("sprayPilotPaid").value = sp.pilotPaid ? "true" : "false";
    document.getElementById("sprayPayMethod").value = sp.payMethod;
    document.getElementById("sprayPayRef").value = sp.payRef || "";
    document.getElementById("sprayPayBank").value = sp.payBank || "";
    document.getElementById("sprayPayStatus").value = sp.payStatus;
    document.getElementById("sprayAmountPaid").value = roundMoney(sp.amountPaid || 0).toFixed(2);
  } else {
    document.getElementById("sprayForm").reset();
    document.getElementById("sprayModalTitle").textContent = "Registrar Nueva Fumigación";
    document.getElementById("sprayEditId").value = "";
    document.getElementById("sprayStatus").value = "Realizada";
    const todayStr = getGuayaquilTodayStr();
    document.getElementById("sprayDate").value = todayStr;
    document.getElementById("sprayOrderNumber").value = generateNextOrderNumber(todayStr);
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
  if (editId) return; // No sobreescribir valores al editar
  const farmId = document.getElementById("sprayFarmSelect").value;
  const farm = getFarmById(farmId);
  if (farm) {
    const ha = roundHectares(farm.hectares);
    const clientRate = Number.isFinite(state.config.clientRatePerHa) ? state.config.clientRatePerHa : 15;
    const pilotRate = Number.isFinite(state.config.pilotRatePerHa) ? state.config.pilotRatePerHa : 4.5;
    document.getElementById("sprayHectares").value = formatHectares(ha);
    document.getElementById("sprayAmount").value = roundMoney(ha * clientRate).toFixed(2);
    document.getElementById("sprayPilotPay").value = roundMoney(ha * pilotRate).toFixed(2);
  }
}

function onSprayHectaresChanged() {
  const ha = roundHectares(Math.max(0, parseFloat(document.getElementById("sprayHectares").value) || 0));
  const pilotRate = Number.isFinite(state.config.pilotRatePerHa) ? state.config.pilotRatePerHa : 4.5;
  document.getElementById("sprayPilotPay").value = roundMoney(ha * pilotRate).toFixed(2);
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
  const drone = document.getElementById("sprayDrone").value;
  const pilot = document.getElementById("sprayPilot").value;
  const notes = document.getElementById("sprayNotes").value.trim();
  const amount = parseFloat(document.getElementById("sprayAmount").value);
  const pilotPayRaw = parseFloat(document.getElementById("sprayPilotPay").value);
  const pilotPaid = document.getElementById("sprayPilotPaid").value === "true";
  const payMethod = document.getElementById("sprayPayMethod").value;
  const payRef = document.getElementById("sprayPayRef").value.trim();
  const payBank = payMethod === "Efectivo" ? "" : document.getElementById("sprayPayBank").value.trim();
  let payStatus = document.getElementById("sprayPayStatus").value;

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
  if (!Number.isFinite(amount) || amount < 0) {
    showToast("El monto total del cliente debe ser mayor o igual a $0.00.", "error");
    return;
  }
  const pilotPay = Number.isFinite(pilotPayRaw) && pilotPayRaw >= 0 ? roundMoney(pilotPayRaw) : 0;

  let amountPaid = 0;
  if (payStatus === "Pagado") {
    amountPaid = roundMoney(amount);
  } else if (payStatus === "Parcial") {
    const rawPaid = parseFloat(document.getElementById("sprayAmountPaid").value);
    if (!Number.isFinite(rawPaid) || rawPaid <= 0) {
      showToast("En pago parcial, el abono debe ser mayor a $0.00.", "error");
      return;
    }
    if (rawPaid > amount) {
      showToast(`El monto abonado (${formatMoney(rawPaid)}) no puede superar el total (${formatMoney(amount)}).`, "error");
      return;
    }
    if (roundMoney(rawPaid) === roundMoney(amount)) {
      payStatus = "Pagado";
      amountPaid = roundMoney(amount);
    } else {
      amountPaid = roundMoney(rawPaid);
    }
  }

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

  const product = products.map(p => p.commercialName).join(", ");
  let previousFarmId = null;

  if (editId) {
    const sp = state.sprays.find(s => s.id === editId);
    if (sp) {
      previousFarmId = sp.farmId;
      Object.assign(sp, {
        orderNumber,
        status,
        farmId,
        date,
        hectares: roundHectares(hectares),
        product,
        products,
        drone,
        pilot,
        pilotPay,
        pilotPaid,
        notes,
        amount: roundMoney(amount),
        amountPaid,
        payMethod,
        payRef,
        payBank,
        payStatus
      });
    }
  } else {
    state.sprays.unshift({
      id: `sp-${Date.now()}`,
      orderNumber,
      status,
      rescheduleDescription: "",
      farmId,
      date,
      hectares: roundHectares(hectares),
      product,
      products,
      drone,
      pilot,
      pilotPay,
      pilotPaid,
      notes,
      amount: roundMoney(amount),
      amountPaid,
      payMethod,
      payRef,
      payBank,
      payStatus
    });
  }

  // Recalcular última fumigación de la finca actual (y la anterior si cambió de finca)
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
// 18. REPROGRAMACIONES CON DESCRIPCIÓN Y LIMPIEZA
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

  if (sprayId) {
    const sp = state.sprays.find(s => s.id === sprayId);
    if (sp) {
      const wasRealizada = sp.status === "Realizada";
      sp.status = "Reprogramada";
      sp.date = newDate;
      sp.rescheduleDescription = description;
      if (wasRealizada) {
        syncFarmLastSprayFromHistory(farm.id);
      }
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
// 19. GENERACIÓN DE PDFs IMPRIMIBLES EN BLANCO
// ==========================================================================
function printCurrentPdf() {
  window.print();
}

function getAssociationHeaderPdfHtml(docTitle, rightMetaHtml) {
  const cfg = state.config;
  const logoHtml = cfg.assocLogoDataUrl
    ? `<img src="${cfg.assocLogoDataUrl}" alt="Logo" class="pdf-logo-img">`
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

function openSprayPdfModal(sprayId) {
  const sp = state.sprays.find(s => s.id === sprayId);
  if (!sp) return;
  const farm = getFarmById(sp.farmId);
  const prod = farm ? getProducerByFarmId(farm.id) : null;

  // Calcular próxima fecha tentativa a partir de la fecha de ESTA fumigación
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

  const total = roundMoney(sp.amount);
  const paid = getSprayPaidAmount(sp);
  const saldo = getSprayPendingBalance(sp);

  const statusPillClass = sp.status === "Realizada" ? "is-ok" : (sp.status === "Reprogramada" ? "is-warn" : "");
  const payPillClass = sp.payStatus === "Pagado" ? "is-ok" : (sp.payStatus === "Parcial" ? "is-warn" : "is-danger");

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
        <div>Superficie aplicada: <strong>${formatHectares(sp.hectares)} hectáreas</strong></div>
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

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pdf-avoid-break">
      <div class="pdf-section-box space-y-1">
        <div class="pdf-section-title">Próxima Programación y Método de Pago</div>
        <div>Próxima fecha tentativa: <strong>${orderNextRule.nextDateStr ? `${formatDisplayDate(orderNextRule.nextDateStr, true)} (${orderNextRule.nextDateStr})` : "Por definir"}</strong></div>
        <div class="text-[11px] text-slate-600">Regla aplicada: +${orderNextRule.daysToAdd} días (Temporada ${orderNextRule.isRainy ? "Lluviosa" : "Seca"})</div>
        <div>Método de pago: <strong>${escapeHtml(sp.payMethod)}</strong>${sp.payRef ? ` • Ref: ${escapeHtml(sp.payRef)}` : ""}${sp.payBank ? ` • ${escapeHtml(sp.payBank)}` : ""}</div>
      </div>

      <div class="pdf-section-box space-y-1">
        <div class="pdf-section-title">Resumen Económico</div>
        <div class="flex justify-between"><span>Monto total del servicio:</span><strong>${formatMoney(total)}</strong></div>
        <div class="flex justify-between"><span>Monto abonado:</span><strong>${formatMoney(paid)}</strong></div>
        <div class="flex justify-between"><span>Estado de pago:</span><span class="pdf-status-pill ${payPillClass}">${escapeHtml(sp.payStatus)}</span></div>
        <div class="flex justify-between pt-1 border-t border-slate-300 font-extrabold text-sm">
          <span>Saldo pendiente:</span><span>${formatMoney(saldo)}</span>
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

  let totalBilled = 0;
  let totalPaid = 0;
  let totalHa = 0;

  const prodSprays = state.sprays
    .filter(sp => farmIds.has(sp.farmId))
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const rowsHtml = prodSprays.map(sp => {
    const farm = getFarmById(sp.farmId);
    const amt = roundMoney(sp.amount);
    const paid = getSprayPaidAmount(sp);
    const saldo = getSprayPendingBalance(sp);
    totalBilled = roundMoney(totalBilled + amt);
    totalPaid = roundMoney(totalPaid + paid);
    if (sp.status === "Realizada") {
      totalHa = roundHectares(totalHa + (Number(sp.hectares) || 0));
    }

    const payPillClass = sp.payStatus === "Pagado" ? "is-ok" : (sp.payStatus === "Parcial" ? "is-warn" : "is-danger");

    return `
      <tr>
        <td class="whitespace-nowrap">
          <div class="font-semibold">${escapeHtml(sp.date)}</div>
          <div class="text-[10px] font-mono text-slate-500">${escapeHtml(sp.orderNumber || "")}</div>
        </td>
        <td class="font-medium">${escapeHtml(farm ? farm.name : "N/A")}</td>
        <td>${escapeHtml(sp.product)} <span class="text-slate-500">(${formatHectares(sp.hectares)} ha • ${escapeHtml(sp.status)})</span></td>
        <td class="text-right font-semibold">${formatMoney(amt)}</td>
        <td class="text-right">${formatMoney(paid)}</td>
        <td class="text-right font-bold">${formatMoney(saldo)}</td>
        <td>
          <div>${escapeHtml(sp.payMethod)}${sp.payRef ? ` (${escapeHtml(sp.payRef)})` : ""}</div>
          <span class="pdf-status-pill ${payPillClass}">${escapeHtml(sp.payStatus)}</span>
        </td>
      </tr>
    `;
  }).join("");

  const pending = roundMoney(Math.max(0, totalBilled - totalPaid));

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
        <div>Fincas registradas: <strong>${(prod.farms || []).length}</strong> • Hectáreas fumigadas: <strong>${formatHectares(totalHa)} ha</strong></div>
      </div>
    </div>

    <div class="space-y-2">
      <div class="pdf-section-title">Detalle Cronológico de Servicios</div>
      <table class="pdf-table">
        <thead>
          <tr>
            <th>Fecha / Orden</th>
            <th>Finca</th>
            <th>Detalle Servicio</th>
            <th class="text-right">Monto</th>
            <th class="text-right">Abonado</th>
            <th class="text-right">Saldo</th>
            <th>Pago / Estado</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="7" class="text-center text-slate-500 py-4">Sin fumigaciones registradas para este productor.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="flex justify-end pt-2 pdf-avoid-break">
      <div class="pdf-section-box w-full sm:w-72 space-y-1.5 text-xs">
        <div class="flex justify-between"><span>Total Facturado:</span><strong>${formatMoney(totalBilled)}</strong></div>
        <div class="flex justify-between text-emerald-800"><span>Total Pagado / Abonado:</span><strong>${formatMoney(totalPaid)}</strong></div>
        <div class="flex justify-between text-sm font-black pt-1.5 border-t border-slate-300 ${pending > 0 ? "text-rose-800" : "text-emerald-800"}">
          <span>Saldo Pendiente:</span><span>${formatMoney(pending)}</span>
        </div>
      </div>
    </div>

    <div class="pt-3 border-t border-slate-200 text-[10px] text-slate-500 flex justify-between">
      <span>${escapeHtml(state.config.assocName || "AgroDrone")} • Control de Secretaría</span>
      <span>Emisión: ${getGuayaquilTodayStr()}</span>
    </div>
  `;

  modal.classList.remove("hidden");
  safeRefreshIcons();
}

// ==========================================================================
// 20. CONFIGURACIÓN, LOGO COMPRIMIDO Y RESPALDO / RESTAURACIÓN JSON
// ==========================================================================
function populateSettingsForm() {
  const cfg = state.config;
  document.getElementById("settingAssocName").value = cfg.assocName || "AgroDrone";
  document.getElementById("settingAssocPhone").value = cfg.assocPhone || "";
  document.getElementById("settingAssocRuc").value = cfg.assocRuc || "";
  document.getElementById("settingClientRatePerHa").value = cfg.clientRatePerHa !== undefined ? cfg.clientRatePerHa : 15.0;
  document.getElementById("settingPilotRatePerHa").value = cfg.pilotRatePerHa !== undefined ? cfg.pilotRatePerHa : 4.5;
  document.getElementById("settingPilotsList").value = (cfg.pilots || []).join(", ");
  document.getElementById("settingDronesList").value = (cfg.drones || []).join(", ");
  document.getElementById("settingWaTemplateReminder").value = cfg.waTemplateReminder || DEFAULT_WA_REMINDER_TEMPLATE;
  document.getElementById("settingWaTemplateReschedule").value = cfg.waTemplateReschedule || DEFAULT_WA_RESCHEDULE_TEMPLATE;
  document.getElementById("settingWaTemplatePayment").value = cfg.waTemplatePayment || DEFAULT_WA_PAYMENT_TEMPLATE;

  const logoImg = document.getElementById("settingLogoPreview");
  if (cfg.assocLogoDataUrl) {
    logoImg.src = cfg.assocLogoDataUrl;
    logoImg.classList.remove("hidden");
  } else {
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

  // Comprimir logo en canvas para mantener ligero localStorage y el respaldo JSON
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

      state.config.assocLogoDataUrl = dataUrl;
      const logoImg = document.getElementById("settingLogoPreview");
      logoImg.src = dataUrl;
      logoImg.classList.remove("hidden");
      saveState(true);
      showToast("Logo optimizado y cargado para los PDFs.", "success");
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
  showToast("Configuración guardada y todas las frecuencias recalculadas.", "success");
}

function buildExportPayload() {
  return {
    ...state,
    meta: {
      ...state.meta,
      exportedAt: new Date().toISOString(),
      appVersion: "4.1"
    }
  };
}

function exportSystemJSON() {
  const nowIso = new Date().toISOString();
  state.meta.lastBackupAt = nowIso;
  state.meta.hasUnexportedChanges = false;
  backupBannerDismissed = false;
  persistStateToStorage(false);

  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `AgroDrone_Backup_${getGuayaquilTodayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  updateBackupIndicators();
  showToast("Respaldo JSON descargado correctamente.", "success");
}

function validateBackupStructure(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { valid: false, reason: "El archivo no contiene un objeto JSON válido." };
  }
  if (!parsed.config || typeof parsed.config !== "object") {
    return { valid: false, reason: "Falta la sección de configuración (config)." };
  }
  if (!Array.isArray(parsed.producers)) {
    return { valid: false, reason: "Falta la lista de productores (producers)." };
  }
  if (!Array.isArray(parsed.sprays)) {
    return { valid: false, reason: "Falta la lista de fumigaciones (sprays)." };
  }

  // Verificar duplicados de cédula dentro del JSON importado
  const seenDocs = new Set();
  for (const p of parsed.producers) {
    if (!p || typeof p !== "object" || !p.name) {
      return { valid: false, reason: "Uno de los productores en el respaldo está corrupto o sin nombre." };
    }
    const d = normalizeDoc(p.doc || "");
    if (d) {
      if (seenDocs.has(d)) {
        return { valid: false, reason: `El respaldo contiene productores duplicados con la cédula/RUC ${d}.` };
      }
      seenDocs.add(d);
    }
  }

  const farmsCount = parsed.producers.reduce((acc, p) => acc + (Array.isArray(p.farms) ? p.farms.length : 0), 0);
  return {
    valid: true,
    summary: `${parsed.producers.length} productor(es), ${farmsCount} finca(s) y ${parsed.sprays.length} fumigación(es)`
  };
}

function importSystemJSON(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const parsed = JSON.parse(e.target.result);
      const validation = validateBackupStructure(parsed);
      if (!validation.valid) {
        showToast(`Respaldo inválido: ${validation.reason}`, "error");
        return;
      }

      openConfirmModal(
        "Restaurar respaldo JSON",
        `El archivo contiene ${validation.summary}. Al restaurar se reemplazarán los datos actuales (se guardará un auto-respaldo previo por seguridad). ¿Deseas continuar?`,
        () => {
          writeAutoBackupSnapshot(true);
          state = parsed;
          ensureStateIntegrity();
          state.meta.lastBackupAt = new Date().toISOString();
          state.meta.hasUnexportedChanges = false;
          persistStateToStorage(false, true);
          refreshAllViews();
          showToast("Respaldo JSON restaurado con éxito.", "success");
        },
        "Sí, restaurar respaldo",
        false
      );
    } catch (err) {
      showToast("Error al leer el archivo JSON. Verifica que no esté dañado.", "error");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function requestRestoreAutoBackup() {
  const raw = localStorage.getItem(AUTO_BACKUP_KEY);
  if (!raw) {
    showToast("Todavía no existe un auto-respaldo local guardado en este navegador.", "warning");
    return;
  }
  try {
    const snapshot = JSON.parse(raw);
    if (!snapshot || !snapshot.data) {
      showToast("El auto-respaldo local no es válido.", "error");
      return;
    }
    const check = validateBackupStructure(snapshot.data);
    if (!check.valid) {
      showToast("El auto-respaldo local está incompleto.", "error");
      return;
    }
    openConfirmModal(
      "Restaurar último auto-respaldo",
      `Se restaurará la copia automática guardada el ${formatIsoDateTimeLocal(snapshot.savedAt)} (${check.summary}). ¿Deseas continuar?`,
      () => {
        state = snapshot.data;
        ensureStateIntegrity();
        persistStateToStorage(false, true);
        refreshAllViews();
        showToast("Auto-respaldo restaurado correctamente.", "success");
      },
      "Restaurar auto-respaldo",
      false
    );
  } catch (err) {
    showToast("No se pudo leer el auto-respaldo local.", "error");
  }
}

function requestStartWithEmptyData() {
  openConfirmModal(
    "Empezar con datos vacíos",
    "Se eliminarán los productores, fincas, fumigaciones y memorias de prueba actuales para dejar la aplicación limpia para uso real. Tu Configuración (asociación, tarifas, pilotos, drones, temporadas y WhatsApp) se conservará intacta y se guardará un auto-respaldo previo. ¿Deseas continuar?",
    () => {
      writeAutoBackupSnapshot(true);
      state.producers = [];
      state.sprays = [];
      state.dji = {
        plotMemory: {},
        locationMemory: {},
        importedFlightKeys: []
      };
      djiImportSession = null;
      persistStateToStorage(false, true);
      refreshAllViews();
      showToast("Aplicación limpia lista para uso real. Tu Configuración fue conservada.", "success");
    },
    "Sí, empezar con datos vacíos",
    true
  );
}

function requestResetSampleData() {
  openConfirmModal(
    "Restablecer datos de ejemplo",
    "Se reemplazarán los datos actuales por los 6 productores y 8 fincas de ejemplo de El Oro. ¿Deseas continuar?",
    () => {
      writeAutoBackupSnapshot(true);
      state = getInitialData();
      djiImportSession = null;
      persistStateToStorage(false, true);
      refreshAllViews();
      showToast("Datos de ejemplo restablecidos.", "info");
    },
    "Sí, restablecer",
    true
  );
}

// ==========================================================================
// 21. BÚSQUEDAS AUXILIARES E INICIALIZACIÓN + AUTO-RESPALDO AL CERRAR
// ==========================================================================
function getAllFarms() {
  const list = [];
  (state.producers || []).forEach(p => {
    if (p && Array.isArray(p.farms)) list.push(...p.farms);
  });
  return list;
}

function getFarmById(farmId) {
  return getAllFarms().find(f => f.id === farmId) || null;
}

function getProducerByFarmId(farmId) {
  return (state.producers || []).find(p => Array.isArray(p.farms) && p.farms.some(f => f.id === farmId)) || null;
}

function setupModalAccessibility() {
  const closableModalIds = [
    "producerModal",
    "sprayModal",
    "paymentModal",
    "rescheduleModal",
    "printableSprayPdfModal",
    "printableStatementModal"
  ];

  // Cerrar al hacer clic fuera del cuadro modal
  closableModalIds.forEach(id => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.addEventListener("click", ev => {
      if (ev.target === modal) closeModal(id);
    });
  });

  // Cerrar con tecla Escape
  document.addEventListener("keydown", ev => {
    if (ev.key !== "Escape") return;
    const confirmModal = document.getElementById("confirmModal");
    if (confirmModal && !confirmModal.classList.contains("hidden")) {
      closeConfirmModal();
      return;
    }
    for (const id of closableModalIds) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden")) {
        closeModal(id);
        return;
      }
    }
  });
}

function setupAutoBackupOnClose() {
  // Guardar auto-respaldo silencioso al ocultar pestaña o salir
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state && state.config.autoBackupOnClose) {
      writeAutoBackupSnapshot(true);
    }
  });

  window.addEventListener("pagehide", () => {
    if (state && state.config.autoBackupOnClose) {
      writeAutoBackupSnapshot(true);
    }
  });

  window.addEventListener("beforeunload", event => {
    if (!state || !state.config.autoBackupOnClose) return;
    writeAutoBackupSnapshot(true);
    // Si hay cambios sin exportar a archivo JSON, avisar antes de cerrar
    if (state.meta && state.meta.hasUnexportedChanges) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

// ==========================================================================
// 22. IMPORTAR VUELOS DJI SMARTFARM (EXCEL "flight record" CON SHEETJS)
// ==========================================================================
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

/**
 * Parsea la columna "Flight time" de DJI SmartFarm.
 * Soporta número serial de Excel (SheetJS SSF), Date, YYYY-MM-DD HH:mm:ss,
 * YYYY-MM-DD HH:mm:ss-HH:mm:ss (inicio y fin), YYYY/MM/DD y DD/MM/YYYY.
 */
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
      // Fallback estándar serial Excel (base 1899-12-30 UTC)
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
    // YYYY-MM-DD o YYYY/MM/DD con hora inicio y opcional -hora fin
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
      // DD/MM/YYYY o DD-MM-YYYY con hora inicio y opcional -hora fin
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

/**
 * Procesa un Workbook de SheetJS exportado de DJI SmartFarm (hoja "flight record").
 * Lee columnas por nombre en la primera fila, omite duplicados por Flight time + Serial Number,
 * agrupa por fecha + Location (o por fecha + Plot ID si falta Location), suma todos los vuelos,
 * y lee piloto, dron y Total Amount(L/Kg) opcionales.
 */
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

  // Leer encabezados estrictamente por nombre en la primera fila
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
    // Agrupar por fecha + Location (texto normalizado) sumando TODOS los vuelos (con y sin Plot ID)
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
    // Fallback: falta columna Location -> agrupar por fecha + Plot ID (sin unión por hora ni "Revisar")
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
    return `<option value="${f.id}">${escapeHtml(p ? p.name : "Productor")} — ${escapeHtml(f.name)} (${escapeHtml(f.crop)})</option>`;
  }).join("");

  // Detectar grupos parcialmente registrados para saber si se permite "Volver a unir"
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

    // Mostrar Plot IDs contenidos
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

    // Botón "Separar por lote" o "Volver a unir"
    let splitActionHtml = "";
    if (row.canSplit && !row.isSplitChild) {
      splitActionHtml = `
        <button type="button" onclick="splitDjiGroupByPlot('${row.groupId}')" class="mt-1.5 inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-brand-blue/15 hover:bg-brand-blue/30 text-brand-blue border border-brand-blue/40 text-[11px] font-bold">
          <i data-lucide="split" class="w-3.5 h-3.5"></i>
          <span>Separar por lote (${row.plotIds.length} lotes)</span>
        </button>
      `;
    } else if (row.isSplitChild && !registeredGroupIds.has(row.groupId) && !seenSplitGroups.has(row.groupId)) {
      seenSplitGroups.add(row.groupId);
      splitActionHtml = `
        <button type="button" onclick="rejoinDjiGroup('${row.groupId}')" class="mt-1.5 inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold">
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
      <select onchange="onDjiRowFarmChanged('${row.rowId}', this.value)" class="w-full min-w-[220px] px-2.5 py-2 rounded-xl bg-slate-900 border ${isUnassigned ? "border-amber-500/50 text-amber-200" : "border-brand-accent/45 text-white"} text-xs font-semibold">
        <option value="">-- Sin asignar (elegir Productor / Finca) --</option>
        ${farmOptionsHtml}
      </select>
    `;

    return `
      <tr class="hover:bg-slate-900/55 transition-colors ${row.isSplitChild ? "bg-slate-900/35" : ""}" data-dji-row="${row.rowId}">
        <td class="py-3 px-3 text-center">
          <input type="checkbox" ${row.included ? "checked" : ""} ${isUnassigned ? "disabled" : ""} onchange="onDjiRowIncludedChanged('${row.rowId}', this.checked)" class="w-4 h-4 accent-emerald-400 cursor-pointer disabled:opacity-40">
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

  // Aplicar selección actual a cada <select>
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

  // Verificar si alguna finca ya tiene una fumigación "Realizada" ese mismo día
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

    pendingToSave.forEach((row, idx) => {
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
        id: `sp-dji-${Date.now()}-${idx}`,
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

      // Guardar en la memoria correspondiente (Plot ID si está separado por lote o sin Location; si no, Location)
      if (row.usePlotMemory) {
        if (row.plotId) {
          state.dji.plotMemory[row.plotId] = row.selectedFarmId;
        }
      } else if (row.locationKey && row.locationKey !== "__sin_ubicacion__") {
        state.dji.locationMemory[row.locationKey] = row.selectedFarmId;
      }

      // Registrar claves de vuelo importadas para evitar duplicados futuros
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

  // 1. Memoria de Ubicaciones (Location -> Finca)
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
              <button type="button" data-loc-key="${escapeHtml(locKey)}" onclick="requestDeleteLocationMemory(this.getAttribute('data-loc-key'))" class="p-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 shrink-0" title="Olvidar esta ubicación">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          `;
        }).join("");
    }
  }

  // 2. Memoria de Plot IDs (Plot ID -> Finca)
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
              <button type="button" data-plot-id="${escapeHtml(plotId)}" onclick="requestDeletePlotMemory(this.getAttribute('data-plot-id'))" class="p-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 shrink-0" title="Olvidar este Plot ID">
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

function initApp() {
  const mobileBtn = document.getElementById("mobileMenuBtn");
  const mobileCloseBtn = document.getElementById("mobileCloseSidebarBtn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  if (mobileBtn && sidebar && overlay) {
    mobileBtn.addEventListener("click", () => {
      sidebar.classList.toggle("-translate-x-full");
      overlay.classList.toggle("hidden");
    });
    overlay.addEventListener("click", closeMobileSidebar);
  }
  if (mobileCloseBtn) {
    mobileCloseBtn.addEventListener("click", closeMobileSidebar);
  }

  loadState();
  applyBackgroundAppearance();
  populateSectorFilter();
  updateSeasonBadges();
  updateBackupIndicators();
  setupModalAccessibility();
  setupAutoBackupOnClose();
  switchTab("dashboard");
  safeRefreshIcons();
}

document.addEventListener("DOMContentLoaded", initApp);
