import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import {
  chunkSourceFile,
  type CodeChunk,
} from "@/lib/indexing/chunker";
import {
  formatVectorLiteral,
  generateTextEmbeddings,
} from "@/lib/indexing/embeddings";
import { createGitHubInstallationToken } from "@/lib/providers/github/installation";
import {
  fetchGitHubRepositorySnapshot,
  type GitHubRepositorySnapshot,
} from "@/lib/providers/github/tree";
import { getValidGitLabAccessToken } from "@/lib/providers/gitlab/client";
import { fetchGitLabRepositorySnapshot } from "@/lib/providers/gitlab/tree";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_STRING_PATTERN = /^[1-9][0-9]*$/;
const CHUNK_INSERT_BATCH_SIZE = 100;
export const STALE_INDEX_JOB_MS = 10 * 60 * 1000; // 10 minutes

export type RepositoryIndexStatus =
  | "queued"
  | "indexing"
  | "indexed"
  | "failed";

export interface RepositoryIndexJobRecord {
  id: string;
  repositoryId: string;
  ownerId: string;
  status: RepositoryIndexStatus;
  branch: string | null;
  commitSha: string | null;
  filesTotal: number;
  filesIndexed: number;
  chunksTotal: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface IndexingPipelineDependencies {
  createInstallationToken?: (
    installationId: number,
    repositoryIds?: number[]
  ) => Promise<{ token: string }>;
  fetchRepositorySnapshot?: (params: {
    installationToken: string;
    fullName: string;
    branch: string | null;
  }) => Promise<GitHubRepositorySnapshot>;
  getGitLabAccessToken?: (params: {
    ownerId: string;
    connectionId: string;
  }) => Promise<string>;
  fetchGitLabSnapshot?: (params: {
    accessToken: string;
    projectId: string;
    branch: string | null;
  }) => Promise<GitHubRepositorySnapshot>;
  generateEmbeddings?: (inputs: readonly string[]) => Promise<number[][]>;
}

interface IndexJobDbRow {
  id: unknown;
  repository_id: unknown;
  owner_id: unknown;
  status: unknown;
  branch: unknown;
  commit_sha: unknown;
  files_total: unknown;
  files_indexed: unknown;
  chunks_total: unknown;
  error_message: unknown;
  started_at: unknown;
  completed_at: unknown;
  created_at: unknown;
}

interface RepositoryLookupRow {
  id: unknown;
  owner_id: unknown;
  connection_id: unknown;
  provider: unknown;
  provider_repo_id: unknown;
  full_name: unknown;
  default_branch: unknown;
  disconnected_at: unknown;
}

interface ConnectionLookupRow {
  id: unknown;
  installation_id: unknown;
  status: unknown;
}

interface ExistingFileRow {
  id: unknown;
  file_path: unknown;
  blob_sha?: unknown;
  chunk_count?: unknown;
}

interface UpsertedFileRow {
  id: unknown;
  file_path: unknown;
}

const JOB_SELECT_COLUMNS =
  "id, repository_id, owner_id, status, branch, commit_sha, files_total, files_indexed, chunks_total, error_message, started_at, completed_at, created_at";

function parseIndexJobRow(row: IndexJobDbRow): RepositoryIndexJobRecord | null {
  if (
    typeof row.id !== "string" ||
    typeof row.repository_id !== "string" ||
    typeof row.owner_id !== "string" ||
    (row.status !== "queued" &&
      row.status !== "indexing" &&
      row.status !== "indexed" &&
      row.status !== "failed") ||
    !(row.branch === null || typeof row.branch === "string") ||
    !(row.commit_sha === null || typeof row.commit_sha === "string") ||
    typeof row.files_total !== "number" ||
    typeof row.files_indexed !== "number" ||
    typeof row.chunks_total !== "number" ||
    !(row.error_message === null || typeof row.error_message === "string") ||
    !(row.started_at === null || typeof row.started_at === "string") ||
    !(row.completed_at === null || typeof row.completed_at === "string") ||
    typeof row.created_at !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    repositoryId: row.repository_id,
    ownerId: row.owner_id,
    status: row.status,
    branch: row.branch,
    commitSha: row.commit_sha,
    filesTotal: row.files_total,
    filesIndexed: row.files_indexed,
    chunksTotal: row.chunks_total,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export function isIndexJobStale(
  job: RepositoryIndexJobRecord,
  nowMs = Date.now()
): boolean {
  if (job.status !== "queued" && job.status !== "indexing") {
    return false;
  }

  const referenceIso = job.startedAt ?? job.createdAt;
  const referenceMs = Date.parse(referenceIso);
  if (!Number.isFinite(referenceMs)) {
    return false;
  }

  return nowMs - referenceMs > STALE_INDEX_JOB_MS;
}

function sanitizeIndexError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 500);
  }
  return "Repository indexing failed due to an unexpected error.";
}

