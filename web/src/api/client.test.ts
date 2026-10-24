import { describe, expect, it } from "vitest";
import { MockReply, mockFetch, reply } from "../test/mockFetch";
import {
  advise,
  createDemoAssessment,
  deleteAssessment,
  getAssessment,
  getAudit,
  getHealth,
  scaffoldPrompt,
  uploadAssessment,
} from "./client";
import { ApiError, NETWORK_MESSAGE } from "./errors";
import { advice, health } from "../test/fixtures";

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Ожидалась ошибка ApiError");
}

describe("API-клиент: успешные запросы", () => {
  it("возвращает разобранный JSON", async () => {
    const api = mockFetch([{ path: "/api/health", reply: health }]);
    await expect(getHealth()).resolves.toEqual(health);
    expect(api.calls[0]?.method).toBe("GET");
  });

  it("POST отправляет JSON-тело и параметр top в строке запроса", async () => {
    const api = mockFetch([{ method: "POST", path: "/api/advice", reply: advice }]);
    const result = await advise(advice.workload, 7);
    expect(result.recommendations).toHaveLength(2);
    const [call] = api.calls;
    expect(call?.search.get("top")).toBe("7");
    expect(call?.headers.get("Content-Type")).toBe("application/json");
    expect(call?.body).toEqual(advice.workload);
  });

  it("не добавляет пустые параметры запроса", async () => {
    const api = mockFetch([{ path: "/api/audit", reply: { events: [] } }]);
    await getAudit(100, undefined);
    await getAudit(50, "safety.analyze");
    expect(api.calls[0]?.search.has("kind")).toBe(false);
    expect(api.calls[1]?.search.get("kind")).toBe("safety.analyze");
    expect(api.calls[1]?.search.get("limit")).toBe("50");
  });

  it("DELETE с ответом 204 завершается без тела", async () => {
    mockFetch([{ method: "DELETE", path: "/api/assessments/a%201", reply: reply(204) }]);
    await expect(deleteAssessment("a 1")).resolves.toBeUndefined();
  });

  it("роль в каркасе передаётся только если она задана", async () => {
    const api = mockFetch([{ method: "POST", path: "/api/prompts/scaffold", reply: { text: "каркас" } }]);
    await expect(scaffoldPrompt("Составить ответ")).resolves.toBe("каркас");
    await scaffoldPrompt("Составить ответ", "Юрист");
    expect(api.calls[0]?.body).toEqual({ task: "Составить ответ" });
    expect(api.calls[1]?.body).toEqual({ task: "Составить ответ", role: "Юрист" });
  });

  it("загрузка CSV уходит как multipart без ручного Content-Type", async () => {
    const api = mockFetch([{ method: "POST", path: "/api/assessments/upload", reply: reply(201, { assessment: {}, parse_errors: [] }) }]);
    const file = new File(["id,name\n"], "processes.csv", { type: "text/csv" });
    await uploadAssessment(file, { name: "Моя оценка", assumptions: { horizon_months: 6 } });
    const body = api.calls[0]?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect((form.get("file") as File).name).toBe("processes.csv");
    expect(form.get("name")).toBe("Моя оценка");
    expect(JSON.parse(form.get("assumptions") as string)).toEqual({ horizon_months: 6 });
    expect(api.calls[0]?.headers.has("Content-Type")).toBe(false);
  });
});

describe("API-клиент: нормализация ошибок", () => {
  it("строка в detail становится сообщением, статус сохраняется", async () => {
    mockFetch([{ path: "/api/assessments/x", reply: reply(404, { detail: "Оценка не найдена" }) }]);
    const error = await failure(getAssessment("x"));
    expect(error.message).toBe("Оценка не найдена");
    expect(error.status).toBe(404);
    expect(error.details).toEqual([]);
  });

  it("{message, errors} объединяется в одно читаемое сообщение, строки CSV получают номера", async () => {
    mockFetch([
      {
        method: "POST",
        path: "/api/assessments/demo",
        reply: reply(422, {
          detail: {
            message: "В файле нет ни одной корректной строки",
            errors: [{ line: 3, message: "task_type: неизвестное значение" }, "Не заполнено поле «Текст»"],
          },
        }),
      },
    ]);
    const error = await failure(createDemoAssessment());
    expect(error.summary).toBe("В файле нет ни одной корректной строки");
    expect(error.details).toEqual(["строка 3: task_type: неизвестное значение", "Не заполнено поле «Текст»"]);
    expect(error.message).toBe(
      "В файле нет ни одной корректной строки: строка 3: task_type: неизвестное значение; Не заполнено поле «Текст»",
    );
  });

  it("ошибки валидации FastAPI переводятся и привязываются к названиям полей", async () => {
    mockFetch([
      {
        method: "POST",
        path: "/api/advice",
        reply: reply(422, {
          detail: [
            { type: "greater_than", loc: ["body", "requests_per_month"], msg: "Input should be greater than 0", ctx: { gt: 0 } },
            { type: "enum", loc: ["body", "task_type"], msg: "Input should be 'classification'" },
            { type: "missing", loc: ["body", "processes", 0, "name"], msg: "Field required" },
            { type: "custom_rule", loc: ["query", "unknown"], msg: "Some English text" },
          ],
        }),
      },
    ]);
    const error = await failure(advise(advice.workload));
    expect(error.summary).toBe("Проверьте введённые данные");
    expect(error.details).toEqual([
      "Запросов в месяц: должно быть больше 0",
      "Тип задачи: недопустимое значение",
      "Процессы → №1 → Название: обязательное поле",
      "unknown: Some English text",
    ]);
    expect(error.status).toBe(422);
  });

  it("сбой сети превращается в понятное сообщение со статусом 0", async () => {
    mockFetch([
      {
        path: "/api/health",
        handle: () => {
          throw new TypeError("Failed to fetch");
        },
      },
    ]);
    const error = await failure(getHealth());
    expect(error.message).toBe(NETWORK_MESSAGE);
    expect(error.status).toBe(0);
  });

  it("не-JSON ответ (например, HTML от прокси) даёт общее сообщение по статусу", async () => {
    mockFetch([{ path: "/api/health", reply: new MockReply(502, "<html>Bad gateway</html>") }]);
    const error = await failure(getHealth());
    expect(error.status).toBe(502);
    expect(error.message).toContain("Ошибка сервера (HTTP 502)");
  });

  it("отмену запроса не оборачивает в ApiError", async () => {
    const controller = new AbortController();
    mockFetch([
      {
        path: "/api/health",
        handle: () => {
          throw new DOMException("Aborted", "AbortError");
        },
      },
    ]);
    controller.abort();
    await expect(getHealth(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
