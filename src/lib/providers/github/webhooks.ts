import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { scheduleRepositoryIndexJob } from "@/lib/indexing/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

const WEBHOOK_SECRET_ENV = "GITHUB_WEBHOOK_SECRET";
const SHA256_PREFIX = "sha256=";
const HEX_64_PATTERN = /^[0-9a-f]{64}$/i;

export interface WebhookProcessingResult {
  handled: boolean;
  action?: string;
}

interface ConnectionIdRow {
  id: unknown;
}

interface PushTargetRepositoryRow {
  id: unknown;
  owner_id: unknown;
  default_branch: unknown;
}

function getWebhookSecret(): string {
  const secret = process.env[WEBHOOK_SECRET_ENV]?.trim();

  if (!secret || Buffer.byteLength(secret, "utf8") < 16) {
    throw new Error(
      `${WEBHOOK_SECRET_ENV} must contain at least 16 bytes of secret material.`
    );
  }

  return secret;
}

export function verifyGitHubWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretOverride?: string
): boolean {
  if (
    typeof rawBody !== "string" ||
    typeof signatureHeader !== "string" ||
    !signatureHeader.startsWith(SHA256_PREFIX)
  ) {
    return false;
  }

  const providedHex = signatureHeader.slice(SHA256_PREFIX.length);
  if (!HEX_64_PATTERN.test(providedHex)) {
    return false;
  }

  let secret: string;
  try {
    secret = secretOverride ?? getWebhookSecret();
  } catch {
    return false;
  }

  const expectedDigest = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest();
  const providedDigest = Buffer.from(providedHex, "hex");

  if (expectedDigest.length !== providedDigest.length) {
    return false;
  }

  return timingSafeEqual(expectedDigest, providedDigest);
}

function extractPositiveIntegerId(value: unknown): string | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return String(value);
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function findConnectionIdsByInstallation(
  installationId: string,
  adminClient: SupabaseClient
): Promise<string[]> {
  const { data, error } = await adminClient
    .from("provider_connections")
    .select("id")
    .eq("provider", "github")
    .eq("installation_id", installationId);

  if (error || !Array.isArray(data)) {
    throw new Error("Unable to look up GitHub installation connections.");
  }

  const connectionIds: string[] = [];
  for (const row of data as ConnectionIdRow[]) {
    if (typeof row.id === "string" && row.id.length > 0) {
      connectionIds.push(row.id);
    }
  }

  return connectionIds;
}

async function handleInstallationEvent(
  payload: Record<string, unknown>,
  adminClient: SupabaseClient
): Promise<WebhookProcessingResult> {
  const action = typeof payload.action === "string" ? payload.action : "";
  const installation = isRecord(payload.installation)
    ? payload.installation
    : null;
  const installationId = installation
    ? extractPositiveIntegerId(installation.id)
    : null;

  if (!installationId) {
    throw new Error("Invalid installation payload in GitHub webhook.");
  }

  if (action === "deleted") {
    const connectionIds = await findConnectionIdsByInstallation(
      installationId,
      adminClient
    );

    const { error: connectionUpdateError } = await adminClient
      .from("provider_connections")
      .update({
        status: "revoked",
        installation_id: null,
      })
      .eq("provider", "github")
      .eq("installation_id", installationId);

    if (connectionUpdateError) {
      throw new Error("Unable to revoke deleted GitHub installation.");
    }

    if (connectionIds.length > 0) {
      const { error: repoDisconnectError } = await adminClient
        .from("repositories")
        .update({
          disconnected_at: new Date().toISOString(),
        })
        .eq("provider", "github")
        .in("connection_id", connectionIds)
        .is("disconnected_at", null);

      if (repoDisconnectError) {
        throw new Error(
          "Unable to disconnect repositories for deleted GitHub installation."
        );
      }
    }

    return { handled: true, action: "installation.deleted" };
  }

  if (action === "suspend" || action === "unsuspend") {
    const nextStatus = action === "suspend" ? "revoked" : "active";

    const { error } = await adminClient
      .from("provider_connections")
      .update({ status: nextStatus })
      .eq("provider", "github")
      .eq("installation_id", installationId);

    if (error) {
      throw new Error("Unable to update GitHub installation status.");
    }

    return { handled: true, action: `installation.${action}` };
  }

  return { handled: false };
}

async function handleInstallationRepositoriesEvent(
  payload: Record<string, unknown>,
  adminClient: SupabaseClient
): Promise<WebhookProcessingResult> {
  const action = typeof payload.action === "string" ? payload.action : "";
  const installation = isRecord(payload.installation)
    ? payload.installation
    : null;
  const installationId = installation
    ? extractPositiveIntegerId(installation.id)
    : null;

  if (!installationId) {
    throw new Error(
      "Invalid installation_repositories payload in GitHub webhook."
    );
  }

  if (action === "removed") {
    const removedRaw = Array.isArray(payload.repositories_removed)
      ? payload.repositories_removed
      : [];

    const removedRepoIds: string[] = [];
    for (const item of removedRaw) {
      if (isRecord(item)) {
        const repoId = extractPositiveIntegerId(item.id);
        if (repoId) {
          removedRepoIds.push(repoId);
        }
      }
    }

    if (removedRepoIds.length === 0) {
      return { handled: true, action: "installation_repositories.removed" };
    }

    const connectionIds = await findConnectionIdsByInstallation(
      installationId,
      adminClient
    );

    if (connectionIds.length > 0) {
      const { error } = await adminClient
        .from("repositories")
        .update({
          disconnected_at: new Date().toISOString(),
        })
        .eq("provider", "github")
        .in("connection_id", connectionIds)
        .in("provider_repo_id", removedRepoIds)
        .is("disconnected_at", null);

      if (error) {
        throw new Error(
          "Unable to disconnect removed installation repositories."
        );
      }
    }

    return { handled: true, action: "installation_repositories.removed" };
  }

  return { handled: false };
}

