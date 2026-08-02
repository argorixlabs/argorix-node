import { ArgorixError } from "./errors.js";
import { HttpTransport, type StreamEvent } from "./transport.js";
import type {
  ApplyPayload,
  GuardrailsConfig,
  GuardrailsDecision,
  GuardrailsEngine,
  GuardrailsEvaluation,
  GuardrailsFinding,
  GuardrailsMode,
  GuardrailsStage,
  GuardrailsState,
  HeartbeatPayload,
  InstallPayload,
  RedteamProbePayload,
  RuntimeEventPayload,
  SdkTelemetry,
} from "./types.js";
import { SDK_VERSION } from "./version.js";

export const API_PREFIX = "/v1";

export type ArgorixClientOptions = {
  baseUrl: string;
  appNumber: number;
  appApiKey: string;
  timeoutMs?: number;
  defaultPolicyId?: string | null;
  maxRetries?: number;
  retryBackoffMs?: number;
  retryStatusCodes?: number[];
};

function readEnv(names: string[]): string | undefined {
  // Read through globalThis so the package still type-checks (and runs) on edge
  // runtimes that have no `process`.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (!env) {
    return undefined;
  }
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

const SEVERITY_PRIORITY: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Highest severity across `findings`, or null when there are none. */
export function highestSeverity(findings: GuardrailsFinding[]): string | null {
  let highest: string | null = null;
  let highestScore = 0;
  for (const finding of findings) {
    const score = SEVERITY_PRIORITY[String(finding.severity).toLowerCase()] ?? 0;
    if (score > highestScore) {
      highest = finding.severity;
      highestScore = score;
    }
  }
  return highest;
}

export function toGuardrailsDecision(
  payload: Record<string, unknown>,
  fallbackText = "",
): GuardrailsDecision {
  const guardrailsConfig = asRecord(payload.guardrails_config) as GuardrailsConfig;
  const allowed = payload.allowed === undefined ? true : Boolean(payload.allowed);
  return {
    allowed,
    blocked: !allowed,
    outputText: typeof payload.output_text === "string" ? payload.output_text : fallbackText,
    mode: String(payload.mode ?? guardrailsConfig.mode ?? "monitor") as GuardrailsMode,
    findings: Array.isArray(payload.findings) ? (payload.findings as GuardrailsFinding[]) : [],
    evaluations: Array.isArray(payload.evaluations)
      ? (payload.evaluations as GuardrailsEvaluation[])
      : [],
    selectedValidators: Array.isArray(payload.selected_validators)
      ? payload.selected_validators.map((item) => String(item))
      : [],
    effectiveScope: asRecord(payload.effective_scope),
    guardrailsConfig,
    guardrailsEngine: asString(payload.guardrails_engine) as GuardrailsEngine | null,
    stage: asString(payload.stage) as GuardrailsStage | null,
    applicationId: asString(payload.application_id),
    appNumber: asNumber(payload.app_number),
    repository: asString(payload.repository),
    serverTime: asString(payload.server_time),
    raw: payload,
  };
}

export function toGuardrailsState(payload: Record<string, unknown>): GuardrailsState {
  const guardrailsConfig = asRecord(payload.guardrails_config) as GuardrailsConfig;
  return {
    applicationId: asString(payload.application_id),
    appNumber: asNumber(payload.app_number),
    repository: asString(payload.repository),
    installationConnected: Boolean(payload.installation_connected),
    guardrailsConfig,
    effectiveScope: asRecord(payload.effective_scope),
    selectedValidators: Array.isArray(payload.selected_validators)
      ? payload.selected_validators.map((item) => String(item))
      : [],
    mode: String(guardrailsConfig.mode ?? "monitor") as GuardrailsMode,
    enabled: Boolean(guardrailsConfig.enabled),
    serverTime: asString(payload.server_time),
    raw: payload,
  };
}

/**
 * Client for the Argorix classic guardrails runtime.
 *
 * Authenticates with an application API key and the six-digit `appNumber` of the AI
 * application registered in the Argorix control plane.
 */
export class ArgorixClient {
  private readonly transport: HttpTransport;
  readonly appNumber: number;
  readonly defaultPolicyId: string | null;

