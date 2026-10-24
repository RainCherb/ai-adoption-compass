import type { Quadrant } from "../../api/types";
import type { IconName } from "../../components/ui/icons";

/** Цвета и значки квадрантов — единственное, что не приходит из /api/meta. */
export const QUADRANT_STYLE: Record<Quadrant, { icon: IconName }> = {
  quick_win: { icon: "bolt" },
  strategic: { icon: "flag" },
  fill_in: { icon: "layers" },
  postpone: { icon: "pause" },
  blocked: { icon: "ban" },
};

export const QUADRANT_ORDER: readonly Quadrant[] = ["quick_win", "strategic", "fill_in", "postpone", "blocked"];
