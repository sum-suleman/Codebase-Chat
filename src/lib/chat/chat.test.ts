import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveConversationTitle } from "@/lib/chat/conversations";
import {
  buildGroundedSystemPrompt,
  createGroundedAnswerStream,
} from "@/lib/chat/llm";
import { retrieveCodebaseContext } from "@/lib/chat/retrieval";
import { EMBEDDING_DIMENSIONS } from "@/lib/indexing/embeddings";

const TEST_REPO_ID = "770e8400-e29b-41d4-a716-446655440000";
const TEST_FILE_ID = "990e8400-e29b-41d4-a716-446655440000";
const TEST_CHUNK_ID = "aa0e8400-e29b-41d4-a716-446655440000";

describe("chat/retrieval", () => {
  it("retrieves semantic matches and builds GitHub line-anchor citations", async () => {
    const mockClient = {
      from(table: string) {
        if (table === "repositories") {
          return {
            select() {
              return {
                eq() {
                  return {
                    is() {
                      return {
                        async single() {
                          return {
                            data: {
                              id: TEST_REPO_ID,
                              full_name: "octocat/hello-world",
                              canonical_url:
                                "https://github.com/octocat/hello-world",
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

        if (table === "repository_chunks") {
          return {
            select(_cols: string, opts?: { count?: string; head?: boolean }) {
              if (opts?.head) {
                return {
                  async eq() {
                    return { count: 12, error: null };
                  },
                };
              }
              return {
                eq() {
                  return {
                    or() {
                      return {
                        async limit() {
                          return { data: [], error: null };
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
      async rpc(fnName: string) {
        assert.equal(fnName, "match_repository_chunks");
        return {
          data: [
            {
              id: TEST_CHUNK_ID,
              repository_id: TEST_REPO_ID,
              file_id: TEST_FILE_ID,
              file_path: "src/auth/session.ts",
              language: "typescript",
              chunk_index: 0,
              start_line: 10,
              end_line: 24,
              content: "export function verifySession() {\n  return true;\n}",
              similarity: 0.87654,
            },
          ],
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const unitVector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

    const result = await retrieveCodebaseContext(
      {
        userClient: mockClient,
        repositoryId: TEST_REPO_ID,
        question: "How does session verification work?",
        matchCount: 5,
      },
      {
        embedQuery: async () => unitVector,
      }
    );

    assert.equal(result.repository.fullName, "octocat/hello-world");
    assert.equal(result.chunks.length, 1);
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].filePath, "src/auth/session.ts");
    assert.equal(result.citations[0].startLine, 10);
    assert.equal(result.citations[0].endLine, 24);
    assert.equal(
      result.citations[0].githubUrl,
      "https://github.com/octocat/hello-world/blob/main/src/auth/session.ts#L10-L24"
    );
  });

  it("throws a clear message when the repository has zero indexed chunks", async () => {
    const mockClient = {
      from(table: string) {
        if (table === "repositories") {
          return {
            select() {
              return {
                eq() {
                  return {
                    is() {
                      return {
                        async single() {
                          return {
                            data: {
                              id: TEST_REPO_ID,
                              full_name: "octocat/empty-repo",
                              canonical_url:
                                "https://github.com/octocat/empty-repo",
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

        if (table === "repository_chunks") {
          return {
            select() {
              return {
                async eq() {
                  return { count: 0, error: null };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    await assert.rejects(
      () =>
        retrieveCodebaseContext({
          userClient: mockClient,
          repositoryId: TEST_REPO_ID,
          question: "What does this repo do?",
        }),
      /not been indexed yet/i
    );
  });
});

describe("chat/llm & conversations", () => {
  it("formats grounded system prompts with exact file paths and line ranges", () => {
    const prompt = buildGroundedSystemPrompt("octocat/hello-world", [
      {
        id: TEST_CHUNK_ID,
        repositoryId: TEST_REPO_ID,
        fileId: TEST_FILE_ID,
        filePath: "src/index.ts",
        language: "typescript",
        chunkIndex: 0,
        startLine: 1,
        endLine: 15,
        content: "export const VERSION = '1.0.0';",
        similarity: 0.91,
      },
    ]);

    assert.match(prompt, /octocat\/hello-world/);
    assert.match(prompt, /src\/index\.ts \(lines 1-15/);
    assert.match(prompt, /\[file_path:Lstart-Lend\]/);
  });

  it("parses upstream OpenAI SSE token deltas into a clean text stream", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const ssePayload = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(ssePayload));
            controller.close();
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const stream = await createGroundedAnswerStream({
        repositoryFullName: "octocat/hello-world",
        question: "Say hello",
        history: [],
        chunks: [],
        apiKey: "sk-test-key",
      });

      const reader = stream.getReader();
      let combined = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        combined += value;
      }

      assert.equal(combined, "Hello world");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("derives concise conversation titles from the first user prompt", () => {
    assert.equal(
      deriveConversationTitle("  How   does   auth   work?  "),
      "How does auth work?"
    );
    const longPrompt = "A".repeat(120);
    const title = deriveConversationTitle(longPrompt);
    assert.equal(title.length, 72);
    assert.ok(title.endsWith("..."));
  });
});


describe("chat/llm (Gemini provider)", () => {
  it("parses upstream Gemini SSE candidate text chunks into a clean text stream", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      const ssePayload = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Grounded "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"answer"}]}}]}\n\n',
      ].join("");

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(ssePayload));
            controller.close();
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const stream = await createGroundedAnswerStream({
        repositoryFullName: "octocat/hello-world",
        question: "Explain this repo",
        history: [],
        chunks: [],
        provider: "gemini",
        apiKey: "AIza-test-gemini-key",
      });

      const reader = stream.getReader();
      let combined = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        combined += value;
      }

      assert.match(capturedUrl, /gemini-2\.5-flash:streamGenerateContent\?alt=sse$/);
      assert.equal(combined, "Grounded answer");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
