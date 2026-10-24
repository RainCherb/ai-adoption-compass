import type { components } from "./schema";

type S = components["schemas"];
export type ModelOption = S["ModelOption"];
export type ModelComparisonRequest = S["ModelComparisonRequest"];
export type ModelComparison = S["ModelComparison"];

export type Sensitivity = S["Sensitivity"];
export type Deployment = S["Deployment"];
export type Action = S["Action"];
export type TaskType = S["TaskType"];
export type Preference = S["Preference"];
export type Quadrant = S["Quadrant"];
export type Severity = S["Severity"];
export type Tier = S["Tier"];
export type RuAccess = S["RuAccess"];

export type Health = S["HealthResponse"];
export type OptionOut = S["OptionOut"];
export type SensitivityOut = S["SensitivityOut"];
export type TaskTypeOut = S["TaskTypeOut"];

export type Assumptions = S["Assumptions"];
export type AssumptionsOverride = S["AssumptionsOverride"];
export type Process = S["Process"];
export type ProcessResult = S["ProcessResult"];
export type PortfolioSummary = S["PortfolioSummary"];
export type InfraLine = S["InfraLine"];
export type RoadmapWave = S["RoadmapWave"];
export type ScenarioResult = S["ScenarioResult"];
export type Flag = S["Flag"];
export type ModelPick = S["ModelPick"];
export type CostBreakdown = S["CostBreakdown"];
export type AssessmentRequest = S["AssessmentRequest"];
export type AssessmentResult = S["AssessmentResult"];
export type StoredAssessment = S["StoredAssessmentOut"];
export type UploadResponse = S["UploadResponse"];
export type RowError = S["RowError"];

export type Workload = S["Workload"];
export type AdviceResult = S["AdviceResult"];
export type Recommendation = S["Recommendation"];
export type Exclusion = S["Exclusion"];
export type ScoreBreakdown = S["ScoreBreakdown"];

export type AnalyzeRequest = S["AnalyzeRequest"];
export type AnalyzeResponse = S["AnalyzeResponse"];
export type Finding = S["FindingOut"];
export type Decision = S["Decision"];
export type Policy = S["PolicyOut"];

export type PromptTemplate = S["PromptTemplate"];
export type PromptVariable = S["PromptVariable"];
export type RenderedPrompt = S["RenderedPrompt"];
export type LintResult = S["LintResult"];
export type LintCheck = S["LintCheck"];

export type EvalDemo = S["EvalDemoResponse"];
export type EvalReport = S["EvalReport"];
export type EvalTask = S["EvalTaskOut"];
export type ClassStats = S["ClassStats"];
export type EvalFailure = S["Failure"];

export type AuditEvent = S["EventOut"];

/** В схеме эти ответы описаны как `object`, поэтому формы уточнены вручную по бэкенду. */
export interface MetaCatalog {
  as_of: string;
  data_status: string;
  disclaimer: string;
}

export type Meta = Omit<S["MetaResponse"], "default_assumptions" | "catalog"> & {
  default_assumptions: Assumptions;
  catalog: MetaCatalog;
};

export interface CatalogPricing {
  currency: "RUB" | "USD";
  input_per_mtok: number;
  output_per_mtok: number;
  fixed_monthly: number;
  capacity_mtok_month: number | null;
}

export interface CatalogModel {
  profile?: S["FeaturedModel"] | null;
  id: string;
  name: string;
  vendor: string;
  family: string;
  tier: Tier;
  deployment: Deployment;
  origin: string;
  ru_access: RuAccess;
  pricing: CatalogPricing;
  context_window: number;
  vision: boolean;
  tool_calling: boolean;
  quality: Record<TaskType, number>;
  strengths: string[];
  limitations: string[];
  pricing_url: string | null;
  reviewed_at: string;
  notes: string | null;
}

export interface StaleEntry {
  id: string;
  name: string;
  reviewed_at: string;
  age_days: number;
}

export interface Catalog extends MetaCatalog {
  usd_rub: number;
  stale: StaleEntry[];
  models: CatalogModel[];
}

export interface AssessmentSummary {
  id: string;
  name: string;
  created_at: string;
  processes_count: number;
  recommended_count: number;
  hours_saved_month: number;
  net_horizon_rub: number;
}

export interface PromptList {
  departments: string[];
  templates: PromptTemplate[];
}
