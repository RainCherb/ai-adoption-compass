import { getHealth, getMeta } from "./api/client";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBanner } from "./components/ui/Banner";
import { LoadingRegion, Skeleton, SkeletonCards } from "./components/ui/Skeleton";
import { useAsync } from "./hooks/useAsync";
import { useHashRoute } from "./hooks/useHashRoute";
import { MetaContext } from "./hooks/useMeta";
import { useTheme } from "./hooks/useTheme";
import type { RouteId } from "./lib/routes";
import { AdvisorPage } from "./pages/advisor/AdvisorPage";
import { AssessmentPage } from "./pages/assessment/AssessmentPage";
import { AuditPage } from "./pages/audit/AuditPage";
import { EvalsPage } from "./pages/evals/EvalsPage";
import { PromptsPage } from "./pages/prompts/PromptsPage";
import { SafetyPage } from "./pages/safety/SafetyPage";
import { ModelsPage } from "./pages/models/ModelsPage";

function Page({ route }: { route: RouteId }) {
  switch (route) {
    case "models":
      return <ModelsPage />;
    case "assessment":
      return <AssessmentPage />;
    case "advisor":
      return <AdvisorPage />;
    case "safety":
      return <SafetyPage />;
    case "prompts":
      return <PromptsPage />;
    case "evals":
      return <EvalsPage />;
    case "audit":
      return <AuditPage />;
  }
}

export default function App() {
  const route = useHashRoute();
  const { theme, toggle } = useTheme();
  const health = useAsync((signal) => getHealth(signal), "health");
  const meta = useAsync((signal) => getMeta(signal), "meta");

  return (
    <AppShell route={route} theme={theme} onToggleTheme={toggle} health={health}>
      {meta.error ? (
        <ErrorBanner error={meta.error} onRetry={meta.reload} title="Не удалось загрузить настройки сервиса" />
      ) : meta.data ? (
        <MetaContext.Provider value={meta.data}>
          <Page route={route} />
        </MetaContext.Provider>
      ) : (
        <LoadingRegion label="Загрузка…" className="stack">
          <Skeleton width="40%" height={32} radius={8} />
          <SkeletonCards count={3} height={110} />
        </LoadingRegion>
      )}
    </AppShell>
  );
}
