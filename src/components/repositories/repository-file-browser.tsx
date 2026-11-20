"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquare,
  Search,
} from "lucide-react";

import {
  renderHighlightedTokens,
  tokenizeCodeLines,
} from "@/components/code/highlighted-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  IndexedFileEntry,
  ReconstructedFileContent,
} from "@/lib/repositories/browser";
import { cn } from "@/lib/utils";

interface DirectoryNode {
  name: string;
  path: string;
  directories: Map<string, DirectoryNode>;
  files: IndexedFileEntry[];
}

function buildDirectoryTree(files: IndexedFileEntry[]): DirectoryNode {
  const root: DirectoryNode = {
    name: "",
    path: "",
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    const segments = file.filePath.split("/").filter(Boolean);
    if (segments.length <= 1) {
      root.files.push(file);
      continue;
    }

    let current = root;
    let currentPath = "";
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let next = current.directories.get(segment);
      if (!next) {
        next = {
          name: segment,
          path: currentPath,
          directories: new Map(),
          files: [],
        };
        current.directories.set(segment, next);
      }
      current = next;
    }
    current.files.push(file);
  }

  return root;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface RepositoryFileBrowserProps {
  repositoryId: string;
  repositoryFullName: string;
  files: IndexedFileEntry[];
  initialFilePath?: string;
  initialHighlightLine?: number;
}

