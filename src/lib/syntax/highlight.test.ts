import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inferLanguageFromPath,
  tokenizeCode,
  tokenizeCodeLines,
} from "@/lib/syntax/highlight";

describe("syntax/highlight", () => {
  it("preserves exact source text across all tokens and highlights TypeScript constructs", () => {
    const source = [
      "// Fetch user profile",
      'export async function getUser(id: string): Promise<User | null> {',
      "  const count = 42;",
      "  return db.find(id);",
      "}",
    ].join("\n");

    const lines = tokenizeCode(source, "ts");
    const reconstructed = lines
      .map((line) => line.map((t) => t.value).join(""))
      .join("\n");

    assert.equal(reconstructed, source);
    assert.equal(lines[0][0].type, "comment");
    assert.ok(lines[1].some((t) => t.type === "keyword" && t.value === "export"));
    assert.ok(lines[1].some((t) => t.type === "function" && t.value === "getUser"));
    assert.ok(lines[1].some((t) => t.type === "type" && t.value === "User"));
    assert.ok(lines[2].some((t) => t.type === "number" && t.value === "42"));
    assert.ok(lines[3].some((t) => t.type === "function" && t.value === "find"));
  });

  it("tracks multi-line block comments across lines", () => {
    const lines = tokenizeCodeLines(
      ["/* start comment", "still inside comment", "end comment */ const x = 1;"],
      "typescript"
    );

    assert.equal(lines[0][0].type, "comment");
    assert.equal(lines[1][0].type, "comment");
    assert.equal(lines[2][0].type, "comment");
    assert.ok(lines[2].some((t) => t.type === "keyword" && t.value === "const"));
  });

  it("highlights Python comments, docstrings, and keywords", () => {
    const lines = tokenizeCodeLines(
      [
        "# Module doc",
        '"""',
        "Multiline docstring",
        '"""',
        "def compute(n):",
        "    return n * 2",
      ],
      "python"
    );

    assert.equal(lines[0][0].type, "comment");
    assert.equal(lines[2][0].type, "string");
    assert.ok(lines[4].some((t) => t.type === "keyword" && t.value === "def"));
    assert.ok(lines[4].some((t) => t.type === "function" && t.value === "compute"));
  });

  it("infers normalized languages from file paths", () => {
    assert.equal(inferLanguageFromPath("src/app/page.tsx"), "typescript");
    assert.equal(inferLanguageFromPath("infra/Dockerfile"), "dockerfile");
    assert.equal(inferLanguageFromPath("supabase/migrations/001.sql"), "sql");
  });
});
