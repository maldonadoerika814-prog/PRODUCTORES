/* ==========================================================================
   AgroDrone - Delegación Centralizada de Eventos UI (js/ui-events.js)
   Desacopla el HTML del JavaScript mediante atributos data-action,
   data-change, data-input y data-submit sin ningún manejador inline.
   ========================================================================== */

"use strict";

function setupDelegatedUiEvents() {
  // 1. Delegación de clics
  document.addEventListener("click", ev => {
    const actionEl = ev.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    switch (action) {
      case "switch-tab":
        switchTab(actionEl.dataset.tab || "dashboard");
        break;
      case "export-json":
        exportSystemJSON();
        break;
      case "dismiss-backup-banner":
        dismissBackupBannerForSession();
        break;
      case "start-empty-data":
        requestStartWithEmptyData();
        break;
      case "reset-sample-data":
        requestResetSampleData();
        break;
      case "restore-auto-backup":
        requestRestoreAutoBackup();
        break;
      case "link-auto-backup-file":
        linkAutoBackupFile();
        break;
      case "save-daily-batch":
        saveDailyBatchSprays();
        break;
      case "add-daily-product":
        addDailyProductRow(actionEl);
        break;
      case "remove-daily-product": {
        const prodRow = actionEl.closest(".daily-prod-row");
        if (prodRow) prodRow.remove();
        break;
      }
      case "clear-dji-preview":
        clearDjiPreview();
        break;
      case "register-dji-rows":
        registerDjiImportedRows();
        break;
      case "split-dji-group":
        splitDjiGroupByPlot(actionEl.dataset.groupId || "");
        break;
      case "rejoin-dji-group":
        rejoinDjiGroup(actionEl.dataset.groupId || "");
        break;
      case "delete-loc-memory":
        requestDeleteLocationMemory(actionEl.dataset.locKey || "");
        break;
      case "delete-plot-memory":
        requestDeletePlotMemory(actionEl.dataset.plotId || "");
        break;
      case "open-producer-modal":
        openProducerModal(actionEl.dataset.prodId || null);
        break;
      case "open-add-farm-modal":
        openAddFarmModal(actionEl.dataset.prodId || "");
        break;
      case "open-farm-edit-modal":
        openFarmEditModal(actionEl.dataset.prodId || "", actionEl.dataset.farmId || "");
        break;
      case "delete-producer":
        requestDeleteProducer(actionEl.dataset.prodId || "");
        break;
      case "delete-farm":
        requestDeleteFarm(actionEl.dataset.prodId || "", actionEl.dataset.farmId || "");
        break;
      case "open-statement-modal":
        openStatementModal(actionEl.dataset.prodId || "");
        break;
      case "open-spray-modal":
        openSprayModal(actionEl.dataset.sprayId || null);
        break;
      case "open-spray-pdf-modal":
        openSprayPdfModal(actionEl.dataset.sprayId || "");
        break;
      case "delete-spray":
        requestDeleteSpray(actionEl.dataset.sprayId || "");
        break;
      case "mark-pilot-paid":
        requestMarkPilotAsPaid(actionEl.dataset.sprayId || "");
        break;
      case "unmark-pilot-paid":
        requestUnmarkPilotAsPaid(actionEl.dataset.sprayId || "");
        break;
      case "void-payment":
        requestVoidPaymentMovement(actionEl.dataset.sprayId || "", actionEl.dataset.paymentId || "");
        break;
      case "add-spray-product":
        addProductRowToSprayForm();
        break;
      case "remove-spray-product":
        removeProductRow(actionEl);
        break;
      case "change-calendar-month":
        changeCalendarMonth(parseInt(actionEl.dataset.offset || "0", 10));
        break;
      case "reset-calendar-today":
        resetCalendarToToday();
        break;
      case "export-billing-csv":
        exportBillingCSV();
        break;
      case "open-payment-modal":
        openPaymentModal(actionEl.dataset.sprayId || "");
        break;
      case "mark-spray-paid":
        requestMarkSprayAsPaid(actionEl.dataset.sprayId || "");
        break;
      case "open-reschedule-modal":
        openRescheduleModal(actionEl.dataset.farmId || "", actionEl.dataset.sprayId || null);
        break;
      case "clear-reschedule":
        requestClearReschedule();
        break;
      case "clear-assoc-logo":
        clearAssocLogo();
        break;
      case "close-modal":
        closeModal(actionEl.dataset.modalId || "");
        break;
      case "close-confirm-modal":
        closeConfirmModal();
        break;
      case "print-pdf":
        printCurrentPdf();
        break;
      default:
        break;
    }
  });

  // 2. Delegación de eventos change
  document.addEventListener("change", ev => {
    const changeEl = ev.target.closest("[data-change]");
    if (!changeEl) return;

    switch (changeEl.dataset.change) {
      case "daily-date":
        onDailyDateChanged();
        break;
      case "daily-farm-cb":
        toggleDailyFarmFields(changeEl);
        break;
      case "daily-pay-status":
        toggleDailyPartialInput(changeEl);
        break;
      case "dji-excel-upload":
        handleDjiExcelUpload(ev);
        break;
      case "dji-row-farm":
        onDjiRowFarmChanged(changeEl.dataset.rowId || "", changeEl.value);
        break;
      case "dji-row-included":
        onDjiRowIncludedChanged(changeEl.dataset.rowId || "", changeEl.checked);
        break;
      case "filter-producers":
        renderProducersList();
        break;
      case "filter-sprays":
        renderSpraysTable();
        break;
      case "filter-billing":
        renderBillingTable();
        break;
      case "assoc-logo-upload":
        handleAssocLogoUpload(ev);
        break;
      case "import-json":
        importSystemJSON(ev);
        break;
      case "spray-farm-select":
        onSprayFarmSelected();
        break;
      case "spray-pay-method":
        togglePaymentRefFields();
        break;
      case "spray-pay-status":
        togglePartialPaidField();
        break;
      case "payment-modal-method":
        toggleQuickPaymentBankField();
        break;
      default:
        break;
    }
  });

  // 3. Delegación de eventos input
  document.addEventListener("input", ev => {
    const inputEl = ev.target.closest("[data-input]");
    if (!inputEl) return;

    switch (inputEl.dataset.input) {
      case "filter-daily-cards":
        filterDailyCards();
        break;
      case "daily-ha":
      case "daily-discount":
        recalcDailyCardAmounts(inputEl);
        break;
      case "search-producers":
        renderProducersList();
        break;
      case "preview-overlay":
        previewOverlayOpacity(inputEl.value);
        break;
      case "producer-doc":
        updateDocValidationPreview();
        break;
      case "producer-phone":
        updatePhoneFormatPreview();
        break;
      case "spray-hectares":
      case "spray-pricing":
        onSprayPricingChanged();
        break;
      default:
        break;
    }
  });

  // 4. Delegación de envíos de formularios
  document.addEventListener("submit", ev => {
    const formEl = ev.target.closest("form[data-submit]");
    if (!formEl) return;

    switch (formEl.dataset.submit) {
      case "settings-form":
        saveSettings(ev);
        break;
      case "producer-form":
        saveProducerForm(ev);
        break;
      case "spray-form":
        saveSprayForm(ev);
        break;
      case "payment-form":
        saveQuickPaymentForm(ev);
        break;
      case "reschedule-form":
        saveRescheduleForm(ev);
        break;
      default:
        break;
    }
  });
}

