import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatVectorLiteral,
  generateTextEmbeddings,
} from "@/lib/indexing/embeddings";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CodeCitation {
  index: number;
  chunkId: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  similarity: number;
  snippet: string;
  githubUrl: string | null;
}

export interface RetrievedCodeChunk {
  id: string;
  repositoryId: string;
  fileId: string;
  filePath: string;
  language: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  similarity: number;
}

export interface RetrieveCodebaseContextResult {
  repository: {
    id: string;
    fullName: string;
    canonicalUrl: string;
    defaultBranch: string | null;
  };
  chunks: RetrievedCodeChunk[];
  citations: CodeCitation[];
}

export interface RetrievalDependencies {
  embedQuery?: (query: string) => Promise<number[]>;
}

function buildGitHubLineUrl(
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

function buildSnippetPreview(content: string, maxLines = 14): string {
  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return content;
  }
  return `${lines.slice(0, maxLines).join("\n")}\n// ...`;
}

function extractKeywordTokens(question: string): string[] {
  const matches = question.match(/[A-Za-z0-9_./-]{3,}/g) ?? [];
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
    "explain",
    "show",
    "find",
    "code",
    "file",
    "files",
  ]);

  const unique: string[] = [];
  for (const raw of matches) {
    const lower = raw.toLowerCase();
    if (stopWords.has(lower)) {
      continue;
    }
    if (!unique.includes(raw)) {
      unique.push(raw);
    }
    if (unique.length >= 4) {
      break;
    }
  }
  return unique;
}

function sanitizeFallbackToken(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_./-]/g, "");
  return cleaned.replace(/[%_\\]/g, "\\$&");
}

export async function retrieveCodebaseContext(
  params: {
    userClient: SupabaseClient;
    repositoryId: string;
    question: string;
    matchCount?: number;
    similarityThreshold?: number;
  },
  deps: RetrievalDependencies = {}
): Promise<RetrieveCodebaseContextResult> {
  const repositoryId = params.repositoryId.trim();
  if (!UUID_PATTERN.test(repositoryId)) {
    throw new Error("Invalid repository identifier.");
  }

  const question = params.question.trim();
  if (!question) {
    throw new Error("Question cannot be empty.");
  }

  const { data: repoRow, error: repoError } = await params.userClient
    .from("repositories")
    .select("id, full_name, canonical_url, default_branch, disconnected_at")
    .eq("id", repositoryId)
    .is("disconnected_at", null)
    .single();

  if (repoError || !repoRow || typeof repoRow.full_name !== "string") {
    throw new Error("Repository not found or disconnected.");
  }

  const { count: chunkCount, error: countError } = await params.userClient
    .from("repository_chunks")
    .select("id", { count: "exact", head: true })
    .eq("repository_id", repositoryId);

  if (countError) {
    throw new Error("Unable to verify repository index state.");
  }

  if (!chunkCount || chunkCount <= 0) {
    throw new Error(
      "This repository has not been indexed yet. Run indexing from Repositories first."
    );
  }

  const embedQuery =
    deps.embedQuery ??
    (async (q: string) => {
      const vectors = await generateTextEmbeddings([q]);
      return vectors[0];
    });

  const queryVector = await embedQuery(question);
  const vectorLiteral = formatVectorLiteral(queryVector);
  const matchCount = Math.max(1, Math.min(20, params.matchCount ?? 8));
  const similarityThreshold = params.similarityThreshold ?? 0.2;

  const { data: rpcRows, error: rpcError } = await params.userClient.rpc(
    "match_repository_chunks",
    {
      p_repository_id: repositoryId,
      p_query_embedding: vectorLiteral,
      p_match_count: matchCount,
      p_similarity_threshold: similarityThreshold,
    }
  );

  if (rpcError) {
    throw new Error("Semantic search across repository chunks failed.");
  }

  const chunkMap = new Map<string, RetrievedCodeChunk>();

  if (Array.isArray(rpcRows)) {
    for (const raw of rpcRows as Array<Record<string, unknown>>) {
      if (
        typeof raw.id !== "string" ||
        typeof raw.file_id !== "string" ||
        typeof raw.file_path !== "string" ||
        typeof raw.content !== "string"
      ) {
        continue;
      }

      chunkMap.set(raw.id, {
        id: raw.id,
        repositoryId:
          typeof raw.repository_id === "string" ? raw.repository_id : repositoryId,
        fileId: raw.file_id,
        filePath: raw.file_path,
        language: typeof raw.language === "string" ? raw.language : "text",
        chunkIndex: typeof raw.chunk_index === "number" ? raw.chunk_index : 0,
        startLine: typeof raw.start_line === "number" ? raw.start_line : 1,
        endLine: typeof raw.end_line === "number" ? raw.end_line : 1,
        content: raw.content,
        similarity:
          typeof raw.similarity === "number" && Number.isFinite(raw.similarity)
            ? raw.similarity
            : 0,
      });
    }
  }

  // Keyword / path fallback when vector recall is sparse (e.g., exact identifiers or file paths)
  if (chunkMap.size < 3) {
    const keywords = extractKeywordTokens(question);
    for (const token of keywords) {
      if (chunkMap.size >= matchCount) {
        break;
      }

      const escaped = sanitizeFallbackToken(token);
      if (escaped.length < 2) {
        continue;
      }

      const { data: fallbackRows } = await params.userClient
        .from("repository_chunks")
        .select(
          "id, repository_id, file_id, file_path, language, chunk_index, start_line, end_line, content"
        )
        .eq("repository_id", repositoryId)
        .or(`file_path.ilike."%${escaped}%",content.ilike."%${escaped}%"`)
        .limit(4);

      if (Array.isArray(fallbackRows)) {
        for (const raw of fallbackRows as Array<Record<string, unknown>>) {
          if (
            typeof raw.id !== "string" ||
            chunkMap.has(raw.id) ||
            typeof raw.file_id !== "string" ||
            typeof raw.file_path !== "string" ||
            typeof raw.content !== "string"
          ) {
            continue;
          }

          chunkMap.set(raw.id, {
            id: raw.id,
            repositoryId,
            fileId: raw.file_id,
            filePath: raw.file_path,
            language: typeof raw.language === "string" ? raw.language : "text",
            chunkIndex: typeof raw.chunk_index === "number" ? raw.chunk_index : 0,
            startLine: typeof raw.start_line === "number" ? raw.start_line : 1,
            endLine: typeof raw.end_line === "number" ? raw.end_line : 1,
            content: raw.content,
            similarity: 0.25,
          });

          if (chunkMap.size >= matchCount) {
            break;
          }
        }
      }
    }
  }

  const chunks = Array.from(chunkMap.values()).slice(0, matchCount);
  const canonicalUrl =
    typeof repoRow.canonical_url === "string" ? repoRow.canonical_url : "";
  const defaultBranch =
    typeof repoRow.default_branch === "string" ? repoRow.default_branch : null;

  const citations: CodeCitation[] = chunks.map((chunk, idx) => ({
    index: idx + 1,
    chunkId: chunk.id,
    filePath: chunk.filePath,
    language: chunk.language,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    similarity: Number(chunk.similarity.toFixed(4)),
    snippet: buildSnippetPreview(chunk.content),
    githubUrl: buildGitHubLineUrl(
      canonicalUrl,
      defaultBranch,
      chunk.filePath,
      chunk.startLine,
      chunk.endLine
    ),
  }));

  return {
    repository: {
      id: repositoryId,
      fullName: repoRow.full_name,
      canonicalUrl,
      defaultBranch,
    },
    chunks,
    citations,
  };
}
