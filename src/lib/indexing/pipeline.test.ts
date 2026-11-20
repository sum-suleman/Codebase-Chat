import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { EMBEDDING_DIMENSIONS } from "@/lib/indexing/embeddings";
import {
  enqueueRepositoryIndexJob,
  runRepositoryIndexJob,
} from "@/lib/indexing/pipeline";

const TEST_OWNER_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_REPO_ID = "770e8400-e29b-41d4-a716-446655440000";
const TEST_CONN_ID = "660e8400-e29b-41d4-a716-446655440000";
const TEST_JOB_ID = "880e8400-e29b-41d4-a716-446655440000";
const TEST_NEW_JOB_ID = "880e8400-e29b-41d4-a716-446655440001";
const TEST_FILE_ID = "990e8400-e29b-41d4-a716-446655440000";

describe("indexing/pipeline", () => {
  it("returns an existing active job idempotently when recently queued or indexing", async () => {
    const nowIso = new Date().toISOString();
    const activeJobRow = {
      id: TEST_JOB_ID,
      repository_id: TEST_REPO_ID,
      owner_id: TEST_OWNER_ID,
      status: "indexing",
      branch: "main",
      commit_sha: null,
      files_total: 4,
      files_indexed: 0,
      chunks_total: 10,
      error_message: null,
      started_at: nowIso,
      completed_at: null,
      created_at: nowIso,
    };

    const mockAdmin = {
      from(table: string) {
        if (table === "repositories") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        async single() {
                          return {
                            data: {
                              id: TEST_REPO_ID,
                              default_branch: "main",
                              disconnected_at: null,
                            },
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "repository_index_jobs") {
          return {
            select() {
              return {
                eq() {
                  return {
                    in() {
                      return {
                        order() {
                          return {
                            async limit() {
                              return { data: [activeJobRow], error: null };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const result = await enqueueRepositoryIndexJob(
      { ownerId: TEST_OWNER_ID, repositoryId: TEST_REPO_ID },
      mockAdmin
    );

    assert.equal(result.alreadyActive, true);
    assert.equal(result.job.id, TEST_JOB_ID);
    assert.equal(result.job.status, "indexing");
  });

  it("marks stale active jobs as failed and queues a fresh job", async () => {
    const staleIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const freshIso = new Date().toISOString();
    const staleUpdates: Array<Record<string, unknown>> = [];

    const staleJobRow = {
      id: TEST_JOB_ID,
      repository_id: TEST_REPO_ID,
      owner_id: TEST_OWNER_ID,
      status: "indexing",
      branch: "main",
      commit_sha: null,
      files_total: 4,
      files_indexed: 0,
      chunks_total: 10,
      error_message: null,
      started_at: staleIso,
      completed_at: null,
      created_at: staleIso,
    };

    const mockAdmin = {
      from(table: string) {
        if (table === "repositories") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        async single() {
                          return {
                            data: {
                              id: TEST_REPO_ID,
                              default_branch: "main",
                              disconnected_at: null,
                            },
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "repository_index_jobs") {
          return {
            select() {
              return {
                eq() {
                  return {
                    in() {
                      return {
                        order() {
                          return {
                            async limit() {
                              return { data: [staleJobRow], error: null };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
            update(values: Record<string, unknown>) {
              staleUpdates.push(values);
              return {
                eq() {
                  return {
                    async in() {
                      return { error: null };
                    },
                  };
                },
              };
            },
            insert(values: Record<string, unknown>) {
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: {
                          id: TEST_NEW_JOB_ID,
                          repository_id: values.repository_id,
                          owner_id: values.owner_id,
                          status: "queued",
                          branch: values.branch,
                          commit_sha: null,
                          files_total: 0,
                          files_indexed: 0,
                          chunks_total: 0,
                          error_message: null,
                          started_at: null,
                          completed_at: null,
                          created_at: freshIso,
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const result = await enqueueRepositoryIndexJob(
      { ownerId: TEST_OWNER_ID, repositoryId: TEST_REPO_ID },
      mockAdmin
    );

    assert.equal(result.alreadyActive, false);
    assert.equal(result.job.id, TEST_NEW_JOB_ID);
    assert.equal(result.job.status, "queued");
    assert.equal(staleUpdates.length, 1);
    assert.equal(staleUpdates[0].status, "failed");
  });

  it("executes a queued job end-to-end and persists files, chunks, and indexed status", async () => {
    const insertedChunks: Array<Record<string, unknown>> = [];
    let upsertedFilesPayload: Array<Record<string, unknown>> = [];
    const recordedJobUpdates: Array<Record<string, unknown>> = [];

    const queuedJobRow = {
      id: TEST_JOB_ID,
      repository_id: TEST_REPO_ID,
      owner_id: TEST_OWNER_ID,
      status: "queued",
      branch: "main",
      commit_sha: null,
      files_total: 0,
      files_indexed: 0,
      chunks_total: 0,
      error_message: null,
      started_at: null,
      completed_at: null,
      created_at: "2026-11-13T16:00:00Z",
    };

    const mockAdmin = {
      from(table: string) {
        if (table === "repository_index_jobs") {
          return {
            select() {
              return {
                eq() {
                  return {
                    async single() {
                      return { data: queuedJobRow, error: null };
                    },
                  };
                },
              };
            },
            update(values: Record<string, unknown>) {
              recordedJobUpdates.push(values);
              return {
                eq() {
                  return {
                    select() {
                      return {
                        async single() {
                          return {
                            data: {
                              ...queuedJobRow,
                              ...values,
                            },
                            error: null,
                          };
                        },
                      };
                    },
                    then(resolve: (val: { error: null }) => void) {
                      resolve({ error: null });
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "repositories") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        async single() {
                          return {
                            data: {
                              id: TEST_REPO_ID,
                              owner_id: TEST_OWNER_ID,
                              connection_id: TEST_CONN_ID,
                              provider: "github",
                              provider_repo_id: "9001",
                              full_name: "octocat/hello-world",
                              default_branch: "main",
                              disconnected_at: null,
                            },
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "provider_connections") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        async single() {
                          return {
                            data: {
                              id: TEST_CONN_ID,
                              installation_id: 987654,
                              status: "active",
                            },
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "repository_chunks") {
          return {
            delete() {
              return {
                eq() {
                  return {
                    async eq() {
                      return { error: null };
                    },
                  };
                },
              };
            },
            async insert(rows: Array<Record<string, unknown>>) {
              insertedChunks.push(...rows);
              return { error: null };
            },
          };
        }

        if (table === "repository_files") {
          return {
            select() {
              return {
                eq() {
                  return {
                    async eq() {
                      return { data: [], error: null };
                    },
                  };
                },
              };
            },
            upsert(rows: Array<Record<string, unknown>>) {
              upsertedFilesPayload = rows;
              return {
                async select() {
                  return {
                    data: [
                      {
                        id: TEST_FILE_ID,
                        file_path: "src/index.ts",
                      },
                    ],
                    error: null,
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const unitVector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.25);

    const completed = await runRepositoryIndexJob(
      {
        jobId: TEST_JOB_ID,
        deps: {
          createInstallationToken: async () => ({
            token: "ghs_scoped_token",
          }),
          fetchRepositorySnapshot: async () => ({
            branch: "main",
            commitSha: "abc123def456",
            truncated: false,
            skippedCount: 0,
            files: [
              {
                path: "src/index.ts",
                sha: "blobsha1",
                size: 42,
                content: "export function hello() {\n  return 42;\n}\n",
              },
            ],
          }),
          generateEmbeddings: async (inputs) =>
            inputs.map(() => unitVector),
        },
      },
      mockAdmin
    );

    assert.equal(completed.status, "indexed");
    assert.equal(completed.commitSha, "abc123def456");
    assert.equal(completed.filesIndexed, 1);
    assert.equal(completed.chunksTotal, 1);
    assert.equal(upsertedFilesPayload.length, 1);
    assert.equal(upsertedFilesPayload[0].file_path, "src/index.ts");
    assert.equal(insertedChunks.length, 1);
    assert.equal(insertedChunks[0].file_id, TEST_FILE_ID);
    assert.equal(insertedChunks[0].start_line, 1);
    assert.equal(insertedChunks[0].end_line, 3);
    assert.ok(recordedJobUpdates.some((u) => u.status === "indexed"));
  });
});
