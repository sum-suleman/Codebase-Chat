import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { VerifiedGitHubInstallation } from "@/lib/providers/github/verify-installation";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_STRING_PATTERN = /^[1-9][0-9]*$/;
const ALLOWED_CONNECTION_STATUSES = new Set([
  "pending",
  "active",
  "revoked",
  "error",
]);

export type ProviderConnectionStatus =
  | "pending"
  | "active"
  | "revoked"
  | "error";

export interface PersistedGitHubConnection {
  id: string;
  ownerId: string;
  provider: "github";
  externalAccountId: string;
  accountLogin: string;
  accountType: "user" | "organization";
  installationId: string;
  status: "active";
}

export interface GitHubConnectionSummary {
  id: string;
  externalAccountId: string;
  accountLogin: string;
  accountType: "user" | "organization";
  installationId: string | null;
  status: ProviderConnectionStatus;
  updatedAt: string;
}

interface ProviderConnectionRow {
  id: unknown;
  owner_id?: unknown;
  provider?: unknown;
  external_account_id: unknown;
  account_login: unknown;
  account_type: unknown;
  installation_id: unknown;
  status: unknown;
  updated_at?: unknown;
}

function validateOwnerId(ownerId: string): string {
  if (typeof ownerId !== "string" || !UUID_PATTERN.test(ownerId)) {
    throw new Error("A valid authenticated owner ID is required.");
  }

  return ownerId;
}

function validateVerifiedInstallation(
  installation: VerifiedGitHubInstallation
): VerifiedGitHubInstallation {
  if (
    typeof installation !== "object" ||
    installation === null ||
    typeof installation.installationId !== "string" ||
    !POSITIVE_INTEGER_STRING_PATTERN.test(installation.installationId) ||
    typeof installation.accountId !== "string" ||
    !POSITIVE_INTEGER_STRING_PATTERN.test(installation.accountId) ||
    installation.accountId.length > 255 ||
    typeof installation.accountLogin !== "string" ||
    installation.accountLogin.length === 0 ||
    installation.accountLogin.length > 255 ||
    (installation.accountType !== "user" &&
      installation.accountType !== "organization")
  ) {
    throw new Error("A valid verified GitHub installation is required.");
  }

  return installation;
}

export async function upsertGitHubInstallationConnection(
  ownerId: string,
  installation: VerifiedGitHubInstallation,
  adminClient: SupabaseClient = createAdminClient()
): Promise<PersistedGitHubConnection> {
  const validOwnerId = validateOwnerId(ownerId);
  const validInstallation = validateVerifiedInstallation(installation);

  const { data, error } = await adminClient
    .from("provider_connections")
    .upsert(
      {
        owner_id: validOwnerId,
        provider: "github",
        external_account_id: validInstallation.accountId,
        account_login: validInstallation.accountLogin,
        account_type: validInstallation.accountType,
        installation_id: validInstallation.installationId,
        status: "active",
      },
      {
        onConflict: "owner_id,provider,external_account_id",
      }
    )
    .select(
      "id, owner_id, provider, external_account_id, account_login, account_type, installation_id, status"
    )
    .single();

  if (error || !data) {
    throw new Error("Unable to persist the GitHub provider connection.");
  }

  const row = data as ProviderConnectionRow;
  const persistedInstallationId =
    typeof row.installation_id === "number"
      ? String(row.installation_id)
      : row.installation_id;

  if (
    typeof row.id !== "string" ||
    row.owner_id !== validOwnerId ||
    row.provider !== "github" ||
    row.external_account_id !== validInstallation.accountId ||
    typeof row.account_login !== "string" ||
    (row.account_type !== "user" && row.account_type !== "organization") ||
    typeof persistedInstallationId !== "string" ||
    !POSITIVE_INTEGER_STRING_PATTERN.test(persistedInstallationId) ||
    row.status !== "active"
  ) {
    throw new Error(
      "Persisted GitHub provider connection returned unexpected metadata."
    );
  }

  return {
    id: row.id,
    ownerId: row.owner_id,
    provider: "github",
    externalAccountId: row.external_account_id,
    accountLogin: row.account_login,
    accountType: row.account_type,
    installationId: persistedInstallationId,
    status: "active",
  };
}

export async function listUserGitHubConnections(
  userClient: SupabaseClient
): Promise<GitHubConnectionSummary[]> {
  const { data, error } = await userClient
    .from("provider_connections")
    .select(
      "id, external_account_id, account_login, account_type, installation_id, status, updated_at"
    )
    .eq("provider", "github")
    .order("created_at", { ascending: true });

  if (error || !Array.isArray(data)) {
    throw new Error("Unable to load GitHub provider connections.");
  }

  const connections: GitHubConnectionSummary[] = [];

  for (const item of data) {
    const row = item as ProviderConnectionRow;
    const rawInstallationId =
      typeof row.installation_id === "number"
        ? String(row.installation_id)
        : row.installation_id;

    const installationId =
      typeof rawInstallationId === "string" &&
      POSITIVE_INTEGER_STRING_PATTERN.test(rawInstallationId)
        ? rawInstallationId
        : null;

    if (
      typeof row.id !== "string" ||
      typeof row.external_account_id !== "string" ||
      typeof row.account_login !== "string" ||
      (row.account_type !== "user" && row.account_type !== "organization") ||
      typeof row.status !== "string" ||
      !ALLOWED_CONNECTION_STATUSES.has(row.status) ||
      typeof row.updated_at !== "string"
    ) {
      continue;
    }

    connections.push({
      id: row.id,
      externalAccountId: row.external_account_id,
      accountLogin: row.account_login,
      accountType: row.account_type,
      installationId,
      status: row.status as ProviderConnectionStatus,
      updatedAt: row.updated_at,
    });
  }

  return connections;
}
