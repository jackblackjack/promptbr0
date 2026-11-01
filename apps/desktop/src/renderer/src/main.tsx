import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getPref } from "./lib/prefs";
import { initTheme } from "./lib/theme";
import { initI18n } from "./lib/i18n";
import { RendererRoot } from "./RendererRoot";
import "@xyflow/react/dist/style.css";
import "./index.css";

// Apply theme synchronously. English ships in the main bundle, so `t()` works
// on the first render; the user's saved language (if Russian) is loaded here
// as well — awaiting it keeps the first paint fully translated instead of
// flashing English labels.
initTheme();
initI18n(getPref("ui-lang")).then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RendererRoot />
    </StrictMode>,
  );
});
