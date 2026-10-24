import { useCallback, useEffect, useRef, useState } from "react";
import { type ApiError, isAbortError, toApiError } from "../api/errors";

export interface AsyncState<T> {
  /** Последний успешный результат; пока идёт новый запрос, это предыдущие данные. */
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

interface Settled<T> {
  key: string;
  data: T | undefined;
  error: ApiError | undefined;
}

/**
 * Загружает данные при смене `key`. Предыдущий запрос отменяется через AbortSignal.
 * `load = null` — ничего не загружать (например, пока не выбран элемент).
 * Состояние «загрузка» выводится из ключа, поэтому в эффекте нет синхронных setState.
 */
export function useAsync<T>(load: ((signal: AbortSignal) => Promise<T>) | null, key: string): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const effectiveKey = `${key}#${nonce}`;
  const enabled = load !== null;

  useEffect(() => {
    const run = loadRef.current;
    if (!run) return;
    const controller = new AbortController();
    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ key: effectiveKey, data, error: undefined });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setSettled((previous) => ({ key: effectiveKey, data: previous?.data, error: toApiError(error) }));
      },
    );
    return () => controller.abort();
  }, [effectiveKey, enabled]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const current = settled?.key === effectiveKey ? settled : null;

  return {
    data: enabled ? settled?.data : undefined,
    error: enabled ? current?.error : undefined,
    loading: enabled && current === null,
    reload,
  };
}