  private requestsTotal = 0;
  private blockedTotal = 0;
  private latencyMsAcc = 0;

  constructor(options: ArgorixClientOptions) {
    this.transport = new HttpTransport({
      baseUrl: options.baseUrl,
      appApiKey: options.appApiKey,
      userAgent: `argorix-node/${SDK_VERSION}`,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryBackoffMs: options.retryBackoffMs,
      retryStatusCodes: options.retryStatusCodes,
    });
    this.appNumber = Number(options.appNumber);
    this.defaultPolicyId = options.defaultPolicyId ?? null;
  }

  /**
   * Build a client from `ARGORIX_API_URL`, `ARGORIX_APP_NUMBER` and
   * `ARGORIX_APP_API_KEY`. Explicit options win over the environment.
   */
  static fromEnv(options: Partial<ArgorixClientOptions> = {}): ArgorixClient {
    const baseUrl =
      options.baseUrl ?? readEnv(["ARGORIX_API_URL", "ARGORIX_BASE_URL", "GOVERNANCE_AI_URL"]);
    if (!baseUrl) {
      throw new ArgorixError("baseUrl is required. Pass it explicitly or set ARGORIX_API_URL.");
    }
    const appNumber = options.appNumber ?? Number(readEnv(["ARGORIX_APP_NUMBER", "APP_NUMBER"]));
    if (!appNumber || Number.isNaN(appNumber)) {
      throw new ArgorixError(
        "appNumber is required. Pass it explicitly or set ARGORIX_APP_NUMBER.",
      );
    }
    const appApiKey = options.appApiKey ?? readEnv(["ARGORIX_APP_API_KEY", "APP_API_KEY"]);
    if (!appApiKey) {
      throw new ArgorixError(
        "appApiKey is required. Pass it explicitly or set ARGORIX_APP_API_KEY.",
      );
    }
    return new ArgorixClient({
      ...options,
      baseUrl,
      appNumber,
      appApiKey,
      defaultPolicyId: options.defaultPolicyId ?? readEnv(["ARGORIX_POLICY_ID"]) ?? null,
    });
  }

  get baseUrl(): string {
    return this.transport.baseUrl;
  }

  /** Counters accumulated since this client was created. */
  get telemetry(): SdkTelemetry {
    const avgLatency = this.requestsTotal > 0 ? this.latencyMsAcc / this.requestsTotal : 0;
    return {
      requests_total: this.requestsTotal,
      blocked_total: this.blockedTotal,
      avg_latency_ms: Math.round(avgLatency * 1000) / 1000,
      sdk_version: SDK_VERSION,
      runtime: "node",
    };
  }

  resetTelemetry(): void {
    this.requestsTotal = 0;
    this.blockedTotal = 0;
    this.latencyMsAcc = 0;
  }

  /** Enroll this runtime and return the active validator selection and scope. */
  async install(payload: InstallPayload = {}): Promise<GuardrailsState> {
    const response = await this.transport.requestJson("POST", `${API_PREFIX}/guardrails/install`, {
      app_number: this.appNumber,
      mode: payload.mode ?? "monitor",
      metadata: payload.metadata ?? {},
    });
    return toGuardrailsState(response);
  }

  /** Refresh the installation and pull the currently effective configuration. */
  async heartbeat(payload: HeartbeatPayload = {}): Promise<GuardrailsState> {
    const response = await this.transport.requestJson("POST", `${API_PREFIX}/guardrails/heartbeat`, {
      app_number: this.appNumber,
      policy_id: payload.policyId ?? this.defaultPolicyId,
      mode: payload.mode,
      telemetry: (payload.includeTelemetry ?? true) ? this.telemetry : undefined,
    });
    return toGuardrailsState(response);
  }

  private evaluateBody(text: string, payload: ApplyPayload): Record<string, unknown> {
    return {
      app_number: this.appNumber,
      policy_id: payload.policyId ?? this.defaultPolicyId,
      mode: payload.mode,
      stage: payload.stage ?? "input",
      text,
      tool_calls: (payload.toolCalls ?? []).map((item) => ({
        tool_name: item.toolName ?? null,
        domain: item.domain ?? null,
        url: item.url ?? null,
      })),
      metadata: payload.metadata ?? {},
      telemetry: (payload.includeTelemetry ?? true) ? this.telemetry : undefined,
    };
  }

