"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileCode2,
  FolderGit2,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";

import { MarkdownMessage } from "@/components/chat/markdown-message";
import { HighlightedCode } from "@/components/code/highlighted-code";
import { inferLanguageFromPath } from "@/lib/syntax/highlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  ChatMessageRecord,
  ConversationSummaryRecord,
} from "@/lib/chat/conversations";
import type { CodeCitation } from "@/lib/chat/retrieval";
import { cn } from "@/lib/utils";

export interface ChatRepositoryOption {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  isIndexed: boolean;
  filesIndexed: number;
  chunksTotal: number;
}

interface ChatWorkspaceProps {
  repositories: ChatRepositoryOption[];
  initialConversations: ConversationSummaryRecord[];
  initialConversationId: string | null;
  initialMessages: ChatMessageRecord[];
  initialRepositoryId: string | null;
  initialPrompt?: string;
}

const SUGGESTED_PROMPTS = [
  "Give me a high-level architecture overview of this repository.",
  "Where is authentication and session validation implemented?",
  "Trace the main API routes and database interactions in this codebase.",
  "What environment variables and external services does this project require?",
];

function getExternalSourceLabel(url: string): string {
  if (url.startsWith("https://gitlab.com/")) {
    return "GitLab";
  }
  if (url.startsWith("https://github.com/")) {
    return "GitHub";
  }
  return "Source";
}

