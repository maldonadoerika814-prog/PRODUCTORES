/* ==========================================================================
   AgroDrone - Punto de Entrada Principal (js/main.js)
   Inicializa el estado, enlaza eventos delegados y arranca el Panel Principal.
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
  switchTab("dashboard");
  safeRefreshIcons();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
