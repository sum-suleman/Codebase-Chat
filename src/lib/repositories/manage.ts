import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { scheduleRepositoryIndexJob } from "@/lib/indexing/pipeline";
import { createGitHubInstallationToken } from "@/lib/providers/github/installation";
import { listGitHubInstallationRepositories } from "@/lib/providers/github/repositories";
import {
  getValidGitLabAccessToken,
  listGitLabAuthorizedProjects,
} from "@/lib/providers/gitlab/client";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_STRING_PATTERN = /^[1-9][0-9]*$/;

export const MAX_ACTIVE_REPOSITORIES_PER_USER = 5;

export interface UserRepositoryRecord {
  id: string;
  connectionId: string;
  provider: "github" | "gitlab";
  providerRepoId: string;
  fullName: string;
  canonicalUrl: string;
  defaultBranch: string | null;
  visibility: "public" | "private" | "internal";
  providerArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RepositoryDbRow {
  id: unknown;
  owner_id?: unknown;
  connection_id: unknown;
  provider: unknown;
  provider_repo_id: unknown;
  full_name: unknown;
  canonical_url: unknown;
  default_branch: unknown;
  visibility: unknown;
  provider_archived: unknown;
  disconnected_at?: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface ConnectionLookupRow {
  id: unknown;
  provider: unknown;
  account_login?: unknown;
  installation_id: unknown;
  status: unknown;
}

function parseRepositoryRow(row: RepositoryDbRow): UserRepositoryRecord | null {
  if (
    typeof row.id !== "string" ||
    typeof row.connection_id !== "string" ||
    (row.provider !== "github" && row.provider !== "gitlab") ||
    typeof row.provider_repo_id !== "string" ||
    typeof row.full_name !== "string" ||
    typeof row.canonical_url !== "string" ||
    !(row.default_branch === null || typeof row.default_branch === "string") ||
    (row.visibility !== "public" &&
      row.visibility !== "private" &&
      row.visibility !== "internal") ||
    typeof row.provider_archived !== "boolean" ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    connectionId: row.connection_id,
    provider: row.provider,
    providerRepoId: row.provider_repo_id,
    fullName: row.full_name,
    canonicalUrl: row.canonical_url,
    defaultBranch: row.default_branch,
    visibility: row.visibility,
    providerArchived: row.provider_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listUserActiveRepositories(
  userClient: SupabaseClient
): Promise<UserRepositoryRecord[]> {
  const { data, error } = await userClient
    .from("repositories")
    .select(
      "id, connection_id, provider, provider_repo_id, full_name, canonical_url, default_branch, visibility, provider_archived, created_at, updated_at"
    )
    .is("disconnected_at", null)
    .order("created_at", { ascending: false });

  if (error || !Array.isArray(data)) {
    throw new Error("Unable to load connected repositories.");
  }

  const repositories: UserRepositoryRecord[] = [];
  for (const item of data) {
    const parsed = parseRepositoryRow(item as RepositoryDbRow);
    if (parsed) {
      repositories.push(parsed);
    }
  }

  return repositories;
}

export async function importGitHubRepository(
  params: {
    ownerId: string;
    connectionId: string;
    providerRepoId: string;
  },
  userClient: SupabaseClient,
  adminClient: SupabaseClient = createAdminClient()
): Promise<UserRepositoryRecord> {
  const { ownerId, connectionId, providerRepoId } = params;

  if (!UUID_PATTERN.test(ownerId)) {
    throw new Error("A valid authenticated user ID is required.");
  }

  if (!UUID_PATTERN.test(connectionId)) {
    throw new Error("A valid GitHub connection ID is required.");
  }

  if (!POSITIVE_INTEGER_STRING_PATTERN.test(providerRepoId)) {
    throw new Error("A valid GitHub repository ID is required.");
  }

  const { data: connectionData, error: connectionError } = await userClient
    .from("provider_connections")
    .select("id, provider, installation_id, status")
    .eq("id", connectionId)
    .eq("provider", "github")
    .single();

  if (connectionError || !connectionData) {
    throw new Error("The selected GitHub connection could not be found.");
  }

  const connection = connectionData as ConnectionLookupRow;
  const rawInstallationId =
    typeof connection.installation_id === "number"
      ? String(connection.installation_id)
      : connection.installation_id;

  if (
    connection.status !== "active" ||
    typeof rawInstallationId !== "string" ||
    !POSITIVE_INTEGER_STRING_PATTERN.test(rawInstallationId)
  ) {
    throw new Error(
      "The selected GitHub connection is not active. Please reconnect GitHub in Settings."
    );
  }

  const installationToken = await createGitHubInstallationToken(
    Number(rawInstallationId)
  );
  const authorizedRepos = await listGitHubInstallationRepositories(
    installationToken.token
  );

  const targetRepo = authorizedRepos.find(
    (repo) => repo.providerRepoId === providerRepoId
  );

  if (!targetRepo) {
    throw new Error(
      "That repository is not accessible under your GitHub App installation."
    );
  }

  const { data: upsertedData, error: upsertError } = await adminClient
    .from("repositories")
    .upsert(
      {
        owner_id: ownerId,
        connection_id: connectionId,
        provider: "github",
        provider_repo_id: targetRepo.providerRepoId,
        full_name: targetRepo.fullName,
        canonical_url: targetRepo.canonicalUrl,
        default_branch: targetRepo.defaultBranch,
        visibility: targetRepo.visibility,
        provider_archived: targetRepo.providerArchived,
        disconnected_at: null,
      },
      {
        onConflict: "owner_id,provider,provider_repo_id",
      }
    )
    .select(
      "id, connection_id, provider, provider_repo_id, full_name, canonical_url, default_branch, visibility, provider_archived, created_at, updated_at"
    )
    .single();

  if (upsertError || !upsertedData) {
    const pgCode =
      typeof (upsertError as { code?: unknown } | null)?.code === "string"
        ? (upsertError as { code: string }).code
        : undefined;
    const pgMessage =
      typeof (upsertError as { message?: unknown } | null)?.message === "string"
        ? (upsertError as { message: string }).message
        : "";

    if (
      pgCode === "23514" &&
      pgMessage.includes("Repository limit reached")
    ) {
      throw new Error(
        `Repository limit reached: you can connect up to ${MAX_ACTIVE_REPOSITORIES_PER_USER} active repositories at a time.`
      );
    }

    throw new Error("Unable to import the selected GitHub repository.");
  }

  const parsed = parseRepositoryRow(upsertedData as RepositoryDbRow);
  if (!parsed) {
    throw new Error("Imported repository returned unexpected metadata.");
  }

  try {
    await scheduleRepositoryIndexJob(
      { ownerId, repositoryId: parsed.id },
      adminClient
    );
  } catch {
    // Non-fatal: user can also trigger indexing manually from /repositories
  }

  return parsed;
}

export async function importGitLabRepository(
  params: {
    ownerId: string;
    connectionId: string;
    providerRepoId: string;
  },
  userClient: SupabaseClient,
  adminClient: SupabaseClient = createAdminClient()
): Promise<UserRepositoryRecord> {
  const { ownerId, connectionId, providerRepoId } = params;

  if (!UUID_PATTERN.test(ownerId)) {
    throw new Error("A valid authenticated user ID is required.");
  }

  if (!UUID_PATTERN.test(connectionId)) {
    throw new Error("A valid GitLab connection ID is required.");
  }

  if (!POSITIVE_INTEGER_STRING_PATTERN.test(providerRepoId)) {
    throw new Error("A valid GitLab project ID is required.");
  }

  const { data: connectionData, error: connectionError } = await userClient
    .from("provider_connections")
    .select("id, provider, account_login, status")
    .eq("id", connectionId)
    .eq("provider", "gitlab")
    .single();

  if (connectionError || !connectionData) {
    throw new Error("The selected GitLab connection could not be found.");
  }

  const connection = connectionData as ConnectionLookupRow;
  if (connection.status !== "active") {
    throw new Error(
      "The selected GitLab connection is not active. Please reconnect GitLab in Settings."
    );
  }

  const accessToken = await getValidGitLabAccessToken(
    { ownerId, connectionId },
    adminClient
  );
  const authorizedProjects = await listGitLabAuthorizedProjects({
    connectionId,
    accountLogin:
      typeof connection.account_login === "string"
        ? connection.account_login
        : "gitlab",
    accessToken,
  });

  const targetProject = authorizedProjects.find(
    (project) => project.providerRepoId === providerRepoId
  );

  if (!targetProject) {
    throw new Error(
      "That project is not accessible under your connected GitLab account."
    );
  }

  const { data: upsertedData, error: upsertError } = await adminClient
    .from("repositories")
    .upsert(
      {
        owner_id: ownerId,
        connection_id: connectionId,
        provider: "gitlab",
        provider_repo_id: targetProject.providerRepoId,
        full_name: targetProject.fullName,
        canonical_url: targetProject.canonicalUrl,
        default_branch: targetProject.defaultBranch,
        visibility: targetProject.visibility,
        provider_archived: targetProject.providerArchived,
        disconnected_at: null,
      },
      {
        onConflict: "owner_id,provider,provider_repo_id",
      }
    )
    .select(
      "id, connection_id, provider, provider_repo_id, full_name, canonical_url, default_branch, visibility, provider_archived, created_at, updated_at"
    )
    .single();

  if (upsertError || !upsertedData) {
    const pgCode =
      typeof (upsertError as { code?: unknown } | null)?.code === "string"
        ? (upsertError as { code: string }).code
        : undefined;
    const pgMessage =
      typeof (upsertError as { message?: unknown } | null)?.message === "string"
        ? (upsertError as { message: string }).message
        : "";

    if (
      pgCode === "23514" &&
      pgMessage.includes("Repository limit reached")
    ) {
      throw new Error(
        `Repository limit reached: you can connect up to ${MAX_ACTIVE_REPOSITORIES_PER_USER} active repositories at a time.`
      );
    }

    throw new Error("Unable to import the selected GitLab project.");
  }

  const parsed = parseRepositoryRow(upsertedData as RepositoryDbRow);
  if (!parsed) {
    throw new Error("Imported GitLab project returned unexpected metadata.");
  }

  try {
    await scheduleRepositoryIndexJob(
      { ownerId, repositoryId: parsed.id },
      adminClient
    );
  } catch {
    // Non-fatal: user can also trigger indexing manually from /repositories
  }

  return parsed;
}

export async function disconnectUserRepository(
  params: {
    ownerId: string;
    repositoryId: string;
  },
  userClient: SupabaseClient,
  adminClient: SupabaseClient = createAdminClient()
): Promise<void> {
  const { ownerId, repositoryId } = params;

  if (!UUID_PATTERN.test(ownerId)) {
    throw new Error("A valid authenticated user ID is required.");
  }

  if (!UUID_PATTERN.test(repositoryId)) {
    throw new Error("A valid repository ID is required.");
  }

  const { data: existingRepo, error: lookupError } = await userClient
    .from("repositories")
    .select("id")
    .eq("id", repositoryId)
    .is("disconnected_at", null)
    .single();

  if (lookupError || !existingRepo) {
    throw new Error("Active repository not found.");
  }

  const { error: updateError } = await adminClient
    .from("repositories")
    .update({
      disconnected_at: new Date().toISOString(),
    })
    .eq("id", repositoryId)
    .eq("owner_id", ownerId)
    .is("disconnected_at", null);

  if (updateError) {
    throw new Error("Unable to disconnect the repository.");
  }
}
