import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  ArgorixAgentsClient,
  ArgorixClient,
  ArgorixError,
  GovernanceAIClient,
  GovernanceAIError,
  GovernanceGuardrailsClient,
  highestSeverity,
  normalizeBaseUrl,
} from "../dist/index.js";

const EVALUATE_BODY = {
  application_id: "app_01",
  app_number: 123456,
  repository: "argorix/travel-bot",
  stage: "input",
  guardrails_engine: "traditional_guardrails",
  allowed: false,
  output_text: "safe output",
  findings: [
    {
      type: "prompt_injection",
      severity: "critical",
      rule_id: "prompt_injection",
      evidence: "Ignore previous instructions",
      evaluation_engine: "heuristic",
    },
  ],
  evaluations: [
    {
      id: "prompt_injection",
      title: "Prompt injection detection",
      flagged: true,
      severity: "critical",
      reason: "Detected instruction override language.",
      evaluation_engine: "heuristic",
    },
  ],
  guardrails_config: { enabled: true, mode: "enforce" },
  effective_scope: { scope_type: "application", scope_id: "app_01" },
  selected_validators: ["prompt_injection", "pii_detection"],
  mode: "enforce",
  server_time: "2026-08-01T14:15:22Z",
};

const DENY_AGENT_RESULT = {
  overall_decision: "deny",
  allowed: false,
  requires_steering: false,
  confidence: 0.99,
  evaluated_controls: 2,
  matches: [
    {
      control_id: "control-1",
      control_name: "Block SSN",
      action: "deny",
      evaluator_name: "regex",
      selector_path: "input",
      matched: true,
      confidence: 0.99,
      message: "Pattern matched.",
      error: null,
      metadata: { steering_message: "Ask for a case id instead." },
    },
  ],
  non_matches: [],
  errors: [],
};

/**
 * Start a stub control plane. Each queued response is either
 * `{status, body}` for JSON or `{sse: [[event, data], ...]}` for a stream.
 */
function startServer(responses) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method,
        path: req.url,
        headers: req.headers,
        payload: body ? JSON.parse(body) : {},
      });
      const next = responses.shift() ?? { status: 500, body: { detail: "missing response" } };
      if (next.sse) {
        const raw = next.sse
          .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          .join("");
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        res.end(raw);
        return;
      }
      const raw = JSON.stringify(next.body);
      res.writeHead(next.status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(raw),
      });
      res.end(raw);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, requests, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function buildClient(baseUrl, overrides = {}) {
  return new ArgorixClient({
    baseUrl,
    appNumber: 123456,
    appApiKey: "ax_live_test",
    maxRetries: 0,
    retryBackoffMs: 0,
    ...overrides,
  });
}

test("normalizeBaseUrl strips trailing slashes and a trailing /v1", () => {
  assert.equal(normalizeBaseUrl("https://api.argorix.com/"), "https://api.argorix.com");
  assert.equal(normalizeBaseUrl("https://api.argorix.com/v1/"), "https://api.argorix.com");
  assert.equal(normalizeBaseUrl("https://api.argorix.com"), "https://api.argorix.com");
});

test("highestSeverity picks the most severe finding", () => {
  assert.equal(highestSeverity([]), null);
  assert.equal(
    highestSeverity([{ severity: "low" }, { severity: "critical" }, { severity: "medium" }]),
    "critical",
  );
});

