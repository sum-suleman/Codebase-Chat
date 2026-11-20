export type CommandItemCategory =
  | "navigation"
  | "repository"
  | "conversation"
  | "code";

export interface CommandPaletteItem {
  id: string;
  category: CommandItemCategory;
  title: string;
  subtitle: string;
  href: string;
  badge?: string;
}

export interface PaletteRepositorySummary {
  id: string;
  fullName: string;
  provider: string;
  defaultBranch?: string | null;
}

export interface PaletteConversationSummary {
  id: string;
  title: string;
  repositoryFullName: string;
}

export interface PaletteCodeHitSummary {
  chunkId: string;
  repositoryId: string;
  repositoryFullName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  similarity: number;
}

export const WORKSPACE_NAVIGATION_ITEMS: CommandPaletteItem[] = [
  {
    id: "nav-dashboard",
    category: "navigation",
    title: "Dashboard",
    subtitle: "Overview, stats, and recent repository activity",
    href: "/",
    badge: "Page",
  },
  {
    id: "nav-repositories",
    category: "navigation",
    title: "Repositories",
    subtitle: "Connect, index, and manage GitHub and GitLab repositories",
    href: "/repositories",
    badge: "Page",
  },
  {
    id: "nav-chat",
    category: "navigation",
    title: "AI Codebase Chat",
    subtitle: "Ask grounded questions with exact file and line citations",
    href: "/chat",
    badge: "Page",
  },
  {
    id: "nav-search",
    category: "navigation",
    title: "Semantic Code Search",
    subtitle: "Search across repositories with vector embeddings",
    href: "/search",
    badge: "Page",
  },
  {
    id: "nav-conversations",
    category: "navigation",
    title: "Conversations History",
    subtitle: "Search, rename, and organize saved Q&A threads",
    href: "/conversations",
    badge: "Page",
  },
  {
    id: "nav-settings",
    category: "navigation",
    title: "Settings",
    subtitle: "Manage GitHub App, GitLab OAuth, and account preferences",
    href: "/settings",
    badge: "Page",
  },
];

export function buildCommandPaletteItems(params: {
  query: string;
  repositories: PaletteRepositorySummary[];
  conversations: PaletteConversationSummary[];
  codeHits: PaletteCodeHitSummary[];
}): CommandPaletteItem[] {
  const normalizedQuery = params.query.trim().toLowerCase();
  const items: CommandPaletteItem[] = [];

  // 1. Live semantic code matches first when present
  for (const hit of params.codeHits) {
    items.push({
      id: `code-${hit.chunkId}`,
      category: "code",
      title: `${hit.filePath} (L${hit.startLine}–L${hit.endLine})`,
      subtitle: hit.repositoryFullName,
      href: `/repositories/${encodeURIComponent(hit.repositoryId)}?file=${encodeURIComponent(hit.filePath)}&line=${hit.startLine}`,
      badge: `${Math.round(hit.similarity * 100)}% match`,
    });
  }

  // 2. Repositories matching query
  const matchingRepos = params.repositories.filter((repo) => {
    if (!normalizedQuery) {
      return true;
    }
    return (
      repo.fullName.toLowerCase().includes(normalizedQuery) ||
      repo.provider.toLowerCase().includes(normalizedQuery)
    );
  });

  for (const repo of matchingRepos.slice(0, normalizedQuery ? 8 : 5)) {
    items.push({
      id: `repo-${repo.id}`,
      category: "repository",
      title: repo.fullName,
      subtitle: repo.defaultBranch
        ? `Browse indexed files · branch: ${repo.defaultBranch}`
        : "Browse indexed files",
      href: `/repositories/${encodeURIComponent(repo.id)}`,
      badge: repo.provider === "gitlab" ? "GitLab" : "GitHub",
    });
  }

  // 3. Conversations matching query
  const matchingConversations = params.conversations.filter((conv) => {
    if (!normalizedQuery) {
      return true;
    }
    return (
      conv.title.toLowerCase().includes(normalizedQuery) ||
      conv.repositoryFullName.toLowerCase().includes(normalizedQuery)
    );
  });

  for (const conv of matchingConversations.slice(0, normalizedQuery ? 6 : 4)) {
    items.push({
      id: `conv-${conv.id}`,
      category: "conversation",
      title: conv.title,
      subtitle: `Resume chat · ${conv.repositoryFullName}`,
      href: `/chat?conversation=${encodeURIComponent(conv.id)}`,
      badge: "Thread",
    });
  }

  // 4. Workspace navigation routes
  const matchingNav = WORKSPACE_NAVIGATION_ITEMS.filter((nav) => {
    if (!normalizedQuery) {
      return true;
    }
    return (
      nav.title.toLowerCase().includes(normalizedQuery) ||
      nav.subtitle.toLowerCase().includes(normalizedQuery)
    );
  });
  items.push(...matchingNav);

  return items;
}
