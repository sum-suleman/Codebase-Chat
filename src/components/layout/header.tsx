"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Search, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";

interface HeaderProps {
  onOpenCommandPalette?: () => void;
}

function getHeaderTitle(pathname: string): string {
  if (pathname === "/") {
    return "Dashboard";
  }
  if (pathname === "/repositories") {
    return "Repositories";
  }
  if (pathname.startsWith("/repositories/")) {
    return "Repository Explorer";
  }
  if (pathname.startsWith("/chat")) {
    return "AI Codebase Chat";
  }
  if (pathname.startsWith("/search")) {
    return "Semantic Code Search";
  }
  if (pathname.startsWith("/conversations")) {
    return "Conversations";
  }
  if (pathname.startsWith("/settings")) {
    return "Settings";
  }
  return "Workspace";
}

export function Header({ onOpenCommandPalette }: HeaderProps) {
  const pathname = usePathname();
  const title = getHeaderTitle(pathname);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-cb-border bg-cb-bg px-4 md:px-6">
      {/* Desktop: Dynamic Page Title. Mobile: Brand Identity */}
      <div className="flex items-center">
        <h1 className="hidden text-lg font-medium text-cb-text-primary md:block">
          {title}
        </h1>
        <div className="flex items-center md:hidden">
          <TerminalSquare
            className="mr-2 h-5 w-5 text-cb-primary"
            aria-hidden="true"
          />
          <span className="font-mono text-base font-bold tracking-tight text-cb-text-primary">
            Codebase Chat
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Desktop Command Palette Launcher */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="hidden h-9 w-72 items-center justify-between rounded-md border border-cb-border bg-cb-sidebar px-3 text-xs text-cb-text-secondary transition-colors hover:border-cb-primary/50 hover:text-cb-text-primary md:flex"
        >
          <span className="flex items-center gap-2 truncate">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Search repos, threads, code...</span>
          </span>
          <kbd className="rounded border border-cb-border bg-cb-bg px-1.5 py-0.5 font-mono text-[10px] text-cb-text-secondary">
            ⌘K
          </kbd>
        </button>

        {/* Mobile Quick Search Button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenCommandPalette}
          className="md:hidden"
          aria-label="Open quick search"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