async function handleRepositoryEvent(
  payload: Record<string, unknown>,
  adminClient: SupabaseClient
): Promise<WebhookProcessingResult> {
  const action = typeof payload.action === "string" ? payload.action : "";
  const repository = isRecord(payload.repository) ? payload.repository : null;
  const providerRepoId = repository
    ? extractPositiveIntegerId(repository.id)
    : null;

  if (!repository || !providerRepoId) {
    throw new Error("Invalid repository payload in GitHub webhook.");
  }

  if (action === "deleted") {
    const { error } = await adminClient
      .from("repositories")
      .update({
        disconnected_at: new Date().toISOString(),
      })
      .eq("provider", "github")
      .eq("provider_repo_id", providerRepoId)
      .is("disconnected_at", null);

    if (error) {
      throw new Error("Unable to disconnect deleted GitHub repository.");
    }

    return { handled: true, action: "repository.deleted" };
  }

  if (action === "archived" || action === "unarchived") {
    const { error } = await adminClient
      .from("repositories")
      .update({
        provider_archived: action === "archived",
      })
      .eq("provider", "github")
      .eq("provider_repo_id", providerRepoId)
      .is("disconnected_at", null);

    if (error) {
      throw new Error("Unable to update repository archive state.");
    }

    return { handled: true, action: `repository.${action}` };
  }

  if (action === "renamed") {
    const fullName =
      typeof repository.full_name === "string" &&
      repository.full_name.length > 0 &&
      repository.full_name.length <= 255
        ? repository.full_name
        : null;
    const htmlUrl =
      typeof repository.html_url === "string" &&
      repository.html_url.startsWith("https://github.com/") &&
      repository.html_url.length <= 2048
        ? repository.html_url
        : null;

    if (!fullName || !htmlUrl) {
      throw new Error("Invalid renamed repository metadata in GitHub webhook.");
    }

    const { error } = await adminClient
      .from("repositories")
      .update({
        full_name: fullName,
        canonical_url: htmlUrl,
      })
      .eq("provider", "github")
      .eq("provider_repo_id", providerRepoId)
      .is("disconnected_at", null);

    if (error) {
      throw new Error("Unable to update renamed GitHub repository.");
    }

    return { handled: true, action: "repository.renamed" };
  }

  if (action === "publicized" || action === "privatized") {
    const visibility = action === "publicized" ? "public" : "private";

    const { error } = await adminClient
      .from("repositories")
      .update({ visibility })
      .eq("provider", "github")
      .eq("provider_repo_id", providerRepoId)
      .is("disconnected_at", null);

    if (error) {
      throw new Error("Unable to update GitHub repository visibility.");
    }

    return { handled: true, action: `repository.${action}` };
  }

  return { handled: false };
}

async function handlePushEvent(
  payload: Record<string, unknown>,
  adminClient: SupabaseClient
): Promise<WebhookProcessingResult> {
  const ref = typeof payload.ref === "string" ? payload.ref : "";
  if (!ref.startsWith("refs/heads/")) {
    return { handled: false };
  }

  if (payload.deleted === true) {
    return { handled: false };
  }

  const pushedBranch = ref.slice("refs/heads/".length);
  const repository = isRecord(payload.repository) ? payload.repository : null;
  const providerRepoId = repository
    ? extractPositiveIntegerId(repository.id)
    : null;

  if (!pushedBranch || !providerRepoId) {
    return { handled: false };
  }

  const { data, error } = await adminClient
    .from("repositories")
    .select("id, owner_id, default_branch")
    .eq("provider", "github")
    .eq("provider_repo_id", providerRepoId)
    .is("disconnected_at", null);

  if (error || !Array.isArray(data)) {
    throw new Error("Unable to look up repositories for GitHub push event.");
  }

  for (const row of data as PushTargetRepositoryRow[]) {
    if (typeof row.id !== "string" || typeof row.owner_id !== "string") {
      continue;
    }

    const expectedBranch =
      typeof row.default_branch === "string" && row.default_branch.length > 0
        ? row.default_branch
        : "main";

    if (expectedBranch !== pushedBranch) {
      continue;
    }

    try {
      await scheduleRepositoryIndexJob(
        {
          ownerId: row.owner_id,
          repositoryId: row.id,
        },
        adminClient
      );
    } catch {
      // Non-fatal: webhook should acknowledge delivery even if re-index queue skips
    }
  }

  return { handled: true, action: "push" };
}

export async function processGitHubWebhookEvent(
  params: {
    event: string;
    payload: unknown;
  },
  adminClient: SupabaseClient = createAdminClient()
): Promise<WebhookProcessingResult> {
  const { event, payload } = params;

  if (!isRecord(payload)) {
    throw new Error("Invalid GitHub webhook JSON payload.");
  }

  switch (event) {
    case "installation":
      return handleInstallationEvent(payload, adminClient);
    case "installation_repositories":
      return handleInstallationRepositoriesEvent(payload, adminClient);
    case "repository":
      return handleRepositoryEvent(payload, adminClient);
    case "push":
      return handlePushEvent(payload, adminClient);
    default:
      return { handled: false };
  }
}
