import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  EMBEDDING_DIMENSIONS,
  formatVectorLiteral,
  generateTextEmbeddings,
} from "@/lib/indexing/embeddings";

describe("indexing/embeddings", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("formats a 1536-dimension vector as a pgvector literal", () => {
    const vec = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
      i === 0 ? 0.5 : 0
    );
    const literal = formatVectorLiteral(vec);
    assert.ok(literal.startsWith("[0.5,0,"));
    assert.ok(literal.endsWith("]"));
  });

  it("rejects vectors with invalid dimensions", () => {
    assert.throws(
      () => formatVectorLiteral([0.1, 0.2]),
      /Expected 1536-dimension embedding vector/
    );
  });

  it("batches embedding requests and preserves input order", async () => {
    const vecA = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    const vecB = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.2);
    const vecC = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.3);
    const vectors = [vecA, vecB, vecC];

    let callCount = 0;

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input: string[];
      };
      const offset = callCount * 2;
      callCount += 1;

      const data = body.input
        .map((_, idx) => ({
          index: idx,
          embedding: vectors[offset + idx],
        }))
        .reverse();

      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as typeof fetch;

    const result = await generateTextEmbeddings(["one", "two", "three"], {
      apiKey: "sk-test-key",
      batchSize: 2,
    });

    assert.equal(callCount, 2);
    assert.equal(result.length, 3);
    assert.equal(result[0][0], 0.1);
    assert.equal(result[1][0], 0.2);
    assert.equal(result[2][0], 0.3);
  });
});


describe("indexing/embeddings (Gemini provider)", () => {
  it("batches Gemini batchEmbedContents requests with 1536 outputDimensionality", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedHeaderKey = "";
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = init?.headers as Record<string, string>;
      capturedHeaderKey = headers["x-goog-api-key"] ?? "";
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      const vec = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i * 0.001);
      return new Response(
        JSON.stringify({
          embeddings: [{ values: vec }, { values: vec }],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const result = await generateTextEmbeddings(["first chunk", "second chunk"], {
        provider: "gemini",
        apiKey: "AIza-test-gemini-key",
      });

      assert.equal(result.length, 2);
      assert.equal(result[0].length, EMBEDDING_DIMENSIONS);
      assert.match(capturedUrl, /gemini-embedding-001:batchEmbedContents$/);
      assert.equal(capturedHeaderKey, "AIza-test-gemini-key");
      const reqs = capturedBody.requests as Array<Record<string, unknown>>;
      assert.equal(reqs.length, 2);
      assert.equal(reqs[0].outputDimensionality, EMBEDDING_DIMENSIONS);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
