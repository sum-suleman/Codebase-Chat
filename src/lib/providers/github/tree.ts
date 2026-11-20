import "server-only";

export interface GitHubSourceFile {
  path: string;
  sha: string;
  size: number;
  content: string;
}

export interface GitHubRepositorySnapshot {
  branch: string;
  commitSha: string;
  files: GitHubSourceFile[];
  truncated: boolean;
}

interface GitHubBranchResponse {
  commit?: {
    sha?: unknown;
    commit?: {
      tree?: {
        sha?: unknown;
      };
    };
  };
}

interface GitHubTreeEntryResponse {
  path?: unknown;
  mode?: unknown;
  type?: unknown;
  sha?: unknown;
  size?: unknown;
}

interface GitHubTreeResponse {
  sha?: unknown;
  tree?: unknown;
  truncated?: unknown;
}

interface GitHubBlobResponse {
  sha?: unknown;
  content?: unknown;
  encoding?: unknown;
}

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

export const MAX_INDEXABLE_FILE_BYTES = 256 * 1024; // 256 KiB
export const MAX_INDEXABLE_FILES = 400;
const BLOB_FETCH_CONCURRENCY = 8;

const EXCLUDED_DIR_SEGMENTS = new Set([
  ".git",
  ".github",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".cache",
  ".idea",
  ".vscode",
  ".venv",
  "venv",
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
]);

const EXCLUDED_FILENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
  ".ds_store",
  "thumbs.db",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".avif",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".mov",
  ".avi",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  ".pdf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".pyc",
  ".pyo",
  ".class",
  ".o",
  ".a",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".map",
]);

export function shouldIndexRepositoryPath(filePath: string): boolean {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.length > 1024 ||
    filePath.startsWith("/") ||
    filePath.includes("..")
  ) {
    return false;
  }

  const segments = filePath.split("/");
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (EXCLUDED_DIR_SEGMENTS.has(segments[i].toLowerCase())) {
      return false;
    }
  }

  const fileName = segments[segments.length - 1].toLowerCase();
  if (!fileName || EXCLUDED_FILENAMES.has(fileName)) {
    return false;
  }

  if (
    fileName.endsWith(".min.js") ||
    fileName.endsWith(".min.css") ||
    fileName.endsWith(".bundle.js")
  ) {
    return false;
  }

  const lastDot = fileName.lastIndexOf(".");
  if (lastDot > 0) {
    const ext = fileName.slice(lastDot);
    if (EXCLUDED_EXTENSIONS.has(ext)) {
      return false;
    }
  }

  return true;
}

function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.trim().split("/");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !/^[A-Za-z0-9_.-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_.-]+$/.test(parts[1])
  ) {
    throw new Error("Invalid GitHub repository full name.");
  }

  return { owner: parts[0], repo: parts[1] };
}

function githubHeaders(installationToken: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${installationToken}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

async function fetchBranchHead(params: {
  installationToken: string;
  owner: string;
  repo: string;
  branch: string;
}): Promise<{ commitSha: string; treeSha: string }> {
  const { installationToken, owner, repo, branch } = params;
  const encodedBranch = branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const url = `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodedBranch}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: githubHeaders(installationToken),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Unable to contact GitHub while resolving repository branch.");
  }

  if (!response.ok) {
    throw new Error(
      `GitHub branch lookup failed with HTTP ${response.status}.`
    );
  }

  let data: GitHubBranchResponse;
  try {
    data = (await response.json()) as GitHubBranchResponse;
  } catch {
    throw new Error("GitHub returned an invalid branch response.");
  }

  const commitSha = data.commit?.sha;
  const treeSha = data.commit?.commit?.tree?.sha;

  if (
    typeof commitSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(commitSha) ||
    typeof treeSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(treeSha)
  ) {
    throw new Error("GitHub returned an incomplete branch commit tree.");
  }

  return { commitSha, treeSha };
}

async function fetchBlobText(params: {
  installationToken: string;
  owner: string;
  repo: string;
  blobSha: string;
}): Promise<string | null> {
  const { installationToken, owner, repo, blobSha } = params;
  const url = `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(blobSha)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: githubHeaders(installationToken),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Unable to contact GitHub while downloading source file.");
  }

  if (!response.ok) {
    throw new Error(
      `GitHub blob download failed with HTTP ${response.status}.`
    );
  }

  let data: GitHubBlobResponse;
  try {
    data = (await response.json()) as GitHubBlobResponse;
  } catch {
    throw new Error("GitHub returned an invalid blob response.");
  }

  if (typeof data.content !== "string") {
    return null;
  }

  let decoded: string;
  if (data.encoding === "base64") {
    const cleaned = data.content.replace(/\s+/g, "");
    const buffer = Buffer.from(cleaned, "base64");
    if (buffer.includes(0)) {
      return null;
    }
    decoded = buffer.toString("utf8");
  } else {
    if (data.content.includes("\u0000")) {
      return null;
    }
    decoded = data.content;
  }

  if (!decoded.trim()) {
    return null;
  }

  return decoded;
}

