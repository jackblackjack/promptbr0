import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import App from "./App";
import { QuickPalette } from "./components/QuickPalette";
import { onLocaleChange } from "./lib/i18n";
import { ToastProvider } from "./lib/toast";
import { AppStateProvider } from "./state/app-state";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function RendererRoot({ hash = window.location.hash }: { hash?: string }) {
  // A language switch loads the new dictionary asynchronously, then notifies
  // subscribers. Re-rendering the root here re-renders every `t()` call site
  // (components that consume AppState also re-render via the context value).
  const [, forceRender] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => onLocaleChange(forceRender), []);

  if (hash === "#quick-palette") return <QuickPalette />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
