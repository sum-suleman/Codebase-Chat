import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatVectorLiteral,
  generateTextEmbeddings,
} from "@/lib/indexing/embeddings";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SearchableRepository {
  id: string;
  fullName: string;
  canonicalUrl: string;
  defaultBranch: string | null;
}

export interface SemanticSearchHit {
  chunkId: string;
  repositoryId: string;
  repositoryFullName: string;
  fileId: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  similarity: number;
  snippet: string;
  externalUrl: string | null;
}

export interface GlobalCodeSearchResult {
  query: string;
  searchedRepositoriesCount: number;
  hits: SemanticSearchHit[];
}

export interface CodeSearchDependencies {
  embedQuery?: (query: string) => Promise<number[]>;
}

function buildProviderLineUrl(
  canonicalUrl: string,
  branch: string | null,
  filePath: string,
  startLine: number,
  endLine: number
): string | null {
  const trimmedBase = canonicalUrl.trim().replace(/\/+$/, "");
  const ref = encodeURIComponent(branch?.trim() || "HEAD");
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  if (trimmedBase.startsWith("https://github.com/")) {
    const anchor =
      startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
    return `${trimmedBase}/blob/${ref}/${encodedPath}#${anchor}`;
  }

  if (trimmedBase.startsWith("https://gitlab.com/")) {
    const anchor =
      startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
    return `${trimmedBase}/-/blob/${ref}/${encodedPath}#${anchor}`;
  }

  return null;
}

function trimSnippetLines(content: string, maxLines = 18): string {
  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return content;
  }
  return `${lines.slice(0, maxLines).join("\n")}\n// ...`;
}

function extractSearchTokens(query: string): string[] {
  const matches = query.match(/[A-Za-z0-9_./-]{3,}/g) ?? [];
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "how",
    "does",
    "what",
    "where",
    "when",
    "why",
    "which",
    "this",
    "that",
    "from",
    "into",
    "are",
    "can",
    "you",
    "find",
    "show",
    "code",
    "file",
    "files",
  ]);

  const unique: string[] = [];
  for (const raw of matches) {
    if (stopWords.has(raw.toLowerCase())) {
      continue;
    }
    if (!unique.includes(raw)) {
      unique.push(raw);
    }
    if (unique.length >= 3) {
      break;
    }
  }
  return unique;
}

function escapeIlikeToken(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_./-]/g, "");
  return cleaned.replace(/[%_\\]/g, "\\$&");
}

