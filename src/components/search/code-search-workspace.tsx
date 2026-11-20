"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ExternalLink,
  FileCode2,
  FolderGit2,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { HighlightedCode } from "@/components/code/highlighted-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SemanticSearchHit } from "@/lib/search/code-search";
import { inferLanguageFromPath } from "@/lib/syntax/highlight";

export interface SearchRepositoryOption {
  id: string;
  fullName: string;
  isIndexed: boolean;
  chunksTotal: number;
}

interface CodeSearchWorkspaceProps {
  repositories: SearchRepositoryOption[];
  initialRepositoryId?: string;
}

const SAMPLE_QUERIES = [
  "Authentication middleware and session verification",
  "Database schema, migrations, and row level security policies",
  "API error handling and request validation",
  "Background job processing and embedding generation",
];

export function CodeSearchWorkspace({
  repositories,
  initialRepositoryId = "all",
}: CodeSearchWorkspaceProps) {
  const [query, setQuery] = React.useState("");
  const [selectedRepositoryId, setSelectedRepositoryId] = React.useState(
    initialRepositoryId || "all"
  );
  const [selectedLanguage, setSelectedLanguage] = React.useState("all");
  const [hits, setHits] = React.useState<SemanticSearchHit[]>([]);
  const [lastSearchedQuery, setLastSearchedQuery] = React.useState("");
  const [searchedReposCount, setSearchedReposCount] = React.useState(0);
  const [isSearching, setIsSearching] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const indexedRepos = React.useMemo(
    () => repositories.filter((r) => r.isIndexed),
    [repositories]
  );

  const languageOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const hit of hits) {
      const lang = hit.language || inferLanguageFromPath(hit.filePath);
      if (lang && lang !== "text") {
        set.add(lang);
      }
    }
    return Array.from(set).sort();
  }, [hits]);

  const visibleHits = React.useMemo(() => {
    if (selectedLanguage === "all") {
      return hits;
    }
    return hits.filter((hit) => {
      const lang = hit.language || inferLanguageFromPath(hit.filePath);
      return lang === selectedLanguage;
    });
  }, [hits, selectedLanguage]);

  async function executeSearch(rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      return;
    }

    setIsSearching(true);
    setErrorMessage(null);
    setSelectedLanguage("all");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          repositoryId:
            selectedRepositoryId !== "all" ? selectedRepositoryId : null,
          limit: 18,
        }),
      });

      const payload = (await response.json()) as {
        hits?: SemanticSearchHit[];
        searchedRepositoriesCount?: number;
        error?: string;
      };

      if (!response.ok) {
        setErrorMessage(payload.error || "Semantic search failed.");
        return;
      }

      setHits(payload.hits ?? []);
      setSearchedReposCount(payload.searchedRepositoriesCount ?? 0);
      setLastSearchedQuery(trimmed);
    } catch {
      setErrorMessage("Unable to reach the search service.");
    } finally {
      setIsSearching(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void executeSearch(query);
  }

  return (
    <div className="space-y-6">
      {/* Search Controls */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-cb-border bg-cb-card p-4"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by concept, function, file path, or error behavior..."
              aria-label="Semantic code search query"
              maxLength={500}
              className="h-11 pl-10 pr-9 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search query"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-cb-text-secondary hover:text-cb-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <select
            value={selectedRepositoryId}
            onChange={(e) => setSelectedRepositoryId(e.target.value)}
            aria-label="Scope search to repository"
            className="h-11 rounded-md border border-cb-border bg-cb-bg px-3 text-sm text-cb-text-primary focus:border-cb-primary focus:outline-none lg:w-64"
          >
            <option value="all">
              All repositories ({repositories.length})
            </option>
            {repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.fullName}
                {repo.isIndexed ? "" : " (not indexed)"}
              </option>
            ))}
          </select>

          <Button
            type="submit"
            disabled={isSearching || !query.trim() || repositories.length === 0}
            className="h-11 px-5"
          >
            {isSearching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Search Code
              </>
            )}
          </Button>
        </div>

        {/* Sample Queries */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-cb-text-secondary">
            Try:
          </span>
          {SAMPLE_QUERIES.map((sample) => (
            <button
              key={sample}
              type="button"
              disabled={isSearching || repositories.length === 0}
              onClick={() => {
                setQuery(sample);
                void executeSearch(sample);
              }}
              className="rounded-full border border-cb-border bg-cb-bg px-2.5 py-1 text-[11px] text-cb-text-secondary transition-colors hover:border-cb-primary/50 hover:text-cb-text-primary disabled:opacity-50"
            >
              {sample}
            </button>
          ))}
        </div>
      </form>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-red-400"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {repositories.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <FolderGit2 className="h-10 w-10 text-cb-text-secondary" />
            <h2 className="mt-4 text-lg font-semibold text-cb-text-primary">
              No repositories connected
            </h2>
            <p className="mt-1 max-w-md text-sm text-cb-text-secondary">
              Connect and index a GitHub or GitLab repository first to search
              across your source code semantically.
            </p>
            <Link
              href="/repositories"
              className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-cb-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
            >
              Go to Repositories
            </Link>
          </CardContent>
        </Card>
      ) : indexedRepos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileCode2 className="h-9 w-9 text-cb-text-secondary" />
            <h2 className="mt-3 text-base font-semibold text-cb-text-primary">
              No indexed repositories yet
            </h2>
            <p className="mt-1 max-w-md text-sm text-cb-text-secondary">
              Run indexing on at least one repository so embeddings are ready
              for semantic search.
            </p>
            <Link
              href="/repositories"
              className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-cb-primary px-4 text-xs font-medium text-white transition-colors hover:bg-cb-primary-hover"
            >
              Index Repositories
            </Link>
          </CardContent>
        </Card>
      ) : lastSearchedQuery ? (
        <div className="space-y-4">
          {/* Results Summary & Language Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-cb-text-secondary">
              Found{" "}
              <span className="font-semibold text-cb-text-primary">
                {visibleHits.length}
              </span>{" "}
              matching code chunk{visibleHits.length === 1 ? "" : "s"} across{" "}
              <span className="font-semibold text-cb-text-primary">
                {searchedReposCount}
              </span>{" "}
              repositor{searchedReposCount === 1 ? "y" : "ies"} for{" "}
              <span className="font-mono text-cb-text-primary">
                &ldquo;{lastSearchedQuery}&rdquo;
              </span>
            </div>

            {languageOptions.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedLanguage("all")}
                  className={
                    selectedLanguage === "all"
                      ? "rounded-md bg-cb-primary px-2.5 py-1 text-[11px] font-medium text-white"
                      : "rounded-md border border-cb-border bg-cb-card px-2.5 py-1 text-[11px] text-cb-text-secondary hover:text-cb-text-primary"
                  }
                >
                  All ({hits.length})
                </button>
                {languageOptions.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setSelectedLanguage(lang)}
                    className={
                      selectedLanguage === lang
                        ? "rounded-md bg-cb-primary px-2.5 py-1 font-mono text-[11px] font-medium text-white"
                        : "rounded-md border border-cb-border bg-cb-card px-2.5 py-1 font-mono text-[11px] text-cb-text-secondary hover:text-cb-text-primary"
                    }
                  >
                    {lang}
                  </button>
                ))}
              </div>
            )}
          </div>

          {visibleHits.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm font-medium text-cb-text-primary">
                  No matching chunks found
                </p>
                <p className="mt-1 text-xs text-cb-text-secondary">
                  Try broader phrasing, an exact symbol name, or searching
                  across all repositories.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {visibleHits.map((hit) => {
                const highlightLang =
                  hit.language && hit.language !== "text"
                    ? hit.language
                    : inferLanguageFromPath(hit.filePath);
                const askPrompt = `Explain ${hit.filePath} lines ${hit.startLine}-${hit.endLine} in the context of: ${lastSearchedQuery}`;

                return (
                  <div
                    key={hit.chunkId}
                    className="overflow-hidden rounded-xl border border-cb-border bg-cb-card"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cb-border bg-cb-elevated/40 px-4 py-2.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="default" className="font-mono text-[11px]">
                          <FolderGit2 className="mr-1 h-3 w-3" />
                          {hit.repositoryFullName}
                        </Badge>
                        <Link
                          href={`/repositories/${encodeURIComponent(hit.repositoryId)}?file=${encodeURIComponent(hit.filePath)}&line=${hit.startLine}`}
                          className="truncate font-mono text-xs font-semibold text-cb-primary hover:underline"
                        >
                          {hit.filePath}
                        </Link>
                        <span className="font-mono text-[11px] text-cb-text-secondary">
                          L{hit.startLine}–L{hit.endLine}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default" className="text-[10px]">
                          {Math.round(hit.similarity * 100)}% match
                        </Badge>
                        <Link
                          href={`/repositories/${encodeURIComponent(hit.repositoryId)}?file=${encodeURIComponent(hit.filePath)}&line=${hit.startLine}`}
                          className="inline-flex h-7 items-center rounded-md border border-cb-border bg-cb-bg px-2.5 text-[11px] font-medium text-cb-text-primary transition-colors hover:bg-cb-elevated"
                        >
                          <FileCode2 className="mr-1 h-3 w-3" />
                          View file
                        </Link>
                        <Link
                          href={`/chat?repo=${encodeURIComponent(hit.repositoryId)}&prompt=${encodeURIComponent(askPrompt)}`}
                          className="inline-flex h-7 items-center rounded-md bg-cb-primary/15 px-2.5 text-[11px] font-medium text-cb-primary transition-colors hover:bg-cb-primary hover:text-white"
                        >
                          <MessageSquare className="mr-1 h-3 w-3" />
                          Ask AI
                        </Link>
                        {hit.externalUrl && (
                          <a
                            href={hit.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open on provider"
                            className="inline-flex h-7 items-center rounded-md px-1.5 text-cb-text-secondary hover:text-cb-text-primary"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    <pre className="max-h-72 overflow-x-auto bg-cb-sidebar p-3.5 font-mono text-xs leading-relaxed text-cb-text-primary">
                      <HighlightedCode
                        code={hit.snippet}
                        language={highlightLang}
                      />
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
