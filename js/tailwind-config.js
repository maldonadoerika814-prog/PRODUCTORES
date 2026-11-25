/* ==========================================================================
   AgroDrone - Configuración de Tema Tailwind (js/tailwind-config.js)
   Se ejecuta inmediatamente después de Tailwind Play CDN para definir paleta.
   ========================================================================== */

if (typeof window.tailwind !== "undefined") {
  window.tailwind.config = {
    darkMode: "class",
    theme: {
      extend: {
        colors: {
          brand: {
            bg: "#050912",
            card: "#0b1324",
            border: "#1b2842",
            accent: "#00ff88",
            accentDark: "#10b981",
            blue: "#00d4ff",
            blueDark: "#3b82f6",
            warning: "#f59e0b",
            danger: "#ef4444"
          }
        },
        fontFamily: {
          sans: ["Inter", "sans-serif"]
        }
      }
    }
  };
}
