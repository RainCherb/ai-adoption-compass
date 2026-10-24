import { ICONS, type IconName } from "./icons";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Если передать подпись, иконка станет доступной для скринридеров; иначе она декоративная. */
  label?: string;
}

export function Icon({ name, size = 18, className, label }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
