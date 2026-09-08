# Changelog

## 0.4.0 - 2026-09-08

### Contrato de decision de Classic Guardrails

Aditivo: nada de lo que ya funcionaba cambia de forma. `GuardrailsDecision` expone ahora
la decision completa en lugar de solo `allowed`:

- `decision` (`allow` / `transform` / `deny`) y `outcome`
  (`policy_match`, `policy_not_applicable`, `evaluator_error`, `configuration_error`,
  `authentication_error`). La ausencia de politica aplicable es `policy_not_applicable`
  y siempre permite; un evaluador caido es `evaluator_error` y solo deniega si la
  aplicacion esta configurada fail-closed.
- `reasonCode`, `reason`, `eventId`, `requestId`, `failClosed`, `degraded`, `errors` y
  `runtimeEvidence` (el registro firmado de la decision, cuando el servidor lo adjunta).

`ApplyPayload` acepta descriptores opcionales que viajan a la evidencia y no cambian el
veredicto: `requestId`, `agentId`, `endpoint`, `step`, `actor`, `model`, mas
`includeEvidence` para pedir el recibo tambien en un `allow`. Se omiten del cuerpo cuando
no se pasan, asi que un servidor anterior a este contrato sigue aceptando el request.


## 0.3.0 - 2026-08-02

- Rebase sobre el árbol de producción. La 0.2.0 se armó desde un respaldo del repo con
  cuatro meses de atraso; para este paquete la única diferencia real era el prefijo
  `/v1`, que la 0.2.0 ya emitía, así que no hay cambios de API.
- La 0.2.0 nunca llegó a publicarse en npm: los intentos fallaron primero por el tipo de
  token y después porque npm está restringiendo los tokens que saltan 2FA. `@argorix/sdk`
  0.3.0 es, entonces, la primera versión publicada bajo el nombre nuevo.
- Se numera 0.3.0 para quedar alineado con `argorix-guardrails` y
  `argorix-guardrails-agent`, que sí venían de esa corrección.

## 0.2.0 - 2026-08-01

### Rebranding

- Renombrado de `@governanceai/sdk` a `@argorix/sdk`. El paquete anterior queda publicado
  como shim de compatibilidad que depende de este y lo reexporta.
- `GovernanceAIClient` / `GovernanceGuardrailsClient` → `ArgorixClient`,
  `GovernanceAIError` → `ArgorixError`. Los nombres anteriores siguen exportados como
  alias deprecados.
- Variables de entorno `ARGORIX_API_URL`, `ARGORIX_APP_NUMBER`, `ARGORIX_APP_API_KEY`,
  `ARGORIX_POLICY_ID`, con fallback a los nombres legados.

### Nuevo

- `evaluateStream()` y `evaluateStreamedDecision()` sobre
  `POST /v1/guardrails/evaluate/stream` (SSE con eventos `start`, `result`, `end`, `error`).
- `ArgorixAgentsClient`: cobertura completa de `/v1/agent-guardrails/runtime/*`
  (`initAgent`, `listAgentControls`, `evaluate`, `evaluateStream`,
  `evaluateStreamedResult`, `recordEvent`).
- `ArgorixClient.fromEnv()` para construir el cliente desde el entorno.
- `GuardrailsState` tipado para `install()` y `heartbeat()`.
- `GuardrailsDecision` gana `blocked`, `evaluations`, `guardrailsConfig`,
  `guardrailsEngine`, `stage`, `applicationId`, `appNumber`, `repository`, `serverTime`
  y `raw`.
- `client.telemetry` y `client.resetTelemetry()`.
- Helpers exportados: `highestSeverity`, `normalizeBaseUrl`, `toGuardrailsDecision`,
  `toGuardrailsState`, `toAgentEvaluation`, `toAgentRegistration`.
- Header `User-Agent: argorix-node/<versión>` (y `argorix-agents-node/<versión>`).
- `baseUrl` normaliza un sufijo `/v1` para no duplicar el prefijo.
- Nuevo ejemplo [`examples/agent-guardrails.ts`](./examples/agent-guardrails.ts).

### Cambios de comportamiento

- `install()` y `heartbeat()` devuelven `GuardrailsState` en vez de
  `Record<string, unknown>`; el payload original queda en `state.raw`.
- `apply()` se conserva como alias deprecado de `evaluate()`.

## 0.1.0 - 2026-03-22

- Published the canonical npm package name `@governanceai/sdk`.
- Added configurable timeout and retry behavior for runtime requests.
- Added structured `GovernanceAIError` with HTTP status and response body details.
- Added production-oriented README examples, tests, and release metadata.
- Preserved `GovernanceGuardrailsClient` as a compatibility export.
