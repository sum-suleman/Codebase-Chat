"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  Layers,
  MessageSquare,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import {
  disconnectRepositoryAction,
  importGitHubRepositoryAction,
  importGitLabRepositoryAction,
} from "@/app/actions/repositories";
import type { AvailableGitHubRepository } from "@/app/api/github/repositories/route";
import type { AvailableGitLabRepository } from "@/app/api/gitlab/repositories/route";
import type { RepositoryIndexJobRecord } from "@/lib/indexing/pipeline";
import type { UserRepositoryRecord } from "@/lib/repositories/manage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface RepositoriesManagerProps {
  initialRepositories: UserRepositoryRecord[];
  initialIndexJobs: Record<string, RepositoryIndexJobRecord>;
  hasActiveGitHubConnection: boolean;
  hasActiveGitLabConnection?: boolean;
  maxRepositories?: number;
}

interface FetchGitHubReposResponse {
  repositories?: AvailableGitHubRepository[];
  activeCount?: number;
  maxRepositories?: number;
  hasActiveConnection?: boolean;
  error?: string;
}

interface FetchGitLabReposResponse {
  repositories?: AvailableGitLabRepository[];
  hasActiveConnection?: boolean;
  error?: string;
}

interface IndexJobApiResponse {
  job?: RepositoryIndexJobRecord | null;
  alreadyActive?: boolean;
  error?: string;
}

function renderIndexStatusBadge(job: RepositoryIndexJobRecord | undefined) {
  if (!job) {
    return <Badge variant="default">Not Indexed</Badge>;
  }

  switch (job.status) {
    case "indexed":
      return <Badge variant="success">Indexed</Badge>;
    case "indexing":
      return (
        <Badge variant="warning" className="inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Indexing
        </Badge>
      );
    case "queued":
      return (
        <Badge variant="default" className="inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Queued
        </Badge>
      );
    case "failed":
      return <Badge variant="danger">Index Failed</Badge>;
    default:
      return <Badge variant="default">Not Indexed</Badge>;
  }
}

