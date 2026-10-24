import { useSyncExternalStore } from "react";
import { type RouteId, parseRoute } from "../lib/routes";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const getHash = (): string => window.location.hash;
const getServerHash = (): string => "";

/** Маршрут из location.hash (`#/advisor`); без роутера, только событие hashchange. */
export function useHashRoute(): RouteId {
  return parseRoute(useSyncExternalStore(subscribe, getHash, getServerHash));
}
