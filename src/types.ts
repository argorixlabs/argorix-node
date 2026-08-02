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
