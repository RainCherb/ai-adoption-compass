import { createContext, useContext } from "react";
import type { Meta } from "../api/types";

export const MetaContext = createContext<Meta | null>(null);

export function useMeta(): Meta {
  const meta = useContext(MetaContext);
  if (!meta) throw new Error("useMeta можно вызывать только внутри MetaContext.Provider");
  return meta;
}

/** Подпись из списка `{value, label}` из /api/meta; если значения нет — само значение. */
export function labelOf(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
