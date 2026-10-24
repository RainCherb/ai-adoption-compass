import type { IconName } from "../components/ui/icons";

export const ROUTES = [
  { id: "models", label: "Зарубежные модели", icon: "cpu" },
  { id: "assessment", label: "Оценка процессов", icon: "chart" },
  { id: "advisor", label: "Подбор моделей", icon: "cpu" },
  { id: "safety", label: "Безопасность данных", icon: "shield" },
  { id: "prompts", label: "Промпты", icon: "message" },
  { id: "evals", label: "Качество моделей", icon: "target" },
  { id: "audit", label: "Журнал", icon: "list" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

export type RouteId = (typeof ROUTES)[number]["id"];

export const DEFAULT_ROUTE: RouteId = "models";

export function hrefFor(id: RouteId): string {
  return `#/${id}`;
}

/** `#/advisor` → "advisor"; пустой или неизвестный хеш ведёт на страницу по умолчанию. */
export function parseRoute(hash: string): RouteId {
  const segment = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  const match = ROUTES.find((route) => route.id === segment);
  return match ? match.id : DEFAULT_ROUTE;
}
