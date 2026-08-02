import { ArgorixClient } from "@argorix/sdk";

// Reads ARGORIX_API_URL, ARGORIX_APP_NUMBER, ARGORIX_APP_API_KEY and ARGORIX_POLICY_ID.
const client = ArgorixClient.fromEnv();

async function main(): Promise<void> {
  const state = await client.install({ mode: "monitor", metadata: { environment: "local" } });
  console.log("Installed:", state.applicationId, "mode:", state.mode);
  console.log("Active validators:", state.selectedValidators);

  const inbound = await client.evaluate("Open the customer export", { stage: "input" });
  console.log("Allowed:", inbound.allowed);
  for (const finding of inbound.findings) {
    console.log(`  [${finding.severity}] ${finding.rule_id}: ${finding.evidence}`);
  }

  const tool = await client.evaluate("fetch internal report", {
    stage: "tool",
    toolCalls: [{ toolName: "http_request", url: "https://internal-admin.local/export" }],
  });
  console.log("Tool call allowed:", tool.allowed);

  // Streaming variant: react to guardrail progress as it happens.
  for await (const event of client.evaluateStream("Summarize this ticket.", { stage: "input" })) {
    console.log("stream event:", event.event, event.data.status ?? "");
  }

  await client.heartbeat();
}

void main();