function CitationCard({
  citation,
  repositoryId,
}: {
  citation: CodeCitation;
  repositoryId: string;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="rounded-md border border-cb-border bg-cb-bg/80 p-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex min-w-0 items-center gap-1.5 text-left font-mono text-cb-text-primary hover:text-cb-primary"
        >
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-cb-primary/15 px-1 text-[10px] font-semibold text-cb-primary">
            {citation.index}
          </span>
          <FileCode2 className="h-3.5 w-3.5 shrink-0 text-cb-primary" />
          <span className="truncate">{citation.filePath}</span>
          <span className="shrink-0 text-cb-text-secondary">
            :L{citation.startLine}-L{citation.endLine}
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-cb-text-secondary" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-cb-text-secondary" />
          )}
        </button>

        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-[10px]">
            {Math.round(citation.similarity * 100)}% match
          </Badge>
          {repositoryId && (
            <Link
              href={`/repositories/${encodeURIComponent(repositoryId)}?file=${encodeURIComponent(citation.filePath)}&line=${citation.startLine}`}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-cb-text-secondary hover:text-cb-primary hover:underline"
            >
              View file
            </Link>
          )}
          {citation.githubUrl && (
            <a
              href={citation.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-cb-primary hover:underline"
            >
              {getExternalSourceLabel(citation.githubUrl)}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {expanded && citation.snippet && (
        <pre className="mt-2 max-h-56 overflow-x-auto rounded border border-cb-border bg-cb-sidebar p-2.5 font-mono text-[11px] leading-relaxed text-cb-text-primary">
          <HighlightedCode
            code={citation.snippet}
            language={inferLanguageFromPath(citation.filePath)}
          />
        </pre>
      )}
    </div>
  );
}

export function ChatWorkspace({
  repositories,
  initialConversations,
  initialConversationId,
  initialMessages,
  initialRepositoryId,
  initialPrompt = "",
}: ChatWorkspaceProps) {
  const indexedRepositories = React.useMemo(
    () => repositories.filter((repo) => repo.isIndexed),
    [repositories]
  );

  const defaultRepoId = React.useMemo(() => {
    if (
      initialRepositoryId &&
      indexedRepositories.some((r) => r.id === initialRepositoryId)
    ) {
      return initialRepositoryId;
    }
    return indexedRepositories[0]?.id ?? repositories[0]?.id ?? "";
  }, [indexedRepositories, initialRepositoryId, repositories]);

  const [conversations, setConversations] =
    React.useState<ConversationSummaryRecord[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = React.useState<
    string | null
  >(initialConversationId);
  const [selectedRepositoryId, setSelectedRepositoryId] =
    React.useState<string>(defaultRepoId);
  const [messages, setMessages] =
    React.useState<ChatMessageRecord[]>(initialMessages);
  const [inputValue, setInputValue] = React.useState(initialPrompt);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [isLoadingThread, setIsLoadingThread] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const selectedRepo = React.useMemo(
    () => repositories.find((r) => r.id === selectedRepositoryId) ?? null,
    [repositories, selectedRepositoryId]
  );

  const refreshConversationList = React.useCallback(async () => {
    try {
      const response = await fetch("/api/conversations", {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as {
        conversations?: ConversationSummaryRecord[];
      };
      if (Array.isArray(data.conversations)) {
        setConversations(data.conversations);
      }
    } catch {
      // Ignore background refresh errors
    }
  }, []);

  const handleSelectConversation = async (conversationId: string) => {
    if (isStreaming || conversationId === activeConversationId) {
      return;
    }

    setIsLoadingThread(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        conversation?: {
          id: string;
          repositoryId: string;
          messages: ChatMessageRecord[];
        };
        error?: string;
      };

      if (!response.ok || !payload.conversation) {
        setErrorMessage(payload.error || "Unable to load conversation.");
        return;
      }

      setActiveConversationId(payload.conversation.id);
      setSelectedRepositoryId(payload.conversation.repositoryId);
      setMessages(payload.conversation.messages);
    } catch {
      setErrorMessage("Network error while loading conversation.");
    } finally {
      setIsLoadingThread(false);
    }
  };

  const handleNewChat = () => {
    if (isStreaming) {
      return;
    }
    setActiveConversationId(null);
    setMessages([]);
    setErrorMessage(null);
  };

  const handleDeleteConversation = async (
    event: React.MouseEvent,
    conversationId: string
  ) => {
    event.stopPropagation();
    if (isStreaming) {
      return;
    }

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        return;
      }

      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch {
      // Ignore delete network error
    }
  };

  const submitQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || isStreaming) {
      return;
    }

    if (!selectedRepo) {
      setErrorMessage("Please connect and index a repository first.");
      return;
    }

    if (!selectedRepo.isIndexed) {
      setErrorMessage(
        `${selectedRepo.fullName} is not indexed yet. Run indexing in Repositories first.`
      );
      return;
    }

    setErrorMessage(null);
    setInputValue("");
    setIsStreaming(true);

    const tempUserId = `temp-user-${Date.now()}`;
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const nowIso = new Date().toISOString();

    setMessages((prev) => [
      ...prev,
      {
        id: tempUserId,
        conversationId: activeConversationId ?? "pending",
        role: "user",
        content: question,
        citations: [],
        createdAt: nowIso,
      },
      {
        id: tempAssistantId,
        conversationId: activeConversationId ?? "pending",
        role: "assistant",
        content: "",
        citations: [],
        createdAt: nowIso,
      },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryId: selectedRepo.id,
          conversationId: activeConversationId,
          message: question,
        }),
      });

      if (!response.ok || !response.body) {
        const errPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errPayload.error || `Chat request failed with status ${response.status}.`
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          const lines = rawEvent.split("\n");
          let eventName = "message";
          let dataLine = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLine = line.slice(5).trim();
            }
          }

          if (!dataLine) {
            continue;
          }

          const parsed = JSON.parse(dataLine) as Record<string, unknown>;

          if (eventName === "meta") {
            const convId =
              typeof parsed.conversationId === "string"
                ? parsed.conversationId
                : null;
            const citations = Array.isArray(parsed.citations)
              ? (parsed.citations as CodeCitation[])
              : [];

            if (convId) {
              setActiveConversationId(convId);
            }

            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempAssistantId
                  ? {
                      ...msg,
                      conversationId: convId ?? msg.conversationId,
                      citations,
                    }
                  : msg
              )
            );
          } else if (eventName === "token") {
            const tokenText =
              typeof parsed.text === "string" ? parsed.text : "";
            if (tokenText) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === tempAssistantId
                    ? { ...msg, content: msg.content + tokenText }
                    : msg
                )
              );
            }
          } else if (eventName === "done") {
            const messageId =
              typeof parsed.messageId === "string"
                ? parsed.messageId
                : tempAssistantId;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempAssistantId ? { ...msg, id: messageId } : msg
              )
            );
          } else if (eventName === "error") {
            const errMsg =
              typeof parsed.error === "string"
                ? parsed.error
                : "AI response interrupted.";
            setErrorMessage(errMsg);
          }
        }
      }

      await refreshConversationList();
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Unable to complete chat request.";
      setErrorMessage(msg);
      setMessages((prev) =>
        prev.filter(
          (item) =>
            item.id !== tempAssistantId || item.content.trim().length > 0
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  if (repositories.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-14 text-center">
          <FolderGit2 className="h-10 w-10 text-cb-text-secondary" />
          <h2 className="mt-4 text-lg font-semibold text-cb-text-primary">
            No repositories connected yet
          </h2>
          <p className="mt-1 max-w-md text-sm text-cb-text-secondary">
            Import a GitHub or GitLab repository and index its source files to
            start asking grounded questions with exact line citations.
          </p>
          <Link
            href="/repositories"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-cb-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
          >
            Go to Repositories
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Left Thread Sidebar */}
      <aside className="flex flex-col rounded-xl border border-cb-border bg-cb-card p-3">
        <Button
          type="button"
          variant="primary"
          className="w-full justify-start"
          onClick={handleNewChat}
          disabled={isStreaming}
        >
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          New Chat
        </Button>

        <div className="mt-4 px-2 text-xs font-semibold uppercase tracking-wider text-cb-text-secondary">
          Recent Threads
        </div>

        <div className="mt-2 max-h-[540px] flex-1 space-y-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-xs text-cb-text-secondary">
              Your saved conversations will appear here after your first
              question.
            </p>
          ) : (
            conversations.map((conv) => {
              const isSelected = conv.id === activeConversationId;
              return (
                <div
                  key={conv.id}
                  onClick={() => void handleSelectConversation(conv.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void handleSelectConversation(conv.id);
                    }
                  }}
                  className={cn(
                    "group flex items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                    isSelected
                      ? "bg-cb-elevated text-cb-text-primary"
                      : "text-cb-text-secondary hover:bg-cb-elevated/50 hover:text-cb-text-primary"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-cb-text-primary">
                      {conv.title}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-cb-text-secondary">
                      {conv.repositoryFullName}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={(e) => void handleDeleteConversation(e, conv.id)}
                    className="mt-0.5 rounded p-1 text-cb-text-secondary opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Panel */}
      <div className="flex min-h-[640px] flex-col rounded-xl border border-cb-border bg-cb-card">
        {/* Top Repository Context Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cb-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FolderGit2 className="h-4 w-4 text-cb-primary" />
            <label
              htmlFor="chat-repo-select"
              className="text-xs font-medium text-cb-text-secondary"
            >
              Repository:
            </label>
            <select
              id="chat-repo-select"
              value={selectedRepositoryId}
              disabled={isStreaming || activeConversationId !== null}
              onChange={(e) => setSelectedRepositoryId(e.target.value)}
              className="rounded-md border border-cb-border bg-cb-bg px-2.5 py-1.5 font-mono text-xs text-cb-text-primary focus:border-cb-primary focus:outline-none disabled:opacity-60"
            >
              {repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName}{" "}
                  {repo.isIndexed
                    ? `(${repo.filesIndexed} files indexed)`
                    : "(not indexed)"}
                </option>
              ))}
            </select>
          </div>

          {selectedRepo && (
            <div className="flex items-center gap-2">
              {selectedRepo.isIndexed ? (
                <Badge variant="success">
                  {selectedRepo.chunksTotal} chunks searchable
                </Badge>
              ) : (
                <Link
                  href="/repositories"
                  className="text-xs font-medium text-cb-primary hover:underline"
                >
                  Index repository first →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Messages Feed */}
        <div className="flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
          {isLoadingThread ? (
            <div className="flex h-full items-center justify-center py-16 text-sm text-cb-text-secondary">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading conversation...
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center py-10 text-center">
              <div className="rounded-full bg-cb-primary/10 p-3 text-cb-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-cb-text-primary">
                Ask anything about{" "}
                <span className="font-mono text-cb-primary">
                  {selectedRepo?.fullName ?? "your codebase"}
                </span>
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-cb-text-secondary">
                Answers are grounded in semantic pgvector retrieval across your
                indexed source files and include clickable file and line
                citations.
              </p>

              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={!selectedRepo?.isIndexed || isStreaming}
                    onClick={() => void submitQuestion(prompt)}
                    className="rounded-lg border border-cb-border bg-cb-bg p-3 text-left text-xs text-cb-text-secondary transition-colors hover:border-cb-primary/60 hover:text-cb-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-start gap-3",
                    isUser ? "justify-end" : "justify-start"
                  )}
                >
                  {!isUser && (
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cb-primary/15 text-cb-primary">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}

                  <div
                    className={cn(
                      "max-w-[85%] space-y-3 rounded-xl px-4 py-3 text-sm leading-relaxed",
                      isUser
                        ? "bg-cb-primary text-white"
                        : "border border-cb-border bg-cb-bg text-cb-text-primary"
                    )}
                  >
                    {message.content ? (
                      isUser ? (
                        <div className="whitespace-pre-wrap break-words">
                          {message.content}
                        </div>
                      ) : (
                        <MarkdownMessage content={message.content} />
                      )
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-cb-text-secondary">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Searching codebase and generating grounded answer...
                      </div>
                    )}

                    {!isUser && message.citations.length > 0 && (
                      <div className="space-y-2 border-t border-cb-border pt-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-cb-text-secondary">
                          Sources ({message.citations.length})
                        </div>
                        <div className="space-y-1.5">
                          {message.citations.map((citation) => (
                            <CitationCard
                              key={citation.chunkId}
                              citation={citation} repositoryId={selectedRepositoryId}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cb-elevated text-cb-text-secondary">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div
            role="alert"
            className="mx-4 mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {errorMessage}
          </div>
        )}

        {/* Prompt Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitQuestion(inputValue);
          }}
          className="border-t border-cb-border p-4"
        >
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitQuestion(inputValue);
                }
              }}
              placeholder={
                selectedRepo?.isIndexed
                  ? `Ask a question about ${selectedRepo.fullName}... (Enter to send, Shift+Enter for newline)`
                  : "Select an indexed repository to start asking questions..."
              }
              disabled={!selectedRepo?.isIndexed || isStreaming}
              className="min-h-[56px] flex-1 resize-none rounded-lg border border-cb-border bg-cb-bg px-3.5 py-2.5 text-sm text-cb-text-primary placeholder:text-cb-text-secondary focus:border-cb-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={
                !selectedRepo?.isIndexed ||
                isStreaming ||
                inputValue.trim().length === 0
              }
              className="h-11 px-4"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Ask</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
