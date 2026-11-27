/* ==========================================================================
   AgroDrone - Motor Contable Exacto y Migración V4 -> V5 (js/finance.js)
   Aritmética decimal exacta con BigInt (sin errores IEEE-754 ni Number.EPSILON),
   libro auditable de abonos múltiples, separación Devengado vs Estimado y
   migración idempotente sin pérdida de información.
   ========================================================================== */

"use strict";

function roundDecimalExact(value, decimals = 2) {
  const num = roundDecimalExact._toFiniteOrNull(value);
  if (num === null || num === 0) {
    return 0;
  }
  const dec = Number.isInteger(decimals) && decimals >= 0 && decimals <= 12 ? decimals : 2;
  const scaled = roundDecimalExact._scaleBigInt(value, dec);
  return roundDecimalExact._formatBigInt(scaled, dec);
}

roundDecimalExact._cleanStr = function cleanStr(val) {
  if (val === undefined || val === null) {
    return "";
  }
  return String(val).trim();
};

roundDecimalExact._toFiniteOrNull = function toFiniteOrNull(val) {
  if (val === undefined || val === null || typeof val === "boolean") {
    return null;
  }
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

roundDecimalExact._scaleBigInt = function scaleBigInt(value, dec) {
  let str = "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
      return 0n;
    }
    str = trimmed;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 0) return 0n;
    str = value.toString();
  } else {
    return 0n;
  }

  let negative = false;
  if (str[0] === "-") {
    negative = true;
    str = str.slice(1);
  } else if (str[0] === "+") {
    str = str.slice(1);
  }

  const expSplit = str.toLowerCase().split("e");
  const exp = expSplit[1] ? parseInt(expSplit[1], 10) : 0;
  const mantissaSplit = expSplit[0].split(".");
  const intPart = mantissaSplit[0] || "0";
  const fracPart = mantissaSplit[1] || "";
  const digits = (intPart + fracPart).replace(/^0+/, "");
  if (!digits) {
    return 0n;
  }

  const shift = exp - fracPart.length + dec;
  let scaledMag;
  if (shift >= 0) {
    if (shift > 320) {
      throw new RangeError("Magnitud decimal fuera de rango seguro.");
    }
    scaledMag = BigInt(digits) * (10n ** BigInt(shift));
  } else {
    const drop = -shift;
    if (drop > digits.length) {
      return 0n;
    }
    const cutIdx = digits.length - drop;
    const whole = cutIdx > 0 ? BigInt(digits.slice(0, cutIdx)) : 0n;
    const firstDropped = digits.charCodeAt(cutIdx) - 48;
    scaledMag = firstDropped >= 5 ? whole + 1n : whole;
  }

  if (scaledMag === 0n) {
    return 0n;
  }
  return negative ? -scaledMag : scaledMag;
};

roundDecimalExact._formatBigInt = function formatBigInt(scaled, dec) {
  if (scaled === 0n) {
    return 0;
  }
  const negative = scaled < 0n;
  const absStr = (negative ? -scaled : scaled).toString();
  if (dec === 0) {
    const intNum = Number((negative ? "-" : "") + absStr);
    return Number.isFinite(intNum) && intNum !== 0 ? intNum : 0;
  }
  const padded = absStr.padStart(dec + 1, "0");
  const intPart = padded.slice(0, padded.length - dec);
  const fracPart = padded.slice(padded.length - dec);
  const result = Number((negative ? "-" : "") + intPart + "." + fracPart);
  return Number.isFinite(result) && result !== 0 ? result : 0;
};

roundDecimalExact._divHalfAwayFromZero = function divHalfAwayFromZero(numBig, denBig) {
  if (numBig === 0n || denBig === 0n) {
    return 0n;
  }
  const negative = (numBig < 0n) !== (denBig < 0n);
  const a = numBig < 0n ? -numBig : numBig;
  const b = denBig < 0n ? -denBig : denBig;
  const quotient = a / b;
  const remainder = a % b;
  const rounded = remainder * 2n >= b ? quotient + 1n : quotient;
  if (rounded === 0n) {
    return 0n;
  }
  return negative ? -rounded : rounded;
};

