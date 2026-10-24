export interface Span {
  start: number;
  end: number;
}

export interface Segment<F extends Span> {
  text: string;
  finding?: F;
}

/**
 * Режет текст по найденным фрагментам. Смещения бэкенда — индексы строки Python,
 * то есть кодовые точки Unicode, а не единицы UTF-16, поэтому текст сначала
 * разворачивается через Array.from (эмодзи занимает одну позицию).
 * Пересечения усекаются, фрагменты за пределами текста отбрасываются.
 */
export function splitByFindings<F extends Span>(text: string, findings: readonly F[]): Segment<F>[] {
  const chars = Array.from(text);
  const ordered = [...findings].sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: Segment<F>[] = [];
  let cursor = 0;

  for (const finding of ordered) {
    const start = Math.max(finding.start, cursor);
    const end = Math.min(finding.end, chars.length);
    if (end <= start) continue;
    if (start > cursor) segments.push({ text: chars.slice(cursor, start).join("") });
    segments.push({ text: chars.slice(start, end).join(""), finding });
    cursor = end;
  }
  if (cursor < chars.length) segments.push({ text: chars.slice(cursor).join("") });
  return segments;
}
