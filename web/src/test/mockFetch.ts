import { vi } from "vitest";

/** Ответ с нужным статусом; обычное значение в `reply` — это 200 + JSON. */
export class MockReply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {}
}

export const reply = (status: number, body?: unknown) => new MockReply(status, body);

export interface MockRequest {
  method: string;
  path: string;
  search: URLSearchParams;
  /** Тело JSON или FormData. */
  body: unknown;
  headers: Headers;
}

export interface MockRoute {
  method?: "GET" | "POST" | "DELETE";
  path: string | RegExp;
  /** Готовый ответ: значение → 200 + JSON, `reply(status, body)` → свой статус. */
  reply?: unknown;
  /** Ответ, зависящий от запроса или состояния теста; исключение имитирует сбой сети. */
  handle?: (request: MockRequest) => unknown;
}

function toResponse(value: unknown): Response {
  const { status, body } = value instanceof MockReply ? value : { status: 200, body: value };
  if (body === undefined || status === 204) return new Response(null, { status });
  const isText = typeof body === "string" && status >= 400 && body.startsWith("<");
  return new Response(isText ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": isText ? "text/html" : "application/json" },
  });
}

/** Подменяет fetch: незамоканный запрос падает сразу, чтобы тесты не ходили в сеть. */
export function mockFetch(routes: readonly MockRoute[]) {
  const calls: MockRequest[] = [];

  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await Promise.resolve(); // как у настоящего fetch, ответ приходит асинхронно
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = init?.body;
    const request: MockRequest = {
      method,
      path: url.pathname,
      search: url.searchParams,
      body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw,
      headers: new Headers(init?.headers),
    };
    calls.push(request);

    const route = routes.find(
      (candidate) =>
        (candidate.method ?? "GET") === method &&
        (typeof candidate.path === "string" ? candidate.path === url.pathname : candidate.path.test(url.pathname)),
    );
    if (!route) throw new Error(`Незамоканный запрос: ${method} ${url.pathname}`);
    // Исключение из handle пробрасывается как есть: так имитируется сбой сети и отмена запроса.
    return toResponse(route.handle ? route.handle(request) : route.reply);
  });

  vi.stubGlobal("fetch", fn);
  return {
    fn,
    calls,
    callsTo: (method: string, path: string | RegExp) =>
      calls.filter((call) => call.method === method && (typeof path === "string" ? call.path === path : path.test(call.path))),
  };
}