export async function fetchGitHubRepositorySnapshot(params: {
  installationToken: string;
  fullName: string;
  branch: string | null;
  maxFiles?: number;
  maxFileBytes?: number;
}): Promise<GitHubRepositorySnapshot> {
  const {
    installationToken,
    fullName,
    branch,
    maxFiles = MAX_INDEXABLE_FILES,
    maxFileBytes = MAX_INDEXABLE_FILE_BYTES,
  } = params;

  if (
    typeof installationToken !== "string" ||
    installationToken.trim().length === 0
  ) {
    throw new Error("A valid GitHub installation token is required.");
  }

  const { owner, repo } = parseRepoFullName(fullName);
  const targetBranch =
    typeof branch === "string" && branch.trim().length > 0
      ? branch.trim()
      : "main";

  const { commitSha, treeSha } = await fetchBranchHead({
    installationToken,
    owner,
    repo,
    branch: targetBranch,
  });

  const treeUrl = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeSha)}`,
    GITHUB_API_URL
  );
  treeUrl.searchParams.set("recursive", "1");

  let treeResponse: Response;
  try {
    treeResponse = await fetch(treeUrl.toString(), {
      method: "GET",
      headers: githubHeaders(installationToken),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Unable to contact GitHub while listing repository tree.");
  }

  if (!treeResponse.ok) {
    throw new Error(
      `GitHub tree listing failed with HTTP ${treeResponse.status}.`
    );
  }

  let treeData: GitHubTreeResponse;
  try {
    treeData = (await treeResponse.json()) as GitHubTreeResponse;
  } catch {
    throw new Error("GitHub returned an invalid repository tree response.");
  }

  if (!Array.isArray(treeData.tree)) {
    throw new Error("GitHub returned an incomplete repository tree.");
  }

  const candidates: Array<{ path: string; sha: string; size: number }> = [];
  for (const rawEntry of treeData.tree as GitHubTreeEntryResponse[]) {
    if (rawEntry.type !== "blob") {
      continue;
    }

    if (
      typeof rawEntry.path !== "string" ||
      typeof rawEntry.sha !== "string" ||
      !/^[0-9a-f]{40}$/i.test(rawEntry.sha) ||
      typeof rawEntry.size !== "number" ||
      !Number.isSafeInteger(rawEntry.size) ||
      rawEntry.size <= 0 ||
      rawEntry.size > maxFileBytes
    ) {
      continue;
    }

    if (!shouldIndexRepositoryPath(rawEntry.path)) {
      continue;
    }

    candidates.push({
      path: rawEntry.path,
      sha: rawEntry.sha,
      size: rawEntry.size,
    });
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));

  const truncated =
    Boolean(treeData.truncated) || candidates.length > maxFiles;
  const selectedCandidates = candidates.slice(0, maxFiles);

  const files: GitHubSourceFile[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < selectedCandidates.length) {
      const index = cursor;
      cursor += 1;
      const candidate = selectedCandidates[index];

      const content = await fetchBlobText({
        installationToken,
        owner,
        repo,
        blobSha: candidate.sha,
      });

      if (content !== null) {
        files.push({
          path: candidate.path,
          sha: candidate.sha,
          size: candidate.size,
          content,
        });
      }
    }
  }

  const workerCount = Math.min(BLOB_FETCH_CONCURRENCY, selectedCandidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    branch: targetBranch,
    commitSha,
    files,
    truncated,
  };
}