function toSafeCents(amount) {
  const num = roundDecimalExact._toFiniteOrNull(amount);
  if (num === null || num === 0) {
    return 0;
  }
  const scaled = roundDecimalExact._scaleBigInt(amount, 2);
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (scaled > maxSafe || scaled < -maxSafe) {
    throw new RangeError("El monto excede el rango de centavos enteros seguros.");
  }
  const cents = Number(scaled);
  return cents === 0 ? 0 : cents;
}

function fromCents(cents) {
  const num = roundDecimalExact._toFiniteOrNull(cents);
  if (num === null || num === 0) {
    return 0;
  }
  const intBig = roundDecimalExact._scaleBigInt(cents, 0);
  return roundDecimalExact._formatBigInt(intBig, 2);
}

function normalizePaymentMovement(raw, idx = 0, fallbackDate = "") {
  const cleanStr = roundDecimalExact._cleanStr;
  const toFiniteOrNull = roundDecimalExact._toFiniteOrNull;
  const safeRaw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  const safeIdx = Number.isInteger(idx) && idx >= 0 ? idx : 0;
  const fbDate = cleanStr(fallbackDate);
  const rawDate = cleanStr(safeRaw.date || safeRaw.fecha);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : fbDate;
  const rawId = cleanStr(safeRaw.id).replace(/[^a-zA-Z0-9_\-]/g, "");
  const id = rawId || `pay_${(date || "00000000").replace(/[^0-9]/g, "")}_${safeIdx}`;

  let amountCents = 0;
  const rawCents = toFiniteOrNull(safeRaw.amountCents ?? safeRaw.montoCents);
  const rawAmount = toFiniteOrNull(safeRaw.amount ?? safeRaw.monto);
  if (rawCents !== null && rawCents > 0) {
    const roundedCents = Number(roundDecimalExact._scaleBigInt(safeRaw.amountCents ?? safeRaw.montoCents, 0));
    amountCents = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, roundedCents));
  } else if (rawAmount !== null && rawAmount > 0) {
    const clampedAmount = Math.min(1e11, Math.max(0, rawAmount));
    amountCents = toSafeCents(clampedAmount);
  }
  const amount = fromCents(amountCents);

  const rawMethod = cleanStr(safeRaw.method ?? safeRaw.payMethod ?? safeRaw.metodo).toLowerCase();
  let method = "Transferencia";
  if (rawMethod === "cheque") method = "Cheque";
  else if (rawMethod === "efectivo") method = "Efectivo";
  else if (rawMethod === "transferencia") method = "Transferencia";

  const ref = cleanStr(safeRaw.ref ?? safeRaw.payRef ?? safeRaw.referencia);
  const bank = method === "Efectivo" ? "" : cleanStr(safeRaw.bank ?? safeRaw.payBank ?? safeRaw.banco);
  const note = cleanStr(safeRaw.note ?? safeRaw.nota ?? safeRaw.observacion);
  const voided = safeRaw.voided === true || safeRaw.anulado === true;
  const voidReason = voided ? cleanStr(safeRaw.voidReason ?? safeRaw.motivoAnulacion) : "";
  const voidedAt = voided ? cleanStr(safeRaw.voidedAt ?? safeRaw.anuladoEn) : "";
  const migratedFromV4 = safeRaw.migratedFromV4 === true;
  const createdAt = cleanStr(safeRaw.createdAt) || date;

  return {
    id,
    date,
    amountCents,
    amount,
    method,
    ref,
    bank,
    note,
    voided,
    voidReason,
    voidedAt,
    migratedFromV4,
    createdAt
  };
}

