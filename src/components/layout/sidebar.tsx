"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TerminalSquare,
  LayoutDashboard,
  FolderGit2,
  MessageSquare,
  History,
  Search,
  Settings,
  LogOut,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { logoutAction } from "@/app/actions/auth";

interface SidebarProps {
  userFullName: string;
  userEmail: string;
  userAvatarUrl?: string | null;
}

// Shared navigation configuration.
export const navItems = [
  {
    name: "Dashboard",
    mobileName: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    showOnMobile: true,
  },
  {
    name: "Repositories",
    mobileName: "Repos",
    href: "/repositories",
    icon: FolderGit2,
    showOnMobile: true,
  },
  {
    name: "AI Chat",
    href: "/chat",
    icon: MessageSquare,
    showOnMobile: false,
  },
  {
    name: "Code Search",
    mobileName: "Search",
    href: "/search",
    icon: Search,
    showOnMobile: false,
  },
  {
    name: "Conversations",
    mobileName: "Chats",
    href: "/conversations",
    icon: History,
    showOnMobile: true,
  },
  {
    name: "Settings",
    mobileName: "Settings",
    href: "/settings",
    icon: Settings,
    showOnMobile: true,
  },
];

export function Sidebar({
  userFullName,
  userEmail,
  userAvatarUrl,
}: SidebarProps) {
  const pathname = usePathname();

  const [logoutState, logoutFormAction, isLoggingOut] = useActionState(
    logoutAction,
    { success: true, message: "" }
  );

  const initials = userFullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase() || "D";

  return (
    <aside className="flex h-full w-[250px] flex-col border-r border-cb-border bg-cb-sidebar">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center px-6">
        <TerminalSquare
          className="mr-3 h-6 w-6 text-cb-primary"
          aria-hidden="true"
        />

        <span className="font-mono text-lg font-bold tracking-tight text-cb-text-primary">
          Codebase Chat
        </span>
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
        aria-label="Sidebar Navigation"
      >
        <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-cb-text-secondary">
          Workspace
        </div>

        {navItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={(event) => {
                const enabledRoutes = ["/", "/repositories", "/chat", "/search", "/conversations", "/settings"];

                if (!enabledRoutes.includes(item.href)) {
                  event.preventDefault();
                }
              }}
              className={cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-cb-elevated text-cb-text-primary"
                  : "text-cb-text-secondary hover:bg-cb-elevated/50 hover:text-cb-text-primary"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon
                className={cn(
                  "mr-3 h-5 w-5",
                  isActive
                    ? "text-cb-primary"
                    : "text-cb-text-secondary"
                )}
                aria-hidden="true"
              />

              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Authenticated User Profile */}
      <div className="border-t border-cb-border p-4">
        <div className="flex items-center gap-3">
          <Avatar
            src={userAvatarUrl || undefined}
            alt={`${userFullName}'s profile picture`}
            fallback={initials}
            size="sm"
          />

          <div className="flex min-w-0 flex-col overflow-hidden">
            <span className="truncate text-sm font-medium text-cb-text-primary">
              {userFullName}
            </span>

            <span className="truncate text-xs text-cb-text-secondary">
              {userEmail || "Account"}
            </span>
          </div>
        </div>

        <form action={logoutFormAction} className="mt-4">
          <button
            type="submit"
            disabled={isLoggingOut}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-cb-text-secondary transition-colors hover:bg-cb-elevated hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />

            {isLoggingOut ? "Signing out..." : "Sign out"}
          </button>

          {!logoutState.success && (
            <p
              role="alert"
              className="mt-2 text-xs text-red-400"
            >
              {logoutState.message}
            </p>
          )}
        </form>
      </div>
    </aside>
  );
}
