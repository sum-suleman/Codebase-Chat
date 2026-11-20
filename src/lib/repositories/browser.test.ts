import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconstructFileFromChunks } from "@/lib/repositories/browser";

describe("repositories/browser", () => {
  it("reconstructs continuous source lines and deduplicates overlapping chunk lines", () => {
    const result = reconstructFileFromChunks({
      id: "file-1",
      filePath: "src/example.ts",
      chunks: [
        {
          chunkIndex: 1,
          startLine: 3,
          endLine: 6,
          content: "const c = 3;\nconst d = 4;\nconst e = 5;\nexport { c, d, e };",
        },
        {
          chunkIndex: 0,
          startLine: 1,
          endLine: 4,
          content: "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;",
        },
      ],
    });

    assert.equal(result.language, "typescript");
    assert.equal(result.chunkCount, 2);
    assert.equal(result.lineCount, 6);
    assert.deepEqual(
      result.lines.map((l) => `${l.lineNumber}:${l.text}`),
      [
        "1:const a = 1;",
        "2:const b = 2;",
        "3:const c = 3;",
        "4:const d = 4;",
        "5:const e = 5;",
        "6:export { c, d, e };",
      ]
    );
  });

  it("returns an empty line list when no chunks are stored for a file", () => {
    const result = reconstructFileFromChunks({
      id: "file-2",
      filePath: "README.md",
      chunks: [],
    });

    assert.equal(result.language, "markdown");
    assert.equal(result.lineCount, 0);
    assert.equal(result.chunkCount, 0);
    assert.deepEqual(result.lines, []);
    assert.equal(result.rawContent, "");
  });
});
