import "server-only";

import {
  MAX_INDEXABLE_FILE_BYTES,
  MAX_INDEXABLE_FILES,
  shouldIndexRepositoryPath,
  type GitHubRepositorySnapshot,
  type GitHubSourceFile,
} from "@/lib/providers/github/tree";
import { GITLAB_BASE_URL } from "@/lib/providers/gitlab/oauth";

const GRAPHQL_BLOB_BATCH_SIZE = 25;

interface GitLabProjectResponse {
  path_with_namespace?: unknown;
}

interface GitLabBranchResponse {
  commit?: {
    id?: unknown;
  };
}

interface GitLabTreeEntry {
  id?: unknown;
  path?: unknown;
  type?: unknown;
}

interface GitLabGraphQLBlobsResponse {
  data?: {
    project?: {
      repository?: {
        blobs?: {
          nodes?: Array<{
            path?: unknown;
            rawBlob?: unknown;
          }>;
        };
      };
    };
  };
  errors?: Array<{ message?: unknown }>;
}

function gitlabHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "Codebase-Chat/1.0",
  };
}

async function fetchGitLabWithRetry(
  url: string,
  init: RequestInit,
  networkErrorMessage: string
): Promise<Response> {
  let response: Response | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      response = await fetch(url, init);
    } catch {
      throw new Error(networkErrorMessage);
    }

    if (response.status !== 429 || attempt === 3) {
      return response;
    }

    const retryAfterSec = Number(response.headers.get("retry-after") || "2");
    const delayMs = Math.min(
      Math.max(
        (Number.isFinite(retryAfterSec) ? retryAfterSec : 2) * 1000,
        1500 * (attempt + 1)
      ),
      8000
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return response!;
}

async function fetchGitLabProjectFullPath(params: {
  accessToken: string;
  projectId: string;
}): Promise<string> {
  const url = `${GITLAB_BASE_URL}/api/v4/projects/${encodeURIComponent(params.projectId)}`;
  const response = await fetchGitLabWithRetry(
    url,
    {
      method: "GET",
      headers: gitlabHeaders(params.accessToken),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
    "Unable to contact GitLab while loading project metadata."
  );

  if (!response.ok) {
    throw new Error(
      `GitLab project lookup failed with HTTP ${response.status}.`
    );
  }

  const data = (await response.json()) as GitLabProjectResponse;
  if (
    typeof data.path_with_namespace !== "string" ||
    !data.path_with_namespace.trim()
  ) {
    throw new Error("GitLab returned incomplete project path metadata.");
  }

  return data.path_with_namespace.trim();
}

async function fetchGitLabBranchCommitSha(params: {
  accessToken: string;
  projectId: string;
  branch: string;
}): Promise<string> {
  const { accessToken, projectId, branch } = params;
  const url = `${GITLAB_BASE_URL}/api/v4/projects/${encodeURIComponent(projectId)}/repository/branches/${encodeURIComponent(branch)}`;

  const response = await fetchGitLabWithRetry(
    url,
    {
      method: "GET",
      headers: gitlabHeaders(accessToken),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
    "Unable to contact GitLab while resolving branch commit."
  );

  if (!response.ok) {
    throw new Error(
      `GitLab branch lookup failed with HTTP ${response.status}.`
    );
  }

  const data = (await response.json()) as GitLabBranchResponse;
  const commitSha = data.commit?.id;
  if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error("GitLab returned an incomplete branch commit SHA.");
  }

  return commitSha;
}

type BlobContentMap = Map<string, string>;

async function fetchGitLabBlobsBatchGraphQL(params: {
  accessToken: string;
  fullPath: string;
  commitSha: string;
  paths: readonly string[];
}): Promise<BlobContentMap> {
  const query = `
    query GetRepositoryBlobs($fullPath: ID!, $ref: String!, $paths: [String!]!) {
      project(fullPath: $fullPath) {
        repository {
          blobs(ref: $ref, paths: $paths) {
            nodes {
              path
              rawBlob
            }
          }
        }
      }
    }
  `;

  const response = await fetchGitLabWithRetry(
    `${GITLAB_BASE_URL}/api/graphql`,
    {
      method: "POST",
      headers: {
        ...gitlabHeaders(params.accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          fullPath: params.fullPath,
          ref: params.commitSha,
          paths: params.paths,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    },
    "Unable to contact GitLab GraphQL API while downloading source files."
  );

  if (!response.ok) {
    throw new Error(
      `GitLab batch file download failed with HTTP ${response.status}.`
    );
  }

  const payload = (await response.json()) as GitLabGraphQLBlobsResponse;
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const firstMsg =
      typeof payload.errors[0]?.message === "string"
        ? payload.errors[0].message
        : "GitLab GraphQL query returned an error.";
    throw new Error(firstMsg);
  }

  const result = new Map<string, string>();
  const nodes = payload.data?.project?.repository?.blobs?.nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (typeof node.path === "string" && typeof node.rawBlob === "string") {
        result.set(node.path, node.rawBlob);
      }
    }
  }

  return result;
}

