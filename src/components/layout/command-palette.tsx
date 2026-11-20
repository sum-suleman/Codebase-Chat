"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Compass,
  FileCode2,
  FolderGit2,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  buildCommandPaletteItems,
  type CommandItemCategory,
  type CommandPaletteItem,
  type PaletteCodeHitSummary,
  type PaletteConversationSummary,
  type PaletteRepositorySummary,
} from "@/lib/search/command-items";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositories: PaletteRepositorySummary[];
  conversations: PaletteConversationSummary[];
}

const CATEGORY_LABELS: Record<CommandItemCategory, string> = {
  code: "Semantic Code Matches",
  repository: "Repositories",
  conversation: "Recent Conversations",
  navigation: "Workspace Pages",
};

function CategoryIcon({ category }: { category: CommandItemCategory }) {
  switch (category) {
    case "code":
      return <FileCode2 className="h-4 w-4 shrink-0 text-cb-primary" />;
    case "repository":
      return <FolderGit2 className="h-4 w-4 shrink-0 text-cb-primary" />;
    case "conversation":
      return <MessageSquare className="h-4 w-4 shrink-0 text-sky-400" />;
    case "navigation":
    default:
      return <Compass className="h-4 w-4 shrink-0 text-cb-text-secondary" />;
  }
}

export function CommandPalette({
  open,
  onOpenChange,
  repositories,
  conversations,
}: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [codeHits, setCodeHits] = React.useState<PaletteCodeHitSummary[]>([]);
  const [isSearchingCode, setIsSearchingCode] = React.useState(false);

  // Global Cmd+K / Ctrl+K shortcut
  React.useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open, onOpenChange]);

  // Reset and focus when opened
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setCodeHits([]);
      setSelectedIndex(0);
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 20);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  // Debounced semantic code search when query has 3+ chars and repositories exist
  React.useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < 3 || repositories.length === 0) {
      setCodeHits([]);
      setIsSearchingCode(false);
      return;
    }

    const controller = new AbortController();
    setIsSearchingCode(true);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, limit: 5 }),
          signal: controller.signal,
        });

        if (!response.ok) {
          setCodeHits([]);
          return;
        }

        const payload = (await response.json()) as {
          hits?: PaletteCodeHitSummary[];
        };
        setCodeHits(Array.isArray(payload.hits) ? payload.hits : []);
      } catch {
        if (!controller.signal.aborted) {
          setCodeHits([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingCode(false);
        }
      }
    }, 320);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, repositories.length]);

  const items = React.useMemo(
    () =>
      buildCommandPaletteItems({
        query,
        repositories,
        conversations,
        codeHits,
      }),
    [query, repositories, conversations, codeHits]
  );

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [items.length, query]);

  const navigateToItem = React.useCallback(
    (item: CommandPaletteItem) => {
      onOpenChange(false);
      router.push(item.href);
    },
    [onOpenChange, router]
  );

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (items.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % items.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = items[selectedIndex];
      if (target) {
        navigateToItem(target);
      } else if (query.trim()) {
        onOpenChange(false);
        router.push("/search");
      }
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 px-4 pt-16 backdrop-blur-xs sm:pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Quick command and code search palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-cb-border bg-cb-card shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input Header */}
        <div className="flex items-center gap-3 border-b border-cb-border bg-cb-sidebar px-4 py-3">
          {isSearchingCode ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cb-primary" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-cb-text-secondary" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Jump to repository, conversation, page, or search code semantically..."
            className="flex-1 bg-transparent text-sm text-cb-text-primary placeholder:text-cb-text-secondary focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear command query"
              className="rounded p-1 text-cb-text-secondary hover:bg-cb-elevated hover:text-cb-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border border-cb-border bg-cb-bg px-1.5 py-0.5 font-mono text-[10px] text-cb-text-secondary hover:text-cb-text-primary"
          >
            ESC
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="py-10 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-cb-text-secondary" />
              <p className="mt-2 text-sm font-medium text-cb-text-primary">
                No instant matches for &ldquo;{query}&rdquo;
              </p>
              <p className="mt-1 text-xs text-cb-text-secondary">
                Press Enter to open full Semantic Code Search.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                const prevCategory = idx > 0 ? items[idx - 1].category : null;
                const showCategoryHeader = item.category !== prevCategory;

                return (
                  <React.Fragment key={item.id}>
                    {showCategoryHeader && (
                      <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-cb-text-secondary">
                        {CATEGORY_LABELS[item.category]}
                      </div>
                    )}
                    <button
                      type="button"
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => navigateToItem(item)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        isSelected
                          ? "bg-cb-primary/15 text-cb-text-primary"
                          : "text-cb-text-secondary hover:bg-cb-elevated/60 hover:text-cb-text-primary"
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <CategoryIcon category={item.category} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-xs font-medium text-cb-text-primary">
                            {item.title}
                          </div>
                          <div className="truncate text-[11px] text-cb-text-secondary">
                            {item.subtitle}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {item.badge && (
                          <Badge variant="default" className="text-[10px]">
                            {item.badge}
                          </Badge>
                        )}
                        <ArrowRight
                          className={cn(
                            "h-3.5 w-3.5 transition-opacity",
                            isSelected
                              ? "text-cb-primary opacity-100"
                              : "opacity-0"
                          )}
                        />
                      </div>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Keyboard Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cb-border bg-cb-sidebar px-4 py-2 text-[11px] text-cb-text-secondary">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-cb-border bg-cb-bg px-1 py-0.5 font-mono text-[10px]">
                ↑↓
              </kbd>{" "}
              Navigate
            </span>
            <span>
              <kbd className="rounded border border-cb-border bg-cb-bg px-1 py-0.5 font-mono text-[10px]">
                ↵
              </kbd>{" "}
              Open
            </span>
          </div>
          <span>Type 3+ characters for live semantic code search</span>
        </div>
      </div>
    </div>
  );
}
