import "server-only";

import { getGitHubAppConfig } from "@/lib/providers/github/config";
import { createGitHubAppJwt } from "@/lib/providers/github/jwt";

export interface VerifiedGitHubInstallation {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: "user" | "organization";
}

interface GitHubInstallationApiResponse {
  id?: unknown;
  app_id?: unknown;
  app_slug?: unknown;
  account?: unknown;
}

interface GitHubInstallationAccount {
  id?: unknown;
  login?: unknown;
  type?: unknown;
}

export async function verifyGitHubInstallation(
  installationId: number
): Promise<VerifiedGitHubInstallation> {
  if (
    !Number.isSafeInteger(installationId) ||
    installationId <= 0
  ) {
    throw new Error("A valid GitHub installation ID is required.");
  }

  const config = getGitHubAppConfig();
  const appJwt = createGitHubAppJwt();

  let response: Response;

  try {
    response = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${appJwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch {
    throw new Error(
      "Unable to contact GitHub while verifying the installation."
    );
  }

  if (!response.ok) {
    throw new Error(
      `GitHub installation verification failed with HTTP ${response.status}.`
    );
  }

  let data: GitHubInstallationApiResponse;

  try {
    data = (await response.json()) as GitHubInstallationApiResponse;
  } catch {
    throw new Error(
      "GitHub returned an invalid installation verification response."
    );
  }

  if (
    typeof data.id !== "number" ||
    !Number.isSafeInteger(data.id) ||
    data.id !== installationId ||
    typeof data.app_id !== "number" ||
    !Number.isSafeInteger(data.app_id) ||
    String(data.app_id) !== config.appId ||
    data.app_slug !== config.appSlug ||
    typeof data.account !== "object" ||
    data.account === null ||
    Array.isArray(data.account)
  ) {
    throw new Error(
      "GitHub installation does not belong to the configured GitHub App."
    );
  }

  const account = data.account as GitHubInstallationAccount;

  if (
    typeof account.id !== "number" ||
    !Number.isSafeInteger(account.id) ||
    account.id <= 0 ||
    typeof account.login !== "string" ||
    account.login.length === 0 ||
    account.login.length > 255 ||
    (account.type !== "User" && account.type !== "Organization")
  ) {
    throw new Error(
      "GitHub returned an invalid installation account."
    );
  }

  return {
    installationId: String(data.id),
    accountId: String(account.id),
    accountLogin: account.login,
    accountType:
      account.type === "Organization" ? "organization" : "user",
  };
}
