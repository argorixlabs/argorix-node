import { ArgorixError } from "./errors.js";
import { HttpTransport, type StreamEvent } from "./transport.js";
import type {
  AgentEvaluatePayload,
  AgentEvaluation,
  AgentEventPayload,
  AgentInitPayload,
  AgentRegistration,
  ControlAction,
  ControlMatch,
} from "./types.js";
import { SDK_VERSION } from "./version.js";

export const AGENTS_API_PREFIX = "/v1/agent-guardrails/runtime";

export type ArgorixAgentsClientOptions = {
  baseUrl: string;
  appNumber: number;
  appApiKey: string;
  timeoutMs?: number;
  defaultPolicyId?: string | null;
  maxRetries?: number;
  retryBackoffMs?: number;
  retryStatusCodes?: number[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toControlMatch(payload: Record<string, unknown>): ControlMatch {
  const metadata = asRecord(payload.metadata);
  const steering = metadata.steering_message;
  return {
    controlId: String(payload.control_id ?? ""),
    controlName: String(payload.control_name ?? ""),
    action: String(payload.action ?? "allow") as ControlAction,
    evaluatorName: String(payload.evaluator_name ?? ""),
    selectorPath: String(payload.selector_path ?? ""),
    matched: Boolean(payload.matched),
    confidence: Number(payload.confidence ?? 0),
    message: typeof payload.message === "string" ? payload.message : null,
    error: typeof payload.error === "string" ? payload.error : null,
    metadata,
    steeringMessage: typeof steering === "string" && steering ? steering : null,
  };
}

function toMatchList(value: unknown): ControlMatch[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").map((item) => toControlMatch(item as Record<string, unknown>))
    : [];
}

export function toAgentEvaluation(payload: Record<string, unknown>): AgentEvaluation {
  const allowed = payload.allowed === undefined ? true : Boolean(payload.allowed);
  return {
    overallDecision: String(payload.overall_decision ?? "allow") as ControlAction,
    allowed,
    denied: !allowed,
    requiresSteering: Boolean(payload.requires_steering),
    confidence: Number(payload.confidence ?? 0),
    evaluatedControls: Number(payload.evaluated_controls ?? 0),
    matches: toMatchList(payload.matches),
    nonMatches: toMatchList(payload.non_matches),
    errors: toMatchList(payload.errors),
    raw: payload,
  };
}

export function toAgentRegistration(payload: Record<string, unknown>): AgentRegistration {
  const agent = asRecord(payload.agent);
  return {
    created: Boolean(payload.created),
    agentName: String(agent.agent_name ?? ""),
    agent,
    controls: Array.isArray(payload.controls)
      ? (payload.controls.filter((item) => item && typeof item === "object") as Record<string, unknown>[])
      : [],
    raw: payload,
  };
}

/**
 * Client for the Argorix agent guardrails runtime: agent registration, control
 * resolution, step evaluation (buffered and streamed) and runtime events.
 */
export class ArgorixAgentsClient {
  private readonly transport: HttpTransport;
  readonly appNumber: number;
  readonly defaultPolicyId: string | null;

  constructor(options: ArgorixAgentsClientOptions) {
    this.transport = new HttpTransport({
      baseUrl: options.baseUrl,
      appApiKey: options.appApiKey,
      userAgent: `argorix-agents-node/${SDK_VERSION}`,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryBackoffMs: options.retryBackoffMs,
      retryStatusCodes: options.retryStatusCodes,
    });
    this.appNumber = Number(options.appNumber);
    this.defaultPolicyId = options.defaultPolicyId ?? null;
  }

  get baseUrl(): string {
    return this.transport.baseUrl;
  }

  /** Register or refresh a runtime-visible agent definition. */
  async initAgent(payload: AgentInitPayload): Promise<AgentRegistration> {
    const response = await this.transport.requestJson(
      "POST",
      `${AGENTS_API_PREFIX}/agents/init`,
      {
        app_number: this.appNumber,
        agent_name: payload.agentName,
        agent_description: payload.agentDescription ?? null,
        agent_version: payload.agentVersion ?? null,
        agent_metadata: payload.agentMetadata ?? {},
        steps: payload.steps ?? [],
        evaluators: payload.evaluators ?? [],
      },
    );
    return toAgentRegistration(response);
  }

  /** List the agent guardrail controls bound to `agentName`. */
  async listAgentControls(
    agentName: string,
    options: { policyId?: string | null } = {},
  ): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ app_number: String(this.appNumber) });
    const policyId = options.policyId ?? this.defaultPolicyId;
    if (policyId) {
      query.set("policy_id", policyId);
    }
    return this.transport.requestJson(
      "GET",
      `${AGENTS_API_PREFIX}/agents/${encodeURIComponent(agentName)}/controls?${query.toString()}`,
    );
  }

  private evaluateBody(payload: AgentEvaluatePayload): Record<string, unknown> {
    return {
      app_number: this.appNumber,
      agent_name: payload.agentName,
      policy_id: payload.policyId ?? this.defaultPolicyId,
      control_ids: payload.controlIds ?? [],
      stage: payload.stage,
      step: {
        type: payload.step.type,
        name: payload.step.name,
        input: payload.step.input,
        output: payload.step.output ?? null,
        context: payload.step.context ?? null,
      },
      trace_id: payload.traceId ?? null,
      span_id: payload.spanId ?? null,
      metadata: payload.metadata ?? {},
    };
  }

  /** Evaluate one agentic step against the bound agent guardrail controls. */
  async evaluate(payload: AgentEvaluatePayload): Promise<AgentEvaluation> {
    const response = await this.transport.requestJson(
      "POST",
      `${AGENTS_API_PREFIX}/evaluate`,
      this.evaluateBody(payload),
    );
    return toAgentEvaluation(response);
  }

  /** Stream a step evaluation over SSE (`start`, `result`, `end`, `error`). */
  evaluateStream(payload: AgentEvaluatePayload): AsyncGenerator<StreamEvent, void, unknown> {
    return this.transport.streamSse(
      `${AGENTS_API_PREFIX}/evaluate/stream`,
      this.evaluateBody(payload),
    );
  }

  /**
   * Consume {@link ArgorixAgentsClient.evaluateStream} and return the final evaluation.
   * Rejects with {@link ArgorixError} on an `error` event or a missing `result`.
   */
  async evaluateStreamedResult(payload: AgentEvaluatePayload): Promise<AgentEvaluation> {
    for await (const event of this.evaluateStream(payload)) {
      if (event.event === "error") {
        const code = Number(event.data.code);
        throw new ArgorixError(String(event.data.detail ?? "Agent guardrails stream failed"), {
          statusCode: Number.isFinite(code) ? code : undefined,
        });
      }
      if (event.event === "result") {
        return toAgentEvaluation(event.data);
      }
    }
    throw new ArgorixError("Agent guardrails stream ended before emitting a result event.");
  }

  /** Record an agent runtime event keyed by trace and span identifiers. */
  async recordEvent(payload: AgentEventPayload): Promise<Record<string, unknown>> {
    return this.transport.requestJson("POST", `${AGENTS_API_PREFIX}/events`, {
      app_number: this.appNumber,
      agent_name: payload.agentName,
      event_type: payload.eventType,
      step_type: payload.stepType ?? null,
      step_name: payload.stepName ?? null,
      stage: payload.stage ?? null,
      trace_id: payload.traceId ?? null,
      span_id: payload.spanId ?? null,
      decision: payload.decision ?? null,
      allowed: payload.allowed ?? null,
      duration_ms: payload.durationMs ?? null,
      matches_total: payload.matchesTotal ?? 0,
      errors_total: payload.errorsTotal ?? 0,
      metadata: payload.metadata ?? {},
    });
  }
}
