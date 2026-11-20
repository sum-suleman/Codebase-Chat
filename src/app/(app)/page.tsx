import Link from "next/link";
import { FolderGit2, MessageSquare, Activity, Terminal, Search } from "lucide-react";

import { ActivityItem, type ActivityType } from "@/components/dashboard/activity-item";
import { ConversationItem } from "@/components/dashboard/conversation-item";
import { RepositoryCard } from "@/components/dashboard/repository-card";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  listUserConversations,
  type ConversationSummaryRecord,
} from "@/lib/chat/conversations";
import {
  listLatestRepositoryIndexJobs,
  type RepositoryIndexJobRecord,
} from "@/lib/indexing/pipeline";
import {
  listUserActiveRepositories,
  MAX_ACTIVE_REPOSITORIES_PER_USER,
  type UserRepositoryRecord,
} from "@/lib/repositories/manage";
import { createClient, getCachedProfile } from "@/lib/supabase/server";

interface DashboardActivity {
  id: string;
  type: ActivityType;
  event: string;
  target: string;
  time: string;
  sortTs: number;
}

function formatProviderLabel(provider: UserRepositoryRecord["provider"]): "GitHub" | "GitLab" {
  return provider === "gitlab" ? "GitLab" : "GitHub";
}

function formatRepositorySublabel(repo: UserRepositoryRecord): string {
  const branchLabel = repo.defaultBranch ? `branch: ${repo.defaultBranch}` : "default branch";
  return `${repo.visibility} · ${branchLabel}`;
}

function formatDateLabel(isoTimestamp: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) {
    return "recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(parsed));
}

function getCardStatus(
  job: RepositoryIndexJobRecord | undefined
): "indexed" | "indexing" | "failed" | "queued" | "pending" {
  if (!job) {
    return "pending";
  }
  return job.status;
}

