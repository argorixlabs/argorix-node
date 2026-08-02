import { ArgorixAgentsClient, ArgorixError } from "@argorix/sdk";

const client = new ArgorixAgentsClient({
  baseUrl: process.env.ARGORIX_API_URL ?? "http://127.0.0.1:8001",
  appNumber: Number(process.env.ARGORIX_APP_NUMBER ?? "0"),
  appApiKey: process.env.ARGORIX_APP_API_KEY ?? "",
  defaultPolicyId: process.env.ARGORIX_POLICY_ID ?? null,
});

async function main(): Promise<void> {
  const registration = await client.initAgent({
    agentName: "support_bot",
    agentDescription: "Customer support automation",
    steps: [
      { type: "llm", name: "chat", description: "Model request evaluation" },
      { type: "tool", name: "lookup_booking", description: "Tool argument evaluation" },
    ],
  });
  console.log("Agent registered:", registration.agentName, "created:", registration.created);

  const evaluation = await client.evaluate({
    agentName: "support_bot",
    stage: "pre",
    step: {
      type: "tool",
      name: "lookup_booking",
      input: { email: "traveler@example.com", include_internal_notes: true },
    },
  });

  if (evaluation.denied) {
    const match = evaluation.matches[0];
    throw new ArgorixError(`Blocked by ${match.controlName}: ${match.message}`);
  }

  if (evaluation.requiresSteering) {
    console.log("Steering:", evaluation.matches[0]?.steeringMessage);
  }

  await client.recordEvent({
    agentName: "support_bot",
    eventType: "step_execution",
    stepType: "tool",
    stepName: "lookup_booking",
    decision: evaluation.overallDecision,
    allowed: evaluation.allowed,
    matchesTotal: evaluation.matches.length,
  });
}

void main();