function migrateSprayPaymentsFromV4(sp, idx = 0) {
  const cleanStr = roundDecimalExact._cleanStr;
  const toFiniteOrNull = roundDecimalExact._toFiniteOrNull;
  if (!sp || typeof sp !== "object" || Array.isArray(sp)) {
    return [];
  }

  let normalized;
  if (Array.isArray(sp.payments)) {
    normalized = sp.payments
      .filter(item => item && typeof item === "object")
      .map((item, i) => normalizePaymentMovement(item, i, sp.date))
      .filter(mov => mov.amountCents > 0);
  } else {
    const clampMoney = v => {
      const n = toFiniteOrNull(v);
      return n !== null && n > 0 ? Math.min(1e11, n) : 0;
    };
    const totalOrderCents = toSafeCents(clampMoney(sp.amount));
    const scalarPaidCents = toSafeCents(clampMoney(sp.amountPaid));
    let migratedCents = 0;

    if (sp.payStatus === "Pagado") {
      migratedCents = totalOrderCents;
    } else if (sp.payStatus === "Parcial") {
      migratedCents = Math.min(totalOrderCents, scalarPaidCents);
    }

    if (migratedCents > 0) {
      const safeIdPart = cleanStr(sp.id).replace(/[^a-zA-Z0-9_\-]/g, "") || String(Number.isInteger(idx) ? idx : 0);
      normalized = [
        normalizePaymentMovement(
          {
            id: `mig_v4_${safeIdPart}`,
            date: cleanStr(sp.date),
            amountCents: migratedCents,
            method: cleanStr(sp.payMethod) || "Transferencia",
            ref: cleanStr(sp.payRef),
            bank: cleanStr(sp.payBank),
            note: "Pago histórico migrado de V4",
            voided: false,
            migratedFromV4: true,
            createdAt: cleanStr(sp.date)
          },
          0,
          sp.date
        )
      ];
    } else {
      normalized = [];
    }
  }

  if (!Object.isFrozen(sp)) {
    sp.payments = normalized;
  }
  return normalized;
}