export async function fetchGitLabRepositorySnapshot(params: {
  accessToken: string;
  projectId: string;
  branch: string | null;
  maxFiles?: number;
  maxFileBytes?: number;
}): Promise<GitHubRepositorySnapshot> {
  const {
    accessToken,
    projectId,
    branch,
    maxFiles = MAX_INDEXABLE_FILES,
    maxFileBytes = MAX_INDEXABLE_FILE_BYTES,
  } = params;

  if (!accessToken.trim()) {
    throw new Error("A valid GitLab access token is required.");
  }

  const targetBranch =
    typeof branch === "string" && branch.trim().length > 0
      ? branch.trim()
      : "main";

  const [fullPath, commitSha] = await Promise.all([
    fetchGitLabProjectFullPath({ accessToken, projectId }),
    fetchGitLabBranchCommitSha({
      accessToken,
      projectId,
      branch: targetBranch,
    }),
  ]);

  const candidates: Array<{ path: string; sha: string }> = [];
  let page = 1;
  let truncated = false;

  while (page <= 20) {
    const treeUrl = new URL(
      `${GITLAB_BASE_URL}/api/v4/projects/${encodeURIComponent(projectId)}/repository/tree`
    );
    treeUrl.searchParams.set("recursive", "true");
    treeUrl.searchParams.set("ref", commitSha);
    treeUrl.searchParams.set("per_page", "100");
    treeUrl.searchParams.set("page", String(page));

    const response = await fetchGitLabWithRetry(
      treeUrl.toString(),
      {
        method: "GET",
        headers: gitlabHeaders(accessToken),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
      "Unable to contact GitLab while listing repository tree."
    );

    if (!response.ok) {
      throw new Error(
        `GitLab tree listing failed with HTTP ${response.status}.`
      );
    }

    const entries = (await response.json()) as GitLabTreeEntry[];
    if (!Array.isArray(entries) || entries.length === 0) {
      break;
    }

    for (const entry of entries) {
      if (entry.type !== "blob") {
        continue;
      }
      if (
        typeof entry.path !== "string" ||
        typeof entry.id !== "string" ||
        !/^[0-9a-f]{40}$/i.test(entry.id)
      ) {
        continue;
      }
      if (!shouldIndexRepositoryPath(entry.path)) {
        continue;
      }
      candidates.push({ path: entry.path, sha: entry.id });
    }

    const nextPage = response.headers.get("x-next-page");
    if (!nextPage) {
      break;
    }
    page = Number(nextPage);
    if (!Number.isFinite(page) || page <= 1) {
      break;
    }
    if (page > 20) {
      truncated = true;
    }
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  if (candidates.length > maxFiles) {
    truncated = true;
  }

  const selected = candidates.slice(0, maxFiles);
  const files: GitHubSourceFile[] = [];

  for (let offset = 0; offset < selected.length; offset += GRAPHQL_BLOB_BATCH_SIZE) {
    const batch = selected.slice(offset, offset + GRAPHQL_BLOB_BATCH_SIZE);
    const contentByPath = await fetchGitLabBlobsBatchGraphQL({
      accessToken,
      fullPath,
      commitSha,
      paths: batch.map((item) => item.path),
    });

    for (const item of batch) {
      const content = contentByPath.get(item.path);
      if (typeof content !== "string" || !content.trim()) {
        continue;
      }
      if (content.includes("\0")) {
        continue;
      }
      const byteSize = Buffer.byteLength(content, "utf8");
      if (byteSize <= 0 || byteSize > maxFileBytes) {
        continue;
      }

      files.push({
        path: item.path,
        sha: item.sha,
        size: byteSize,
        content,
      });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    branch: targetBranch,
    commitSha,
    files,
    truncated,
  };
}
