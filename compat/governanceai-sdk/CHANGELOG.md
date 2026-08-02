# Changelog

## 0.2.0 - 2026-08-01

- Deprecated in favour of `@argorix/sdk` following the Governance AI → Argorix rebrand.
- Replaced the implementation with a thin shim that depends on `@argorix/sdk` and
  re-exports it, so existing imports keep working unchanged.
- Importing the package now emits a `DeprecationWarning` with migration instructions.

## 0.1.0 - 2026-03-22

- Published the canonical npm package name `@governanceai/sdk`.
- Added configurable timeout and retry behavior for runtime requests.
- Added structured `GovernanceAIError` with HTTP status and response body details.
- Added production-oriented README examples, tests, and release metadata.
- Preserved `GovernanceGuardrailsClient` as a compatibility export.
