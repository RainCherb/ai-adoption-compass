import { useCallback, useState } from "react";
import { type ApiError, toApiError } from "../api/errors";

interface ActionState {
  pending: boolean;
  error: ApiError | undefined;
}

/** Обёртка для запросов по клику: признак «идёт запрос» и нормализованная ошибка. */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [state, setState] = useState<ActionState>({ pending: false, error: undefined });

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setState({ pending: true, error: undefined });
      try {
        const result = await action(...args);
        setState({ pending: false, error: undefined });
        return result;
      } catch (error) {
        setState({ pending: false, error: toApiError(error) });
        return undefined;
      }
    },
    [action],
  );

  const reset = useCallback(() => setState({ pending: false, error: undefined }), []);
  return { run, reset, pending: state.pending, error: state.error };
}