export async function searchCodebaseSemantically(
  params: {
    userClient: SupabaseClient;
    query: string;
    repositoryId?: string | null;
    limit?: number;
    similarityThreshold?: number;
  },
  deps: CodeSearchDependencies = {}
): Promise<GlobalCodeSearchResult> {
  const query = params.query.trim();
  if (!query) {
    throw new Error("Search query cannot be empty.");
  }

  const targetRepositoryId = params.repositoryId?.trim() || null;
  if (targetRepositoryId && !UUID_PATTERN.test(targetRepositoryId)) {
    throw new Error("Invalid repository identifier.");
  }

  let repoQuery = params.userClient
    .from("repositories")
    .select("id, full_name, canonical_url, default_branch, disconnected_at")
    .is("disconnected_at", null)
    .order("updated_at", { ascending: false });

  if (targetRepositoryId) {
    repoQuery = repoQuery.eq("id", targetRepositoryId);
  }

  const { data: repoRows, error: repoError } = await repoQuery;
  if (repoError) {
    throw new Error("Unable to load connected repositories.");
  }

  const repositories: SearchableRepository[] = [];
  for (const row of (repoRows ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.id !== "string" || typeof row.full_name !== "string") {
      continue;
    }
    repositories.push({
      id: row.id,
      fullName: row.full_name,
      canonicalUrl:
        typeof row.canonical_url === "string" ? row.canonical_url : "",
      defaultBranch:
        typeof row.default_branch === "string" ? row.default_branch : null,
    });
  }

  if (repositories.length === 0) {
    if (targetRepositoryId) {
      throw new Error("Selected repository was not found or is disconnected.");
    }
    return {
      query,
      searchedRepositoriesCount: 0,
      hits: [],
    };
  }

  const embedQuery =
    deps.embedQuery ??
    (async (q: string) => {
      const vectors = await generateTextEmbeddings([q]);
      return vectors[0];
    });

  const queryVector = await embedQuery(query);
  const vectorLiteral = formatVectorLiteral(queryVector);
  const totalLimit = Math.max(1, Math.min(30, params.limit ?? 15));
  const perRepoCount =
    repositories.length === 1
      ? totalLimit
      : Math.max(4, Math.min(10, Math.ceil((totalLimit * 1.5) / repositories.length)));
  const similarityThreshold = params.similarityThreshold ?? 0.2;

  const hitMap = new Map<string, SemanticSearchHit>();

  await Promise.all(
    repositories.map(async (repo) => {
      const { data: rpcRows } = await params.userClient.rpc(
        "match_repository_chunks",
        {
          p_repository_id: repo.id,
          p_query_embedding: vectorLiteral,
          p_match_count: perRepoCount,
          p_similarity_threshold: similarityThreshold,
        }
      );

      if (!Array.isArray(rpcRows)) {
        return;
      }

      for (const raw of rpcRows as Array<Record<string, unknown>>) {
        if (
          typeof raw.id !== "string" ||
          typeof raw.file_id !== "string" ||
          typeof raw.file_path !== "string" ||
          typeof raw.content !== "string"
        ) {
          continue;
        }

        const startLine = typeof raw.start_line === "number" ? raw.start_line : 1;
        const endLine = typeof raw.end_line === "number" ? raw.end_line : 1;
        const similarity =
          typeof raw.similarity === "number" && Number.isFinite(raw.similarity)
            ? Number(raw.similarity.toFixed(4))
            : 0;

        hitMap.set(raw.id, {
          chunkId: raw.id,
          repositoryId: repo.id,
          repositoryFullName: repo.fullName,
          fileId: raw.file_id,
          filePath: raw.file_path,
          language: typeof raw.language === "string" ? raw.language : "text",
          startLine,
          endLine,
          similarity,
          snippet: trimSnippetLines(raw.content),
          externalUrl: buildProviderLineUrl(
            repo.canonicalUrl,
            repo.defaultBranch,
            raw.file_path,
            startLine,
            endLine
          ),
        });
      }
    })
  );

  // Keyword/path fallback when semantic matches are sparse
  if (hitMap.size < 4) {
    const tokens = extractSearchTokens(query);
    const repoMap = new Map(repositories.map((r) => [r.id, r]));
    const repoIds = repositories.map((r) => r.id);

    for (const token of tokens) {
      if (hitMap.size >= totalLimit) {
        break;
      }
      const escaped = escapeIlikeToken(token);
      if (escaped.length < 2) {
        continue;
      }

      const { data: fallbackRows } = await params.userClient
        .from("repository_chunks")
        .select(
          "id, repository_id, file_id, file_path, language, start_line, end_line, content"
        )
        .in("repository_id", repoIds)
        .or(`file_path.ilike."%${escaped}%",content.ilike."%${escaped}%"`)
        .limit(6);

      if (!Array.isArray(fallbackRows)) {
        continue;
      }

      for (const raw of fallbackRows as Array<Record<string, unknown>>) {
        if (
          typeof raw.id !== "string" ||
          hitMap.has(raw.id) ||
          typeof raw.repository_id !== "string" ||
          typeof raw.file_id !== "string" ||
          typeof raw.file_path !== "string" ||
          typeof raw.content !== "string"
        ) {
          continue;
        }

        const repo = repoMap.get(raw.repository_id);
        if (!repo) {
          continue;
        }

        const startLine = typeof raw.start_line === "number" ? raw.start_line : 1;
        const endLine = typeof raw.end_line === "number" ? raw.end_line : 1;

        hitMap.set(raw.id, {
          chunkId: raw.id,
          repositoryId: repo.id,
          repositoryFullName: repo.fullName,
          fileId: raw.file_id,
          filePath: raw.file_path,
          language: typeof raw.language === "string" ? raw.language : "text",
          startLine,
          endLine,
          similarity: 0.25,
          snippet: trimSnippetLines(raw.content),
          externalUrl: buildProviderLineUrl(
            repo.canonicalUrl,
            repo.defaultBranch,
            raw.file_path,
            startLine,
            endLine
          ),
        });
      }
    }
  }

  const hits = Array.from(hitMap.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, totalLimit);

  return {
    query,
    searchedRepositoriesCount: repositories.length,
    hits,
  };
}
