import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { searchCodebaseSemantically } from "@/lib/search/code-search";

describe("search/code-search", () => {
  it("rejects empty search queries and invalid repository UUIDs", async () => {
    const mockClient = {} as unknown as SupabaseClient;

    await assert.rejects(
      () => searchCodebaseSemantically({ userClient: mockClient, query: "   " }),
      /Search query cannot be empty/
    );

    await assert.rejects(
      () =>
        searchCodebaseSemantically({
          userClient: mockClient,
          query: "auth middleware",
          repositoryId: "not-a-uuid",
        }),
      /Invalid repository identifier/
    );
  });

  it("searches across multiple repositories, ranks by similarity, and builds provider deep links", async () => {
    const repoA = "11111111-1111-4111-8111-111111111111";
    const repoB = "22222222-2222-4222-8222-222222222222";

    const mockClient = {
      from: (table: string) => {
        if (table === "repositories") {
          return {
            select: () => ({
              is: () => ({
                order: async () => ({
                  data: [
                    {
                      id: repoA,
                      full_name: "acme/api",
                      canonical_url: "https://github.com/acme/api",
                      default_branch: "main",
                      disconnected_at: null,
                    },
                    {
                      id: repoB,
                      full_name: "acme/web",
                      canonical_url: "https://gitlab.com/acme/web",
                      default_branch: "develop",
                      disconnected_at: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }

        assert.equal(table, "repository_chunks");
        return {
          select: () => ({
            in: () => ({
              or: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      },
      rpc: async (_fn: string, args: { p_repository_id: string }) => {
        if (args.p_repository_id === repoA) {
          return {
            data: [
              {
                id: "chunk-a1",
                file_id: "file-a1",
                file_path: "src/auth/jwt.ts",
                language: "typescript",
                start_line: 10,
                end_line: 25,
                content: "export function verifyJwt(token: string) {}",
                similarity: 0.81,
              },
            ],
            error: null,
          };
        }
        return {
          data: [
            {
              id: "chunk-b1",
              file_id: "file-b1",
              file_path: "app/login/page.tsx",
              language: "typescript",
              start_line: 1,
              end_line: 18,
              content: "export default function LoginPage() {}",
              similarity: 0.92,
            },
          ],
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const result = await searchCodebaseSemantically(
      {
        userClient: mockClient,
        query: "JWT authentication flow",
      },
      {
        embedQuery: async () => new Array(1536).fill(0.01),
      }
    );

    assert.equal(result.searchedRepositoriesCount, 2);
    assert.equal(result.hits.length, 2);
    assert.equal(result.hits[0].chunkId, "chunk-b1");
    assert.equal(
      result.hits[0].externalUrl,
      "https://gitlab.com/acme/web/-/blob/develop/app/login/page.tsx#L1-18"
    );
    assert.equal(result.hits[1].chunkId, "chunk-a1");
    assert.equal(
      result.hits[1].externalUrl,
      "https://github.com/acme/api/blob/main/src/auth/jwt.ts#L10-L25"
    );
  });
});
