# Argorix SDK for JavaScript / TypeScript

SDK oficial para Node.js, Next.js y TypeScript sobre el **Argorix Guardrails Runtime**.

```bash
npm install @argorix/sdk
```

> **Rebranding.** Este paquete se llamaba `@governanceai/sdk`. Ese nombre sigue publicado
> como shim de compatibilidad (depende de `@argorix/sdk` y lo reexporta), pero ya no
> recibe features. Ver [Migración](#migración-desde-governanceaisdk).

Requiere Node 18+ (usa `fetch` global). Funciona también en runtimes edge con `fetch` y
`ReadableStream`.

## API cubierta

### Guardrails clásicos — `ArgorixClient`

| Endpoint | Método |
| --- | --- |
| `POST /v1/guardrails/install` | `install()` |
| `POST /v1/guardrails/heartbeat` | `heartbeat()` |
| `POST /v1/guardrails/evaluate` | `evaluate()` (alias: `apply()`) |
| `POST /v1/guardrails/evaluate/stream` | `evaluateStream()`, `evaluateStreamedDecision()` |
| `POST /v1/guardrails/events` | `recordEvent()`, `reportRedteamProbe()` |

### Guardrails de agentes — `ArgorixAgentsClient`

| Endpoint | Método |
| --- | --- |
| `POST /v1/agent-guardrails/runtime/agents/init` | `initAgent()` |
| `GET /v1/agent-guardrails/runtime/agents/{agent_name}/controls` | `listAgentControls()` |
| `POST /v1/agent-guardrails/runtime/evaluate` | `evaluate()` |
| `POST /v1/agent-guardrails/runtime/evaluate/stream` | `evaluateStream()`, `evaluateStreamedResult()` |
| `POST /v1/agent-guardrails/runtime/events` | `recordEvent()` |

`baseUrl` acepta tanto `https://api.argorix.com` como `https://api.argorix.com/v1`: el
sufijo `/v1` se normaliza para no duplicar el prefijo.

## Autenticación

- `appNumber` en el body de cada request
- `Authorization: Bearer <APP_API_KEY>` en cada header

## Quick start

```ts
import { ArgorixClient, ArgorixError } from "@argorix/sdk";

const client = new ArgorixClient({
  baseUrl: "https://api.argorix.com",
  appNumber: 123456,
  appApiKey: "ax_live_replace_me",
  timeoutMs: 10_000,
  maxRetries: 2,
});

try {
  const state = await client.install({ mode: "monitor", metadata: { environment: "production" } });
  console.log(state.mode, state.selectedValidators);

  const decision = await client.evaluate("Summarize this support ticket", { stage: "input" });
  if (decision.blocked) {
    throw new Error(`Blocked: ${decision.findings.map((f) => f.rule_id).join(", ")}`);
  }
} catch (error) {
  if (error instanceof ArgorixError) {
    console.error(error.statusCode, error.message, error.responseBody);
  }
}
```

### Configuración por entorno

```ts
const client = ArgorixClient.fromEnv();
```

| Variable | Uso | Fallback legado |
| --- | --- | --- |
| `ARGORIX_API_URL` | `baseUrl` | `ARGORIX_BASE_URL`, `GOVERNANCE_AI_URL` |
| `ARGORIX_APP_NUMBER` | `appNumber` | `APP_NUMBER` |
| `ARGORIX_APP_API_KEY` | `appApiKey` | `APP_API_KEY` |
| `ARGORIX_POLICY_ID` | `defaultPolicyId` | — |

Las opciones explícitas ganan sobre el entorno. En runtimes sin `process`, pasa los
valores a mano.

## Flujo runtime clásico

```ts
const inbound = await client.evaluate(userPrompt, { stage: "input" });
if (inbound.blocked) {
  return new Response("blocked", { status: 403 });
}

const reply = await llm.invoke(userPrompt);

const outbound = await client.evaluate(reply, { stage: "output" });
return new Response(outbound.outputText);
```

### Tool calls

```ts
const decision = await client.evaluate("Open the customer export", {
  stage: "tool",
  toolCalls: [{ toolName: "browser.fetch", url: "https://example.com/private-report" }],
});
```

## Streaming (SSE)

```ts
for await (const event of client.evaluateStream(userPrompt, { stage: "input" })) {
  if (event.event === "result") {
    console.log("allowed:", event.data.allowed);
  } else if (event.event === "error") {
    console.error("guardrail error:", event.data.detail);
  }
}
```

Si solo te interesa la decisión final:

```ts
const decision = await client.evaluateStreamedDecision(userPrompt, { stage: "input" });
```

Rechaza con `ArgorixError` si el servidor emite `error` o si el stream cierra sin
`result`. El stream es perezoso: no se envía nada hasta que empiezas a iterar. Los
reintentos cubren la conexión y el status inicial; una vez abierto el stream no se
reintenta.

## Agent guardrails

```ts
import { ArgorixAgentsClient } from "@argorix/sdk";

const agents = new ArgorixAgentsClient({ baseUrl, appNumber, appApiKey });

await agents.initAgent({
  agentName: "support_bot",
  steps: [{ type: "tool", name: "lookup_booking" }],
});

const evaluation = await agents.evaluate({
  agentName: "support_bot",
  stage: "pre",
  step: { type: "tool", name: "lookup_booking", input: { email: "a@b.com" } },
});

if (evaluation.denied) {
  throw new Error(evaluation.matches[0].message ?? "denied");
}
```

Ver [`examples/agent-guardrails.ts`](./examples/agent-guardrails.ts).

## Tipos de respuesta

`GuardrailsDecision`: `allowed`, `blocked`, `outputText`, `mode`, `findings`,
`evaluations`, `selectedValidators`, `effectiveScope`, `guardrailsConfig`,
`guardrailsEngine`, `stage`, `applicationId`, `appNumber`, `repository`, `serverTime`,
`raw`.

`GuardrailsState`: `applicationId`, `appNumber`, `repository`, `installationConnected`,
`guardrailsConfig`, `effectiveScope`, `selectedValidators`, `mode`, `enabled`,
`serverTime`, `raw`.

`AgentEvaluation`: `overallDecision`, `allowed`, `denied`, `requiresSteering`,
`confidence`, `evaluatedControls`, `matches`, `nonMatches`, `errors`, `raw`.

`ControlMatch`: `controlId`, `controlName`, `action`, `evaluatorName`, `selectorPath`,
`matched`, `confidence`, `message`, `error`, `metadata`, `steeringMessage`.

Todos exponen `raw` con el payload JSON sin tocar, así que campos nuevos del control
plane quedan accesibles sin actualizar el SDK. El helper `highestSeverity(findings)`
devuelve la severidad máxima.

## Telemetría

`ArgorixClient` acumula `requests_total`, `blocked_total` y `avg_latency_ms`, y los
adjunta a `evaluate()` y `heartbeat()` salvo que pases `includeTelemetry: false`.

```ts
console.log(client.telemetry);
client.resetTelemetry();
```

## Errores, timeout y retry

Ambos clientes aceptan `timeoutMs`, `maxRetries`, `retryBackoffMs` y
`retryStatusCodes`. Los fallos lanzan `ArgorixError` con `statusCode` y `responseBody`.
Se reintentan errores de red y respuestas `408`, `429`, `500`, `502`, `503`, `504` con
backoff exponencial.

## Migración desde `@governanceai/sdk`

```bash
npm uninstall @governanceai/sdk
npm install @argorix/sdk
```

| Antes | Ahora |
| --- | --- |
| `GovernanceAIClient` | `ArgorixClient` |
| `GovernanceGuardrailsClient` | `ArgorixClient` |
| `GovernanceAIError` | `ArgorixError` |
| `client.apply(...)` | `client.evaluate(...)` (`apply` sigue funcionando) |

Los nombres viejos siguen exportados como alias, así que cambiar el especificador de
import alcanza para arrancar. Cambios de comportamiento a revisar:

- `install()` y `heartbeat()` devuelven `GuardrailsState` en vez de un objeto sin tipar.
  El payload original está en `state.raw`.
- `GuardrailsDecision` gana `blocked`, `evaluations`, `guardrailsConfig`,
  `guardrailsEngine`, `applicationId`, `appNumber`, `repository`, `serverTime` y `raw`.

## Desarrollo

```bash
npm install
npm run build
npm test
```

## Semver y changelog

- Versión actual: `0.2.0`
- Historial: [`CHANGELOG.md`](./CHANGELOG.md)
- Licencia: [`LICENSE`](./LICENSE)

## Referencias

- [`sdk/README.md`](../README.md)
- [`sdk/python/README.md`](../python/README.md)
- [`sdk/python-agents/README.md`](../python-agents/README.md)
- [`examples/basic.ts`](./examples/basic.ts)
- [`examples/next-route-handler.ts`](./examples/next-route-handler.ts)
- [`examples/agent-guardrails.ts`](./examples/agent-guardrails.ts)