test("evaluate retries transient failures and sends auth and user-agent headers", async () => {
  const runtime = await startServer([
    { status: 503, body: { detail: "retry later" } },
    { status: 200, body: EVALUATE_BODY },
  ]);

  try {
    const client = buildClient(runtime.baseUrl, { maxRetries: 1 });
    const decision = await client.evaluate("hello world", { stage: "input" });

    assert.equal(decision.allowed, false);
    assert.equal(decision.blocked, true);
    assert.equal(decision.outputText, "safe output");
    assert.equal(decision.mode, "enforce");
    assert.equal(decision.applicationId, "app_01");
    assert.equal(decision.appNumber, 123456);
    assert.equal(decision.repository, "argorix/travel-bot");
    assert.equal(decision.guardrailsEngine, "traditional_guardrails");
    assert.equal(decision.evaluations[0].title, "Prompt injection detection");
    assert.equal(decision.raw.server_time, "2026-08-01T14:15:22Z");
    assert.equal(runtime.requests.length, 2);
    assert.equal(runtime.requests[0].path, "/v1/guardrails/evaluate");
    assert.equal(runtime.requests[0].headers.authorization, "Bearer ax_live_test");
    assert.match(runtime.requests[0].headers["user-agent"], /^argorix-node\//);
    assert.equal(runtime.requests[0].payload.app_number, 123456);
  } finally {
    runtime.server.close();
  }
});

test("apply remains an alias of evaluate", async () => {
  const runtime = await startServer([{ status: 200, body: EVALUATE_BODY }]);

  try {
    const client = buildClient(runtime.baseUrl);
    const decision = await client.apply("hello world", { stage: "output" });

    assert.equal(decision.allowed, false);
    assert.equal(runtime.requests[0].payload.stage, "output");
  } finally {
    runtime.server.close();
  }
});

test("a trailing /v1 in baseUrl does not duplicate the prefix", async () => {
  const runtime = await startServer([{ status: 200, body: EVALUATE_BODY }]);

  try {
    const client = buildClient(`${runtime.baseUrl}/v1`);
    await client.evaluate("hello world");

    assert.equal(runtime.requests[0].path, "/v1/guardrails/evaluate");
  } finally {
    runtime.server.close();
  }
});

test("telemetry counters accumulate and are sent upstream", async () => {
  const runtime = await startServer([
    { status: 200, body: EVALUATE_BODY },
    { status: 200, body: EVALUATE_BODY },
  ]);

  try {
    const client = buildClient(runtime.baseUrl);
    await client.evaluate("one");
    await client.evaluate("two");

    assert.equal(client.telemetry.requests_total, 2);
    assert.equal(client.telemetry.blocked_total, 2);
    assert.equal(client.telemetry.runtime, "node");
    assert.equal(runtime.requests[1].payload.telemetry.requests_total, 1);

    client.resetTelemetry();
    assert.equal(client.telemetry.requests_total, 0);
  } finally {
    runtime.server.close();
  }
});

test("install returns typed runtime state", async () => {
  const runtime = await startServer([
    {
      status: 200,
      body: {
        application_id: "app_01",
        app_number: 123456,
        repository: "argorix/travel-bot",
        installation_connected: true,
        guardrails_config: { enabled: true, mode: "enforce" },
        effective_scope: { scope_type: "application", scope_id: "app_01" },
        selected_validators: ["pii_detection"],
        server_time: "2026-08-01T14:15:22Z",
      },
    },
  ]);

  try {
    const client = buildClient(runtime.baseUrl);
    const state = await client.install({ mode: "enforce", metadata: { env: "prod" } });

    assert.equal(state.installationConnected, true);
    assert.equal(state.enabled, true);
    assert.equal(state.mode, "enforce");
    assert.deepEqual(state.selectedValidators, ["pii_detection"]);
    assert.equal(runtime.requests[0].payload.mode, "enforce");
  } finally {
    runtime.server.close();
  }
});

test("install raises a structured error on a non-retryable response", async () => {
  const runtime = await startServer([{ status: 400, body: { detail: "invalid app" } }]);

  try {
    const client = buildClient(runtime.baseUrl);
    await assert.rejects(
      client.install({ mode: "monitor" }),
      (error) =>
        error instanceof ArgorixError &&
        error.statusCode === 400 &&
        (error.responseBody ?? "").includes("invalid app"),
    );
  } finally {
    runtime.server.close();
  }
});

test("evaluateStream yields start, result and end events", async () => {
  const runtime = await startServer([
    {
      sse: [
        ["start", { status: "started", stage: "input" }],
        ["result", EVALUATE_BODY],
        ["end", { status: "completed", allowed: false }],
      ],
    },
  ]);

  try {
    const client = buildClient(runtime.baseUrl);
    const seen = [];
    for await (const event of client.evaluateStream("prompt", { stage: "input" })) {
      seen.push(event.event);
    }

    assert.deepEqual(seen, ["start", "result", "end"]);
    assert.equal(runtime.requests[0].path, "/v1/guardrails/evaluate/stream");
    assert.equal(client.telemetry.blocked_total, 1);
  } finally {
    runtime.server.close();
  }
});

test("evaluateStreamedDecision returns the result event", async () => {
  const runtime = await startServer([
    {
      sse: [
        ["start", { status: "started" }],
        ["result", EVALUATE_BODY],
        ["end", { status: "completed" }],
      ],
    },
  ]);

  try {
    const client = buildClient(runtime.baseUrl);
    const decision = await client.evaluateStreamedDecision("prompt");

    assert.equal(decision.allowed, false);
    assert.equal(decision.findings[0].rule_id, "prompt_injection");
  } finally {
    runtime.server.close();
  }
});

test("evaluateStreamedDecision rejects on an error event", async () => {
  const runtime = await startServer([
    { sse: [["error", { status: "error", detail: "policy unavailable", code: 500 }]] },
  ]);

  try {
    const client = buildClient(runtime.baseUrl);
    await assert.rejects(
      client.evaluateStreamedDecision("prompt"),
      (error) => error instanceof ArgorixError && error.statusCode === 500,
    );
  } finally {
    runtime.server.close();
  }
});

test("evaluateStreamedDecision rejects when the stream has no result", async () => {
  const runtime = await startServer([{ sse: [["start", { status: "started" }]] }]);

  try {
    const client = buildClient(runtime.baseUrl);
    await assert.rejects(client.evaluateStreamedDecision("prompt"), ArgorixError);
  } finally {
    runtime.server.close();
  }
});

test("recordEvent and reportRedteamProbe post to the events endpoint", async () => {
  const runtime = await startServer([
    { status: 200, body: { status: "ok" } },
    { status: 200, body: { status: "ok" } },
  ]);

  try {
    const client = buildClient(runtime.baseUrl);
    await client.recordEvent({ eventType: "guardrail_hit", blocked: true, findingsTotal: 1 });
    await client.reportRedteamProbe({ eventName: "manual_probe" });

    assert.equal(runtime.requests[0].path, "/v1/guardrails/events");
    assert.equal(runtime.requests[0].payload.event_type, "guardrail_hit");
    assert.equal(runtime.requests[1].payload.event_type, "redteam_probe");
    assert.equal(runtime.requests[1].payload.event_name, "manual_probe");
  } finally {
    runtime.server.close();
  }
});

test("fromEnv reads ARGORIX_* variables", async () => {
  const runtime = await startServer([{ status: 200, body: EVALUATE_BODY }]);
  const previous = { ...process.env };

  try {
    process.env.ARGORIX_API_URL = runtime.baseUrl;
    process.env.ARGORIX_APP_NUMBER = "654321";
    process.env.ARGORIX_APP_API_KEY = "ax_live_env";

    const client = ArgorixClient.fromEnv({ maxRetries: 0, retryBackoffMs: 0 });
    await client.evaluate("prompt");

    assert.equal(runtime.requests[0].payload.app_number, 654321);
    assert.equal(runtime.requests[0].headers.authorization, "Bearer ax_live_env");
  } finally {
    process.env = previous;
    runtime.server.close();
  }
});

test("deprecated exports still resolve to the renamed classes", () => {
  assert.equal(GovernanceAIClient, ArgorixClient);
  assert.equal(GovernanceGuardrailsClient, ArgorixClient);
  assert.equal(GovernanceAIError, ArgorixError);
});

test("agents client registers an agent and lists its controls", async () => {
  const runtime = await startServer([
    { status: 200, body: { created: true, agent: { agent_name: "support_bot" }, controls: [] } },
    { status: 200, body: { agent_name: "support_bot", controls: [] } },
  ]);

  try {
    const client = new ArgorixAgentsClient({
      baseUrl: runtime.baseUrl,
      appNumber: 123456,
      appApiKey: "ax_live_test",
      maxRetries: 0,
      retryBackoffMs: 0,
    });

    const registration = await client.initAgent({ agentName: "support_bot" });
    assert.equal(registration.created, true);
    assert.equal(registration.agentName, "support_bot");
    assert.equal(runtime.requests[0].path, "/v1/agent-guardrails/runtime/agents/init");
    assert.match(runtime.requests[0].headers["user-agent"], /^argorix-agents-node\//);

    await client.listAgentControls("support_bot", { policyId: "policy-1" });
    assert.equal(runtime.requests[1].method, "GET");
    assert.match(runtime.requests[1].path, /\/agents\/support_bot\/controls\?/);
    assert.match(runtime.requests[1].path, /app_number=123456/);
    assert.match(runtime.requests[1].path, /policy_id=policy-1/);
  } finally {
    runtime.server.close();
  }
});

test("agents client evaluates a step and exposes typed matches", async () => {
  const runtime = await startServer([{ status: 200, body: DENY_AGENT_RESULT }]);

  try {
    const client = new ArgorixAgentsClient({
      baseUrl: runtime.baseUrl,
      appNumber: 123456,
      appApiKey: "ax_live_test",
      maxRetries: 0,
      retryBackoffMs: 0,
    });

    const result = await client.evaluate({
      agentName: "support_bot",
      stage: "pre",
      step: { type: "llm", name: "chat", input: "share ssn" },
    });

    assert.equal(result.denied, true);
    assert.equal(result.overallDecision, "deny");
    assert.equal(result.matches[0].controlName, "Block SSN");
    assert.equal(result.matches[0].steeringMessage, "Ask for a case id instead.");
    assert.equal(runtime.requests[0].payload.step.name, "chat");
  } finally {
    runtime.server.close();
  }
});

test("agents client streams a step evaluation", async () => {
  const runtime = await startServer([
    {
      sse: [
        ["start", { status: "started", stage: "pre" }],
        ["result", DENY_AGENT_RESULT],
        ["end", { status: "completed", decision: "deny" }],
      ],
    },
  ]);

  try {
    const client = new ArgorixAgentsClient({
      baseUrl: runtime.baseUrl,
      appNumber: 123456,
      appApiKey: "ax_live_test",
      maxRetries: 0,
      retryBackoffMs: 0,
    });

    const result = await client.evaluateStreamedResult({
      agentName: "support_bot",
      stage: "pre",
      step: { type: "llm", name: "chat", input: "share ssn" },
    });

    assert.equal(result.allowed, false);
    assert.equal(result.matches[0].controlId, "control-1");
    assert.equal(runtime.requests[0].path, "/v1/agent-guardrails/runtime/evaluate/stream");
  } finally {
    runtime.server.close();
  }
});