function computeSprayFinancials(sp, config = {}) {
  const scaleBigInt = roundDecimalExact._scaleBigInt;
  const divHalfUp = roundDecimalExact._divHalfAwayFromZero;
  const formatBigInt = roundDecimalExact._formatBigInt;
  const toFiniteOrNull = roundDecimalExact._toFiniteOrNull;

  const safeSp = sp && typeof sp === "object" && !Array.isArray(sp) ? sp : {};
  const safeCfg = config && typeof config === "object" && !Array.isArray(config) ? config : {};

  const clampSafeMoney = (n, fallback) => {
    const parsed = toFiniteOrNull(n);
    if (parsed === null || parsed < 0) return fallback;
    return Math.min(1e9, parsed);
  };

  const rawHa = toFiniteOrNull(safeSp.hectares);
  const clampedHa = rawHa !== null && rawHa > 0 ? Math.min(1e7, rawHa) : 0;
  const hectares = roundDecimalExact(clampedHa, 4);
  const hectaresScaled = scaleBigInt(hectares, 4);

  const defaultClientRate = roundDecimalExact(clampSafeMoney(safeCfg.clientRatePerHa, 15), 2);
  const isV5Pricing = safeSp.pricingMode === "v5";

  let unitRateHa;
  let discountPct;
  let ivaPct;
  let subtotalCents;
  let discountCents;
  let taxableBaseCents;
  let ivaCents;
  let totalClientCents;

  if (isV5Pricing) {
    const customRate = toFiniteOrNull(safeSp.unitRateHa);
    unitRateHa = customRate !== null && customRate >= 0
      ? roundDecimalExact(Math.min(1e9, customRate), 2)
      : defaultClientRate;

    const rawDisc = toFiniteOrNull(safeSp.discountPct);
    discountPct = rawDisc !== null
      ? Math.min(100, Math.max(0, roundDecimalExact(rawDisc, 2)))
      : 0;

    const rawIva = toFiniteOrNull(safeSp.ivaPct);
    ivaPct = rawIva !== null
      ? Math.min(100, Math.max(0, roundDecimalExact(rawIva, 2)))
      : 0;

    const rateCentsBig = scaleBigInt(unitRateHa, 2);
    const discBpBig = scaleBigInt(discountPct, 2);
    const ivaBpBig = scaleBigInt(ivaPct, 2);

    subtotalCents = Number(divHalfUp(hectaresScaled * rateCentsBig, 10000n));
    discountCents = Number(divHalfUp(BigInt(subtotalCents) * discBpBig, 10000n));
    taxableBaseCents = Math.max(0, subtotalCents - discountCents);
    ivaCents = Number(divHalfUp(BigInt(taxableBaseCents) * ivaBpBig, 10000n));
    const manualOverride = toFiniteOrNull(safeSp.manualTotalOverride);
    totalClientCents = manualOverride !== null && manualOverride >= 0
      ? toSafeCents(Math.min(1e9, manualOverride))
      : taxableBaseCents + ivaCents;
  } else {
    const rawLegacyAmount = toFiniteOrNull(safeSp.amount);
    const safeLegacyAmount = rawLegacyAmount !== null && rawLegacyAmount >= 0
      ? Math.min(1e11, rawLegacyAmount)
      : 0;
    totalClientCents = toSafeCents(safeLegacyAmount);
    subtotalCents = totalClientCents;
    discountPct = 0;
    discountCents = 0;
    taxableBaseCents = totalClientCents;
    ivaPct = 0;
    ivaCents = 0;
    unitRateHa = hectaresScaled > 0n
      ? formatBigInt(divHalfUp(BigInt(totalClientCents) * 10000n, hectaresScaled), 2)
      : defaultClientRate;
  }

  const movements = Array.isArray(safeSp.payments)
    ? safeSp.payments.filter(Boolean).map((item, i) => normalizePaymentMovement(item, i, safeSp.date))
    : migrateSprayPaymentsFromV4({ ...safeSp }, 0);

  let paidCents = 0;
  let activePaymentsCount = 0;
  const byMethodCents = {
    Transferencia: 0,
    Cheque: 0,
    Efectivo: 0
  };
  let lastActivePayment = null;

  for (const mov of movements) {
    if (!mov.voided && mov.amountCents > 0) {
      paidCents += mov.amountCents;
      activePaymentsCount += 1;
      byMethodCents[mov.method] = (byMethodCents[mov.method] || 0) + mov.amountCents;
      lastActivePayment = mov;
    }
  }

  const byMethod = {
    Transferencia: fromCents(byMethodCents.Transferencia),
    Cheque: fromCents(byMethodCents.Cheque),
    Efectivo: fromCents(byMethodCents.Efectivo)
  };

  const isRealized = safeSp.status === "Realizada";
  const pilotRateHa = roundDecimalExact(clampSafeMoney(safeCfg.pilotRatePerHa, 4.5), 2);
  const explicitPilotPay = toFiniteOrNull(safeSp.pilotPay);
  const pilotPayBaseCents = explicitPilotPay !== null && explicitPilotPay >= 0
    ? toSafeCents(Math.min(1e11, explicitPilotPay))
    : Number(divHalfUp(hectaresScaled * scaleBigInt(pilotRateHa, 2), 10000n));

  const pilotPayAmount = fromCents(pilotPayBaseCents);
  const pilotPayAccruedCents = isRealized ? pilotPayBaseCents : 0;
  const pilotPayEstimatedCents = !isRealized ? pilotPayBaseCents : 0;
  const pilotPaid = isRealized && safeSp.pilotPaid === true;
  const pilotPendingDepositCents = isRealized && !pilotPaid ? pilotPayBaseCents : 0;

  const clientBilledAccruedCents = isRealized ? totalClientCents : 0;
  const clientBilledEstimatedCents = !isRealized ? totalClientCents : 0;

  const difCents = totalClientCents - paidCents;
  const collectibleBalanceCents = isRealized && difCents > 0 ? difCents : 0;
  const creditFavorCents = isRealized && difCents < 0
    ? Math.abs(difCents)
    : (!isRealized && paidCents > 0 ? paidCents : 0);
  const netBalanceCents = isRealized ? difCents : 0;

  let payStatus;
  if (!isRealized) {
    payStatus = paidCents > 0 ? "Anticipo" : "No exigible";
  } else if (difCents < 0) {
    payStatus = "Saldo a favor";
  } else if (difCents === 0) {
    payStatus = "Pagado";
  } else if (paidCents > 0) {
    payStatus = "Parcial";
  } else {
    payStatus = "Pendiente";
  }

  const activeMethods = Object.entries(byMethodCents)
    .filter(([, c]) => c > 0)
    .map(([m]) => m);
  const primaryMethodDisplay = activeMethods.length > 1
    ? `Mixto (${activeMethods.join(" + ")})`
    : (activeMethods[0] || safeSp.payMethod || "Transferencia");

  return {
    pricingMode: isV5Pricing ? "v5" : "v4",
    isRealized,
    hectares,
    unitRateHa,
    discountPct,
    ivaPct,
    pilotRateHa,
    subtotalCents,
    discountCents,
    taxableBaseCents,
    ivaCents,
    totalClientCents,
    paidCents,
    byMethodCents,
    pilotPayBaseCents,
    pilotPayAccruedCents,
    pilotPayEstimatedCents,
    pilotPendingDepositCents,
    clientBilledAccruedCents,
    clientBilledEstimatedCents,
    difCents,
    collectibleBalanceCents,
    creditFavorCents,
    netBalanceCents,
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    taxableBase: fromCents(taxableBaseCents),
    iva: fromCents(ivaCents),
    totalClient: fromCents(totalClientCents),
    paidAmount: fromCents(paidCents),
    totalPaid: fromCents(paidCents),
    byMethod,
    pilotPayAmount,
    pilotPayAccrued: fromCents(pilotPayAccruedCents),
    pilotPayEstimated: fromCents(pilotPayEstimatedCents),
    pilotPendingDeposit: fromCents(pilotPendingDepositCents),
    pilotPaid,
    clientBilledAccrued: fromCents(clientBilledAccruedCents),
    clientBilledEstimated: fromCents(clientBilledEstimatedCents),
    collectibleBalance: fromCents(collectibleBalanceCents),
    creditFavor: fromCents(creditFavorCents),
    netBalance: fromCents(netBalanceCents),
    payStatus,
    activePaymentsCount,
    primaryMethodDisplay,
    lastActivePayment,
    payments: movements
  };
}

