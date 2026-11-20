import "server-only";

export interface GitHubRepository {
  providerRepoId: string;
  fullName: string;
  canonicalUrl: string;
  defaultBranch: string | null;
  visibility: "public" | "private" | "internal";
  providerArchived: boolean;
}

interface GitHubRepositoryApiResponse {
  id?: unknown;
  full_name?: unknown;
  html_url?: unknown;
  default_branch?: unknown;
  visibility?: unknown;
  archived?: unknown;
}

interface GitHubRepositoriesApiResponse {
  total_count?: unknown;
  repositories?: unknown;
}

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const REPOSITORIES_PER_PAGE = 100;

function parseGitHubRepository(
  value: unknown
): GitHubRepository {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("GitHub returned an invalid repository record.");
  }

  const repository =
    value as GitHubRepositoryApiResponse;

  if (
    typeof repository.id !== "number" ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    typeof repository.full_name !== "string" ||
    repository.full_name.length === 0 ||
    repository.full_name.length > 255 ||
    typeof repository.html_url !== "string" ||
    !repository.html_url.startsWith("https://github.com/") ||
    repository.html_url.length > 2048 ||
    !(
      repository.default_branch === null ||
      (
        typeof repository.default_branch === "string" &&
        repository.default_branch.length <= 255
      )
    ) ||
    (
      repository.visibility !== "public" &&
      repository.visibility !== "private" &&
      repository.visibility !== "internal"
    ) ||
    typeof repository.archived !== "boolean"
  ) {
    throw new Error("GitHub returned an incomplete repository record.");
  }

  return {
    providerRepoId: String(repository.id),
    fullName: repository.full_name,
    canonicalUrl: repository.html_url,
    defaultBranch: repository.default_branch,
    visibility: repository.visibility,
    providerArchived: repository.archived,
  };
}

export async function listGitHubInstallationRepositories(
  installationToken: string
): Promise<GitHubRepository[]> {
  if (
    typeof installationToken !== "string" ||
    installationToken.trim().length === 0
  ) {
    throw new Error("A valid GitHub installation token is required.");
  }

  const repositories: GitHubRepository[] = [];

  let page = 1;
  let totalCount = Number.POSITIVE_INFINITY;

  while (repositories.length < totalCount) {
    const url = new URL(
      "/installation/repositories",
      GITHUB_API_URL
    );

    url.searchParams.set(
      "per_page",
      String(REPOSITORIES_PER_PAGE)
    );

    url.searchParams.set("page", String(page));

    let response: Response;

    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${installationToken}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error(
        "Unable to contact GitHub while listing installation repositories."
      );
    }

    if (!response.ok) {
      throw new Error(
        `GitHub repository listing failed with HTTP ${response.status}.`
      );
    }

    let data: GitHubRepositoriesApiResponse;

    try {
      data = (await response.json()) as GitHubRepositoriesApiResponse;
    } catch {
      throw new Error(
        "GitHub returned an invalid repository listing response."
      );
    }

    if (
      typeof data.total_count !== "number" ||
      !Number.isSafeInteger(data.total_count) ||
      data.total_count < 0 ||
      !Array.isArray(data.repositories)
    ) {
      throw new Error(
        "GitHub returned an incomplete repository listing response."
      );
    }

    if (page === 1) {
      totalCount = data.total_count;
    }

    const pageRepositories = data.repositories.map(
      parseGitHubRepository
    );

    if (pageRepositories.length === 0) {
      if (repositories.length < totalCount) {
        throw new Error(
          "GitHub returned an incomplete repository listing."
        );
      }

      break;
    }

    repositories.push(...pageRepositories);

    page += 1;
  }

  return repositories;
}