function getCardStatusMessage(
  job: RepositoryIndexJobRecord | undefined
): string | undefined {
  if (!job) {
    return undefined;
  }
  if (job.status === "failed") {
    return job.errorMessage || "Repository indexing failed";
  }
  if (job.status === "indexing") {
    return job.filesTotal > 0
      ? `Indexing ${job.filesTotal} files (${job.chunksTotal} chunks)...`
      : "Scanning repository files...";
  }
  if (job.status === "queued") {
    return "Queued for indexing...";
  }
  return undefined;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName = "Developer";
  let repositories: UserRepositoryRecord[] = [];
  let jobsByRepoId = new Map<string, RepositoryIndexJobRecord>();
  let conversations: ConversationSummaryRecord[] = [];

  if (user) {
    const [profile, activeRepos, userConversations] = await Promise.all([
      getCachedProfile(user.id),
      listUserActiveRepositories(supabase).catch(() => []),
      listUserConversations(supabase, 20).catch(() => []),
    ]);

    displayName =
      profile?.display_name || user.user_metadata?.full_name || "Developer";
    repositories = activeRepos;
    conversations = userConversations;

    if (activeRepos.length > 0) {
      jobsByRepoId = await listLatestRepositoryIndexJobs(
        supabase,
        activeRepos.map((repo) => repo.id)
      ).catch(() => new Map<string, RepositoryIndexJobRecord>());
    }
  }

  let indexedCount = 0;
  let inProgressCount = 0;

  for (const repo of repositories) {
    const job = jobsByRepoId.get(repo.id);
    if (job?.status === "indexed") {
      indexedCount += 1;
    } else if (job?.status === "queued" || job?.status === "indexing") {
      inProgressCount += 1;
    }
  }

  const stats = [
    {
      title: "Connected Repositories",
      value: String(repositories.length),
      label: `of ${MAX_ACTIVE_REPOSITORIES_PER_USER} slots used`,
      icon: FolderGit2,
    },
    {
      title: "Indexed Repositories",
      value: String(indexedCount),
      label: "Ready for search",
      icon: Terminal,
    },
    {
      title: "Indexing in Progress",
      value: String(inProgressCount),
      label: "Processing chunks",
      icon: Activity,
    },
    {
      title: "Total Conversations",
      value: String(conversations.length),
      label: "Across all repos",
      icon: MessageSquare,
    },
  ];

  const activityItems: DashboardActivity[] = [];

  for (const repo of repositories) {
    const connectedTs = Date.parse(repo.createdAt);
    activityItems.push({
      id: `connected-${repo.id}`,
      type: "connected",
      event: "Repository connected",
      target: repo.fullName,
      time: formatDateLabel(repo.createdAt),
      sortTs: Number.isFinite(connectedTs) ? connectedTs : 0,
    });

    const job = jobsByRepoId.get(repo.id);
    if (job) {
      const jobTimestamp = job.completedAt || job.startedAt || job.createdAt;
      const jobTs = Date.parse(jobTimestamp);
      if (job.status === "indexed") {
        activityItems.push({
          id: `indexed-${job.id}`,
          type: "indexing_completed",
          event: `Indexed ${job.filesIndexed} files (${job.chunksTotal} chunks)`,
          target: repo.fullName,
          time: formatDateLabel(jobTimestamp),
          sortTs: Number.isFinite(jobTs) ? jobTs : 0,
        });
      } else if (job.status === "failed") {
        activityItems.push({
          id: `failed-${job.id}`,
          type: "indexing_failed",
          event: "Indexing failed",
          target: repo.fullName,
          time: formatDateLabel(jobTimestamp),
          sortTs: Number.isFinite(jobTs) ? jobTs : 0,
        });
      }
    }
  }

  const recentActivity = activityItems
    .sort((a, b) => b.sortTs - a.sortTs)
    .slice(0, 6);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <section className="flex flex-col justify-between gap-4 rounded-xl border border-cb-border bg-cb-card p-6 md:flex-row md:items-center md:p-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-cb-text-primary">
            Welcome back, {displayName}
          </h2>
          <p className="text-cb-text-secondary">
            Understand your codebase by asking questions in natural language.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/repositories"
            className="inline-flex h-10 items-center justify-center rounded-md bg-cb-elevated px-4 py-2 text-sm font-medium text-cb-text-primary transition-colors hover:bg-cb-border/70"
          >
            <FolderGit2 className="mr-2 h-4 w-4" /> Connect Repository
          </Link>
          {indexedCount > 0 ? (
            <>
              <Link
                href="/search"
                className="inline-flex h-10 items-center justify-center rounded-md border border-cb-border bg-cb-bg px-4 py-2 text-sm font-medium text-cb-text-primary transition-colors hover:bg-cb-elevated"
              >
                <Search className="mr-2 h-4 w-4" /> Code Search
              </Link>
              <Link
                href="/chat"
                className="inline-flex h-10 items-center justify-center rounded-md bg-cb-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
              >
                <MessageSquare className="mr-2 h-4 w-4" /> Ask AI
              </Link>
            </>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-md bg-cb-primary/40 px-4 py-2 text-sm font-medium text-white/60"
            >
              <MessageSquare className="mr-2 h-4 w-4" /> Ask AI
            </span>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.title}
            title={stat.title}
            value={stat.value}
            subtitle={stat.label}
            icon={stat.icon}
          />
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Recent Repositories</h3>
          <Link
            href="/repositories"
            className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-cb-text-secondary transition-colors hover:bg-cb-elevated hover:text-cb-text-primary"
          >
            View all
          </Link>
        </div>

        {repositories.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <FolderGit2
                className="h-8 w-8 text-cb-text-secondary"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-medium text-cb-text-primary">
                No repositories connected yet
              </p>
              <p className="mt-1 max-w-md text-xs text-cb-text-secondary">
                Connect your GitHub account in Settings and import up to{" "}
                {MAX_ACTIVE_REPOSITORIES_PER_USER} repositories to start
                exploring your codebase.
              </p>
              <Link
                href="/repositories"
                className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-cb-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cb-primary-hover"
              >
                Import Repositories
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {repositories.slice(0, 3).map((repo) => {
              const job = jobsByRepoId.get(repo.id);
              const lastUpdatedIso =
                job?.completedAt || job?.startedAt || repo.updatedAt;

              return (
                <RepositoryCard
                  key={repo.id}
                  repositoryId={repo.id}
                  name={repo.fullName}
                  provider={formatProviderLabel(repo.provider)}
                  language={formatRepositorySublabel(repo)}
                  fileCount={job?.filesIndexed ?? 0}
                  status={getCardStatus(job)}
                  statusMessage={getCardStatusMessage(job)}
                  lastUpdated={formatDateLabel(lastUpdatedIso)}
                  repositoryHref={`/repositories/${encodeURIComponent(repo.id)}`}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Recent Conversations</h3>
            {conversations.length > 0 && (
              <Link
                href="/conversations"
                className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-cb-text-secondary transition-colors hover:bg-cb-elevated hover:text-cb-text-primary"
              >
                View all
              </Link>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              {conversations.length === 0 ? (
                <div className="p-6 text-center text-sm text-cb-text-secondary">
                  No conversations yet. Connect and index a repository to ask
                  your first question.
                </div>
              ) : (
                conversations.slice(0, 4).map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/chat?conversation=${encodeURIComponent(conv.id)}`}
                    className="block transition-colors hover:bg-cb-elevated/40"
                  >
                    <ConversationItem
                      title={conv.title}
                      repoName={conv.repositoryFullName}
                      excerpt="Click to resume thread and view code citations"
                      timestamp={formatDateLabel(conv.updatedAt)}
                    />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Recent Activity</h3>
          <Card>
            <CardContent className="p-0">
              {recentActivity.length === 0 ? (
                <div className="p-6 text-center text-sm text-cb-text-secondary">
                  No recent repository activity yet.
                </div>
              ) : (
                recentActivity.map((act) => (
                  <ActivityItem
                    key={act.id}
                    type={act.type}
                    message={act.event}
                    repoName={act.target}
                    timestamp={act.time}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
