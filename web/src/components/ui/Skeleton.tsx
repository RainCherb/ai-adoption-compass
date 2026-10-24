import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

export function Skeleton({ width = "100%", height = 16, radius, className }: SkeletonProps) {
  return (
    <span
      className={cx("skeleton", className)}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** Контейнер загрузки: скринридер получает один понятный статус, а не набор пустых блоков. */
export function LoadingRegion({ label = "Загрузка…", children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonCards({ count = 3, height = 120 }: { count?: number; height?: number }) {
  return (
    <div className="skeleton-grid">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} height={height} radius={12} />
      ))}
    </div>
  );
}

export function SkeletonLines({ lines = 4 }: { lines?: number }) {
  return (
    <div className="skeleton-lines">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? "60%" : "100%"} height={14} />
      ))}
    </div>
  );
}
