# @governanceai/sdk (deprecated)

Governance AI is now **Argorix**. This package has been renamed to
[`@argorix/sdk`](https://www.npmjs.com/package/@argorix/sdk).

Version 0.2.0 contains no implementation of its own. It depends on `@argorix/sdk` and
re-exports it, so existing imports keep working while you migrate. Importing it emits a
`DeprecationWarning`.

## Migrate

```bash
npm uninstall @governanceai/sdk
npm install @argorix/sdk
```

```diff
-import { GovernanceAIClient } from "@governanceai/sdk";
-const client = new GovernanceAIClient({ baseUrl, appNumber, appApiKey });
-const decision = await client.apply("user prompt", { stage: "input" });
+import { ArgorixClient } from "@argorix/sdk";
+const client = new ArgorixClient({ baseUrl, appNumber, appApiKey });
+const decision = await client.evaluate("user prompt", { stage: "input" });
```

`GovernanceAIClient`, `GovernanceGuardrailsClient` and `GovernanceAIError` remain
available as aliases inside `@argorix/sdk`, so changing the import specifier is enough to
get started.

See the [`@argorix/sdk` README](https://www.npmjs.com/package/@argorix/sdk) for the full
API, including the streaming evaluation endpoint and the agent guardrails client added
in 0.2.0.
