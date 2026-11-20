import { redirect } from "next/navigation";

import {
  CodeSearchWorkspace,
  type SearchRepositoryOption,
} from "@/components/search/code-search-workspace";
import { listLatestRepositoryIndexJobs } from "@/lib/indexing/pipeline";
import { listUserActiveRepositories } from "@/lib/repositories/manage";
import { createClient } from "@/lib/supabase/server";

interface SearchPageProps {
  searchParams: Promise<{
    repo?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const repositories = await listUserActiveRepositories(supabase).catch(
    () => []
  );

  const jobsByRepoId =
    repositories.length > 0
      ? await listLatestRepositoryIndexJobs(
          supabase,
          repositories.map((r) => r.id)
        ).catch(() => new Map())
      : new Map();

  const repositoryOptions: SearchRepositoryOption[] = repositories.map((repo) => {
    const job = jobsByRepoId.get(repo.id);
    const isIndexed = job?.status === "indexed" && (job?.chunksTotal ?? 0) > 0;
    return {
      id: repo.id,
      fullName: repo.fullName,
      isIndexed,
      chunksTotal: job?.chunksTotal ?? 0,
    };
  });

  const initialRepositoryId =
    typeof resolvedParams.repo === "string" && resolvedParams.repo.trim()
      ? resolvedParams.repo.trim()
      : "all";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-cb-text-primary">
          Semantic Code Search
        </h1>
        <p className="mt-1 text-sm text-cb-text-secondary">
          Search across one or all connected repositories using vector
          embeddings and jump directly to matching source lines.
        </p>
      </div>

      <CodeSearchWorkspace
        repositories={repositoryOptions}
        initialRepositoryId={initialRepositoryId}
      />
    </div>
  );
}
