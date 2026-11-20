"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FolderGit2,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ConversationSummaryRecord } from "@/lib/chat/conversations";

interface ConversationsManagerProps {
  initialConversations: ConversationSummaryRecord[];
}

type SortOption = "updated_desc" | "updated_asc" | "title_asc";

function formatTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return "recently";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

export function ConversationsManager({
  initialConversations,
}: ConversationsManagerProps) {
  const [conversations, setConversations] =
    React.useState<ConversationSummaryRecord[]>(initialConversations);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedRepoFilter, setSelectedRepoFilter] = React.useState("all");
  const [sortBy, setSortBy] = React.useState<SortOption>("updated_desc");

  // Selection state for bulk deletion
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = React.useState(false);

  // Inline rename state
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingTitle, setEditingTitle] = React.useState("");
  const [savingRenameId, setSavingRenameId] = React.useState<string | null>(
    null
  );

  // Single-item delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null
  );
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const repositoryOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const conv of conversations) {
      if (!map.has(conv.repositoryId)) {
        map.set(conv.repositoryId, conv.repositoryFullName);
      }
    }
    return Array.from(map.entries())
      .map(([id, fullName]) => ({ id, fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [conversations]);

  const filteredConversations = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = conversations.filter((conv) => {
      if (
        selectedRepoFilter !== "all" &&
        conv.repositoryId !== selectedRepoFilter
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        conv.title.toLowerCase().includes(query) ||
        conv.repositoryFullName.toLowerCase().includes(query)
      );
    });

    return filtered.sort((a, b) => {
      if (sortBy === "title_asc") {
        return a.title.localeCompare(b.title);
      }
      const timeA = Date.parse(a.updatedAt) || 0;
      const timeB = Date.parse(b.updatedAt) || 0;
      return sortBy === "updated_asc" ? timeA - timeB : timeB - timeA;
    });
  }, [conversations, searchQuery, selectedRepoFilter, sortBy]);

  const allVisibleSelected =
    filteredConversations.length > 0 &&
    filteredConversations.every((conv) => selectedIds.has(conv.id));

  function toggleSelectAllVisible() {
    setConfirmBulkDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const conv of filteredConversations) {
          next.delete(conv.id);
        }
      } else {
        for (const conv of filteredConversations) {
          next.add(conv.id);
        }
      }
      return next;
    });
  }

  function toggleSelectOne(id: string) {
    setConfirmBulkDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function startEditing(conv: ConversationSummaryRecord) {
    setFeedback(null);
    setConfirmDeleteId(null);
    setEditingId(conv.id);
    setEditingTitle(conv.title);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingTitle("");
  }

  async function saveRename(conversationId: string) {
    const trimmed = editingTitle.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      setFeedback({
        type: "error",
        message: "Conversation title cannot be empty.",
      });
      return;
    }

    setSavingRenameId(conversationId);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        }
      );

      const payload = (await response.json()) as {
        conversation?: { id: string; title: string; updatedAt: string };
        error?: string;
      };

      if (!response.ok || !payload.conversation) {
        setFeedback({
          type: "error",
          message: payload.error || "Unable to rename conversation.",
        });
        return;
      }

      setConversations((prev) =>
        prev.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                title: payload.conversation!.title,
                updatedAt: payload.conversation!.updatedAt || item.updatedAt,
              }
            : item
        )
      );
      setEditingId(null);
      setEditingTitle("");
      setFeedback({
        type: "success",
        message: "Conversation renamed.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Unable to reach the server while renaming.",
      });
    } finally {
      setSavingRenameId(null);
    }
  }

  async function handleDeleteSingle(conversationId: string) {
    setDeletingId(conversationId);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" }
      );
      const payload = (await response.json()) as {
        deleted?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.deleted) {
        setFeedback({
          type: "error",
          message: payload.error || "Unable to delete conversation.",
        });
        return;
      }

      setConversations((prev) =>
        prev.filter((item) => item.id !== conversationId)
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });
      setConfirmDeleteId(null);
      setFeedback({
        type: "success",
        message: "Conversation deleted.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Unable to reach the server while deleting.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    const idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0) {
      return;
    }

    setIsBulkDeleting(true);
    setFeedback(null);

    try {
      const results = await Promise.all(
        idsToDelete.map(async (id) => {
          const res = await fetch(
            `/api/conversations/${encodeURIComponent(id)}`,
            { method: "DELETE" }
          );
          return { id, ok: res.ok };
        })
      );

      const deletedSet = new Set(
        results.filter((r) => r.ok).map((r) => r.id)
      );

      if (deletedSet.size > 0) {
        setConversations((prev) =>
          prev.filter((item) => !deletedSet.has(item.id))
        );
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of deletedSet) {
            next.delete(id);
          }
          return next;
        });
      }

      setConfirmBulkDelete(false);

      if (deletedSet.size === idsToDelete.length) {
        setFeedback({
          type: "success",
          message: `Deleted ${deletedSet.size} conversation${
            deletedSet.size === 1 ? "" : "s"
          }.`,
        });
      } else {
        setFeedback({
          type: "error",
          message: `Deleted ${deletedSet.size} of ${idsToDelete.length} selected conversations.`,
        });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Unable to complete bulk deletion.",
      });
    } finally {
      setIsBulkDeleting(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-cb-text-primary">
              Conversations
            </h1>
            <Badge variant="default" className="font-mono">
              {conversations.length}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-cb-text-secondary">
            Search, organize, rename, and resume your saved Q&amp;A threads
            across connected repositories.
          </p>
        </div>

        <Link
          href="/chat"
          className="inline-flex h-10 items-center justify-center rounded-md bg-cb-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
        >
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          New Chat
        </Link>
      </div>

      {feedback && (
        <div
          role={feedback.type === "error" ? "alert" : "status"}
          className={
            feedback.type === "error"
              ? "flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
              : "flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400"
          }
        >
          {feedback.type === "error" ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {conversations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <MessageSquare className="h-10 w-10 text-cb-text-secondary" />
            <h2 className="mt-4 text-lg font-semibold text-cb-text-primary">
              No conversations yet
            </h2>
            <p className="mt-1 max-w-md text-sm text-cb-text-secondary">
              Start an AI Chat session on any indexed repository to build a
              searchable history of codebase explanations.
            </p>
            <Link
              href="/chat"
              className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-cb-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
            >
              Start Asking Questions
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filter, Search & Bulk Actions Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-cb-border bg-cb-card p-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by thread title or repository..."
                  aria-label="Search conversations"
                  className="pl-9 pr-8"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cb-text-secondary hover:text-cb-text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <select
                value={selectedRepoFilter}
                onChange={(e) => setSelectedRepoFilter(e.target.value)}
                aria-label="Filter by repository"
                className="h-10 rounded-md border border-cb-border bg-cb-bg px-3 text-sm text-cb-text-primary focus:border-cb-primary focus:outline-none"
              >
                <option value="all">All repositories ({repositoryOptions.length})</option>
                {repositoryOptions.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.fullName}
                  </option>
                ))}
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                aria-label="Sort conversations"
                className="h-10 rounded-md border border-cb-border bg-cb-bg px-3 text-sm text-cb-text-primary focus:border-cb-primary focus:outline-none"
              >
                <option value="updated_desc">Newest updated</option>
                <option value="updated_asc">Oldest updated</option>
                <option value="title_asc">Title A–Z</option>
              </select>
            </div>

            {/* Selection / Bulk Delete Controls */}
            <div className="flex flex-wrap items-center gap-2 border-t border-cb-border pt-2.5 lg:border-t-0 lg:pt-0">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-cb-border bg-cb-bg px-3 py-2 text-xs font-medium text-cb-text-secondary hover:text-cb-text-primary">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  className="h-3.5 w-3.5 rounded border-cb-border accent-cb-primary"
                />
                <span>Select all ({filteredConversations.length})</span>
              </label>

              {selectedIds.size > 0 && !confirmBulkDelete && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmBulkDelete(true)}
                  className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete ({selectedIds.size})
                </Button>
              )}

              {selectedIds.size > 0 && confirmBulkDelete && (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBulkDeleting}
                    onClick={() => void handleBulkDelete()}
                    className="bg-red-600 text-white hover:bg-red-500"
                  >
                    {isBulkDeleting ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Confirm ({selectedIds.size})
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBulkDeleting}
                    onClick={() => setConfirmBulkDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Filtered Results */}
          {filteredConversations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-8 w-8 text-cb-text-secondary" />
                <p className="mt-3 text-sm font-medium text-cb-text-primary">
                  No matching conversations
                </p>
                <p className="mt-1 text-xs text-cb-text-secondary">
                  Try clearing your search query or switching the repository
                  filter.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedRepoFilter("all");
                  }}
                >
                  Reset filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {filteredConversations.map((conv) => {
                const isEditing = editingId === conv.id;
                const isSavingRename = savingRenameId === conv.id;
                const isConfirmingDelete = confirmDeleteId === conv.id;
                const isDeleting = deletingId === conv.id;
                const isChecked = selectedIds.has(conv.id);

                return (
                  <div
                    key={conv.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-cb-border bg-cb-card p-4 transition-colors hover:border-cb-primary/50 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectOne(conv.id)}
                        aria-label={`Select conversation ${conv.title}`}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-cb-border accent-cb-primary"
                      />

                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              type="text"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void saveRename(conv.id);
                                } else if (e.key === "Escape") {
                                  cancelEditing();
                                }
                              }}
                              maxLength={200}
                              autoFocus
                              aria-label="Conversation title"
                              className="h-8 max-w-lg text-sm"
                            />
                            <Button
                              type="button"
                              size="sm"
                              disabled={isSavingRename}
                              onClick={() => void saveRename(conv.id)}
                              className="h-8 px-2.5"
                            >
                              {isSavingRename ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              <span className="ml-1">Save</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isSavingRename}
                              onClick={cancelEditing}
                              className="h-8 px-2.5"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Link
                            href={`/chat?conversation=${encodeURIComponent(conv.id)}`}
                            className="block truncate text-sm font-semibold text-cb-text-primary hover:text-cb-primary"
                          >
                            {conv.title}
                          </Link>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-cb-text-secondary">
                          <Link
                            href={`/repositories/${encodeURIComponent(conv.repositoryId)}`}
                            className="inline-flex items-center"
                          >
                            <Badge
                              variant="default"
                              className="font-mono hover:border-cb-primary/60"
                            >
                              <FolderGit2 className="mr-1 h-3 w-3" />
                              {conv.repositoryFullName}
                            </Badge>
                          </Link>
                          <span>Updated {formatTimestamp(conv.updatedAt)}</span>
                          <span className="hidden text-cb-border sm:inline">
                            •
                          </span>
                          <span className="hidden sm:inline">
                            Created {formatTimestamp(conv.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Row Actions */}
                    <div className="flex shrink-0 flex-wrap items-center gap-2 pl-7 sm:pl-0">
                      {!isEditing && !isConfirmingDelete && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startEditing(conv)}
                            title="Rename conversation"
                            className="h-8 px-2.5 text-xs"
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Rename
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setFeedback(null);
                              setConfirmDeleteId(conv.id);
                            }}
                            title="Delete conversation"
                            className="h-8 px-2.5 text-xs text-cb-text-secondary hover:border-red-500/40 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>

                          <Link
                            href={`/chat?conversation=${encodeURIComponent(conv.id)}`}
                            className="inline-flex h-8 items-center justify-center rounded-md bg-cb-primary/15 px-3 text-xs font-medium text-cb-primary transition-colors hover:bg-cb-primary hover:text-white"
                          >
                            Open
                            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                          </Link>
                        </>
                      )}

                      {isConfirmingDelete && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            disabled={isDeleting}
                            onClick={() => void handleDeleteSingle(conv.id)}
                            className="h-8 bg-red-600 px-2.5 text-xs text-white hover:bg-red-500"
                          >
                            {isDeleting ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            Confirm Delete
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isDeleting}
                            onClick={() => setConfirmDeleteId(null)}
                            className="h-8 px-2.5 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
