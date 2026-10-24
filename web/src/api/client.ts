import { ApiError, NETWORK_MESSAGE, isAbortError, normalizeErrorBody } from "./errors";
import type {
  AdviceResult,
  AnalyzeRequest,
  AnalyzeResponse,
  AssessmentRequest,
  AssessmentResult,
  AssessmentSummary,
  AssumptionsOverride,
  AuditEvent,
  Catalog,
  EvalDemo,
  Health,
  LintResult,
  Meta,
  Policy,
  PromptList,
  PromptTemplate,
  RenderedPrompt,
  StoredAssessment,
  UploadResponse,
  Workload,
} from "./types";

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** Тело JSON. */
  json?: unknown;
  /** Тело multipart. */
  form?: FormData;
  query?: Query;
  signal?: AbortSignal;
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", json, form, query, signal } = options;
  const init: RequestInit = { method, signal };
  if (json !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(json);
  } else if (form) {
    init.body = form;
  }

  let response: Response;
  try {
    response = await fetch(withQuery(path, query), init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(NETWORK_MESSAGE, 0);
  }

  if (!response.ok) {
    throw normalizeErrorBody(await readErrorBody(response), response.status);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("Сервер вернул ответ в неожиданном формате", response.status);
  }
}

// --- служебные ---------------------------------------------------------------------------------

export const getHealth = (signal?: AbortSignal) => request<Health>("/api/health", { signal });
export const getMeta = (signal?: AbortSignal) => request<Meta>("/api/meta", { signal });
export const getCatalog = (signal?: AbortSignal) => request<Catalog>("/api/catalog", { signal });

export const getAudit = (limit = 100, kind?: string, signal?: AbortSignal) =>
  request<{ events: AuditEvent[] }>("/api/audit", { query: { limit, kind }, signal }).then((r) => r.events);

// --- подбор моделей ----------------------------------------------------------------------------

export const advise = (workload: Workload, top = 5, signal?: AbortSignal) =>
  request<AdviceResult>("/api/advice", { method: "POST", json: workload, query: { top }, signal });

// --- оценка процессов --------------------------------------------------------------------------

export const assess = (body: AssessmentRequest, signal?: AbortSignal) =>
  request<AssessmentResult>("/api/assess", { method: "POST", json: body, signal });

export const createAssessment = (body: AssessmentRequest, signal?: AbortSignal) =>
  request<StoredAssessment>("/api/assessments", { method: "POST", json: body, signal });

export const createDemoAssessment = (signal?: AbortSignal) =>
  request<UploadResponse>("/api/assessments/demo", { method: "POST", signal });

export function uploadAssessment(
  file: File,
  options: { name?: string; assumptions?: AssumptionsOverride } = {},
  signal?: AbortSignal,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  if (options.name) form.append("name", options.name);
  if (options.assumptions) form.append("assumptions", JSON.stringify(options.assumptions));
  return request<UploadResponse>("/api/assessments/upload", { method: "POST", form, signal });
}

export const listAssessments = (limit = 50, signal?: AbortSignal) =>
  request<AssessmentSummary[]>("/api/assessments", { query: { limit }, signal });

export const getAssessment = (id: string, signal?: AbortSignal) =>
  request<StoredAssessment>(`/api/assessments/${encodeURIComponent(id)}`, { signal });

export const deleteAssessment = (id: string, signal?: AbortSignal) =>
  request<undefined>(`/api/assessments/${encodeURIComponent(id)}`, { method: "DELETE", signal });

export const SAMPLE_CSV_URL = "/api/samples/processes.csv";
export const reportUrl = (id: string) => `/api/assessments/${encodeURIComponent(id)}/report.md`;
export const exportUrl = (id: string) => `/api/assessments/${encodeURIComponent(id)}/export.csv`;

// --- безопасность данных -----------------------------------------------------------------------

export const analyzeText = (body: AnalyzeRequest, signal?: AbortSignal) =>
  request<AnalyzeResponse>("/api/safety/analyze", { method: "POST", json: body, signal });

export const unmaskText = (text: string, mapping: Record<string, string>, signal?: AbortSignal) =>
  request<{ text: string }>("/api/safety/unmask", { method: "POST", json: { text, mapping }, signal }).then(
    (r) => r.text,
  );

export const getPolicy = (signal?: AbortSignal) => request<Policy>("/api/safety/policy", { signal });

// --- промпты -----------------------------------------------------------------------------------

export const listPrompts = (department?: string, signal?: AbortSignal) =>
  request<PromptList>("/api/prompts", { query: { department }, signal });

export const getPrompt = (id: string, signal?: AbortSignal) =>
  request<PromptTemplate>(`/api/prompts/${encodeURIComponent(id)}`, { signal });

export const renderPrompt = (id: string, values: Record<string, string>, signal?: AbortSignal) =>
  request<RenderedPrompt>(`/api/prompts/${encodeURIComponent(id)}/render`, {
    method: "POST",
    json: { values },
    signal,
  });

export const lintPrompt = (text: string, signal?: AbortSignal) =>
  request<LintResult>("/api/prompts/lint", { method: "POST", json: { text }, signal });

export const scaffoldPrompt = (task: string, role?: string, signal?: AbortSignal) =>
  request<{ text: string }>("/api/prompts/scaffold", {
    method: "POST",
    json: role ? { task, role } : { task },
    signal,
  }).then((r) => r.text);

// --- качество моделей --------------------------------------------------------------------------

export const getEvalDemo = (signal?: AbortSignal) => request<EvalDemo>("/api/evals/demo", { signal });
