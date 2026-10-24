interface InlineBarProps {
  /** Доля 0…1. */
  share: number;
  text: string;
}

/** Мини-столбик в ячейке таблицы; значение всегда продублировано текстом. */
export function InlineBar({ share, text }: InlineBarProps) {
  const width = `${Math.min(Math.max(share, 0), 1) * 100}%`;
  return (
    <div className="inline-bar">
      <span className="inline-bar__track" aria-hidden="true">
        <span className="inline-bar__fill" style={{ width }} />
      </span>
      <span className="inline-bar__text num">{text}</span>
    </div>
  );
}