export function RepositoriesManager({
  initialRepositories,
  initialIndexJobs,
  hasActiveGitHubConnection,
  hasActiveGitLabConnection = false,
  maxRepositories = 5,
}: RepositoriesManagerProps) {
  const router = useRouter();

  const [availableRepos, setAvailableRepos] = React.useState<
    AvailableGitHubRepository[]
  >([]);
  const [isLoadingAvailable, setIsLoadingAvailable] =
    React.useState<boolean>(hasActiveGitHubConnection);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState<string>("");

  const [availableGitLabRepos, setAvailableGitLabRepos] = React.useState<
    AvailableGitLabRepository[]
  >([]);
  const [isLoadingGitLab, setIsLoadingGitLab] =
    React.useState<boolean>(hasActiveGitLabConnection);
  const [gitlabFetchError, setGitlabFetchError] = React.useState<string | null>(
    null
  );
  const [gitlabSearchQuery, setGitlabSearchQuery] = React.useState<string>("");

  const [indexJobsByRepoId, setIndexJobsByRepoId] =
    React.useState<Record<string, RepositoryIndexJobRecord>>(initialIndexJobs);
  const [reindexingRepoId, setReindexingRepoId] = React.useState<string | null>(
    null
  );
  const [importingRepoId, setImportingRepoId] = React.useState<string | null>(
    null
  );
  const [disconnectingRepoId, setDisconnectingRepoId] = React.useState<
    string | null
  >(null);
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  React.useEffect(() => {
    setIndexJobsByRepoId((prev) => ({
      ...initialIndexJobs,
      ...prev,
    }));
  }, [initialIndexJobs]);

  const activeCount = initialRepositories.length;
  const isAtQuotaLimit = activeCount >= maxRepositories;

  const connectedGitHubRepoIds = React.useMemo(() => {
    return new Set(
      initialRepositories
        .filter((repo) => repo.provider === "github")
        .map((repo) => repo.providerRepoId)
    );
  }, [initialRepositories]);

  const connectedGitLabRepoIds = React.useMemo(() => {
    return new Set(
      initialRepositories
        .filter((repo) => repo.provider === "gitlab")
        .map((repo) => repo.providerRepoId)
    );
  }, [initialRepositories]);

  const activeJobRepoIds = React.useMemo(() => {
    return initialRepositories
      .filter((repo) => {
        const job = indexJobsByRepoId[repo.id];
        return job?.status === "queued" || job?.status === "indexing";
      })
      .map((repo) => repo.id);
  }, [initialRepositories, indexJobsByRepoId]);

  React.useEffect(() => {
    if (activeJobRepoIds.length === 0) {
      return;
    }

    let cancelled = false;

    const pollActiveJobs = async () => {
      for (const repositoryId of activeJobRepoIds) {
        try {
          const response = await fetch(
            `/api/repositories/${repositoryId}/index`,
            {
              method: "GET",
              cache: "no-store",
            }
          );

          if (!response.ok || cancelled) {
            continue;
          }

          const payload = (await response.json()) as IndexJobApiResponse;
          if (payload.job && !cancelled) {
            setIndexJobsByRepoId((prev) => ({
              ...prev,
              [repositoryId]: payload.job!,
            }));
          }
        } catch {
          // Ignore transient polling failures
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void pollActiveJobs();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeJobRepoIds]);

  const loadAvailableRepositories = React.useCallback(async () => {
    if (!hasActiveGitHubConnection) {
      setIsLoadingAvailable(false);
      setAvailableRepos([]);
      return;
    }

    setIsLoadingAvailable(true);
    setFetchError(null);

    try {
      const response = await fetch("/api/github/repositories", {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as FetchGitHubReposResponse;

      if (!response.ok) {
        setFetchError(
          payload.error ||
            "Unable to load repositories from your GitHub installation."
        );
        setAvailableRepos([]);
        return;
      }

      setAvailableRepos(
        Array.isArray(payload.repositories) ? payload.repositories : []
      );
    } catch {
      setFetchError(
        "Unable to contact the server while loading your GitHub repositories."
      );
      setAvailableRepos([]);
    } finally {
      setIsLoadingAvailable(false);
    }
  }, [hasActiveGitHubConnection]);

  const loadAvailableGitLabRepositories = React.useCallback(async () => {
    if (!hasActiveGitLabConnection) {
      setIsLoadingGitLab(false);
      setAvailableGitLabRepos([]);
      return;
    }

    setIsLoadingGitLab(true);
    setGitlabFetchError(null);

    try {
      const response = await fetch("/api/gitlab/repositories", {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as FetchGitLabReposResponse;

      if (!response.ok) {
        setGitlabFetchError(
          payload.error || "Unable to load projects from your GitLab account."
        );
        setAvailableGitLabRepos([]);
        return;
      }

      setAvailableGitLabRepos(
        Array.isArray(payload.repositories) ? payload.repositories : []
      );
    } catch {
      setGitlabFetchError(
        "Unable to contact the server while loading your GitLab projects."
      );
      setAvailableGitLabRepos([]);
    } finally {
      setIsLoadingGitLab(false);
    }
  }, [hasActiveGitLabConnection]);

  React.useEffect(() => {
    void loadAvailableRepositories();
  }, [loadAvailableRepositories]);

  React.useEffect(() => {
    void loadAvailableGitLabRepositories();
  }, [loadAvailableGitLabRepositories]);

  const filteredAvailableRepos = React.useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) {
      return availableRepos;
    }

    return availableRepos.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(trimmed) ||
        repo.accountLogin.toLowerCase().includes(trimmed)
    );
  }, [availableRepos, searchQuery]);

  const filteredGitLabRepos = React.useMemo(() => {
    const trimmed = gitlabSearchQuery.trim().toLowerCase();
    if (!trimmed) {
      return availableGitLabRepos;
    }

    return availableGitLabRepos.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(trimmed) ||
        repo.accountLogin.toLowerCase().includes(trimmed)
    );
  }, [availableGitLabRepos, gitlabSearchQuery]);

  async function handleImportGitHub(repo: AvailableGitHubRepository) {
    setFeedback(null);
    setImportingRepoId(`github:${repo.providerRepoId}`);

    try {
      const result = await importGitHubRepositoryAction(
        repo.connectionId,
        repo.providerRepoId
      );

      setFeedback({
        type: result.success ? "success" : "error",
        message: result.message,
      });

      if (result.success) {
        router.refresh();
      }
    } finally {
      setImportingRepoId(null);
    }
  }

  async function handleImportGitLab(repo: AvailableGitLabRepository) {
    setFeedback(null);
    setImportingRepoId(`gitlab:${repo.providerRepoId}`);

    try {
      const result = await importGitLabRepositoryAction(
        repo.connectionId,
        repo.providerRepoId
      );

      setFeedback({
        type: result.success ? "success" : "error",
        message: result.message,
      });

      if (result.success) {
        router.refresh();
      }
    } finally {
      setImportingRepoId(null);
    }
  }

  async function handleReindex(repository: UserRepositoryRecord) {
    setFeedback(null);
    setReindexingRepoId(repository.id);

    try {
      const response = await fetch(
        `/api/repositories/${repository.id}/index`,
        {
          method: "POST",
        }
      );

      const payload = (await response.json()) as IndexJobApiResponse;

      if (!response.ok || !payload.job) {
        setFeedback({
          type: "error",
          message:
            payload.error ||
            `Unable to start indexing for ${repository.fullName}.`,
        });
        return;
      }

      setIndexJobsByRepoId((prev) => ({
        ...prev,
        [repository.id]: payload.job!,
      }));

      setFeedback({
        type: "success",
        message: payload.alreadyActive
          ? `Indexing is already in progress for ${repository.fullName}.`
          : `Started indexing ${repository.fullName}.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: `Unable to contact the server to index ${repository.fullName}.`,
      });
    } finally {
      setReindexingRepoId(null);
    }
  }

  async function handleDisconnect(repository: UserRepositoryRecord) {
    setFeedback(null);
    setDisconnectingRepoId(repository.id);

    try {
      const result = await disconnectRepositoryAction(repository.id);

      setFeedback({
        type: result.success ? "success" : "error",
        message: result.message,
      });

      if (result.success) {
        router.refresh();
      }
    } finally {
      setDisconnectingRepoId(null);
    }
  }

  return (
    <div className="space-y-8">
      {feedback && (
        <div
          role={feedback.type === "error" ? "alert" : "status"}
          className={
            feedback.type === "error"
              ? "flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-red-400"
              : "flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-sm text-emerald-400"
          }
        >
          {feedback.type === "error" ? (
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
          ) : (
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Connected Repositories */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Connected Repositories</CardTitle>
            <CardDescription>
              Repositories imported and indexed into your Codebase Chat
              workspace.
            </CardDescription>
          </div>

          <Badge
            variant={isAtQuotaLimit ? "warning" : "default"}
            className="w-fit font-mono"
          >
            {activeCount} / {maxRepositories} used
          </Badge>
        </CardHeader>

        <CardContent>
          {initialRepositories.length === 0 ? (
            <div className="rounded-lg border border-dashed border-cb-border bg-cb-surface/50 p-6 text-center">
              <FolderGit2
                className="mx-auto h-8 w-8 text-cb-text-secondary"
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-medium text-cb-text-primary">
                No repositories connected yet
              </p>
              <p className="mt-1 text-xs text-cb-text-secondary">
                Select up to {maxRepositories} repositories from GitHub or
                GitLab below to start indexing and chatting.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-cb-border rounded-lg border border-cb-border bg-cb-surface/50">
              {initialRepositories.map((repo) => {
                const isDisconnecting = disconnectingRepoId === repo.id;
                const isReindexing = reindexingRepoId === repo.id;
                const job = indexJobsByRepoId[repo.id];
                const isJobActive =
                  job?.status === "queued" || job?.status === "indexing";

                return (
                  <li
                    key={repo.id}
                    className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/repositories/${encodeURIComponent(repo.id)}`}
                          className="inline-flex items-center gap-1.5 font-mono text-sm font-medium text-cb-text-primary hover:text-cb-primary"
                        >
                          <span className="truncate">{repo.fullName}</span>
                        </Link>
                        <a
                          href={repo.canonicalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open on provider"
                          className="inline-flex items-center text-cb-text-secondary hover:text-cb-text-primary"
                        >
                          <ExternalLink
                            className="h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        </a>

                        <Badge variant="outline" className="uppercase text-[10px]">
                          {repo.provider === "gitlab" ? "GitLab" : "GitHub"}
                        </Badge>

                        {renderIndexStatusBadge(job)}

                        <Badge variant="default" className="capitalize">
                          {repo.visibility}
                        </Badge>

                        {repo.providerArchived && (
                          <Badge variant="warning">Archived</Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-cb-text-secondary">
                        <span className="inline-flex items-center gap-1">
                          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                          {repo.defaultBranch || "default branch unknown"}
                        </span>

                        {job && job.status === "indexed" && (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <FileCode2
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {job.filesIndexed.toLocaleString()} files
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Layers
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {job.chunksTotal.toLocaleString()} chunks
                            </span>
                          </>
                        )}
                      </div>

                      {job?.status === "failed" && job.errorMessage && (
                        <p className="text-xs text-red-400">
                          {job.errorMessage}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {job?.status === "indexed" && (
                        <>
                          <Link
                            href={`/repositories/${encodeURIComponent(repo.id)}`}
                            className="inline-flex h-8 items-center justify-center rounded-md border border-cb-border bg-transparent px-3 text-xs font-medium text-cb-text-primary transition-colors hover:bg-cb-elevated"
                          >
                            <FileCode2
                              className="mr-1.5 h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            Browse Files
                          </Link>
                          <Link
                            href={`/chat?repo=${encodeURIComponent(repo.id)}`}
                            className="inline-flex h-8 items-center justify-center rounded-md bg-cb-primary px-3 text-xs font-medium text-white transition-colors hover:bg-cb-primary-hover"
                          >
                            <MessageSquare
                              className="mr-1.5 h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            Ask AI
                          </Link>
                        </>
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          isReindexing ||
                          isJobActive ||
                          isDisconnecting ||
                          importingRepoId !== null
                        }
                        onClick={() => void handleReindex(repo)}
                      >
                        <RefreshCw
                          className={`mr-1.5 h-3.5 w-3.5 ${
                            isReindexing || isJobActive ? "animate-spin" : ""
                          }`}
                          aria-hidden="true"
                        />
                        {isJobActive
                          ? "Indexing..."
                          : job
                            ? "Re-index"
                            : "Index Now"}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isDisconnecting || importingRepoId !== null}
                        onClick={() => void handleDisconnect(repo)}
                        className="text-cb-text-secondary hover:border-red-500/40 hover:text-red-400"
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Import from GitHub */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Import from GitHub</CardTitle>
            <CardDescription>
              Browse repositories authorized through your GitHub App
              installation.
            </CardDescription>
          </div>

          {hasActiveGitHubConnection && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoadingAvailable}
              onClick={() => void loadAvailableRepositories()}
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${
                  isLoadingAvailable ? "animate-spin" : ""
                }`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {!hasActiveGitHubConnection ? (
            <div className="rounded-lg border border-dashed border-cb-border bg-cb-surface/50 p-6 text-center">
              <FolderGit2
                className="mx-auto h-8 w-8 text-cb-text-secondary"
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-medium text-cb-text-primary">
                GitHub is not connected yet
              </p>
              <p className="mt-1 text-xs text-cb-text-secondary">
                Install the Codebase Chat GitHub App on your personal account or
                organization to list and import repositories.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="/api/github/install"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-cb-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
                >
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                  Connect GitHub
                </a>
                <Link
                  href="/settings"
                  className="inline-flex h-9 items-center justify-center rounded-md border border-cb-border px-4 text-sm font-medium text-cb-text-secondary transition-colors hover:bg-cb-elevated hover:text-cb-text-primary"
                >
                  Manage in Settings
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  placeholder="Filter GitHub repositories by owner or name..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="pl-9"
                  aria-label="Filter GitHub repositories"
                />
              </div>

              {isLoadingAvailable ? (
                <div className="space-y-2.5">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : fetchError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400"
                >
                  <p>{fetchError}</p>
                </div>
              ) : filteredAvailableRepos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-cb-border bg-cb-surface/50 p-6 text-center">
                  <p className="text-sm font-medium text-cb-text-primary">
                    {availableRepos.length === 0
                      ? "No repositories granted to this GitHub App installation"
                      : "No matching GitHub repositories found"}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-cb-border rounded-lg border border-cb-border bg-cb-surface/50">
                  {filteredAvailableRepos.map((repo) => {
                    const isConnected = connectedGitHubRepoIds.has(
                      repo.providerRepoId
                    );
                    const isImporting =
                      importingRepoId === `github:${repo.providerRepoId}`;

                    return (
                      <li
                        key={repo.providerRepoId}
                        className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-mono text-sm font-medium text-cb-text-primary">
                              {repo.fullName}
                            </span>

                            <Badge variant="default" className="capitalize">
                              {repo.visibility === "private" && (
                                <Lock
                                  className="mr-1 h-3 w-3"
                                  aria-hidden="true"
                                />
                              )}
                              {repo.visibility}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs text-cb-text-secondary">
                            <span>@{repo.accountLogin}</span>
                            {repo.defaultBranch && (
                              <span className="inline-flex items-center gap-1">
                                <GitBranch
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {repo.defaultBranch}
                              </span>
                            )}
                          </div>
                        </div>

                        {isConnected ? (
                          <Badge variant="success" className="w-fit shrink-0">
                            Connected
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            disabled={
                              isAtQuotaLimit ||
                              importingRepoId !== null ||
                              disconnectingRepoId !== null
                            }
                            onClick={() => void handleImportGitHub(repo)}
                            className="shrink-0"
                          >
                            <Plus
                              className="mr-1.5 h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            {isImporting ? "Importing..." : "Import"}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Import from GitLab.com */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Import from GitLab.com</CardTitle>
            <CardDescription>
              Browse projects authorized through your GitLab.com OAuth PKCE
              connection.
            </CardDescription>
          </div>

          {hasActiveGitLabConnection && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoadingGitLab}
              onClick={() => void loadAvailableGitLabRepositories()}
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${
                  isLoadingGitLab ? "animate-spin" : ""
                }`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {!hasActiveGitLabConnection ? (
            <div className="rounded-lg border border-dashed border-cb-border bg-cb-surface/50 p-6 text-center">
              <FolderGit2
                className="mx-auto h-8 w-8 text-cb-text-secondary"
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-medium text-cb-text-primary">
                GitLab.com is not connected yet
              </p>
              <p className="mt-1 text-xs text-cb-text-secondary">
                Connect your GitLab.com account with read-only OAuth 2.0 PKCE
                access to import public or private GitLab projects.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="/api/gitlab/connect"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-cb-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
                >
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                  Connect GitLab.com
                </a>
                <Link
                  href="/settings"
                  className="inline-flex h-9 items-center justify-center rounded-md border border-cb-border px-4 text-sm font-medium text-cb-text-secondary transition-colors hover:bg-cb-elevated hover:text-cb-text-primary"
                >
                  Manage in Settings
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  placeholder="Filter GitLab projects by namespace or name..."
                  value={gitlabSearchQuery}
                  onChange={(event) => setGitlabSearchQuery(event.target.value)}
                  className="pl-9"
                  aria-label="Filter GitLab projects"
                />
              </div>

              {isLoadingGitLab ? (
                <div className="space-y-2.5">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : gitlabFetchError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400"
                >
                  <p>{gitlabFetchError}</p>
                </div>
              ) : filteredGitLabRepos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-cb-border bg-cb-surface/50 p-6 text-center">
                  <p className="text-sm font-medium text-cb-text-primary">
                    {availableGitLabRepos.length === 0
                      ? "No GitLab projects found for your connected account"
                      : "No matching GitLab projects found"}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-cb-border rounded-lg border border-cb-border bg-cb-surface/50">
                  {filteredGitLabRepos.map((repo) => {
                    const isConnected = connectedGitLabRepoIds.has(
                      repo.providerRepoId
                    );
                    const isImporting =
                      importingRepoId === `gitlab:${repo.providerRepoId}`;

                    return (
                      <li
                        key={repo.providerRepoId}
                        className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-mono text-sm font-medium text-cb-text-primary">
                              {repo.fullName}
                            </span>

                            <Badge variant="default" className="capitalize">
                              {repo.visibility === "private" && (
                                <Lock
                                  className="mr-1 h-3 w-3"
                                  aria-hidden="true"
                                />
                              )}
                              {repo.visibility}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs text-cb-text-secondary">
                            <span>@{repo.accountLogin}</span>
                            {repo.defaultBranch && (
                              <span className="inline-flex items-center gap-1">
                                <GitBranch
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {repo.defaultBranch}
                              </span>
                            )}
                          </div>
                        </div>

                        {isConnected ? (
                          <Badge variant="success" className="w-fit shrink-0">
                            Connected
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            disabled={
                              isAtQuotaLimit ||
                              importingRepoId !== null ||
                              disconnectingRepoId !== null
                            }
                            onClick={() => void handleImportGitLab(repo)}
                            className="shrink-0"
                          >
                            <Plus
                              className="mr-1.5 h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            {isImporting ? "Importing..." : "Import"}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
