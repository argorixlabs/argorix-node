export type GuardrailsMode = "monitor" | "enforce";
export type GuardrailsStage = "input" | "output" | "tool";
export type GuardrailsSeverity = "low" | "medium" | "high" | "critical";
export type GuardrailsEngine = "traditional_guardrails" | "ai_agent_guardrails";

export type GuardrailsFinding = {
  type: string;
  severity: GuardrailsSeverity;
  rule_id: string;
  evidence: string;
  evaluation_engine?: string | null;
};

export type GuardrailsEvaluation = {
  id: string;
  title: string;
  flagged: boolean;
  severity: GuardrailsSeverity;
  reason: string;
  evaluation_engine?: string | null;
};

export type EffectiveScope = {
  scope_type?: string;
  scope_id?: string | null;
  [key: string]: unknown;
};

export type GuardrailsConfig = Record<string, unknown>;

/** What to do with the text. `transform` allows, but the text changed. */
export type GuardrailsDecisionKind = "allow" | "transform" | "deny";

/**
 * Why the evaluation ended where it did. A policy that never ran and a policy
 * that ran and found nothing both allow; only this tells them apart.
 */
export type GuardrailsOutcome =
  | "policy_match"
  | "policy_not_applicable"
  | "evaluator_error"
  | "authentication_error"
  | "configuration_error";

/** A validator that could not answer. Never a finding. */
export type GuardrailsEvaluatorError = {
  id: string;
  title: string;
  reason: string;
  evaluation_engine?: string | null;
};

export type GuardrailsDecision = {
  allowed: boolean;
  blocked: boolean;
  outputText: string;
  mode: GuardrailsMode;
  findings: GuardrailsFinding[];
  evaluations: GuardrailsEvaluation[];
  selectedValidators: string[];
  effectiveScope: EffectiveScope;
  guardrailsConfig: GuardrailsConfig;
  guardrailsEngine: GuardrailsEngine | null;
  stage: GuardrailsStage | null;
  applicationId: string | null;
  appNumber: number | null;
  repository: string | null;
  serverTime: string | null;
  decision: GuardrailsDecisionKind;
  outcome: GuardrailsOutcome;
  reasonCode: string;
  reason: string;
  eventId: string;
  requestId: string;
  /** True only when a denial came from an evaluator failure under a fail-closed policy. */
  failClosed: boolean;
  /** True when the evaluation completed with less engine than configured. */
  degraded: boolean;
  errors: GuardrailsEvaluatorError[];
  /** Signed record of the decision, when the server attached one. */
  runtimeEvidence: Record<string, unknown> | null;
  /** The untouched API payload, so fields added later stay reachable. */
  raw: Record<string, unknown>;
};

export type GuardrailsState = {
  applicationId: string | null;
  appNumber: number | null;
  repository: string | null;
  installationConnected: boolean;
  guardrailsConfig: GuardrailsConfig;
  effectiveScope: EffectiveScope;
  selectedValidators: string[];
  mode: GuardrailsMode;
  enabled: boolean;
  serverTime: string | null;
  raw: Record<string, unknown>;
};

export type GuardrailsToolCall = {
  toolName?: string | null;
  domain?: string | null;
  url?: string | null;
};

export type RuntimeEventMetadataValue = string | number | boolean | null;

export type InstallPayload = {
  mode?: GuardrailsMode;
  metadata?: Record<string, string>;
};

export type HeartbeatPayload = {
  policyId?: string | null;
  mode?: GuardrailsMode;
  includeTelemetry?: boolean;
};

export type ApplyPayload = {
  policyId?: string | null;
  mode?: GuardrailsMode;
  stage?: GuardrailsStage;
  toolCalls?: GuardrailsToolCall[];
  metadata?: Record<string, RuntimeEventMetadataValue>;
  includeTelemetry?: boolean;
  /** End-to-end correlation id. One is minted server-side when omitted. */
  requestId?: string;
  /**
   * Descriptive labels that travel into the signed evidence record and are
   * marked there as declared by the caller. None of them changes the verdict,
   * and none of them resolves Agent Guardrails controls.
   */
  agentId?: string;
  endpoint?: string;
  step?: { type?: string; name?: string };
  actor?: { type?: string; id?: string };
  model?: { provider?: string; name?: string };
  /** Ask for the signed evidence even when the decision is a plain allow. */
  includeEvidence?: boolean;
};

export type RuntimeEventPayload = {
  eventType: string;
  eventName?: string | null;
  redteamSessionId?: string | null;
  strategyId?: string | null;
  pluginId?: string | null;
  targetRoute?: string | null;
  blocked?: boolean | null;
  findingsTotal?: number | null;
  latencyMs?: number | null;
  metadata?: Record<string, RuntimeEventMetadataValue>;
};

export type RedteamProbePayload = Omit<RuntimeEventPayload, "eventType">;

export type SdkTelemetry = {
  requests_total: number;
  blocked_total: number;
  avg_latency_ms: number;
  sdk_version: string;
  runtime: string;
};

// -- agent guardrails ---------------------------------------------------------

export type ControlAction = "allow" | "deny" | "steer" | "warn" | "log";
export type AgentStage = "pre" | "post";

export type AgentStep = {
  type: string;
  name: string;
  input: unknown;
  output?: unknown;
  context?: Record<string, unknown> | null;
};

export type ControlMatch = {
  controlId: string;
  controlName: string;
  action: ControlAction;
  evaluatorName: string;
  selectorPath: string;
  matched: boolean;
  confidence: number;
  message: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  steeringMessage: string | null;
};

export type AgentEvaluation = {
  overallDecision: ControlAction;
  allowed: boolean;
  denied: boolean;
  requiresSteering: boolean;
  confidence: number;
  evaluatedControls: number;
  matches: ControlMatch[];
  nonMatches: ControlMatch[];
  errors: ControlMatch[];
  raw: Record<string, unknown>;
};

export type AgentRegistration = {
  created: boolean;
  agentName: string;
  agent: Record<string, unknown>;
  controls: Record<string, unknown>[];
  raw: Record<string, unknown>;
};

export type AgentInitPayload = {
  agentName: string;
  agentDescription?: string | null;
  agentVersion?: string | null;
  agentMetadata?: Record<string, unknown>;
  steps?: Record<string, unknown>[];
  evaluators?: Record<string, unknown>[];
};

export type AgentEvaluatePayload = {
  agentName: string;
  stage: AgentStage;
  step: AgentStep;
  policyId?: string | null;
  controlIds?: string[];
  traceId?: string | null;
  spanId?: string | null;
  metadata?: Record<string, unknown>;
};

export type AgentEventPayload = {
  agentName: string;
  eventType: string;
  stepType?: string | null;
  stepName?: string | null;
  stage?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  decision?: string | null;
  allowed?: boolean | null;
  durationMs?: number | null;
  matchesTotal?: number;
  errorsTotal?: number;
  metadata?: Record<string, unknown>;
};
