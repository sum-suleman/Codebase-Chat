import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  disconnectUserRepository,
  importGitHubRepository,
  listUserActiveRepositories,
} from "@/lib/repositories/manage";

const TEST_OWNER_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440000";
const TEST_REPO_UUID = "770e8400-e29b-41d4-a716-446655440000";

const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

describe("repositories/manage", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    appId: process.env.GITHUB_APP_ID,
    appSlug: process.env.GITHUB_APP_SLUG,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  };

  beforeEach(() => {
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_APP_SLUG = "codebase-chat-test";
    process.env.GITHUB_APP_PRIVATE_KEY = TEST_PRIVATE_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;

    if (originalEnv.appId === undefined) {
      delete process.env.GITHUB_APP_ID;
    } else {
      process.env.GITHUB_APP_ID = originalEnv.appId;
    }

    if (originalEnv.appSlug === undefined) {
      delete process.env.GITHUB_APP_SLUG;
    } else {
      process.env.GITHUB_APP_SLUG = originalEnv.appSlug;
    }

    if (originalEnv.privateKey === undefined) {
      delete process.env.GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.GITHUB_APP_PRIVATE_KEY = originalEnv.privateKey;
    }
  });

  it("lists active user repositories and skips malformed rows", async () => {
    const mockUserClient = {
      from() {
        return {
          select() {
            return {
              is() {
                return {
                  async order() {
                    return {
                      data: [
                        {
                          id: TEST_REPO_UUID,
                          connection_id: TEST_CONNECTION_ID,
                          provider: "github",
                          provider_repo_id: "9001",
                          full_name: "octocat/hello-world",
                          canonical_url: "https://github.com/octocat/hello-world",
                          default_branch: "main",
                          visibility: "private",
                          provider_archived: false,
                          created_at: "2026-11-13T15:00:00Z",
                          updated_at: "2026-11-13T15:00:00Z",
                        },
                        {
                          id: 999,
                          connection_id: "bad",
                        },
                      ],
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const repos = await listUserActiveRepositories(mockUserClient);
    assert.equal(repos.length, 1);
    assert.equal(repos[0].fullName, "octocat/hello-world");
    assert.equal(repos[0].visibility, "private");
  });

  it("imports an authorized GitHub repository with authoritative metadata", async () => {
    let recordedUpsert: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/app/installations/987654/access_tokens")) {
        return new Response(
          JSON.stringify({
            token: "ghs_test_installation_token",
            expires_at: "2026-11-13T16:00:00Z",
            repository_selection: "selected",
            permissions: { contents: "read", metadata: "read" },
          }),
          { status: 201 }
        );
      }

      if (url.includes("/installation/repositories")) {
        return new Response(
          JSON.stringify({
            total_count: 1,
            repositories: [
              {
                id: 9001,
                full_name: "octocat/hello-world",
                html_url: "https://github.com/octocat/hello-world",
                default_branch: "main",
                visibility: "private",
                archived: false,
              },
            ],
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const mockUserClient = {
      from() {
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
                            id: TEST_CONNECTION_ID,
                            provider: "github",
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
      },
    } as unknown as SupabaseClient;

    const mockAdminClient = {
      from() {
        return {
          upsert(values: Record<string, unknown>) {
            recordedUpsert = values;
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: {
                        id: TEST_REPO_UUID,
                        connection_id: TEST_CONNECTION_ID,
                        provider: "github",
                        provider_repo_id: "9001",
                        full_name: "octocat/hello-world",
                        canonical_url: "https://github.com/octocat/hello-world",
                        default_branch: "main",
                        visibility: "private",
                        provider_archived: false,
                        created_at: "2026-11-13T15:00:00Z",
                        updated_at: "2026-11-13T15:00:00Z",
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
    } as unknown as SupabaseClient;

    const imported = await importGitHubRepository(
      {
        ownerId: TEST_OWNER_ID,
        connectionId: TEST_CONNECTION_ID,
        providerRepoId: "9001",
      },
      mockUserClient,
      mockAdminClient
    );

    assert.equal(imported.id, TEST_REPO_UUID);
    assert.equal(imported.fullName, "octocat/hello-world");
    assert.equal(recordedUpsert?.["disconnected_at"], null);
    assert.equal(recordedUpsert?.["owner_id"], TEST_OWNER_ID);
  });

  it("translates PostgreSQL 23514 limit error into a user-friendly quota message", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/app/installations/987654/access_tokens")) {
        return new Response(
          JSON.stringify({
            token: "ghs_test_installation_token",
            expires_at: "2026-11-13T16:00:00Z",
            repository_selection: "all",
            permissions: { contents: "read", metadata: "read" },
          }),
          { status: 201 }
        );
      }

      return new Response(
        JSON.stringify({
          total_count: 1,
          repositories: [
            {
              id: 9001,
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
              default_branch: "main",
              visibility: "public",
              archived: false,
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const mockUserClient = {
      from() {
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
                            id: TEST_CONNECTION_ID,
                            provider: "github",
                            installation_id: "987654",
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
      },
    } as unknown as SupabaseClient;

    const mockAdminClient = {
      from() {
        return {
          upsert() {
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: null,
                      error: {
                        code: "23514",
                        message:
                          "Repository limit reached: maximum 5 active repositories per user",
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    await assert.rejects(
      importGitHubRepository(
        {
          ownerId: TEST_OWNER_ID,
          connectionId: TEST_CONNECTION_ID,
          providerRepoId: "9001",
        },
        mockUserClient,
        mockAdminClient
      ),
      /Repository limit reached: you can connect up to 5 active repositories at a time/
    );
  });

  it("soft-disconnects an active repository owned by the user", async () => {
    let updatedPayload: Record<string, unknown> | null = null;

    const mockUserClient = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      async single() {
                        return {
                          data: { id: TEST_REPO_UUID },
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
      },
    } as unknown as SupabaseClient;

    const mockAdminClient = {
      from() {
        return {
          update(payload: Record<string, unknown>) {
            updatedPayload = payload;
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async is() {
                        return { error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    await disconnectUserRepository(
      {
        ownerId: TEST_OWNER_ID,
        repositoryId: TEST_REPO_UUID,
      },
      mockUserClient,
      mockAdminClient
    );

    assert.equal(typeof updatedPayload?.["disconnected_at"], "string");
  });
});
