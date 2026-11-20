export interface CodeChunk {
  filePath: string;
  language: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  tokenCount: number;
  content: string;
}

export interface ChunkFileOptions {
  filePath: string;
  content: string;
  maxChunkChars?: number;
  overlapLines?: number;
}

export const DEFAULT_MAX_CHUNK_CHARS = 1_500;
export const DEFAULT_OVERLAP_LINES = 3;

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".py": "python",
  ".pyi": "python",
  ".sql": "sql",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".c": "c",
  ".h": "c",
  ".md": "markdown",
  ".mdx": "mdx",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ps1": "powershell",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".prisma": "prisma",
  ".proto": "protobuf",
  ".tf": "terraform",
  ".hcl": "hcl",
  ".lua": "lua",
  ".r": "r",
  ".dart": "dart",
  ".ex": "elixir",
  ".exs": "elixir",
};

const FILENAME_LANGUAGE_MAP: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  "cmakelists.txt": "cmake",
};

export function detectFileLanguage(filePath: string): string {
  const normalized = filePath.trim().toLowerCase();
  const baseName = normalized.split("/").pop() ?? normalized;

  if (baseName in FILENAME_LANGUAGE_MAP) {
    return FILENAME_LANGUAGE_MAP[baseName];
  }

  if (baseName.startsWith("dockerfile.")) {
    return "dockerfile";
  }

  if (baseName.startsWith(".env")) {
    return "dotenv";
  }

  const lastDot = baseName.lastIndexOf(".");
  if (lastDot > 0) {
    const ext = baseName.slice(lastDot);
    if (ext in EXTENSION_LANGUAGE_MAP) {
      return EXTENSION_LANGUAGE_MAP[ext];
    }
  }

  return "text";
}

export function estimateTokenCount(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkSourceFile(options: ChunkFileOptions): CodeChunk[] {
  const {
    filePath,
    content,
    maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
    overlapLines = DEFAULT_OVERLAP_LINES,
  } = options;

  if (typeof content !== "string" || content.trim().length === 0) {
    return [];
  }

  const safeMaxChars = Math.max(200, Math.floor(maxChunkChars));
  const safeOverlap = Math.max(0, Math.min(20, Math.floor(overlapLines)));
  const language = detectFileLanguage(filePath);

  const normalizedContent = content.replace(/\r\n/g, "\n");
  const rawLines = normalizedContent.split("\n");

  // Trim trailing empty newline element so line counts match editor line numbers
  if (rawLines.length > 1 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const chunks: CodeChunk[] = [];
  let startIdx = 0;

  while (startIdx < rawLines.length) {
    let endIdx = startIdx;
    let currentLength = 0;

    while (endIdx < rawLines.length) {
      const line = rawLines[endIdx];
      const addedLength =
        endIdx === startIdx ? line.length : line.length + 1;

      if (endIdx > startIdx && currentLength + addedLength > safeMaxChars) {
        break;
      }

      currentLength += addedLength;
      endIdx += 1;

      if (currentLength >= safeMaxChars) {
        break;
      }
    }

    const sliceLines = rawLines.slice(startIdx, endIdx);
    let chunkText = sliceLines.join("\n");

    // Guard against single ultra-long minified/data lines exceeding maxChunkChars
    if (chunkText.length > safeMaxChars * 2) {
      chunkText = chunkText.slice(0, safeMaxChars * 2);
    }

    if (chunkText.trim().length > 0) {
      chunks.push({
        filePath,
        language,
        chunkIndex: chunks.length,
        startLine: startIdx + 1,
        endLine: endIdx,
        tokenCount: estimateTokenCount(chunkText),
        content: chunkText,
      });
    }

    if (endIdx >= rawLines.length) {
      break;
    }

    const consumedCount = endIdx - startIdx;
    const effectiveOverlap = Math.min(safeOverlap, Math.max(0, consumedCount - 1));
    startIdx = endIdx - effectiveOverlap;
  }

  return chunks;
}
