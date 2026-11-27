/* ==========================================================================
   AgroDrone - Punto de Entrada Principal (js/main.js)
   Inicializa estado V5, sincronización entre pestañas y eventos delegados.
   ========================================================================== */

"use strict";

function initApp() {
  loadState();
  applyBackgroundAppearance();
  populateSectorFilter();
  updateSeasonBadges();
  updateBackupIndicators();
  setupMobileSidebarEvents();
  setupDelegatedUiEvents();
  setupModalAccessibility();
  setupAutoBackupOnClose();
  setupCrossTabSync();
  switchTab("dashboard");
  safeRefreshIcons();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
