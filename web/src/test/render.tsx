import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MetaContext } from "../hooks/useMeta";
import { meta } from "./fixtures";

/** Рендер страницы с настройками из /api/meta (как внутри App, но без сетевых запросов за meta). */
export function renderWithMeta(ui: ReactElement) {
  return render(<MetaContext.Provider value={meta}>{ui}</MetaContext.Provider>);
}
