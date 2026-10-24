/** Знак: стрелка компаса в круге (те же формы, что в favicon.svg). */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" className="logo-mark__bg" />
      <circle cx="32" cy="32" r="22" fill="none" className="logo-mark__ring" strokeWidth="3" />
      <g transform="rotate(45 32 32)">
        <path d="M32 10 38 32H26Z" className="logo-mark__north" />
        <path d="M32 54 38 32H26Z" className="logo-mark__south" />
      </g>
      <circle cx="32" cy="32" r="2.5" className="logo-mark__bg" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo__name">AI Adoption Compass</span>
    </span>
  );
}