function computePortfolioSummary(sprays, config = {}) {
  const list = Array.isArray(sprays) ? sprays : [];
  let totalRealizedHaScaled = 0n;
  let totalEstimatedHaScaled = 0n;
  let billedAccruedCents = 0;
  let billedEstimatedCents = 0;
  let collectibleCents = 0;
  let collectibleOrdersCount = 0;
  let creditFavorCents = 0;
  let advancesOnPendingCents = 0;
  let pilotAccruedPendingCents = 0;
  let pilotAccruedPaidCents = 0;
  let pilotEstimatedCents = 0;
  const collectedByMethodCents = {
    Transferencia: 0,
    Cheque: 0,
    Efectivo: 0
  };

  for (const sp of list) {
    const fin = computeSprayFinancials(sp, config);
    const haBig = roundDecimalExact._scaleBigInt(fin.hectares, 4);
    if (fin.isRealized) {
      totalRealizedHaScaled += haBig;
      billedAccruedCents += fin.totalClientCents;
      if (fin.collectibleBalanceCents > 0) {
        collectibleCents += fin.collectibleBalanceCents;
        collectibleOrdersCount += 1;
      }
      if (fin.difCents < 0) {
        creditFavorCents += Math.abs(fin.difCents);
      }
      if (fin.pilotPaid) {
        pilotAccruedPaidCents += fin.pilotPayAccruedCents;
      } else {
        pilotAccruedPendingCents += fin.pilotPayAccruedCents;
      }
    } else {
      totalEstimatedHaScaled += haBig;
      billedEstimatedCents += fin.totalClientCents;
      pilotEstimatedCents += fin.pilotPayEstimatedCents;
      if (fin.paidCents > 0) {
        advancesOnPendingCents += fin.paidCents;
      }
    }

    // Todo ingreso de caja vigente (realizado o anticipo) se atribuye a su método real
    collectedByMethodCents.Transferencia += fin.byMethodCents.Transferencia;
    collectedByMethodCents.Cheque += fin.byMethodCents.Cheque;
    collectedByMethodCents.Efectivo += fin.byMethodCents.Efectivo;
  }

  return {
    realizedHectares: roundDecimalExact._formatBigInt(totalRealizedHaScaled, 4),
    estimatedHectares: roundDecimalExact._formatBigInt(totalEstimatedHaScaled, 4),
    billedAccrued: fromCents(billedAccruedCents),
    billedEstimated: fromCents(billedEstimatedCents),
    collectibleTotal: fromCents(collectibleCents),
    collectibleOrdersCount,
    creditFavorTotal: fromCents(creditFavorCents),
    advancesOnPendingTotal: fromCents(advancesOnPendingCents),
    pilotAccruedPending: fromCents(pilotAccruedPendingCents),
    pilotAccruedPaid: fromCents(pilotAccruedPaidCents),
    pilotEstimated: fromCents(pilotEstimatedCents),
    collectedByMethod: {
      Transferencia: fromCents(collectedByMethodCents.Transferencia),
      Cheque: fromCents(collectedByMethodCents.Cheque),
      Efectivo: fromCents(collectedByMethodCents.Efectivo)
    },
    totalCashCollected: fromCents(
      collectedByMethodCents.Transferencia +
      collectedByMethodCents.Cheque +
      collectedByMethodCents.Efectivo
    )
  };
}