export type RepositoryIndexJobMap = Map<string, RepositoryIndexJobRecord>;

export async function listLatestRepositoryIndexJobs(
  userClient: SupabaseClient,
  repositoryIds: readonly string[]
): Promise<RepositoryIndexJobMap> {
  const result = new Map<string, RepositoryIndexJobRecord>();
  const validIds = repositoryIds.filter((id) => UUID_PATTERN.test(id));

  if (validIds.length === 0) {
    return result;
  }

  const { data, error } = await userClient
    .from("repository_index_jobs")
    .select(JOB_SELECT_COLUMNS)
    .in("repository_id", validIds)
    .order("created_at", { ascending: false });

  if (error || !Array.isArray(data)) {
    return result;
  }

  for (const rawRow of data) {
    const parsed = parseIndexJobRow(rawRow as IndexJobDbRow);
    if (parsed && !result.has(parsed.repositoryId)) {
      result.set(parsed.repositoryId, parsed);
    }
  }

  return result;
}

export async function enqueueRepositoryIndexJob(
  params: {
    ownerId: string;
    repositoryId: string;
  },
  adminClient: SupabaseClient = createAdminClient()
): Promise<{ job: RepositoryIndexJobRecord; alreadyActive: boolean }> {
  const { ownerId, repositoryId } = params;

  if (!UUID_PATTERN.test(ownerId)) {
    throw new Error("A valid authenticated user ID is required.");
  }

  if (!UUID_PATTERN.test(repositoryId)) {
    throw new Error("A valid repository ID is required.");
  }

  const { data: repoData, error: repoError } = await adminClient
    .from("repositories")
    .select("id, default_branch, disconnected_at")
    .eq("id", repositoryId)
    .eq("owner_id", ownerId)
    .single();

  if (
    repoError ||
    !repoData ||
    (repoData as { disconnected_at?: unknown }).disconnected_at !== null
  ) {
    throw new Error("Active repository not found.");
  }

  const { data: activeJobs } = await adminClient
    .from("repository_index_jobs")
    .select(JOB_SELECT_COLUMNS)
    .eq("repository_id", repositoryId)
    .in("status", ["queued", "indexing"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (Array.isArray(activeJobs) && activeJobs.length > 0) {
    const existing = parseIndexJobRow(activeJobs[0] as IndexJobDbRow);
    if (existing) {
      if (isIndexJobStale(existing)) {
        await adminClient
          .from("repository_index_jobs")
          .update({
            status: "failed",
            error_message: "Previous indexing job timed out before completion.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .in("status", ["queued", "indexing"]);
      } else {
        return { job: existing, alreadyActive: true };
      }
    }
  }

  const defaultBranch =
    typeof (repoData as { default_branch?: unknown }).default_branch ===
    "string"
      ? ((repoData as { default_branch: string }).default_branch.trim() ||
        null)
      : null;

  const { data: insertedData, error: insertError } = await adminClient
    .from("repository_index_jobs")
    .insert({
      repository_id: repositoryId,
      owner_id: ownerId,
      status: "queued",
      branch: defaultBranch,
    })
    .select(JOB_SELECT_COLUMNS)
    .single();

  if (insertError || !insertedData) {
    const pgCode =
      typeof (insertError as { code?: unknown } | null)?.code === "string"
        ? (insertError as { code: string }).code
        : undefined;

    if (pgCode === "23505") {
      const { data: concurrentJobs } = await adminClient
        .from("repository_index_jobs")
        .select(JOB_SELECT_COLUMNS)
        .eq("repository_id", repositoryId)
        .in("status", ["queued", "indexing"])
        .limit(1);

      if (Array.isArray(concurrentJobs) && concurrentJobs.length > 0) {
        const existing = parseIndexJobRow(concurrentJobs[0] as IndexJobDbRow);
        if (existing) {
          return { job: existing, alreadyActive: true };
        }
      }
    }

    throw new Error("Unable to queue repository indexing job.");
  }

  const parsed = parseIndexJobRow(insertedData as IndexJobDbRow);
  if (!parsed) {
    throw new Error("Queued indexing job returned unexpected metadata.");
  }

  return { job: parsed, alreadyActive: false };
}

export async function runRepositoryIndexJob(
  params: {
    jobId: string;
    deps?: IndexingPipelineDependencies;
  },
  adminClient: SupabaseClient = createAdminClient()
): Promise<RepositoryIndexJobRecord> {
  const { jobId, deps = {} } = params;

  if (!UUID_PATTERN.test(jobId)) {
    throw new Error("A valid indexing job ID is required.");
  }

  const createInstallationTokenFn =
    deps.createInstallationToken ?? createGitHubInstallationToken;
  const fetchSnapshotFn =
    deps.fetchRepositorySnapshot ?? fetchGitHubRepositorySnapshot;
  const getGitLabAccessTokenFn =
    deps.getGitLabAccessToken ??
    ((p: { ownerId: string; connectionId: string }) =>
      getValidGitLabAccessToken(p, adminClient));
  const fetchGitLabSnapshotFn =
    deps.fetchGitLabSnapshot ?? fetchGitLabRepositorySnapshot;
  const generateEmbeddingsFn =
    deps.generateEmbeddings ?? generateTextEmbeddings;

  const { data: jobData, error: jobLookupError } = await adminClient
    .from("repository_index_jobs")
    .select(JOB_SELECT_COLUMNS)
    .eq("id", jobId)
    .single();

  if (jobLookupError || !jobData) {
    throw new Error("Indexing job not found.");
  }

  const initialJob = parseIndexJobRow(jobData as IndexJobDbRow);
  if (!initialJob) {
    throw new Error("Indexing job has invalid metadata.");
  }

  if (initialJob.status === "indexed" || initialJob.status === "failed") {
    return initialJob;
  }

  const startedAt = new Date().toISOString();
  await adminClient
    .from("repository_index_jobs")
    .update({
      status: "indexing",
      started_at: startedAt,
      error_message: null,
    })
    .eq("id", jobId);

  try {
    const { data: repoData, error: repoError } = await adminClient
      .from("repositories")
      .select(
        "id, owner_id, connection_id, provider, provider_repo_id, full_name, default_branch, disconnected_at"
      )
      .eq("id", initialJob.repositoryId)
      .eq("owner_id", initialJob.ownerId)
      .single();

    if (repoError || !repoData) {
      throw new Error("Repository record could not be loaded for indexing.");
    }

    const repo = repoData as RepositoryLookupRow;
    if (repo.disconnected_at !== null) {
      throw new Error("Repository was disconnected before indexing completed.");
    }

    if (
      (repo.provider !== "github" && repo.provider !== "gitlab") ||
      typeof repo.connection_id !== "string" ||
      typeof repo.provider_repo_id !== "string" ||
      !POSITIVE_INTEGER_STRING_PATTERN.test(repo.provider_repo_id) ||
      typeof repo.full_name !== "string"
    ) {
      throw new Error("Repository provider metadata is invalid.");
    }

    const targetBranch =
      typeof repo.default_branch === "string" &&
      repo.default_branch.trim().length > 0
        ? repo.default_branch.trim()
        : initialJob.branch;

    let snapshot: GitHubRepositorySnapshot;

    if (repo.provider === "github") {
      const { data: connData, error: connError } = await adminClient
        .from("provider_connections")
        .select("id, installation_id, status")
        .eq("id", repo.connection_id)
        .eq("owner_id", initialJob.ownerId)
        .single();

      if (connError || !connData) {
        throw new Error("GitHub connection not found for repository.");
      }

      const connection = connData as ConnectionLookupRow;
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
          "GitHub connection is no longer active. Reconnect GitHub in Settings."
        );
      }

      const { token: installationToken } = await createInstallationTokenFn(
        Number(rawInstallationId),
        [Number(repo.provider_repo_id)]
      );

      snapshot = await fetchSnapshotFn({
        installationToken,
        fullName: repo.full_name,
        branch: targetBranch,
      });
    } else {
      const accessToken = await getGitLabAccessTokenFn({
        ownerId: initialJob.ownerId,
        connectionId: repo.connection_id,
      });

      snapshot = await fetchGitLabSnapshotFn({
        accessToken,
        projectId: repo.provider_repo_id,
        branch: targetBranch,
      });
    }

    const fileChunkGroups: Array<{
      file: (typeof snapshot.files)[number];
      chunks: CodeChunk[];
      lineCount: number;
    }> = [];

    let totalChunkCount = 0;
    for (const file of snapshot.files) {
      const chunks = chunkSourceFile({
        filePath: file.path,
        content: file.content,
      });
      const lineCount = file.content.replace(/\r\n/g, "\n").split("\n").length;

      fileChunkGroups.push({
        file,
        chunks,
        lineCount,
      });

      totalChunkCount += chunks.length;
    }

    await adminClient
      .from("repository_index_jobs")
      .update({
        branch: snapshot.branch,
        commit_sha: snapshot.commitSha,
        files_total: snapshot.files.length,
        chunks_total: totalChunkCount,
      })
      .eq("id", jobId);

    const { data: existingFiles } = await adminClient
      .from("repository_files")
      .select("id, file_path, blob_sha, chunk_count")
      .eq("repository_id", initialJob.repositoryId)
      .eq("owner_id", initialJob.ownerId);

    const existingFileByPath = new Map<
      string,
      { id: string; blobSha: string | null; chunkCount: number | null }
    >();

    if (Array.isArray(existingFiles)) {
      for (const row of existingFiles as ExistingFileRow[]) {
        if (typeof row.id === "string" && typeof row.file_path === "string") {
          existingFileByPath.set(row.file_path, {
            id: row.id,
            blobSha: typeof row.blob_sha === "string" ? row.blob_sha : null,
            chunkCount:
              typeof row.chunk_count === "number" ? row.chunk_count : null,
          });
        }
      }
    }

    const existingChunkCountByFileId = new Map<string, number>();
    if (existingFileByPath.size > 0) {
      const { data: existingChunkRows } = await adminClient
        .from("repository_chunks")
        .select("file_id")
        .eq("repository_id", initialJob.repositoryId)
        .eq("owner_id", initialJob.ownerId);

      if (Array.isArray(existingChunkRows)) {
        for (const row of existingChunkRows as Array<{ file_id?: unknown }>) {
          if (typeof row.file_id === "string") {
            existingChunkCountByFileId.set(
              row.file_id,
              (existingChunkCountByFileId.get(row.file_id) ?? 0) + 1
            );
          }
        }
      }
    }

    const activePaths = new Set(snapshot.files.map((f) => f.path));
    const staleFileIds: string[] = [];
    for (const [filePath, existing] of existingFileByPath.entries()) {
      if (!activePaths.has(filePath)) {
        staleFileIds.push(existing.id);
      }
    }

    const unchangedGroups: Array<{
      group: (typeof fileChunkGroups)[number];
      existingId: string;
    }> = [];
    const changedGroups: Array<(typeof fileChunkGroups)[number]> = [];
    const changedExistingFileIds: string[] = [];

    for (const group of fileChunkGroups) {
      const existing = existingFileByPath.get(group.file.path);
      const persistedChunkCount = existing
        ? (existingChunkCountByFileId.get(existing.id) ?? 0)
        : 0;
      const isUnchanged =
        existing !== undefined &&
        existing.blobSha !== null &&
        existing.blobSha === group.file.sha &&
        existing.chunkCount === group.chunks.length &&
        persistedChunkCount === group.chunks.length;

      if (isUnchanged) {
        unchangedGroups.push({ group, existingId: existing.id });
      } else {
        changedGroups.push(group);
        if (existing) {
          changedExistingFileIds.push(existing.id);
        }
      }
    }

    const chunksToEmbed: CodeChunk[] = [];
    for (const group of changedGroups) {
      chunksToEmbed.push(...group.chunks);
    }

    const embeddings =
      chunksToEmbed.length > 0
        ? await generateEmbeddingsFn(chunksToEmbed.map((c) => c.content))
        : [];

    if (embeddings.length !== chunksToEmbed.length) {
      throw new Error(
        "Embedding count did not match generated repository chunk count."
      );
    }

    const fileIdsToClearChunks = [...staleFileIds, ...changedExistingFileIds];
    if (fileIdsToClearChunks.length > 0) {
      const { error: deleteChunksError } = await adminClient
        .from("repository_chunks")
        .delete()
        .eq("repository_id", initialJob.repositoryId)
        .eq("owner_id", initialJob.ownerId)
        .in("file_id", fileIdsToClearChunks);

      if (deleteChunksError) {
        throw new Error("Unable to clear previous repository search chunks.");
      }
    }

    if (staleFileIds.length > 0) {
      const { error: deleteStaleFilesError } = await adminClient
        .from("repository_files")
        .delete()
        .eq("repository_id", initialJob.repositoryId)
        .eq("owner_id", initialJob.ownerId)
        .in("id", staleFileIds);

      if (deleteStaleFilesError) {
        throw new Error("Unable to prune removed repository files.");
      }
    }

    const fileIdByPath = new Map<string, string>();
    for (const item of unchangedGroups) {
      fileIdByPath.set(item.group.file.path, item.existingId);
    }

    if (changedGroups.length > 0) {
      const fileRowsPayload = changedGroups.map((group) => ({
        repository_id: initialJob.repositoryId,
        owner_id: initialJob.ownerId,
        file_path: group.file.path,
        blob_sha: group.file.sha,
        language:
          group.chunks[0]?.language ??
          chunkSourceFile({
            filePath: group.file.path,
            content: "x",
          })[0]?.language ??
          "text",
        byte_size: group.file.size,
        line_count: group.lineCount,
        chunk_count: group.chunks.length,
      }));

      const { data: upsertedFiles, error: fileUpsertError } = await adminClient
        .from("repository_files")
        .upsert(fileRowsPayload, {
          onConflict: "repository_id,file_path",
        })
        .select("id, file_path");

      if (fileUpsertError || !Array.isArray(upsertedFiles)) {
        throw new Error("Unable to persist indexed repository file metadata.");
      }

      for (const row of upsertedFiles as UpsertedFileRow[]) {
        if (typeof row.id === "string" && typeof row.file_path === "string") {
          fileIdByPath.set(row.file_path, row.id);
        }
      }
    }

    if (chunksToEmbed.length > 0) {
      const chunkRowsPayload = chunksToEmbed.map((chunk, idx) => {
        const fileId = fileIdByPath.get(chunk.filePath);
        if (!fileId) {
          throw new Error(
            `Missing persisted file reference for ${chunk.filePath}.`
          );
        }

        return {
          repository_id: initialJob.repositoryId,
          file_id: fileId,
          owner_id: initialJob.ownerId,
          file_path: chunk.filePath,
          language: chunk.language,
          chunk_index: chunk.chunkIndex,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          token_count: chunk.tokenCount,
          content: chunk.content,
          embedding: formatVectorLiteral(embeddings[idx]),
        };
      });

      for (
        let offset = 0;
        offset < chunkRowsPayload.length;
        offset += CHUNK_INSERT_BATCH_SIZE
      ) {
        const batch = chunkRowsPayload.slice(
          offset,
          offset + CHUNK_INSERT_BATCH_SIZE
        );
        const { error: chunkInsertError } = await adminClient
          .from("repository_chunks")
          .insert(batch);

        if (chunkInsertError) {
          throw new Error("Unable to persist embedded repository chunks.");
        }
      }
    }

    const completedAt = new Date().toISOString();
    const { data: finishedData, error: finishError } = await adminClient
      .from("repository_index_jobs")
      .update({
        status: "indexed",
        branch: snapshot.branch,
        commit_sha: snapshot.commitSha,
        files_total: snapshot.files.length,
        files_indexed: snapshot.files.length,
        chunks_total: totalChunkCount,
        error_message: null,
        completed_at: completedAt,
      })
      .eq("id", jobId)
      .select(JOB_SELECT_COLUMNS)
      .single();

    if (finishError || !finishedData) {
      throw new Error("Unable to finalize repository indexing status.");
    }

    const parsedFinished = parseIndexJobRow(finishedData as IndexJobDbRow);
    if (!parsedFinished) {
      throw new Error("Finalized indexing job returned unexpected metadata.");
    }

    return parsedFinished;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = sanitizeIndexError(error);

    const { data: failedData } = await adminClient
      .from("repository_index_jobs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: completedAt,
      })
      .eq("id", jobId)
      .select(JOB_SELECT_COLUMNS)
      .single();

    if (failedData) {
      const parsedFailed = parseIndexJobRow(failedData as IndexJobDbRow);
      if (parsedFailed) {
        return parsedFailed;
      }
    }

    return {
      ...initialJob,
      status: "failed",
      errorMessage: message,
      startedAt,
      completedAt,
    };
  }
}

export async function scheduleRepositoryIndexJob(
  params: {
    ownerId: string;
    repositoryId: string;
  },
  adminClient: SupabaseClient = createAdminClient()
): Promise<{ job: RepositoryIndexJobRecord; alreadyActive: boolean }> {
  const queued = await enqueueRepositoryIndexJob(params, adminClient);

  if (!queued.alreadyActive) {
    const jobId = queued.job.id;
    const runTask = async () => {
      try {
        await runRepositoryIndexJob({ jobId }, adminClient);
      } catch {
        // Errors are persisted onto repository_index_jobs inside runRepositoryIndexJob
      }
    };

    try {
      after(runTask);
    } catch {
      queueMicrotask(() => {
        void runTask();
      });
    }
  }

  return queued;
}
