import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Module from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const TEST_WEBHOOK_SECRET = "whsec_test_secret_key_1234567890";
const TEST_CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440000";

interface RecordedDbOp {
  table: string;
  op: "select" | "update";
  values?: Record<string, unknown>;
  filters: Array<{ method: string; args: unknown[] }>;
}

function signPayload(body: string, secret = TEST_WEBHOOK_SECRET): string {
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return `sha256=${digest}`;
}

function createMockWebhookAdminClient(options?: {
  connectionIds?: string[];
  recorded?: RecordedDbOp[];
  failOnTable?: string;
}): SupabaseClient {
  const recorded = options?.recorded ?? [];
  const connectionIds = options?.connectionIds ?? [TEST_CONNECTION_ID];

  const client = {
    from(table: string) {
      return {
        select() {
          const filters: Array<{ method: string; args: unknown[] }> = [];
          const chain = {
            eq(col: string, val: unknown) {
              filters.push({ method: "eq", args: [col, val] });
              return chain;
            },
            then(resolve: (value: unknown) => unknown) {
              recorded.push({ table, op: "select", filters });
              if (options?.failOnTable === table) {
                return Promise.resolve({
                  data: null,
                  error: { message: "mock select error" },
                }).then(resolve);
              }
              return Promise.resolve({
                data: connectionIds.map((id) => ({ id })),
                error: null,
              }).then(resolve);
            },
          };
          return chain;
        },
        update(values: Record<string, unknown>) {
          const filters: Array<{ method: string; args: unknown[] }> = [];
          const chain = {
            eq(col: string, val: unknown) {
              filters.push({ method: "eq", args: [col, val] });
              return chain;
            },
            in(col: string, vals: unknown[]) {
              filters.push({ method: "in", args: [col, vals] });
              return chain;
            },
            is(col: string, val: unknown) {
              filters.push({ method: "is", args: [col, val] });
              return chain;
            },
            then(resolve: (value: unknown) => unknown) {
              recorded.push({ table, op: "update", values, filters });
              if (options?.failOnTable === table) {
                return Promise.resolve({
                  error: { message: "mock update error" },
                }).then(resolve);
              }
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
    },
  };

  return client as unknown as SupabaseClient;
}

type WebhooksLibModule = typeof import("@/lib/providers/github/webhooks");
type WebhookRouteModule = typeof import("@/app/api/github/webhooks/route");

let verifyGitHubWebhookSignature: WebhooksLibModule["verifyGitHubWebhookSignature"];
let processGitHubWebhookEvent: WebhooksLibModule["processGitHubWebhookEvent"];
let webhookPOST: WebhookRouteModule["POST"];
let routeRecordedOps: RecordedDbOp[] = [];

type ModuleLoadFn = (
  request: string,
  parent: unknown,
  isMain: boolean
) => unknown;

const moduleWithLoad = Module as unknown as { _load: ModuleLoadFn };
const originalModuleLoad = moduleWithLoad._load;
const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;

before(async () => {
  process.env.GITHUB_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

  moduleWithLoad._load = function (
    request: string,
    parent: unknown,
    isMain: boolean
  ) {
    if (request === "@/lib/supabase/admin") {
      return {
        createAdminClient() {
          return createMockWebhookAdminClient({ recorded: routeRecordedOps });
        },
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };

  const webhooksLib = await import("@/lib/providers/github/webhooks");
  const webhookModule = await import("@/app/api/github/webhooks/route");

  verifyGitHubWebhookSignature = webhooksLib.verifyGitHubWebhookSignature;
  processGitHubWebhookEvent = webhooksLib.processGitHubWebhookEvent;
  webhookPOST = webhookModule.POST;
});

after(() => {
  moduleWithLoad._load = originalModuleLoad;
  if (originalSecret === undefined) {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  } else {
    process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
  }
});

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  routeRecordedOps = [];
});

describe("verifyGitHubWebhookSignature", () => {
  it("accepts a valid sha256 HMAC signature", () => {
    const body = JSON.stringify({ action: "deleted" });
    const sig = signPayload(body);

    assert.equal(verifyGitHubWebhookSignature(body, sig), true);
  });

  it("rejects missing, malformed, tampered, or wrong-secret signatures", () => {
    const body = JSON.stringify({ action: "deleted" });
    const validSig = signPayload(body);

    assert.equal(verifyGitHubWebhookSignature(body, null), false);
    assert.equal(verifyGitHubWebhookSignature(body, "sha1=abcdef"), false);
    assert.equal(verifyGitHubWebhookSignature(body, "sha256=not-hex"), false);
    assert.equal(
      verifyGitHubWebhookSignature(`${body} `, validSig),
      false
    );
    assert.equal(
      verifyGitHubWebhookSignature(
        body,
        signPayload(body, "different-secret-1234567890")
      ),
      false
    );

    delete process.env.GITHUB_WEBHOOK_SECRET;
    assert.equal(verifyGitHubWebhookSignature(body, validSig), false);
  });
});

describe("processGitHubWebhookEvent", () => {
  it("revokes connection and soft-disconnects repositories on installation.deleted", async () => {
    const recorded: RecordedDbOp[] = [];
    const adminClient = createMockWebhookAdminClient({
      connectionIds: [TEST_CONNECTION_ID],
      recorded,
    });

    const result = await processGitHubWebhookEvent(
      {
        event: "installation",
        payload: {
          action: "deleted",
          installation: { id: 54321 },
        },
      },
      adminClient
    );

    assert.deepEqual(result, {
      handled: true,
      action: "installation.deleted",
    });

    const connUpdate = recorded.find(
      (op) => op.table === "provider_connections" && op.op === "update"
    );
    assert.deepEqual(connUpdate?.values, {
      status: "revoked",
      installation_id: null,
    });

    const repoUpdate = recorded.find(
      (op) => op.table === "repositories" && op.op === "update"
    );
    assert.equal(typeof repoUpdate?.values?.disconnected_at, "string");
  });

  it("toggles connection status on installation.suspend and installation.unsuspend", async () => {
    const recorded: RecordedDbOp[] = [];
    const adminClient = createMockWebhookAdminClient({ recorded });

    await processGitHubWebhookEvent(
      {
        event: "installation",
        payload: { action: "suspend", installation: { id: 54321 } },
      },
      adminClient
    );
    await processGitHubWebhookEvent(
      {
        event: "installation",
        payload: { action: "unsuspend", installation: { id: 54321 } },
      },
      adminClient
    );

    const updates = recorded.filter(
      (op) => op.table === "provider_connections" && op.op === "update"
    );
    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0].values, { status: "revoked" });
    assert.deepEqual(updates[1].values, { status: "active" });
  });

  it("soft-disconnects removed repositories on installation_repositories.removed", async () => {
    const recorded: RecordedDbOp[] = [];
    const adminClient = createMockWebhookAdminClient({
      connectionIds: [TEST_CONNECTION_ID],
      recorded,
    });

    const result = await processGitHubWebhookEvent(
      {
        event: "installation_repositories",
        payload: {
          action: "removed",
          installation: { id: 54321 },
          repositories_removed: [{ id: 1001 }, { id: 1002 }],
        },
      },
      adminClient
    );

    assert.deepEqual(result, {
      handled: true,
      action: "installation_repositories.removed",
    });

    const repoUpdate = recorded.find(
      (op) => op.table === "repositories" && op.op === "update"
    );
    assert.equal(typeof repoUpdate?.values?.disconnected_at, "string");
    assert.deepEqual(repoUpdate?.filters, [
      { method: "eq", args: ["provider", "github"] },
      { method: "in", args: ["connection_id", [TEST_CONNECTION_ID]] },
      { method: "in", args: ["provider_repo_id", ["1001", "1002"]] },
      { method: "is", args: ["disconnected_at", null] },
    ]);
  });

  it("synchronizes repository archived, renamed, visibility, and deleted events", async () => {
    const recorded: RecordedDbOp[] = [];
    const adminClient = createMockWebhookAdminClient({ recorded });

    await processGitHubWebhookEvent(
      {
        event: "repository",
        payload: { action: "archived", repository: { id: 9001 } },
      },
      adminClient
    );

    await processGitHubWebhookEvent(
      {
        event: "repository",
        payload: {
          action: "renamed",
          repository: {
            id: 9001,
            full_name: "octocat/new-name",
            html_url: "https://github.com/octocat/new-name",
          },
        },
      },
      adminClient
    );

    await processGitHubWebhookEvent(
      {
        event: "repository",
        payload: { action: "privatized", repository: { id: 9001 } },
      },
      adminClient
    );

    await processGitHubWebhookEvent(
      {
        event: "repository",
        payload: { action: "deleted", repository: { id: 9001 } },
      },
      adminClient
    );

    const repoUpdates = recorded.filter(
      (op) => op.table === "repositories" && op.op === "update"
    );
    assert.equal(repoUpdates.length, 4);
    assert.deepEqual(repoUpdates[0].values, { provider_archived: true });
    assert.deepEqual(repoUpdates[1].values, {
      full_name: "octocat/new-name",
      canonical_url: "https://github.com/octocat/new-name",
    });
    assert.deepEqual(repoUpdates[2].values, { visibility: "private" });
    assert.equal(typeof repoUpdates[3].values?.disconnected_at, "string");
  });
});

describe("POST /api/github/webhooks", () => {
  it("returns 401 when signature is missing or invalid", async () => {
    const body = JSON.stringify({
      action: "deleted",
      installation: { id: 54321 },
    });

    const request = new NextRequest("http://localhost:3000/api/github/webhooks", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "x-hub-signature-256":
          "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
      body,
    });

    const response = await webhookPOST(request);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(routeRecordedOps.length, 0);
  });

  it("processes valid signed webhook events and returns 200", async () => {
    const body = JSON.stringify({
      action: "suspend",
      installation: { id: 54321 },
    });

    const request = new NextRequest("http://localhost:3000/api/github/webhooks", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    const response = await webhookPOST(request);
    const json = (await response.json()) as {
      received: boolean;
      handled: boolean;
      action?: string;
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(json, {
      received: true,
      handled: true,
      action: "installation.suspend",
    });
    assert.equal(routeRecordedOps.length, 1);
  });
});
