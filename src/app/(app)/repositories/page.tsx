import { redirect } from "next/navigation";

import { RepositoriesManager } from "@/components/repositories/repositories-manager";
import {
  listLatestRepositoryIndexJobs,
  type RepositoryIndexJobRecord,
} from "@/lib/indexing/pipeline";
import { listUserGitHubConnections } from "@/lib/providers/github/connections";
import { listUserGitLabConnections } from "@/lib/providers/gitlab/client";
import {
  listUserActiveRepositories,
  MAX_ACTIVE_REPOSITORIES_PER_USER,
} from "@/lib/repositories/manage";
import { createClient } from "@/lib/supabase/server";

export default async function RepositoriesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [repositories, githubConnections, gitlabConnections] = await Promise.all([
    listUserActiveRepositories(supabase).catch(() => []),
    listUserGitHubConnections(supabase).catch(() => []),
    listUserGitLabConnections(supabase).catch(() => []),
  ]);

  const latestJobsMap =
    repositories.length > 0
      ? await listLatestRepositoryIndexJobs(
          supabase,
          repositories.map((repo) => repo.id)
        ).catch(() => new Map<string, RepositoryIndexJobRecord>())
      : new Map<string, RepositoryIndexJobRecord>();

  const initialIndexJobs: Record<string, RepositoryIndexJobRecord> = {};
  for (const [repoId, job] of latestJobsMap.entries()) {
    initialIndexJobs[repoId] = job;
  }

  const hasActiveGitHubConnection = githubConnections.some(
    (connection) =>
      connection.status === "active" && connection.installationId !== null
  );

  const hasActiveGitLabConnection = gitlabConnections.some(
    (connection) => connection.status === "active"
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-cb-text-primary">
          Repositories
        </h1>

        <p className="text-sm text-cb-text-secondary">
          Connect up to {MAX_ACTIVE_REPOSITORIES_PER_USER} GitHub or GitLab
          repositories to index and explore with AI.
        </p>
      </div>

      <RepositoriesManager
        initialRepositories={repositories}
        initialIndexJobs={initialIndexJobs}
        hasActiveGitHubConnection={hasActiveGitHubConnection}
        hasActiveGitLabConnection={hasActiveGitLabConnection}
        maxRepositories={MAX_ACTIVE_REPOSITORIES_PER_USER}
      />
    </div>
  );
}
