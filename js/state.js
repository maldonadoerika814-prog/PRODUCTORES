/* ==========================================================================
   AgroDrone - Estado, Seguridad, Validaciones y Almacenamiento (js/state.js)
   Control de estado global, sanitización XSS/CSV, validadores Ecuador (+593 /
   módulo 10), motor de temporadas, cálculos financieros y respaldos JSON.
   ========================================================================== */

"use strict";

// ==========================================================================
// 1. CONSTANTES Y VARIABLES DE ESTADO COMPARTIDAS
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

// ==========================================================================
// 2. UTILIDADES DE SEGURIDAD, IDENTIFICADORES, NÚMEROS Y FECHAS
// ==========================================================================
function generateUid(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeEntityId(rawId, fallbackPrefix, index = 0) {
  const cleaned = String(rawId === null || rawId === undefined ? "" : rawId)
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, "");
  return cleaned || `${fallbackPrefix}-${index}-${Date.now()}`;
}

function isSafeImageDataUrl(val) {
  if (typeof val !== "string" || !val.trim()) return false;
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(val.trim());
}

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

/**
 * Escapa celdas CSV y previene inyección de fórmulas en Excel (=, +, -, @).
 */
function csvCell(val) {
  let cleaned = String(val === null || val === undefined ? "" : val)
    .replace(/\r?\n/g, " ")
    .trim();
  if (/^[=+\-@]/.test(cleaned) && !/^-\d+(\.\d+)?$/.test(cleaned)) {
    cleaned = `'${cleaned}`;
  }
  cleaned = cleaned.replace(/"/g, '""');
  return `"${cleaned}"`;
}

function safeRefreshIcons() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  } catch (err) {
    // Ignorar errores de iconos si no hay conexión a internet
  }
}

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
    // Fallback local abajo
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

function parseEcuadorWhatsApp(rawPhone) {
  const trimmed = String(rawPhone || "").trim();
  if (!trimmed) {
    return { valid: false, empty: true, international: "", display: "Sin número", reason: "" };
  }

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return { valid: false, empty: false, international: "", display: trimmed, reason: "Solo se permiten números." };
  }

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
      <span class="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-800/70 text-slate-400 border border-slate-700 text-[11px] font-semibold cursor-not-allowed ${escapeHtml(extraClass)}" title="Este productor no tiene un número de WhatsApp válido registrado">
        <i data-lucide="message-circle-off" class="w-3.5 h-3.5"></i>
        <span>Sin WhatsApp</span>
      </span>
    `;
  }
  const msg = buildWhatsAppMessage(templateType, vars);
  const waUrl = `https://wa.me/${phoneInfo.international}?text=${encodeURIComponent(msg)}`;
  return `
    <a href="${escapeHtml(waUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/25 text-brand-accent hover:bg-emerald-600/40 border border-brand-accent/40 text-[11px] font-bold transition-colors ${escapeHtml(extraClass)}" title="Abrir WhatsApp (${escapeHtml(phoneInfo.display)}) para revisar y enviar">
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
    toast.classList.add("toast-fade-out");
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
      version: "4.2",
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
    delete state.config.customBgDataUrl;

    // Validar que el logo en base64 sea estrictamente data:image/... seguro (prevención XSS)
    if (!isSafeImageDataUrl(state.config.assocLogoDataUrl)) {
      state.config.assocLogoDataUrl = "";
    } else {
      state.config.assocLogoDataUrl = state.config.assocLogoDataUrl.trim();
    }

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

  // Normalizar productores y fincas con IDs saneados
  state.producers = state.producers
    .filter(p => p && typeof p === "object")
    .map((p, idx) => {
      const phoneParsed = parseEcuadorWhatsApp(p.phone);
      const farms = Array.isArray(p.farms)
        ? p.farms
            .filter(f => f && typeof f === "object")
            .map((f, fIdx) => ({
              id: sanitizeEntityId(f.id, `farm-${idx}`, fIdx),
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
        id: sanitizeEntityId(p.id, "prod", idx),
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
        id: sanitizeEntityId(sp.id, "sp", idx),
        orderNumber: String(sp.orderNumber || `ORD-${getGuayaquilTodayStr().substring(0, 4)}-${String(idx + 1).padStart(3, "0")}`).trim(),
        farmId: sp.farmId ? sanitizeEntityId(sp.farmId, "farm-ref", idx) : "",
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

  // Migración de fecha manual
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
        const cleanFarm = sanitizeEntityId(farmId, "invalid", 0);
        if (cleanPlot && validFarmIds.has(cleanFarm)) {
          cleanedMemory[cleanPlot] = cleanFarm;
        }
      });
    }
    const cleanedLocationMemory = {};
    if (state.dji.locationMemory && typeof state.dji.locationMemory === "object") {
      Object.entries(state.dji.locationMemory).forEach(([locKey, farmId]) => {
        const cleanLoc = normalizeDjiLocationKey(locKey);
        const cleanFarm = sanitizeEntityId(farmId, "invalid", 0);
        if (cleanLoc && validFarmIds.has(cleanFarm)) {
          cleanedLocationMemory[cleanLoc] = cleanFarm;
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
// 8. CÁLCULOS FINANCIEROS Y BÚSQUEDAS AUXILIARES
// ==========================================================================
/**
 * Solo las fumigaciones efectivamente "Realizada" generan cartera exigible o cobro real.
 */
function isCollectibleSpray(sp) {
  return Boolean(sp && sp.status === "Realizada");
}

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

// ==========================================================================
// 9. RESPALDO, RESTAURACIÓN Y REINICIO DE DATOS (JSON)
// ==========================================================================
function buildExportPayload() {
  return {
    ...state,
    meta: {
      ...state.meta,
      exportedAt: new Date().toISOString(),
      appVersion: "4.2"
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
  if (parsed.config.assocLogoDataUrl && !isSafeImageDataUrl(parsed.config.assocLogoDataUrl)) {
    return { valid: false, reason: "El logo incluido en la configuración tiene un formato no permitido." };
  }
  if (!Array.isArray(parsed.producers)) {
    return { valid: false, reason: "Falta la lista de productores (producers)." };
  }
  if (!Array.isArray(parsed.sprays)) {
    return { valid: false, reason: "Falta la lista de fumigaciones (sprays)." };
  }

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
      showToast(`El auto-respaldo local no es válido: ${check.reason}`, "error");
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
