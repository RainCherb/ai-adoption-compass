import { useCallback, useEffect, useRef, useState } from "react";

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Фолбэк для небезопасного контекста (http) и старых браузеров.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = typeof document.execCommand === "function" && document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function useCopy(resetMs = 2000): { copied: boolean; failed: boolean; copy: (text: string) => Promise<void> } {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await writeToClipboard(text);
      setStatus(ok ? "copied" : "failed");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus("idle"), resetMs);
    },
    [resetMs],
  );

  return { copied: status === "copied", failed: status === "failed", copy };
}
