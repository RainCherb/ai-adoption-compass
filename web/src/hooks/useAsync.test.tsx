import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { useAsync } from "./useAsync";
import { useDebounced } from "./useDebounced";

describe("useAsync", () => {
  it("сначала «загрузка», затем данные", async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve("готово"), "k"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe("готово");
    expect(result.current.error).toBeUndefined();
  });

  it("ошибка нормализуется в ApiError, reload повторяет запрос и снимает ошибку", async () => {
    let attempt = 0;
    const load = vi.fn(() => (++attempt === 1 ? Promise.reject(new ApiError("Сервер недоступен", 503)) : Promise.resolve(42)));
    const { result } = renderHook(() => useAsync(load, "k"));
    await waitFor(() => expect(result.current.error?.message).toBe("Сервер недоступен"));
    expect(result.current.loading).toBe(false);

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(result.current.error).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("при смене ключа запрашивает заново, а предыдущий запрос отменяет", () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => undefined);
    });
    const { rerender } = renderHook(({ id }) => useAsync(load, id), { initialProps: { id: "a" } });
    rerender({ id: "b" });
    expect(load).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("с loader = null ничего не запрашивает и не показывает загрузку", () => {
    const { result } = renderHook(() => useAsync<string>(null, "none"));
    expect(result.current).toMatchObject({ loading: false, data: undefined, error: undefined });
  });

  it("пока идёт новый запрос, показывает предыдущие данные", async () => {
    const { result, rerender } = renderHook(
      ({ id }) => useAsync(() => (id === "a" ? Promise.resolve("A") : new Promise<string>(() => undefined)), id),
      { initialProps: { id: "a" } },
    );
    await waitFor(() => expect(result.current.data).toBe("A"));
    rerender({ id: "b" });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe("A");
  });
});

describe("useDebounced", () => {
  afterEach(() => vi.useRealTimers());

  function Probe({ value }: { value: string }) {
    return <output>{useDebounced(value, 300)}</output>;
  }

  it("обновляет значение только после паузы в вводе", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="a" />);
    expect(screen.getByRole("status")).toHaveTextContent("a");
    rerender(<Probe value="ab" />);
    rerender(<Probe value="abc" />);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.getByRole("status")).toHaveTextContent("a");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent("abc");
  });

  it("не ломается при быстрых изменениях с реальными таймерами", async () => {
    const user = userEvent.setup();
    function Form() {
      const [value, setValue] = useState("");
      const debounced = useDebounced(value, 50);
      return (
        <>
          <input aria-label="поле" value={value} onChange={(event) => setValue(event.target.value)} />
          <p data-testid="debounced">{debounced}</p>
        </>
      );
    }
    render(<Form />);
    await user.type(screen.getByLabelText("поле"), "привет");
    await waitFor(() => expect(screen.getByTestId("debounced")).toHaveTextContent("привет"));
  });
});
