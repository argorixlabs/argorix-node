import { NextResponse } from "next/server";
import { ArgorixClient } from "@argorix/sdk";

const client = new ArgorixClient({
  baseUrl: process.env.ARGORIX_API_URL ?? "http://127.0.0.1:8001",
  appNumber: Number(process.env.ARGORIX_APP_NUMBER ?? "0"),
  appApiKey: process.env.ARGORIX_APP_API_KEY ?? "",
  defaultPolicyId: process.env.ARGORIX_POLICY_ID ?? null,
});

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
  };
  const prompt = String(body.prompt ?? "");

  if (!prompt) {
    return NextResponse.json({ detail: "prompt is required" }, { status: 400 });
  }

  const decision = await client.evaluate(prompt, { stage: "input" });
  if (decision.blocked) {
    return NextResponse.json({ detail: "blocked", findings: decision.findings }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
