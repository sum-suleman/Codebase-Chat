import { NextResponse } from "next/server";

import { listUserGitHubConnections } from "@/lib/providers/github/connections";
import { createGitHubInstallationToken } from "@/lib/providers/github/installation";
import {
  listGitHubInstallationRepositories,
  type GitHubRepository,
} from "@/lib/providers/github/repositories";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_ACTIVE_REPOSITORIES = 5;

export interface AvailableGitHubRepository extends GitHubRepository {
  connectionId: string;
  accountLogin: string;
  alreadyConnected: boolean;
}

interface ActiveRepositoryRow {
  provider_repo_id: unknown;
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonNoStore({ error: "Authentication required." }, 401);
  }

  let connections;
  try {
    connections = await listUserGitHubConnections(supabase);
  } catch {
    return jsonNoStore(
      { error: "Unable to load GitHub connections." },
      500
    );
  }

  const activeConnections = connections.filter(
    (connection) =>
      connection.status === "active" && connection.installationId !== null
  );

  const { data: existingRepoRows, error: existingReposError } = await supabase
    .from("repositories")
    .select("provider_repo_id")
    .eq("provider", "github")
    .is("disconnected_at", null);

  if (existingReposError || !Array.isArray(existingRepoRows)) {
    return jsonNoStore(
      { error: "Unable to load imported repositories." },
      500
    );
  }

  const connectedRepoIds = new Set<string>();
  for (const row of existingRepoRows as ActiveRepositoryRow[]) {
    if (typeof row.provider_repo_id === "string") {
      connectedRepoIds.add(row.provider_repo_id);
    }
  }

  if (activeConnections.length === 0) {
    return jsonNoStore({
      repositories: [],
      activeCount: connectedRepoIds.size,
      maxRepositories: MAX_ACTIVE_REPOSITORIES,
      hasActiveConnection: false,
    });
  }

  try {
    const perConnectionResults = await Promise.all(
      activeConnections.map(async (connection) => {
        const installationIdNumber = Number(connection.installationId);
        const tokenResponse = await createGitHubInstallationToken(
          installationIdNumber
        );
        const repos = await listGitHubInstallationRepositories(
          tokenResponse.token
        );

        return repos.map(
          (repo): AvailableGitHubRepository => ({
            ...repo,
            connectionId: connection.id,
            accountLogin: connection.accountLogin,
            alreadyConnected: connectedRepoIds.has(repo.providerRepoId),
          })
        );
      })
    );

    const deduplicatedByRepoId = new Map<string, AvailableGitHubRepository>();
    for (const repoList of perConnectionResults) {
      for (const repo of repoList) {
        if (!deduplicatedByRepoId.has(repo.providerRepoId)) {
          deduplicatedByRepoId.set(repo.providerRepoId, repo);
        }
      }
    }

    const repositories = Array.from(deduplicatedByRepoId.values()).sort(
      (a, b) => a.fullName.localeCompare(b.fullName)
    );

    return jsonNoStore({
      repositories,
      activeCount: connectedRepoIds.size,
      maxRepositories: MAX_ACTIVE_REPOSITORIES,
      hasActiveConnection: true,
    });
  } catch {
    return jsonNoStore(
      {
        error:
          "Unable to fetch repositories from GitHub. Verify your GitHub App installation permissions and try again.",
      },
      502
    );
  }
}