function setupMobileSidebarEvents() {
  const mobileBtn = document.getElementById("mobileMenuBtn");
  const mobileCloseBtn = document.getElementById("mobileCloseSidebarBtn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const mainEl = document.querySelector("#appShell > main") || document.querySelector("main");
  const topbarEl = mobileBtn
    ? mobileBtn.closest(".lg\\:hidden")
    : document.querySelector("#appShell > .lg\\:hidden");

  syncSidebarInertState();

  const openMobileSidebar = () => {
    if (!sidebar || !overlay) return;
    sidebar.classList.remove("-translate-x-full");
    overlay.classList.remove("hidden");
    syncSidebarInertState();
    if (mobileBtn) {
      mobileBtn.setAttribute("aria-expanded", "true");
    }
    if (window.innerWidth < 1024) {
      document.documentElement.classList.add("drawer-open");
      document.body.classList.add("drawer-open");
      if (mainEl) {
        mainEl.inert = true;
        mainEl.setAttribute("inert", "");
      }
      if (topbarEl) {
        topbarEl.inert = true;
        topbarEl.setAttribute("inert", "");
      }
      if (mobileCloseBtn) {
        mobileCloseBtn.focus();
      }
    }
  };

  if (mobileBtn && sidebar && overlay) {
    mobileBtn.addEventListener("click", () => {
      const isCurrentlyOpen = !sidebar.classList.contains("-translate-x-full");
      if (isCurrentlyOpen) {
        closeMobileSidebar(true);
      } else {
        openMobileSidebar();
      }
    });
    overlay.addEventListener("click", () => closeMobileSidebar(true));
  }
  if (mobileCloseBtn) {
    mobileCloseBtn.addEventListener("click", () => closeMobileSidebar(true));
  }

  document.addEventListener("keydown", ev => {
    if (ev.key !== "Tab") return;
    if (window.innerWidth >= 1024 || !sidebar || sidebar.classList.contains("-translate-x-full")) {
      return;
    }
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ].join(", ");
    const focusables = Array.from(sidebar.querySelectorAll(focusableSelector)).filter(
      el => !el.classList.contains("hidden") && el.getClientRects().length > 0
    );
    if (focusables.length === 0) return;

    const firstEl = focusables[0];
    const lastEl = focusables[focusables.length - 1];
    const activeEl = document.activeElement;

    if (ev.shiftKey) {
      if (activeEl === firstEl || !sidebar.contains(activeEl)) {
        ev.preventDefault();
        lastEl.focus();
      }
    } else {
      if (activeEl === lastEl || !sidebar.contains(activeEl)) {
        ev.preventDefault();
        firstEl.focus();
      }
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 1024) {
      closeMobileSidebar(false);
    } else {
      syncSidebarInertState();
    }
  });
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

  closableModalIds.forEach(id => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.addEventListener("click", ev => {
      if (ev.target === modal) closeModal(id);
    });
  });

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
    const sidebar = document.getElementById("sidebar");
    if (window.innerWidth < 1024 && sidebar && !sidebar.classList.contains("-translate-x-full")) {
      closeMobileSidebar(true);
    }
  });
}

function setupAutoBackupOnClose() {
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
    if (state.meta && state.meta.hasUnexportedChanges) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
