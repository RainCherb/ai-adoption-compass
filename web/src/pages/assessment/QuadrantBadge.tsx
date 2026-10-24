import type { Quadrant } from "../../api/types";
import { Icon } from "../../components/ui/Icon";
import { QUADRANT_STYLE } from "./quadrants";

interface QuadrantBadgeProps {
  quadrant: Quadrant;
  label: string;
}

/** Бейдж квадранта: цвет всегда дополнен значком и текстом. */
export function QuadrantBadge({ quadrant, label }: QuadrantBadgeProps) {
  return (
    <span className="qbadge" data-quadrant={quadrant}>
      <Icon name={QUADRANT_STYLE[quadrant].icon} size={13} />
      {label}
    </span>
  );
}
