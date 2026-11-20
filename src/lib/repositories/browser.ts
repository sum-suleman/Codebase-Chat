import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { detectFileLanguage } from "@/lib/indexing/chunker";
import type { UserRepositoryRecord } from "@/lib/repositories/manage";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IndexedFileEntry {
  id: string;
  filePath: string;
  fileName: string;
  directory: string;
  language: string;
  byteSize: number;
  lineCount: number;
  chunkCount: number;
}

export interface ReconstructedCodeLine {
  lineNumber: number;
  text: string;
}

export interface ReconstructedFileContent {
  id: string;
  filePath: string;
  language: string;
  lineCount: number;
  chunkCount: number;
  lines: ReconstructedCodeLine[];
  rawContent: string;
}

export interface RawChunkSegment {
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
}

export function reconstructFileFromChunks(params: {
  id: string;
  filePath: string;
  language?: string;
  chunks: RawChunkSegment[];
}): ReconstructedFileContent {
  const { id, filePath, chunks } = params;
  const language =
    params.language && params.language.trim().length > 0
      ? params.language
      : detectFileLanguage(filePath);

  if (chunks.length === 0) {
    return {
      id,
      filePath,
      language,
      lineCount: 0,
      chunkCount: 0,
      lines: [],
      rawContent: "",
    };
  }

  const orderedChunks = [...chunks].sort(
    (a, b) => a.chunkIndex - b.chunkIndex || a.startLine - b.startLine
  );

  const lineMap = new Map<number, string>();
  let maxLineNumber = 0;

  for (const chunk of orderedChunks) {
    const normalized = chunk.content.replace(/\r\n/g, "\n");
    const splitLines = normalized.split("\n");
    const baseLine = Math.max(1, Math.floor(chunk.startLine));

    for (let offset = 0; offset < splitLines.length; offset += 1) {
      const lineNumber = baseLine + offset;
      lineMap.set(lineNumber, splitLines[offset]);
      if (lineNumber > maxLineNumber) {
        maxLineNumber = lineNumber;
      }
    }
  }

  const lines: ReconstructedCodeLine[] = [];
  for (let lineNum = 1; lineNum <= maxLineNumber; lineNum += 1) {
    lines.push({
      lineNumber: lineNum,
      text: lineMap.get(lineNum) ?? "",
    });
  }

  return {
    id,
    filePath,
    language,
    lineCount: lines.length,
    chunkCount: orderedChunks.length,
    lines,
    rawContent: lines.map((line) => line.text).join("\n"),
  };
}

export async function getUserActiveRepositoryById(
  userClient: SupabaseClient,
  repositoryId: string
): Promise<UserRepositoryRecord | null> {
  if (!UUID_PATTERN.test(repositoryId)) {
    return null;
  }

  const { data, error } = await userClient
    .from("repositories")
    .select(
      "id, connection_id, provider, provider_repo_id, full_name, canonical_url, default_branch, visibility, provider_archived, created_at, updated_at"
    )
    .eq("id", repositoryId)
    .is("disconnected_at", null)
    .single();

  if (error || !data) {
    return null;
  }

  const row = data as Record<string, unknown>;
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

export async function listIndexedRepositoryFiles(
  userClient: SupabaseClient,
  repositoryId: string
): Promise<IndexedFileEntry[]> {
  if (!UUID_PATTERN.test(repositoryId)) {
    return [];
  }

  const { data, error } = await userClient
    .from("repository_files")
    .select("id, file_path, language, byte_size, line_count, chunk_count")
    .eq("repository_id", repositoryId)
    .order("file_path", { ascending: true })
    .limit(2000);

  if (error || !Array.isArray(data)) {
    return [];
  }

  const files: IndexedFileEntry[] = [];
  for (const item of data) {
    const row = item as {
      id?: unknown;
      file_path?: unknown;
      language?: unknown;
      byte_size?: unknown;
      line_count?: unknown;
      chunk_count?: unknown;
    };
    if (typeof row.id !== "string" || typeof row.file_path !== "string") {
      continue;
    }

    const slashIndex = row.file_path.lastIndexOf("/");
    const fileName =
      slashIndex >= 0 ? row.file_path.slice(slashIndex + 1) : row.file_path;
    const directory =
      slashIndex >= 0 ? row.file_path.slice(0, slashIndex) : "";

    files.push({
      id: row.id,
      filePath: row.file_path,
      fileName,
      directory,
      language:
        typeof row.language === "string" && row.language.length > 0
          ? row.language
          : detectFileLanguage(row.file_path),
      byteSize: typeof row.byte_size === "number" ? row.byte_size : 0,
      lineCount: typeof row.line_count === "number" ? row.line_count : 0,
      chunkCount: typeof row.chunk_count === "number" ? row.chunk_count : 0,
    });
  }

  return files;
}

export async function getIndexedRepositoryFileContent(
  userClient: SupabaseClient,
  repositoryId: string,
  fileId: string
): Promise<ReconstructedFileContent | null> {
  if (!UUID_PATTERN.test(repositoryId) || !UUID_PATTERN.test(fileId)) {
    return null;
  }

  const { data: fileRow, error: fileError } = await userClient
    .from("repository_files")
    .select("id, file_path, language")
    .eq("id", fileId)
    .eq("repository_id", repositoryId)
    .single();

  if (
    fileError ||
    !fileRow ||
    typeof (fileRow as { id?: unknown }).id !== "string" ||
    typeof (fileRow as { file_path?: unknown }).file_path !== "string"
  ) {
    return null;
  }

  const { data: chunkRows, error: chunksError } = await userClient
    .from("repository_chunks")
    .select("chunk_index, start_line, end_line, content")
    .eq("repository_id", repositoryId)
    .eq("file_id", fileId)
    .order("chunk_index", { ascending: true });

  if (chunksError || !Array.isArray(chunkRows)) {
    return null;
  }

  const segments: RawChunkSegment[] = [];
  for (const raw of chunkRows) {
    const row = raw as {
      chunk_index?: unknown;
      start_line?: unknown;
      end_line?: unknown;
      content?: unknown;
    };
    if (
      typeof row.chunk_index === "number" &&
      typeof row.start_line === "number" &&
      typeof row.end_line === "number" &&
      typeof row.content === "string"
    ) {
      segments.push({
        chunkIndex: row.chunk_index,
        startLine: row.start_line,
        endLine: row.end_line,
        content: row.content,
      });
    }
  }

  const typedFileRow = fileRow as {
    id: string;
    file_path: string;
    language?: string;
  };

  return reconstructFileFromChunks({
    id: typedFileRow.id,
    filePath: typedFileRow.file_path,
    language: typedFileRow.language,
    chunks: segments,
  });
}
