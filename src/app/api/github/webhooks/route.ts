import { NextResponse, type NextRequest } from "next/server";

import {
  processGitHubWebhookEvent,
  verifyGitHubWebhookSignature,
} from "@/lib/providers/github/webhooks";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_PAYLOAD_BYTES = 1024 * 1024; // 1 MiB

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const event = request.headers.get("x-github-event")?.trim() ?? "";
  if (!event || event.length > 100) {
    return jsonNoStore({ error: "Missing or invalid GitHub event header." }, 400);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonNoStore({ error: "Unable to read webhook request body." }, 400);
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_PAYLOAD_BYTES) {
    return jsonNoStore({ error: "Webhook payload exceeds maximum size." }, 413);
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  if (!verifyGitHubWebhookSignature(rawBody, signatureHeader)) {
    return jsonNoStore({ error: "Invalid webhook signature." }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonNoStore({ error: "Malformed JSON webhook payload." }, 400);
  }

  try {
    const result = await processGitHubWebhookEvent({ event, payload });
    return jsonNoStore({
      received: true,
      handled: result.handled,
      ...(result.action ? { action: result.action } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error &&
      error.message.startsWith("Invalid ")
        ? error.message
        : "Unable to process GitHub webhook event.";
    const status = message.startsWith("Invalid ") ? 400 : 500;
    return jsonNoStore({ error: message }, status);
  }
}
