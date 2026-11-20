"use client";

import * as React from "react";

import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { BottomNav } from "./bottom-nav";
import { CommandPalette } from "./command-palette";
import type {
  PaletteConversationSummary,
  PaletteRepositorySummary,
} from "@/lib/search/command-items";

interface AppShellProps {
  children: React.ReactNode;
  userFullName: string;
  userEmail: string;
  userAvatarUrl: string;
  repositories?: PaletteRepositorySummary[];
  recentConversations?: PaletteConversationSummary[];
}

export function AppShell({
  children,
  userFullName,
  userEmail,
  userAvatarUrl,
  repositories = [],
  recentConversations = [],
}: AppShellProps) {
  const [commandOpen, setCommandOpen] = React.useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-cb-bg text-cb-text-primary">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar
          userFullName={userFullName}
          userEmail={userEmail}
          userAvatarUrl={userAvatarUrl}
        />
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header onOpenCommandPalette={() => setCommandOpen(true)} />

        <main className="flex-1 overflow-auto p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-8 md:pb-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        {/* Mobile Bottom Navigation */}
        <BottomNav />
      </div>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        repositories={repositories}
        conversations={recentConversations}
      />
    </div>
  );
}