function canTransitionSprayStatus(sp, nextStatus, config = {}) {
  const validStatuses = new Set(["Realizada", "Pendiente", "Reprogramada"]);
  if (!sp || typeof sp !== "object" || Array.isArray(sp)) {
    return { allowed: false, requiresConfirm: false, reason: "Orden de fumigación inválida." };
  }
  if (!validStatuses.has(nextStatus)) {
    return { allowed: false, requiresConfirm: false, reason: "Estado de destino inválido." };
  }
  if (sp.status === nextStatus) {
    return { allowed: true, requiresConfirm: false };
  }

  if (sp.status === "Realizada" && nextStatus !== "Realizada") {
    if (sp.pilotPaid === true) {
      return {
        allowed: false,
        requiresConfirm: false,
        reason: `No se puede cambiar a "${nextStatus}" porque el depósito al piloto ya figura como realizado. Revierta primero el pago al piloto para proteger la contabilidad.`
      };
    }

    const fin = computeSprayFinancials(sp, config);
    if (fin.paidCents > 0) {
      return {
        allowed: true,
        requiresConfirm: true,
        paidCents: fin.paidCents,
        paidAmount: fin.paidAmount,
        message: `Esta orden ya tiene $${fin.paidAmount.toFixed(2)} abonados por el cliente. Si la cambias a "${nextStatus}", los abonos se conservarán intactos como Anticipo a favor, pero el saldo exigible y el pago devengado al piloto pasarán a $0.00 (Estimado) hasta que se realice el vuelo. ¿Deseas continuar?`
      };
    }
  }

  return { allowed: true, requiresConfirm: false };
}

if (typeof window !== "undefined") {
  window.roundDecimalExact = roundDecimalExact;
  window.toSafeCents = toSafeCents;
  window.fromCents = fromCents;
  window.normalizePaymentMovement = normalizePaymentMovement;
  window.migrateSprayPaymentsFromV4 = migrateSprayPaymentsFromV4;
  window.computeSprayFinancials = computeSprayFinancials;
  window.computePortfolioSummary = computePortfolioSummary;
  window.canTransitionSprayStatus = canTransitionSprayStatus;
}
