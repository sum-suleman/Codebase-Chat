import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chunkSourceFile,
  detectFileLanguage,
  estimateTokenCount,
} from "@/lib/indexing/chunker";

describe("indexing/chunker", () => {
  it("detects languages from file extensions and special filenames", () => {
    assert.equal(detectFileLanguage("src/lib/auth/session.ts"), "typescript");
    assert.equal(detectFileLanguage("src/components/Button.tsx"), "tsx");
    assert.equal(detectFileLanguage("scripts/migrate.py"), "python");
    assert.equal(detectFileLanguage("supabase/migrations/001.sql"), "sql");
    assert.equal(detectFileLanguage("Dockerfile"), "dockerfile");
    assert.equal(detectFileLanguage("docker/Dockerfile.prod"), "dockerfile");
    assert.equal(detectFileLanguage(".env.example"), "dotenv");
    assert.equal(detectFileLanguage("README"), "text");
  });

  it("returns empty array for empty or whitespace-only content", () => {
    assert.deepEqual(
      chunkSourceFile({ filePath: "empty.ts", content: "   \n\n\t  " }),
      []
    );
  });

  it("splits multi-line source files along line boundaries with overlap and accurate line numbers", () => {
    const lines = Array.from(
      { length: 20 },
      (_, idx) => `export const value_${idx + 1} = ${idx + 1}; // padding line`
    );
    const content = lines.join("\n") + "\n";

    const chunks = chunkSourceFile({
      filePath: "src/constants.ts",
      content,
      maxChunkChars: 240,
      overlapLines: 2,
    });

    assert.ok(chunks.length >= 3);
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[0].language, "typescript");
    assert.equal(chunks[0].chunkIndex, 0);

    for (let i = 1; i < chunks.length; i += 1) {
      assert.equal(chunks[i].chunkIndex, i);
      assert.ok(chunks[i].startLine <= chunks[i - 1].endLine);
      assert.ok(chunks[i].endLine >= chunks[i].startLine);
    }

    assert.equal(chunks[chunks.length - 1].endLine, 20);
    assert.ok(estimateTokenCount(chunks[0].content) >= 1);
  });
});
