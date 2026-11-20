import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCommandPaletteItems } from "@/lib/search/command-items";

describe("search/command-items", () => {
  const sampleRepos = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      fullName: "acme/auth-service",
      provider: "github",
      defaultBranch: "main",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      fullName: "acme/frontend-web",
      provider: "gitlab",
      defaultBranch: "develop",
    },
  ];

  const sampleConversations = [
    {
      id: "33333333-3333-4333-8333-333333333333",
      title: "How does JWT verification work?",
      repositoryFullName: "acme/auth-service",
    },
  ];

  it("filters repositories, conversations, and pages by query", () => {
    const items = buildCommandPaletteItems({
      query: "auth",
      repositories: sampleRepos,
      conversations: sampleConversations,
      codeHits: [],
    });

    assert.equal(items.length, 3);
    assert.equal(items[0].id, "repo-11111111-1111-4111-8111-111111111111");
    assert.equal(items[1].id, "conv-33333333-3333-4333-8333-333333333333");
    assert.equal(items[2].id, "nav-settings");
  });

  it("prioritizes live semantic code hits with deep jump-to-line URLs", () => {
    const items = buildCommandPaletteItems({
      query: "verifyToken",
      repositories: sampleRepos,
      conversations: [],
      codeHits: [
        {
          chunkId: "chunk-99",
          repositoryId: "11111111-1111-4111-8111-111111111111",
          repositoryFullName: "acme/auth-service",
          filePath: "src/jwt/verify.ts",
          startLine: 14,
          endLine: 32,
          similarity: 0.89,
        },
      ],
    });

    assert.equal(items[0].category, "code");
    assert.equal(
      items[0].href,
      "/repositories/11111111-1111-4111-8111-111111111111?file=src%2Fjwt%2Fverify.ts&line=14"
    );
    assert.equal(items[0].badge, "89% match");
  });
});
