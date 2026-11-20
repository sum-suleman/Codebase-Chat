import "server-only";

import { createGitHubAppJwt } from "@/lib/providers/github/jwt";

export interface GitHubInstallationToken {
  token: string;
  expiresAt: string;
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
}

interface GitHubInstallationTokenResponse {
  token?: unknown;
  expires_at?: unknown;
  repository_selection?: unknown;
  permissions?: unknown;
}

export async function createGitHubInstallationToken(
  installationId: number,
  repositoryIds?: number[]
): Promise<GitHubInstallationToken> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error("A valid GitHub installation ID is required.");
  }

  if (repositoryIds !== undefined) {
    if (
      repositoryIds.length === 0 ||
      repositoryIds.length > 500 ||
      repositoryIds.some(
        (id) => !Number.isSafeInteger(id) || id <= 0
      ) ||
      new Set(repositoryIds).size !== repositoryIds.length
    ) {
      throw new Error(
        "Repository IDs must contain between 1 and 500 unique positive integers."
      );
    }
  }

  const appJwt = createGitHubAppJwt();

  const requestBody = JSON.stringify({
    permissions: {
      contents: "read",
      metadata: "read",
    },
    ...(repositoryIds !== undefined
      ? { repository_ids: repositoryIds }
      : {}),
  });

  let response: Response;

  try {
    response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${appJwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: requestBody,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch {
    throw new Error(
      "Unable to contact GitHub while creating an installation access token."
    );
  }

  if (!response.ok) {
    throw new Error(
      `GitHub installation token request failed with HTTP ${response.status}.`
    );
  }

  let data: GitHubInstallationTokenResponse;

  try {
    data = (await response.json()) as GitHubInstallationTokenResponse;
  } catch {
    throw new Error("GitHub returned an invalid installation token response.");
  }

  if (
    typeof data.token !== "string" ||
    data.token.length === 0 ||
    typeof data.expires_at !== "string" ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    (data.repository_selection !== "all" &&
      data.repository_selection !== "selected") ||
    typeof data.permissions !== "object" ||
    data.permissions === null ||
    Array.isArray(data.permissions)
  ) {
    throw new Error(
      "GitHub returned an incomplete installation token response."
    );
  }

  return {
    token: data.token,
    expiresAt: data.expires_at,
    repositorySelection: data.repository_selection,
    permissions: data.permissions as Record<string, string>,
  };
}