export function RepositoryFileBrowser({
  repositoryId,
  repositoryFullName,
  files,
  initialFilePath,
  initialHighlightLine,
}: RepositoryFileBrowserProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [expandedDirs, setExpandedDirs] = React.useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const file of files) {
      const firstSlash = file.filePath.indexOf("/");
      if (firstSlash > 0) {
        initial.add(file.filePath.slice(0, firstSlash));
      }
    }
    if (initialFilePath) {
      const parts = initialFilePath.split("/").filter(Boolean);
      let acc = "";
      for (let i = 0; i < parts.length - 1; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        initial.add(acc);
      }
    }
    return initial;
  });

  const initialSelectedFile = React.useMemo(() => {
    if (files.length === 0) {
      return null;
    }
    if (initialFilePath) {
      const exact = files.find((f) => f.filePath === initialFilePath);
      if (exact) {
        return exact;
      }
    }
    const readme = files.find((f) => /^readme(\.|$)/i.test(f.fileName));
    return readme ?? files[0];
  }, [files, initialFilePath]);

  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(
    initialSelectedFile?.id ?? null
  );
  const [fileContent, setFileContent] =
    React.useState<ReconstructedFileContent | null>(null);
  const [isLoadingContent, setIsLoadingContent] = React.useState(false);
  const [contentError, setContentError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const contentCacheRef = React.useRef(new Map<string, ReconstructedFileContent>());
  const highlightedLineRef = React.useRef<HTMLTableRowElement | null>(null);

  const tokenizedLines = React.useMemo(() => {
    if (!fileContent) {
      return [];
    }
    return tokenizeCodeLines(
      fileContent.lines.map((l) => l.text),
      fileContent.language
    );
  }, [fileContent]);

  const selectedFileEntry = React.useMemo(
    () => files.find((f) => f.id === selectedFileId) ?? null,
    [files, selectedFileId]
  );

  React.useEffect(() => {
    if (!selectedFileId) {
      setFileContent(null);
      return;
    }

    const cached = contentCacheRef.current.get(selectedFileId);
    if (cached) {
      setFileContent(cached);
      setContentError(null);
      setIsLoadingContent(false);
      return;
    }

    let cancelled = false;
    setIsLoadingContent(true);
    setContentError(null);

    fetch(
      `/api/repositories/${encodeURIComponent(repositoryId)}/files/${encodeURIComponent(selectedFileId)}`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        const data = (await res.json()) as {
          file?: ReconstructedFileContent;
          error?: string;
        };
        if (cancelled) {
          return;
        }
        if (!res.ok || !data.file) {
          setContentError(data.error || "Unable to load file content.");
          setFileContent(null);
          return;
        }
        contentCacheRef.current.set(selectedFileId, data.file);
        setFileContent(data.file);
      })
      .catch(() => {
        if (!cancelled) {
          setContentError("Network error while loading file content.");
          setFileContent(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingContent(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repositoryId, selectedFileId]);

  React.useEffect(() => {
    if (
      fileContent &&
      initialHighlightLine &&
      selectedFileEntry?.filePath === initialFilePath
    ) {
      highlightedLineRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [fileContent, initialHighlightLine, initialFilePath, selectedFileEntry]);

  const filteredFiles = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return files;
    }
    return files.filter((file) => file.filePath.toLowerCase().includes(q));
  }, [files, searchQuery]);

  const directoryTree = React.useMemo(
    () => buildDirectoryTree(filteredFiles),
    [filteredFiles]
  );

  const isFiltering = searchQuery.trim().length > 0;

  const toggleDirectory = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  };

  const handleCopyCode = async () => {
    if (!fileContent?.rawContent) {
      return;
    }
    try {
      await navigator.clipboard.writeText(fileContent.rawContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const renderDirectoryNode = (node: DirectoryNode, depth: number) => {
    const sortedDirs = Array.from(node.directories.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const sortedFiles = [...node.files].sort((a, b) =>
      a.fileName.localeCompare(b.fileName)
    );

    return (
      <div className="space-y-0.5">
        {sortedDirs.map((dir) => {
          const isOpen = isFiltering || expandedDirs.has(dir.path);
          return (
            <div key={dir.path}>
              <button
                type="button"
                onClick={() => toggleDirectory(dir.path)}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs font-medium text-cb-text-secondary transition-colors hover:bg-cb-elevated/70 hover:text-cb-text-primary"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-cb-text-secondary" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-cb-text-secondary" />
                )}
                {isOpen ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-cb-primary" />
                ) : (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-cb-text-secondary" />
                )}
                <span className="truncate font-mono">{dir.name}</span>
              </button>
              {isOpen && renderDirectoryNode(dir, depth + 1)}
            </div>
          );
        })}

        {sortedFiles.map((file) => {
          const isSelected = file.id === selectedFileId;
          return (
            <button
              key={file.id}
              type="button"
              onClick={() => setSelectedFileId(file.id)}
              style={{ paddingLeft: `${depth * 12 + 24}px` }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md py-1.5 pr-2 text-left text-xs transition-colors",
                isSelected
                  ? "bg-cb-primary/15 font-medium text-cb-text-primary"
                  : "text-cb-text-secondary hover:bg-cb-elevated/60 hover:text-cb-text-primary"
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <FileCode2
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    isSelected ? "text-cb-primary" : "text-cb-text-secondary"
                  )}
                />
                <span className="truncate font-mono">{file.fileName}</span>
              </span>
              <span className="shrink-0 text-[10px] text-cb-text-secondary">
                {file.lineCount > 0 ? `${file.lineCount}L` : ""}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  if (files.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center p-12 text-center">
        <FileCode2 className="h-10 w-10 text-cb-text-secondary" />
        <h3 className="mt-4 text-base font-semibold text-cb-text-primary">
          No indexed files available yet
        </h3>
        <p className="mt-1.5 max-w-md text-sm text-cb-text-secondary">
          Index <span className="font-mono text-cb-text-primary">{repositoryFullName}</span>{" "}
          from the Repositories page to inspect its source tree and ask questions.
        </p>
        <Link
          href="/repositories"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-cb-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
        >
          Go to Repositories
        </Link>
      </Card>
    );
  }

  const askAiHref = selectedFileEntry
    ? `/chat?repo=${encodeURIComponent(repositoryId)}&prompt=${encodeURIComponent(
        `Explain how \`${selectedFileEntry.filePath}\` works and describe its key responsibilities.`
      )}`
    : `/chat?repo=${encodeURIComponent(repositoryId)}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Left Sidebar: File Tree */}
      <Card className="flex flex-col overflow-hidden lg:h-[calc(100vh-14rem)]">
        <div className="border-b border-cb-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-cb-text-secondary" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter files by path..."
              className="h-8 pl-8 text-xs font-mono"
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-cb-text-secondary">
            <span>
              {filteredFiles.length === files.length
                ? `${files.length.toLocaleString()} indexed files`
                : `${filteredFiles.length.toLocaleString()} of ${files.length.toLocaleString()} files`}
            </span>
            {isFiltering && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-cb-primary hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredFiles.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-cb-text-secondary">
              No files match &ldquo;{searchQuery}&rdquo;.
            </p>
          ) : (
            renderDirectoryNode(directoryTree, 0)
          )}
        </div>
      </Card>

      {/* Right Pane: Code Viewer */}
      <Card className="flex min-w-0 flex-col overflow-hidden lg:h-[calc(100vh-14rem)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cb-border bg-cb-elevated/40 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <FileCode2 className="h-4 w-4 shrink-0 text-cb-primary" />
            <span className="truncate font-mono text-xs font-medium text-cb-text-primary">
              {selectedFileEntry?.filePath ?? "Select a file"}
            </span>
            {selectedFileEntry && (
              <>
                <Badge variant="default" className="hidden sm:inline-flex font-mono text-[10px]">
                  {selectedFileEntry.language}
                </Badge>
                <span className="hidden md:inline text-xs text-cb-text-secondary">
                  {selectedFileEntry.lineCount.toLocaleString()} lines ·{" "}
                  {formatByteSize(selectedFileEntry.byteSize)}
                </span>
              </>
            )}
          </div>

          {selectedFileEntry && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyCode}
                disabled={!fileContent || isLoadingContent}
                className="h-7 px-2.5 text-xs"
              >
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
              <Link
                href={askAiHref}
                className="inline-flex h-7 items-center justify-center rounded-md bg-cb-primary px-2.5 text-xs font-medium text-white transition-colors hover:bg-cb-primary-hover"
              >
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Ask AI about file
              </Link>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto bg-cb-bg/60">
          {isLoadingContent ? (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-cb-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin text-cb-primary" />
              Loading file content...
            </div>
          ) : contentError ? (
            <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-cb-error">
              {contentError}
            </div>
          ) : fileContent && fileContent.lines.length > 0 ? (
            <table className="w-full border-collapse font-mono text-xs leading-5">
              <tbody>
                {fileContent.lines.map((line) => {
                  const isHighlighted =
                    Boolean(initialHighlightLine) &&
                    selectedFileEntry?.filePath === initialFilePath &&
                    line.lineNumber === initialHighlightLine;

                  return (
                    <tr
                      key={line.lineNumber}
                      ref={isHighlighted ? highlightedLineRef : undefined}
                      className={cn(
                        "hover:bg-cb-elevated/40",
                        isHighlighted && "bg-cb-primary/20"
                      )}
                    >
                      <td className="w-12 select-none border-r border-cb-border/50 px-3 py-0.5 text-right align-top text-cb-text-secondary/70">
                        {line.lineNumber}
                      </td>
                      <td className="whitespace-pre px-4 py-0.5 text-cb-text-primary">
                        {renderHighlightedTokens(tokenizedLines[line.lineNumber - 1] ?? [])}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="flex h-64 items-center justify-center text-xs text-cb-text-secondary">
              No indexed content available for this file.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