  private recordDecisionTelemetry(allowed: boolean, startedAt: number): void {
    this.requestsTotal += 1;
    if (!allowed) {
      this.blockedTotal += 1;
    }
    this.latencyMsAcc += Date.now() - startedAt;
  }

  /** Evaluate text (and optional tool calls) against the active guardrails. */
  async evaluate(text: string, payload: ApplyPayload = {}): Promise<GuardrailsDecision> {
    const started = Date.now();
    const response = await this.transport.requestJson(
      "POST",
      `${API_PREFIX}/guardrails/evaluate`,
      this.evaluateBody(text, payload),
    );
    const decision = toGuardrailsDecision(response, text);
    this.recordDecisionTelemetry(decision.allowed, started);
    return decision;
  }

  /** @deprecated Pre-0.2 name for {@link ArgorixClient.evaluate}. */
  async apply(text: string, payload: ApplyPayload = {}): Promise<GuardrailsDecision> {
    return this.evaluate(text, payload);
  }

  /**
   * Stream an evaluation over SSE, yielding `start`, `result`, `end` or `error`.
   * Nothing is sent until the async iterator is consumed.
   */
  async *evaluateStream(
    text: string,
    payload: ApplyPayload = {},
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const started = Date.now();
    let recorded = false;
    const events = this.transport.streamSse(
      `${API_PREFIX}/guardrails/evaluate/stream`,
      this.evaluateBody(text, payload),
    );
    for await (const event of events) {
      if (event.event === "result" && !recorded) {
        recorded = true;
        this.recordDecisionTelemetry(
          event.data.allowed === undefined ? true : Boolean(event.data.allowed),
          started,
        );
      }
      yield event;
    }
  }

  /**
   * Consume {@link ArgorixClient.evaluateStream} and return the final decision.
   * Rejects with {@link ArgorixError} on an `error` event or a missing `result`.
   */
  async evaluateStreamedDecision(
    text: string,
    payload: ApplyPayload = {},
  ): Promise<GuardrailsDecision> {
    for await (const event of this.evaluateStream(text, payload)) {
      if (event.event === "error") {
        const code = Number(event.data.code);
        throw new ArgorixError(String(event.data.detail ?? "Guardrails stream failed"), {
          statusCode: Number.isFinite(code) ? code : undefined,
        });
      }
      if (event.event === "result") {
        return toGuardrailsDecision(event.data, text);
      }
    }
    throw new ArgorixError("Guardrails stream ended before emitting a result event.");
  }

  /** Record a runtime guardrail event for telemetry and audit trails. */
  async recordEvent(payload: RuntimeEventPayload): Promise<Record<string, unknown>> {
    return this.transport.requestJson("POST", `${API_PREFIX}/guardrails/events`, {
      app_number: this.appNumber,
      event_type: payload.eventType,
      event_name: payload.eventName ?? null,
      redteam_session_id: payload.redteamSessionId ?? null,
      strategy_id: payload.strategyId ?? null,
      plugin_id: payload.pluginId ?? null,
      target_route: payload.targetRoute ?? null,
      blocked: payload.blocked ?? null,
      findings_total: payload.findingsTotal ?? null,
      latency_ms: payload.latencyMs ?? null,
      metadata: payload.metadata ?? {},
    });
  }

  /** Record a red-team probe event. */
  async reportRedteamProbe(payload: RedteamProbePayload = {}): Promise<Record<string, unknown>> {
    return this.recordEvent({ eventType: "redteam_probe", ...payload });
  }
}

/** @deprecated Pre-0.2 name for {@link ArgorixClient}. */
export const GovernanceAIClient = ArgorixClient;
/** @deprecated Pre-0.2 name for {@link ArgorixClient}. */
export const GovernanceGuardrailsClient = ArgorixClient;
/** @deprecated Pre-0.2 name for {@link ArgorixClientOptions}. */
export type GovernanceGuardrailsClientOptions = ArgorixClientOptions;
